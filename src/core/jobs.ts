/**
 * FFT-style job system: characters earn XP in their current (primary) job,
 * level it up, and permanently learn its abilities. Learned abilities stay
 * usable after switching jobs: a second job's skills via the Secondary slot,
 * passives via the Reaction / Support / Movement slots. Mixing jobs unlocks
 * hybrid jobs. Pure logic over plain data; no DOM.
 */
import type { SkillDef, UnitSpec, UnitTraits } from "./battle/types";

export type PassiveSlot = "reaction" | "support" | "movement";
export const PASSIVE_SLOTS: readonly PassiveSlot[] = ["reaction", "support", "movement"];

export interface JobAbility {
  /** A skill id (battle command) or a passive id (reaction/support/movement). */
  id: string;
  /** Job level at which it is learned. */
  level: number;
}

export type JobUnlock = "starter" | "discover" | { hybrid: Record<string, number> };

export interface JobDef {
  name: string;
  desc: string;
  hp: number;
  prefers: number[];
  glyph: string;
  color: string;
  unlock: JobUnlock;
  abilities: JobAbility[];
}

export interface PassiveDef {
  name: string;
  slot: PassiveSlot;
  desc: string;
  traits?: UnitTraits;
  /** Support: flat max HP bonus. */
  maxHp?: number;
  /** Movement: overworld ability granted while equipped (e.g. "float" crosses lava). */
  field?: string;
}

export interface JobContent {
  jobs: Record<string, JobDef>;
  passives: Record<string, PassiveDef>;
  skills: Record<string, SkillDef>;
  /** XP needed for each level: levels[0] = 0 (Lv1), levels[1] = Lv2, ... */
  levels: number[];
}

export interface Character {
  id: string;
  name: string;
  kind: "person" | "creature";
  hp: number;
  /** Derived from job + support; kept in sync by every mutator here. */
  maxHp: number;
  /** Battle formation. */
  depth: number;
  lane: number;
  /** XP per job this character has ever taken up. A key here = the job is "learned". */
  jobXp: Record<string, number>;
  primary: string;
  secondary: string | null;
  reaction: string | null;
  support: string | null;
  movement: string | null;
}

export type ProgressNote =
  | { kind: "level"; charId: string; job: string; level: number }
  | { kind: "learn"; charId: string; job: string; ability: string; equipped: boolean }
  | { kind: "hybrid"; charId: string; job: string };

export class JobError extends Error {}

// ---------------------------------------------------------------------------
// Queries

export function jobLevel(content: JobContent, xp: number): number {
  let lv = 0;
  for (const need of content.levels) if (xp >= need) lv++;
  return Math.max(1, lv);
}

export const maxLevel = (content: JobContent) => content.levels.length;

/** XP still needed for the next level, or null at max. */
export function xpToNext(content: JobContent, xp: number): number | null {
  const next = content.levels[jobLevel(content, xp)];
  return next === undefined ? null : next - xp;
}

export function levelIn(content: JobContent, ch: Character, job: string): number {
  return ch.jobXp[job] === undefined ? 0 : jobLevel(content, ch.jobXp[job]!);
}

export const isSkill = (content: JobContent, id: string) => id in content.skills;

/** Every ability the character has learned, with the job it came from. */
export function learned(content: JobContent, ch: Character): { id: string; job: string }[] {
  const out: { id: string; job: string }[] = [];
  for (const job of Object.keys(ch.jobXp)) {
    const lv = levelIn(content, ch, job);
    for (const a of content.jobs[job]!.abilities) if (a.level <= lv) out.push({ id: a.id, job });
  }
  return out;
}

export function knows(content: JobContent, ch: Character, id: string): boolean {
  return learned(content, ch).some((a) => a.id === id);
}

/** Battle commands learned in one job. */
export function learnedSkills(content: JobContent, ch: Character, job: string): string[] {
  const lv = levelIn(content, ch, job);
  return content.jobs[job]!.abilities.filter((a) => a.level <= lv && isSkill(content, a.id)).map((a) => a.id);
}

