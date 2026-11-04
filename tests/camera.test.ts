import { describe, expect, it } from "vitest";
import { cameraOrigin } from "../src/core/camera";

describe("cameraOrigin", () => {
  it("centers on the focus when away from edges", () => {
    expect(cameraOrigin(500, 400, 200, 100, 1000, 1000)).toEqual({ x: 400, y: 350 });
  });

  it("clamps at the top-left and bottom-right", () => {
    expect(cameraOrigin(10, 10, 200, 100, 1000, 1000)).toEqual({ x: 0, y: 0 });
    expect(cameraOrigin(990, 990, 200, 100, 1000, 1000)).toEqual({ x: 800, y: 900 });
  });

  it("centers a map smaller than the view", () => {
    expect(cameraOrigin(50, 50, 200, 200, 100, 100)).toEqual({ x: -50, y: -50 });
  });
});
