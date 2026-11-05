/**
 * A play session: the zone graph, the current zone's world, the persistent
 * party, and the glue between map encounters and battles. Pure logic (no
 * DOM), unit-tested. Everything here serializes (see save.ts).
 */
import { assessEncounter, type Assessment } from "../core/battle/autoresolve";
import { createBattle } from "../core/battle/engine";
import type { BattleSetup, BattleState, UnitSpec } from "../core/battle/types";
import { Rng } from "../core/rng";
import { JobError, fieldAbilities, gainXp, type Character, type ProgressNote } from "../core/jobs";
import { generateZone } from "../core/gen/zonegen";
import { createWorld, playerFooting, removeEnemy, type Enemy, type World } from "../core/world";
import { loadZone, type EncounterDef, type Zone, type ZoneData } from "../core/zone";
import { ENEMY_KINDS, GEN_CONTENT, THEMES, TILES, handcraftedZone } from "../data";
import {
  BATTLE_CONTENT,
  ENCOUNTERS,
  JOBS,
  JOB_CONTENT,
  PASSIVES,
  SKILLS,
  STARTER_JOBS,
  buildEncounter,
  encounterXp,
  partySpecsOf,
  startingParty,
} from "../data/battle";

/** What changed in a zone since it was generated. Kept per zone, forever. */
export interface ZoneState {
  /** Overworld enemies beaten (permanently gone). */
  defeated: string[];
  /** Features taken off the map (collected relics). */
  removed: string[];
  /** The zone's world RNG, so wandering and battle seeds continue where they left off. */
  rngState: number;
}

/** Where an exit leads: a zone id and the exit you arrive through. */
export interface Link {
  zone: string;
  exit: string;
}

export interface Session {
  /** The game's master seed: zone generation and world RNG derive from it. */
  seed: number;
  /** The current zone's live world. */
  world: World;
  party: Character[];
  /** Jobs found in the world (plus the starters). Any character may take these up. */
  discovered: Set<string>;
  battlesFought: number;
  /** Generated zones, saved on first visit and never regenerated. */
  generated: Record<string, ZoneData>;
  zoneStates: Record<string, ZoneState>;
  /** Zone graph: "zoneId/exitId" -> destination. Filled in as exits are first used. */
  links: Record<string, Link>;
  /** Zone ids in order of first visit. */
  visited: string[];
  /** Counter for generated zone ids. */
  zoneCount: number;
}

export type EncounterStart =
  | { kind: "instant"; enemy: Enemy; assessment: Assessment; message: string; notes: ProgressNote[] }
  | { kind: "battle"; enemy: Enemy; encounterId: string; encounter: EncounterDef; battle: BattleState };

export type BattleOutcome = "won" | "lost" | "retreat";

export function createSession(zoneId: string, seed: number): Session {
  const session: Session = {
    seed,
    world: undefined as unknown as World,
    party: startingParty(),
    discovered: new Set(STARTER_JOBS),
    battlesFought: 0,
    generated: {},
    zoneStates: {},
    links: {},
    visited: [zoneId],
    zoneCount: 0,
  };
  session.world = makeWorld(session, zoneId);
  return session;
}

/** A zone's data: handcrafted, or generated earlier in this game. */
export function zoneData(session: Session, id: string): ZoneData {
  const z = handcraftedZone(id) ?? session.generated[id];
  if (!z) throw new Error(`Unknown zone '${id}'`);
  return z;
}

export function getSessionZone(session: Session, id: string): Zone {
  return loadZone(zoneData(session, id), TILES);
}