/** Learned passives that fit a slot. */
export function learnedPassives(content: JobContent, ch: Character, slot: PassiveSlot): string[] {
  const ids = learned(content, ch).map((a) => a.id).filter((id) => content.passives[id]?.slot === slot);
  return [...new Set(ids)];
}

export function hybridRequirement(def: JobDef): Record<string, number> | null {
  return typeof def.unlock === "object" ? def.unlock.hybrid : null;
}

export function hybridReady(content: JobContent, ch: Character, job: string): boolean {
  const req = hybridRequirement(content.jobs[job]!);
  return !!req && Object.entries(req).every(([j, lv]) => levelIn(content, ch, j) >= lv);
}

/** Jobs this character may take as primary: discovered base jobs plus hybrids it has earned. */
export function availableJobs(content: JobContent, ch: Character, discovered: ReadonlySet<string>): string[] {
  return Object.entries(content.jobs)
    .filter(([id, def]) => (hybridRequirement(def) ? hybridReady(content, ch, id) : discovered.has(id)))
    .map(([id]) => id);
}

/** Jobs usable as a secondary: learned, not the primary, with at least one command learned. */
export function secondaryOptions(content: JobContent, ch: Character): string[] {
  return Object.keys(ch.jobXp).filter((j) => j !== ch.primary && learnedSkills(content, ch, j).length > 0);
}

export function maxHpOf(content: JobContent, ch: Character): number {
  const bonus = ch.support ? content.passives[ch.support]?.maxHp ?? 0 : 0;
  return content.jobs[ch.primary]!.hp + bonus;
}

export function traitsOf(content: JobContent, ch: Character): UnitTraits {
  const t: UnitTraits = {};
  for (const id of [ch.reaction, ch.support, ch.movement]) {
    if (id) Object.assign(t, content.passives[id]?.traits);
  }
  return t;
}

/**
 * Field abilities the party has on the map: any member with a field passive
 * equipped in its Movement slot. (Equipping it costs that member the slot in
 * battle: builds trade combat power for exploration reach.)
 */
export function fieldAbilities(content: JobContent, party: Character[]): Set<string> {
  const out = new Set<string>();
  for (const ch of party) {
    const f = ch.movement ? content.passives[ch.movement]?.field : undefined;
    if (f) out.add(f);
  }
  return out;
}

/** Battle commands: the primary job's learned skills, then the secondary's. */
export function battleSkills(content: JobContent, ch: Character): string[] {
  const skills = learnedSkills(content, ch, ch.primary);
  if (ch.secondary) for (const s of learnedSkills(content, ch, ch.secondary)) if (!skills.includes(s)) skills.push(s);
  return skills;
}

export function unitSpec(content: JobContent, ch: Character): UnitSpec {
  const job = content.jobs[ch.primary]!;
  return {
    id: ch.id,
    name: ch.name,
    side: "party",
    hp: ch.hp,
    maxHp: ch.maxHp,
    depth: ch.depth,
    lane: ch.lane,
    skills: battleSkills(content, ch),
    prefers: job.prefers,
    traits: traitsOf(content, ch),
    passives: PASSIVE_SLOTS.filter((slot) => ch[slot]).map((slot) => `${content.passives[ch[slot]!]!.name}: ${content.passives[ch[slot]!]!.desc}`),
    glyph: job.glyph,
    color: job.color,
    job: ch.primary,
  };
}

// ---------------------------------------------------------------------------
// Mutators

export interface CharacterSeed {
  id: string;
  name: string;
  kind: "person" | "creature";
  job: string;
  depth: number;
  lane: number;
}

export function createCharacter(content: JobContent, seed: CharacterSeed): Character {
  if (!content.jobs[seed.job]) throw new JobError(`Unknown job '${seed.job}'`);
  const ch: Character = {
    id: seed.id, name: seed.name, kind: seed.kind, hp: 0, maxHp: 0, depth: seed.depth, lane: seed.lane,
    jobXp: { [seed.job]: 0 }, primary: seed.job, secondary: null, reaction: null, support: null, movement: null,
  };
  ch.maxHp = maxHpOf(content, ch);
  ch.hp = ch.maxHp;
  return ch;
}

