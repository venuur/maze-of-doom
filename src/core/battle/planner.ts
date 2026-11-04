/**
 * Party-side AI: greedy search with one round of lookahead. For each party
 * member (best first), try every move x skill x target, simulate the foes'
 * telegraphed intents resolving, and keep the best outcome.
 *
 * Used for headless balance simulation and the sandbox "Auto" button.
 */
import { canUseSkill, cloneBattle, endTurn, legalMoves, living, moveUnit, useSkill, waitUnit } from "./engine";
import { legalAnchors } from "./grid";
import type { Action, BattleState, LateralDir, SkillDef, Unit } from "./types";

export interface PlannerOptions {
  /** Simulate intent resolution when scoring (i.e. read the telegraphs). */
  lookahead: boolean;
  /** Allow stepping before acting. */
  allowMove: boolean;
  /** Restrict which skills the planner may use. */
  skillFilter?: (s: SkillDef) => boolean;
}

export const FULL_PLANNER: PlannerOptions = { lookahead: true, allowMove: true };

/** Pure damage skills: no displacement, interrupts, redirects, guards, swaps or hazards. */
export const isDamageOnly = (s: SkillDef) =>
  !!s.power && !s.displace && !s.cancel && !s.stun && !s.taunt && !s.guard && !s.hazard && !s.heal;

function snapshot(s: BattleState) {
  let partyHp = 0, foeHp = 0, partyAlive = 0, foeAlive = 0;
  for (const u of s.units) {
    if (u.side === "party") { partyHp += u.hp; if (u.hp > 0) partyAlive++; }
    else { foeHp += u.hp; if (u.hp > 0) foeAlive++; }
  }
  return { partyHp, foeHp, partyAlive, foeAlive };
}

function score(before: BattleState, after: BattleState): number {
  const a = snapshot(before);
  const b = snapshot(after);
  let v = (a.foeHp - b.foeHp) * 1 + (a.foeAlive - b.foeAlive) * 5;
  v -= (a.partyHp - b.partyHp) * 1.3 + (a.partyAlive - b.partyAlive) * 12;
  if (after.phase === "won") v += 100;
  if (after.phase === "lost") v -= 100;
  return v;
}

/** All complete action sequences (optional move, then skill or wait) for one unit. */
export function unitOptions(state: BattleState, unit: Unit, opts: PlannerOptions): Action[][] {
  const out: Action[][] = [];
  const moves = opts.allowMove && !unit.moved ? [null, ...legalMoves(state, unit)] : [null];
  for (const to of moves) {
    const s = cloneBattle(state);
    const prefix: Action[] = [];
    if (to) {
      moveUnit(s, unit.id, to);
      prefix.push({ type: "move", unitId: unit.id, to });
    }
    const u = s.units.find((x) => x.id === unit.id)!;
    out.push([...prefix, { type: "wait", unitId: unit.id }]);
    for (const skillId of u.skills) {
      const skill = s.skills[skillId]!;
      if (opts.skillFilter && !opts.skillFilter(skill)) continue;
      if (!canUseSkill(s, u, skillId).ok) continue;
      const dirs: (LateralDir | undefined)[] = skill.displace === "lateral" ? ["up", "down"] : [undefined];
      for (const anchor of legalAnchors(s, u, skill)) {
        for (const dir of dirs) out.push([...prefix, { type: "skill", unitId: unit.id, skillId, anchor, dir }]);
      }
    }
  }
  return out;
}

function play(s: BattleState, actions: Action[]): void {
  for (const a of actions) {
    if (a.type === "move") moveUnit(s, a.unitId, a.to);
    else if (a.type === "skill") useSkill(s, a.unitId, a.skillId, a.anchor, a.dir);
    else if (a.type === "wait") waitUnit(s, a.unitId);
  }
}

/**
 * Plan the party's remaining actions this round. Does not mutate `state`.
 * Returns the actions in order (not including endTurn).
 */
export function planTurn(state: BattleState, opts: PlannerOptions = FULL_PLANNER): Action[] {
  const work = cloneBattle(state);
  const plan: Action[] = [];
  for (;;) {
    if (work.phase !== "player") break;
    const ready = living(work, "party").filter((u) => !u.acted);
    if (ready.length === 0) break;

    let best: { actions: Action[]; value: number } | null = null;
    for (const unit of ready) {
      for (const actions of unitOptions(work, unit, opts)) {
        const sim = cloneBattle(work);
        play(sim, actions);
        if (opts.lookahead && sim.phase === "player") endTurn(sim, { declare: false });
        // Small bias toward acting over waiting, and staying put over moving.
        const bias = (actions.some((a) => a.type === "skill") ? 0.05 : 0) - (actions[0]?.type === "move" ? 0.01 : 0);
        const value = score(work, sim) + bias;
        if (!best || value > best.value) best = { actions, value };
      }
    }
    if (!best) break;
    play(work, best.actions);
    plan.push(...best.actions);
  }
  return plan;
}
