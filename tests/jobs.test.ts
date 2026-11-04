import { describe, expect, it } from "vitest";
import {
  JobError,
  availableJobs,
  battleSkills,
  changeJob,
  createCharacter,
  equip,
  gainXp,
  jobLevel,
  knows,
  learnedPassives,
  secondaryOptions,
  setSecondary,
  traitsOf,
  unitSpec,
  xpToNext,
  type Character,
} from "../src/core/jobs";
import { JOB_CONTENT as C, STARTER_JOBS } from "../src/data/battle";

const LV = (n: number) => C.levels[n - 1]!;
const STARTERS = new Set(STARTER_JOBS);
const ALL_BASE = new Set([...STARTER_JOBS, "lancer", "ranger"]);

function sable(): Character {
  return createCharacter(C, { id: "sable", name: "Sable", kind: "person", job: "pyromancer", depth: 2, lane: 2 });
}

describe("levels", () => {
  it("levels come from XP thresholds and cap at max", () => {
    expect(jobLevel(C, 0)).toBe(1);
    expect(jobLevel(C, LV(2) - 1)).toBe(1);
    expect(jobLevel(C, LV(2))).toBe(2);
    expect(jobLevel(C, 9999)).toBe(C.levels.length);
    expect(xpToNext(C, 0)).toBe(LV(2));
    expect(xpToNext(C, 9999)).toBeNull();
  });

  it("starters are exactly three jobs; two more are discoverable", () => {
    expect(STARTER_JOBS.sort()).toEqual(["mystic", "pyromancer", "vanguard"]);
    expect(Object.entries(C.jobs).filter(([, j]) => j.unlock === "discover").map(([id]) => id).sort()).toEqual(["lancer", "ranger"]);
  });

  it("a new character knows only its job's level-1 abilities", () => {
    const ch = sable();
    expect(battleSkills(C, ch)).toEqual(["firebolt", "scorch"]);
    expect(ch).toMatchObject({ hp: 9, maxHp: 9, secondary: null, reaction: null, support: null, movement: null });
  });
});

describe("gaining XP", () => {
  it("levels the primary job, learns its abilities and auto-equips new passives", () => {
    const ch = sable();
    const notes = gainXp(C, ch, LV(2), STARTERS);
    expect(notes).toContainEqual({ kind: "level", charId: "sable", job: "pyromancer", level: 2 });
    expect(notes).toContainEqual({ kind: "learn", charId: "sable", job: "pyromancer", ability: "flame_pillar", equipped: false });
    expect(notes).toContainEqual({ kind: "learn", charId: "sable", job: "pyromancer", ability: "kindling", equipped: true });
    expect(ch.support).toBe("kindling");
    expect(battleSkills(C, ch)).toContain("flame_pillar");
  });

  it("no level, no notes", () => {
    expect(gainXp(C, sable(), 1, STARTERS)).toEqual([]);
  });

  it("can skip several levels at once", () => {
    const ch = sable();
    const notes = gainXp(C, ch, LV(3), STARTERS);
    expect(notes.filter((n) => n.kind === "level")).toEqual([{ kind: "level", charId: "sable", job: "pyromancer", level: 3 }]);
    expect(knows(C, ch, "detonate")).toBe(true);
    expect(ch.movement).toBe("ember_walk");
  });
});

