/**
 * Browser entry: the save-slot title screen, then the overworld loop. Wires
 * input and timing to the pure world/session logic, renders the current
 * zone, hands off to the battle view on encounters, and autosaves.
 */
import { movePlayer, stepEnemies, type Dir, type WorldEvent } from "./core/world";
import { ENEMY_KINDS } from "./data";
import { JOBS, JOB_CONTENT } from "./data/battle";
import { BattleView, type BattleExit } from "./battle/view";
import { levelIn } from "./core/jobs";
import { createSession, exitAt, finishBattle, interact, restoreParty, startEncounter, travel, type Session } from "./game/session";
import { saveToSlot } from "./game/save";
import { TitleScreen } from "./ui/title";
import { PartyMenu } from "./ui/party-menu";
import { drawFrame, TILE, type Effect, type Pos } from "./render/renderer";
import { Tween } from "./render/tween";

const VIEW_TILES_W = 15;
const VIEW_TILES_H = 11;
const PLAYER_STEP_MS = 140;
const ENEMY_STEP_MS = 280;
const ENEMY_TICK_MS = 700;
const TRANSITION_MS = 450;
/** After a battle, ignore touches for a moment so you aren't re-engaged instantly. */
const GRACE_MS = 2500;
/** Autosave at most this often while walking around (events save immediately). */
const AUTOSAVE_MS = 10000;

const canvas = document.getElementById("game") as HTMLCanvasElement;
canvas.width = VIEW_TILES_W * TILE;
canvas.height = VIEW_TILES_H * TILE;
const ctx = canvas.getContext("2d")!;
const frameEl = document.getElementById("frame")!;
const zoneLabel = document.getElementById("zone-name")!;
const messageEl = document.getElementById("message")!;
const partyEl = document.getElementById("party")!;
const battleLayer = document.getElementById("battle-layer")!;
const menuLayer = document.getElementById("menu-layer")!;
const titleLayer = document.getElementById("title-layer")!;

// --- Messages ---
let messageTimer = 0;
function say(text: string, ms = 4000) {
  messageEl.textContent = text;
  messageEl.classList.add("show");
  window.clearTimeout(messageTimer);
  messageTimer = window.setTimeout(() => messageEl.classList.remove("show"), ms);
}

// --- Game state (set when a slot is chosen) ---
let session: Session = createSession("antechamber", 1); // placeholder until a slot is picked
let slot = 1;
let playerTween = new Tween(0, 0, PLAYER_STEP_MS);
let enemyTweens = new Map<string, Tween>();
const effects: Effect[] = [];
let dirty = false;
let lastSave = 0;

/** Rebuild per-zone presentation state after entering a zone (travel, load, relocation). */
function resetZoneView() {
  const w = session.world;
  zoneLabel.textContent = `${w.zone.name}${w.zone.depth ? ` · depth ${w.zone.depth}` : ""}`;
  playerTween = new Tween(w.player.x, w.player.y, PLAYER_STEP_MS);
  enemyTweens = new Map(w.enemies.map((e) => [e.id, new Tween(e.x, e.y, ENEMY_STEP_MS)]));
  effects.length = 0;
  lastTouched = null;
  lastGateHint = null;
}

function autosave() {
  try {
    saveToSlot(localStorage, slot, session);
    dirty = false;
    lastSave = performance.now();
  } catch (err) {
    console.error("Autosave failed", err);
    say("Couldn't save (browser storage unavailable). Progress in this tab is kept until you close it.", 6000);
  }
}

function renderParty() {
  partyEl.innerHTML = session.party
    .map((m) => {
      const j = JOBS[m.primary]!;
      const pct = Math.round((m.hp / m.maxHp) * 100);
      return `<span class="m ${m.hp <= 0 ? "down" : ""}"><b style="color:${j.color}">${j.glyph}</b>${m.name} <span class="hint">${j.name} ${levelIn(JOB_CONTENT, m, m.primary)}</span> ${m.hp}/${m.maxHp}<span class="bar"><i style="width:${pct}%;${pct <= 35 ? "background:#e84a5f" : ""}"></i></span></span>`;
    })
    .join("") + `<button id="party-btn" title="Jobs and ability slots">Party (P)</button>`;
}
renderParty();

// --- Input: most recently pressed direction wins while held. ---
const KEYS: Record<string, Dir> = {
  ArrowUp: "up", KeyW: "up",
  ArrowDown: "down", KeyS: "down",
  ArrowLeft: "left", KeyA: "left",
  ArrowRight: "right", KeyD: "right",
};
const held: Dir[] = [];
const press = (d: Dir) => { if (!held.includes(d)) held.push(d); };
const release = (d: Dir) => { const i = held.indexOf(d); if (i >= 0) held.splice(i, 1); };

