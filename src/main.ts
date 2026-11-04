/**
 * Browser entry: wires input and timing to the pure world logic, then renders.
 */
import { createWorld, movePlayer, stepEnemies, type Dir, type WorldEvent } from "./core/world";
import { ENEMY_KINDS, getZone } from "./data";
import { drawFrame, TILE, type Pos } from "./render/renderer";
import { Tween } from "./render/tween";

const VIEW_TILES_W = 15;
const VIEW_TILES_H = 11;
const PLAYER_STEP_MS = 140;
const ENEMY_STEP_MS = 280;
const ENEMY_TICK_MS = 700;
const SEED = 0x6d617a65; // "maze"

const canvas = document.getElementById("game") as HTMLCanvasElement;
canvas.width = VIEW_TILES_W * TILE;
canvas.height = VIEW_TILES_H * TILE;
const ctx = canvas.getContext("2d")!;
const zoneLabel = document.getElementById("zone-name")!;
const messageEl = document.getElementById("message")!;

// --- Messages ---
let messageTimer = 0;
function say(text: string, ms = 4000) {
  messageEl.textContent = text;
  messageEl.classList.add("show");
  window.clearTimeout(messageTimer);
  messageTimer = window.setTimeout(() => messageEl.classList.remove("show"), ms);
}

const world = createWorld(getZone("antechamber"), ENEMY_KINDS, SEED);
zoneLabel.textContent = world.zone.name;
say(world.zone.recipe.story);

const playerTween = new Tween(world.player.x, world.player.y, PLAYER_STEP_MS);
const enemyTweens = new Map(world.enemies.map((e) => [e.id, new Tween(e.x, e.y, ENEMY_STEP_MS)]));

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

// Encounters are placeholders until Milestone 3 (map-to-battle transitions).
let encounterCooldownUntil = 0;
function handle(events: WorldEvent[], now: number) {
  for (const ev of events) {
    switch (ev.type) {
      case "moved":
        if (ev.who === "player") playerTween.moveTo(world.player.x, world.player.y, ev.fromX, ev.fromY, now);
        else {
          const e = world.enemies.find((en) => en.id === ev.who)!;
          enemyTweens.get(e.id)?.moveTo(e.x, e.y, ev.fromX, ev.fromY, now);
        }
        break;
      case "encounter": {
        if (now < encounterCooldownUntil) break;
        encounterCooldownUntil = now + 1200;
        const e = world.enemies.find((en) => en.id === ev.enemyId)!;
        const name = world.enemyKinds[e.kind]!.name;
        say(ev.initiator === "enemy" ? `${name} lunges at you! (Battles arrive in Milestone 3.)` : `You confront the ${name}. (Battles arrive in Milestone 3.)`);
        break;
      }
      case "exit":
        say("The exit hums. Beyond it, the Maze is still deciding what to become. (Zone generation: Milestone 6.)");
        break;
    }
  }
}

// --- Loop ---
let lastEnemyTick = performance.now();
function frame(now: number) {
  const dir = held[held.length - 1];
  if (dir && !playerTween.busy(now)) handle(movePlayer(world, dir), now);

  if (now - lastEnemyTick >= ENEMY_TICK_MS) {
    lastEnemyTick = now;
    handle(stepEnemies(world), now);
  }

  const enemies = new Map<string, Pos>();
  for (const [id, t] of enemyTweens) enemies.set(id, t.pos(now));
  drawFrame(ctx, { world, player: playerTween.pos(now), enemies, timeMs: now });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Debug handle for poking at state from the console.
(window as unknown as { maze: unknown }).maze = { world };
