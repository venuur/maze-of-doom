import { describe, expect, it } from "vitest";
import {
  applyAction,
  cloneBattle,
  createBattle,
  endTurn,
  getUnit,
  intentPreview,
  intentTiles,
  legalMoves,
  moveUnit,
  useSkill,
  IllegalAction,
} from "../src/core/battle/engine";
import { legalAnchors, linePath, tileKey } from "../src/core/battle/grid";
import type { BattleSetup, BattleState, Intent, Tile, UnitSpec } from "../src/core/battle/types";
import { BATTLE_CONTENT, ENCOUNTERS, JOB_CONTENT, SKILLS, buildEncounter } from "../src/data/battle";
import { validateJobContent } from "../src/core/jobs";

const P = (depth: number, lane: number): Tile => ({ side: "party", depth, lane });
const F = (depth: number, lane: number): Tile => ({ side: "foe", depth, lane });

function foe(id: string, depth: number, lane: number, skills: string[], extra: Partial<UnitSpec> = {}): UnitSpec {
  return { id, name: id, side: "foe", hp: 10, depth, lane, skills, prefers: [], ...extra };
}
function ally(id: string, depth: number, lane: number, skills: string[], extra: Partial<UnitSpec> = {}): UnitSpec {
  return { id, name: id, side: "party", hp: 10, depth, lane, skills, prefers: [], ...extra };
}

// Pin the numbers these rule tests depend on, so rebalancing content doesn't break them.
const pinned = (id: string, power: number) => ({ ...SKILLS[id]!, power });
const TEST_CONTENT = {
  ...BATTLE_CONTENT,
  skills: { ...SKILLS, slam: pinned("slam", 3), glob: pinned("glob", 2), arrow: pinned("arrow", 3), volley: pinned("volley", 2) },
};

/** Build a battle and replace foe intents with exactly the ones given. */
function battle(setup: BattleSetup, intents?: Intent[], seed = 1): BattleState {
  const s = createBattle(setup, TEST_CONTENT, seed);
  if (intents) s.intents = intents;
  return s;
}

const hp = (s: BattleState, id: string) => getUnit(s, id).hp;

describe("geometry", () => {
  it("line path runs from the user to its own front, then across the enemy grid", () => {
    const s = battle({ party: [ally("a", 2, 1, ["firebolt"])], foes: [foe("f", 0, 0, [])] }, []);
    expect(linePath(getUnit(s, "a")).map(tileKey)).toEqual([
      "party:1:1", "party:0:1", "foe:0:1", "foe:1:1", "foe:2:1",
    ]);
  });

  it("reach and front-row requirements limit anchors", () => {
    const s = battle(
      { party: [ally("v", 0, 1, ["strike"])], foes: [foe("a", 0, 0, []), foe("b", 1, 1, [])] },
      [],
    );
    const anchors = legalAnchors(s, getUnit(s, "v"), SKILLS.strike!);
    expect(anchors).toEqual([F(0, 0)]);
  });
});

