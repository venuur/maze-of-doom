/**
 * Deterministic battle engine. Round structure:
 *   1. Foes declare intents (shown on the grid)
 *   2. Player acts with each party member (move, then one skill) in any order
 *   3. Intents resolve against the updated board
 *   4. Hazards tick, round statuses clear, cooldowns tick
 *   5. Victory/defeat check, then next round's intents are declared
 */
import { Rng } from "../rng";
import {
  alive,
  canUseFrom,
  isAimed,
  legalAnchors,
  neighbours,
  onGrid,
  sameTile,
  shapeTiles,
  tileOf,
  unitAt,
  type ShapeResult,
} from "./grid";
import type {
  Action,
  BattleEvent,
  BattleSetup,
  BattleState,
  HazardDef,
  Intent,
  LateralDir,
  SkillDef,
  Tile,
  Unit,
} from "./types";

export const BUMP_DAMAGE = 1;
export const PREFERRED_DEPTH_BONUS = 1;

export interface BattleContent {
  skills: Record<string, SkillDef>;
  hazards: Record<string, HazardDef>;
}

export function createBattle(setup: BattleSetup, content: BattleContent, seed: number): BattleState {
  const units: Unit[] = [...setup.party, ...setup.foes].map((s) => {
    for (const sk of s.skills) if (!content.skills[sk]) throw new Error(`Unit ${s.id}: unknown skill '${sk}'`);
    if (!onGrid(s.depth, s.lane)) throw new Error(`Unit ${s.id}: off grid`);
    return {
      id: s.id,
      name: s.name,
      side: s.side,
      hp: s.hp,
      maxHp: s.hp,
      depth: s.depth,
      lane: s.lane,
      skills: [...s.skills],
      prefers: [...s.prefers],
      resist: { ...(s.resist ?? {}) },
      mobile: s.mobile ?? false,
      glyph: s.glyph,
      color: s.color,
      job: s.job,
      kind: s.kind,
      stun: 0,
      guard: false,
      taunt: false,
      cooldowns: {},
      moved: false,
      acted: false,
    };
  });
  const seen = new Set<string>();
  for (const u of units) {
    const k = `${u.side}:${u.depth}:${u.lane}`;
    if (seen.has(k)) throw new Error(`Two units on tile ${k}`);
    seen.add(k);
  }
  for (const h of setup.hazards ?? []) {
    if (!content.hazards[h.kind]) throw new Error(`Unknown hazard '${h.kind}'`);
  }
  const state: BattleState = {
    round: 1,
    phase: "player",
    units,
    intents: [],
    hazards: (setup.hazards ?? []).map((h) => ({ ...h, tile: { ...h.tile } })),
    rngState: new Rng(seed).state,
    log: [{ type: "round", round: 1 }],
    skills: content.skills,
    hazardDefs: content.hazards,
  };
  declareIntents(state);
  return state;
}

/** Cheap deep copy (content tables are shared, never mutated). */
export function cloneBattle(s: BattleState): BattleState {
  return {
    round: s.round,
    phase: s.phase,
    units: s.units.map((u) => ({
      ...u,
      skills: u.skills,
      prefers: u.prefers,
      resist: u.resist,
      cooldowns: { ...u.cooldowns },
    })),
    intents: s.intents.map((i) => ({ ...i, anchor: i.anchor && { ...i.anchor } })),
    hazards: s.hazards.map((h) => ({ ...h, tile: { ...h.tile } })),
    rngState: s.rngState,
    log: [...s.log],
    skills: s.skills,
    hazardDefs: s.hazardDefs,
  };
}

export function getUnit(state: BattleState, id: string): Unit {
  const u = state.units.find((x) => x.id === id);
  if (!u) throw new Error(`No unit '${id}'`);
  return u;
}

export function living(state: BattleState, side?: Unit["side"]): Unit[] {
  return state.units.filter((u) => u.hp > 0 && (!side || u.side === side));
}

// ---------------------------------------------------------------------------
// Queries used by the UI, the AIs, and validation
// ---------------------------------------------------------------------------

