/**
 * Canvas 2D renderer. Placeholder shapes only: everything visual lives here,
 * so real art can replace it without touching game logic.
 */
import { cameraOrigin } from "../core/camera";
import { DELTA, type Dir, type World } from "../core/world";
import { tileAt, type Feature } from "../core/zone";

export const TILE = 32;

/** Pixel position of an actor, interpolated between tiles. */
export interface Pos {
  px: number;
  py: number;
}

/** Short-lived visual effects (e.g. an instant-win poof). */
export interface Effect {
  kind: "poof";
  px: number;
  py: number;
  start: number;
  color: string;
}

export interface Frame {
  world: World;
  player: Pos;
  enemies: Map<string, Pos>;
  effects?: Effect[];
  /** Features whose job is not yet discovered get a "!" marker. */
  fresh?: ReadonlySet<string>;
  /** Accent color per feature (e.g. its job's color). */
  featureColor?: (f: Feature) => string;
  /** The player is hovering over a gated tile (e.g. Float over lava). */
  floating?: boolean;
  timeMs: number;
}

/** The zone's most common open tile color, cached per zone: background for tiles drawn on "floor". */
const floorColors = new WeakMap<World["zone"], string>();
function floorColorOf(zone: World["zone"]): string {
  let c = floorColors.get(zone);
  if (c) return c;
  const counts = new Map<string, number>();
  for (const ch of zone.tiles) {
    const t = zone.tileDefs[ch];
    if (t && !t.solid && !t.rest && !t.exit) counts.set(t.color, (counts.get(t.color) ?? 0) + 1);
  }
  c = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "#8a8074";
  floorColors.set(zone, c);
  return c;
}

export function drawFrame(ctx: CanvasRenderingContext2D, f: Frame): void {
  const { world } = f;
  const { zone } = world;
  const floor = floorColorOf(zone);
  const vw = ctx.canvas.width;
  const vh = ctx.canvas.height;
  const cam = cameraOrigin(
    f.player.px + TILE / 2,
    f.player.py + TILE / 2,
    vw,
    vh,
    zone.width * TILE,
    zone.height * TILE,
  );
  const ox = Math.round(cam.x);
  const oy = Math.round(cam.y);

  ctx.fillStyle = "#14111c";
  ctx.fillRect(0, 0, vw, vh);

  // Only draw visible tiles.
  const x0 = Math.max(0, Math.floor(ox / TILE));
  const y0 = Math.max(0, Math.floor(oy / TILE));
  const x1 = Math.min(zone.width - 1, Math.floor((ox + vw) / TILE));
  const y1 = Math.min(zone.height - 1, Math.floor((oy + vh) / TILE));

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const t = tileAt(zone, x, y);
      if (!t) continue;
      drawTile(ctx, t.draw ?? t.id, t.rest ? floor : t.color, x * TILE - ox, y * TILE - oy, x, y, f);
    }
  }

  for (const feat of zone.features) {
    if (world.removedFeatures.has(feat.id)) continue;
    const sx = feat.x * TILE - ox;
    const sy = feat.y * TILE - oy;
    if (sx < -TILE || sy < -TILE || sx > vw || sy > vh) continue;
    drawFeature(ctx, feat, sx, sy, f.featureColor?.(feat) ?? "#d9d3e6", !!f.fresh?.has(feat.id), f.timeMs);
  }

  for (const e of world.enemies) {
    const pos = f.enemies.get(e.id);
    const kind = world.enemyKinds[e.kind];
    if (!pos || !kind) continue;
    drawEnemy(ctx, kind.shape, kind.color, pos.px - ox, pos.py - oy, f.timeMs, e.id);
  }

  const lift = f.floating ? 5 + Math.sin(f.timeMs / 300) * 2 : 0;
  if (lift) {
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ellipse(ctx, f.player.px - ox + TILE / 2, f.player.py - oy + TILE - 4, 8, 2);
  }
  drawPlayer(ctx, f.player.px - ox, f.player.py - oy - lift, world.player.facing);

  for (const fx of f.effects ?? []) drawPoof(ctx, fx, fx.px - ox, fx.py - oy, f.timeMs);
}

