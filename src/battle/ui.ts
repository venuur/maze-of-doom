/**
 * Battle sandbox UI. DOM-based presentation over the pure engine: every
 * render reads BattleState; every input calls an engine action.
 */
import {
  applyAction,
  canUseSkill,
  cloneBattle,
  createBattle,
  depthName,
  getUnit,
  intentPreview,
  intentTiles,
  legalMoves,
  skillPower,
} from "../core/battle/engine";
import { isAimed, legalAnchors, sameTile, shapeTiles, tileKey, unitAt } from "../core/battle/grid";
import { planTurn } from "../core/battle/planner";
import type { Action, BattleEvent, BattleState, LateralDir, Side, SkillDef, Tile, Unit } from "../core/battle/types";
import { BATTLE_CONTENT, ENCOUNTERS, buildEncounter } from "../data/battle";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const encSel = $<HTMLSelectElement>("encounter");
const seedInput = $<HTMLInputElement>("seed");

const FOE_GLYPH: Record<string, string> = { blob: "●", square: "■", diamond: "◆", triangle: "▲" };

let state: BattleState;
let history: BattleState[] = [];
let ui: { selected: string | null; skill: string | null; dir: LateralDir; hover: string | null; focusIntent: number | null } = {
  selected: null, skill: null, dir: "down", hover: null, focusIntent: null,
};

for (const [id, e] of Object.entries(ENCOUNTERS)) encSel.add(new Option(e.name, id));
const params = new URLSearchParams(location.search);
if (params.get("e") && ENCOUNTERS[params.get("e")!]) encSel.value = params.get("e")!;
if (params.get("seed")) seedInput.value = params.get("seed")!;

function reset() {
  state = createBattle(buildEncounter(encSel.value), BATTLE_CONTENT, Number(seedInput.value) || 1);
  history = [];
  ui = { selected: null, skill: null, dir: "down", hover: null, focusIntent: null };
  $("desc").textContent = ENCOUNTERS[encSel.value]!.desc;
  render();
}

function act(action: Action) {
  try {
    const before = cloneBattle(state);
    applyAction(state, action);
    if (action.type === "endTurn") history = [];
    else history.push(before);
  } catch (err) {
    flash((err as Error).message);
  }
  render();
}

function flash(msg: string) {
  $("panel-title").textContent = msg;
  setTimeout(() => render(), 1600);
}

// ---------------------------------------------------------------------------

const selectedUnit = (): Unit | null => {
  if (!ui.selected) return null;
  const u = getUnit(state, ui.selected);
  return u.hp > 0 ? u : null;
};
const selectedSkill = (): SkillDef | null => (ui.skill ? state.skills[ui.skill]! : null);

function threatMap() {
  const threats = new Map<string, number[]>();
  const paths = new Set<string>();
  state.intents.forEach((intent, i) => {
    const { hit, path } = intentTiles(state, intent);
    for (const t of hit) threats.set(tileKey(t), [...(threats.get(tileKey(t)) ?? []), i + 1]);
    for (const t of path) paths.add(tileKey(t));
  });
  return { threats, paths };
}

/** Damage each unit is predicted to take from all intents. */
function incoming(): Map<string, number> {
  const m = new Map<string, number>();
  for (const intent of state.intents) {
    for (const p of intentPreview(state, intent)) m.set(p.unitId, (m.get(p.unitId) ?? 0) + p.amount);
  }
  return m;
}