/** Damage `user`'s skill would deal to `target` right now. */
export function damageAmount(user: Unit | null, target: Unit, power: number, element: string): number {
  if (power <= 0) return 0;
  let base = power;
  if (user && user.prefers.includes(user.depth)) base += PREFERRED_DEPTH_BONUS;
  let mult = target.resist[element] ?? 1;
  if (mult <= 0) return 0;
  if (target.guard) mult *= 0.5;
  return Math.max(1, Math.floor(base * mult));
}

export function skillPower(user: Unit, skill: SkillDef, target: Unit): number {
  return damageAmount(user, target, skill.power ?? 0, skill.element ?? "physical");
}

export type UsableResult = { ok: true } | { ok: false; reason: string };

export function canUseSkill(state: BattleState, user: Unit, skillId: string): UsableResult {
  const skill = state.skills[skillId];
  if (!skill || !user.skills.includes(skillId)) return { ok: false, reason: "unknown skill" };
  if ((user.cooldowns[skillId] ?? 0) > 0) return { ok: false, reason: `cooldown ${user.cooldowns[skillId]}` };
  if (!canUseFrom(user, skill)) return { ok: false, reason: `use from depth ${skill.from!.map(depthName).join("/")}` };
  if (legalAnchors(state, user, skill).length === 0) return { ok: false, reason: "no valid target" };
  return { ok: true };
}

export function depthName(d: number): string {
  return ["front", "middle", "back"][d] ?? `${d}`;
}

/** Tiles a party member may step to: one orthogonal step on its own grid (swapping with an ally). */
export function legalMoves(state: BattleState, unit: Unit): Tile[] {
  if (state.phase !== "player" || unit.side !== "party" || unit.moved || unit.acted || unit.hp <= 0) return [];
  return neighbours(tileOf(unit));
}

/** Where an intent's anchor currently is (tracks a taunting unit). */
export function intentAnchor(state: BattleState, intent: Intent): Tile | null {
  if (intent.trackUnitId) {
    const t = state.units.find((u) => u.id === intent.trackUnitId);
    if (alive(t)) return tileOf(t);
  }
  return intent.anchor;
}

/** The tiles an intent would hit if it resolved against the board right now. */
export function intentTiles(state: BattleState, intent: Intent): ShapeResult {
  const actor = getUnit(state, intent.actorId);
  return shapeTiles(state, actor, state.skills[intent.skillId]!, intentAnchor(state, intent));
}

/** Predicted damage per unit for one intent against the current board. */
export function intentPreview(state: BattleState, intent: Intent): { unitId: string; amount: number }[] {
  const actor = getUnit(state, intent.actorId);
  const skill = state.skills[intent.skillId]!;
  return intentTiles(state, intent)
    .hit.map((t) => unitAt(state, t))
    .filter(alive)
    .map((u) => ({ unitId: u.id, amount: skillPower(actor, skill, u) }));
}

// ---------------------------------------------------------------------------
// Player actions
// ---------------------------------------------------------------------------

export class IllegalAction extends Error {}

export function applyAction(state: BattleState, action: Action): void {
  switch (action.type) {
    case "move":
      return moveUnit(state, action.unitId, action.to);
    case "skill":
      return useSkill(state, action.unitId, action.skillId, action.anchor, action.dir);
    case "wait":
      return waitUnit(state, action.unitId);
    case "endTurn":
      return endTurn(state);
  }
}

function requirePartyTurn(state: BattleState, unitId: string): Unit {
  if (state.phase !== "player") throw new IllegalAction("battle is over");
  const u = getUnit(state, unitId);
  if (u.side !== "party") throw new IllegalAction(`${u.name} is not in the party`);
  if (u.hp <= 0) throw new IllegalAction(`${u.name} is down`);
  if (u.acted) throw new IllegalAction(`${u.name} has already acted`);
  return u;
}

