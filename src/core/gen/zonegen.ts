/**
 * Seeded zone generation from a theme and the five-part zone recipe.
 *
 * Classical procgen owns all spatial structure and guarantees:
 *  - everything that matters (exits, enemies, shrine, inscription) is
 *    reachable from the arrival point with no field abilities;
 *  - the secret relic is NOT reachable without the theme's gate ability,
 *    and IS reachable with it.
 * Text (names, twist, landmark, story) comes from theme templates; an LLM
 * may replace it later, never the layout.
 *
 * Pure and deterministic: same params + data = same zone.
 */
import { Rng } from "../rng";
import type { Hazard } from "../battle/types";
import type { EncounterDef, EnemySpawn, Feature, TileTable, ZoneData, ZoneExit } from "../zone";

export interface TwistDef {
  text: string;
  /** Extra impassable pools. */
  pools?: number;
  /** Extra enemies. */
  enemies?: number;
  /** This kind leads (or joins) most encounters. */
  foeBias?: string;
  /** Battle tile hazard added to encounters here. */
  battleHazard?: string;
  battleHazards?: number;
}

export interface ThemeDef {
  name: string;
  names: string[];
  floor: string;
  wall: string;
  accent: string;
  /** Impassable decoration (a gated tile, so a future ability may cross it). */
  pool: string;
  /** Tile that seals the secret room. */
  gate: string;
  landmark: { tile: string; size: number; names: string[]; texts: string[] };
  twists: TwistDef[];
  stories: string[];
  secret: string;
  relicNames: string[];
  relicText: string;
  foes: string[];
}

export interface GenContent {
  themes: Record<string, ThemeDef>;
  tiles: TileTable;
  /** XP value per enemy kind (doubles as encounter cost). Kinds must have battle stats. */
  foeCost: Record<string, number>;
  /** Preferred battle depths per enemy kind. */
  foePrefers: Record<string, number[]>;
  foeNames: Record<string, string>;
}

export interface GenParams {
  id: string;
  seed: number;
  theme: string;
  /** Graph distance from the first zone: scales enemy count and encounter budget. */
  depth: number;
  /** Exits besides the one you arrive through ("back"). */
  forwardExits: number;
}

export const GEN_W = 40;
export const GEN_H = 30;

interface Room {
  x: number;
  y: number;
  w: number;
  h: number;
}

const center = (r: Room) => ({ x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) });
const inRoom = (r: Room, x: number, y: number) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

class Grid {
  cells: string[];
  constructor(public w: number, public h: number, fill: string) {
    this.cells = new Array(w * h).fill(fill);
  }
  get(x: number, y: number) {
    return x < 0 || y < 0 || x >= this.w || y >= this.h ? undefined : this.cells[y * this.w + x];
  }
  set(x: number, y: number, c: string) {
    if (x > 0 && y > 0 && x < this.w - 1 && y < this.h - 1) this.cells[y * this.w + x] = c;
  }
  rows(): string[] {
    const out: string[] = [];
    for (let y = 0; y < this.h; y++) out.push(this.cells.slice(y * this.w, (y + 1) * this.w).join(""));
    return out;
  }
}

/**
 * Tiles reachable from (sx, sy), 4-connected. `blocked` marks extra solid
 * tiles (features). Tiles with a gate in `abilities` count as open.
 */
export function reachable(
  g: { get(x: number, y: number): string | undefined; w: number; h: number },
  tiles: TileTable,
  sx: number,
  sy: number,
  abilities: ReadonlySet<string>,
  blocked: ReadonlySet<string> = new Set(),
): Set<string> {
  const open = (x: number, y: number) => {
    const c = g.get(x, y);
    if (c === undefined || blocked.has(`${x},${y}`)) return false;
    const t = tiles[c]!;
    return !t.solid || (t.gate !== undefined && abilities.has(t.gate));
  };
  const seen = new Set<string>();
  if (!open(sx, sy)) return seen;
  const queue = [[sx, sy] as const];
  seen.add(`${sx},${sy}`);
  while (queue.length) {
    const [x, y] = queue.shift()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, ny = y + dy, k = `${nx},${ny}`;
      if (!seen.has(k) && open(nx, ny)) {
        seen.add(k);
        queue.push([nx, ny]);
      }
    }
  }
  return seen;
}

/** Can you stand next to (x, y)? (Features are solid: you touch them from a neighbour.) */
const touchable = (reach: Set<string>, x: number, y: number) =>
  [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => reach.has(`${x + dx!},${y + dy!}`));