describe("telegraphs and dodging", () => {
  it("a fixed (aimed) attack misses if the target steps off the tile", () => {
    const s = battle(
      { party: [ally("a", 1, 1, [])], foes: [foe("f", 0, 0, ["glob"])] },
      [{ actorId: "f", skillId: "glob", anchor: P(1, 1) }],
    );
    moveUnit(s, "a", P(1, 0));
    endTurn(s, { declare: false });
    expect(hp(s, "a")).toBe(10);
    expect(s.log.some((e) => e.type === "miss")).toBe(true);
  });

  it("a line attack hits whoever is first in the lane at resolution", () => {
    const s = battle(
      { party: [ally("front", 0, 1, []), ally("back", 2, 1, [])], foes: [foe("f", 0, 1, ["slam"])] },
      [{ actorId: "f", skillId: "slam", anchor: null }],
    );
    expect(intentPreview(s, s.intents[0]!)).toEqual([{ unitId: "front", amount: 3 }]);
    moveUnit(s, "front", P(0, 0)); // step aside: the shot now reaches the back unit
    expect(intentPreview(s, s.intents[0]!)).toEqual([{ unitId: "back", amount: 3 }]);
    endTurn(s, { declare: false });
    expect(hp(s, "front")).toBe(10);
    expect(hp(s, "back")).toBe(7);
  });

  it("pushing an enemy to another lane moves its lane attack with it", () => {
    const s = battle(
      { party: [ally("l", 1, 1, ["shunt"]), ally("x", 0, 0, [])], foes: [foe("f", 0, 0, ["volley"])] },
      [{ actorId: "f", skillId: "volley", anchor: null }],
    );
    expect(intentTiles(s, s.intents[0]!).hit.map(tileKey)).toContain("party:0:0");
    useSkill(s, "l", "shunt", F(0, 0), "down");
    expect(getUnit(s, "f").lane).toBe(1);
    endTurn(s, { declare: false });
    expect(hp(s, "x")).toBe(10); // lane 0 is now safe
    expect(hp(s, "l")).toBe(8); // lane 1 caught the volley
  });

  it("shoving an enemy in front of a shooter makes it shoot its friend", () => {
    const s = battle(
      {
        party: [ally("l", 1, 1, ["shunt"])],
        foes: [foe("archer", 2, 1, ["arrow"]), foe("grunt", 1, 0, [])],
      },
      [{ actorId: "archer", skillId: "arrow", anchor: null }],
    );
    expect(intentPreview(s, s.intents[0]!)).toEqual([{ unitId: "l", amount: 3 }]);
    useSkill(s, "l", "shunt", F(1, 0), "down");
    expect(getUnit(s, "grunt")).toMatchObject({ depth: 1, lane: 1 });
    expect(intentPreview(s, s.intents[0]!)).toEqual([{ unitId: "grunt", amount: 3 }]);
    endTurn(s, { declare: false });
    expect(hp(s, "grunt")).toBe(10 - 1 - 3);
    expect(hp(s, "l")).toBe(10);
  });

  it("hook pulls the first enemy in the lane toward the front", () => {
    const s = battle({ party: [ally("l", 1, 1, ["hook"])], foes: [foe("f", 2, 1, [])] }, []);
    useSkill(s, "l", "hook", null);
    expect(getUnit(s, "f")).toMatchObject({ depth: 1, lane: 1, hp: 9 });
  });
});

describe("displacement collisions", () => {
  it("pushing into an occupied tile bumps both units", () => {
    const s = battle(
      { party: [ally("v", 0, 1, ["shield_bash"])], foes: [foe("a", 0, 1, []), foe("b", 1, 1, [])] },
      [],
    );
    useSkill(s, "v", "shield_bash", F(0, 1));
    expect(getUnit(s, "a")).toMatchObject({ depth: 0, hp: 10 - 2 - 1 });
    expect(hp(s, "b")).toBe(9);
  });

  it("pushing off the grid edge bumps", () => {
    const s = battle({ party: [ally("v", 0, 2, ["shunt"])], foes: [foe("a", 0, 2, [])] }, []);
    useSkill(s, "v", "shunt", F(0, 2), "down");
    expect(getUnit(s, "a")).toMatchObject({ lane: 2, hp: 10 - 1 - 1 });
  });

  it("column sweeps push the whole row without self-collision", () => {
    const s = battle(
      { party: [ally("l", 1, 1, ["sweep"])], foes: [foe("a", 0, 0, []), foe("b", 0, 1, []), foe("c", 1, 1, [])] },
      [],
    );
    useSkill(s, "l", "sweep", F(0, 0));
    expect(getUnit(s, "a").depth).toBe(1); // free tile behind
    expect(getUnit(s, "b").depth).toBe(0); // blocked by c
    expect(hp(s, "b")).toBe(10 - 1 - 1); // sweep + bump
    expect(hp(s, "c")).toBe(9);
  });
});