export function moveUnit(state: BattleState, unitId: string, to: Tile): void {
  const u = requirePartyTurn(state, unitId);
  if (u.moved) throw new IllegalAction(`${u.name} has already moved`);
  if (!legalMoves(state, u).some((t) => sameTile(t, to))) throw new IllegalAction("not an adjacent tile");
  const other = unitAt(state, to);
  if (other) {
    other.depth = u.depth;
    other.lane = u.lane;
  }
  u.depth = to.depth;
  u.lane = to.lane;
  u.moved = true;
  state.log.push({ type: "move", unitId, to: { ...to }, swappedWith: other?.id });
}

export function waitUnit(state: BattleState, unitId: string): void {
  const u = requirePartyTurn(state, unitId);
  u.moved = true;
  u.acted = true;
}

export function useSkill(state: BattleState, unitId: string, skillId: string, anchor: Tile | null, dir?: LateralDir): void {
  const u = requirePartyTurn(state, unitId);
  const usable = canUseSkill(state, u, skillId);
  if (!usable.ok) throw new IllegalAction(`${u.name} can't use ${skillId}: ${usable.reason}`);
  const skill = state.skills[skillId]!;
  if (isAimed(skill)) {
    if (!anchor || !legalAnchors(state, u, skill).some((t) => t && sameTile(t, anchor))) {
      throw new IllegalAction(`illegal target for ${skill.name}`);
    }
  }
  if (skill.displace === "lateral" && !dir) throw new IllegalAction(`${skill.name} needs a direction`);
  u.moved = true;
  u.acted = true;
  if (skill.cooldown) u.cooldowns[skillId] = skill.cooldown;
  state.log.push({ type: "skill", unitId, skillId });
  performSkill(state, u, skill, isAimed(skill) ? anchor : null, dir);
  checkEnd(state);
}

// ---------------------------------------------------------------------------
// Skill effects (shared by party actions and foe intents)
// ---------------------------------------------------------------------------

function performSkill(state: BattleState, user: Unit, skill: SkillDef, anchor: Tile | null, dir?: LateralDir): void {
  const { hit } = shapeTiles(state, user, skill, anchor);

  if (skill.hazard) {
    for (const t of hit) {
      const existing = state.hazards.find((h) => sameTile(h.tile, t));
      if (existing) {
        if (existing.turns !== null) existing.turns = Math.max(existing.turns, skill.hazard.turns ?? Infinity);
      } else {
        state.hazards.push({ tile: { ...t }, kind: skill.hazard.kind, turns: skill.hazard.turns });
      }
      state.log.push({ type: "hazard", tile: { ...t }, kind: skill.hazard.kind });
    }
  }

  const targets = hit.map((t) => unitAt(state, t)).filter(alive);
  if (targets.length === 0 && (skill.power || skill.displace || skill.stun || skill.cancel)) {
    state.log.push({ type: "miss", actorId: user.id, skillId: skill.id });
  }

  for (const t of targets) {
    if (skill.power) dealDamage(state, t, skillPower(user, skill, t), user.id, skill.element ?? "physical");
    if (skill.heal && t.hp > 0) {
      const amount = Math.min(skill.heal, t.maxHp - t.hp);
      t.hp += amount;
      state.log.push({ type: "heal", unitId: t.id, amount });
    }
    if (t.hp <= 0) continue;
    if (skill.stun) {
      t.stun = Math.max(t.stun, skill.stun);
      state.log.push({ type: "status", unitId: t.id, status: "stun" });
      cancelIntent(state, t.id);
    }
    if (skill.cancel) cancelIntent(state, t.id);
    if (skill.guard) {
      t.guard = true;
      state.log.push({ type: "status", unitId: t.id, status: "guard" });
    }
    if (skill.taunt) applyTaunt(state, t);
  }

  if (skill.displace) {
    const movers = targets.filter((t) => t.hp > 0 && t.id !== user.id);
    // Move the unit furthest along the push direction first, so a push of a
    // whole column/pair doesn't collide with units that are about to move.
    const key = (u: Unit) =>
      skill.displace === "back" ? -u.depth : skill.displace === "forward" ? u.depth : dir === "up" ? u.lane : -u.lane;
    movers.sort((a, b) => key(a) - key(b));
    for (const m of movers) displaceUnit(state, m, skill.displace, dir, skill.swapOnBlock);
  }
}

