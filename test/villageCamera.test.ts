import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clampPan, clampZoom, fitWorld, minZoom, pinchZoom, zoomAt } from '../web/src/lib/village/camera.ts';

const world = { W: 1000, H: 800 };

test('the minimum zoom is where the world just covers the viewport', () => {
  assert.equal(minZoom(world, 500, 400), 0.5);
  assert.equal(minZoom(world, 500, 200), 0.5); // the wider side decides
  assert.equal(minZoom(world, 300, 640), 0.8); // the taller side decides
  assert.equal(minZoom(world, 9000, 9000), 1.6); // a tiny world cannot be covered: capped at the zoom limit
});

test('zooming keeps the world point under the cursor fixed and clamps the zoom', () => {
  const pan = { x: -100, y: 50 };
  const under = (p: { x: number; y: number }, z: number) => ({ x: (300 - p.x) / z, y: (200 - p.y) / z });
  const r = zoomAt(pan, 1, 1.5, 300, 200, 0.5);
  assert.equal(r.zoom, 1.5);
  assert.deepEqual(under(r.pan, r.zoom), under(pan, 1));
  assert.equal(zoomAt(pan, 1, 9, 0, 0, 0.5).zoom, 1.6);
  assert.equal(zoomAt(pan, 1, 0.01, 0, 0, 0.5).zoom, 0.5);
  assert.equal(clampZoom(0.01, 0.4), 0.4);
});

test('the pan keeps the world edge at or outside the window edge, so no bar shows', () => {
  const [vw, vh] = [500, 400];
  for (const zoom of [0.5, 0.8, 1.6]) {
    for (const p of [
      { x: -99999, y: -99999 },
      { x: 99999, y: 99999 },
      { x: 10, y: -20 },
    ]) {
      const c = clampPan(p, zoom, world, vw, vh);
      assert.ok(c.x <= 0 && c.y <= 0, `${zoom}: left/top edge inside the window ${JSON.stringify(c)}`);
      assert.ok(c.x + world.W * zoom >= vw && c.y + world.H * zoom >= vh, `${zoom}: right/bottom edge inside`);
    }
  }
  assert.deepEqual(clampPan({ x: -99999, y: -99999 }, 1, world, 500, 400), { x: 500 - 1000, y: 400 - 800 });
  assert.deepEqual(clampPan({ x: 99999, y: 99999 }, 1, world, 500, 400), { x: 0, y: 0 });
  assert.deepEqual(clampPan({ x: -10, y: -20 }, 1, world, 500, 400), { x: -10, y: -20 });
});

test('fit covers the window: the whole world when the shapes match, else the larger side fits and the pan is centred', () => {
  const f = fitWorld(world, 500, 400);
  assert.equal(f.zoom, 0.5);
  assert.deepEqual(f.pan, { x: 0, y: 0 });
  const wide = fitWorld(world, 1200, 800); // wider window: the width fits, the height is cropped evenly
  assert.equal(wide.zoom, 1.2);
  assert.ok(Math.abs(wide.pan.x) < 1e-9 && Math.abs(wide.pan.y + 80) < 1e-9);
  const tall = fitWorld(world, 500, 800);
  assert.equal(tall.zoom, 1);
  assert.deepEqual(tall.pan, { x: -250, y: 0 });
});

test('a pinch zooms with the finger distance around its centre, clamped, and follows the moving centre', () => {
  const start = { pan: { x: -100, y: 50 }, zoom: 1, mid: { x: 300, y: 200 }, dist: 100 };
  const under = (p: { x: number; y: number }, z: number, m: { x: number; y: number }) => ({
    x: (m.x - p.x) / z,
    y: (m.y - p.y) / z,
  });
  const out = pinchZoom(start, start.mid, 150, 0.5);
  assert.equal(out.zoom, 1.5);
  assert.deepEqual(under(out.pan, out.zoom, start.mid), under(start.pan, 1, start.mid));
  // Both fingers moved: the same world point is now under the new centre.
  const moved = pinchZoom(start, { x: 340, y: 170 }, 120, 0.5);
  assert.deepEqual(under(moved.pan, moved.zoom, { x: 340, y: 170 }), under(start.pan, 1, start.mid));
  assert.equal(pinchZoom(start, start.mid, 10000, 0.5).zoom, 1.6);
  assert.equal(pinchZoom(start, start.mid, 1, 0.5).zoom, 0.5);
  // Unchanged fingers: the camera stays put (no jump when a pinch starts).
  assert.deepEqual(pinchZoom(start, start.mid, 100, 0.5), { zoom: 1, pan: start.pan });
  // Fingers starting on one spot do not divide by zero.
  assert.equal(pinchZoom({ ...start, dist: 0 }, start.mid, 1, 0.5).zoom, 1);
});
