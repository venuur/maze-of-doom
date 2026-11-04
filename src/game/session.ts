/**
 * A play session: the overworld plus the persistent party, and the glue
 * between map encounters and battles. Pure logic (no DOM), unit-tested.
 */
import { assessEncounter, type Assessment } from "../core/battle/autoresolve";
import { createBattle } from "../core/battle/engine";
import type { BattleSetup, BattleState, UnitSpec } from "../core/battle/types";
import { Rng } from "../core/rng";
import { createWorld, removeEnemy, type Enemy, type World } from "../core/world";
import { ENEMY_KINDS, getZone } from "../data";
import { BATTLE_CONTENT, DEFAULT_PARTY, ENCOUNTERS, JOBS, buildEncounter, partyUnit } from "../data/battle";

export interface PartyMember {
  job: string;
  hp: number;
  maxHp: number;
  /** Battle formation. */
  depth: number;
  lane: number;
}

export interface Session {
  world: World;
  party: PartyMember[];
  /** Overworld enemies beaten (permanently gone). */
  defeated: string[];
  battlesFought: number;
}

export type EncounterStart =
  | { kind: "instant"; enemy: Enemy; assessment: Assessment; message: string }
  | { kind: "battle"; enemy: Enemy; encounterId: string; battle: BattleState };

export type BattleOutcome = "won" | "lost" | "retreat";

export function createSession(zoneId: string, seed: number): Session {
  return {
    world: createWorld(getZone(zoneId), ENEMY_KINDS, seed),
    party: DEFAULT_PARTY.map((p) => {
      const job = JOBS[p.job]!;
      return { job: p.job, hp: job.hp, maxHp: job.hp, depth: p.depth, lane: p.lane };
    }),
    defeated: [],
    battlesFought: 0,
  };
}

export function encounterIdFor(enemy: Enemy): string {
  const id = enemy.encounter ?? ENEMY_KINDS[enemy.kind]?.encounter;
  if (!id || !ENCOUNTERS[id]) throw new Error(`Enemy ${enemy.id} has no valid encounter`);
  return id;
}

export function partySpecs(session: Session): UnitSpec[] {
  return session.party.map((m) => ({ ...partyUnit(m.job, m.depth, m.lane), hp: m.hp, maxHp: m.maxHp }));
}

export function encounterSetup(session: Session, enemy: Enemy): BattleSetup {
  return buildEncounter(encounterIdFor(enemy), partySpecs(session));
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
    return { kind: "instant", enemy, assessment, message: `The ${name} is no match for you. It scatters at your touch.` };
  }
  session.battlesFought += 1;
  return { kind: "battle", enemy, encounterId: encounterIdFor(enemy), battle: createBattle(setup, BATTLE_CONTENT, seed) };
}

function defeatEnemy(session: Session, enemyId: string) {
  removeEnemy(session.world, enemyId);
  session.defeated.push(enemyId);
}

/** Carry battle HP back to the party. */
function syncPartyHp(session: Session, battle: BattleState, reviveDowned: boolean) {
  for (const m of session.party) {
    const u = battle.units.find((x) => x.side === "party" && x.job === m.job);
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
    case "won":
      syncPartyHp(session, battle, true);
      defeatEnemy(session, enemyId);
      return `Victory over the ${name}.`;
    case "retreat":
      syncPartyHp(session, battle, false);
      return `You break away from the ${name}.`;
    case "lost":
      restoreParty(session);
      relocate(session);
      return pickMazeLine(session, DEFEAT_LINES);
  }
}

/** The Maze sets the party down somewhere else. With one zone, that's its entrance. */
function relocate(session: Session) {
  const w = session.world;
  w.player.x = w.zone.start.x;
  w.player.y = w.zone.start.y;
  w.player.facing = "down";
}

const DEFEAT_LINES = [
  "The Maze: \"Not yet. I'm not finished with you.\" You wake at the entrance.",
  "The Maze: \"Get up. Again.\" You wake at the entrance, whole.",
  "The Maze: \"Falling is allowed. Leaving is not.\" You wake at the entrance.",
];

function pickMazeLine(session: Session, lines: string[]): string {
  // Separate stream so flavor text never perturbs gameplay RNG.
  const rng = new Rng(session.battlesFought * 7919 + session.defeated.length);
  return rng.pick(lines);
}

export function partyIsDown(session: Session): boolean {
  return session.party.every((m) => m.hp <= 0);
}