function render() {
  const sel = selectedUnit();
  const skill = selectedSkill();
  const { threats, paths } = threatMap();
  const dmg = incoming();
  const moves = sel ? legalMoves(state, sel).map(tileKey) : [];
  const anchors = sel && skill && isAimed(skill) ? legalAnchors(state, sel, skill).filter(Boolean).map((t) => tileKey(t!)) : [];

  // Preview area for the skill being aimed.
  let preview = new Set<string>();
  if (sel && skill) {
    const anchor = isAimed(skill) ? (ui.hover && anchors.includes(ui.hover) ? parseKey(ui.hover) : null) : null;
    if (!isAimed(skill) || anchor) preview = new Set(shapeTiles(state, sel, skill, anchor).hit.map(tileKey));
  }
  const focus = ui.focusIntent !== null && state.intents[ui.focusIntent] ? new Set(intentTiles(state, state.intents[ui.focusIntent]!).hit.map(tileKey)) : new Set<string>();

  const grid = (side: Side) => {
    const depthsLeftToRight = side === "party" ? [2, 1, 0] : [0, 1, 2];
    let html = `<div class="grid ${side}"><div class="side-label">${side === "party" ? "PARTY  ·  back → front" : "front → back  ·  FOES"}</div>`;
    for (let lane = 0; lane < 3; lane++) {
      for (const depth of depthsLeftToRight) {
        const t: Tile = { side, depth, lane };
        const k = tileKey(t);
        const hz = state.hazards.find((h) => sameTile(h.tile, t));
        const cls = ["cell"];
        if (hz) cls.push(hz.kind);
        if (paths.has(k)) cls.push("path");
        if (threats.has(k)) cls.push("threat");
        if (focus.has(k)) cls.push("focus");
        if (moves.includes(k) && !skill) cls.push("move");
        if (anchors.includes(k)) cls.push("anchor");
        if (preview.has(k)) cls.push("preview");
        const u = unitAt(state, t);
        if (u && u.id === ui.selected) cls.push("selected");
        const th = threats.get(k);
        html += `<div class="${cls.join(" ")}" data-k="${k}">`;
        if (th) html += `<div class="threats">${th.map((n) => `<span>${n}</span>`).join("")}</div>`;
        if (hz) html += `<span class="hz">${hz.kind}${hz.turns !== null ? ` ${hz.turns}` : ""}</span>`;
        if (u) html += unitHtml(u, dmg.get(u.id), sel, skill);
        html += `</div>`;
      }
    }
    return html + `</div>`;
  };
  $("board").innerHTML = grid("party") + `<div class="divider"></div>` + grid("foe");

  $("round").innerHTML = `Round <b>${state.round}</b>`;
  $("banner").innerHTML =
    state.phase === "won" ? `<div class="banner won">Victory in ${state.round} rounds.</div>`
    : state.phase === "lost" ? `<div class="banner lost">The party falls. (The Maze will relocate you, in Milestone 3.)</div>` : "";

  renderPanel(sel, skill);
  renderIntents();
  renderLog();

  ($("undo") as HTMLButtonElement).disabled = history.length === 0;
  ($("auto") as HTMLButtonElement).disabled = state.phase !== "player";
  ($("end") as HTMLButtonElement).disabled = state.phase !== "player";
}

function unitHtml(u: Unit, incomingDmg: number | undefined, sel: Unit | null, skill: SkillDef | null): string {
  const glyph = u.side === "party" ? u.glyph ?? u.name[0] : FOE_GLYPH[u.glyph ?? ""] ?? "?";
  const pct = Math.round((u.hp / u.maxHp) * 100);
  const badges = [
    u.guard ? "🛡" : "", u.taunt ? "⚑" : "", u.stun ? "✶stun" : "",
    u.prefers.includes(u.depth) ? "★" : "",
  ].join("");
  // When aiming, show what the selected skill would deal to this unit.
  let aimDmg = "";
  if (sel && skill && skill.power && u.side !== sel.side) aimDmg = `<span class="dmg" style="color:var(--aim);bottom:auto;top:2px;left:3px;right:auto">${skillPower(sel, skill, u)}</span>`;
  return `<div class="unit ${u.side} ${u.side === "party" && u.acted ? "done" : ""}">
    <div class="token" style="background:${u.color ?? "#888"}">${glyph}</div>
    <div class="nm">${u.name}</div>
    <div class="hp ${pct <= 35 ? "low" : ""}"><i style="width:${pct}%"></i></div>
    <div class="badges">${u.hp}/${u.maxHp} ${badges}</div>
  </div>${incomingDmg ? `<span class="dmg">-${incomingDmg}</span>` : ""}${aimDmg}`;
}