/** Deterministic per-zone seed from the master seed (FNV-1a over the id). */
export function zoneSeed(session: Session, id: string): number {
  let h = 0x811c9dc5 ^ session.seed;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

function stateOf(session: Session, id: string): ZoneState {
  return (session.zoneStates[id] ??= { defeated: [], removed: [], rngState: zoneSeed(session, id) });
}

/** Build the live world for a zone, with everything that has happened there applied. */
export function makeWorld(session: Session, id: string): World {
  const st = stateOf(session, id);
  const world = createWorld(getSessionZone(session, id), ENEMY_KINDS, st.rngState);
  world.enemies = world.enemies.filter((e) => !st.defeated.includes(e.id));
  world.removedFeatures = new Set(st.removed);
  world.abilities = fieldAbilities(JOB_CONTENT, session.party);
  return world;
}

/** Write the live world's changes back into its zone state (before leaving or saving). */
export function storeWorld(session: Session): void {
  const st = stateOf(session, session.world.zone.id);
  st.removed = [...session.world.removedFeatures];
  st.rngState = session.world.rng.state;
}

export function defeatedIn(session: Session, zoneId: string): string[] {
  return session.zoneStates[zoneId]?.defeated ?? [];
}

export function encounterIdFor(enemy: Enemy): string {
  const id = enemy.encounter ?? ENEMY_KINDS[enemy.kind]?.encounter;
  if (!id) throw new Error(`Enemy ${enemy.id} has no encounter`);
  return id;
}

/** The encounter an enemy leads: defined by its zone, or a shared one from encounters.json. */
export function encounterFor(session: Session, enemy: Enemy): EncounterDef {
  const id = encounterIdFor(enemy);
  const def = session.world.zone.encounters[id] ?? ENCOUNTERS[id];
  if (!def) throw new Error(`Enemy ${enemy.id}: unknown encounter '${id}'`);
  return def;
}

export interface TravelResult {
  message: string;
  /** True the first time this zone is entered (it was just generated). */
  isNew: boolean;
}

/**
 * Go through an exit. The first time, the zone beyond is generated (seeded)
 * and linked both ways; after that it is loaded exactly as it was left.
 */
export function travel(session: Session, exitId: string): TravelResult {
  const here = session.world.zone;
  const exit = here.exits.find((e) => e.id === exitId);
  if (!exit) throw new Error(`Zone ${here.id} has no exit '${exitId}'`);
  const key = `${here.id}/${exit.id}`;
  let isNew = false;
  if (!session.links[key]) {
    const id = `z${++session.zoneCount}`;
    const rng = new Rng(zoneSeed(session, id));
    const themes = Object.keys(THEMES).filter((t) => t !== here.theme);
    const data = generateZone(
      { id, seed: zoneSeed(session, id), theme: rng.pick(themes), depth: here.depth + 1, forwardExits: 1 + rng.int(2) },
      GEN_CONTENT,
    );
    session.generated[id] = data;
    session.links[key] = { zone: id, exit: "back" };
    session.links[`${id}/back`] = { zone: here.id, exit: exit.id };
    isNew = true;
  }
  const to = session.links[key]!;
  storeWorld(session);
  session.world = makeWorld(session, to.zone);
  const arrival = session.world.zone.exits.find((e) => e.id === to.exit)!;
  session.world.player.x = arrival.arrive.x;
  session.world.player.y = arrival.arrive.y;
  if (!session.visited.includes(to.zone)) session.visited.push(to.zone);
  const z = session.world.zone;
  const message = isNew
    ? `${z.name}. ${z.recipe.theme}, depth ${z.depth}. ${z.recipe.twist}`
    : `${z.name}.`;
  return { message, isNew };
}

/** The exit at (x, y) in the current zone, if any. */
export function exitAt(session: Session, x: number, y: number) {
  return session.world.zone.exits.find((e) => e.x === x && e.y === y);
}

export function partySpecs(session: Session): UnitSpec[] {
  return partySpecsOf(session.party);
}

export function encounterSetup(session: Session, enemy: Enemy): BattleSetup {
  return buildEncounter(encounterFor(session, enemy), partySpecs(session));
}

/** Seed for the next battle, drawn from the world RNG so a whole session replays. */
function nextBattleSeed(session: Session): number {
  return session.world.rng.int(0x7fffffff) + 1;
}

/**
 * Touching an enemy: either resolve instantly (party vastly outclasses it)
 * or open a battle. The enemy that was touched leads the encounter.
 */
export function startEncounter(session: Session, enemyId: string): EncounterStart {
  const enemy = session.world.enemies.find((e) => e.id === enemyId);
  if (!enemy) throw new Error(`No enemy '${enemyId}' on the map`);
  const setup = encounterSetup(session, enemy);
  const seed = nextBattleSeed(session);
  const assessment = assessEncounter(setup, BATTLE_CONTENT, seed);
  const name = ENEMY_KINDS[enemy.kind]!.name;

  if (assessment.instantWin) {
    defeatEnemy(session, enemy.id);
    const notes = awardXp(session, encounterFor(session, enemy), session.party.filter((m) => m.hp > 0));
    const message = [`The ${name} is no match for you. It scatters at your touch.`, ...notes.map(describeNote(session))].join(" ");
    return { kind: "instant", enemy, assessment, message, notes };
  }
  session.battlesFought += 1;
  return {
    kind: "battle", enemy, encounterId: encounterIdFor(enemy), encounter: encounterFor(session, enemy),
    battle: createBattle(setup, BATTLE_CONTENT, seed),
  };
}

function defeatEnemy(session: Session, enemyId: string) {
  removeEnemy(session.world, enemyId);
  stateOf(session, session.world.zone.id).defeated.push(enemyId);
}

/** Every surviving member gains XP in their primary job. */
function awardXp(session: Session, encounter: EncounterDef, members: Character[]): ProgressNote[] {
  const xp = encounterXp(encounter);
  const notes = members.flatMap((m) => gainXp(JOB_CONTENT, m, xp, session.discovered));
  syncField(session); // a newly learned passive may have auto-equipped (e.g. Float)
  return notes;
}

const abilityName = (id: string) => SKILLS[id]?.name ?? PASSIVES[id]?.name ?? id;

export function describeNote(session: Session) {
  return (n: ProgressNote): string => {
    const who = session.party.find((m) => m.id === n.charId)?.name ?? n.charId;
    const job = JOBS[n.job]!.name;
    switch (n.kind) {
      case "level": return `${who} reaches ${job} Lv${n.level}!`;
      case "learn": return `${who} learns ${abilityName(n.ability)}${n.equipped ? " (equipped)" : ""}.`;
      case "hybrid": return `${who} unlocks the hybrid job ${job}!`;
    }
  };
}

/** Carry battle HP back to the party. */
function syncPartyHp(session: Session, battle: BattleState, reviveDowned: boolean) {
  for (const m of session.party) {
    const u = battle.units.find((x) => x.side === "party" && x.id === m.id);
    if (!u) continue;
    m.hp = u.hp > 0 ? u.hp : reviveDowned ? 1 : 0;
  }
}

export function restoreParty(session: Session): void {
  for (const m of session.party) m.hp = m.maxHp;
}

/**
 * Apply a finished (or abandoned) battle to the session. Returns the line
 * to show on the map.
 *  - won: enemy is gone for good; downed members get back up with 1 HP.
 *  - retreat: HP carries over, enemy stays.
 *  - lost: the Maze relocates the party (not a roguelike: nothing is lost
 *    but position). Party is restored.
 */
export function finishBattle(session: Session, enemyId: string, battle: BattleState, outcome: BattleOutcome): string {
  const enemy = session.world.enemies.find((e) => e.id === enemyId);
  const name = enemy ? ENEMY_KINDS[enemy.kind]!.name : "enemy";
  switch (outcome) {
    case "won": {
      // XP goes to whoever is still standing at the end.
      const standing = session.party.filter((m) => battle.units.some((u) => u.side === "party" && u.id === m.id && u.hp > 0));
      const encounter = enemy ? encounterFor(session, enemy) : null;
      syncPartyHp(session, battle, true);
      defeatEnemy(session, enemyId);
      const notes = encounter ? awardXp(session, encounter, standing) : [];
      const xp = encounter ? ` +${encounterXp(encounter)} job XP.` : "";
      return [`Victory over the ${name}.${xp}`, ...notes.map(describeNote(session))].join(" ");
    }
    case "retreat":
      syncPartyHp(session, battle, false);
      return `You break away from the ${name}.`;
    case "lost":
      restoreParty(session);
      return `${pickMazeLine(session, DEFEAT_LINES)} You wake in ${relocate(session)}, whole.`;
  }
}

/**
 * The Maze sets the party down in another zone it has already seen (its
 * arrival point), or this zone's start if there is no other. Returns the
 * zone's name.
 */
function relocate(session: Session): string {
  const others = session.visited.filter((z) => z !== session.world.zone.id);
  // Separate stream so this never perturbs gameplay RNG.
  const rng = new Rng(zoneSeed(session, `relocate-${session.battlesFought}`));
  if (others.length) {
    storeWorld(session);
    session.world = makeWorld(session, rng.pick(others));
  }
  const w = session.world;
  w.player.x = w.zone.start.x;
  w.player.y = w.zone.start.y;
  w.player.facing = "down";
  return w.zone.name;
}

const DEFEAT_LINES = [
  "The Maze: \"Not yet. I'm not finished with you.\"",
  "The Maze: \"Get up. Again.\"",
  "The Maze: \"Falling is allowed. Leaving is not.\"",
];

function pickMazeLine(session: Session, lines: string[]): string {
  const rng = new Rng(zoneSeed(session, `line-${session.battlesFought}-${session.visited.length}`));
  return rng.pick(lines);
}

/**
 * Touch a map feature. A job source adds its job to the discovered set the
 * first time. Returns the line to show.
 */
export function interact(
  session: Session,
  featureId: string,
): { message: string; discovered?: string; collected?: string; notes?: ProgressNote[] } {
  const f = session.world.zone.features.find((x) => x.id === featureId);
  if (!f) throw new Error(`No feature '${featureId}'`);
  if (f.kind === "job" && f.job && !session.discovered.has(f.job)) {
    session.discovered.add(f.job);
    return { message: `${f.text} (Open the party menu with P.)`, discovered: f.job };
  }
  if (f.kind === "relic" && !session.world.removedFeatures.has(f.id)) {
    session.world.removedFeatures.add(f.id);
    const notes = session.party.flatMap((m) => gainXp(JOB_CONTENT, m, f.xp ?? 0, session.discovered));
    syncField(session);
    return { message: [f.text, ...notes.map(describeNote(session))].join(" "), collected: f.id, notes };
  }
  return { message: f.after ?? f.text };
}

/** Recompute the party's field abilities from equipped Movement passives. */
export function syncField(session: Session): void {
  session.world.abilities = fieldAbilities(JOB_CONTENT, session.party);
}

/**
 * Change the party's loadout (job, secondary, slots) through `change`, then
 * refresh field abilities. Refused, and rolled back, if it would leave the
 * party standing somewhere it can no longer be (taking off Float over lava).
 */
export function changeLoadout(session: Session, change: () => void): void {
  const before = structuredClone(session.party);
  change();
  syncField(session);
  if (!playerFooting(session.world)) {
    session.party.splice(0, session.party.length, ...before);
    syncField(session);
    throw new JobError("Not while you're over lava: you'd fall in. Step onto solid ground first.");
  }
}

export function partyIsDown(session: Session): boolean {
  return session.party.every((m) => m.hp <= 0);
}
