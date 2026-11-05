/**
 * Save games: a whole session as plain JSON, several slots. Pure apart from
 * the injected key-value store (localStorage in the browser, a Map in tests).
 *
 * What's saved: master seed, party, discovered jobs, every generated zone's
 * data (generated once, never regenerated), each zone's changes, the zone
 * graph, and where the player stands. A battle in progress is not saved:
 * reloading puts you back on the map just before it.
 */
import { jobLevel, type Character } from "../core/jobs";
import { Rng } from "../core/rng";
import type { Dir } from "../core/world";
import type { ZoneData } from "../core/zone";
import { JOBS, JOB_CONTENT } from "../data/battle";
import { makeWorld, storeWorld, syncField, type Link, type Session, type ZoneState } from "./session";

export const SAVE_VERSION = 1;
export const SLOT_COUNT = 3;

export interface SaveData {
  game: "maze-of-doom";
  version: number;
  savedAt: number;
  seed: number;
  zone: string;
  player: { x: number; y: number; facing: Dir };
  party: Character[];
  discovered: string[];
  battlesFought: number;
  generated: Record<string, ZoneData>;
  zoneStates: Record<string, ZoneState>;
  links: Record<string, Link>;
  visited: string[];
  zoneCount: number;
}

export interface SlotSummary {
  slot: number;
  savedAt: number;
  zoneName: string;
  zonesVisited: number;
  party: { name: string; job: string; level: number }[];
}

export class SaveError extends Error {}

export function serialize(session: Session, now = Date.now()): SaveData {
  storeWorld(session);
  const p = session.world.player;
  return structuredClone({
    game: "maze-of-doom" as const,
    version: SAVE_VERSION,
    savedAt: now,
    seed: session.seed,
    zone: session.world.zone.id,
    player: { x: p.x, y: p.y, facing: p.facing },
    party: session.party,
    discovered: [...session.discovered],
    battlesFought: session.battlesFought,
    generated: session.generated,
    zoneStates: session.zoneStates,
    links: session.links,
    visited: session.visited,
    zoneCount: session.zoneCount,
  });
}

/** Rebuild a session from save data. Throws SaveError if the data isn't a valid save. */
export function deserialize(raw: unknown): Session {
  const d = raw as Partial<SaveData> | null;
  if (!d || typeof d !== "object" || d.game !== "maze-of-doom") throw new SaveError("Not a Maze of Doom save.");
  if (d.version !== SAVE_VERSION) throw new SaveError(`Unsupported save version ${String(d.version)}.`);
  for (const k of ["seed", "zone", "player", "party", "discovered", "generated", "zoneStates", "links", "visited"] as const) {
    if (d[k] === undefined) throw new SaveError(`Save is missing '${k}'.`);
  }
  const data = structuredClone(d) as SaveData;
  for (const ch of data.party) {
    if (!JOBS[ch.primary]) throw new SaveError(`Save has an unknown job '${ch.primary}'.`);
  }
  const session: Session = {
    seed: data.seed,
    world: undefined as never,
    party: data.party,
    discovered: new Set(data.discovered),
    battlesFought: data.battlesFought ?? 0,
    generated: data.generated,
    zoneStates: data.zoneStates,
    links: data.links,
    visited: data.visited,
    zoneCount: data.zoneCount ?? 0,
  };
  try {
    session.world = makeWorld(session, data.zone);
  } catch (err) {
    throw new SaveError(`Save is damaged: ${(err as Error).message}`);
  }
  Object.assign(session.world.player, data.player);
  syncField(session);
  return session;
}

/** Minimal key-value store (window.localStorage fits). */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const slotKey = (slot: number) => `maze-of-doom/slot-${slot}`;

export function saveToSlot(store: KeyValueStore, slot: number, session: Session, now = Date.now()): void {
  store.setItem(slotKey(slot), JSON.stringify(serialize(session, now)));
}

export function loadSlot(store: KeyValueStore, slot: number): Session | null {
  const raw = store.getItem(slotKey(slot));
  return raw === null ? null : deserialize(JSON.parse(raw));
}

export function deleteSlot(store: KeyValueStore, slot: number): void {
  store.removeItem(slotKey(slot));
}

/** The slot's raw save JSON, for export. */
export function exportSlot(store: KeyValueStore, slot: number): string | null {
  return store.getItem(slotKey(slot));
}

/** Validate and store an exported save into a slot. Throws SaveError on bad input. */
export function importSlot(store: KeyValueStore, slot: number, json: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new SaveError("That file isn't valid JSON.");
  }
  const session = deserialize(parsed);
  saveToSlot(store, slot, session, (parsed as SaveData).savedAt);
}

export function slotSummaries(store: KeyValueStore): (SlotSummary | null)[] {
  const out: (SlotSummary | null)[] = [];
  for (let slot = 1; slot <= SLOT_COUNT; slot++) {
    try {
      const raw = store.getItem(slotKey(slot));
      if (raw === null) { out.push(null); continue; }
      const d = JSON.parse(raw) as SaveData;
      const zone = d.generated[d.zone]?.name ?? (d.zone === "antechamber" ? "The Antechamber" : d.zone);
      out.push({
        slot,
        savedAt: d.savedAt,
        zoneName: zone,
        zonesVisited: d.visited.length,
        party: d.party.map((c) => ({ name: c.name, job: JOBS[c.primary]?.name ?? c.primary, level: levelOf(c) })),
      });
    } catch {
      out.push(null);
    }
  }
  return out;
}

const levelOf = (c: Character) => jobLevel(JOB_CONTENT, c.jobXp[c.primary] ?? 0);

/** A fresh master seed for a new game. */
export function newSeed(): number {
  return new Rng((Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0).int(0x7fffffff) + 1;
}