export function generateZone(params: GenParams, content: GenContent): ZoneData {
  const theme = content.themes[params.theme];
  if (!theme) throw new Error(`Unknown theme '${params.theme}'`);
  const rng = new Rng(params.seed);
  // Layout attempts are deterministic: each failure just consumes more RNG.
  for (let attempt = 0; attempt < 200; attempt++) {
    const z = tryGenerate(params, theme, content, rng);
    if (z) return z;
  }
  throw new Error(`Zone ${params.id}: generation failed`);
}

function tryGenerate(params: GenParams, theme: ThemeDef, content: GenContent, rng: Rng): ZoneData | null {
  const { tiles } = content;
  const g = new Grid(GEN_W, GEN_H, theme.wall);
  const twist = rng.pick(theme.twists);

  // 1. Rooms.
  const rooms: Room[] = [];
  for (let i = 0; i < 400 && rooms.length < 10; i++) {
    const w = 5 + rng.int(6);
    const h = 4 + rng.int(4);
    const r = { x: 1 + rng.int(GEN_W - w - 2), y: 1 + rng.int(GEN_H - h - 2), w, h };
    const clash = rooms.some((o) => r.x < o.x + o.w + 2 && o.x < r.x + r.w + 2 && r.y < o.y + o.h + 2 && o.y < r.y + r.h + 2);
    if (!clash) rooms.push(r);
  }
  if (rooms.length < 6) return null;
  for (const r of rooms) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) g.set(x, y, theme.floor);

  // 2. The secret room is the smallest; the entry room is the one furthest from it.
  const area = (r: Room) => r.w * r.h;
  const secret = [...rooms].sort((a, b) => area(a) - area(b))[0]!;
  const main = rooms.filter((r) => r !== secret);
  const dist = (a: Room, b: Room) => Math.abs(center(a).x - center(b).x) + Math.abs(center(a).y - center(b).y);
  main.sort((a, b) => dist(b, secret) - dist(a, secret));
  const entry = main[0]!;

  // 3. Corridors: a spanning tree over the main rooms (nearest-first) plus one loop, then the secret room's spur.
  const carve = (a: Room, b: Room) => {
    const p = center(a), q = center(b);
    const hFirst = rng.next() < 0.5;
    const corner = hFirst ? { x: q.x, y: p.y } : { x: p.x, y: q.y };
    for (const [from, to] of [[p, corner], [corner, q]] as const) {
      const dx = Math.sign(to.x - from.x), dy = Math.sign(to.y - from.y);
      let x = from.x, y = from.y;
      for (;;) {
        if (tiles[g.get(x, y)!]!.solid) g.set(x, y, theme.floor);
        if (x === to.x && y === to.y) break;
        x += dx;
        y += dy;
      }
    }
  };
  const linked = [main[0]!];
  const rest = main.slice(1);
  const edges: [Room, Room][] = [];
  while (rest.length) {
    let best: [number, number, number] | null = null;
    rest.forEach((r, i) => linked.forEach((l, j) => {
      const d = dist(r, l);
      if (!best || d < best[0]) best = [d, i, j];
    }));
    const [, i, j] = best!;
    edges.push([rest[i]!, linked[j]!]);
    linked.push(rest.splice(i, 1)[0]!);
  }
  for (const [a, b] of edges) carve(a, b);
  const loopA = rng.pick(main), loopB = rng.pick(main);
  if (loopA !== loopB) carve(loopA, loopB);
  const nearest = [...main].sort((a, b) => dist(a, secret) - dist(b, secret))[0]!;
  carve(secret, nearest);

  // 4. Seal the secret room: every opening in the ring around it becomes the gate tile.
  for (let y = secret.y - 1; y <= secret.y + secret.h; y++) {
    for (let x = secret.x - 1; x <= secret.x + secret.w; x++) {
      if (inRoom(secret, x, y)) continue;
      const c = g.get(x, y);
      if (c !== undefined && !tiles[c]!.solid) g.set(x, y, theme.gate);
    }
  }

  // 5. Placement helpers. `taken` = tiles reserved for exits, features, spawns.
  const taken = new Set<string>();
  const key = (x: number, y: number) => `${x},${y}`;
  const interior = (r: Room) => {
    const out: { x: number; y: number }[] = [];
    for (let y = r.y + 1; y < r.y + r.h - 1; y++) for (let x = r.x + 1; x < r.x + r.w - 1; x++) out.push({ x, y });
    return out;
  };
  const freeIn = (r: Room) => interior(r).filter((p) => !taken.has(key(p.x, p.y)) && g.get(p.x, p.y) === theme.floor);
  const claim = (p: { x: number; y: number }) => {
    taken.add(key(p.x, p.y));
    return p;
  };

  // Exits sit on a room's top row, with the arrival tile just below.
  const placeExit = (r: Room, id: string): ZoneExit | null => {
    const spots = [];
    for (let x = r.x + 1; x < r.x + r.w - 1; x++) {
      if (!taken.has(key(x, r.y)) && !taken.has(key(x, r.y + 1))) spots.push(x);
    }
    if (!spots.length) return null;
    const x = rng.pick(spots);
    g.set(x, r.y, "E");
    claim({ x, y: r.y });
    claim({ x, y: r.y + 1 });
    return { id, x, y: r.y, arrive: { x, y: r.y + 1 } };
  };

  const exits: ZoneExit[] = [];
  const back = placeExit(entry, "back");
  if (!back) return null;
  exits.push(back);
  // Forward exits go in the rooms furthest from the entry.
  const far = main.slice(1).sort((a, b) => dist(b, entry) - dist(a, entry));
  for (let i = 0; i < params.forwardExits; i++) {
    const r = far[i];
    const e = r && placeExit(r, `exit-${i + 1}`);
    if (!e) return null;
    exits.push(e);
  }

  // Shrine near the entry.
  const entrySpots = freeIn(entry);
  if (!entrySpots.length) return null;
  const shrineSpot = rng.pick(entrySpots);
  g.set(shrineSpot.x, shrineSpot.y, "R");
  claim(shrineSpot);

  // 6. Landmark: a block in the largest main room (not the entry).
  const lmRoom = [...main.slice(1)].sort((a, b) => area(b) - area(a))[0]!;
  const lmSize = theme.landmark.size;
  if (lmRoom.w < lmSize + 4 || lmRoom.h < lmSize + 3) return null;
  const lc = center(lmRoom);
  const lx = lc.x - Math.floor(lmSize / 2), ly = lc.y - Math.floor(lmSize / 2);
  for (let y = ly; y < ly + lmSize; y++) for (let x = lx; x < lx + lmSize; x++) {
    if (taken.has(key(x, y))) return null;
    g.set(x, y, theme.landmark.tile);
    claim({ x, y });
  }

  // 7. Features: the story inscription and the secret relic.
  const features: Feature[] = [];
  const loreRooms = main.filter((r) => r !== entry && r !== lmRoom);
  const loreRoom = rng.pick(loreRooms.length ? loreRooms : [lmRoom]);
  const lorePos = freeIn(loreRoom);
  if (!lorePos.length) return null;
  const story = rng.pick(theme.stories);
  const lp = claim(rng.pick(lorePos));
  features.push({ id: `${params.id}-lore`, kind: "lore", x: lp.x, y: lp.y, name: "Inscription", look: "stone", text: story });
  const relicPos = freeIn(secret);
  if (!relicPos.length) return null;
  const rp = claim(rng.pick(relicPos));
  const relicName = rng.pick(theme.relicNames);
  const relicXp = 10 + params.depth * 4;
  features.push({
    id: `${params.id}-relic`, kind: "relic", x: rp.x, y: rp.y, xp: relicXp, name: relicName, look: "relic",
    text: `${relicName}. ${theme.relicText} Every member gains ${relicXp} job XP.`, after: "",
  });

  // 8. Pools: decoration on the gated tile type, kept only if nothing important is cut off.
  const featureTiles = new Set(features.map((f) => key(f.x, f.y)));
  const requiredOk = () => {
    const reach = reachable(g, tiles, back.arrive.x, back.arrive.y, new Set(), featureTiles);
    return (
      exits.every((e) => reach.has(key(e.x, e.y))) &&
      reach.has(key(shrineSpot.x, shrineSpot.y)) &&
      touchable(reach, lp.x, lp.y) &&
      main.every((r) => interior(r).some((p) => reach.has(key(p.x, p.y))))
    );
  };
  if (!requiredOk()) return null;
  const poolCount = 2 + (twist.pools ?? 0);
  for (let i = 0; i < poolCount; i++) {
    const r = rng.pick(main.slice(1));
    const spots = freeIn(r);
    if (!spots.length) continue;
    const o = rng.pick(spots);
    const pw = 1 + rng.int(3), ph = 1 + rng.int(2);
    const placed: { x: number; y: number }[] = [];
    for (let y = o.y; y < o.y + ph; y++) for (let x = o.x; x < o.x + pw; x++) {
      if (inRoom(r, x, y) && !taken.has(key(x, y)) && g.get(x, y) === theme.floor) {
        g.set(x, y, theme.pool);
        placed.push({ x, y });
      }
    }
    if (!requiredOk()) for (const p of placed) g.set(p.x, p.y, theme.floor);
  }

  // Accent scatter (passable).
  if (theme.accent !== theme.floor) {
    for (const r of main) for (const p of interior(r)) if (g.get(p.x, p.y) === theme.floor && rng.next() < 0.12) g.set(p.x, p.y, theme.accent);
  }

  // 9. The secret really is secret: unreachable without the gate ability, reachable with it.
  const gateAbility = tiles[theme.gate]?.gate;
  if (!gateAbility) throw new Error(`Theme gate tile '${theme.gate}' has no gate ability`);
  const without = reachable(g, tiles, back.arrive.x, back.arrive.y, new Set(), featureTiles);
  const withGate = reachable(g, tiles, back.arrive.x, back.arrive.y, new Set([gateAbility]), featureTiles);
  if (touchable(without, rp.x, rp.y) || !touchable(withGate, rp.x, rp.y)) return null;

  // 10. Enemies and their encounters.
  const enemies: EnemySpawn[] = [];
  const encounters: Record<string, EncounterDef> = {};
  const reach = without;
  const count = Math.min(8, 3 + Math.floor(params.depth / 2) + (twist.enemies ?? 0));
  const spawnRooms = main.slice(1);
  for (let i = 0; i < count; i++) {
    const r = spawnRooms[i % spawnRooms.length]!;
    const spots = freeIn(r).filter((p) => reach.has(key(p.x, p.y)) && !featureTiles.has(key(p.x, p.y)));
    if (!spots.length) continue;
    const pos = claim(rng.pick(spots));
    const id = `${params.id}-e${i + 1}`;
    const leader = twist.foeBias && rng.next() < 0.6 ? twist.foeBias : rng.pick(theme.foes);
    encounters[id] = makeEncounter(rng, leader, theme, twist, params.depth, content);
    enemies.push({ id, kind: leader, x: pos.x, y: pos.y, encounter: id });
  }
  if (enemies.length < 3) return null;

  const landmarkName = rng.pick(theme.landmark.names);
  return {
    id: params.id,
    name: rng.pick(theme.names),
    theme: params.theme,
    depth: params.depth,
    recipe: {
      theme: theme.name,
      twist: twist.text,
      landmark: `${landmarkName}. ${rng.pick(theme.landmark.texts)}`,
      secret: theme.secret,
      story,
    },
    start: { ...back.arrive },
    map: g.rows(),
    enemies,
    features,
    exits,
    encounters,
  };
}

