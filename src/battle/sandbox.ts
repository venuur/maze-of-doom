/** Battle sandbox page: pick any encounter and seed, play it with the default party. */
import { createBattle } from "../core/battle/engine";
import type { BattleState } from "../core/battle/types";
import { BATTLE_CONTENT, ENCOUNTERS, PARTY_PRESETS, buildEncounter, partySpecsOf } from "../data/battle";
import { BattleView } from "./view";

const encSel = document.getElementById("encounter") as HTMLSelectElement;
const partySel = document.getElementById("party") as HTMLSelectElement;
const seedInput = document.getElementById("seed") as HTMLInputElement;
const host = document.getElementById("battle")!;

for (const [id, e] of Object.entries(ENCOUNTERS)) encSel.add(new Option(e.name, id));
const params = new URLSearchParams(location.search);
if (params.get("e") && ENCOUNTERS[params.get("e")!]) encSel.value = params.get("e")!;
if (params.get("party") && PARTY_PRESETS[params.get("party")!]) partySel.value = params.get("party")!;
if (params.get("seed")) seedInput.value = params.get("seed")!;

let view: BattleView | null = null;
function reset() {
  view?.destroy();
  const state = createBattle(buildEncounter(encSel.value, partySpecsOf(PARTY_PRESETS[partySel.value]!())), BATTLE_CONTENT, Number(seedInput.value) || 1);
  view = new BattleView(host, state, { subtitle: ENCOUNTERS[encSel.value]!.desc });
}

document.getElementById("reset")!.addEventListener("click", reset);
encSel.addEventListener("change", reset);
partySel.addEventListener("change", reset);
reset();

(window as unknown as { battle: () => BattleState | undefined }).battle = () => view?.state;
