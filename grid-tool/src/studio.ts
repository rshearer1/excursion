// Excursion — the Room and Rig panels. Rooms (presets/rooms/) are what Blender builds; rigs
// (presets/rigs/) are the lights added at apply time. Both edit a working copy drawn on a floor
// plan and in a list of number fields; Save writes the file through the linked folder (or
// downloads it). The rig the reel uses is the rig picker's: its working copy rides in the drive
// inline, so Live and Preview frame show unsaved edits. The Blender add-on
// (blender/addon/excursion_studio.py) edits the same files from Blender's sidebar.

import { PlanView, type PlanItem, type PlanPart } from "./planView";
import { slugName, type Preset } from "./engine/presets";
import {
  BUILT_IN_LIGHTS,
  FIXTURE_REACTS,
  FIXTURE_ROLES,
  FIXTURE_TYPES,
  emptyRig,
  newFixture,
  parseRig,
  type Fixture,
  type FixtureRole,
  type Rig,
  type Rgb,
  type Vec3,
} from "./engine/rig";
import {
  ROOM_BASES,
  SPEAKER_FOOTPRINT,
  SPEAKER_MODELS,
  STARTER_ROOMS,
  baseLyricAnchors,
  baseSpeakers,
  effectiveRoom,
  freeId,
  parseRoom,
  type Mount,
  type Room,
  type RoomBase,
  type RoomCamera,
  type RoomSpeaker,
} from "./engine/room";

export interface StudioDeps {
  status: (msg: string, err?: boolean) => void;
  writePreset: (p: Preset) => Promise<string>;
  rooms: () => Record<string, Room>;
  rigs: () => Record<string, Rig>;
  sceneSel: HTMLSelectElement;
  rigSel: HTMLSelectElement;
  fillSelect: (sel: HTMLSelectElement, values: { value: string; label: string; title?: string }[], keep?: string) => void;
  toHex: (c: Rgb) => string;
  fromHex: (h: string) => Rgb;
  /** the reel's look changed (the rig or the room): re-render live, persist */
  changed: () => void;
}

export interface Studio {
  /** the rig the drive carries: the working copy when it is the picked rig, else the saved one */
  currentRig(): Rig | undefined;
  /** the library changed (folder linked, preset saved): refresh the pickers */
  refresh(): void;
}

const ROLE_COLOR: Record<FixtureRole, string> = { key: "#ffd27a", rim: "#6aa8ff", wash: "#9b7bff", back: "#f0f0f0", static: "#ff9a4a" };
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const r3 = (x: number): string => String(Math.round(x * 1000) / 1000);

function numInput(value: number, step: number, onChange: (v: number) => void, title = "", width = 62): HTMLInputElement {
  const i = document.createElement("input");
  i.type = "number";
  i.step = String(step);
  i.value = r3(value);
  i.title = title;
  i.style.width = `${width}px`;
  i.addEventListener("change", () => {
    const v = Number(i.value);
    if (Number.isFinite(v)) onChange(v);
  });
  return i;
}

function vecInputs(v: Vec3, onChange: (v: Vec3) => void, what: string): HTMLInputElement[] {
  return (["x", "y", "z"] as const).map((axis, k) =>
    numInput(v[k]!, 0.01, (x) => {
      const next = [...v] as Vec3;
      next[k] = x;
      onChange(next);
    }, `${what} ${axis} (m)`, 58),
  );
}

function select(options: { value: string; label?: string; hint?: string }[], value: string, onChange: (v: string) => void, title = ""): HTMLSelectElement {
  const s = document.createElement("select");
  s.title = title;
  for (const o of options) {
    const opt = document.createElement("option");
    opt.value = o.value;
    opt.textContent = o.label ?? o.value;
    if (o.hint) opt.title = o.hint;
    s.append(opt);
  }
  s.value = value;
  s.addEventListener("change", () => onChange(s.value));
  return s;
}

function button(label: string, onClick: () => void, title = ""): HTMLButtonElement {
  const b = document.createElement("button");
  b.textContent = label;
  b.title = title;
  b.addEventListener("click", onClick);
  return b;
}

function row(...children: (Node | string)[]): HTMLDivElement {
  const d = document.createElement("div");
  d.className = "studiorow";
  d.append(...children);
  return d;
}

