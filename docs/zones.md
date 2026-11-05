# Zones, Generation & Saves (Milestone 6)

## The zone graph

The Antechamber is handcrafted. Its exit, and every exit after it, leads to a zone that is **generated the first time you go through** and then **saved permanently**. It is never regenerated. Each generated zone has a `back` exit to where you came from, plus 1–2 forward exits leading deeper, so the graph never ends. Links are stored both ways in the session (`links["zone/exit"]`).

- **Depth** = distance from the Antechamber. It scales enemy count and encounter budget.
- **Theme** is picked by seeded RNG from `src/data/themes.json`, never the same as the zone you came from.
- **Seeds:** every zone's seed is derived from the game's master seed and the zone id (FNV-1a). The same master seed rebuilds the same world.

## Themes (`src/data/themes.json`)

| Theme | Floor / walls | Pools & secret gate | Landmark | Foes |
|---|---|---|---|---|
| **Cinder Fields** | ash / basalt | lava → **Float** (available now) | obsidian spire | wisp, slime, warden |
| **Drowned Crypt** | flagstone / stone | water → swim (future) | drowned bell | archer, slime, warden |
| **Strangler Garden** | grass / trees | vines → cut (future) | great tree | slime, archer, warden, wisp |

Adding a theme is data only: tiles, name lists, twists, stories, landmark, foe pool.

## The recipe, made concrete

Every generated zone fills all five parts of the recipe, and each part exists on the map:

| Part | In data | On the map |
|---|---|---|
| Theme | theme name | floor/wall/pool tiles, foe pool |
| **Twist** | one of the theme's twists, announced on entry | a mechanical modifier: more pools, more enemies, a foe type that leads most fights, or **battle hazards** (burning or spiked ground in every fight) |
| Landmark | name + text | a 2×2 landmark block in the largest room |
| Secret | text | a relic in a room **sealed by the theme's gate tile** |
| Story | an inscription | a standing stone you touch to read |

## Generation guarantees (`src/core/gen/zonegen.ts`)

Classical procgen owns all layout: rooms, a spanning tree of corridors plus one loop, and a spur to the secret room, whose openings are all replaced by the gate tile. Then it checks:

- Exits, every main room, the shrine and the inscription are **reachable with no abilities**.
- The relic is **not** reachable without the gate ability, and **is** reachable with it.
- Decorative pools are kept only if they cut nothing off.

If any check fails, the layout is retried with the same RNG stream, so it stays deterministic. `tests/zonegen.test.ts` checks these guarantees for 40 seeds per theme.

Text comes from templates (the "AI disabled" fallback). An LLM may replace the text later, never the layout.

## Encounters

Each enemy leads its own encounter, stored in the zone data. Foes come from the theme pool, plus the twist's favoured foe, within a budget of `7 + 3 × depth + 0..3`. Foe XP doubles as cost, with at most 5 foes. Each foe is placed in its preferred depth.

Balance (`npm run sim:zones`, planner AI):

| Depth | Starting party (Lv1) | Lv2 | Lv3+ |
|---|---|---|---|
| 1 | 79% | 100% | 100% |
| 2 | 79% | 100% | 100% |
| 3 | 70% | 100% | 100% |
| 4 | 65% | 100% | 100% |

The planner plays well; people will find these harder. Difficulty stays gentle for playtesting. Making deeper zones harder is a job for the Maze's counter-strategy layer (Milestone 7).

## Saves (`src/game/save.ts`)

- **3 slots**, autosaved to the browser's `localStorage`: on zone travel, after every battle, on instant wins, discoveries, relics, shrines and party-menu changes, every 10 s while walking, and when the tab is hidden or closed.
- A save holds the master seed, party, discovered jobs, **every generated zone's data**, each zone's changes (defeated enemies, collected relics, RNG state), the zone graph and the player's position. A battle in progress isn't saved: you resume on the map just before it.
- The title screen (also under "save slots" in the header) offers Continue / New game / Delete (with a confirmation) / **Export** (downloads JSON) / **Import** (validated, version-checked).
- `SAVE_VERSION = 1`. Future format changes bump it and add a migration.
- **Defeat** now relocates the party to the start of *another* zone it has already seen, as originally decided. With only one zone, it's that zone's start.
