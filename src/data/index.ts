import tilesJson from "./tiles.json";
import enemiesJson from "./enemies.json";
import antechamberJson from "./zones/antechamber.json";
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