function askName(what: string, suggestion: string, status: StudioDeps["status"]): string | null {
  const raw = window.prompt(`Name for this ${what} (letters, digits, dashes):`, suggestion);
  if (raw === null) return null;
  const name = slugName(raw);
  if (!name) status(`A ${what} needs a name.`, true);
  return name || null;
}

export function initStudio(d: StudioDeps): Studio {
  // ---------- rig ----------
  let rigEdit: Rig | null = null;
  let rigDirty = false;
  let selFixture: string | null = null;
  const rigPick = $<HTMLSelectElement>("rigPick");
  const rigHint = $<HTMLSpanElement>("rigHint");
  const rigList = $<HTMLDivElement>("rigList");
  const rigDesc = $<HTMLInputElement>("rigDesc");
  const rigReplace = $<HTMLInputElement>("rigReplace");
  const rigRole = $<HTMLSelectElement>("rigRole");
  const rigSaveBtn = $<HTMLButtonElement>("rigSave");
  const rigSaveAsBtn = $<HTMLButtonElement>("rigSaveAs");
  const rigAddBtn = $<HTMLButtonElement>("rigAdd");
  d.fillSelect(rigRole, FIXTURE_ROLES.map((r) => ({ value: r.value, label: r.value, title: r.hint })));
  rigRole.value = "rim";

  const rigPlan = new PlanView(
    $<HTMLCanvasElement>("rigPlan"),
    (key, part, x, y) => {
      const f = rigEdit?.fixtures.find((g) => g.id === key);
      if (!f) return;
      if (part === "aim") f.aim = [x, y, f.aim[2]];
      else {
        // moving a light keeps its aim point, the way a lamp on a stand is re-aimed by hand
        f.pos = [x, y, f.pos[2]];
      }
      rigChanged(false);
    },
    (key) => {
      selFixture = key;
      renderRigList();
      drawRigPlan();
    },
  );

  function roomItems(): PlanItem[] {
    const scene = d.sceneSel.value;
    const room = roomEdit && roomEdit.name === scene ? roomEdit : d.rooms()[scene] ?? STARTER_ROOMS.find((r) => r.name === scene);
    const items: PlanItem[] = [{ key: "hero", kind: "hero", x: 0, y: 0, w: 0.43, d: 0.37, color: "#e0e0e0", label: "hero", draggable: false }];
    if (room) {
      for (const s of effectiveRoom(room).speakers) {
        const [w, dd] = SPEAKER_FOOTPRINT[s.model] ?? [0.4, 0.4];
        items.push({ key: `spk:${s.id}`, kind: "speaker", x: s.pos[0], y: s.pos[1], w, d: dd, yaw: s.yaw, color: "#808890", label: s.id, draggable: false });
      }
    }
    return items;
  }

  function drawRigPlan(): void {
    const items = roomItems();
    for (const f of rigEdit?.fixtures ?? []) {
      items.push({ key: f.id, kind: "fixture", x: f.pos[0], y: f.pos[1], aim: f.type === "point" ? undefined : [f.aim[0], f.aim[1]], color: ROLE_COLOR[f.role], label: `${f.id} ${r3(f.pos[2])}m`, draggable: true });
    }
    rigPlan.setItems(items, selFixture);
  }

  function rigChanged(rerenderList = true): void {
    rigDirty = true;
    rigHint.textContent = `${rigEdit?.name} — edited, not saved${d.rigSel.value === rigEdit?.name ? " (Live shows the edits)" : ""}`;
    if (rerenderList) renderRigList();
    else syncRigListValues();
    drawRigPlan();
    d.changed();
  }

  /** after a drag only the position fields move; rebuilding the list would steal focus */
  function syncRigListValues(): void {
    for (const f of rigEdit?.fixtures ?? []) {
      const el = rigList.querySelector<HTMLDivElement>(`[data-fixture="${CSS.escape(f.id)}"]`);
      if (!el) continue;
      const inputs = el.querySelectorAll<HTMLInputElement>("input[data-vec]");
      inputs.forEach((i) => {
        const [which, k] = i.dataset["vec"]!.split(":");
        const v = which === "pos" ? f.pos : f.aim;
        i.value = r3(v[Number(k)]!);
      });
    }
  }

  function fixtureRow(f: Fixture): HTMLDivElement {
    const set = <K extends keyof Fixture>(k: K, v: Fixture[K], relist = false): void => {
      f[k] = v;
      rigChanged(relist);
    };
    const id = document.createElement("input");
    id.type = "text";
    id.value = f.id;
    id.style.width = "90px";
    id.title = "fixture id (Blender light Rig_<id>)";
    id.addEventListener("change", () => {
      const next = id.value.trim().replace(/[^A-Za-z0-9_-]+/g, "-");
      if (!next || rigEdit!.fixtures.some((g) => g !== f && g.id === next)) {
        d.status(`Fixture id ${next || "(empty)"} is taken or empty.`, true);
        id.value = f.id;
        return;
      }
      if (selFixture === f.id) selFixture = next;
      set("id", next, true);
    });
    const color = document.createElement("input");
    color.type = "color";
    color.value = d.toHex(f.color);
    color.title = f.role === "static" ? "colour" : "colour (the desk lane's colour wins for key/rim/wash while the lane has cues or the mood has cue steps)";
    color.addEventListener("input", () => set("color", d.fromHex(color.value)));
    const amount = document.createElement("input");
    amount.type = "range";
    amount.min = "0";
    amount.max = "1";
    amount.step = "0.05";
    amount.value = String(f.amount);
    amount.title = "react amount";
    amount.style.width = "70px";
    amount.addEventListener("input", () => set("amount", Number(amount.value)));
    const pos = vecInputs(f.pos, (v) => set("pos", v), "position");
    pos.forEach((i, k) => (i.dataset["vec"] = `pos:${k}`));
    const aim = vecInputs(f.aim, (v) => set("aim", v), "aim point");
    aim.forEach((i, k) => (i.dataset["vec"] = `aim:${k}`));
    const del = button("×", () => {
      rigEdit!.fixtures = rigEdit!.fixtures.filter((g) => g !== f);
      rigChanged(true);
    }, "remove this fixture");
    const swatch = document.createElement("b");
    swatch.style.background = ROLE_COLOR[f.role];
    const r = row(
      swatch,
      id,
      select(FIXTURE_TYPES.map((t) => ({ value: t })), f.type, (v) => set("type", v as Fixture["type"], true), "spot, area (softbox) or point"),
      select(FIXTURE_ROLES, f.role, (v) => set("role", v as FixtureRole, true), "what drives it"),
      select(FIXTURE_REACTS, f.react, (v) => set("react", v as Fixture["react"]), "extra motion from the track"),
      amount,
      " W ",
      numInput(f.power, f.type === "area" ? 1 : 10, (v) => set("power", Math.max(0, v)), "power, watts"),
      color,
      " ° ",
      numInput(f.cone, 1, (v) => set("cone", v), f.type === "area" ? "spread, degrees" : "beam angle, degrees", 52),
      " soft ",
      numInput(f.blend, 0.05, (v) => set("blend", v), "edge softness 0..1", 52),
      " size ",
      numInput(f.size, 0.01, (v) => set("size", v), "source size, metres", 52),
      " smoke ",
      numInput(f.volume, 0.05, (v) => set("volume", v), "how much the beam lights the haze", 52),
      " at ",
      ...pos,
      " aim ",
      ...aim,
      del,
    );
    r.dataset["fixture"] = f.id;
    if (f.id === selFixture) r.classList.add("sel");
    r.addEventListener("pointerdown", () => {
      if (selFixture === f.id) return;
      selFixture = f.id;
      rigList.querySelectorAll(".sel").forEach((e) => e.classList.remove("sel"));
      r.classList.add("sel");
      drawRigPlan();
    });
    return r;
  }

  function renderRigList(): void {
    rigList.replaceChildren();
    const has = Boolean(rigEdit);
    rigSaveBtn.disabled = !has;
    rigSaveAsBtn.disabled = !has;
    rigAddBtn.disabled = !has;
    rigDesc.disabled = !has;
    rigReplace.disabled = !has;
    if (!rigEdit) return;
    rigDesc.value = rigEdit.description;
    rigReplace.checked = rigEdit.replaceBuiltIn;
    for (const f of rigEdit.fixtures) rigList.append(fixtureRow(f));
    if (!rigEdit.fixtures.length) {
      const none = document.createElement("span");
      none.className = "drophint";
      none.textContent = "no fixtures — pick a role and + fixture";
      rigList.append(none);
    }
  }

  function loadRig(rig: Rig): void {
    rigEdit = structuredClone(rig);
    rigDirty = false;
    selFixture = rigEdit.fixtures[0]?.id ?? null;
    rigHint.textContent = `${rig.name}: ${rig.fixtures.length} fixtures${rig.description ? ` — ${rig.description}` : ""}`;
    renderRigList();
    drawRigPlan();
  }

  $<HTMLButtonElement>("rigLoad").addEventListener("click", () => {
    const rig = d.rigs()[rigPick.value];
    if (!rig) {
      d.status("Pick a saved rig first (link the excursion folder to see presets/rigs/).", true);
      return;
    }
    loadRig(rig);
  });
  $<HTMLButtonElement>("rigNew").addEventListener("click", () => {
    const name = askName("rig", "my-rig", d.status);
    if (!name) return;
    loadRig(emptyRig(name));
    rigDirty = true;
    refresh(); // the new rig is the reel's rig straight away (unsaved, it rides in the drive inline)
    d.rigSel.value = name;
    rigHint.textContent = `${name} — new, not saved (Live shows it)`;
    d.changed();
  });
  rigAddBtn.addEventListener("click", () => {
    if (!rigEdit) return;
    const f = newFixture(rigEdit, rigRole.value as FixtureRole);
    rigEdit.fixtures.push(f);
    selFixture = f.id;
    rigChanged(true);
  });
  rigDesc.addEventListener("change", () => {
    if (!rigEdit) return;
    rigEdit.description = rigDesc.value;
    rigChanged(false);
  });
  rigReplace.addEventListener("change", () => {
    if (!rigEdit) return;
    rigEdit.replaceBuiltIn = rigReplace.checked;
    rigChanged(false);
  });
  async function saveRig(name: string): Promise<void> {
    if (!rigEdit) return;
    const rig: Rig = parseRig({ ...structuredClone(rigEdit), name } as unknown as Record<string, unknown>);
    try {
      const where = await d.writePreset(rig);
      rigEdit = rig;
      rigDirty = false;
      refresh();
      rigPick.value = name;
      d.rigSel.value = name;
      rigHint.textContent = `${name} saved — the reel uses it`;
      d.changed();
      d.status(`Rig ${name} written to ${where}. No rebuild needed: the next render or live frame lights with it.`);
    } catch (e) {
      d.status(`Save rig: ${e instanceof Error ? e.message : String(e)}`, true);
    }
  }
  rigSaveBtn.addEventListener("click", () => rigEdit && void saveRig(rigEdit.name));
  rigSaveAsBtn.addEventListener("click", () => {
    if (!rigEdit) return;
    const name = askName("rig", `${rigEdit.name}-2`, d.status);
    if (name) void saveRig(name);
  });
  $<HTMLSpanElement>("rigBuiltIns").textContent = `the room's own lights: ${BUILT_IN_LIGHTS.join(", ")}`;

  // ---------- room ----------
  let roomEdit: Room | null = null;
  let selRoomItem: string | null = null;
  const roomHint = $<HTMLSpanElement>("roomHint");
  const roomForm = $<HTMLDivElement>("roomForm");
  const roomBaseNew = $<HTMLSelectElement>("roomBaseNew");
  const roomSaveBtn = $<HTMLButtonElement>("roomSave");
  const roomSaveAsBtn = $<HTMLButtonElement>("roomSaveAs");
  d.fillSelect(roomBaseNew, ROOM_BASES.map((b) => ({ value: b.value, label: `new from ${b.value}`, title: b.hint })));

  const roomPlan = new PlanView(
    $<HTMLCanvasElement>("roomPlan"),
    (key, part, x, y) => {
      if (!roomEdit) return;
      const [kind, id] = key.split(":") as [string, string];
      const wasOwn = kind === "spk" ? roomEdit.speakers !== undefined : kind === "lyr" ? roomEdit.lyricAnchors !== undefined : true;
      if (kind === "spk") {
        const s = ensureSpeakers().find((t) => t.id === id);
        if (s) s.pos = [x, y];
      } else if (kind === "cam") {
        const c = roomEdit.cameras?.find((t) => t.name === id);
        if (c && part === "aim") c.target = [x, y, c.target[2]];
        else if (c) c.pos = [x, y, c.pos[2]];
      } else if (kind === "lyr") {
        const a = ensureAnchors();
        if (a[id]) a[id] = [x, y, a[id]![2]];
      }
      roomChanged(!wasOwn); // the first drag turns the base's layout into the room's own: show that
    },
    (key) => {
      selRoomItem = key;
      drawRoomPlan();
    },
  );

  /** editing the speakers turns the base's layout into the room's own */
  function ensureSpeakers(): RoomSpeaker[] {
    if (!roomEdit!.speakers) roomEdit!.speakers = structuredClone(baseSpeakers(roomEdit!.base, roomEdit!.stage ?? false));
    return roomEdit!.speakers;
  }
  function ensureAnchors(): Record<string, Vec3> {
    if (!roomEdit!.lyricAnchors) roomEdit!.lyricAnchors = structuredClone(baseLyricAnchors(roomEdit!.base));
    return roomEdit!.lyricAnchors;
  }

  function drawRoomPlan(): void {
    const items: PlanItem[] = [{ key: "hero", kind: "hero", x: 0, y: 0, w: 0.43, d: 0.37, color: "#e0e0e0", label: "hero", draggable: false }];
    if (roomEdit) {
      const eff = effectiveRoom(roomEdit);
      for (const s of eff.speakers) {
        const [w, dd] = SPEAKER_FOOTPRINT[s.model] ?? [0.4, 0.4];
        items.push({ key: `spk:${s.id}`, kind: "speaker", x: s.pos[0], y: s.pos[1], w, d: dd, yaw: s.yaw, color: "#b0b8c4", label: `${s.id} ${s.model}`, draggable: true });
      }
      for (const c of eff.cameras) items.push({ key: `cam:${c.name}`, kind: "camera", x: c.pos[0], y: c.pos[1], aim: [c.target[0], c.target[1]], color: "#4fd1c5", label: `${c.name} ${c.lens}mm`, draggable: true });
      for (const [name, p] of Object.entries(eff.lyricAnchors)) items.push({ key: `lyr:${name}`, kind: "anchor", x: p[0], y: p[1], color: "#e6c84a", label: `lyric ${name}`, draggable: true });
    }
    roomPlan.setItems(items, selRoomItem);
  }

  function roomChanged(rerender = true): void {
    if (!roomEdit) return;
    roomHint.textContent = `${roomEdit.name} — edited, not saved`;
    if (rerender) renderRoomForm();
    else syncRoomValues();
    drawRoomPlan();
    drawRigPlan();
  }

  function syncRoomValues(): void {
    roomForm.querySelectorAll<HTMLInputElement>("input[data-bind]").forEach((i) => {
      const v = Number(i.dataset["bind"] && readBind(i.dataset["bind"]));
      if (Number.isFinite(v) && document.activeElement !== i) i.value = r3(v);
    });
  }
  function readBind(bind: string): number | undefined {
    const [kind, id, field, k] = bind.split(":");
    if (!roomEdit) return undefined;
    if (kind === "spk") {
      const s = roomEdit.speakers?.find((t) => t.id === id);
      return s ? (field === "pos" ? s.pos[Number(k)] : undefined) : undefined;
    }
    if (kind === "cam") {
      const c = roomEdit.cameras?.find((t) => t.name === id);
      return c ? (field === "pos" ? c.pos : c.target)[Number(k)] : undefined;
    }
    if (kind === "lyr") return roomEdit.lyricAnchors?.[id!]?.[Number(k)];
    return undefined;
  }
  const bind = (el: HTMLInputElement, key: string): HTMLInputElement => {
    el.dataset["bind"] = key;
    return el;
  };

  function triState(value: boolean | undefined, baseValue: boolean, onChange: (v: boolean | undefined) => void, title: string): HTMLSelectElement {
    return select(
      [
        { value: "", label: `base (${baseValue ? "on" : "off"})` },
        { value: "on", label: "on" },
        { value: "off", label: "off" },
      ],
      value === undefined ? "" : value ? "on" : "off",
      (v) => onChange(v === "" ? undefined : v === "on"),
      title,
    );
  }

  function section(title: string, ...rows: Node[]): HTMLDivElement {
    const g = document.createElement("div");
    g.className = "lane";
    const t = document.createElement("div");
    t.className = "name";
    t.textContent = title;
    const body = document.createElement("div");
    body.className = "faders studiolist";
    body.append(...rows);
    g.append(t, body);
    return g;
  }

  function renderRoomForm(): void {
    roomForm.replaceChildren();
    roomSaveBtn.disabled = !roomEdit;
    roomSaveAsBtn.disabled = !roomEdit;
    if (!roomEdit) return;
    const room = roomEdit;
    const desc = document.createElement("input");
    desc.type = "text";
    desc.value = room.description;
    desc.style.width = "30em";
    desc.addEventListener("change", () => {
      room.description = desc.value;
      roomChanged(false);
    });
    const rigNames = Object.keys(d.rigs()).sort();
    roomForm.append(
      section(
        "room",
        row(
          "base ",
          select(ROOM_BASES, room.base, (v) => {
            room.base = v as RoomBase;
            roomChanged();
          }, "the set it builds on"),
          " walls ",
          triState(room.walls, room.base === "concrete", (v) => {
            if (v === undefined) delete room.walls;
            else room.walls = v;
            roomChanged();
          }, "the room corner walls"),
          " stage ",
          triState(room.stage, false, (v) => {
            if (v === undefined) delete room.stage;
            else room.stage = v;
            roomChanged();
          }, "the full stage: truss, moving heads, lasers, projectors, blinders and the wide cameras"),
          " default rig ",
          select([{ value: "", label: "none" }, ...rigNames.map((n) => ({ value: n }))], room.rig ?? "", (v) => {
            if (v) room.rig = v;
            else delete room.rig;
            roomChanged(false);
          }, "the rig a reel in this room uses when it picks none"),
        ),
        row("description ", desc),
      ),
    );

    // speakers
    const spkRows: Node[] = [];
    const custom = room.speakers !== undefined;
    const toggle = document.createElement("label");
    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.checked = custom;
    chk.addEventListener("change", () => {
      if (chk.checked) ensureSpeakers();
      else delete room.speakers;
      roomChanged();
    });
    toggle.append(chk, " own layout (off: the base's)");
    spkRows.push(row(toggle, button("+ speaker", () => {
      const list = ensureSpeakers();
      const model = SPEAKER_MODELS[0]!;
      const id = freeId(list.map((s) => s.id), "S");
      list.push({ id, model, pos: [0.8, 0], yaw: 0, mount: "floor" });
      selRoomItem = `spk:${id}`;
      roomChanged();
    }, "add a speaker beside the hero")));
    for (const s of effectiveRoom(room).speakers) {
      const editable = custom;
      const mountKind = typeof s.mount === "number" ? "height" : s.mount;
      const setS = (fn: (t: RoomSpeaker) => void, rerender = false): void => {
        const t = ensureSpeakers().find((x) => x.id === s.id);
        if (t) fn(t);
        roomChanged(rerender);
      };
      const r = row(
        `${s.id} `,
        select(SPEAKER_MODELS.map((m) => ({ value: m })), s.model, (v) => setS((t) => (t.model = v), true), "kit in blender/kits/"),
        " x ",
        bind(numInput(s.pos[0], 0.01, (v) => setS((t) => (t.pos = [v, t.pos[1]]))), `spk:${s.id}:pos:0`),
        " y ",
        bind(numInput(s.pos[1], 0.01, (v) => setS((t) => (t.pos = [t.pos[0], v]))), `spk:${s.id}:pos:1`),
        " yaw ",
        numInput(s.yaw, 1, (v) => setS((t) => (t.yaw = v)), "degrees, + turns the baffle to the right", 52),
        " ",
        select([{ value: "stand" }, { value: "floor" }, { value: "height", label: "height…" }], mountKind, (v) => setS((t) => (t.mount = (v === "height" ? 0.3 : v) as Mount), true), "how it stands"),
        ...(typeof s.mount === "number" ? [numInput(s.mount, 0.01, (v) => setS((t) => (t.mount = Math.max(0, v))), "metres above the floor", 58)] : []),
        button("×", () => {
          room.speakers = ensureSpeakers().filter((t) => t.id !== s.id);
          roomChanged();
        }, "remove"),
      );
      if (!editable) r.querySelectorAll("input,select,button").forEach((e) => ((e as HTMLInputElement).disabled = true));
      spkRows.push(r);
    }
    roomForm.append(section("speakers", ...spkRows));

    // cameras
    const camRows: Node[] = [
      row(
        button("+ camera", () => {
          room.cameras ??= [];
          let n = 9;
          while (room.cameras.some((c) => c.name === `Cam${n}_Custom`)) n++;
          const c: RoomCamera = { name: `Cam${n}_Custom`, pos: [0.6, -1.8, 0.3], target: [0, -0.18, 0], lens: 35, fstop: 2.8, move: [0, 0, 0] };
          room.cameras.push(c);
          selRoomItem = `cam:${c.name}`;
          roomChanged();
        }, "a new shot; it joins the cuts after the built-in shots"),
        document.createTextNode(" the built-in cameras come with the base; these are added"),
      ),
    ];
    for (const c of room.cameras ?? []) {
      const setC = (fn: (t: RoomCamera) => void): void => {
        fn(c);
        roomChanged(false);
      };
      const name = document.createElement("input");
      name.type = "text";
      name.value = c.name;
      name.style.width = "110px";
      name.addEventListener("change", () => {
        const next = name.value.trim();
        if (!/^Cam[A-Za-z0-9_]+$/.test(next) || room.cameras!.some((o) => o !== c && o.name === next)) {
          d.status("Camera names start with Cam (letters, digits, _) and are unique.", true);
          name.value = c.name;
          return;
        }
        c.name = next;
        roomChanged();
      });
      const pos = vecInputs(c.pos, (v) => setC((t) => (t.pos = v)), "camera position");
      pos.forEach((i, k) => bind(i, `cam:${c.name}:pos:${k}`));
      const tgt = vecInputs(c.target, (v) => setC((t) => (t.target = v)), "looks at");
      tgt.forEach((i, k) => bind(i, `cam:${c.name}:target:${k}`));
      camRows.push(
        row(
          name,
          " at ",
          ...pos,
          " looks at ",
          ...tgt,
          " lens ",
          numInput(c.lens, 1, (v) => setC((t) => (t.lens = v)), "focal length, mm", 52),
          " f/",
          numInput(c.fstop, 0.1, (v) => setC((t) => (t.fstop = v)), "aperture", 52),
          " move ",
          ...vecInputs(c.move, (v) => setC((t) => (t.move = v)), "travel over each shot"),
          button("×", () => {
            room.cameras = room.cameras!.filter((t) => t !== c);
            if (!room.cameras.length) delete room.cameras;
            roomChanged();
          }, "remove"),
        ),
      );
    }
    roomForm.append(section("cameras", ...camRows));

    // lyric anchors
    const lyrRows: Node[] = [];
    const ownAnchors = room.lyricAnchors !== undefined;
    const lt = document.createElement("label");
    const lc = document.createElement("input");
    lc.type = "checkbox";
    lc.checked = ownAnchors;
    lc.addEventListener("change", () => {
      if (lc.checked) ensureAnchors();
      else delete room.lyricAnchors;
      roomChanged();
    });
    lt.append(lc, " own anchors (off: the base's)");
    lyrRows.push(
      row(
        lt,
        button("+ anchor", () => {
          const a = ensureAnchors();
          const name = freeId(Object.keys(a), "spot");
          a[name] = [0, 0.6, 0.4];
          selRoomItem = `lyr:${name}`;
          roomChanged();
        }, "a new place lyric lines can sit"),
      ),
    );
    for (const [name, p] of Object.entries(effectiveRoom(room).lyricAnchors)) {
      const ins = vecInputs(p, (v) => {
        ensureAnchors()[name] = v;
        roomChanged(false);
      }, `anchor ${name}`);
      ins.forEach((i, k) => bind(i, `lyr:${name}:p:${k}`));
      const r = row(`${name} `, ...ins, button("×", () => {
        const a = ensureAnchors();
        delete a[name];
        roomChanged();
      }, "remove"));
      if (!ownAnchors) r.querySelectorAll("input,button").forEach((e) => ((e as HTMLInputElement).disabled = true));
      lyrRows.push(r);
    }
    roomForm.append(section("lyric anchors", ...lyrRows));
  }

  function loadRoom(room: Room): void {
    roomEdit = structuredClone(room);
    selRoomItem = null;
    roomHint.textContent = `${room.name} (base ${room.base})${room.description ? ` — ${room.description}` : ""}`;
    renderRoomForm();
    drawRoomPlan();
    drawRigPlan();
  }

  $<HTMLButtonElement>("roomLoad").addEventListener("click", () => {
    const name = d.sceneSel.value;
    const room = d.rooms()[name] ?? STARTER_ROOMS.find((r) => r.name === name);
    if (!room) {
      d.status(`No room file for ${name} — link the excursion folder to read presets/rooms/.`, true);
      return;
    }
    loadRoom(room);
  });
  $<HTMLButtonElement>("roomNew").addEventListener("click", () => {
    const name = askName("room", `${roomBaseNew.value}-2`, d.status);
    if (!name) return;
    loadRoom({ kind: "room", name, description: "", base: roomBaseNew.value as RoomBase });
    roomHint.textContent = `${name} — new, not saved`;
  });
  async function saveRoom(name: string): Promise<void> {
    if (!roomEdit) return;
    try {
      const room = parseRoom({ ...structuredClone(roomEdit), name } as unknown as Record<string, unknown>);
      const where = await d.writePreset(room);
      roomEdit = room;
      refresh();
      d.sceneSel.value = name;
      d.sceneSel.dispatchEvent(new Event("change"));
      roomHint.textContent = `${name} saved — the reel uses it`;
      d.status(`Room ${name} written to ${where}. The next Preview frame, Live frame or Render builds blender/scenes/${name}.blend first (a minute or so).`);
    } catch (e) {
      d.status(`Save room: ${e instanceof Error ? e.message : String(e)}`, true);
    }
  }
  roomSaveBtn.addEventListener("click", () => roomEdit && void saveRoom(roomEdit.name));
  roomSaveAsBtn.addEventListener("click", () => {
    if (!roomEdit) return;
    const name = askName("room", `${roomEdit.name}-2`, d.status);
    if (name) void saveRoom(name);
  });

  // ---------- pickers ----------
  function refresh(): void {
    const rigs = Object.keys(d.rigs()).sort();
    d.fillSelect(rigPick, rigs.length ? rigs.map((n) => ({ value: n, label: n })) : [{ value: "", label: "no rigs yet" }], rigPick.value);
    const keepRig = d.rigSel.value;
    d.fillSelect(d.rigSel, [{ value: "", label: "room default", title: "the room's own lights, plus its default rig if it names one" }, ...rigs.map((n) => ({ value: n, label: n }))], keepRig);
    if (rigEdit && !rigs.includes(rigEdit.name) && rigDirty) {
      // an unsaved new rig can still be used: it rides in the drive inline
      const o = document.createElement("option");
      o.value = rigEdit.name;
      o.textContent = `${rigEdit.name} (unsaved)`;
      d.rigSel.append(o);
      if (keepRig === rigEdit.name) d.rigSel.value = keepRig;
    }
    const keepScene = d.sceneSel.value;
    const scenes = new Set<string>([...ROOM_BASES.map((b) => b.value), ...Object.keys(d.rooms())]);
    d.fillSelect(
      d.sceneSel,
      [...scenes].sort().map((n) => ({ value: n, label: n, title: d.rooms()[n]?.description })),
      keepScene,
    );
    drawRigPlan();
  }

  d.sceneSel.addEventListener("change", () => drawRigPlan());
  d.rigSel.addEventListener("change", () => {
    const rig = d.rigs()[d.rigSel.value];
    if (rig && (!rigEdit || (rigEdit.name !== rig.name && !rigDirty))) loadRig(rig);
    d.changed();
  });
  renderRigList();
  renderRoomForm();
  drawRigPlan();
  drawRoomPlan();

  return {
    currentRig(): Rig | undefined {
      const name = d.rigSel.value;
      if (!name) return undefined;
      if (rigEdit && rigEdit.name === name) return structuredClone(rigEdit);
      return d.rigs()[name];
    },
    refresh,
  };
}
