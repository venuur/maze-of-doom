/**
 * The player's strategy profile, as the Maze sees it: what kinds of damage
 * the party deals, which skills and jobs it leans on, how long fights take.
 * Recent battles weigh more (older totals decay), so the Maze tracks your
 * current habits rather than your whole history. Pure; no DOM.
 */
import type { BattleState, SkillDef } from "../battle/types";

export interface StrategyProfile {
  battles: number;
  /** Decayed totals. */
  damage: Record<string, number>;
  skills: Record<string, number>;
  jobs: Record<string, number>;
  /** Decayed count of skill uses that push, pull, shove or swap. */
  displacement: number;
  /** Decayed count of guard/taunt skill uses. */
  defense: number;
  skillUses: number;
  /** Decayed average rounds per fought battle. */
  avgRounds: number;
}

/** Each battle, older totals keep this fraction of their weight. */
export const PROFILE_DECAY = 0.85;

export function emptyProfile(): StrategyProfile {
  return { battles: 0, damage: {}, skills: {}, jobs: {}, displacement: 0, defense: 0, skillUses: 0, avgRounds: 0 };
}

function decay(p: StrategyProfile) {
  for (const table of [p.damage, p.skills, p.jobs]) for (const k of Object.keys(table)) table[k] = table[k]! * PROFILE_DECAY;
  p.displacement *= PROFILE_DECAY;
  p.defense *= PROFILE_DECAY;
  p.skillUses *= PROFILE_DECAY;
}

const bump = (t: Record<string, number>, k: string, n = 1) => (t[k] = (t[k] ?? 0) + n);

/** Learn from a fought battle (won, lost or abandoned). */
export function recordBattle(p: StrategyProfile, battle: BattleState): void {
  decay(p);
  p.battles += 1;
  const party = new Set(battle.units.filter((u) => u.side === "party").map((u) => u.id));
  for (const u of battle.units) if (u.side === "party" && u.job) bump(p.jobs, u.job);
  for (const e of battle.log) {
    if (e.type === "skill" && party.has(e.unitId)) {
      const s: SkillDef | undefined = battle.skills[e.skillId];
      bump(p.skills, e.skillId);
      p.skillUses += 1;
      if (s?.displace) p.displacement += 1;
      if (s?.guard || s?.taunt) p.defense += 1;
    } else if (e.type === "damage" && e.sourceId && party.has(e.sourceId) && e.element !== "impact") {
      bump(p.damage, e.element, e.amount);
    }
  }
  // The first fought battle seeds the average (instant wins don't count toward it).
  p.avgRounds = p.avgRounds === 0 ? battle.round : p.avgRounds * PROFILE_DECAY + battle.round * (1 - PROFILE_DECAY);
}

/** An instant win teaches the Maze little: only that you're winning. */
export function recordInstantWin(p: StrategyProfile): void {
  p.battles += 1;
}

export type Tactic = "fire" | "physical" | "displacement" | "defense";

export interface Habit {
  tactic: Tactic;
  /** How far past its threshold the habit is (higher = more blatant). */
  strength: number;
  /** Share behind it, for commentary (0..1). */
  share: number;
}

/** Thresholds: a habit has to be both a large share and backed by enough evidence. */
export const HABIT_RULES = {
  minBattles: 3,
  minDamage: 25,
  elementShare: 0.55,
  minSkillUses: 8,
  displacementShare: 0.3,
  defenseShare: 0.3,
} as const;

/** The party's most blatant habit, or null if it plays too evenly (or too little) to read. */
export function dominantHabit(p: StrategyProfile): Habit | null {
  if (p.battles < HABIT_RULES.minBattles) return null;
  const habits: Habit[] = [];
  const total = Object.values(p.damage).reduce((a, b) => a + b, 0);
  if (total >= HABIT_RULES.minDamage) {
    for (const el of ["fire", "physical"] as const) {
      const share = (p.damage[el] ?? 0) / total;
      if (share >= HABIT_RULES.elementShare) habits.push({ tactic: el, share, strength: share - HABIT_RULES.elementShare });
    }
  }
  if (p.skillUses >= HABIT_RULES.minSkillUses) {
    const d = p.displacement / p.skillUses;
    if (d >= HABIT_RULES.displacementShare) habits.push({ tactic: "displacement", share: d, strength: d - HABIT_RULES.displacementShare });
    const g = p.defense / p.skillUses;
    if (g >= HABIT_RULES.defenseShare) habits.push({ tactic: "defense", share: g, strength: g - HABIT_RULES.defenseShare });
  }
  habits.sort((a, b) => b.strength - a.strength);
  return habits[0] ?? null;
}

/** Top entries of a decayed table, for display. */
export function topOf(t: Record<string, number>, n = 3): { key: string; share: number }[] {
  const total = Object.values(t).reduce((a, b) => a + b, 0) || 1;
  return Object.entries(t)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key, v]) => ({ key, share: v / total }));
}