describe("redirect and interrupt", () => {
  it("taunt redirects aimed attacks onto the taunter", () => {
    const s = battle(
      { party: [ally("v", 0, 1, ["taunt"]), ally("m", 2, 0, [])], foes: [foe("f", 0, 0, ["glob"])] },
      [{ actorId: "f", skillId: "glob", anchor: P(2, 0) }],
    );
    useSkill(s, "v", "taunt", null);
    endTurn(s, { declare: false });
    expect(hp(s, "m")).toBe(10);
    expect(hp(s, "v")).toBe(8);
  });

  it("taunt does not redirect lane-based attacks", () => {
    const s = battle(
      { party: [ally("v", 0, 1, ["taunt"]), ally("m", 0, 0, [])], foes: [foe("f", 0, 0, ["slam"])] },
      [{ actorId: "f", skillId: "slam", anchor: null }],
    );
    useSkill(s, "v", "taunt", null);
    endTurn(s, { declare: false });
    expect(hp(s, "m")).toBe(7);
  });

  it("taunted attacks follow the taunter when an ally swaps it away", () => {
    const s = battle(
      {
        party: [ally("v", 0, 1, ["taunt"]), ally("m", 1, 1, []), ally("x", 2, 2, [])],
        foes: [foe("f", 0, 0, ["glob"])],
      },
      [{ actorId: "f", skillId: "glob", anchor: P(2, 2) }],
    );
    useSkill(s, "v", "taunt", null);
    moveUnit(s, "m", P(0, 1)); // stepping into the taunter swaps it back
    expect(getUnit(s, "v")).toMatchObject({ depth: 1, lane: 1 });
    endTurn(s, { declare: false });
    expect(hp(s, "v")).toBe(8);
    expect(hp(s, "m")).toBe(10);
    expect(hp(s, "x")).toBe(10);
  });

  it("transpose swaps two enemies, moving both of their lane attacks", () => {
    const s = battle(
      {
        party: [ally("m", 2, 0, ["transpose"]), ally("a", 0, 0, []), ally("b", 0, 1, [])],
        foes: [foe("archer", 2, 0, ["arrow"]), foe("grunt", 2, 1, [])],
      },
      [{ actorId: "archer", skillId: "arrow", anchor: null }],
    );
    useSkill(s, "m", "transpose", F(2, 0), "down");
    expect(getUnit(s, "archer")).toMatchObject({ depth: 2, lane: 1 });
    expect(getUnit(s, "grunt")).toMatchObject({ depth: 2, lane: 0, hp: 10 });
    endTurn(s, { declare: false });
    expect(hp(s, "a")).toBe(10);
    expect(hp(s, "b")).toBe(7);
  });

  it("silence cancels an intent", () => {
    const s = battle(
      { party: [ally("m", 2, 0, ["silence"])], foes: [foe("f", 0, 0, ["slam"])] },
      [{ actorId: "f", skillId: "slam", anchor: null }],
    );
    useSkill(s, "m", "silence", F(0, 0));
    expect(s.intents).toEqual([]);
    endTurn(s, { declare: false });
    expect(hp(s, "m")).toBe(10);
  });

  it("daze cancels this round and skips the next declaration", () => {
    const s = battle(
      { party: [ally("m", 2, 0, ["daze"])], foes: [foe("f", 0, 0, ["slam"])] },
      [{ actorId: "f", skillId: "slam", anchor: null }],
    );
    useSkill(s, "m", "daze", F(0, 0));
    endTurn(s); // declares round 2: f is stunned
    expect(s.intents).toEqual([]);
    endTurn(s); // round 3: f acts again
    expect(s.intents.map((i) => i.actorId)).toEqual(["f"]);
  });

  it("guard halves incoming damage", () => {
    const s = battle(
      { party: [ally("v", 0, 0, ["brace"])], foes: [foe("f", 0, 0, ["slam"])] },
      [{ actorId: "f", skillId: "slam", anchor: null }],
    );
    useSkill(s, "v", "brace", null);
    expect(intentPreview(s, s.intents[0]!)).toEqual([{ unitId: "v", amount: 1 }]);
    endTurn(s, { declare: false });
    expect(hp(s, "v")).toBe(9);
  });
});

