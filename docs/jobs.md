# Job System (Milestone 4)

FFT-style. Characters gain **job XP** from victories in their current (primary) job, level it up, and **permanently learn** that job's abilities. Switching jobs keeps everything learned.

All content is data: `src/data/jobs.json` (jobs, unlock rules, abilities by level), `src/data/abilities.json` (passives), `src/data/party.json` (XP thresholds, starting characters). Logic: `src/core/jobs.ts` (pure, unit-tested in `tests/jobs.test.ts`).

## Rules

- **XP:** each foe is worth XP (`enemies.json`). On victory, **every member still standing** gets the encounter's total in their primary job. Instant wins count. Retreat and defeat give nothing.
- **Levels:** Lv2 at 8 XP, Lv3 at 20, Lv4 at 36 (cap for the slice). Thresholds are deliberately low so the slice can be tested in a few fights.
- **Learned abilities persist.** A job you've taken up stays in your record with its level.
- **Slots per character:**

  | Slot | Holds |
  |---|---|
  | Primary job | Its learned commands; sets base HP and preferred depth |
  | Secondary | The learned commands of one other job you've taken up |
  | Reaction | A learned reaction passive, from any job |
  | Support | A learned support passive, from any job |
  | Movement | A learned movement passive, from any job. Some also work on the map (**field abilities**) |

- A newly learned passive **auto-equips** if its slot is empty.
- **Changing jobs:** free, any time outside battle, via the party menu (**P**). HP keeps its fraction of the new max. Downed members stay down.
- **Jobs are discovered in the world.** Three starter jobs are known from the start. Two more are taught by things you touch in the Antechamber. Any character may take up a discovered job.
- **Hybrid jobs** unlock **per character** when that character reaches the required levels in their component jobs. Hybrids need no discovery.

## Jobs

| Job | Unlock | HP | Prefers | Lv1 | Lv2 | Lv3 | Lv4 |
|---|---|---|---|---|---|---|---|
| **Vanguard** | starter | 16 | front | Strike, Brace | Taunt, *Counter* (R) | Shield Bash, *Fortitude* (S) | Rampart |
| **Pyromancer** | starter | 9 | back | Firebolt, Scorch | Flame Pillar, *Kindling* (S) | Detonate, *Ember Walk* (M) | |
| **Mystic** | starter | 10 | mid/back | Mend, Ward | Silence, *Blink* (M) | Daze, ***Float*** (M, field) | Transpose, *Second Wind* (R), *Devotion* (S) |
| **Lancer** | the Old Lancer, south corridor | 11 | middle | Jab, Hook | Shunt, *Anchor* (S) | Lunge, *Repel* (R) | Sweep, *Stride* (M) |
| **Ranger** | a bow by the lava pool, NE | 10 | back | Aimed Shot, Caltrops | Arrow Rain, *Deadeye* (S) | Pinning Shot, *Stride* (M) | |
| **Spellblade** | hybrid: Lancer Lv2 + Pyromancer Lv2 | 13 | front/mid | Flame Lunge, Searing Hook | Blazing Sweep, *Burning Riposte* (R) | *Kindling* (S) | |

R = reaction, S = support, M = movement.

## Passives

| Passive | Slot | Effect |
|---|---|---|
| Counter | reaction | Hit by an enemy attack: deal 2 back to the attacker |
| Burning Riposte | reaction | Hit by an enemy attack: deal 3 fire back to the attacker |
| Repel | reaction | Hit by an enemy attack: shove the attacker back a tile |
| Second Wind | reaction | Once per battle, on dropping to half HP or less: heal 4 |
| Fortitude | support | +4 max HP |
| Kindling | support | +1 power to fire skills |
| Deadeye | support | +1 power to single-target skills |
| Devotion | support | Your heals restore +2 |
| Anchor | support | Immune to push, pull, shove and swap |
| Blink | movement | Step to any tile on your grid |
| Stride | movement | Step up to two tiles |
| Ember Walk | movement | Fire and lava tiles don't hurt you |
| **Float** | movement, **field** | Battle: lava and spikes don't hurt you. Map: the party can cross lava |

Reactions fire **after** the triggering attack fully resolves, and only against attacks from the opposing side (never friendly fire). In the engine, passives are plain `UnitTraits` fields. The engine knows nothing about jobs.

## Field abilities (Milestone 5)

A Movement passive with a `field` value (`abilities.json`) gives the **whole party** that ability on the map while **any member has it equipped**. Tiles with a matching `gate` (`tiles.json`) become passable: `float` crosses lava (`~`).

- This is the design doc's trade-off: the Mystic who carries Float gives up Blink (move anywhere in battle) for exploration reach.
- Float is learned at Mystic Lv3. Blink, learned at Lv2, already fills the slot, so **Float has to be equipped by hand** in the party menu. Touching lava without it says what's needed.
- You can't take Float off (or change job in a way that drops it) while hovering over lava. The change is refused and rolled back.
- **The gated area:** the relic on the island in the northeast lava pool (the Antechamber's recipe secret). Collecting it gives every member 12 job XP and a line of story.

## Interesting combinations (what the system is meant to produce)

- **Pyromancer with Mystic secondary + Blink:** a back-row nuker who can heal and teleport out of any telegraph.
- **Vanguard with Counter + Fortitude, Lancer secondary:** a front-line wall that pulls enemies into range and punishes every hit.
- **Ember Walk** on anyone: stand on lava tiles foes can't afford to path through.
- **Anchor** on a Mystic: immune to the archers' displacement setups. **Deadeye + Aimed Shot**: 5-damage snipes into the back row.
- **Spellblade with Pyromancer secondary + Kindling:** every fire skill from both jobs at +1.

## Balance check (planner AI, 40 seeds; `npm run sim -- 40 <preset>`)

| Encounter | Starting party (Lv1) | Lv2 |
|---|---|---|
| Lone Slime | 100% (instant win) | 100% |
| Slime Pack | 100% | 100% |
| Archer Nest | 100% | 100% |
| Ember Court | **0%**: fire-immune wisps behind lava; Lv1 has no non-fire reach | 100% |
| The Gauntlet | 8% | 100% |

The Lv1 starters have one answer per problem. Ember Court is a soft gate: you need Silence (Mystic Lv2), Ranger's Aimed Shot, or Lancer's Hook to deal with the wisps. The planner is a strong player, so expect humans to find these fights harder. Presets `lv3`, `veteran` and `hybrid` are also available, both in the simulator and in the battle sandbox.