const ENCOUNTER_NOUNS = ["Patrol", "Brood", "Watch", "Host", "Pack", "Vigil"];

/**
 * An encounter led by `leader`: foes from the theme pool within a budget
 * (foe XP doubles as cost) that grows with depth.
 */
export function makeEncounter(rng: Rng, leader: string, theme: ThemeDef, twist: TwistDef, depth: number, content: GenContent): EncounterDef {
  const cost = (k: string) => content.foeCost[k] ?? 3;
  const budget = 7 + depth * 3 + rng.int(4);
  const kinds = [leader];
  let spent = cost(leader);
  const pool = twist.foeBias ? [...theme.foes, twist.foeBias, twist.foeBias] : theme.foes;
  while (kinds.length < 5) {
    const options = pool.filter((k) => spent + cost(k) <= budget);
    if (!options.length) break;
    const k = rng.pick(options);
    kinds.push(k);
    spent += cost(k);
  }

  const used = new Set<string>();
  const foes: EncounterDef["foes"] = [];
  for (const kind of kinds) {
    const prefers = content.foePrefers[kind] ?? [0];
    const tiles: { depth: number; lane: number }[] = [];
    for (const d of [...prefers, 0, 1, 2]) for (const lane of [0, 1, 2]) if (!used.has(`${d}:${lane}`)) tiles.push({ depth: d, lane });
    const preferred = tiles.filter((t) => prefers.includes(t.depth));
    const t = rng.pick(preferred.length ? preferred : tiles);
    used.add(`${t.depth}:${t.lane}`);
    foes.push({ kind, ...t });
  }

  const hazards: Hazard[] = [];
  if (twist.battleHazard) {
    const free: { depth: number; lane: number }[] = [];
    for (const d of [0, 1, 2]) for (const lane of [0, 1, 2]) if (!used.has(`${d}:${lane}`)) free.push({ depth: d, lane });
    for (let i = 0; i < (twist.battleHazards ?? 1) && free.length; i++) {
      const t = free.splice(rng.int(free.length), 1)[0]!;
      hazards.push({ tile: { side: "foe", ...t }, kind: twist.battleHazard, turns: null });
    }
    // One on the party side too: the ground itself is the twist.
    hazards.push({ tile: { side: "party", depth: rng.int(3), lane: rng.int(3) }, kind: twist.battleHazard, turns: null });
  }

  return {
    name: `${content.foeNames[leader] ?? leader} ${rng.pick(ENCOUNTER_NOUNS)}`,
    desc: `${theme.name}, depth ${depth}. ${twist.text}`,
    foes,
    hazards: hazards.length ? hazards : undefined,
  };
}