describe("damage rules", () => {
  it("preferred depth adds +1 power", () => {
    const s = battle({ party: [ally("p", 2, 0, ["firebolt"], { prefers: [2] })], foes: [foe("f", 0, 0, [])] }, []);
    useSkill(s, "p", "firebolt", null);
    expect(hp(s, "f")).toBe(5);
  });

  it("resistances scale and can nullify damage", () => {
    const s = battle(
      { party: [ally("p", 2, 0, ["firebolt"]), ally("q", 2, 1, ["firebolt"])], foes: [foe("w", 0, 0, [], { resist: { fire: 0 } }), foe("s", 0, 1, [], { resist: { fire: 0.5 } })] },
      [],
    );
    useSkill(s, "p", "firebolt", null);
    useSkill(s, "q", "firebolt", null);
    expect(hp(s, "w")).toBe(10);
    expect(hp(s, "s")).toBe(8);
  });

  it("line skills are blocked by allies standing in front", () => {
    const s = battle({ party: [ally("p", 2, 0, ["firebolt"]), ally("v", 0, 0, [])], foes: [foe("f", 0, 0, [])] }, []);
    useSkill(s, "p", "firebolt", null);
    expect(hp(s, "v")).toBe(6);
    expect(hp(s, "f")).toBe(10);
  });
});

describe("hazards", () => {
  it("fire tiles burn units at end of round and expire", () => {
    const s = battle({ party: [ally("p", 2, 0, ["scorch"])], foes: [foe("f", 1, 1, [])] }, []);
    useSkill(s, "p", "scorch", F(1, 1));
    expect(hp(s, "f")).toBe(9);
    endTurn(s, { declare: false });
    expect(hp(s, "f")).toBe(7);
    expect(s.hazards[0]?.turns).toBe(2);
    endTurn(s, { declare: false });
    endTurn(s, { declare: false });
    expect(s.hazards).toEqual([]);
    expect(hp(s, "f")).toBe(3);
  });

  it("lava is permanent and burns whoever is pushed into it", () => {
    const s = battle(
      { party: [ally("v", 0, 0, ["shield_bash"])], foes: [foe("f", 0, 0, [])], hazards: [{ tile: F(1, 0), kind: "lava", turns: null }] },
      [],
    );
    useSkill(s, "v", "shield_bash", F(0, 0));
    endTurn(s, { declare: false });
    expect(hp(s, "f")).toBe(10 - 2 - 3);
    expect(s.hazards).toHaveLength(1);
  });

  it("mobile foes won't step onto hazards", () => {
    const s = battle(
      { party: [ally("a", 0, 0, [])], foes: [foe("f", 0, 1, ["slam"], { mobile: true })], hazards: [{ tile: F(0, 0), kind: "lava", turns: null }] },
    );
    expect(getUnit(s, "f")).toMatchObject({ depth: 0, lane: 1 });
  });
});

