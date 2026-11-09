// Excursion — the floor plan: a top-down canvas of the room (hero, speakers, cameras, lyric
// anchors) and the rig's fixtures, seen from above with the camera side at the bottom. Drag a
// thing to move it on the floor; drag its aim handle (the small ring at the end of its line) to
// re-aim it. Heights stay in the number fields. Snaps to 1 cm (shift: 10 cm).

export interface PlanItem {
  key: string;
  kind: "hero" | "speaker" | "fixture" | "camera" | "anchor";
  x: number;
  y: number;
  /** footprint for speakers and the hero, metres */
  w?: number;
  d?: number;
  /** degrees, + turns the front toward +x */
  yaw?: number;
  /** where it points, on the floor plan */
  aim?: [number, number];
  color: string;
  label: string;
  draggable: boolean;
}

export type PlanPart = "body" | "aim";

interface View {
  cx: number;
  cy: number;
  scale: number; // px per metre (canvas pixels)
}

const HANDLE = 9; // hit radius, canvas px

export class PlanView {
  private items: PlanItem[] = [];
  private selected: string | null = null;
  private view: View = { cx: 0, cy: 0, scale: 100 };
  private drag: { key: string; part: PlanPart } | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private onMove: (key: string, part: PlanPart, x: number, y: number) => void,
    private onSelect: (key: string) => void,
  ) {
    canvas.addEventListener("pointerdown", (e) => this.down(e));
    canvas.addEventListener("pointermove", (e) => this.move(e));
    const up = (e: PointerEvent): void => {
      if (this.drag) canvas.releasePointerCapture(e.pointerId);
      this.drag = null;
      this.fit();
      this.draw();
    };
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
  }

  setItems(items: PlanItem[], selected: string | null): void {
    this.items = items;
    this.selected = selected;
    if (!this.drag) this.fit(); // the view holds still while dragging
    this.draw();
  }

  private fit(): void {
    const xs = [-1.5, 1.5];
    const ys = [-2, 1.5];
    for (const it of this.items) {
      xs.push(it.x);
      ys.push(it.y);
      if (it.aim) {
        xs.push(it.aim[0]);
        ys.push(it.aim[1]);
      }
    }
    const minX = Math.min(...xs) - 0.4;
    const maxX = Math.max(...xs) + 0.4;
    const minY = Math.min(...ys) - 0.4;
    const maxY = Math.max(...ys) + 0.4;
    const { width, height } = this.canvas;
    this.view = { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, scale: Math.min(width / (maxX - minX), height / (maxY - minY)) };
  }

  private toPx(x: number, y: number): [number, number] {
    const { width, height } = this.canvas;
    return [width / 2 + (x - this.view.cx) * this.view.scale, height / 2 - (y - this.view.cy) * this.view.scale];
  }

  private toWorld(px: number, py: number): [number, number] {
    const { width, height } = this.canvas;
    return [this.view.cx + (px - width / 2) / this.view.scale, this.view.cy - (py - height / 2) / this.view.scale];
  }

  private eventPx(e: PointerEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * this.canvas.width, ((e.clientY - r.top) / r.height) * this.canvas.height];
  }

  private hit(px: number, py: number): { key: string; part: PlanPart } | null {
    const scaleHit = HANDLE * (this.canvas.width / Math.max(1, this.canvas.getBoundingClientRect().width));
    // aim handles first (they sit on top), then bodies, the selected item winning ties
    const order = [...this.items].sort((a, b) => Number(b.key === this.selected) - Number(a.key === this.selected));
    for (const it of order) {
      if (!it.draggable || !it.aim) continue;
      const [ax, ay] = this.toPx(it.aim[0], it.aim[1]);
      if (Math.hypot(px - ax, py - ay) <= scaleHit) return { key: it.key, part: "aim" };
    }
    for (const it of order) {
      if (!it.draggable) continue;
      const [x, y] = this.toPx(it.x, it.y);
      const r = Math.max(scaleHit, ((it.w ?? 0) * this.view.scale) / 2);
      if (Math.hypot(px - x, py - y) <= r) return { key: it.key, part: "body" };
    }
    return null;
  }

  private down(e: PointerEvent): void {
    const [px, py] = this.eventPx(e);
    const h = this.hit(px, py);
    if (!h) return;
    this.drag = h;
    this.canvas.setPointerCapture(e.pointerId);
    this.onSelect(h.key);
  }

  private move(e: PointerEvent): void {
    const [px, py] = this.eventPx(e);
    if (!this.drag) {
      this.canvas.style.cursor = this.hit(px, py) ? "grab" : "default";
      return;
    }
    const step = e.shiftKey ? 0.1 : 0.01;
    const [x, y] = this.toWorld(px, py).map((v) => Math.round(v / step) * step + 0) as [number, number];
    this.onMove(this.drag.key, this.drag.part, Number(x.toFixed(4)), Number(y.toFixed(4)));
  }

  draw(): void {
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    const { width, height } = this.canvas;
    const dpr = width / Math.max(1, this.canvas.clientWidth || width);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#0d0f12";
    ctx.fillRect(0, 0, width, height);
    // half-metre grid, the origin cross brighter
    const [x0, y1] = this.toWorld(0, 0);
    const [x1, y0] = this.toWorld(width, height);
    ctx.lineWidth = 1;
    for (let gx = Math.ceil(x0 * 2) / 2; gx <= x1; gx += 0.5) {
      const [px] = this.toPx(gx, 0);
      ctx.strokeStyle = Math.abs(gx) < 1e-6 ? "#2f3540" : "#181c22";
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, height);
      ctx.stroke();
    }
    for (let gy = Math.ceil(y0 * 2) / 2; gy <= y1; gy += 0.5) {
      const [, py] = this.toPx(0, gy);
      ctx.strokeStyle = Math.abs(gy) < 1e-6 ? "#2f3540" : "#181c22";
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(width, py);
      ctx.stroke();
    }
    ctx.font = `${11 * dpr}px ui-monospace, monospace`;
    ctx.fillStyle = "#5b6472";
    ctx.fillText("camera side ↓   grid 0.5 m", 8 * dpr, height - 8 * dpr);

    for (const it of this.items) {
      const sel = it.key === this.selected;
      const [x, y] = this.toPx(it.x, it.y);
      if (it.aim) {
        const [ax, ay] = this.toPx(it.aim[0], it.aim[1]);
        ctx.strokeStyle = it.color;
        ctx.globalAlpha = sel ? 0.9 : 0.45;
        ctx.setLineDash(it.kind === "camera" ? [4 * dpr, 4 * dpr] : []);
        ctx.lineWidth = (sel ? 2 : 1) * dpr;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(ax, ay);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(ax, ay, 4 * dpr, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.lineWidth = (sel ? 2 : 1) * dpr;
      if (it.w && it.d) {
        // a footprint, rotated by yaw, its front edge (toward -y) drawn brighter
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(((it.yaw ?? 0) * Math.PI) / 180);
        const w = it.w * this.view.scale;
        const d = it.d * this.view.scale;
        ctx.fillStyle = sel ? "#2a2f38" : "#1b1f26";
        ctx.strokeStyle = it.color;
        ctx.fillRect(-w / 2, -d / 2, w, d);
        ctx.strokeRect(-w / 2, -d / 2, w, d);
        ctx.lineWidth = 3 * dpr;
        ctx.beginPath();
        ctx.moveTo(-w / 2, d / 2);
        ctx.lineTo(w / 2, d / 2);
        ctx.stroke();
        ctx.restore();
      } else {
        ctx.fillStyle = it.color;
        ctx.strokeStyle = sel ? "#ffffff" : "#000000";
        ctx.beginPath();
        if (it.kind === "camera") {
          ctx.rect(x - 6 * dpr, y - 4 * dpr, 12 * dpr, 8 * dpr);
        } else if (it.kind === "anchor") {
          ctx.moveTo(x, y - 6 * dpr);
          ctx.lineTo(x + 6 * dpr, y);
          ctx.lineTo(x, y + 6 * dpr);
          ctx.lineTo(x - 6 * dpr, y);
          ctx.closePath();
        } else {
          ctx.arc(x, y, 6 * dpr, 0, Math.PI * 2);
        }
        ctx.fill();
        ctx.stroke();
      }
      ctx.fillStyle = sel ? "#ffffff" : "#9aa3b0";
      ctx.fillText(it.label, x + 9 * dpr, y - 8 * dpr);
    }
  }
}