/** Recompute max HP after a loadout change, keeping the same fraction of HP. Downed stays down. */
function refreshHp(content: JobContent, ch: Character) {
  const before = ch.maxHp;
  ch.maxHp = maxHpOf(content, ch);
  if (ch.hp <= 0 || before === ch.maxHp) return;
  ch.hp = Math.max(1, Math.min(ch.maxHp, Math.round((ch.hp / before) * ch.maxHp)));
}

export function changeJob(content: JobContent, ch: Character, job: string, discovered: ReadonlySet<string>): void {
  if (!availableJobs(content, ch, discovered).includes(job)) throw new JobError(`${ch.name} can't become a ${job}`);
  ch.jobXp[job] ??= 0;
  ch.primary = job;
  if (ch.secondary === job) ch.secondary = null;
  refreshHp(content, ch);
}

export function setSecondary(content: JobContent, ch: Character, job: string | null): void {
  if (job !== null && !secondaryOptions(content, ch).includes(job)) throw new JobError(`${ch.name} can't use ${job} as a secondary`);
  ch.secondary = job;
}

export function equip(content: JobContent, ch: Character, slot: PassiveSlot, id: string | null): void {
  if (id !== null && !learnedPassives(content, ch, slot).includes(id)) throw new JobError(`${ch.name} hasn't learned ${id} (${slot})`);
  ch[slot] = id;
  refreshHp(content, ch);
}

/**
 * Award XP to the character's primary job. Returns what changed: level-ups,
 * newly learned abilities (passives auto-equip into an empty slot) and newly
 * unlocked hybrid jobs.
 */
export function gainXp(content: JobContent, ch: Character, amount: number, discovered: ReadonlySet<string>): ProgressNote[] {
  const notes: ProgressNote[] = [];
  const job = ch.primary;
  const before = levelIn(content, ch, job);
  const hybridsBefore = new Set(availableJobs(content, ch, discovered));
  ch.jobXp[job] = (ch.jobXp[job] ?? 0) + amount;
  const after = levelIn(content, ch, job);
  if (after === before) return notes;

  notes.push({ kind: "level", charId: ch.id, job, level: after });
  for (const a of content.jobs[job]!.abilities) {
    if (a.level <= before || a.level > after) continue;
    const passive = content.passives[a.id];
    let equipped = false;
    if (passive && ch[passive.slot] === null) {
      ch[passive.slot] = a.id;
      equipped = true;
    }
    notes.push({ kind: "learn", charId: ch.id, job, ability: a.id, equipped });
  }
  for (const j of availableJobs(content, ch, discovered)) {
    if (!hybridsBefore.has(j) && hybridRequirement(content.jobs[j]!)) notes.push({ kind: "hybrid", charId: ch.id, job: j });
  }
  refreshHp(content, ch);
  return notes;
}

/** Problems with the job data (unknown ids, bad levels, broken hybrid recipes). Empty = valid. */
export function validateJobContent(content: JobContent): string[] {
  const errors: string[] = [];
  const max = maxLevel(content);
  for (const [id, job] of Object.entries(content.jobs)) {
    for (const a of job.abilities) {
      if (!content.skills[a.id] && !content.passives[a.id]) errors.push(`${id}: unknown ability '${a.id}'`);
      if (a.level < 1 || a.level > max) errors.push(`${id}: '${a.id}' at unreachable level ${a.level}`);
    }
    if (!job.abilities.some((a) => a.level === 1 && content.skills[a.id])) errors.push(`${id}: no level-1 command`);
    const req = hybridRequirement(job);
    if (req) {
      for (const [j, lv] of Object.entries(req)) {
        if (!content.jobs[j]) errors.push(`${id}: hybrid needs unknown job '${j}'`);
        else if (hybridRequirement(content.jobs[j]!)) errors.push(`${id}: hybrid of a hybrid ('${j}')`);
        if (lv > max) errors.push(`${id}: hybrid needs unreachable level ${lv}`);
      }
    }
  }
  return errors;
}
