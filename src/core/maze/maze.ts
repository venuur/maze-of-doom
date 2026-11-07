/**
 * The Maze as a rival. It reads the strategy profile, names your habit out
 * loud (the telegraph), and only after that builds a counter zone for it.
 * Counter zones resist the habit and pay better. It also reclaims zones you
 * cleared, filling them again.
 *
 * Words come from a MazeVoice. The default is templates; an LLM-backed voice
 * can implement the same interface later (with the template as fallback),
 * without touching any rule here. Pure; no DOM.
 */
import { Rng } from "../rng";
import type { UnitTraits } from "../battle/types";
import { dominantHabit, emptyProfile, type StrategyProfile, type Tactic } from "./profile";

/** How a counter zone answers a habit (from data). */
export interface CounterDef {
  /** Display name, e.g. "Fireproof". */
  name: string;
  /** Twist text for the counter zone (replaces the theme's twist). */
  twist: string;
  /** Multiplied into every foe's resistances. */
  resist?: Record<string, number>;
  /** Added to every foe. */
  traits?: UnitTraits;
  /** This foe kind leads most encounters. */
  foeBias?: string;
  /** Preferred theme for the counter zone, if not the one you're leaving. */
  theme?: string;
}

export interface MazeContent {
  counters: Record<Tactic, CounterDef>;
  /** Template lines by event. `{share}`, `{zone}`, `{counter}` are filled in. */
  lines: Record<MazeEvent, string[]>;
  /** Per-tactic lines for notice (the telegraph) and counter-zone arrival. */
  notice: Record<Tactic, string[]>;
  arrive: Record<Tactic, string[]>;
  /** Battles between the Maze naming a habit and being able to name another. */
  noticeCooldown: number;
  /** Battles fought elsewhere before a cleared zone can be reclaimed. */
  reclaimAfter: number;
  /** Reward multipliers in counter zones. */
  counterXp: number;
  counterRelicXp: number;
}

export type MazeEvent = "defeat" | "reclaim" | "counterWin" | "firstZone";

export interface MazeState {
  profile: StrategyProfile;
  /** Habit the Maze has named and will answer with the next new zone. */
  armed: Tactic | null;
  /** Battle count when it last named a habit. */
  lastNoticeAt: number;
  /** Counter zones built, per tactic. */
  built: Partial<Record<Tactic, number>>;
  /** Everything the Maze has said, newest last (capped). Persisted with the save. */
  said: { at: number; text: string }[];
  /** Line counter: seeds the voice's RNG so lines vary but replay. */
  lineCount: number;
}

export function newMazeState(): MazeState {
  return { profile: emptyProfile(), armed: null, lastNoticeAt: -1000, built: {}, said: [], lineCount: 0 };
}

export interface VoiceContext {
  share?: number;
  zone?: string;
  counter?: string;
}

/** Produces the Maze's words. Must be deterministic for a given (seed, n). */
export interface MazeVoice {
  notice(tactic: Tactic, ctx: VoiceContext, rng: Rng): string;
  arrive(tactic: Tactic, ctx: VoiceContext, rng: Rng): string;
  line(event: MazeEvent, ctx: VoiceContext, rng: Rng): string;
}

const fill = (t: string, ctx: VoiceContext) =>
  t
    .replace("{share}", `${Math.round((ctx.share ?? 0) * 100)}%`)
    .replace("{zone}", ctx.zone ?? "here")
    .replace("{counter}", ctx.counter ?? "something");

/** Fallback voice: picks from the data templates. */
export function templateVoice(content: MazeContent): MazeVoice {
  return {
    notice: (t, ctx, rng) => fill(rng.pick(content.notice[t]), ctx),
    arrive: (t, ctx, rng) => fill(rng.pick(content.arrive[t]), ctx),
    line: (e, ctx, rng) => fill(rng.pick(content.lines[e]), ctx),
  };
}

export const MAX_SAID = 40;

/** Record a line as said (and return it, prefixed for display). */
function say(state: MazeState, at: number, text: string): string {
  state.said.push({ at, text });
  if (state.said.length > MAX_SAID) state.said.splice(0, state.said.length - MAX_SAID);
  return `The Maze: "${text}"`;
}

function voiceRng(state: MazeState, seed: number): Rng {
  state.lineCount += 1;
  return new Rng((seed ^ Math.imul(state.lineCount, 0x9e3779b1)) >>> 0);
}

/**
 * After a battle: maybe name a habit. Telegraph first, counter later. This
 * is the only place a counter gets armed, so a counter zone can never appear
 * before the Maze has said why. Returns the line, or null.
 */
export function considerHabit(state: MazeState, content: MazeContent, voice: MazeVoice, seed: number, battles: number): string | null {
  if (state.armed) return null;
  if (battles - state.lastNoticeAt < content.noticeCooldown) return null;
  const habit = dominantHabit(state.profile);
  if (!habit) return null;
  state.armed = habit.tactic;
  state.lastNoticeAt = battles;
  const text = voice.notice(habit.tactic, { share: habit.share, counter: content.counters[habit.tactic].name }, voiceRng(state, seed));
  return say(state, battles, text);
}

/**
 * A new zone is about to be generated: if a counter is armed, this zone
 * becomes the counter zone and the arm is spent.
 */
export function takeCounter(state: MazeState): Tactic | null {
  const t = state.armed;
  if (!t) return null;
  state.armed = null;
  state.built[t] = (state.built[t] ?? 0) + 1;
  return t;
}

export function arrivalLine(state: MazeState, voice: MazeVoice, seed: number, battles: number, tactic: Tactic, ctx: VoiceContext): string {
  return say(state, battles, voice.arrive(tactic, ctx, voiceRng(state, seed)));
}

export function mazeLine(state: MazeState, voice: MazeVoice, seed: number, battles: number, event: MazeEvent, ctx: VoiceContext = {}): string {
  return say(state, battles, voice.line(event, ctx, voiceRng(state, seed)));
}
