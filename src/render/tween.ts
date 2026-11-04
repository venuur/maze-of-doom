/** Visual-only interpolation between tile positions. Never feeds back into logic. */
import { TILE, type Pos } from "./renderer";

export class Tween {
  private fromX: number;
  private fromY: number;
  private toX: number;
  private toY: number;
  private start = 0;

  constructor(x: number, y: number, private durationMs: number) {
    this.fromX = this.toX = x;
    this.fromY = this.toY = y;
  }

  moveTo(x: number, y: number, fromX: number, fromY: number, nowMs: number): void {
    this.fromX = fromX;
    this.fromY = fromY;
    this.toX = x;
    this.toY = y;
    this.start = nowMs;
  }

  busy(nowMs: number): boolean {
    return nowMs - this.start < this.durationMs;
  }

  pos(nowMs: number): Pos {
    const t = Math.min(1, (nowMs - this.start) / this.durationMs);
    return {
      px: (this.fromX + (this.toX - this.fromX) * t) * TILE,
      py: (this.fromY + (this.toY - this.fromY) * t) * TILE,
    };
  }
}
