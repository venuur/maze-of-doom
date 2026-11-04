/**
 * Camera that centers on a focus point and clamps to the map edges.
 * Works in pixels so it follows smooth (interpolated) movement.
 */
export function cameraOrigin(
  focusX: number,
  focusY: number,
  viewW: number,
  viewH: number,
  mapW: number,
  mapH: number,
): { x: number; y: number } {
  return {
    x: clampAxis(focusX - viewW / 2, viewW, mapW),
    y: clampAxis(focusY - viewH / 2, viewH, mapH),
  };
}

function clampAxis(origin: number, view: number, map: number): number {
  // Map smaller than the view: center it.
  if (map <= view) return -(view - map) / 2;
  return Math.min(Math.max(origin, 0), map - view);
}
