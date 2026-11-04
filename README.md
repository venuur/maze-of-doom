# Maze of Doom

A single-player, top-down RPG set inside a living, endless Maze. You get stronger through an FFT-style job system and Metroidvania skill-gating, and fight turn-based battles on 3x3 grids with telegraphed enemy intents.

See **[docs/DESIGN.md](docs/DESIGN.md)** for the full design and the decisions log.

## Run

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (Vitest)
npm run build      # typecheck + production build
```

Controls: arrow keys or WASD. On touch devices, an on-screen d-pad appears.

## Layout

| Path | What |
|---|---|
| `src/core/` | Pure, deterministic game logic: RNG, zones, world rules, camera. No DOM. |
| `src/data/` | Content as JSON: tiles, enemy kinds, zones. |
| `src/render/` | Canvas 2D drawing and visual-only tweens. Placeholder shapes. |
| `src/main.ts` | Browser entry: input, timing, wiring. |
| `tests/` | Unit tests for `src/core`. |

## Progress

- [x] **M1** Top-down movement in one handcrafted zone (tile map, collision, camera, visible enemies)
- [ ] **M2** Battle system
- [ ] **M3** Map-to-battle transitions + instant win
- [ ] **M4** Job system basics
- [ ] **M5** One field ability (Float)
- [ ] **M6** Zone generation & persistence
- [ ] **M7** The Maze's voice & counter-strategy
