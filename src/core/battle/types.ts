/** Battle data model. Plain objects only, so state clones and serializes cheaply. */

export type Side = "party" | "foe";

/** A tile on one side's 3x3 grid. depth 0 = front (nearest the enemy), 2 = back. lane = row 0..2. */
export interface Tile {
  side: Side;
  depth: number;
  lane: number;
}

export type Shape =
  | "self" // the user
  | "single" // one chosen tile
  | "line" // projectile down the user's lane: hits the FIRST unit in its path, friend or foe
  | "lane" // every tile of the user's lane on the opposing grid
  | "ownLane" // every tile of the user's lane on its own grid
  | "column" // every lane at a chosen depth
  | "cross" // chosen tile plus its four neighbours
  | "behind"; // chosen tile plus the tile directly behind it

export type Displace = "back" | "forward" | "lateral";
export type LateralDir = "up" | "down";

export interface SkillDef {
  id: string;
  name: string;
  desc: string;
  target: "foe" | "ally" | "self";
  shape: Shape;
  /** Depths the user must stand in to use this. Default: any. */
  from?: number[];
  /** Depths on the target grid that may be chosen as the anchor. Default: any. */
  reach?: number[];
  /** Anchor may be an empty tile (single/behind/ally otherwise need a unit). */
  emptyOk?: boolean;
  /** Anchor may not be the user (ally targeting). */
  notSelf?: boolean;
  power?: number;
  element?: string;
  heal?: number;
  displace?: Displace;
  /** Rounds the target skips declaring. Also cancels its current intent. */
  stun?: number;
  /** Cancel the target's current intent. */
  cancel?: boolean;
  guard?: boolean;
  taunt?: boolean;
  /** Displacement into an occupied tile swaps the two units instead of bumping. */
  swapOnBlock?: boolean;
  hazard?: { kind: string; turns: number | null };
  /** Usable again this many rounds after use. */
  cooldown?: number;
}

export interface UnitSpec {
  id: string;
  name: string;
  side: Side;
  hp: number;
  depth: number;
  lane: number;
  skills: string[];
  /** Preferred depths: +1 power to damaging skills used from here. */
  prefers: number[];
  resist?: Record<string, number>;
  /** Foes only: may step one tile when declaring an intent. */
  mobile?: boolean;
  /** Presentation hints (ignored by the engine). */
  glyph?: string;
  color?: string;
  job?: string;
  kind?: string;
}

export interface Unit extends Required<Omit<UnitSpec, "glyph" | "color" | "job" | "kind">> {
  glyph?: string;
  color?: string;
  job?: string;
  kind?: string;
  maxHp: number;
  stun: number;
  guard: boolean;
  taunt: boolean;
  cooldowns: Record<string, number>;
  moved: boolean;
  acted: boolean;
}

export interface Intent {
  actorId: string;
  skillId: string;
  /** Locked anchor tile for aimed shapes; null for positional shapes (line/lane/self). */
  anchor: Tile | null;
  /** Taunted: the anchor follows this unit wherever it goes. */
  trackUnitId?: string;
  dir?: LateralDir;
}

export interface HazardDef {
  name: string;
  power: number;
  element: string;
}

export interface Hazard {
  tile: Tile;
  kind: string;
  /** Rounds remaining; null = permanent (e.g. lava). */
  turns: number | null;
}

export type Phase = "player" | "won" | "lost";

export type BattleEvent =
  | { type: "round"; round: number }
  | { type: "intent"; actorId: string; skillId: string }
  | { type: "stunned"; unitId: string }
  | { type: "move"; unitId: string; to: Tile; swappedWith?: string }
  | { type: "skill"; unitId: string; skillId: string }
  | { type: "damage"; unitId: string; amount: number; sourceId: string | null; element: string }
  | { type: "heal"; unitId: string; amount: number }
  | { type: "displace"; unitId: string; to: Tile }
  | { type: "bump"; unitId: string; intoId?: string }
  | { type: "status"; unitId: string; status: "stun" | "guard" | "taunt" }
  | { type: "cancel"; actorId: string }
  | { type: "redirect"; actorId: string; toId: string }
  | { type: "hazard"; tile: Tile; kind: string }
  | { type: "miss"; actorId: string; skillId: string }
  | { type: "death"; unitId: string }
  | { type: "end"; result: "won" | "lost" };

export interface BattleState {
  round: number;
  phase: Phase;
  units: Unit[];
  intents: Intent[];
  hazards: Hazard[];
  rngState: number;
  log: BattleEvent[];
  /** Content tables: shared, never mutated, not copied by cloneBattle. */
  skills: Readonly<Record<string, SkillDef>>;
  hazardDefs: Readonly<Record<string, HazardDef>>;
}

export interface BattleSetup {
  party: UnitSpec[];
  foes: UnitSpec[];
  hazards?: Hazard[];
}

export type Action =
  | { type: "move"; unitId: string; to: Tile }
  | { type: "skill"; unitId: string; skillId: string; anchor: Tile | null; dir?: LateralDir }
  | { type: "wait"; unitId: string }
  | { type: "endTurn" };