function drawPoof(ctx: CanvasRenderingContext2D, fx: Effect, sx: number, sy: number, now: number): void {
  const t = Math.min(1, (now - fx.start) / 600);
  const h = TILE / 2;
  ctx.globalAlpha = 1 - t;
  ctx.fillStyle = fx.color;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const r = 4 + t * 18;
    circle(ctx, sx + h + Math.cos(a) * r, sy + h + Math.sin(a) * r, 3 * (1 - t) + 1);
  }
  ctx.strokeStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(sx + h, sy + h, 6 + t * 14, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawTile(
  ctx: CanvasRenderingContext2D,
  id: string,
  color: string,
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  f: Frame,
): void {
  ctx.fillStyle = color;
  ctx.fillRect(sx, sy, TILE, TILE);
  const h = TILE / 2;

  switch (id) {
    case "wall":
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.fillRect(sx, sy + TILE - 6, TILE, 6);
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.strokeRect(sx + 0.5, sy + 0.5, TILE - 1, TILE - 7);
      break;
    case "floor":
      if ((tx * 7 + ty * 13) % 5 === 0) {
        ctx.fillStyle = "#7c7368";
        ctx.fillRect(sx + 6, sy + 10, 4, 3);
      }
      break;
    case "grass":
      ctx.fillStyle = "#74a25b";
      for (let i = 0; i < 3; i++) {
        const gx = sx + ((tx * 11 + i * 9) % 24) + 4;
        const gy = sy + ((ty * 7 + i * 13) % 20) + 8;
        ctx.fillRect(gx, gy, 2, 5);
      }
      break;
    case "tree":
      ctx.fillStyle = "#5f8a4a";
      ctx.fillRect(sx, sy, TILE, TILE);
      ctx.fillStyle = "#5a3d24";
      ctx.fillRect(sx + h - 3, sy + h + 4, 6, 10);
      ctx.fillStyle = color;
      circle(ctx, sx + h, sy + h - 2, 12);
      break;
    case "water":
    case "lava": {
      // Gentle shimmer so hazards read as alive.
      const phase = Math.sin(f.timeMs / 500 + tx * 0.9 + ty * 0.6);
      ctx.fillStyle = id === "lava" ? "#f07a2c" : "#4c86c0";
      ctx.globalAlpha = 0.35 + 0.25 * phase;
      ctx.fillRect(sx + 4, sy + 8 + phase * 3, 12, 3);
      ctx.fillRect(sx + 16, sy + 20 - phase * 3, 10, 3);
      ctx.globalAlpha = 1;
      break;
    }
    case "door":
      ctx.fillStyle = "#6e5232";
      ctx.fillRect(sx + 2, sy, 4, TILE);
      ctx.fillRect(sx + TILE - 6, sy, 4, TILE);
      break;
    case "exit":
      ctx.fillStyle = "#14111c";
      ctx.fillRect(sx + 4, sy + 4, TILE - 8, TILE - 4);
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.5 + 0.3 * Math.sin(f.timeMs / 300);
      ctx.fillRect(sx + 8, sy + 8, TILE - 16, TILE - 8);
      ctx.globalAlpha = 1;
      break;
    case "statue":
      drawStatue(ctx, sx, sy, tx, ty, f);
      break;
    case "vines":
      ctx.strokeStyle = "#5f9a3a";
      ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        const vx = sx + 6 + i * 10;
        ctx.moveTo(vx, sy);
        ctx.quadraticCurveTo(vx + 6 * Math.sin(tx + i), sy + h, vx, sy + TILE);
        ctx.stroke();
      }
      ctx.lineWidth = 1;
      break;
    case "spire": {
      ctx.fillStyle = "#5e4c44";
      ctx.fillRect(sx, sy, TILE, TILE);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(sx + h, sy - 10);
      ctx.lineTo(sx + TILE - 3, sy + TILE);
      ctx.lineTo(sx + 3, sy + TILE);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = `rgba(240,122,44,${0.3 + 0.2 * Math.sin(f.timeMs / 600 + tx)})`;
      ctx.fillRect(sx + h - 2, sy + 6, 4, TILE - 10);
      break;
    }
    case "bell": {
      ctx.fillStyle = "#5f6470";
      ctx.fillRect(sx, sy, TILE, TILE);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(sx + 8, sy + 6);
      ctx.lineTo(sx + TILE - 8, sy + 6);
      ctx.lineTo(sx + TILE - 2, sy + TILE - 4);
      ctx.lineTo(sx + 2, sy + TILE - 4);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#14111c";
      ctx.stroke();
      break;
    }
    case "shrine": {
      // A small rest shrine with a pulsing light.
      ctx.fillStyle = "#5c5468";
      ctx.fillRect(sx + 8, sy + 16, 16, 12);
      ctx.fillStyle = "#7a7088";
      ctx.fillRect(sx + 6, sy + 26, 20, 4);
      const glow = 0.55 + 0.35 * Math.sin(f.timeMs / 400);
      ctx.globalAlpha = glow;
      ctx.fillStyle = "#9fe8ff";
      circle(ctx, sx + h, sy + 11, 5);
      ctx.globalAlpha = glow * 0.35;
      circle(ctx, sx + h, sy + 11, 10);
      ctx.globalAlpha = 1;
      break;
    }
    case "relic": {
      ctx.fillStyle = "#c2461f"; // sits on the lava island
      ctx.fillRect(sx, sy, TILE, TILE);
      ctx.fillStyle = "#6b4a2a";
      ctx.fillRect(sx + 2, sy + 2, TILE - 4, TILE - 4);
      const glow = 0.6 + 0.4 * Math.sin(f.timeMs / 250);
      ctx.fillStyle = color;
      ctx.globalAlpha = glow;
      diamond(ctx, sx + h, sy + h, 8);
      ctx.globalAlpha = 1;
      break;
    }
  }
}