describe("changing jobs", () => {
  it("only discovered jobs may be taken up", () => {
    const ch = sable();
    expect(availableJobs(C, ch, STARTERS).sort()).toEqual(["mystic", "pyromancer", "vanguard"]);
    expect(() => changeJob(C, ch, "lancer", STARTERS)).toThrow(JobError);
    changeJob(C, ch, "lancer", ALL_BASE);
    expect(ch.primary).toBe("lancer");
  });

  it("learned skills persist: the old job becomes a secondary skill set", () => {
    const ch = sable();
    gainXp(C, ch, LV(2), STARTERS);
    changeJob(C, ch, "vanguard", STARTERS);
    expect(battleSkills(C, ch)).toEqual(["strike", "brace"]);
    expect(secondaryOptions(C, ch)).toEqual(["pyromancer"]);
    setSecondary(C, ch, "pyromancer");
    expect(battleSkills(C, ch)).toEqual(["strike", "brace", "firebolt", "scorch", "flame_pillar"]);
    // Passives from the old job stay equipped and keep working.
    expect(ch.support).toBe("kindling");
    expect(traitsOf(C, ch).elementBonus).toEqual({ fire: 1 });
  });

  it("secondary must be a learned job other than the primary", () => {
    const ch = sable();
    expect(() => setSecondary(C, ch, "pyromancer")).toThrow(JobError);
    expect(() => setSecondary(C, ch, "vanguard")).toThrow(JobError);
    changeJob(C, ch, "vanguard", STARTERS);
    setSecondary(C, ch, "pyromancer");
    changeJob(C, ch, "pyromancer", STARTERS);
    expect(ch.secondary).toBeNull(); // can't be your own secondary
  });

  it("max HP follows the job, keeping the HP fraction; downed stays down", () => {
    const ch = sable(); // 9 HP pyromancer
    ch.hp = 3;
    changeJob(C, ch, "vanguard", STARTERS); // 16 HP job
    expect(ch.maxHp).toBe(16);
    expect(ch.hp).toBe(5);
    ch.hp = 0;
    changeJob(C, ch, "mystic", STARTERS);
    expect(ch.hp).toBe(0);
  });

  it("support HP bonus applies and is removed with the passive", () => {
    const ch = createCharacter(C, { id: "w", name: "W", kind: "person", job: "vanguard", depth: 0, lane: 0 });
    gainXp(C, ch, LV(3), STARTERS);
    equip(C, ch, "support", "fortitude");
    expect(ch.maxHp).toBe(20);
    equip(C, ch, "support", null);
    expect(ch.maxHp).toBe(16);
  });

  it("only learned passives fit, and only in their own slot", () => {
    const ch = sable();
    expect(() => equip(C, ch, "support", "kindling")).toThrow(JobError);
    gainXp(C, ch, LV(2), STARTERS);
    expect(() => equip(C, ch, "reaction", "kindling")).toThrow(JobError);
    expect(learnedPassives(C, ch, "support")).toEqual(["kindling"]);
  });
});

describe("hybrid job", () => {
  it("Spellblade unlocks for a character with Lancer Lv2 and Pyromancer Lv2", () => {
    const ch = sable();
    expect(availableJobs(C, ch, ALL_BASE)).not.toContain("spellblade");
    gainXp(C, ch, LV(2), ALL_BASE); // Pyromancer Lv2
    expect(availableJobs(C, ch, ALL_BASE)).not.toContain("spellblade");
    changeJob(C, ch, "lancer", ALL_BASE);
    const notes = gainXp(C, ch, LV(2), ALL_BASE); // Lancer Lv2
    expect(notes).toContainEqual({ kind: "hybrid", charId: "sable", job: "spellblade" });
    changeJob(C, ch, "spellblade", ALL_BASE);
    expect(battleSkills(C, ch)).toEqual(["flame_lunge", "searing_hook"]);
  });

  it("hybrids are per character, and need no discovery", () => {
    const a = sable();
    const b = sable();
    gainXp(C, a, LV(2), ALL_BASE);
    changeJob(C, a, "lancer", ALL_BASE);
    gainXp(C, a, LV(2), ALL_BASE);
    expect(availableJobs(C, a, ALL_BASE)).toContain("spellblade");
    expect(availableJobs(C, b, ALL_BASE)).not.toContain("spellblade");
  });
});

describe("battle unit", () => {
  it("carries skills, traits, and HP into a battle spec", () => {
    const ch = sable();
    gainXp(C, ch, LV(3), STARTERS);
    ch.hp = 4;
    const spec = unitSpec(C, ch);
    expect(spec).toMatchObject({ id: "sable", name: "Sable", hp: 4, maxHp: 9, job: "pyromancer", prefers: [2] });
    expect(spec.traits).toEqual({ elementBonus: { fire: 1 }, hazardImmune: ["fire", "lava"] });
    expect(spec.passives).toHaveLength(2);
  });
});