function renderPanel(sel: Unit | null, skill: SkillDef | null) {
  const title = $("panel-title");
  const panel = $("panel");
  if (state.phase !== "player") {
    title.textContent = "Battle over";
    panel.innerHTML = `<p class="hint">Pick another encounter or Reset.</p>`;
    return;
  }
  if (!sel || sel.side !== "party") {
    title.textContent = "Party";
    panel.innerHTML = state.units
      .filter((u) => u.side === "party")
      .map((u) => `<div>${u.acted ? "✓" : "·"} ${u.name.padEnd(11)} ${u.hp}/${u.maxHp} <span class="hint">${depthName(u.depth)}, lane ${u.lane + 1}</span></div>`)
      .join("") + `<p class="hint">★ = standing in preferred depth (+1 power).</p>`;
    if (sel) panel.innerHTML += foeInfo(sel);
    return;
  }
  title.textContent = `${sel.name} · ${sel.hp}/${sel.maxHp} HP · prefers ${sel.prefers.map(depthName).join("/")}`;
  let html = `<div class="hint" style="margin-bottom:6px">${sel.acted ? "Done this round." : sel.moved ? "Moved. Choose a skill." : "Step to a blue tile (optional), then choose a skill."}</div><div class="skills">`;
  for (const id of sel.skills) {
    const s = state.skills[id]!;
    const usable = sel.acted ? { ok: false as const, reason: "done" } : canUseSkill(state, sel, id);
    const meta = [s.shape, s.power ? `${s.power}${s.element && s.element !== "physical" ? " " + s.element : ""}` : "", s.cooldown ? `cd ${s.cooldown}` : "", s.from ? `from ${s.from.map(depthName).join("/")}` : ""].filter(Boolean).join(" · ");
    html += `<button class="skill ${ui.skill === id ? "active" : ""}" data-skill="${id}" ${usable.ok ? "" : "disabled"}>
      <span>${s.name} <small>${meta}</small></span><small>${s.desc}${usable.ok ? "" : ` (${usable.reason})`}</small></button>`;
  }
  html += `</div>`;
  if (skill) {
    html += `<div class="row" style="margin-top:8px">`;
    if (skill.displace === "lateral") {
      html += `Direction: <button data-dir="up" ${ui.dir === "up" ? 'class="primary"' : ""}>▲ up</button><button data-dir="down" ${ui.dir === "down" ? 'class="primary"' : ""}>▼ down</button>`;
    }
    html += isAimed(skill) ? `<span class="hint">Tap a yellow tile.</span>` : `<button class="primary" data-confirm>Use ${skill.name}</button>`;
    html += `<button data-cancel>Cancel</button></div>`;
  } else if (!sel.acted) {
    html += `<div class="row" style="margin-top:8px"><button data-wait>Wait</button></div>`;
  }
  panel.innerHTML = html;
}

function foeInfo(u: Unit): string {
  const resist = Object.entries(u.resist).map(([k, v]) => `${k} ×${v}`).join(", ") || "none";
  const skills = u.skills.map((id) => state.skills[id]!).map((s) => `${s.name} (${s.shape}, ${s.power ?? 0}${s.cooldown ? `, cd ${s.cooldown}` : ""})`).join("; ");
  return `<hr style="border-color:var(--line)"><div><b>${u.name}</b> ${u.hp}/${u.maxHp}${u.mobile ? " · mobile" : ""}</div><div class="hint">Resist: ${resist}</div><div class="hint">Skills: ${skills}</div>`;
}

function renderIntents() {
  const el = $("intents");
  if (state.intents.length === 0) {
    el.innerHTML = `<li class="hint">No declared attacks.</li>`;
    return;
  }
  el.innerHTML = state.intents
    .map((intent, i) => {
      const actor = getUnit(state, intent.actorId);
      const s = state.skills[intent.skillId]!;
      const hits = intentPreview(state, intent).map((p) => `${getUnit(state, p.unitId).name} -${p.amount}`).join(", ") || "nothing";
      const tag = intent.trackUnitId ? " ⚑redirected" : s.shape === "line" || s.shape === "lane" ? " (follows its lane)" : "";
      return `<li data-intent="${i}">${actor.name}: <b>${s.name}</b>${tag} → ${hits}</li>`;
    })
    .join("");
}

function describe(e: BattleEvent): string | null {
  const n = (id: string) => getUnit(state, id).name;
  switch (e.type) {
    case "round": return `— Round ${e.round} —`;
    case "skill": return `${n(e.unitId)} uses ${state.skills[e.skillId]!.name}.`;
    case "intent": return null;
    case "stunned": return `${n(e.unitId)} is stunned and does nothing.`;
    case "move": return e.swappedWith ? `${n(e.unitId)} swaps with ${n(e.swappedWith)}.` : null;
    case "damage": return `${n(e.unitId)} takes ${e.amount}${e.element === "impact" ? " (collision)" : e.sourceId ? "" : ` ${e.element} (hazard)`}.`;
    case "heal": return `${n(e.unitId)} heals ${e.amount}.`;
    case "displace": return `${n(e.unitId)} is moved to ${depthName(e.to.depth)}, lane ${e.to.lane + 1}.`;
    case "bump": return e.intoId ? `${n(e.unitId)} slams into ${n(e.intoId)}!` : `${n(e.unitId)} hits the edge!`;
    case "status": return `${n(e.unitId)}: ${e.status}.`;
    case "cancel": return `${n(e.actorId)}'s attack is cancelled.`;
    case "redirect": return `${n(e.actorId)} turns toward ${n(e.toId)}.`;
    case "hazard": return null;
    case "miss": return `${n(e.actorId)}'s ${state.skills[e.skillId]!.name} hits nothing.`;
    case "death": return `${n(e.unitId)} falls.`;
    case "end": return e.result === "won" ? "Victory!" : "Defeat.";
  }
}

