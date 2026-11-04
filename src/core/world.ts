/**
 * Overworld state and rules: player movement, collision, visible enemies.
 * Deterministic given the RNG seed and the sequence of inputs. No DOM, no timing.
 */
import { Rng } from "./rng";
import { featureAt, isPassable, tileAt, type Zone } from "./zone";

export type Dir = "up" | "down" | "left" | "right";
export const DIRS: readonly Dir[] = ["up", "down", "left", "right"];

export const DELTA: Record<Dir, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

export interface EnemyKind {
  name: string;
  shape: string;
  color: string;
  behavior: "wander" | "still";
  /** Max tiles (Chebyshev) an enemy will roam from its spawn. */
  radius: number;
  /** Default battle encounter for this kind. */
  encounter?: string;
  battle?: {
    /** Job XP this foe is worth to each surviving party member. */
    xp?: number;
    hp: number;
    prefers: number[];
    mobile: boolean;
    skills: string[];
    resist?: Record<string, number>;
  };
}

export interface Actor {
  x: number;
  y: number;
  facing: Dir;
}

export interface Enemy extends Actor {
  id: string;
  kind: string;
  encounter?: string;
  homeX: number;
  homeY: number;
}

export interface World {
  zone: Zone;
  player: Actor;
  enemies: Enemy[];
  enemyKinds: Record<string, EnemyKind>;
  /** Field abilities equipped by the party (e.g. "float"). Empty until Milestone 5. */
  abilities: Set<string>;
  rng: Rng;
}

/** Things that happened during a step, for the presentation layer to react to. */
export type WorldEvent =
  | { type: "moved"; who: "player" | string; fromX: number; fromY: number }
  | { type: "turned"; who: "player" }
  | { type: "blocked" }
  | { type: "encounter"; enemyId: string; initiator: "player" | "enemy" }
  | { type: "interact"; featureId: string }
  | { type: "exit"; x: number; y: number }
  | { type: "rest" };

export function createWorld(zone: Zone, enemyKinds: Record<string, EnemyKind>, seed: number): World {
  for (const s of zone.spawns) {
    if (!enemyKinds[s.kind]) throw new Error(`Unknown enemy kind '${s.kind}' in zone ${zone.id}`);
  }
  return {
    zone,
    player: { x: zone.start.x, y: zone.start.y, facing: "down" },
    enemies: zone.spawns.map((s) => ({
      id: s.id,
      kind: s.kind,
      encounter: s.encounter,
      x: s.x,
      y: s.y,
      homeX: s.x,
      homeY: s.y,
      facing: "down",
    })),
    enemyKinds,
    abilities: new Set(),
    rng: new Rng(seed),
  };
}

export function removeEnemy(world: World, id: string): void {
  world.enemies = world.enemies.filter((e) => e.id !== id);
}

export function enemyAt(world: World, x: number, y: number): Enemy | undefined {
  return world.enemies.find((e) => e.x === x && e.y === y);
}

/** Try to move the player one tile. Bumping a visible enemy starts an encounter. */
export function movePlayer(world: World, dir: Dir): WorldEvent[] {
  const p = world.player;
  p.facing = dir;
  const { dx, dy } = DELTA[dir];
  const nx = p.x + dx;
  const ny = p.y + dy;

  const enemy = enemyAt(world, nx, ny);
  if (enemy) return [{ type: "encounter", enemyId: enemy.id, initiator: "player" }];
  const feature = featureAt(world.zone, nx, ny);
  if (feature) return [{ type: "interact", featureId: feature.id }];

  if (!isPassable(world.zone, nx, ny, world.abilities)) return [{ type: "blocked" }];

  const fromX = p.x;
  const fromY = p.y;
  p.x = nx;
  p.y = ny;
  const events: WorldEvent[] = [{ type: "moved", who: "player", fromX, fromY }];
  const tile = tileAt(world.zone, nx, ny);
  if (tile?.exit) events.push({ type: "exit", x: nx, y: ny });
  if (tile?.rest) events.push({ type: "rest" });
  return events;
}

/**
 * Advance every enemy by one wander step. Enemies stay within their roam
 * radius, never overlap each other, and touching the player starts an encounter.
 */
export function stepEnemies(world: World): WorldEvent[] {
  const events: WorldEvent[] = [];
  for (const e of world.enemies) {
    const kind = world.enemyKinds[e.kind]!;
    if (kind.behavior !== "wander") continue;
    // Consume RNG identically regardless of outcome, keeping sequences stable.
    const roll = world.rng.next();
    const dir = world.rng.pick(DIRS);
    if (roll < 0.4) continue; // idle this tick

    const { dx, dy } = DELTA[dir];
    const nx = e.x + dx;
    const ny = e.y + dy;
    e.facing = dir;

    if (nx === world.player.x && ny === world.player.y) {
      events.push({ type: "encounter", enemyId: e.id, initiator: "enemy" });
      continue;
    }
    const withinRadius = Math.max(Math.abs(nx - e.homeX), Math.abs(ny - e.homeY)) <= kind.radius;
    if (!withinRadius) continue;
    // Enemies don't use the party's field abilities.
    if (!isPassable(world.zone, nx, ny, NO_ABILITIES)) continue;
    const tile = tileAt(world.zone, nx, ny);
    if (tile?.exit || tile?.rest) continue;
    if (featureAt(world.zone, nx, ny)) continue;
    if (enemyAt(world, nx, ny)) continue;

    const fromX = e.x;
    const fromY = e.y;
    e.x = nx;
    e.y = ny;
    events.push({ type: "moved", who: e.id, fromX, fromY });
  }
  return events;
}

const NO_ABILITIES: ReadonlySet<string> = new Set();
