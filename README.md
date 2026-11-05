# Maze of Doom

A single-player, top-down RPG set inside a living, endless Maze. You get stronger through an FFT-style job system and Metroidvania skill-gating, and fight turn-based battles on 3x3 grids with telegraphed enemy intents.

See **[docs/DESIGN.md](docs/DESIGN.md)** for the full design and the decisions log.

## Run

```sh
npm install
npm run dev        # overworld: http://localhost:5173  ·  battle sandbox: /battle.html
npm run sim        # headless battle balance simulation (npm run sim -- 40 lv2 for a party preset)
npm run sim:zones  # win rates for generated encounters by depth
npm test           # unit tests (Vitest)
npm run build      # typecheck + production build
```

Start from the title screen: pick a save slot (3 slots, autosaved; export/import as files). Controls: arrow keys or WASD. On touch devices, an on-screen d-pad appears. Walk into a visible enemy to fight it (or it walks into you). If your party vastly outclasses it, it's an **instant win**. The glowing **shrine** near the start restores the party. Press **P** (or tap **Party**) to change jobs and fill ability slots. Figures marked **!** teach new jobs. Lava needs **Float** (Mystic Lv3, equipped in a Movement slot). Rules: [docs/jobs.md](docs/jobs.md). The Antechamber's exit leads into an endless graph of generated zones, built the first time you enter and kept forever: [docs/zones.md](docs/zones.md).

**Battle sandbox** (`battle.html`): pick an encounter and a party preset (starting Lv1, Lv2, veteran, or a Spellblade), tap a party member, step to a blue tile (optional), pick a skill, tap a yellow target. Red tiles are telegraphed enemy attacks with resolve order and predicted damage. **Auto** lets the planner AI finish the round; **Undo** rewinds within a round. Rules and jobs: [docs/battle.md](docs/battle.md).

## Deploy (Cloudflare Pages)

Static site, no server. In Cloudflare Pages, connect the repo and set:

| Setting | Value |
|---|---|
| Framework preset | None (or Vite) |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node version | from `.nvmrc` (20) |

Both pages ship: `/` (overworld) and `/battle.html` (sandbox).

## Layout

| Path | What |
|---|---|
| `src/core/` | Pure, deterministic game logic: RNG, zones, world rules, camera. No DOM. |
| `src/core/jobs.ts` | Job system: XP, levels, learned abilities, slots, hybrid unlocks. No DOM. |
| `src/core/gen/` | Seeded zone generator (layout, recipe, encounters) with reachability guarantees. No DOM. |
| `src/core/battle/` | Battle engine, grid shapes, planner AI. No DOM. |
| `src/battle/` | Battle view component (DOM), used by the overworld and the sandbox page. |
| `src/game/` | Session (zone graph, travel, party, encounters, XP, outcomes) and save slots. |
| `src/ui/` | Party menu and title / save-slot screen (DOM). |
| `scripts/` | Headless tools (balance simulation). |
| `src/data/` | Content as JSON: tiles, enemy kinds, zones, themes, jobs, skills, abilities. |
| `src/render/` | Canvas 2D drawing and visual-only tweens. Placeholder shapes. |
| `src/main.ts` | Browser entry: input, timing, wiring. |
| `tests/` | Unit tests for `src/core` and `src/game`. |

## Progress

- [x] **M1** Top-down movement in one handcrafted zone (tile map, collision, camera, visible enemies)
- [x] **M2** Battle system (3x3 grids, telegraphed intents, positions, shapes, 4 jobs, push/pull, fire/lava hazards)
- [x] **M3** Map-to-battle transitions + instant win (simulated), HP carry-over, retreat, shrine, defeat relocation
- [x] **M4** Job system: 3 starter + 2 discoverable jobs, XP and levels, learned abilities persist, 5 ability slots, Spellblade hybrid
- [x] **M5** Field ability: Float (Mystic Lv3, Movement slot) crosses lava to the relic island
- [x] **M6** Zone generation & persistence: endless seeded zone graph, 3 themes, full recipe per zone, 3 autosaved slots with export/import
- [ ] **M7** The Maze's voice & counter-strategy