/** The Watching Statues: their eyes track the player. */
function drawStatue(ctx: CanvasRenderingContext2D, sx: number, sy: number, tx: number, ty: number, f: Frame): void {
  ctx.fillStyle = "#8a8074";
  ctx.fillRect(sx, sy, TILE, TILE);
  ctx.fillStyle = "#6f6a80";
  ctx.fillRect(sx + 3, sy + 3, TILE - 6, TILE - 6);
  ctx.fillStyle = "#b9b2c9";
  ctx.fillRect(sx + 5, sy + 5, TILE - 10, TILE - 10);

  const cx = tx * TILE + TILE / 2;
  const cy = ty * TILE + TILE / 2;
  const dx = f.player.px + TILE / 2 - cx;
  const dy = f.player.py + TILE / 2 - cy;
  const len = Math.hypot(dx, dy) || 1;
  const lx = (dx / len) * 2.5;
  const ly = (dy / len) * 2.5;
  for (const ex of [-5, 5]) {
    ctx.fillStyle = "#14111c";
    circle(ctx, sx + TILE / 2 + ex, sy + TILE / 2 - 2, 3.5);
    ctx.fillStyle = "#e84a5f";
    circle(ctx, sx + TILE / 2 + ex + lx, sy + TILE / 2 - 2 + ly, 1.6);
  }
}