describe("turn rules", () => {
  it("move once, then act; acting ends the unit's turn", () => {
    const s = battle({ party: [ally("a", 1, 1, ["jab"])], foes: [foe("f", 0, 1, [])] }, []);
    moveUnit(s, "a", P(0, 1));
    expect(() => moveUnit(s, "a", P(0, 0))).toThrow(IllegalAction);
    useSkill(s, "a", "jab", F(0, 1));
    expect(() => useSkill(s, "a", "jab", F(0, 1))).toThrow(IllegalAction);
    expect(legalMoves(s, getUnit(s, "a"))).toEqual([]);
  });

  it("moving into an ally swaps places", () => {
    const s = battle({ party: [ally("a", 1, 1, []), ally("b", 0, 1, [])], foes: [foe("f", 0, 0, [])] }, []);
    moveUnit(s, "a", P(0, 1));
    expect(getUnit(s, "b")).toMatchObject({ depth: 1, lane: 1 });
  });

  it("position requirements are enforced", () => {
    const s = battle({ party: [ally("v", 1, 1, ["strike"])], foes: [foe("f", 0, 1, [])] }, []);
    expect(() => useSkill(s, "v", "strike", F(0, 1))).toThrow(/front/);
  });

  it("cooldowns block reuse until N rounds later", () => {
    const s = battle({ party: [ally("l", 1, 1, ["sweep"])], foes: [foe("f", 0, 1, [], { hp: 50 })] }, []);
    useSkill(s, "l", "sweep", F(0, 0));
    endTurn(s, { declare: false });
    expect(() => useSkill(s, "l", "sweep", F(0, 0))).toThrow(/cooldown/);
    endTurn(s, { declare: false });
    expect(() => useSkill(s, "l", "sweep", F(0, 0))).not.toThrow();
  });

  it("victory when all foes fall, defeat when the party falls", () => {
    const s = battle({ party: [ally("p", 2, 0, ["firebolt"])], foes: [foe("f", 0, 0, [], { hp: 3 })] }, []);
    useSkill(s, "p", "firebolt", null);
    expect(s.phase).toBe("won");

    const l = battle(
      { party: [ally("a", 0, 0, [], { hp: 2 })], foes: [foe("f", 0, 0, ["slam"])] },
      [{ actorId: "f", skillId: "slam", anchor: null }],
    );
    endTurn(l);
    expect(l.phase).toBe("lost");
  });
});

describe("determinism", () => {
  it("same seed + same actions = same battle", () => {
    const play = (seed: number) => {
      const s = createBattle(buildEncounter("gauntlet"), BATTLE_CONTENT, seed);
      for (let r = 0; r < 6 && s.phase === "player"; r++) {
        applyAction(s, { type: "endTurn" });
      }
      return JSON.stringify({ units: s.units, intents: s.intents, log: s.log });
    };
    expect(play(7)).toBe(play(7));
  });

  it("clones are independent", () => {
    const s = createBattle(buildEncounter("slime_pack"), BATTLE_CONTENT, 1);
    const c = cloneBattle(s);
    endTurn(c);
    expect(s.round).toBe(1);
    expect(c.round).toBe(2);
  });
});

describe("shipped content", () => {
  it("every encounter builds and every unit can declare", () => {
    for (const id of Object.keys(ENCOUNTERS)) {
      const s = createBattle(buildEncounter(id), BATTLE_CONTENT, 1);
      expect(s.intents.length, id).toBeGreaterThan(0);
    }
  });

  it("job data is valid (abilities exist, levels reachable, hybrid recipes sound)", () => {
    expect(validateJobContent(JOB_CONTENT)).toEqual([]);
  });
});

