# Maze of Doom — Design Seed

> Founding design document. Build toward the **Vertical Slice** milestones (§10) one at a time.
> Items under **Open Questions** must be asked before deciding. See **§12 Decisions Log** for answers so far.

---

## 1. Pitch

A single-player RPG where you start with nothing inside a living, endless Maze and grow in power by exploring themed zones: lava fields, castles, jungles, and more. The target feeling is the freeform, "the world never ends" exploration of early EverQuest, combined with Metroidvania-style permanent progression.

**This is NOT a roguelike.** Progress is permanent. Death should not wipe the world or the party's growth.

**Influences:** Lufia 2 (Ancient Cave, field tools, turn-based battles), Final Fantasy Tactics (job system), Pokémon (top-down exploration, party building), Super Metroid / Symphony of the Night (ability-gated exploration), Into the Breach (telegraphed enemy intents), Darkest Dungeon (position-based skills), Mega Man Battle Network (compact grid combat), Earthbound (visible enemies, instant wins).

## 2. Core Loop

```
Explore a zone → discover a job → gain skills → unlock new zones → discover more jobs
```

Every system should feed this loop. Skills are both how you win fights **and** how you open the world.

## 3. World & Exploration

- **Top-down, tile-based navigation** in the style of Pokémon.
- The Maze is an **endless graph of themed zones** connected by doors and paths.
- **Generate once, then persist.** A zone is generated the first time the player enters it, then saved permanently. Use seeded RNG so generation is reproducible.
- **Metroidvania gating by skills, not keys.** Examples:
  - Float or fire resistance → cross lava
  - Water breathing → sunken temple
  - Lockbreak → sealed vaults
  - Runescribe → rune-sealed doors
  - Players should often *see* a zone or area long before they can reach or survive it.
- **Zone recipe** (every zone needs all five):
  1. **Theme** (e.g. jungle)
  2. **Twist** (e.g. the canopy is the real map; the ground is poison)
  3. **Landmark** that makes it memorable
  4. **Secret** that requires a future ability
  5. **Local story thread**
- **Fewer, denser zones beat infinite empty ones.** Anti-repetition is the top design priority.

## 4. The Maze as an Entity

The Maze is a character and the central antagonist / rival.

- It **watches the player's progress and strategies** and responds.
- It **counters the player's go-to tactics** by spawning zones and enemies that resist them.
- Counters must be **telegraphed** through the Maze's commentary *before* they appear. Example: *"You rely on fire. How quaint."*
- **Counter zones hold the best rewards.**
- It can **reclaim cleared zones** so they return changed.
- Discovering **what the Maze is** forms the overarching story.

**Implementation note:** Track a player "strategy profile" (damage types used, jobs equipped, skills used most, average fight length) and feed it into zone and encounter generation.

## 5. Character Building: FFT-Style Job System

- Characters **level up in jobs** and **keep skills** they've learned after switching jobs.
- **Mixing jobs unlocks hybrid jobs.**
- **Jobs are discovered in the world** (hermit in the lava zone, ruined library, befriended monster).
- **Ability slots per character:**
  | Slot | Purpose |
  |---|---|
  | Primary job | Main command set |
  | Secondary | Skill set from another learned job |
  | Reaction | Triggered automatically in battle |
  | Support | Passive bonus |
  | Movement / Field | Battle movement **and** overworld traversal (Float, Lockbreak, etc.) |
- The Movement/Field slot is the key link: **builds trade combat power against exploration reach.**
- **Broken combos are welcome.** The Maze notices and escalates.

**Implementation note:** Jobs, skills, unlock requirements, and hybrid recipes are **data-driven**.

## 6. Party

- **Party building** with recruits **unique to zones**.
- Party size: roughly 3–6 (to be tuned against the 3x3 grid).

## 7. Battle System

### 7.1 Overview
- **Turn-based.** **Visible enemies; no random encounters.**
- **Instant win** when the party vastly outclasses an enemy (Earthbound-style).
- **Compact grid:** each side has its own **3x3 grid**.
- **Row/position rules:** jobs prefer positions; skills have **position requirements** and **target shapes** (single, line, column, row, cross, tile-behind).
- **Zone hazards on tiles:** lava burns, vines hide enemies, frozen, cracked, etc.
- **Target length:** a few minutes per fight.

### 7.2 Telegraphing — core mechanic
- At the start of each round, **every enemy shows its intended action** (tiles, damage, effect).
- The player acts with full knowledge, **then** enemies carry out their intents.
- Counterplay by **changing the board**: move off tiles, push/pull/swap enemies, block/taunt/redirect, stun/interrupt.
- **Maze escalation:** partly hidden intents, delayed attacks, retargeting attacks. Use sparingly, flag in advance.

### 7.3 Round structure
1. Enemies declare intents
2. Player issues actions (any order)
3. Enemy intents resolve against the updated board
4. Tile hazards and status effects tick
5. Check victory/defeat

**Implementation note:** The battle engine is **deterministic and separate from rendering**.

## 8. Role of AI

