import { describe, expect, it } from "vitest";
import { createBattle, endTurn, getUnit, useSkill } from "../src/core/battle/engine";
import type { BattleState, Tile } from "../src/core/battle/types";
import { considerHabit, newMazeState, takeCounter, templateVoice } from "../src/core/maze/maze";
import { dominantHabit, emptyProfile, recordBattle, recordInstantWin } from "../src/core/maze/profile";
import { MAZE, MAZE_VOICE } from "../src/data";
import { BATTLE_CONTENT, SKILLS, buildEncounter, encounterXp } from "../src/data/battle";
import { deserialize, serialize } from "../src/game/save";
import { createSession, finishBattle, startEncounter, travel } from "../src/game/session";

/** A finished battle whose log says the party dealt `amount` of `element` with `skillId`. */
function fought(element: string, amount: number, skillId: string, uses = 3): BattleState {
  const b = createBattle(buildEncounter("lone_slime"), BATTLE_CONTENT, 1);
  const pid = b.units.find((u) => u.side === "party")!.id;
  for (let i = 0; i < uses; i++) b.log.push({ type: "skill", unitId: pid, skillId });
  b.log.push({ type: "damage", unitId: "slime-1", amount, sourceId: pid, element });
  return b;
}

describe("strategy profile", () => {
  it("records damage by element, skills, jobs and displacement from the battle log", () => {
    const p = emptyProfile();
    recordBattle(p, fought("fire", 10, "firebolt"));
    recordBattle(p, fought("physical", 2, "shunt"));
    expect(p.battles).toBe(2);
    expect(p.damage.fire).toBeCloseTo(10 * 0.85);
    expect(p.damage.physical).toBe(2);
    expect(p.skills.firebolt).toBeGreaterThan(0);
    expect(p.displacement).toBe(3);
    expect(Object.keys(p.jobs).sort()).toEqual(["mystic", "pyromancer", "vanguard"]);
  });

  it("collisions and foe damage don't count as the party's style", () => {
    const p = emptyProfile();
    const b = fought("fire", 5, "firebolt");
    b.log.push({ type: "damage", unitId: "wren", amount: 9, sourceId: "slime-1", element: "physical" });
    b.log.push({ type: "damage", unitId: "slime-1", amount: 9, sourceId: null, element: "impact" });
    recordBattle(p, b);
    expect(p.damage).toEqual({ fire: 5 });
  });

  it("names a habit only with enough evidence", () => {
    const p = emptyProfile();
    recordBattle(p, fought("fire", 20, "firebolt"));
    recordBattle(p, fought("fire", 20, "firebolt"));
    expect(dominantHabit(p)).toBeNull(); // too few battles
    recordBattle(p, fought("fire", 20, "firebolt"));
    expect(dominantHabit(p)).toMatchObject({ tactic: "fire" });
  });

  it("balanced play isn't a habit; recent play outweighs old play", () => {
    const p = emptyProfile();
    for (const el of ["fire", "physical", "arcane", "fire", "physical", "arcane"]) recordBattle(p, fought(el, 10, "strike", 1));
    expect(dominantHabit(p)).toBeNull();
    for (let i = 0; i < 6; i++) recordBattle(p, fought("physical", 10, "strike", 1));
    expect(dominantHabit(p)?.tactic).toBe("physical");
  });

  it("detects pushing things around and turtling", () => {
    const shove = emptyProfile();
    for (let i = 0; i < 4; i++) recordBattle(shove, fought("physical", 1, "hook", 3));
    // Damage is too low to be an element habit; displacement is the habit.
    expect(dominantHabit(shove)?.tactic).toBe("displacement");
    const turtle = emptyProfile();
    for (let i = 0; i < 4; i++) recordBattle(turtle, fought("physical", 1, "brace", 3));
    expect(dominantHabit(turtle)?.tactic).toBe("defense");
  });

  it("instant wins count as battles but teach nothing else", () => {
    const p = emptyProfile();
    recordInstantWin(p);
    expect(p).toMatchObject({ battles: 1, damage: {}, skillUses: 0, avgRounds: 0 });
    const b = fought("fire", 1, "firebolt");
    b.round = 4;
    recordBattle(p, b);
    expect(p.avgRounds).toBe(4);
  });
});

