/**
 * A play session: the overworld plus the persistent party, and the glue
 * between map encounters and battles. Pure logic (no DOM), unit-tested.
 */
import { assessEncounter, type Assessment } from "../core/battle/autoresolve";
import { createBattle } from "../core/battle/engine";
import type { BattleSetup, BattleState, UnitSpec } from "../core/battle/types";
import { Rng } from "../core/rng";
import { gainXp, type Character, type ProgressNote } from "../core/jobs";
import { createWorld, removeEnemy, type Enemy, type World } from "../core/world";
import { ENEMY_KINDS, getZone } from "../data";
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

export interface Session {
  world: World;
  party: Character[];
  /** Jobs found in the world (plus the starters). Any character may take these up. */
  discovered: Set<string>;
  /** Overworld enemies beaten (permanently gone). */
  defeated: string[];
  battlesFought: number;
}

export type EncounterStart =
  | { kind: "instant"; enemy: Enemy; assessment: Assessment; message: string; notes: ProgressNote[] }
  | { kind: "battle"; enemy: Enemy; encounterId: string; battle: BattleState };

export type BattleOutcome = "won" | "lost" | "retreat";

export function createSession(zoneId: string, seed: number): Session {
  return {
    world: createWorld(getZone(zoneId), ENEMY_KINDS, seed),
    party: startingParty(),
    discovered: new Set(STARTER_JOBS),
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
  return partySpecsOf(session.party);
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
    const notes = awardXp(session, encounterIdFor(enemy), session.party.filter((m) => m.hp > 0));
    const message = [`The ${name} is no match for you. It scatters at your touch.`, ...notes.map(describeNote(session))].join(" ");
    return { kind: "instant", enemy, assessment, message, notes };
  }
  session.battlesFought += 1;
  return { kind: "battle", enemy, encounterId: encounterIdFor(enemy), battle: createBattle(setup, BATTLE_CONTENT, seed) };
}

function defeatEnemy(session: Session, enemyId: string) {
  removeEnemy(session.world, enemyId);
  session.defeated.push(enemyId);
}

/** Every surviving member gains XP in their primary job. */
function awardXp(session: Session, encounterId: string, members: Character[]): ProgressNote[] {
  const xp = encounterXp(encounterId);
  return members.flatMap((m) => gainXp(JOB_CONTENT, m, xp, session.discovered));
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
      const encounterId = enemy ? encounterIdFor(enemy) : null;
      syncPartyHp(session, battle, true);
      defeatEnemy(session, enemyId);
      const notes = encounterId ? awardXp(session, encounterId, standing) : [];
      const xp = encounterId ? ` +${encounterXp(encounterId)} job XP.` : "";
      return [`Victory over the ${name}.${xp}`, ...notes.map(describeNote(session))].join(" ");
    }
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

/**
 * Touch a map feature. A job source adds its job to the discovered set the
 * first time. Returns the line to show.
 */
export function interact(session: Session, featureId: string): { message: string; discovered?: string } {
  const f = session.world.zone.features.find((x) => x.id === featureId);
  if (!f) throw new Error(`No feature '${featureId}'`);
  if (f.kind === "job" && !session.discovered.has(f.job)) {
    session.discovered.add(f.job);
    return { message: `${f.text} (Open the party menu with P.)`, discovered: f.job };
  }
  return { message: f.after ?? f.text };
}

export function partyIsDown(session: Session): boolean {
  return session.party.every((m) => m.hp <= 0);
}
