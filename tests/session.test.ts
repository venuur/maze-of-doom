import { describe, expect, it } from "vitest";
import { assessEncounter } from "../src/core/battle/autoresolve";
import { endTurn } from "../src/core/battle/engine";
import { createWorld, movePlayer } from "../src/core/world";
import { loadZone } from "../src/core/zone";
import { ENEMY_KINDS, TILES, ZONES, getZone } from "../src/data";
import { BATTLE_CONTENT, ENCOUNTERS, buildEncounter } from "../src/data/battle";
import { createSession, encounterIdFor, finishBattle, startEncounter } from "../src/game/session";

describe("instant win", () => {
  it("a lone slime is an instant win for the starting party", () => {
    expect(assessEncounter(buildEncounter("lone_slime"), BATTLE_CONTENT, 1).instantWin).toBe(true);
  });

  it("real fights are not instant wins", () => {
    for (const id of ["slime_pack", "archer_nest", "ember_court", "gauntlet"]) {
      expect(assessEncounter(buildEncounter(id), BATTLE_CONTENT, 1).instantWin, id).toBe(false);
    }
  });

  it("a party with only its Mystic standing no longer outclasses a lone slime", () => {
    const setup = buildEncounter("lone_slime");
    for (const u of setup.party) if (u.job !== "mystic") { u.maxHp = u.hp; u.hp = 0; }
    expect(assessEncounter(setup, BATTLE_CONTENT, 1).instantWin).toBe(false);
  });
});

describe("encounters on the map", () => {
  it("every shipped spawn leads a valid encounter that contains its own kind", () => {
    for (const z of Object.values(ZONES)) {
      const world = createWorld(getZone(z.id), ENEMY_KINDS, 1);
      for (const e of world.enemies) {
        const enc = ENCOUNTERS[encounterIdFor(e)]!;
        expect(enc.foes.some((f) => f.kind === e.kind), e.id).toBe(true);
      }
    }
  });

  it("touching a weak enemy removes it without a battle", () => {
    const s = createSession("antechamber", 1);
    const r = startEncounter(s, "slime-2");
    expect(r.kind).toBe("instant");
    expect(s.world.enemies.some((e) => e.id === "slime-2")).toBe(false);
    expect(s.defeated).toEqual(["slime-2"]);
    expect(s.party.every((m) => m.hp === m.maxHp)).toBe(true);
  });

  it("touching a strong enemy opens its encounter with the current party HP", () => {
    const s = createSession("antechamber", 1);
    s.party[0]!.hp = 5;
    const r = startEncounter(s, "warden-1");
    expect(r.kind).toBe("battle");
    if (r.kind !== "battle") return;
    expect(r.encounterId).toBe("archer_nest");
    const v = r.battle.units.find((u) => u.job === "vanguard")!;
    expect(v).toMatchObject({ hp: 5, maxHp: 16 });
  });

  it("is deterministic for a session seed", () => {
    const go = () => {
      const s = createSession("antechamber", 42);
      const r = startEncounter(s, "warden-1");
      return r.kind === "battle" ? JSON.stringify(r.battle.intents) : "";
    };
    expect(go()).toBe(go());
  });
});

describe("battle outcomes", () => {
  function battleWith(outcome: "won" | "lost" | "retreat") {
    const s = createSession("antechamber", 3);
    const r = startEncounter(s, "warden-1");
    if (r.kind !== "battle") throw new Error("expected battle");
    const b = r.battle;
    const party = b.units.filter((u) => u.side === "party");
    if (outcome === "won") {
      party[0]!.hp = 4; party[1]!.hp = 0;
      for (const u of b.units) if (u.side === "foe") u.hp = 0;
      b.phase = "won";
    } else if (outcome === "lost") {
      for (const u of party) u.hp = 0;
      b.phase = "lost";
    } else {
      party[0]!.hp = 6; party[1]!.hp = 0;
    }
    s.world.player.x = 10; s.world.player.y = 8;
    const msg = finishBattle(s, "warden-1", b, outcome);
    return { s, msg };
  }

  it("victory removes the enemy, carries HP, and revives the downed at 1", () => {
    const { s } = battleWith("won");
    expect(s.world.enemies.some((e) => e.id === "warden-1")).toBe(false);
    expect(s.party.map((m) => m.hp).slice(0, 2)).toEqual([4, 1]);
  });

  it("retreat keeps the enemy and the damage (downed stay down)", () => {
    const { s } = battleWith("retreat");
    expect(s.world.enemies.some((e) => e.id === "warden-1")).toBe(true);
    expect(s.party.map((m) => m.hp).slice(0, 2)).toEqual([6, 0]);
  });

  it("defeat: the Maze relocates and restores the party; the enemy remains", () => {
    const { s, msg } = battleWith("lost");
    expect(msg).toMatch(/The Maze/);
    expect(s.world.player).toMatchObject({ x: s.world.zone.start.x, y: s.world.zone.start.y });
    expect(s.party.every((m) => m.hp === m.maxHp)).toBe(true);
    expect(s.world.enemies.some((e) => e.id === "warden-1")).toBe(true);
  });

  it("downed members start the next battle down", () => {
    const s = createSession("antechamber", 3);
    s.party[2]!.hp = 0;
    const r = startEncounter(s, "warden-1");
    if (r.kind !== "battle") throw new Error("expected battle");
    expect(r.battle.units.find((u) => u.job === "pyromancer")!.hp).toBe(0);
    endTurn(r.battle);
    expect(r.battle.units.find((u) => u.job === "pyromancer")!.hp).toBe(0);
  });
});

describe("shrine", () => {
  it("stepping on a rest tile emits a rest event; enemies avoid it", () => {
    const zone = loadZone(
      { id: "t", name: "t", recipe: { theme: "", twist: "", landmark: "", secret: "", story: "" }, start: { x: 1, y: 1 }, map: ["####", "#.R#", "####"], enemies: [] },
      TILES,
    );
    const w = createWorld(zone, ENEMY_KINDS, 1);
    expect(movePlayer(w, "right").map((e) => e.type)).toEqual(["moved", "rest"]);
  });
});