describe("the Maze: telegraph, then counter", () => {
  function fireMaze() {
    const m = newMazeState();
    for (let i = 0; i < 3; i++) recordBattle(m.profile, fought("fire", 20, "firebolt"));
    return m;
  }

  it("names the habit first, and only then arms a counter", () => {
    const m = fireMaze();
    expect(takeCounter(m)).toBeNull(); // nothing said yet, nothing built
    const line = considerHabit(m, MAZE, MAZE_VOICE, 1, 3);
    expect(line).toMatch(/^The Maze: "/);
    expect(m.armed).toBe("fire");
    expect(m.said).toHaveLength(1);
    expect(takeCounter(m)).toBe("fire");
    expect(m.built.fire).toBe(1);
    expect(takeCounter(m)).toBeNull(); // spent
  });

  it("waits out a cooldown before naming again", () => {
    const m = fireMaze();
    considerHabit(m, MAZE, MAZE_VOICE, 1, 3);
    takeCounter(m);
    expect(considerHabit(m, MAZE, MAZE_VOICE, 1, 4)).toBeNull();
    expect(considerHabit(m, MAZE, MAZE_VOICE, 1, 3 + MAZE.noticeCooldown)).not.toBeNull();
  });

  it("the template voice is deterministic and fills placeholders", () => {
    const v = templateVoice(MAZE);
    const a = considerHabit(fireMaze(), MAZE, v, 9, 3);
    const b = considerHabit(fireMaze(), MAZE, v, 9, 3);
    expect(a).toBe(b);
    expect(a).not.toMatch(/\{share\}|\{counter\}|\{zone\}/);
  });

  it("every tactic has a counter and lines", () => {
    for (const t of ["fire", "physical", "displacement", "defense"] as const) {
      expect(MAZE.counters[t]).toBeDefined();
      expect(MAZE.notice[t].length).toBeGreaterThan(0);
      expect(MAZE.arrive[t].length).toBeGreaterThan(0);
    }
  });
});

describe("counter zones in a session", () => {
  function armedSession() {
    const s = createSession("antechamber", 11);
    for (let i = 0; i < 3; i++) recordBattle(s.maze.profile, fought("fire", 20, "firebolt"));
    s.battlesFought = 3;
    expect(considerHabit(s.maze, MAZE, MAZE_VOICE, s.seed, 3)).not.toBeNull();
    return s;
  }

  it("the next new zone is built against the named habit, and says so", () => {
    const s = armedSession();
    const r = travel(s, "south");
    expect(r.counter).toBe("fire");
    expect(r.message).toMatch(/Fireproof/);
    expect(r.message).toMatch(/The Maze: "/);
    expect(s.world.zone.counter).toBe("fire");
    expect(s.maze.armed).toBeNull();
  });

  it("counter-zone foes resist the habit, and pay better", () => {
    const s = armedSession();
    travel(s, "south");
    const z = s.world.zone;
    const enc = z.encounters[z.spawns[0]!.encounter!]!;
    expect(enc.xpMult).toBe(MAZE.counterXp);
    const plain = { ...enc, xpMult: undefined, mods: undefined };
    const countered = createBattle(buildEncounter(enc), BATTLE_CONTENT, 1).units.filter((u) => u.side === "foe");
    const base = createBattle(buildEncounter(plain), BATTLE_CONTENT, 1).units.filter((u) => u.side === "foe");
    countered.forEach((f, i) => expect(f.resist.fire ?? 1).toBeCloseTo((base[i]!.resist.fire ?? 1) * 0.25));
    expect(encounterXp(enc)).toBe(Math.round(encounterXp(plain) * MAZE.counterXp));
    const relic = z.features.find((f) => f.kind === "relic")!;
    expect(relic.xp).toBe((10 + z.depth * 4) * MAZE.counterRelicXp);
  });

  it("without a named habit, new zones are ordinary", () => {
    const s = createSession("antechamber", 11);
    expect(travel(s, "south").counter).toBeUndefined();
    expect(s.world.zone.counter).toBeUndefined();
  });

  it("the Maze's memory survives a save", () => {
    const s = armedSession();
    const t = deserialize(JSON.parse(JSON.stringify(serialize(s))));
    expect(t.maze.armed).toBe("fire");
    expect(t.maze.said).toEqual(s.maze.said);
    expect(t.maze.profile.damage.fire).toBeCloseTo(s.maze.profile.damage.fire!);
    expect(travel(t, "south").counter).toBe("fire");
  });

  it("old saves without a Maze load with a fresh one", () => {
    const s = createSession("antechamber", 2);
    const data = JSON.parse(JSON.stringify(serialize(s)));
    delete data.maze;
    expect(deserialize(data).maze.armed).toBeNull();
  });

  it("a fought battle feeds the profile; a defeat speaks in the Maze's voice", () => {
    const s = createSession("antechamber", 3);
    const r = startEncounter(s, "warden-1");
    if (r.kind !== "battle") throw new Error("expected battle");
    for (const u of r.battle.units) if (u.side === "party") u.hp = 0;
    r.battle.phase = "lost";
    const msg = finishBattle(s, "warden-1", r.battle, "lost");
    expect(s.maze.profile.battles).toBe(1);
    expect(msg).toMatch(/^The Maze: "/);
    expect(s.maze.said).toHaveLength(1);
  });
});

describe("reclaiming cleared zones", () => {
  it("a cleared generated zone fills up again after enough battles elsewhere", () => {
    const s = createSession("antechamber", 4);
    travel(s, "south");
    const id = s.world.zone.id;
    const before = s.world.enemies.map((e) => e.id);
    // Clear it.
    for (const e of [...s.world.enemies]) {
      const r = startEncounter(s, e.id);
      if (r.kind === "battle") {
        for (const u of r.battle.units) if (u.side === "foe") u.hp = 0;
        r.battle.phase = "won";
        finishBattle(s, e.id, r.battle, "won");
      }
    }
    expect(s.world.enemies).toHaveLength(0);
    expect(s.zoneStates[id]!.clearedAt).toBeDefined();
    travel(s, "back");
    expect(travel(s, "south").reclaimed).toBe(false); // too soon
    travel(s, "back");
    s.battlesFought += MAZE.reclaimAfter;
    const r = travel(s, "south");
    expect(r.reclaimed).toBe(true);
    expect(r.message).toMatch(/The Maze: "/);
    expect(s.world.enemies.length).toBe(before.length);
    expect(s.world.enemies.map((e) => e.id)).not.toEqual(before);
    expect(s.zoneStates[id]!.reclaimed).toBe(1);
  });
});

describe("pierce (the counter to turtling)", () => {
  const P = (depth: number, lane: number): Tile => ({ side: "party", depth, lane });
  it("ignores guard and taunt", () => {
    const s = createBattle(
      {
        party: [
          { id: "a", name: "a", side: "party", hp: 10, depth: 0, lane: 0, skills: ["brace"], prefers: [] },
          { id: "t", name: "t", side: "party", hp: 10, depth: 0, lane: 2, skills: ["taunt"], prefers: [] },
        ],
        foes: [{ id: "f", name: "f", side: "foe", hp: 10, depth: 0, lane: 0, skills: ["glob"], prefers: [], traits: { pierce: true } }],
      },
      { ...BATTLE_CONTENT, skills: { ...SKILLS, glob: { ...SKILLS.glob!, power: 4 } } },
      1,
    );
    s.intents = [{ actorId: "f", skillId: "glob", anchor: P(0, 0) }];
    getUnit(s, "a").guard = true;
    // Taunt would normally redirect the aimed glob onto t.
    s.log.length = 0;
    useSkill(s, "t", "taunt", null);
    endTurn(s, { declare: false });
    expect(getUnit(s, "a").hp).toBe(6); // full 4, not halved, not redirected
    expect(getUnit(s, "t").hp).toBe(10);
  });
});