describe("traits from ability slots", () => {
  const glob = (anchor: Tile): Intent => ({ actorId: "f", skillId: "glob", anchor });

  it("Counter: hit by an enemy attack, strike back after it resolves", () => {
    const s = battle(
      { party: [ally("a", 0, 0, [], { traits: { counter: { power: 2, element: "physical" } } })], foes: [foe("f", 0, 0, ["glob"])] },
      [glob(P(0, 0))],
    );
    endTurn(s, { declare: false });
    expect(hp(s, "a")).toBe(8);
    expect(hp(s, "f")).toBe(8);
    expect(s.log).toContainEqual({ type: "reaction", unitId: "a", trait: "counter", targetId: "f" });
  });

  it("Counter does not fire on friendly fire", () => {
    const s = battle(
      {
        party: [ally("a", 0, 0, [], { traits: { counter: { power: 2, element: "physical" } } }), ally("p", 2, 0, ["firebolt"])],
        foes: [foe("f", 0, 1, [])],
      },
      [],
    );
    useSkill(s, "p", "firebolt", null); // hits the ally in front
    expect(hp(s, "a")).toBe(6);
    expect(hp(s, "p")).toBe(10);
  });

  it("Repel: the attacker is shoved back", () => {
    const s = battle({ party: [ally("a", 0, 0, [], { traits: { repel: true } })], foes: [foe("f", 0, 0, ["glob"])] }, [glob(P(0, 0))]);
    endTurn(s, { declare: false });
    expect(getUnit(s, "f").depth).toBe(1);
  });

  it("Second Wind heals once, the first time HP drops to half", () => {
    const s = battle({ party: [ally("a", 0, 0, [], { hp: 6, maxHp: 8, traits: { secondWind: 4 } })], foes: [foe("f", 0, 0, ["glob"])] }, [glob(P(0, 0))]);
    endTurn(s, { declare: false }); // 6 -> 4 (half of 8), +4
    expect(hp(s, "a")).toBe(8);
    for (let i = 0; i < 2; i++) {
      s.intents = [glob(P(0, 0))];
      endTurn(s, { declare: false });
    }
    expect(hp(s, "a")).toBe(4); // already spent
  });

  it("element, shape and heal bonuses", () => {
    const s = battle(
      {
        party: [
          ally("p", 2, 0, ["firebolt"], { traits: { elementBonus: { fire: 1 } } }),
          ally("r", 2, 1, ["aimed_shot"], { traits: { shapeBonus: { single: 1 } } }),
          ally("m", 2, 2, ["mend"], { hp: 2, maxHp: 10, traits: { healBonus: 2 } }),
        ],
        foes: [foe("f", 0, 0, []), foe("g", 2, 1, [])],
      },
      [],
    );
    useSkill(s, "p", "firebolt", null);
    useSkill(s, "r", "aimed_shot", F(2, 1));
    useSkill(s, "m", "mend", P(2, 2));
    expect(hp(s, "f")).toBe(10 - 5);
    expect(hp(s, "g")).toBe(10 - 4);
    expect(hp(s, "m")).toBe(2 + 6);
  });

  it("steadfast units can't be displaced or swapped", () => {
    const s = battle(
      { party: [ally("l", 1, 0, ["hook", "transpose"])], foes: [foe("f", 1, 0, [], { traits: { steadfast: true } }), foe("g", 1, 1, [])] },
      [],
    );
    useSkill(s, "l", "hook", null);
    expect(getUnit(s, "f").depth).toBe(1);
    expect(s.log).toContainEqual({ type: "steadfast", unitId: "f" });
    endTurn(s, { declare: false });
    useSkill(s, "l", "transpose", F(1, 1), "up"); // g would swap with steadfast f: collision instead
    expect(getUnit(s, "f").lane).toBe(0);
    expect(getUnit(s, "g").lane).toBe(1);
  });

  it("hazard immunity", () => {
    const s = battle(
      {
        party: [ally("a", 2, 1, [], { traits: { hazardImmune: ["lava"] } }), ally("b", 2, 0, [])],
        foes: [foe("f", 0, 0, [])],
        hazards: [
          { tile: P(2, 1), kind: "lava", turns: null },
          { tile: P(2, 0), kind: "lava", turns: null },
        ],
      },
      [],
    );
    endTurn(s, { declare: false });
    expect(hp(s, "a")).toBe(10);
    expect(hp(s, "b")).toBeLessThan(10);
  });

  it("movement traits widen legal steps", () => {
    const s = battle(
      {
        party: [ally("n", 0, 0, []), ally("b", 1, 1, [], { traits: { move: "blink" } }), ally("s", 2, 2, [], { traits: { move: "stride" } })],
        foes: [foe("f", 0, 0, [])],
      },
      [],
    );
    expect(legalMoves(s, getUnit(s, "n"))).toHaveLength(2);
    expect(legalMoves(s, getUnit(s, "b"))).toHaveLength(8);
    expect(legalMoves(s, getUnit(s, "s")).map((t) => `${t.depth}${t.lane}`).sort()).toEqual(["02", "11", "12", "20", "21"]);
    moveUnit(s, "b", P(2, 0));
    expect(getUnit(s, "b")).toMatchObject({ depth: 2, lane: 0 });
  });
});
