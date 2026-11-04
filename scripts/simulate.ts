/**
 * Headless balance simulation: plays every encounter with several party
 * policies across many seeds and reports how much reading the telegraphs
 * and manipulating the board actually matters.
 *
 *   npm run sim            # 40 seeds
 *   npm run sim -- 200     # more seeds
 */
import { applyAction, createBattle, endTurn } from "../src/core/battle/engine";
import { FULL_PLANNER, isDamageOnly, planTurn, type PlannerOptions } from "../src/core/battle/planner";
import { BATTLE_CONTENT, ENCOUNTERS, JOBS, buildEncounter } from "../src/data/battle";

const SEEDS = Number(process.argv[2] ?? 40);
const MAX_ROUNDS = 30;

const POLICIES: Record<string, PlannerOptions> = {
  "naive (ignores telegraphs)": { lookahead: false, allowMove: false },
  "dodge + damage only": { lookahead: true, allowMove: true, skillFilter: isDamageOnly },
  "full kit, no moving": { lookahead: true, allowMove: false },
  "full kit (planner)": FULL_PLANNER,
};

interface Result { won: boolean; rounds: number; hpLeft: number; skills: Record<string, number> }

function run(encounter: string, opts: PlannerOptions, seed: number): Result {
  const s = createBattle(buildEncounter(encounter), BATTLE_CONTENT, seed);
  const maxHp = s.units.filter((u) => u.side === "party").reduce((a, u) => a + u.maxHp, 0);
  const skills: Record<string, number> = {};
  while (s.phase === "player" && s.round <= MAX_ROUNDS) {
    for (const a of planTurn(s, opts)) {
      if (a.type === "skill") skills[a.skillId] = (skills[a.skillId] ?? 0) + 1;
      applyAction(s, a);
      if (s.phase !== "player") break;
    }
    if (s.phase === "player") endTurn(s);
  }
  const hp = s.units.filter((u) => u.side === "party").reduce((a, u) => a + u.hp, 0);
  return { won: s.phase === "won", rounds: s.round, hpLeft: hp / maxHp, skills };
}

const pct = (x: number) => `${Math.round(x * 100)}%`.padStart(5);
const totalSkills: Record<string, number> = {};
const t0 = Date.now();

for (const [id, enc] of Object.entries(ENCOUNTERS)) {
  console.log(`\n${enc.name}  (${SEEDS} seeds)`);
  console.log(`  ${"policy".padEnd(28)} ${"win".padStart(5)} ${"rounds".padStart(7)} ${"HP left".padStart(8)}`);
  for (const [name, opts] of Object.entries(POLICIES)) {
    const results = Array.from({ length: SEEDS }, (_, i) => run(id, opts, i + 1));
    const wins = results.filter((r) => r.won);
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    console.log(
      `  ${name.padEnd(28)} ${pct(wins.length / SEEDS)} ${avg(wins.map((r) => r.rounds)).toFixed(1).padStart(7)} ${pct(avg(wins.map((r) => r.hpLeft))).padStart(8)}`,
    );
    if (opts === FULL_PLANNER) {
      for (const r of results) for (const [k, v] of Object.entries(r.skills)) totalSkills[k] = (totalSkills[k] ?? 0) + v;
    }
  }
}

console.log("\nSkill usage by the full planner (all encounters):");
const all = Object.values(JOBS).flatMap((j) => j.skills);
const sum = Object.values(totalSkills).reduce((a, b) => a + b, 0);
for (const k of all.sort((a, b) => (totalSkills[b] ?? 0) - (totalSkills[a] ?? 0))) {
  const n = totalSkills[k] ?? 0;
  console.log(`  ${k.padEnd(14)} ${String(n).padStart(5)}  ${"#".repeat(Math.round((n / sum) * 120))}`);
}
console.log(`\n(${((Date.now() - t0) / 1000).toFixed(1)}s)`);
