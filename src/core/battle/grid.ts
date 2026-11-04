/** Grid geometry and target shapes. Pure functions over BattleState. */
import type { BattleState, Side, SkillDef, Tile, Unit } from "./types";

export const SIZE = 3;
export const DEPTHS = [0, 1, 2] as const;
export const LANES = [0, 1, 2] as const;

export const otherSide = (s: Side): Side => (s === "party" ? "foe" : "party");
export const onGrid = (depth: number, lane: number) => depth >= 0 && depth < SIZE && lane >= 0 && lane < SIZE;
export const sameTile = (a: Tile, b: Tile) => a.side === b.side && a.depth === b.depth && a.lane === b.lane;
export const tileKey = (t: Tile) => `${t.side}:${t.depth}:${t.lane}`;
export const tileOf = (u: Unit): Tile => ({ side: u.side, depth: u.depth, lane: u.lane });

export function sideTiles(side: Side): Tile[] {
  const out: Tile[] = [];
  for (const depth of DEPTHS) for (const lane of LANES) out.push({ side, depth, lane });
  return out;
}

export function alive(u: Unit | undefined): u is Unit {
  return !!u && u.hp > 0;
}

export function unitAt(state: BattleState, t: Tile): Unit | undefined {
  return state.units.find((u) => u.hp > 0 && u.side === t.side && u.depth === t.depth && u.lane === t.lane);
}

export function neighbours(t: Tile): Tile[] {
  return [
    { ...t, depth: t.depth - 1 },
    { ...t, depth: t.depth + 1 },
    { ...t, lane: t.lane - 1 },
    { ...t, lane: t.lane + 1 },
  ].filter((n) => onGrid(n.depth, n.lane));
}

/** The side a skill's anchor is chosen on. */
export function targetSide(user: Unit, skill: SkillDef): Side {
  return skill.target === "foe" ? otherSide(user.side) : user.side;
}

/** Does this shape take a chosen anchor tile? */
export function isAimed(skill: SkillDef): boolean {
  return skill.shape === "single" || skill.shape === "column" || skill.shape === "cross" || skill.shape === "behind";
}

/**
 * Path a line projectile travels from the user: toward its own front, then
 * across the opposing grid front-to-back, all in the user's lane.
 */
export function linePath(user: Unit): Tile[] {
  const path: Tile[] = [];
  for (let d = user.depth - 1; d >= 0; d--) path.push({ side: user.side, depth: d, lane: user.lane });
  const foe = otherSide(user.side);
  for (let d = 0; d < SIZE; d++) path.push({ side: foe, depth: d, lane: user.lane });
  return path;
}

export interface ShapeResult {
  /** Tiles the skill actually affects. */
  hit: Tile[];
  /** For lines: the full travel path (for telegraph display). */
  path: Tile[];
}

/** Tiles affected by a skill used by `user` with `anchor`, against the board as it is now. */
export function shapeTiles(state: BattleState, user: Unit, skill: SkillDef, anchor: Tile | null): ShapeResult {
  const side = targetSide(user, skill);
  switch (skill.shape) {
    case "self":
      return { hit: [tileOf(user)], path: [] };
    case "line": {
      const full = linePath(user);
      const i = full.findIndex((t) => unitAt(state, t));
      // The projectile stops at the first unit; show only the stretch it travels.
      return i < 0 ? { hit: [], path: full } : { hit: [full[i]!], path: full.slice(0, i + 1) };
    }
    case "lane":
      return { hit: DEPTHS.map((depth) => ({ side, depth, lane: user.lane })), path: [] };
    case "ownLane":
      return { hit: DEPTHS.map((depth) => ({ side: user.side, depth, lane: user.lane })), path: [] };
    default:
      break;
  }
  if (!anchor) return { hit: [], path: [] };
  switch (skill.shape) {
    case "single":
      return { hit: [anchor], path: [] };
    case "column":
      return { hit: LANES.map((lane) => ({ side: anchor.side, depth: anchor.depth, lane })), path: [] };
    case "cross":
      return { hit: [anchor, ...neighbours(anchor)], path: [] };
    case "behind": {
      const hit = [anchor];
      if (onGrid(anchor.depth + 1, anchor.lane)) hit.push({ ...anchor, depth: anchor.depth + 1 });
      return { hit, path: [] };
    }
  }
  return { hit: [], path: [] };
}

/** Legal anchors for a skill. [null] for shapes that take no anchor. */
export function legalAnchors(state: BattleState, user: Unit, skill: SkillDef): (Tile | null)[] {
  if (!isAimed(skill)) return [null];
  const side = targetSide(user, skill);
  const reach = skill.reach ?? [0, 1, 2];
  const needsUnit = (skill.shape === "single" || skill.shape === "behind") && !skill.emptyOk;
  return sideTiles(side).filter((t) => {
    if (!reach.includes(t.depth)) return false;
    const occupant = unitAt(state, t);
    if (needsUnit && !occupant) return false;
    if (skill.notSelf && occupant?.id === user.id) return false;
    return true;
  });
}

export function canUseFrom(user: Unit, skill: SkillDef): boolean {
  return !skill.from || skill.from.includes(user.depth);
}
