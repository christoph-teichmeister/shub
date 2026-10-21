import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clampPan, clampZoom, fitWorld, zoomAt } from '../web/src/lib/village/camera.ts';

const world = { W: 1000, H: 800 };

test('zooming keeps the world point under the cursor fixed and clamps the zoom', () => {
  const pan = { x: -100, y: 50 };
  const under = (p: { x: number; y: number }, z: number) => ({ x: (300 - p.x) / z, y: (200 - p.y) / z });
  const r = zoomAt(pan, 1, 1.5, 300, 200);
  assert.equal(r.zoom, 1.5);
  assert.deepEqual(under(r.pan, r.zoom), under(pan, 1));
  assert.equal(zoomAt(pan, 1, 9, 0, 0).zoom, 1.6);
  assert.equal(clampZoom(0.01), 0.4);
});

test('the pan keeps part of the map in view on every side', () => {
  const lo = clampPan({ x: -99999, y: -99999 }, 1, world, 500, 400);
  assert.deepEqual(lo, { x: 120 - 1000, y: 120 - 800 });
  const hi = clampPan({ x: 99999, y: 99999 }, 1, world, 500, 400);
  assert.deepEqual(hi, { x: 500 - 120, y: 400 - 120 });
  assert.deepEqual(clampPan({ x: 10, y: 20 }, 1, world, 500, 400), { x: 10, y: 20 });
});

test('fit centres the whole world in the frame', () => {
  const f = fitWorld(world, 500, 400);
  assert.equal(f.zoom, 0.5);
  assert.deepEqual(f.pan, { x: 0, y: 0 });
  const wide = fitWorld(world, 3000, 800);
  assert.equal(wide.zoom, 1);
  assert.deepEqual(wide.pan, { x: 1000, y: 0 });
});