function drawEnemy(
  ctx: CanvasRenderingContext2D,
  shape: string,
  color: string,
  sx: number,
  sy: number,
  timeMs: number,
  id: string,
): void {
  const h = TILE / 2;
  const seed = [...id].reduce((a, c) => a + c.charCodeAt(0), 0);
  const bob = Math.sin(timeMs / 220 + seed) * 2;

  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ellipse(ctx, sx + h, sy + TILE - 5, 10, 3);

  ctx.fillStyle = color;
  ctx.strokeStyle = "#14111c";
  ctx.lineWidth = 2;
  switch (shape) {
    case "blob":
      ctx.beginPath();
      ctx.ellipse(sx + h, sy + h + 4 + bob / 2, 11, 9 - bob / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    case "square":
      ctx.fillRect(sx + 6, sy + 4, TILE - 12, TILE - 10);
      ctx.strokeRect(sx + 6, sy + 4, TILE - 12, TILE - 10);
      break;
    case "diamond":
      diamond(ctx, sx + h, sy + h + bob - 2, 10);
      ctx.stroke();
      break;
    case "triangle":
      ctx.beginPath();
      ctx.moveTo(sx + h, sy + 4);
      ctx.lineTo(sx + TILE - 6, sy + TILE - 6);
      ctx.lineTo(sx + 6, sy + TILE - 6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    default:
      circle(ctx, sx + h, sy + h, 10);
  }
  ctx.lineWidth = 1;

  // Eyes
  ctx.fillStyle = "#14111c";
  const eyeY = sy + h + (shape === "diamond" ? bob - 3 : shape === "square" ? -2 : 3);
  ctx.fillRect(sx + h - 5, eyeY, 3, 3);
  ctx.fillRect(sx + h + 2, eyeY, 3, 3);
}

function drawFeature(ctx: CanvasRenderingContext2D, feat: Feature, sx: number, sy: number, color: string, fresh: boolean, now: number): void {
  const h = TILE / 2;
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ellipse(ctx, sx + h, sy + TILE - 4, 10, 3);
  ctx.strokeStyle = "#14111c";
  ctx.lineWidth = 2;
  if (feat.look === "hermit") {
    // Robed figure with a staff.
    ctx.fillStyle = "#5a5068";
    ctx.beginPath();
    ctx.moveTo(sx + h, sy + 8);
    ctx.lineTo(sx + h + 9, sy + TILE - 4);
    ctx.lineTo(sx + h - 9, sy + TILE - 4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#cdb89a";
    circle(ctx, sx + h, sy + 9, 5);
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx + h + 11, sy + 4);
    ctx.lineTo(sx + h + 11, sy + TILE - 4);
    ctx.stroke();
  } else if (feat.look === "stone") {
    // An inscribed standing stone.
    ctx.fillStyle = "#8a8496";
    ctx.beginPath();
    ctx.roundRect(sx + 9, sy + 6, 14, 22, [6, 6, 1, 1]);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#4a4458";
    for (let i = 0; i < 3; i++) ctx.fillRect(sx + 12, sy + 12 + i * 5, 8, 2);
  } else if (feat.look === "relic") {
    // A glowing eye-shaped relic.
    const glow = 0.5 + Math.sin(now / 200) * 0.3;
    ctx.fillStyle = `rgba(242,214,75,${glow})`;
    circle(ctx, sx + h, sy + h, 11);
    ctx.fillStyle = "#fff6d0";
    ctx.beginPath();
    ctx.ellipse(sx + h, sy + h, 9, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#14111c";
    circle(ctx, sx + h, sy + h, 3);
  } else {
    // A weapon lying on the ground, glinting.
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(sx + h, sy + h + 4, 10, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#e8e0c8";
    ctx.beginPath();
    ctx.moveTo(sx + h - 8, sy + h - 1);
    ctx.lineTo(sx + h + 8, sy + h - 1);
    ctx.stroke();
  }
  ctx.lineWidth = 1;
  if (fresh) {
    const bob = Math.sin(now / 250) * 2;
    ctx.fillStyle = "#f2d64b";
    ctx.font = "bold 14px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText("!", sx + h, sy + 2 + bob);
    ctx.textAlign = "start";
  }
}

function drawPlayer(ctx: CanvasRenderingContext2D, sx: number, sy: number, facing: Dir): void {
  const h = TILE / 2;
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ellipse(ctx, sx + h, sy + TILE - 4, 10, 3);

  ctx.fillStyle = "#3d6fd6"; // body
  ctx.strokeStyle = "#14111c";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(sx + 8, sy + 12, 16, 16, 4);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#f1c9a0"; // head
  circle(ctx, sx + h, sy + 10, 7);
  ctx.stroke();
  ctx.lineWidth = 1;

  // Facing marker
  const { dx, dy } = DELTA[facing];
  ctx.fillStyle = "#14111c";
  if (dy !== 0 && dy > 0) {
    ctx.fillRect(sx + h - 4, sy + 9, 2, 2);
    ctx.fillRect(sx + h + 2, sy + 9, 2, 2);
  } else if (dx !== 0) {
    ctx.fillRect(sx + h + dx * 3 - 1, sy + 9, 2, 2);
  }
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

function diamond(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r, y);
  ctx.closePath();
  ctx.fill();
}
