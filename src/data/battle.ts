/** Builds battle setups and job content from data files. */
import skillsJson from "./skills.json";
import jobsJson from "./jobs.json";
import abilitiesJson from "./abilities.json";
import partyJson from "./party.json";
import hazardsJson from "./hazards.json";
import encountersJson from "./encounters.json";
import { ENEMY_KINDS } from ".";
import type { BattleContent } from "../core/battle/engine";
import type { BattleSetup, SkillDef, UnitSpec } from "../core/battle/types";
import type { EncounterDef } from "../core/zone";
import {
  PASSIVE_SLOTS,
  changeJob,
  createCharacter,
  setSecondary,
  learnedPassives,
  maxLevel,
  unitSpec,
  equip,
  type Character,
  type CharacterSeed,
  type JobContent,
  type JobDef,
  type PassiveDef,
} from "../core/jobs";

export type { EncounterDef };

export const SKILLS: Record<string, SkillDef> = Object.fromEntries(
  Object.entries(skillsJson as Record<string, Omit<SkillDef, "id">>).map(([id, s]) => [id, { id, ...s }]),
);
export const JOBS = jobsJson as unknown as Record<string, JobDef>;
export const PASSIVES = abilitiesJson as unknown as Record<string, PassiveDef>;
export const JOB_CONTENT: JobContent = { jobs: JOBS, passives: PASSIVES, skills: SKILLS, levels: partyJson.levels };
export const STARTING_PARTY = partyJson.starting as CharacterSeed[];
export const STARTER_JOBS = Object.keys(JOBS).filter((j) => JOBS[j]!.unlock === "starter");
export const ENCOUNTERS = encountersJson as unknown as Record<string, EncounterDef>;
export const BATTLE_CONTENT: BattleContent = { skills: SKILLS, hazards: hazardsJson };

/** The party a new game starts with: three characters, one starter job each, level 1. */
export function startingParty(): Character[] {
  return STARTING_PARTY.map((c) => createCharacter(JOB_CONTENT, c));
}

/**
 * Test preset: the starting characters with their job at `level` (default:
 * max) and its passives equipped (first learned per slot). Used by the
 * sandbox and the simulator.
 */
export function veteranParty(level = maxLevel(JOB_CONTENT)): Character[] {
  return startingParty().map((ch) => {
    ch.jobXp[ch.primary] = JOB_CONTENT.levels[level - 1]!;
    for (const slot of PASSIVE_SLOTS) equip(JOB_CONTENT, ch, slot, learnedPassives(JOB_CONTENT, ch, slot)[0] ?? null);
    ch.hp = ch.maxHp;
    return ch;
  });
}

/** Party presets for the sandbox and the balance simulator. */
export const PARTY_PRESETS: Record<string, () => Character[]> = {
  start: startingParty,
  lv2: () => veteranParty(2),
  lv3: () => veteranParty(3),
  veteran: () => veteranParty(),
  /** Veterans, but Sable has become a Spellblade (Lv2) with Pyromancer as secondary. */
  hybrid: () => {
    const party = veteranParty();
    const sable = party.find((c) => c.id === "sable")!;
    sable.jobXp.lancer = JOB_CONTENT.levels[1]!;
    changeJob(JOB_CONTENT, sable, "spellblade", new Set(Object.keys(JOBS)));
    sable.jobXp.spellblade = JOB_CONTENT.levels[1]!;
    setSecondary(JOB_CONTENT, sable, "pyromancer");
    equip(JOB_CONTENT, sable, "reaction", "burning_riposte");
    sable.depth = 0;
    sable.lane = 2;
    sable.hp = sable.maxHp;
    return party;
  },
};

export const partySpecsOf = (party: Character[]): UnitSpec[] => party.map((c) => unitSpec(JOB_CONTENT, c));

export function foeUnit(kind: string, depth: number, lane: number, id: string): UnitSpec {
  const k = ENEMY_KINDS[kind];
  if (!k?.battle) throw new Error(`Enemy kind '${kind}' has no battle stats`);
  const b = k.battle;
  return {
    id, name: k.name, side: "foe", hp: b.hp, depth, lane, skills: b.skills, prefers: b.prefers,
    resist: b.resist, mobile: b.mobile, color: k.color, glyph: k.shape, kind,
  };
}

const resolveEncounter = (e: string | EncounterDef): EncounterDef => {
  const def = typeof e === "string" ? ENCOUNTERS[e] : e;
  if (!def) throw new Error(`Unknown encounter '${e as string}'`);
  return def;
};

/** XP an encounter awards each surviving party member. Takes an id or a (zone-defined) encounter. */
export function encounterXp(enc: string | EncounterDef): number {
  return resolveEncounter(enc).foes.reduce((sum, f) => sum + (ENEMY_KINDS[f.kind]!.battle?.xp ?? 0), 0);
}

/** Build an encounter's battle setup. `party` defaults to the starting party. */
export function buildEncounter(enc: string | EncounterDef, party?: UnitSpec[]): BattleSetup {
  const e = resolveEncounter(enc);
  const counts: Record<string, number> = {};
  return {
    party: party ?? partySpecsOf(startingParty()),
    foes: e.foes.map((f) => {
      counts[f.kind] = (counts[f.kind] ?? 0) + 1;
      return foeUnit(f.kind, f.depth, f.lane, `${f.kind}-${counts[f.kind]}`);
    }),
    hazards: e.hazards,
  };
}
