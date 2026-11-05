import tilesJson from "./tiles.json";
import enemiesJson from "./enemies.json";
import antechamberJson from "./zones/antechamber.json";
import themesJson from "./themes.json";
import type { GenContent, ThemeDef } from "../core/gen/zonegen";
import { loadZone, type TileTable, type ZoneData } from "../core/zone";
import type { EnemyKind } from "../core/world";

export const TILES = tilesJson as TileTable;
export const ENEMY_KINDS = enemiesJson as Record<string, EnemyKind>;
export const ZONES: Record<string, ZoneData> = {
  antechamber: antechamberJson as ZoneData,
};

export function getZone(id: string) {
  const data = ZONES[id];
  if (!data) throw new Error(`Unknown zone '${id}'`);
  return loadZone(data, TILES);
}

export const THEMES = themesJson as Record<string, ThemeDef>;

const battleKinds = Object.entries(ENEMY_KINDS).filter(([, k]) => k.battle);
export const GEN_CONTENT: GenContent = {
  themes: THEMES,
  tiles: TILES,
  foeCost: Object.fromEntries(battleKinds.map(([id, k]) => [id, k.battle!.xp ?? 3])),
  foePrefers: Object.fromEntries(battleKinds.map(([id, k]) => [id, k.battle!.prefers])),
  foeNames: Object.fromEntries(battleKinds.map(([id, k]) => [id, k.name])),
};

/** Handcrafted zone data, or undefined. */
export function handcraftedZone(id: string): ZoneData | undefined {
  return ZONES[id];
}
