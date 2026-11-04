# Maze of Doom

A single-player, top-down RPG set inside a living, endless Maze. You get stronger through an FFT-style job system and Metroidvania skill-gating, and fight turn-based battles on 3x3 grids with telegraphed enemy intents.

See **[docs/DESIGN.md](docs/DESIGN.md)** for the full design and the decisions log.

## Run

```sh
npm install
npm run dev        # overworld: http://localhost:5173  ·  battle sandbox: /battle.html
npm run sim        # headless battle balance simulation
npm test           # unit tests (Vitest)
npm run build      # typecheck + production build
```

Controls: arrow keys or WASD. On touch devices, an on-screen d-pad appears. Walk into a visible enemy to fight it (or it walks into you). If your party vastly outclasses it, it's an **instant win**. The glowing **shrine** near the start restores the party.

**Battle sandbox** (`battle.html`): pick an encounter, tap a party member, step to a blue tile (optional), pick a skill, tap a yellow target. Red tiles are telegraphed enemy attacks with resolve order and predicted damage. **Auto** lets the planner AI finish the round; **Undo** rewinds within a round. Rules and jobs: [docs/battle.md](docs/battle.md).

## Layout

| Path | What |
|---|---|
| `src/core/` | Pure, deterministic game logic: RNG, zones, world rules, camera. No DOM. |
| `src/core/battle/` | Battle engine, grid shapes, planner AI. No DOM. |
| `src/battle/` | Battle view component (DOM), used by the overworld and the sandbox page. |
| `src/game/` | Session glue: persistent party, map encounters, instant win, battle outcomes. |
| `scripts/` | Headless tools (balance simulation). |
| `src/data/` | Content as JSON: tiles, enemy kinds, zones. |
| `src/render/` | Canvas 2D drawing and visual-only tweens. Placeholder shapes. |
| `src/main.ts` | Browser entry: input, timing, wiring. |
| `tests/` | Unit tests for `src/core`. |

## Progress

- [x] **M1** Top-down movement in one handcrafted zone (tile map, collision, camera, visible enemies)
- [x] **M2** Battle system (3x3 grids, telegraphed intents, positions, shapes, 4 jobs, push/pull, fire/lava hazards)
- [x] **M3** Map-to-battle transitions + instant win (simulated), HP carry-over, retreat, shrine, defeat relocation
- [ ] **M4** Job system basics
- [ ] **M5** One field ability (Float)
- [ ] **M6** Zone generation & persistence
- [ ] **M7** The Maze's voice & counter-strategy
