# Battle System (Milestone 2)

Engine: `src/core/battle/` (deterministic, no DOM). Content: `src/data/{skills,jobs,enemies,hazards,encounters}.json`.
Sandbox: `battle.html`. Balance sim: `npm run sim`.

## Board

Each side has a 3x3 grid. **Depth** 0 = front (nearest the enemy), 2 = back. **Lane** = row.

```
 PARTY  back → front   |   front → back  FOES
        d2  d1  d0     |   d0  d1  d2
lane 1  .   .   .      |   .   .   .
lane 2  .   .   .      |   .   .   .
lane 3  .   .   .      |   .   .   .
```

## Round

1. **Foes declare intents.** Targeted tiles are highlighted with predicted damage and numbered in resolve order. Mobile foes may step one tile first.
2. **Player phase.** Each party member may **step once** (one orthogonal tile; stepping into an ally swaps you), then **use one skill**. Acting ends that unit's turn, so you can't attack and then dodge.
3. **Intents resolve** in order against the board *as it is now*.
4. **Hazards tick** (fire 2, lava 3, fire element). Guard and taunt expire; cooldowns tick.
5. **Victory / defeat** check.

## Two kinds of telegraphs (the core of counterplay)

| Kind | Shapes | How to beat it |
|---|---|---|
| **Aimed** (tile locked when declared) | single, cross, behind, column | Step off the tiles, or **Taunt** to redirect single/cross/behind onto the Vanguard (redirects follow the taunter) |
| **Positional** (follows the attacker) | line, lane | **Displace the attacker**: shove it to another lane, or put something in its way. Line shots hit the *first unit in the path*, including the attacker's own allies. |

Any intent can be **cancelled** (Silence) or **stunned** (Daze: cancels this round and skips the next).

## Rules

- **Target shapes:** `single`, `line` (first unit in your lane, friend or foe), `lane` (whole opposing lane), `ownLane`, `column` (all lanes at one depth), `cross`, `behind` (tile + tile behind), `self`.
- **Position requirements:** `from` (depths you must stand in) and `reach` (depths you may target).
- **Preferred depth:** +1 power when a unit stands in its job's preferred depth (★ in the UI).
- **Displacement:** push back, pull forward, or shove a lane up/down. Blocked by a unit or the grid edge = **collision**: 1 damage to each unit involved. Transpose swaps instead of colliding.
- **Resistances:** multipliers per element (0 = immune). **Guard** halves damage.
- **Friendly fire:** your own line skills are blocked by allies in front of you, too.

## Jobs

| Job | Prefers | Role | Skills |
|---|---|---|---|
| **Vanguard** | front | Tank / redirect | Strike, Shield Bash (push), Taunt, Brace, Rampart (guard lane) |
| **Lancer** | middle | Displacement | Jab, Hook (line pull), Lunge (pierce 2), Sweep (column push), Shunt (lane shove) |
| **Pyromancer** | back | Area damage / zoning | Firebolt (line), Flame Pillar (column), Scorch (fire tile), Detonate (cross) |
| **Mystic** | middle/back | Control / support | Mend, Silence, Daze (stun), Ward, Transpose (swap two enemies) |

## Enemies

| Enemy | HP | Notes |
|---|---|---|
| Ash Slime | 11 | Mobile, front. Slam (line), Glob (single). Fire ×0.5 |
| Stone Warden | 22 | Immobile, front. Crush (front single 5), Quake (column). Physical ×0.5, fire ×1.5 |
| Ember Wisp | 6 | Mobile, back. Ember Rain (cross), Flicker. **Fire immune** |
| Bone Archer | 9 | Immobile, back. Arrow (line, friendly fire!), Volley (lane) |

## From the map (Milestone 3)

Each overworld enemy leads an encounter (`encounter` on the spawn, else its kind's default in `enemies.json`). On touch, `startEncounter` (`src/game/session.ts`) first runs `assessEncounter`: the planner plays the fight headlessly, and if it wins within 2 rounds losing at most 10% of current HP, the enemy is removed without a battle. Otherwise the battle view opens with the party's carried-over HP.

| Antechamber enemy | Encounter |
|---|---|
| Ash Slime (south) | Lone Slime: instant win at full strength |
| Ash Slime (northwest) | Slime Pack |
| Stone Warden (north door) | Archer Nest |
| Ember Wisp (center) | Ember Court |
| Ember Wisp (east) | The Gauntlet |

## Balance simulation

`npm run sim [seeds]` plays every encounter with four party policies (the planner is a greedy search with one round of lookahead, `src/core/battle/planner.ts`):

- **naive:** never moves, picks the skill with the most immediate damage, ignores telegraphs
- **dodge + damage only:** reads telegraphs and moves, but only pure damage skills
- **full kit, no moving:** every skill, reads telegraphs, never steps
- **full kit:** everything

Results at the time of writing:

```
Slime Pack  (40 seeds)
  policy                         win  rounds  HP left
  naive (ignores telegraphs)    100%     4.2      75%
  dodge + damage only           100%     4.0      79%
  full kit, no moving           100%     4.0      87%
  full kit (planner)            100%     3.2     100%

Archer Nest  (40 seeds)
  policy                         win  rounds  HP left
  naive (ignores telegraphs)     15%    21.0      29%
  dodge + damage only           100%     5.4      30%
  full kit, no moving           100%     5.2      53%
  full kit (planner)            100%     5.8     100%

Ember Court  (40 seeds)
  policy                         win  rounds  HP left
  naive (ignores telegraphs)      0%     0.0       0%
  dodge + damage only             0%     0.0       0%
  full kit, no moving            95%    10.0      87%
  full kit (planner)            100%     9.4      92%

The Gauntlet  (40 seeds)
  policy                         win  rounds  HP left
  naive (ignores telegraphs)      8%    15.0      80%
  dodge + damage only            10%     7.3      33%
  full kit, no moving            70%    11.7      43%
  full kit (planner)            100%     7.0      83%

Skill usage by the full planner (all encounters):
  hook             440  ##############
  daze             359  ############
  firebolt         345  ###########
  brace            270  #########
  taunt            254  ########
  strike           249  ########
  mend             248  ########
  scorch           233  ########
  silence          215  #######
  flame_pillar     199  ######
  shunt            160  #####
  sweep            144  #####
  detonate         137  ####
  rampart           97  ###
  lunge             91  ###
  jab               82  ###
  transpose         80  ###
  shield_bash       72  ##
  ward              49  ##

```

**What this shows:**
- Reading telegraphs matters: in Archer Nest, *dodge + damage only* wins 100% vs 15% for naive.
- Board manipulation matters: in Ember Court and the Gauntlet, damage-only play nearly always fails (fire-immune wisps in the back row can't be reached without pulls and shoves), while the full kit wins 100%.
- Movement and control complement each other: full kit with movement beats full kit without it on win rate, speed and HP.
- Every party skill gets used and no skill dominates. Ward and Shield Bash are the weakest candidates for future buffs.
- Slime Pack is deliberately a tutorial: everyone wins.

### Tuning history
1. First pass: naive play won 100% everywhere in about 3 rounds. Enemy power +1 and HP x1.6.
2. Shunt (any reach) was the most-used skill by far → limited to front/middle reach, so Hook is how you reach the back row.
3. Transpose (swap with an ally) was never used → redesigned to *swap two enemies*, which rearranges two positional intents at once.
4. Ember Court ran about 12 rounds → wisp HP 8 → 6.
