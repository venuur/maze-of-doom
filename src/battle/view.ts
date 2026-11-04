/**
 * Battle view component. DOM presentation over the pure engine: every render
 * reads BattleState; every input calls an engine action. Mounted by the
 * sandbox page and by the overworld when an encounter starts.
 */
import "./battle.css";
import {
  applyAction,
  canUseSkill,
  cloneBattle,
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

const FOE_GLYPH: Record<string, string> = { blob: "●", square: "■", diamond: "◆", triangle: "▲" };

export type BattleExit = "won" | "lost" | "retreat";

export interface BattleViewOptions {
  /** Called when the player leaves the battle (Continue after it ends, or Retreat). */
  onExit?: (state: BattleState, how: BattleExit) => void;
  /** Allow retreating mid-battle. */
  canRetreat?: boolean;
  /** Text under the board's title. */
  subtitle?: string;
}

interface UiState {
  selected: string | null;
  skill: string | null;
  dir: LateralDir;
  hover: string | null;
  focusIntent: number | null;
}

const TEMPLATE = `
  <div class="status"><span data-r="round"></span><span class="hint">Red = telegraphed enemy attacks (numbers = resolve order). Tap a party member, step (blue), then pick a skill.</span></div>
  <p class="hint" data-r="subtitle"></p>
  <div data-r="banner"></div>
  <div class="bv-board" data-r="board"></div>
  <div class="cols">
    <section>
      <h2 data-r="title">Party</h2>
      <div data-r="panel"></div>
      <div class="row" style="margin-top: 10px">
        <button data-r="undo">Undo</button>
        <button data-r="auto" title="Let the planner AI finish this round's actions">Auto</button>
        <button data-r="retreat" title="Leave the fight. Damage carries over; the enemy stays.">Retreat</button>
        <button data-r="end" class="primary">End turn ▶</button>
      </div>
    </section>
    <section>
      <h2>Enemy intents</h2>
      <ol class="intents" data-r="intents"></ol>
      <h2 style="margin-top: 12px">Log</h2>
      <div class="log" data-r="log"></div>
    </section>
  </div>`;

export class BattleView {
  private history: BattleState[] = [];
  private ui: UiState = { selected: null, skill: null, dir: "down", hover: null, focusIntent: null };
  private flashTimer = 0;
  private readonly el: HTMLElement;

  constructor(host: HTMLElement, public state: BattleState, private readonly opts: BattleViewOptions = {}) {
    this.el = document.createElement("div");
    this.el.className = "bv";
    this.el.innerHTML = TEMPLATE;
    host.appendChild(this.el);
    this.r("subtitle").textContent = opts.subtitle ?? "";
    if (!opts.canRetreat) this.r("retreat").remove();
    this.bind();
    this.render();
  }

  destroy(): void {
    window.clearTimeout(this.flashTimer);
    this.el.remove();
  }

  private r<T extends HTMLElement = HTMLElement>(name: string): T {
    return this.el.querySelector(`[data-r="${name}"]`) as T;
  }

  // -------------------------------------------------------------------------

  private act(action: Action) {
    try {
      const before = cloneBattle(this.state);
      applyAction(this.state, action);
      if (action.type === "endTurn") this.history = [];
      else this.history.push(before);
    } catch (err) {
      this.flash((err as Error).message);
    }
    this.render();
  }

  private flash(msg: string) {
    this.r("title").textContent = msg;
    window.clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => this.render(), 1600);
  }

  private selectedUnit(): Unit | null {
    if (!this.ui.selected) return null;
    const u = getUnit(this.state, this.ui.selected);
    return u.hp > 0 ? u : null;
  }

  private selectedSkill(): SkillDef | null {
    return this.ui.skill ? this.state.skills[this.ui.skill]! : null;
  }

  // -------------------------------------------------------------------------
  // Rendering

  render(): void {
    const state = this.state;
    const ui = this.ui;
    const sel = this.selectedUnit();
    const skill = this.selectedSkill();

    const threats = new Map<string, number[]>();
    const paths = new Set<string>();
    const incoming = new Map<string, number>();
    state.intents.forEach((intent, i) => {
      const { hit, path } = intentTiles(state, intent);
      for (const t of hit) threats.set(tileKey(t), [...(threats.get(tileKey(t)) ?? []), i + 1]);
      for (const t of path) paths.add(tileKey(t));
      for (const p of intentPreview(state, intent)) incoming.set(p.unitId, (incoming.get(p.unitId) ?? 0) + p.amount);
    });

    const moves = sel ? legalMoves(state, sel).map(tileKey) : [];
    const anchors = sel && skill && isAimed(skill) ? legalAnchors(state, sel, skill).filter(Boolean).map((t) => tileKey(t!)) : [];
    let preview = new Set<string>();
    if (sel && skill) {
      const anchor = isAimed(skill) ? (ui.hover && anchors.includes(ui.hover) ? parseKey(ui.hover) : null) : null;
      if (!isAimed(skill) || anchor) preview = new Set(shapeTiles(state, sel, skill, anchor).hit.map(tileKey));
    }
    const fi = ui.focusIntent !== null ? state.intents[ui.focusIntent] : undefined;
    const focus = fi ? new Set(intentTiles(state, fi).hit.map(tileKey)) : new Set<string>();

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
          if (u) html += unitHtml(u, incoming.get(u.id), sel, skill);
          html += `</div>`;
        }
      }
      return html + `</div>`;
    };
    this.r("board").innerHTML = grid("party") + `<div class="divider"></div>` + grid("foe");
    this.r("round").innerHTML = `Round <b>${state.round}</b>`;

    const over = state.phase !== "player";
    const cont = this.opts.onExit ? ` <button class="primary" data-continue>Continue ▶</button>` : "";
    this.r("banner").innerHTML =
      state.phase === "won" ? `<div class="banner won">Victory in ${state.round} rounds.${cont}</div>`
      : state.phase === "lost" ? `<div class="banner lost">The party falls.${cont}</div>` : "";

    this.renderPanel(sel, skill);
    this.renderIntents();
    this.renderLog();

    this.r<HTMLButtonElement>("undo").disabled = over || this.history.length === 0;
    this.r<HTMLButtonElement>("auto").disabled = over;
    this.r<HTMLButtonElement>("end").disabled = over;
    const retreat = this.r<HTMLButtonElement>("retreat");
    if (retreat) retreat.disabled = over;
  }

  private renderPanel(sel: Unit | null, skill: SkillDef | null) {
    const state = this.state;
    const title = this.r("title");
    const panel = this.r("panel");
    if (state.phase !== "player") {
      title.textContent = "Battle over";
      panel.innerHTML = "";
      return;
    }
    if (!sel || sel.side !== "party") {
      title.textContent = "Party";
      panel.innerHTML = state.units
        .filter((u) => u.side === "party")
        .map((u) => `<div>${u.hp <= 0 ? "✕" : u.acted ? "✓" : "·"} ${u.name} ${u.hp}/${u.maxHp} <span class="hint">${u.hp <= 0 ? "down" : `${depthName(u.depth)}, lane ${u.lane + 1}`}</span></div>`)
        .join("") + `<p class="hint">★ = standing in preferred depth (+1 power).</p>`;
      if (sel) panel.innerHTML += foeInfo(state, sel);
      return;
    }
    title.textContent = `${sel.name} · ${sel.hp}/${sel.maxHp} HP · prefers ${sel.prefers.map(depthName).join("/")}`;
    let html = sel.passives?.length ? `<div class="hint" style="margin-bottom:4px">${sel.passives.join(" · ")}</div>` : "";
    html += `<div class="hint" style="margin-bottom:6px">${sel.acted ? "Done this round." : sel.moved ? "Moved. Choose a skill." : "Step to a blue tile (optional), then choose a skill."}</div><div class="skills">`;
    for (const id of sel.skills) {
      const s = state.skills[id]!;
      const usable = sel.acted ? { ok: false as const, reason: "done" } : canUseSkill(state, sel, id);
      const meta = [s.shape, s.power ? `${s.power}${s.element && s.element !== "physical" ? " " + s.element : ""}` : "", s.cooldown ? `cd ${s.cooldown}` : "", s.from ? `from ${s.from.map(depthName).join("/")}` : ""].filter(Boolean).join(" · ");
      html += `<button class="skill ${this.ui.skill === id ? "active" : ""}" data-skill="${id}" ${usable.ok ? "" : "disabled"}>
        <span>${s.name} <small>${meta}</small></span><small>${s.desc}${usable.ok ? "" : ` (${usable.reason})`}</small></button>`;
    }
    html += `</div>`;
    if (skill) {
      html += `<div class="row" style="margin-top:8px">`;
      if (skill.displace === "lateral") {
        html += `Direction: <button data-dir="up" ${this.ui.dir === "up" ? 'class="primary"' : ""}>▲ up</button><button data-dir="down" ${this.ui.dir === "down" ? 'class="primary"' : ""}>▼ down</button>`;
      }
      html += isAimed(skill) ? `<span class="hint">Tap a yellow tile.</span>` : `<button class="primary" data-confirm>Use ${skill.name}</button>`;
      html += `<button data-cancel>Cancel</button></div>`;
    } else if (!sel.acted) {
      html += `<div class="row" style="margin-top:8px"><button data-wait>Wait</button></div>`;
    }
    panel.innerHTML = html;
  }

  private renderIntents() {
    const state = this.state;
    const el = this.r("intents");
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

  private renderLog() {
    const el = this.r("log");
    const lines = this.state.log.slice(-60).map((e) => describe(this.state, e)).filter(Boolean) as string[];
    el.innerHTML = lines.map((l) => `<div class="${l.startsWith("—") ? "r" : ""}">${l}</div>`).join("");
    el.scrollTop = el.scrollHeight;
  }

  // -------------------------------------------------------------------------
  // Input

  private bind() {
    const ui = this.ui;
    this.r("board").addEventListener("click", (ev) => {
      const cell = (ev.target as HTMLElement).closest<HTMLElement>(".cell");
      if (!cell || this.state.phase !== "player") return;
      const k = cell.dataset.k!;
      const t = parseKey(k);
      const sel = this.selectedUnit();
      const skill = this.selectedSkill();

      if (sel && skill && isAimed(skill)) {
        const anchors = legalAnchors(this.state, sel, skill).map((a) => a && tileKey(a));
        if (anchors.includes(k)) {
          // Touch has no hover: first tap previews the area, second tap confirms.
          if (matchMedia("(pointer: coarse)").matches && ui.hover !== k) {
            ui.hover = k;
            return this.render();
          }
          ui.skill = null;
          ui.selected = null;
          this.act({ type: "skill", unitId: sel.id, skillId: skill.id, anchor: t, dir: skill.displace === "lateral" ? ui.dir : undefined });
          return;
        }
      }
      if (sel && !skill && legalMoves(this.state, sel).some((m) => sameTile(m, t))) {
        this.act({ type: "move", unitId: sel.id, to: t });
        return;
      }
      const u = unitAt(this.state, t);
      ui.skill = null;
      ui.selected = u ? u.id : null;
      ui.focusIntent = u && u.side === "foe" ? this.state.intents.findIndex((i) => i.actorId === u.id) : null;
      this.render();
    });

    this.r("board").addEventListener("mouseover", (ev) => {
      const k = (ev.target as HTMLElement).closest<HTMLElement>(".cell")?.dataset.k ?? null;
      if (k !== ui.hover) {
        ui.hover = k;
        if (ui.skill) this.render();
      }
    });

    this.r("panel").addEventListener("click", (ev) => {
      const b = (ev.target as HTMLElement).closest<HTMLButtonElement>("button");
      const sel = this.selectedUnit();
      if (!b || !sel) return;
      if (b.dataset.skill) ui.skill = ui.skill === b.dataset.skill ? null : b.dataset.skill;
      else if (b.dataset.dir) ui.dir = b.dataset.dir as LateralDir;
      else if (b.dataset.cancel !== undefined) ui.skill = null;
      else if (b.dataset.wait !== undefined) {
        ui.selected = null;
        return this.act({ type: "wait", unitId: sel.id });
      } else if (b.dataset.confirm !== undefined && ui.skill) {
        const s = this.selectedSkill()!;
        const skillId = ui.skill;
        ui.skill = null;
        ui.selected = null;
        return this.act({ type: "skill", unitId: sel.id, skillId, anchor: null, dir: s.displace === "lateral" ? ui.dir : undefined });
      }
      this.render();
    });

    this.r("intents").addEventListener("mouseover", (ev) => {
      const li = (ev.target as HTMLElement).closest<HTMLElement>("li[data-intent]");
      const i = li ? Number(li.dataset.intent) : null;
      if (i !== ui.focusIntent) {
        ui.focusIntent = i;
        this.render();
      }
    });

    this.r("banner").addEventListener("click", (ev) => {
      if ((ev.target as HTMLElement).closest("[data-continue]")) {
        this.opts.onExit?.(this.state, this.state.phase === "won" ? "won" : "lost");
      }
    });

    this.r("undo").addEventListener("click", () => {
      const prev = this.history.pop();
      if (prev) this.state = prev;
      ui.selected = null;
      ui.skill = null;
      this.render();
    });
    this.r("auto").addEventListener("click", () => {
      const before = cloneBattle(this.state);
      for (const a of planTurn(this.state)) applyAction(this.state, a);
      this.history.push(before);
      ui.selected = null;
      ui.skill = null;
      this.render();
    });
    this.r("end").addEventListener("click", () => {
      ui.selected = null;
      ui.skill = null;
      ui.focusIntent = null;
      this.act({ type: "endTurn" });
    });
    this.r("retreat")?.addEventListener("click", () => this.opts.onExit?.(this.state, "retreat"));
  }
}

