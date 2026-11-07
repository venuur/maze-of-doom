# The Maze: Voice & Counter-Strategy (Milestone 7)

The Maze is a rival that watches how you fight, **says so out loud**, and only then builds zones that resist it. Logic: `src/core/maze/` (pure, tested in `tests/maze.test.ts`). Content: `src/data/maze.json`.

## The strategy profile (`profile.ts`)

Every battle you actually fight (won, lost or retreated) is read from the battle log:

- party damage by **element** (collisions and enemy damage are excluded);
- **skill** uses, plus how many push/pull/shove/swap (**displacement**) and how many guard/taunt (**defense**);
- **jobs** in the party, and **fight length**.

Totals **decay by 15% per battle**, so the Maze tracks your current habits, not your whole history. Instant wins count as fights seen but teach it nothing else.

A **habit** needs evidence: at least 3 fights, and one of

| Habit | Threshold |
|---|---|
| fire | ≥ 55% of party damage (with ≥ 25 damage seen) |
| physical | ≥ 55% of party damage |
| displacement | ≥ 30% of skill uses (with ≥ 8 uses seen) |
| defense | ≥ 30% of skill uses |

## Telegraph first, counter second

1. After a fight, if the Maze sees a habit (and **8 fights** have passed since it last named one), it **names it**, e.g. *"You rely on fire. How quaint."* This is the telegraph, and it **arms** a counter.
2. The **next newly generated zone** is the counter zone. Arming only happens in step 1, so a counter can never appear before the Maze has said why.
3. On arrival it announces itself: the zone label shows `⚠ Fireproof`, the twist is replaced by the counter, and the Maze adds a line.

| Habit | Counter zone | Effect on every foe there | Favoured foe | Theme |
|---|---|---|---|---|
| fire | **Fireproof** | fire resist ×0.25 | wisp | crypt |
| physical | **Stone-skinned** | physical resist ×0.5 | warden | garden |
| displacement | **Rooted** | can't be displaced (`steadfast`) | warden | any |
| defense | **Piercing** | ignores guard and taunt (`pierce`, new engine trait) | archer | any |

**Counter zones hold the best rewards:** encounters there give **×1.5 job XP** and the relic **×2**. Clearing one gets a grudging line (*"Hm. You adapted. Noted."*).

In a simulated 22-fight run, about 2 of every 5 new zones were counter zones, and they're always announced. Tune with `noticeCooldown` (maze.json) and `HABIT_RULES` (profile.ts).

## Reclaiming cleared zones

Clear every enemy in a generated zone, fight **6 battles** elsewhere, then come back: the Maze has **reclaimed** it. Its enemies return, one depth tougher per reclaim, with a line (*"{zone} is mine again. I've redecorated."*). The Antechamber is never reclaimed.

## The voice: templates now, an LLM later

All words go through one interface (`MazeVoice` in `maze.ts`):

```ts
interface MazeVoice {
  notice(tactic, ctx, rng): string;   // the telegraph
  arrive(tactic, ctx, rng): string;   // counter-zone arrival
  line(event, ctx, rng): string;      // defeat | reclaim | counterWin | firstZone
}
```

The shipped implementation is `templateVoice(MAZE)`, which picks from `maze.json`, filling `{share}`, `{zone}` and `{counter}`. It's wired in one place (`MAZE_VOICE` in `src/data/index.ts`).

To add an LLM voice later, implement the same interface. It never decides *what* happens (the rules above do); it only words it. Things to settle when wiring it:

- **Synchronous interface, asynchronous LLM.** One option: pre-generate or cache lines per (event, tactic) and fall back to the template on a miss. Another: show the template line now and swap in the LLM line when it arrives.
- **Persistence:** every line said is stored in `maze.said` (last 40) in the save, so text is cached and persisted as the design asks.
- **Context to send:** the tactic, share, zone name and recent `said` lines (for continuity), plus the profile summary shown in the party menu.
- **Key handling:** a static Cloudflare Pages site can't hold an API key. It would need a small proxy (e.g. a Cloudflare Worker) or a user-supplied key.
- **Determinism:** the RNG passed in is seeded, so templates replay exactly. An LLM voice won't, which is fine because text never affects game state.

## Where to see it

- Maze lines appear in red italics in the message box.
- **Party menu (P) → "The Maze is watching"** shows what it has seen (damage split, favourite skills, fight length), the habit it's tracking or has armed, the counter zones built, and its last 5 lines.
