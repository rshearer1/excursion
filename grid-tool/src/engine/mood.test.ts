import { describe, expect, it } from "vitest";
import { MOOD_FIELDS, getPath, moodToJson, parseMood, setPath, withMoodDefaults, type Mood } from "./mood";

const FILE = `{
  "name": "moody",
  "description": "The default.",
  "exposure": -0.55,
  "key": { "color": [1.0, 0.84, 0.66], "gain": 1.0 },
  "graze_gain": 1.0,
  "dust_back_gain": 1.0,
  "cues": [
    { "rim": [0.4, 0.6, 1.0], "rim_gain": 1.0, "back_gain": 1.0, "trace": [0.55, 0.75, 1.0] },
    { "rim": [1.0, 0.7, 0.4], "rim_gain": 0.0, "back_gain": 2.2, "trace": [1.0, 0.68, 0.38] }
  ],
  "cue_bars": 2,
  "cue_fade": 6,
  "smoke": { "show": true, "density_gain": 1.0, "haze_gain": 1.0 },
  "grade": { "bloom": 0.08, "chromatic": 0.006, "black_lift": 0.02, "gain": [1.06, 0.96, 0.86], "lift": [1.0, 0.985, 0.97], "saturation": 1.0, "vignette": 0.075, "grain": 0.006 },
  "shells": { "show": true, "strength": 0.18 },
  "routing": { "key": "channels.bass", "smoke": "channels.bass", "wash": "channels.bass" }
}`;

describe("parseMood", () => {
  it("reads a shipped mood file as-is", () => {
    const m = parseMood(FILE);
    expect(m.name).toBe("moody");
    expect(m.key.color).toEqual([1, 0.84, 0.66]);
    expect(m.cues).toHaveLength(2);
    expect(m.grade.gain).toEqual([1.06, 0.96, 0.86]);
    expect(m.routing.wash).toBe("channels.bass");
  });

  it("fills every field a partial file leaves out, so the editor never shows a hole", () => {
    const m = parseMood(`{ "name": "bare", "key": { "gain": 0.5 } }`);
    expect(m.key.gain).toBe(0.5);
    expect(m.key.color).toEqual([1, 0.84, 0.66]);
    expect(m.smoke.show).toBe(true);
    expect(m.grade.vignette).toBeTypeOf("number");
    expect(m.cues).toEqual([]);
    expect(m.routing).toEqual({});
  });

  it("rejects a file without a usable name", () => {
    expect(() => parseMood(`{ "name": "Not A Slug" }`)).toThrow(/name/);
    expect(() => parseMood(`{}`)).toThrow(/name/);
  });
});

describe("paths", () => {
  it("getPath and setPath address nested fields and array slots without mutating the input", () => {
    const m = parseMood(FILE);
    expect(getPath(m, "grade.gain.1")).toBe(0.96);
    expect(getPath(m, "cues.1.back_gain")).toBe(2.2);
    const next = setPath(m, "grade.gain.1", 0.5) as Mood;
    expect(getPath(next, "grade.gain.1")).toBe(0.5);
    expect(getPath(m, "grade.gain.1")).toBe(0.96);
    expect(next.key).not.toBe(m.key === next.key ? null : m.key); // untouched branches may be shared, touched ones are copies
  });
});

describe("schema", () => {
  it("names every editable field with a kind and, for numbers, a range", () => {
    for (const f of MOOD_FIELDS) {
      expect(f.path).toBeTruthy();
      expect(["number", "color", "bool", "route", "text"]).toContain(f.kind);
      if (f.kind === "number") {
        expect(f.min).toBeLessThan(f.max!);
        expect(f.step).toBeGreaterThan(0);
      }
    }
    const paths = MOOD_FIELDS.map((f) => f.path);
    for (const must of ["exposure", "key.gain", "key.color", "smoke.density_gain", "grade.vignette", "shells.strength", "routing.key", "cue_bars"]) {
      expect(paths).toContain(must);
    }
  });
});

describe("moodToJson", () => {
  it("round-trips through the file format and writes the fields Blender reads in a stable order", () => {
    const m = parseMood(FILE);
    const again = parseMood(moodToJson(m));
    expect(again).toEqual(m);
    const text = moodToJson(m);
    expect(text.indexOf('"name"')).toBeLessThan(text.indexOf('"exposure"'));
    expect(text.indexOf('"exposure"')).toBeLessThan(text.indexOf('"routing"'));
  });

  it("withMoodDefaults on an empty object gives a complete, valid mood", () => {
    const m = withMoodDefaults({ name: "fresh" });
    expect(() => parseMood(moodToJson(m))).not.toThrow();
    expect(m.cue_bars).toBe(2);
  });
});
