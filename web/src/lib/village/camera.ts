// Village camera maths: the world sits at `translate(pan) scale(zoom)` inside a clipped viewport.

export interface Pan {
  x: number;
  y: number;
}

export const MIN_ZOOM = 0.4;
export const MAX_ZOOM = 1.6;
/** How much of the map must stay inside the viewport, in screen px. */
export const KEEP = 120;

export const clampZoom = (z: number, min = MIN_ZOOM) => Math.min(MAX_ZOOM, Math.max(min, z));

/** The map never leaves the viewport entirely: at least KEEP px of it stay in view on each axis. */
export function clampPan(p: Pan, zoom: number, world: { W: number; H: number }, vw: number, vh: number): Pan {
  const kx = Math.min(KEEP, vw, world.W * zoom);
  const ky = Math.min(KEEP, vh, world.H * zoom);
  return {
    x: Math.min(vw - kx, Math.max(kx - world.W * zoom, p.x)),
    y: Math.min(vh - ky, Math.max(ky - world.H * zoom, p.y)),
  };
}

/** Zoom to `next`, keeping the world point under the screen point (cx, cy) where it is. */
export function zoomAt(pan: Pan, zoom: number, next: number, cx: number, cy: number) {
  const z = clampZoom(next);
  const k = z / zoom;
  return { zoom: z, pan: { x: cx - (cx - pan.x) * k, y: cy - (cy - pan.y) * k } };
}

/** The whole world in the viewport, centred. */
export function fitWorld(world: { W: number; H: number }, vw: number, vh: number) {
  const zoom = clampZoom(Math.min(vw / world.W, vh / world.H), 0.2);
  return { zoom, pan: { x: (vw - world.W * zoom) / 2, y: (vh - world.H * zoom) / 2 } };
}
