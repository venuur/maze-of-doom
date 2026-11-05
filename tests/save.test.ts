import { describe, expect, it } from "vitest";
import { movePlayer } from "../src/core/world";
import {
  SaveError,
  deleteSlot,
  deserialize,
  exportSlot,
  importSlot,
  loadSlot,
  saveToSlot,
  serialize,
  slotSummaries,
  type KeyValueStore,
} from "../src/game/save";
import { createSession, defeatedIn, exitAt, startEncounter, travel } from "../src/game/session";

function memoryStore(): KeyValueStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

describe("zone graph", () => {
  it("the Antechamber exit generates a new zone once, linked both ways", () => {
    const s = createSession("antechamber", 5);
    const first = travel(s, "south");
    expect(first.isNew).toBe(true);
    const z1 = s.world.zone;
    expect(z1.id).toBe("z1");
    expect(z1.depth).toBe(1);
    expect(s.world.player).toMatchObject(z1.exits.find((e) => e.id === "back")!.arrive);
    const map = JSON.stringify(s.generated.z1);

    expect(travel(s, "back").isNew).toBe(false);
    expect(s.world.zone.id).toBe("antechamber");
    expect(s.world.player).toMatchObject({ x: 14, y: 22 });
    travel(s, "south");
    expect(s.world.zone.id).toBe("z1");
    expect(JSON.stringify(s.generated.z1)).toBe(map); // persisted, not regenerated
    expect(Object.keys(s.generated)).toEqual(["z1"]);
  });

  it("forward exits lead deeper, to different themes than here", () => {
    const s = createSession("antechamber", 5);
    travel(s, "south");
    const theme = s.world.zone.theme;
    travel(s, "exit-1");
    expect(s.world.zone).toMatchObject({ id: "z2", depth: 2 });
    expect(s.world.zone.theme).not.toBe(theme);
  });

  it("the same master seed builds the same world", () => {
    const go = () => {
      const s = createSession("antechamber", 77);
      travel(s, "south");
      travel(s, "exit-1");
      return JSON.stringify(s.generated);
    };
    expect(go()).toBe(go());
  });

  it("defeated enemies stay defeated after leaving and coming back", () => {
    const s = createSession("antechamber", 5);
    startEncounter(s, "slime-2"); // instant win
    travel(s, "south");
    travel(s, "back");
    expect(s.world.enemies.some((e) => e.id === "slime-2")).toBe(false);
    expect(defeatedIn(s, "antechamber")).toEqual(["slime-2"]);
  });

  it("stepping on an exit tile reports it; exitAt finds which", () => {
    const s = createSession("antechamber", 5);
    s.world.player.x = 14; s.world.player.y = 22;
    expect(movePlayer(s.world, "down").map((e) => e.type)).toContain("exit");
    expect(exitAt(s, 14, 23)?.id).toBe("south");
  });
});

describe("saves", () => {
  function played() {
    const s = createSession("antechamber", 9);
    startEncounter(s, "slime-2");
    s.discovered.add("lancer");
    s.party[0]!.hp = 7;
    travel(s, "south");
    s.world.player.x = s.world.zone.start.x;
    return s;
  }

  it("round-trips a session exactly", () => {
    const s = played();
    const a = serialize(s, 1);
    const b = serialize(deserialize(JSON.parse(JSON.stringify(a))), 1);
    expect(b).toEqual(a);
  });

  it("a loaded game continues identically (same RNG, same zones)", () => {
    const s = played();
    const copy = deserialize(JSON.parse(JSON.stringify(serialize(s))));
    travel(s, "exit-1");
    travel(copy, "exit-1");
    expect(JSON.stringify(serialize(copy, 1))).toBe(JSON.stringify(serialize(s, 1)));
  });

  it("several slots, independent", () => {
    const store = memoryStore();
    const a = played();
    const b = createSession("antechamber", 1);
    saveToSlot(store, 1, a, 100);
    saveToSlot(store, 2, b, 200);
    const sums = slotSummaries(store);
    expect(sums).toHaveLength(3);
    expect(sums[0]).toMatchObject({ slot: 1, zonesVisited: 2, savedAt: 100 });
    expect(sums[1]).toMatchObject({ slot: 2, zoneName: "The Antechamber", zonesVisited: 1 });
    expect(sums[2]).toBeNull();
    expect(loadSlot(store, 1)!.world.zone.id).toBe("z1");
    expect(loadSlot(store, 2)!.world.zone.id).toBe("antechamber");
    deleteSlot(store, 1);
    expect(loadSlot(store, 1)).toBeNull();
    expect(loadSlot(store, 2)).not.toBeNull();
  });

  it("export and import move a save between slots", () => {
    const store = memoryStore();
    saveToSlot(store, 1, played(), 100);
    importSlot(store, 3, exportSlot(store, 1)!);
    expect(slotSummaries(store)[2]).toMatchObject({ slot: 3, zonesVisited: 2, savedAt: 100 });
  });

  it("rejects things that aren't saves", () => {
    const store = memoryStore();
    expect(() => importSlot(store, 1, "not json")).toThrow(SaveError);
    expect(() => importSlot(store, 1, "{}")).toThrow(SaveError);
    expect(() => importSlot(store, 1, JSON.stringify({ game: "maze-of-doom", version: 99 }))).toThrow(/version/);
    expect(store.map.size).toBe(0);
  });
});
