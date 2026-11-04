/** Builds battle setups and job content from data files. */
import skillsJson from "./skills.json";
import jobsJson from "./jobs.json";
import abilitiesJson from "./abilities.json";
import partyJson from "./party.json";
import hazardsJson from "./hazards.json";
import encountersJson from "./encounters.json";
import { ENEMY_KINDS } from ".";
import type { BattleContent } from "../core/battle/engine";
import type { BattleSetup, Hazard, SkillDef, UnitSpec } from "../core/battle/types";
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

export interface EncounterDef {
  name: string;
  desc: string;
  foes: { kind: string; depth: number; lane: number }[];
  hazards?: Hazard[];
}

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

/** XP an encounter awards each surviving party member. */
export function encounterXp(id: string): number {
  return ENCOUNTERS[id]!.foes.reduce((sum, f) => sum + (ENEMY_KINDS[f.kind]!.battle?.xp ?? 0), 0);
}

/** Build an encounter's battle setup. `party` defaults to the starting party. */
export function buildEncounter(id: string, party?: UnitSpec[]): BattleSetup {
  const e = ENCOUNTERS[id];
  if (!e) throw new Error(`Unknown encounter '${id}'`);
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
