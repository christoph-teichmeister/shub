// Village camera maths: the world sits at `translate(pan) scale(zoom)` inside a clipped viewport. The world always
// covers the viewport (no bare bar beside it): the zoom never goes below the one where it just fills the window, and
// the pan keeps the world's edge at or outside the window's edge.

export interface Pan {
  x: number;
  y: number;
}

export const MAX_ZOOM = 1.6;

/** The zoom at which the world just covers the viewport on both axes: the smallest one allowed. */
export const minZoom = (world: { W: number; H: number }, vw: number, vh: number) =>
  Math.min(MAX_ZOOM, Math.max(vw / world.W, vh / world.H));

export const clampZoom = (z: number, min: number) => Math.min(MAX_ZOOM, Math.max(min, z));

/** The world edge stays at or outside the viewport edge on each axis (centred where the world is smaller). */
export function clampPan(p: Pan, zoom: number, world: { W: number; H: number }, vw: number, vh: number): Pan {
  const axis = (v: number, size: number, view: number) =>
    size <= view ? (view - size) / 2 : Math.min(0, Math.max(view - size, v));
  return { x: axis(p.x, world.W * zoom, vw), y: axis(p.y, world.H * zoom, vh) };
}

/** Zoom to `next`, keeping the world point under the screen point (cx, cy) where it is. */
export function zoomAt(pan: Pan, zoom: number, next: number, cx: number, cy: number, min: number) {
  const z = clampZoom(next, min);
  const k = z / zoom;
  return { zoom: z, pan: { x: cx - (cx - pan.x) * k, y: cy - (cy - pan.y) * k } };
}

/** Fit: the whole world if its shape matches the window, else the larger side fits and the rest is cropped; centred. */
export function fitWorld(world: { W: number; H: number }, vw: number, vh: number) {
  const zoom = minZoom(world, vw, vh);
  return { zoom, pan: clampPan({ x: (vw - world.W * zoom) / 2, y: (vh - world.H * zoom) / 2 }, zoom, world, vw, vh) };
}

/** Where a pinch began: the camera then and the two fingers' midpoint and distance, in viewport px. */
export interface PinchStart {
  pan: Pan;
  zoom: number;
  mid: Pan;
  dist: number;
}

/** A two-finger pinch: the zoom scales with the finger distance (clamped), the world point that sat under the
 * starting midpoint stays under the current one (so moving both fingers pans too). Always from the start, no drift. */
export function pinchZoom(start: PinchStart, mid: Pan, dist: number, min: number) {
  const r = zoomAt(start.pan, start.zoom, (start.zoom * dist) / Math.max(1, start.dist), start.mid.x, start.mid.y, min);
  return { zoom: r.zoom, pan: { x: r.pan.x + mid.x - start.mid.x, y: r.pan.y + mid.y - start.mid.y } };
}
