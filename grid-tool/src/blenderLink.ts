// Excursion — the live link to an open Blender (the Excursion add-on's "Live link" button,
// blender/addon/excursion_studio.py). The add-on serves 127.0.0.1:<port>; this side polls its
// status and posts the playhead and the desk whenever they change, at most every 80 ms, newest
// wins. Rooms and rigs are built and placed in Blender itself; this only drives them.

export interface BlenderStatus {
  ok: boolean;
  blender?: string;
  file?: string;
  room?: string;
  rig?: string;
  fixtures?: number;
  last?: string;
}

export class BlenderLink {
  private enabled = false;
  private timer: number | null = null;
  private poll: number | null = null;
  private pending: unknown = null;
  private sending = false;
  status: BlenderStatus | null = null;

  constructor(
    private port: number,
    private onStatus: (s: BlenderStatus | null, error?: string) => void,
  ) {}

  private url(path: string): string {
    return `http://127.0.0.1:${this.port}${path}`;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (this.poll !== null) clearInterval(this.poll);
    this.poll = null;
    if (on) {
      void this.check();
      this.poll = window.setInterval(() => void this.check(), 2000);
    } else {
      this.status = null;
      this.onStatus(null);
    }
  }

  get connected(): boolean {
    return this.enabled && Boolean(this.status?.ok);
  }

  private async check(): Promise<void> {
    try {
      const res = await fetch(this.url("/status"), { cache: "no-store" });
      this.status = (await res.json()) as BlenderStatus;
      this.onStatus(this.status);
    } catch {
      this.status = null;
      this.onStatus(null, `no Blender on port ${this.port} — open a scene, then Excursion sidebar > Live link`);
    }
  }

  /** Queue the newest state; sent at most every 80 ms. */
  push(state: unknown): void {
    if (!this.connected) return;
    this.pending = state;
    if (this.timer === null) this.timer = window.setTimeout(() => void this.flush(), 80);
  }

  private async flush(): Promise<void> {
    this.timer = null;
    if (this.sending || this.pending === null) {
      if (this.pending !== null) this.timer = window.setTimeout(() => void this.flush(), 80);
      return;
    }
    const body = JSON.stringify(this.pending);
    this.pending = null;
    this.sending = true;
    try {
      await fetch(this.url("/state"), { method: "POST", headers: { "Content-Type": "application/json" }, body });
    } catch {
      this.status = null;
      this.onStatus(null, "lost the Blender live link");
    } finally {
      this.sending = false;
    }
  }

  async loadRig(name: string): Promise<void> {
    await fetch(this.url("/rig"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    window.setTimeout(() => void this.check(), 300);
  }
}
