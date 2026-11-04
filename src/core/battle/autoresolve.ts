/**
 * Instant-win check (Earthbound-style). Rather than a hand-tuned power
 * formula, play the battle headlessly with the planner: if the party would
 * win quickly and nearly unscathed, the fight is skipped.
 */
import { applyAction, createBattle, endTurn, type BattleContent } from "./engine";
import { FULL_PLANNER, planTurn } from "./planner";
import type { BattleSetup, BattleState } from "./types";

export interface InstantWinRule {
  /** Party must win within this many rounds. */
  maxRounds: number;
  /** ...losing at most this fraction of its current total HP. */
  maxHpLoss: number;
}

export const DEFAULT_INSTANT_WIN: InstantWinRule = { maxRounds: 2, maxHpLoss: 0.1 };

export interface Assessment {
  instantWin: boolean;
  /** How the simulated battle went (for tuning / debug). */
  won: boolean;
  rounds: number;
  hpLoss: number;
}

/** Simulate `setup` with the planner, stopping at the round limit. */
export function simulate(setup: BattleSetup, content: BattleContent, seed: number, maxRounds: number): BattleState {
  const s = createBattle(setup, content, seed);
  while (s.phase === "player" && s.round <= maxRounds) {
    for (const a of planTurn(s, FULL_PLANNER)) {
      applyAction(s, a);
      if (s.phase !== "player") break;
    }
    if (s.phase === "player") endTurn(s);
  }
  return s;
}

export function assessEncounter(
  setup: BattleSetup,
  content: BattleContent,
  seed: number,
  rule: InstantWinRule = DEFAULT_INSTANT_WIN,
): Assessment {
  const startHp = setup.party.reduce((a, u) => a + Math.max(0, u.hp), 0);
  const end = simulate(setup, content, seed, rule.maxRounds);
  const endHp = end.units.filter((u) => u.side === "party").reduce((a, u) => a + u.hp, 0);
  const hpLoss = startHp > 0 ? (startHp - endHp) / startHp : 1;
  const won = end.phase === "won";
  return { instantWin: won && end.round <= rule.maxRounds && hpLoss <= rule.maxHpLoss, won, rounds: end.round, hpLoss };
}