function unitHtml(u: Unit, incomingDmg: number | undefined, sel: Unit | null, skill: SkillDef | null): string {
  const glyph = u.side === "party" ? u.glyph ?? u.name[0] : FOE_GLYPH[u.glyph ?? ""] ?? "?";
  const pct = Math.round((u.hp / u.maxHp) * 100);
  const badges = [u.guard ? "🛡" : "", u.taunt ? "⚑" : "", u.stun ? "✶stun" : "", u.prefers.includes(u.depth) ? "★" : ""].join("");
  let aimDmg = "";
  if (sel && skill && skill.power && u.side !== sel.side) {
    aimDmg = `<span class="dmg" style="color:var(--aim);bottom:auto;top:2px;left:3px;right:auto">${skillPower(sel, skill, u)}</span>`;
  }
  return `<div class="unit ${u.side} ${u.side === "party" && u.acted ? "done" : ""}">
    <div class="token" style="background:${u.color ?? "#888"}">${glyph}</div>
    <div class="nm">${u.name}</div>
    <div class="hp ${pct <= 35 ? "low" : ""}"><i style="width:${pct}%"></i></div>
    <div class="badges">${u.hp}/${u.maxHp} ${badges}</div>
  </div>${incomingDmg ? `<span class="dmg">-${incomingDmg}</span>` : ""}${aimDmg}`;
}

function foeInfo(state: BattleState, u: Unit): string {
  const resist = Object.entries(u.resist).map(([k, v]) => `${k} ×${v}`).join(", ") || "none";
  const skills = u.skills.map((id) => state.skills[id]!).map((s) => `${s.name} (${s.shape}, ${s.power ?? 0}${s.cooldown ? `, cd ${s.cooldown}` : ""})`).join("; ");
  return `<hr style="border-color:var(--line)"><div><b>${u.name}</b> ${u.hp}/${u.maxHp}${u.mobile ? " · mobile" : ""}</div><div class="hint">Resist: ${resist}</div><div class="hint">Skills: ${skills}</div>`;
}

function describe(state: BattleState, e: BattleEvent): string | null {
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
    case "reaction":
      return e.trait === "counter" ? `${n(e.unitId)} counters ${n(e.targetId!)}!`
        : e.trait === "repel" ? `${n(e.unitId)} repels ${n(e.targetId!)}!`
        : `${n(e.unitId)} gets a second wind!`;
    case "steadfast": return `${n(e.unitId)} holds firm.`;
  }
}

function parseKey(k: string): Tile {
  const [side, depth, lane] = k.split(":");
  return { side: side as Side, depth: Number(depth), lane: Number(lane) };
}
