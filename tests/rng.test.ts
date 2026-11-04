import { describe, expect, it } from "vitest";
import { Rng } from "../src/core/rng";

describe("Rng", () => {
  it("is reproducible for the same seed", () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it("differs across seeds", () => {
    expect(new Rng(1).next()).not.toEqual(new Rng(2).next());
  });

  it("stays in range", () => {
    const r = new Rng(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(r.int(5)).toBeLessThan(5);
    }
  });

  it("resumes from a saved state", () => {
    const r = new Rng(99);
    r.next();
    const saved = r.state;
    const expected = r.next();
    expect(new Rng(saved).next()).toBe(expected);
  });
});