function applyTaunt(state: BattleState, taunter: Unit): void {
  taunter.taunt = true;
  state.log.push({ type: "status", unitId: taunter.id, status: "taunt" });
  // Aimed enemy attacks are redirected onto the taunter (and keep following it).
  for (const intent of state.intents) {
    const actor = getUnit(state, intent.actorId);
    if (actor.side === taunter.side) continue;
    const skill = state.skills[intent.skillId]!;
    if (skill.target !== "foe") continue;
    if (skill.shape === "single" || skill.shape === "cross" || skill.shape === "behind") {
      intent.trackUnitId = taunter.id;
      state.log.push({ type: "redirect", actorId: actor.id, toId: taunter.id });
    }
  }
}

function cancelIntent(state: BattleState, actorId: string): void {
  const before = state.intents.length;
  state.intents = state.intents.filter((i) => i.actorId !== actorId);
  if (state.intents.length < before) state.log.push({ type: "cancel", actorId });
}

function dealDamage(state: BattleState, target: Unit, amount: number, sourceId: string | null, element: string): void {
  if (target.hp <= 0) return;
  target.hp = Math.max(0, target.hp - amount);
  state.log.push({ type: "damage", unitId: target.id, amount, sourceId, element });
  if (target.hp === 0) {
    state.log.push({ type: "death", unitId: target.id });
    cancelIntent(state, target.id);
  }
}

function displaceUnit(
  state: BattleState,
  u: Unit,
  how: "back" | "forward" | "lateral",
  dir?: LateralDir,
  swapOnBlock = false,
): void {
  let depth = u.depth;
  let lane = u.lane;
  if (how === "back") depth += 1;
  else if (how === "forward") depth -= 1;
  else lane += dir === "up" ? -1 : 1;

  if (!onGrid(depth, lane)) {
    state.log.push({ type: "bump", unitId: u.id });
    dealDamage(state, u, BUMP_DAMAGE, null, "impact");
    return;
  }
  const blocker = unitAt(state, { side: u.side, depth, lane });
  if (blocker && swapOnBlock) {
    blocker.depth = u.depth;
    blocker.lane = u.lane;
    u.depth = depth;
    u.lane = lane;
    state.log.push({ type: "displace", unitId: u.id, to: tileOf(u) });
    state.log.push({ type: "displace", unitId: blocker.id, to: tileOf(blocker) });
    return;
  }
  if (blocker) {
    state.log.push({ type: "bump", unitId: u.id, intoId: blocker.id });
    dealDamage(state, u, BUMP_DAMAGE, null, "impact");
    dealDamage(state, blocker, BUMP_DAMAGE, null, "impact");
    return;
  }
  u.depth = depth;
  u.lane = lane;
  state.log.push({ type: "displace", unitId: u.id, to: tileOf(u) });
}

// ---------------------------------------------------------------------------
// Round resolution
// ---------------------------------------------------------------------------

export interface EndTurnOptions {
  /** Skip declaring next round's intents (used by AI lookahead). */
  declare?: boolean;
}

export function endTurn(state: BattleState, opts: EndTurnOptions = {}): void {
  if (state.phase !== "player") throw new IllegalAction("battle is over");

  // 3. Intents resolve in declaration order against the current board.
  const queue = state.intents;
  state.intents = [];
  for (const intent of queue) {
    if (state.phase !== "player") break;
    const actor = state.units.find((u) => u.id === intent.actorId);
    if (!alive(actor) || actor.stun > 0) continue;
    const skill = state.skills[intent.skillId]!;
    if (skill.cooldown) actor.cooldowns[skill.id] = skill.cooldown;
    performSkill(state, actor, skill, intentAnchor(state, intent), intent.dir);
    checkEnd(state);
  }

  // 4. Hazards tick.
  if (state.phase === "player") {
    for (const h of state.hazards) {
      const def = state.hazardDefs[h.kind]!;
      const u = unitAt(state, h.tile);
      if (u) dealDamage(state, u, damageAmount(null, u, def.power, def.element), null, def.element);
    }
    state.hazards = state.hazards
      .map((h) => (h.turns === null ? h : { ...h, turns: h.turns - 1 }))
      .filter((h) => h.turns === null || h.turns > 0);
    checkEnd(state);
  }

  for (const u of state.units) {
    u.guard = false;
    u.taunt = false;
    u.moved = false;
    u.acted = false;
    for (const k of Object.keys(u.cooldowns)) {
      u.cooldowns[k] = Math.max(0, u.cooldowns[k]! - 1);
      if (u.cooldowns[k] === 0) delete u.cooldowns[k];
    }
  }

  if (state.phase !== "player") return;
  state.round += 1;
  state.log.push({ type: "round", round: state.round });
  if (opts.declare !== false) declareIntents(state);
}

