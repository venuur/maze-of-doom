import { describe, expect, it } from "vitest";
import { loadZone, type ZoneData } from "../src/core/zone";
import { createWorld, movePlayer, stepEnemies, type EnemyKind } from "../src/core/world";
import { ENEMY_KINDS, TILES, getZone } from "../src/data";

const kinds: Record<string, EnemyKind> = {
  roamer: { name: "R", shape: "blob", color: "#fff", behavior: "wander", radius: 2 },
  statue: { name: "S", shape: "square", color: "#fff", behavior: "still", radius: 0 },
};

function zoneOf(map: string[], start = { x: 1, y: 1 }, enemies: ZoneData["enemies"] = []) {
  return loadZone(
    { id: "t", name: "T", recipe: { theme: "", twist: "", landmark: "", secret: "", story: "" }, start, map, enemies },
    TILES,
  );
}

describe("player movement", () => {
  const map = ["#####", "#..~#", "#...#", "#..E#", "#####"];

  it("moves onto open tiles and updates facing", () => {
    const w = createWorld(zoneOf(map), kinds, 1);
    const ev = movePlayer(w, "right");
    expect(ev).toEqual([{ type: "moved", who: "player", fromX: 1, fromY: 1 }]);
    expect(w.player).toMatchObject({ x: 2, y: 1, facing: "right" });
  });

  it("is blocked by walls but still turns to face them", () => {
    const w = createWorld(zoneOf(map), kinds, 1);
    expect(movePlayer(w, "up")).toEqual([{ type: "blocked" }]);
    expect(w.player).toMatchObject({ x: 1, y: 1, facing: "up" });
  });

  it("is blocked by lava until the party has float", () => {
    const w = createWorld(zoneOf(map, { x: 2, y: 1 }), kinds, 1);
    expect(movePlayer(w, "right")[0]?.type).toBe("blocked");
    w.abilities.add("float");
    expect(movePlayer(w, "right")[0]?.type).toBe("moved");
    expect(w.player.x).toBe(3);
  });

  it("reports stepping on an exit", () => {
    const w = createWorld(zoneOf(map, { x: 3, y: 2 }), kinds, 1);
    const ev = movePlayer(w, "down");
    expect(ev.map((e) => e.type)).toEqual(["moved", "exit"]);
  });

  it("bumping a visible enemy starts an encounter instead of moving", () => {
    const w = createWorld(zoneOf(map, { x: 1, y: 1 }, [{ id: "s1", kind: "statue", x: 2, y: 1 }]), kinds, 1);
    expect(movePlayer(w, "right")).toEqual([{ type: "encounter", enemyId: "s1", initiator: "player" }]);
    expect(w.player.x).toBe(1);
  });
});

describe("enemy wandering", () => {
  const open = ["#########", "#.......#", "#.......#", "#.......#", "#.......#", "#.......#", "#########"];

  it("is deterministic for a given seed", () => {
    const run = (seed: number) => {
      const w = createWorld(zoneOf(open, { x: 1, y: 1 }, [{ id: "r", kind: "roamer", x: 4, y: 3 }]), kinds, seed);
      const path: string[] = [];
      for (let i = 0; i < 50; i++) {
        stepEnemies(w);
        path.push(`${w.enemies[0]!.x},${w.enemies[0]!.y}`);
      }
      return path;
    };
    expect(run(123)).toEqual(run(123));
    expect(run(123)).not.toEqual(run(456));
  });

  it("stays within its roam radius and on open tiles", () => {
    const w = createWorld(zoneOf(open, { x: 1, y: 1 }, [{ id: "r", kind: "roamer", x: 4, y: 3 }]), kinds, 9);
    w.player.x = 7; w.player.y = 5; // keep the player out of reach
    for (let i = 0; i < 500; i++) {
      stepEnemies(w);
      const e = w.enemies[0]!;
      expect(Math.max(Math.abs(e.x - 4), Math.abs(e.y - 3))).toBeLessThanOrEqual(2);
    }
  });

  it("still enemies never move", () => {
    const w = createWorld(zoneOf(open, { x: 1, y: 1 }, [{ id: "s", kind: "statue", x: 4, y: 3 }]), kinds, 9);
    for (let i = 0; i < 100; i++) expect(stepEnemies(w)).toEqual([]);
    expect(w.enemies[0]).toMatchObject({ x: 4, y: 3 });
  });

  it("an enemy walking into the player starts an encounter", () => {
    // Player boxed in next to the enemy in a 1-wide corridor: any move toward them is an encounter.
    const corridor = ["#####", "#...#", "#####"];
    const w = createWorld(zoneOf(corridor, { x: 1, y: 1 }, [{ id: "r", kind: "roamer", x: 2, y: 1 }]), kinds, 3);
    let found = false;
    for (let i = 0; i < 200 && !found; i++) {
      found = stepEnemies(w).some((e) => e.type === "encounter" && e.initiator === "enemy");
    }
    expect(found).toBe(true);
    expect(w.enemies[0]).not.toMatchObject({ x: 1, y: 1 });
  });

  it("enemies never overlap one another", () => {
    const w = createWorld(
      zoneOf(open, { x: 7, y: 5 }, [
        { id: "a", kind: "roamer", x: 3, y: 3 },
        { id: "b", kind: "roamer", x: 4, y: 3 },
        { id: "c", kind: "roamer", x: 3, y: 4 },
      ]),
      kinds,
      5,
    );
    for (let i = 0; i < 300; i++) {
      stepEnemies(w);
      const keys = new Set(w.enemies.map((e) => `${e.x},${e.y}`));
      expect(keys.size).toBe(3);
    }
  });
});

describe("shipped content", () => {
  it("the antechamber builds a world with every enemy kind known", () => {
    expect(() => createWorld(getZone("antechamber"), ENEMY_KINDS, 1)).not.toThrow();
  });
});
