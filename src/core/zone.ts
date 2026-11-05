/** Zone data model and loading/validation. Pure, no DOM. */

export interface TileDef {
  id: string;
  solid: boolean;
  color: string;
  /** Field ability that lets a character enter this otherwise-solid tile. */
  gate?: string;
  exit?: boolean;
  /** Stepping here restores the party. */
  rest?: boolean;
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
  kind: "job" | "relic";
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
  look: "hermit" | "weapon" | "relic";
}

export interface ZoneData {
  id: string;
  name: string;
  recipe: ZoneRecipe;
  start: { x: number; y: number };
  map: string[];
  enemies: EnemySpawn[];
  features?: Feature[];
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
  };

  const check = (x: number, y: number, what: string) => {
    const t = tileAt(zone, x, y);
    if (!t || t.solid) throw new Error(`Zone ${data.id}: ${what} at (${x},${y}) is not on an open tile`);
  };
  check(data.start.x, data.start.y, "start");
  for (const e of data.enemies) check(e.x, e.y, `enemy ${e.id}`);
  for (const f of zone.features) check(f.x, f.y, `feature ${f.id}`);

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
