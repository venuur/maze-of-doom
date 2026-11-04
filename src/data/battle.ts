/** Builds battle setups from data files. */
import skillsJson from "./skills.json";
import jobsJson from "./jobs.json";
import hazardsJson from "./hazards.json";
import encountersJson from "./encounters.json";
import { ENEMY_KINDS } from ".";
import type { BattleContent } from "../core/battle/engine";
import type { BattleSetup, Hazard, SkillDef, UnitSpec } from "../core/battle/types";

export interface JobDef {
  name: string;
  desc: string;
  hp: number;
  prefers: number[];
  glyph: string;
  color: string;
  skills: string[];
}

export interface EncounterDef {
  name: string;
  desc: string;
  foes: { kind: string; depth: number; lane: number }[];
  hazards?: Hazard[];
  party?: { job: string; depth: number; lane: number }[];
}

export const SKILLS: Record<string, SkillDef> = Object.fromEntries(
  Object.entries(skillsJson as Record<string, Omit<SkillDef, "id">>).map(([id, s]) => [id, { id, ...s }]),
);
export const JOBS = jobsJson as Record<string, JobDef>;
export const ENCOUNTERS = encountersJson as unknown as Record<string, EncounterDef>;
export const BATTLE_CONTENT: BattleContent = { skills: SKILLS, hazards: hazardsJson };

/** Default test party: one of each job. */
export const DEFAULT_PARTY = [
  { job: "vanguard", depth: 0, lane: 1 },
  { job: "lancer", depth: 1, lane: 0 },
  { job: "pyromancer", depth: 2, lane: 2 },
  { job: "mystic", depth: 2, lane: 0 },
];

export function partyUnit(job: string, depth: number, lane: number): UnitSpec {
  const j = JOBS[job];
  if (!j) throw new Error(`Unknown job '${job}'`);
  return { id: job, name: j.name, side: "party", hp: j.hp, depth, lane, skills: j.skills, prefers: j.prefers, glyph: j.glyph, color: j.color, job };
}

export function foeUnit(kind: string, depth: number, lane: number, id: string): UnitSpec {
  const k = ENEMY_KINDS[kind];
  if (!k?.battle) throw new Error(`Enemy kind '${kind}' has no battle stats`);
  const b = k.battle;
  return {
    id, name: k.name, side: "foe", hp: b.hp, depth, lane, skills: b.skills, prefers: b.prefers,
    resist: b.resist, mobile: b.mobile, color: k.color, glyph: k.shape, kind,
  };
}

/** Build an encounter's battle setup. `party` overrides the default test party. */
export function buildEncounter(id: string, party?: UnitSpec[]): BattleSetup {
  const e = ENCOUNTERS[id];
  if (!e) throw new Error(`Unknown encounter '${id}'`);
  const counts: Record<string, number> = {};
  return {
    party: party ?? (e.party ?? DEFAULT_PARTY).map((p) => partyUnit(p.job, p.depth, p.lane)),
    foes: e.foes.map((f) => {
      counts[f.kind] = (counts[f.kind] ?? 0) + 1;
      return foeUnit(f.kind, f.depth, f.lane, `${f.kind}-${counts[f.kind]}`);
    }),
    hazards: e.hazards,
  };
}