window.addEventListener("keydown", (e) => {
  if (e.code === "KeyP" || (e.code === "Escape" && mode === "menu")) {
    if (mode === "explore") openMenu();
    else if (mode === "menu") closeMenu();
    return;
  }
  if (mode !== "explore") return;
  const d = KEYS[e.code];
  if (d) { press(d); e.preventDefault(); }
});
window.addEventListener("keyup", (e) => {
  const d = KEYS[e.code];
  if (d) release(d);
});
window.addEventListener("blur", () => { held.length = 0; });

document.querySelectorAll<HTMLButtonElement>("[data-dir]").forEach((btn) => {
  const d = btn.dataset.dir as Dir;
  btn.addEventListener("pointerdown", (e) => { press(d); btn.setPointerCapture(e.pointerId); e.preventDefault(); });
  const up = () => release(d);
  btn.addEventListener("pointerup", up);
  btn.addEventListener("pointercancel", up);
});

// --- Encounters ---
type Mode = "title" | "explore" | "transition" | "battle" | "menu";
let mode: Mode = "title";
let graceUntil = 0;
let battleView: BattleView | null = null;
let menu: PartyMenu | null = null;

function openMenu() {
  if (mode !== "explore") return;
  mode = "menu";
  held.length = 0;
  menuLayer.hidden = false;
  menu = new PartyMenu(menuLayer, session, renderParty, closeMenu);
}

function closeMenu() {
  menu?.destroy();
  menu = null;
  menuLayer.hidden = true;
  mode = "explore";
  lastEnemyTick = performance.now();
  autosave();
}

partyEl.addEventListener("click", (e) => {
  if ((e.target as HTMLElement).closest("#party-btn")) openMenu();
});

/** Features whose job hasn't been discovered yet. */
function freshFeatures(): Set<string> {
  return new Set(session.world.zone.features.filter((f) => f.kind === "job" && f.job && !session.discovered.has(f.job)).map((f) => f.id));
}

function beginEncounter(enemyId: string, initiator: "player" | "enemy", now: number) {
  if (now < graceUntil || mode !== "explore") return;
  const enemy = session.world.enemies.find((e) => e.id === enemyId);
  if (!enemy) return;
  const result = startEncounter(session, enemyId);

  if (result.kind === "instant") {
    const t = enemyTweens.get(enemyId)?.pos(now);
    if (t) effects.push({ kind: "poof", px: t.px, py: t.py, start: now, color: ENEMY_KINDS[enemy.kind]!.color });
    enemyTweens.delete(enemyId);
    say(`(Instant win) ${result.message}`, result.notes.length ? 7000 : 4000);
    renderParty();
    autosave();
    return;
  }

  // Battle: flash the map, then open the battle view.
  mode = "transition";
  held.length = 0;
  frameEl.classList.add("flash");
  window.setTimeout(() => {
    frameEl.classList.remove("flash");
    mode = "battle";
    battleLayer.hidden = false;
    battleLayer.scrollTop = 0;
    const enc = result.encounter;
    battleView = new BattleView(battleLayer, result.battle, {
      canRetreat: true,
      subtitle: `${enc.name}: ${enc.desc}`,
      onExit: (state, how) => endEncounter(enemyId, state, how),
    });
    const title = document.createElement("h1");
    const name = ENEMY_KINDS[enemy.kind]!.name;
    title.textContent = initiator === "enemy" ? `The ${name} attacks!` : `You engage the ${name}.`;
    battleLayer.querySelector(".bv")?.prepend(title);
  }, TRANSITION_MS);
}

function endEncounter(enemyId: string, state: Parameters<typeof finishBattle>[2], how: BattleExit) {
  const zoneBefore = session.world.zone.id;
  const msg = finishBattle(session, enemyId, state, how);
  battleView?.destroy();
  battleView = null;
  battleLayer.hidden = true;
  mode = "explore";
  const now = performance.now();
  graceUntil = now + GRACE_MS;
  lastEnemyTick = now;
  if (how === "won") enemyTweens.delete(enemyId);
  // Defeat relocates the party, possibly to another zone.
  if (session.world.zone.id !== zoneBefore) resetZoneView();
  else playerTween.moveTo(session.world.player.x, session.world.player.y, session.world.player.x, session.world.player.y, now - PLAYER_STEP_MS);
  renderParty();
  say(msg, msg.length > 60 ? 8000 : 5000);
  autosave();
}

let lastTouched: string | null = null;
/** Only hint about a gate once until you move again. */
let lastGateHint: string | null = null;
const GATE_HINTS: Record<string, string> = {
  float: "The lava is too hot to cross on foot. Someone who could Float over it might. (A Mystic learns Float at Lv3; equip it in the Movement slot.)",
  swim: "Deep water. You'd need to swim. (A future ability.)",
  cut: "Thick, living vines. You'd need a way to cut through. (A future ability.)",
};

