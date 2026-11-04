import { describe, expect, it } from "vitest";
import { isPassable, loadZone, tileAt, type ZoneData } from "../src/core/zone";
import { TILES, ZONES, getZone } from "../src/data";

const tiny = (map: string[], extra: Partial<ZoneData> = {}): ZoneData => ({
  id: "tiny",
  name: "Tiny",
  recipe: { theme: "", twist: "", landmark: "", secret: "", story: "" },
  start: { x: 1, y: 1 },
  map,
  enemies: [],
  ...extra,
});

describe("loadZone", () => {
  it("loads every shipped zone", () => {
    for (const id of Object.keys(ZONES)) expect(() => getZone(id)).not.toThrow();
  });

  it("every shipped zone fills in the full five-part recipe", () => {
    for (const data of Object.values(ZONES)) {
      for (const [part, text] of Object.entries(data.recipe)) {
        expect(text.trim(), `${data.id}.${part}`).not.toBe("");
      }
    }
  });

  it("rejects ragged rows", () => {
    expect(() => loadZone(tiny(["###", "#.", "###"]), TILES)).toThrow(/row 1/);
  });

  it("rejects unknown tiles", () => {
    expect(() => loadZone(tiny(["###", "#?#", "###"]), TILES)).toThrow(/unknown tile/);
  });

  it("rejects a start on a solid tile", () => {
    expect(() => loadZone(tiny(["###", "###", "###"]), TILES)).toThrow(/start/);
  });

  it("rejects enemies on solid tiles", () => {
    const data = tiny(["####", "#..#", "####"], { enemies: [{ id: "e", kind: "slime", x: 0, y: 0 }] });
    expect(() => loadZone(data, TILES)).toThrow(/enemy e/);
  });
});

describe("passability", () => {
  const zone = loadZone(tiny(["#####", "#.~w#", "#####"]), TILES);

  it("blocks walls and out of bounds", () => {
    expect(isPassable(zone, 0, 0, new Set())).toBe(false);
    expect(isPassable(zone, -1, 1, new Set())).toBe(false);
    expect(tileAt(zone, 99, 99)).toBeUndefined();
  });

  it("gates lava behind float and water behind swim", () => {
    expect(isPassable(zone, 2, 1, new Set())).toBe(false);
    expect(isPassable(zone, 2, 1, new Set(["float"]))).toBe(true);
    expect(isPassable(zone, 3, 1, new Set(["float"]))).toBe(false);
    expect(isPassable(zone, 3, 1, new Set(["swim"]))).toBe(true);
  });
});
