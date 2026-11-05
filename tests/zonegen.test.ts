import { describe, expect, it } from "vitest";
import { generateZone, reachable } from "../src/core/gen/zonegen";
import { loadZone, tileAt } from "../src/core/zone";
import { ENEMY_KINDS, GEN_CONTENT, THEMES, TILES } from "../src/data";
import { BATTLE_CONTENT, buildEncounter } from "../src/data/battle";
import { createBattle } from "../src/core/battle/engine";

const THEME_IDS = Object.keys(THEMES);
const gen = (theme: string, seed: number, depth = 1) =>
  generateZone({ id: `t${seed}`, seed, theme, depth, forwardExits: 2 }, GEN_CONTENT);

function grid(z: ReturnType<typeof gen>) {
  return { w: z.map[0]!.length, h: z.map.length, get: (x: number, y: number) => z.map[y]?.[x] };
}
const touch = (reach: Set<string>, x: number, y: number) =>
  [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => reach.has(`${x + dx!},${y + dy!}`));

describe("zone generation", () => {
  it("has at least three themes", () => {
    expect(THEME_IDS.length).toBeGreaterThanOrEqual(3);
  });

  it("is deterministic for a seed", () => {
    expect(JSON.stringify(gen("cinder", 42))).toBe(JSON.stringify(gen("cinder", 42)));
    expect(JSON.stringify(gen("cinder", 42))).not.toBe(JSON.stringify(gen("cinder", 43)));
  });

  for (const theme of THEME_IDS) {
    it(`${theme}: 40 seeds all load, fill the recipe, and keep their guarantees`, () => {
      for (let seed = 1; seed <= 40; seed++) {
        const z = gen(theme, seed, 1 + (seed % 4));
        const zone = loadZone(z, TILES); // validates tiles, start, spawns, features, exits
        for (const k of ["theme", "twist", "landmark", "secret", "story"] as const) expect(z.recipe[k], k).toBeTruthy();
        expect(z.exits!.map((e) => e.id)).toEqual(["back", "exit-1", "exit-2"]);
        expect(z.map.some((row) => row.includes(THEMES[theme]!.landmark.tile)), "landmark").toBe(true);
        expect(zone.features.map((f) => f.kind).sort()).toEqual(["lore", "relic"]);

        const blocked = new Set(zone.features.map((f) => `${f.x},${f.y}`));
        const reach = reachable(grid(z), TILES, z.start.x, z.start.y, new Set(), blocked);
        for (const e of z.exits!) expect(reach.has(`${e.x},${e.y}`), `exit ${e.id}`).toBe(true);
        for (const e of z.enemies) expect(reach.has(`${e.x},${e.y}`), `enemy ${e.id}`).toBe(true);
        const lore = zone.features.find((f) => f.kind === "lore")!;
        expect(touch(reach, lore.x, lore.y), "lore reachable").toBe(true);
        expect(z.map.some((row) => row.includes("R")), "shrine").toBe(true);

        // The secret needs the theme's gate ability, and that ability is enough.
        const relic = zone.features.find((f) => f.kind === "relic")!;
        const gate = TILES[THEMES[theme]!.gate]!.gate!;
        expect(touch(reach, relic.x, relic.y), "relic sealed").toBe(false);
        const withGate = reachable(grid(z), TILES, z.start.x, z.start.y, new Set([gate]), blocked);
        expect(touch(withGate, relic.x, relic.y), "relic reachable with gate").toBe(true);
        expect(tileAt(zone, relic.x, relic.y)?.solid).toBe(false);
      }
    });
  }

  it("every generated encounter builds a battle and contains its leader", () => {
    for (const theme of THEME_IDS) {
      for (let seed = 1; seed <= 10; seed++) {
        const z = gen(theme, seed, 3);
        for (const spawn of z.enemies) {
          const enc = z.encounters![spawn.encounter!]!;
          expect(enc.foes.some((f) => f.kind === spawn.kind)).toBe(true);
          expect(enc.foes.length).toBeLessThanOrEqual(5);
          const s = createBattle(buildEncounter(enc), BATTLE_CONTENT, seed);
          expect(s.units.filter((u) => u.side === "foe")).toHaveLength(enc.foes.length);
          expect(ENEMY_KINDS[spawn.kind]?.battle).toBeDefined();
        }
      }
    }
  });

  it("deeper zones have bigger encounter budgets", () => {
    const cost = (depth: number) => {
      let total = 0;
      for (let seed = 1; seed <= 20; seed++) {
        const z = gen("crypt", seed, depth);
        for (const e of Object.values(z.encounters!)) for (const f of e.foes) total += GEN_CONTENT.foeCost[f.kind]!;
      }
      return total;
    };
    expect(cost(4)).toBeGreaterThan(cost(1));
  });
});