function handle(events: WorldEvent[], now: number) {
  for (const ev of events) {
    switch (ev.type) {
      case "moved":
        if (ev.who === "player") {
          playerTween.moveTo(session.world.player.x, session.world.player.y, ev.fromX, ev.fromY, now);
          lastTouched = null;
          lastGateHint = null;
          dirty = true;
        }
        else {
          const e = session.world.enemies.find((en) => en.id === ev.who);
          if (e) enemyTweens.get(e.id)?.moveTo(e.x, e.y, ev.fromX, ev.fromY, now);
        }
        break;
      case "encounter":
        beginEncounter(ev.enemyId, ev.initiator, now);
        break;
      case "interact": {
        // Holding a direction keeps bumping; only react to the first touch.
        if (ev.featureId === lastTouched) break;
        lastTouched = ev.featureId;
        const r = interact(session, ev.featureId);
        if (r.message) say(r.message, r.discovered || r.collected ? 10000 : 6000);
        if (r.collected) {
          const f = session.world.zone.features.find((x) => x.id === r.collected)!;
          effects.push({ kind: "poof", px: f.x * TILE, py: f.y * TILE, start: now, color: "#f2d64b" });
          renderParty();
        }
        if (r.collected || r.discovered) autosave();
        break;
      }
      case "blocked": {
        if (!ev.gate || ev.gate === lastGateHint) break;
        lastGateHint = ev.gate;
        say(GATE_HINTS[ev.gate] ?? "Something here needs an ability you don't have yet.", 5000);
        break;
      }
      case "rest":
        if (session.party.some((m) => m.hp < m.maxHp)) {
          restoreParty(session);
          renderParty();
          say("The shrine's pale light washes over you. The party is restored.");
          autosave();
        }
        break;
      case "exit": {
        const exit = exitAt(session, ev.x, ev.y);
        if (!exit) break;
        held.length = 0;
        const r = travel(session, exit.id);
        resetZoneView();
        graceUntil = now + GRACE_MS;
        say(r.isNew ? `${r.message} (The Maze builds this place as you enter. It will stay as you leave it.)` : r.message, r.isNew ? 9000 : 3000);
        autosave();
        return; // the rest of this tick's events belong to the old zone
      }
    }
  }
}

// --- Loop ---
let lastEnemyTick = performance.now();
function frame(now: number) {
  if (mode === "explore" && dirty && now - lastSave > AUTOSAVE_MS) autosave();
  if (mode === "explore") {
    const dir = held[held.length - 1];
    if (dir && !playerTween.busy(now)) handle(movePlayer(session.world, dir), now);
    if (now - lastEnemyTick >= ENEMY_TICK_MS) {
      lastEnemyTick = now;
      handle(stepEnemies(session.world), now);
    }
  }
  if (mode !== "battle" && mode !== "menu" && mode !== "title") {
    const enemies = new Map<string, Pos>();
    for (const e of session.world.enemies) {
      const t = enemyTweens.get(e.id);
      if (t) enemies.set(e.id, t.pos(now));
    }
    while (effects.length && now - effects[0]!.start > 600) effects.shift();
    drawFrame(ctx, {
      world: session.world, player: playerTween.pos(now), enemies, effects, timeMs: now,
      fresh: freshFeatures(),
      featureColor: (f) => (f.job ? JOBS[f.job]?.color : undefined) ?? "#f2d64b",
      floating: session.world.abilities.has("float") && !!session.world.zone.tileDefs[session.world.zone.tiles[session.world.player.y * session.world.zone.width + session.world.player.x]!]?.solid,
    });
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// --- Title screen & save slots ---
function startGame(s: Session, slotNo: number, isNew: boolean) {
  session = s;
  slot = slotNo;
  titleLayer.hidden = true;
  title?.destroy();
  title = null;
  resetZoneView();
  renderParty();
  mode = "explore";
  lastEnemyTick = performance.now();
  graceUntil = performance.now() + 800;
  const z = session.world.zone;
  say(isNew ? z.recipe.story : `Slot ${slotNo}: ${z.name}.`, isNew ? 6000 : 3000);
  autosave();
}

let title: TitleScreen | null = null;
function showTitle() {
  if (mode !== "title") autosave();
  mode = "title";
  held.length = 0;
  titleLayer.hidden = false;
  title?.destroy();
  title = new TitleScreen(titleLayer, localStorage, startGame);
}
document.getElementById("saves-btn")!.addEventListener("click", showTitle);
window.addEventListener("pagehide", () => { if (mode !== "title") autosave(); });
document.addEventListener("visibilitychange", () => { if (document.hidden && mode !== "title") autosave(); });
showTitle();

// Debug handle for poking at state from the console.
(window as unknown as { maze: unknown }).maze = {
  get world() { return session.world; },
  get session() { return session; },
  get battle() { return battleView?.state; },
};