function renderLog() {
  const el = $("log");
  const lines = state.log.slice(-60).map(describe).filter(Boolean) as string[];
  el.innerHTML = lines.map((l) => `<div class="${l.startsWith("—") ? "r" : ""}">${l}</div>`).join("");
  el.scrollTop = el.scrollHeight;
}

function parseKey(k: string): Tile {
  const [side, depth, lane] = k.split(":");
  return { side: side as Side, depth: Number(depth), lane: Number(lane) };
}

// ---------------------------------------------------------------------------
// Input

$("board").addEventListener("click", (ev) => {
  const cell = (ev.target as HTMLElement).closest<HTMLElement>(".cell");
  if (!cell || state.phase !== "player") return;
  const k = cell.dataset.k!;
  const t = parseKey(k);
  const sel = selectedUnit();
  const skill = selectedSkill();

  if (sel && skill) {
    const anchors = isAimed(skill) ? legalAnchors(state, sel, skill).map((a) => a && tileKey(a)) : [];
    if (isAimed(skill) && anchors.includes(k)) {
      // Touch has no hover: first tap previews the area, second tap confirms.
      if (matchMedia("(pointer: coarse)").matches && ui.hover !== k) {
        ui.hover = k;
        return render();
      }
      ui.skill = null;
      act({ type: "skill", unitId: sel.id, skillId: skill.id, anchor: t, dir: skill.displace === "lateral" ? ui.dir : undefined });
      ui.selected = null;
      return render();
    }
  }
  if (sel && !skill && legalMoves(state, sel).some((m) => sameTile(m, t))) {
    act({ type: "move", unitId: sel.id, to: t });
    return;
  }
  const u = unitAt(state, t);
  ui.skill = null;
  ui.selected = u ? u.id : null;
  ui.focusIntent = u && u.side === "foe" ? state.intents.findIndex((i) => i.actorId === u.id) : null;
  render();
});

$("board").addEventListener("mouseover", (ev) => {
  const cell = (ev.target as HTMLElement).closest<HTMLElement>(".cell");
  const k = cell?.dataset.k ?? null;
  if (k !== ui.hover) {
    ui.hover = k;
    if (ui.skill) render();
  }
});

$("panel").addEventListener("click", (ev) => {
  const b = (ev.target as HTMLElement).closest<HTMLButtonElement>("button");
  const sel = selectedUnit();
  if (!b || !sel) return;
  if (b.dataset.skill) ui.skill = ui.skill === b.dataset.skill ? null : b.dataset.skill;
  else if (b.dataset.dir) ui.dir = b.dataset.dir as LateralDir;
  else if (b.dataset.cancel !== undefined) ui.skill = null;
  else if (b.dataset.wait !== undefined) { act({ type: "wait", unitId: sel.id }); ui.selected = null; }
  else if (b.dataset.confirm !== undefined && ui.skill) {
    const s = selectedSkill()!;
    const skillId = ui.skill;
    ui.skill = null;
    ui.selected = null;
    act({ type: "skill", unitId: sel.id, skillId, anchor: null, dir: s.displace === "lateral" ? ui.dir : undefined });
    return;
  }
  render();
});

$("intents").addEventListener("mouseover", (ev) => {
  const li = (ev.target as HTMLElement).closest<HTMLElement>("li[data-intent]");
  const i = li ? Number(li.dataset.intent) : null;
  if (i !== ui.focusIntent) { ui.focusIntent = i; render(); }
});

$("undo").addEventListener("click", () => {
  const prev = history.pop();
  if (prev) state = prev;
  ui.selected = null; ui.skill = null;
  render();
});
$("auto").addEventListener("click", () => {
  const before = cloneBattle(state);
  for (const a of planTurn(state)) applyAction(state, a);
  history.push(before);
  ui.selected = null; ui.skill = null;
  render();
});
$("end").addEventListener("click", () => {
  ui.selected = null; ui.skill = null; ui.focusIntent = null;
  act({ type: "endTurn" });
});
$("reset").addEventListener("click", reset);
encSel.addEventListener("change", reset);

reset();
(window as unknown as { battle: () => BattleState }).battle = () => state;
