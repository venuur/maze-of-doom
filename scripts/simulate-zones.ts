/**
 * Balance check for generated encounters: planner win rate by zone depth
 * and party preset.   npm run sim:zones   (optional: seeds per cell)
 */
import { applyAction, createBattle, endTurn } from "../src/core/battle/engine";
import { planTurn } from "../src/core/battle/planner";
import { generateZone } from "../src/core/gen/zonegen";
import { GEN_CONTENT, THEMES } from "../src/data";
import { BATTLE_CONTENT, PARTY_PRESETS, buildEncounter, partySpecsOf } from "../src/data/battle";

const N = Number(process.argv[2] ?? 6);
console.log(`Generated encounters, full planner. ${N} zones per theme per depth; every encounter in each.\n`);
console.log(`depth  ${["start", "lv2", "lv3", "veteran"].map((p) => p.padStart(9)).join("")}`);
for (const depth of [1, 2, 3, 4]) {
  const row: string[] = [];
  for (const preset of ["start", "lv2", "lv3", "veteran"]) {
    let won = 0, total = 0;
    for (const theme of Object.keys(THEMES)) {
      for (let seed = 1; seed <= N; seed++) {
        const z = generateZone({ id: "s", seed: seed * 101 + depth, theme, depth, forwardExits: 1 }, GEN_CONTENT);
        for (const enc of Object.values(z.encounters!)) {
          const s = createBattle(buildEncounter(enc, partySpecsOf(PARTY_PRESETS[preset]!())), BATTLE_CONTENT, seed);
          while (s.phase === "player" && s.round <= 25) {
            for (const a of planTurn(s)) { applyAction(s, a); if (s.phase !== "player") break; }
            if (s.phase === "player") endTurn(s);
          }
          total++;
          if (s.phase === "won") won++;
        }
      }
    }
    row.push(`${Math.round((won / total) * 100)}%`.padStart(9));
  }
  console.log(`${String(depth).padStart(5)}  ${row.join("")}`);
}