function checkEnd(state: BattleState): void {
  if (state.phase !== "player") return;
  if (living(state, "foe").length === 0) {
    state.phase = "won";
    state.intents = [];
    state.log.push({ type: "end", result: "won" });
  } else if (living(state, "party").length === 0) {
    state.phase = "lost";
    state.intents = [];
    state.log.push({ type: "end", result: "lost" });
  }
}

// ---------------------------------------------------------------------------
// Foe intent declaration
// ---------------------------------------------------------------------------

/** How much a foe wants to use `skill` from where it stands. Higher is better. */
function scoreFoeOption(state: BattleState, foe: Unit, skill: SkillDef, anchor: Tile | null): number {
  let score = 0;
  for (const t of shapeTiles(state, foe, skill, anchor).hit) {
    const u = unitAt(state, t);
    if (!u) continue;
    const dmg = skillPower(foe, skill, u);
    if (u.side === foe.side) score -= dmg * 1.5;
    else score += dmg + (dmg >= u.hp ? 4 : 0);
  }
  return score;
}

interface FoeOption {
  depth: number;
  lane: number;
  skillId: string;
  anchor: Tile | null;
  score: number;
}

/**
 * Every living foe announces what it will do. Mobile foes may first step one
 * tile. Choices are greedy with a seeded chance of a lesser option, so fights
 * vary by seed but replay exactly.
 */
export function declareIntents(state: BattleState): void {
  const rng = new Rng(state.rngState);
  for (const foe of living(state, "foe")) {
    if (foe.stun > 0) {
      foe.stun -= 1;
      state.log.push({ type: "stunned", unitId: foe.id });
      continue;
    }
    const home = { depth: foe.depth, lane: foe.lane };
    const spots = [home];
    if (foe.mobile) {
      for (const n of neighbours(tileOf(foe))) {
        const hazard = state.hazards.some((h) => sameTile(h.tile, n));
        if (!unitAt(state, n) && !hazard) spots.push({ depth: n.depth, lane: n.lane });
      }
    }
    const options: FoeOption[] = [];
    for (const spot of spots) {
      foe.depth = spot.depth;
      foe.lane = spot.lane;
      const moved = spot !== home;
      for (const skillId of foe.skills) {
        const skill = state.skills[skillId]!;
        if ((foe.cooldowns[skillId] ?? 0) > 0 || !canUseFrom(foe, skill)) continue;
        for (const anchor of legalAnchors(state, foe, skill)) {
          options.push({ ...spot, skillId, anchor, score: scoreFoeOption(state, foe, skill, anchor) - (moved ? 0.5 : 0) });
        }
      }
    }
    foe.depth = home.depth;
    foe.lane = home.lane;
    if (options.length === 0) continue;

    options.sort((a, b) => b.score - a.score);
    const best = options.filter((o) => o.score === options[0]!.score);
    const choice = rng.next() < 0.75 ? rng.pick(best) : rng.pick(options.slice(0, 3));

    if (choice.depth !== foe.depth || choice.lane !== foe.lane) {
      foe.depth = choice.depth;
      foe.lane = choice.lane;
      state.log.push({ type: "move", unitId: foe.id, to: tileOf(foe) });
    }
    state.intents.push({ actorId: foe.id, skillId: choice.skillId, anchor: choice.anchor && { ...choice.anchor } });
    state.log.push({ type: "intent", actorId: foe.id, skillId: choice.skillId });
  }
  state.rngState = rng.state;
}

export type { BattleEvent };
