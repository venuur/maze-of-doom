/** Zone data model and loading/validation. Pure, no DOM. */
import type { Hazard, UnitTraits } from "./battle/types";

export interface TileDef {
  id: string;
  solid: boolean;
  color: string;
  /** Field ability that lets a character enter this otherwise-solid tile. */
  gate?: string;
  exit?: boolean;
  /** Stepping here restores the party. */
  rest?: boolean;
  /** Renderer style to reuse (defaults to id), e.g. "wall" for a themed wall. */
  draw?: string;
}

/** A battle: foes in formation plus optional tile hazards. */
export interface EncounterDef {
  name: string;
  desc: string;
  foes: { kind: string; depth: number; lane: number }[];
  hazards?: Hazard[];
  /** Applied to every foe (counter zones): resistances multiply in, traits are added. */
  mods?: { resist?: Record<string, number>; traits?: UnitTraits };
  /** XP multiplier (counter zones pay better). */
  xpMult?: number;
}

/** A way out of a zone. Links between exits live in the session's zone graph. */
export interface ZoneExit {
  id: string;
  x: number;
  y: number;
  /** Where you stand when arriving through this exit. */
  arrive: { x: number; y: number };
}

export type TileTable = Record<string, TileDef>;

export interface ZoneRecipe {
  theme: string;
  twist: string;
  landmark: string;
  secret: string;
  story: string;
}

export interface EnemySpawn {
  id: string;
  kind: string;
  x: number;
  y: number;
  /** Battle encounter this enemy leads. Defaults to its kind's encounter. */
  encounter?: string;
}

/**
 * Something on the map you can walk up to and touch (solid): a source of a
 * discoverable job (a hermit, an abandoned weapon, ...) or a relic to collect.
 */
export interface Feature {
  id: string;
  kind: "job" | "relic" | "lore";
  /** kind "job": the job taught by this feature. */
  job?: string;
  /** kind "relic": job XP granted to every member when collected. */
  xp?: number;
  x: number;
  y: number;
  name: string;
  /** Shown when the job is discovered. */
  text: string;
  /** Shown on later touches. */
  after?: string;
  look: "hermit" | "weapon" | "relic" | "stone";
}

export interface ZoneData {
  id: string;
  name: string;
  recipe: ZoneRecipe;
  start: { x: number; y: number };
  map: string[];
  enemies: EnemySpawn[];
  features?: Feature[];
  exits?: ZoneExit[];
  /** Encounters defined by this zone (generated zones); spawns may reference them. */
  encounters?: Record<string, EncounterDef>;
  /** Theme id (generated zones) and graph distance from the first zone. */
  theme?: string;
  /** Set on counter zones: the habit (tactic) this zone was built against. */
  counter?: string;
  depth?: number;
}

export interface Zone {
  id: string;
  name: string;
  recipe: ZoneRecipe;
  width: number;
  height: number;
  start: { x: number; y: number };
  /** Row-major tile chars. */
  tiles: string[];
  tileDefs: TileTable;
  spawns: EnemySpawn[];
  features: Feature[];
  exits: ZoneExit[];
  encounters: Record<string, EncounterDef>;
  theme?: string;
  depth: number;
  counter?: string;
}

export function loadZone(data: ZoneData, tileDefs: TileTable): Zone {
  const height = data.map.length;
  const width = data.map[0]?.length ?? 0;
  if (height === 0 || width === 0) throw new Error(`Zone ${data.id}: empty map`);

  const tiles: string[] = [];
  data.map.forEach((row, y) => {
    if (row.length !== width) {
      throw new Error(`Zone ${data.id}: row ${y} has length ${row.length}, expected ${width}`);
    }
    for (const ch of row) {
      if (!tileDefs[ch]) throw new Error(`Zone ${data.id}: unknown tile '${ch}' in row ${y}`);
      tiles.push(ch);
    }
  });

  const zone: Zone = {
    id: data.id,
    name: data.name,
    recipe: data.recipe,
    width,
    height,
    start: data.start,
    tiles,
    tileDefs,
    spawns: data.enemies,
    features: data.features ?? [],
    exits: data.exits ?? [],
    encounters: data.encounters ?? {},
    theme: data.theme,
    depth: data.depth ?? 0,
    counter: data.counter,
  };

  const check = (x: number, y: number, what: string) => {
    const t = tileAt(zone, x, y);
    if (!t || t.solid) throw new Error(`Zone ${data.id}: ${what} at (${x},${y}) is not on an open tile`);
  };
  check(data.start.x, data.start.y, "start");
  for (const e of data.enemies) check(e.x, e.y, `enemy ${e.id}`);
  for (const f of zone.features) check(f.x, f.y, `feature ${f.id}`);
  for (const x of zone.exits) {
    if (!tileAt(zone, x.x, x.y)?.exit) throw new Error(`Zone ${data.id}: exit ${x.id} at (${x.x},${x.y}) is not an exit tile`);
    check(x.arrive.x, x.arrive.y, `arrival for exit ${x.id}`);
  }

  return zone;
}

export function featureAt(zone: Zone, x: number, y: number): Feature | undefined {
  return zone.features.find((f) => f.x === x && f.y === y);
}

export function inBounds(zone: Zone, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < zone.width && y < zone.height;
}

export function tileAt(zone: Zone, x: number, y: number): TileDef | undefined {
  if (!inBounds(zone, x, y)) return undefined;
  const ch = zone.tiles[y * zone.width + x];
  return ch === undefined ? undefined : zone.tileDefs[ch];
}

/** Can a walker with the given field abilities stand on (x, y)? */
export function isPassable(zone: Zone, x: number, y: number, abilities: ReadonlySet<string>): boolean {
  const t = tileAt(zone, x, y);
  if (!t) return false;
  if (!t.solid) return true;
  return t.gate !== undefined && abilities.has(t.gate);
}