- **Classical procedural generation** handles layouts and **guarantees solvability and gating**. An LLM never owns spatial structure.
- **LLM generates texture:** lore, item names, NPC dialogue, boss personalities, **the Maze's voice**.
- AI text is cached and persisted with the zone.
- Fully playable with AI disabled (fallback templates).

## 9. Open Questions (ask before deciding)

- ~~Party makeup~~ → decided, see §12
- ~~Platform and tech stack~~ → decided, see §12
- ~~Art style~~ → decided, see §12
- **Balancing** the job tree, skill list, and grid rules together.
- ~~Death/defeat consequences~~ → decided, see §12
- ~~Save system~~ → decided, see §12

## 10. Vertical Slice — Build Order

1. **Top-down movement** in one handcrafted zone (tile map, collision, camera, visible enemy sprites).
2. **Battle system:** 3x3 grids, telegraphed intents, position rules, target shapes, two or three jobs, push/pull, one tile hazard. Deterministic engine with unit tests.
3. **Map-to-battle transitions** plus the instant-win rule.
4. **Job system basics:** job XP, learned skills persisting, ability slots, one hybrid job unlock.
5. **One field ability** (e.g. Float) that opens a gated path.
6. **Zone generation and persistence:** seeded generation from the zone recipe, saved on first visit, two or three themes.
7. **The Maze's voice and counter-strategy layer.**

## 11. Engineering Principles

- Data-driven content in plain data files.
- Seeded, reproducible RNG everywhere.
- Game logic separated from rendering; logic is unit-tested.
- Small, composable systems; resist premature abstraction.
- Commit after each working milestone.

## 12. Decisions Log

| Question | Decision |
|---|---|
| Platform / stack | Browser-first. TypeScript + Vite, hand-written Canvas 2D renderer, Vitest for tests. No game framework. |
| Art style | Placeholder shapes drawn in code for the slice. All drawing lives in `src/render/`, so pixel art can replace it later. |
| Party makeup | **Both** recruited people and befriended creatures. Both use the same job and ability-slot system. |
| Defeat | **The Maze relocates the party** to another known zone, with commentary. XP, jobs, and the world are kept. |
| Starting jobs (M2) | Claude's proposal, accepted: Vanguard, Lancer, Pyromancer, Mystic. See [battle.md](battle.md). Numbers are tuned by headless simulation, not final. |
| Battle turn rule (M2) | Each unit may step once **before** acting; acting ends its turn. Prevents trivial "attack, then dodge". |
| Instant win (M3) | No power formula. On touch, the battle is **simulated headlessly with the planner AI**; if the party would win within **2 rounds losing ≤10% HP**, the enemy is defeated on the spot. Tunable in `src/core/battle/autoresolve.ts`. |
| HP between fights (M3) | HP carries over. Victory revives downed members at 1 HP; retreat keeps them down. **Shrines** (rest tiles) restore the party. |
| Retreat (M3) | Allowed any time in a map battle. Damage carries over, the enemy stays, and there's a 2.5s grace period on the map. |
| Defeat (M3) | Implemented as decided: party restored, the Maze relocates it (to the zone entrance until there are more zones) with a line of commentary. |
| Starting jobs & discovery (M4) | Three starter jobs (Vanguard, Pyromancer, Mystic), one per starting character. Two jobs are discoverable in the Antechamber for testing: Lancer and Ranger. One hybrid: Spellblade (Lancer Lv2 + Pyromancer Lv2). See [jobs.md](jobs.md). |
| Job progression (M4) | Abilities are learned by job level (no point spending). XP goes to the survivors' primary jobs. Learned passives auto-equip into empty slots. Jobs can be changed freely outside battle. |
| Starting party (M4) | Three characters: Wren (person, Vanguard), Sable (person, Pyromancer), Burr (creature, Mystic). More come from zone recruits later. |
| Float (M5) | A Mystic Movement passive (Lv3). It works on the map while **any** member has it equipped; in battle it ignores lava and spikes. It opens the relic island in the Antechamber. Unequipping over lava is refused. |
| Save system (M6) | **Several slots** (3), autosaved to browser storage, with export/import as JSON files. A save holds generated zones (generate once, persist) and per-zone changes. See [zones.md](zones.md). |
| Zone generation (M6) | Three themes (Cinder Fields, Drowned Crypt, Strangler Garden). Each twist is also a mechanical modifier. Secrets are sealed by the theme's gate tile: only Float exists so far, so crypt and garden secrets are visible but wait for future abilities. |
| Universal attack (M6) | The Mystic gets **Spark** at Lv1 (1 arcane damage to any enemy), so a generated fight can never be an unwinnable stalemate (e.g. fire-immune back-row foes against a Lv1 party). |
| Hosting | Static build (`npm run build` → `dist/`), deployable to Cloudflare Pages. Relative asset paths (`base: "./"`). |
| Grid orientation (M2) | Depth 0 = front. Line shots hit the first unit in their path, **friend or foe** (enables "make them hit each other"). |
