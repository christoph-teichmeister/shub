import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advance, blocked, direction, SPEED, standSpot } from '../web/src/lib/village/walk.ts';
import { buildWorld, type VillageProject } from '../web/src/lib/village/world.ts';

const groups = ['Projects', 'private', 'work', 'everyday'];
const projects: VillageProject[] = groups.flatMap((group) =>
  Array.from({ length: 3 }, (_, i) => ({ id: `${group}-${i}`, name: `${group} ${i}`, group, color: '#e6db74' })),
);
const w = buildWorld({ groups, projects, active: new Set(projects.map((p) => p.id)), activeOnly: false });

/** Walk from a spot in small frames, like the view does. */
function go(x: number, y: number, vx: number, vy: number, px: number) {
  let p = { x, y };
  for (let d = 0; d < px; d += (SPEED * 16) / 1000) p = advance(w, p.x, p.y, vx, vy, (SPEED * 16) / 1000);
  return p;
}

test('diagonal input is normalised, opposite keys cancel', () => {
  const [dx, dy] = direction(false, true, true, false);
  assert.ok(Math.abs(Math.hypot(dx, dy) - 1) < 1e-9);
  assert.deepEqual(direction(true, true, false, false), [0, 0]);
});

test('the stand spot below the desk is free, the desk itself and the houses are not', () => {
  const [sx, sy] = standSpot(w);
  assert.equal(blocked(w, sx, sy), false);
  assert.equal(blocked(w, w.you.x, w.you.y - 20), true);
  for (const h of Object.values(w.houses)) assert.equal(blocked(w, h.x, h.y - 40), true);
  assert.equal(blocked(w, w.hall.x, w.hall.y - 40), true);
  assert.equal(blocked(w, w.pond.x, w.pond.y), true);
  assert.equal(blocked(w, -5, 100), true);
});

test('walking moves at about SPEED px per second', () => {
  const [sx, sy] = standSpot(w);
  const r = advance(w, sx, sy, 1, 0, SPEED);
  assert.ok(Math.abs(r.x - sx - SPEED) < 1e-6 || r.moved < SPEED);
  assert.ok(Math.abs(r.moved - (r.x - sx)) < 1e-6);
});

test('a fence stops you, the gate lets you through, from both sides', () => {
  const d = w.districts[0];
  const [gx, gy] = d.gate;
  const gateAbove = gy === d.y;
  const [dir, off] = gateAbove ? [1, -1] : [-1, 1]; // from outside into the district
  const start = { x: gx, y: gy + off * 60 };
  assert.equal(blocked(w, start.x, start.y), false);
  const through = go(start.x, start.y, 0, dir, 140);
  assert.ok(Math.abs(through.y - (start.y + dir * 140)) < 8, 'walks through the gate');
  // Same walk 2 tiles beside the gate: the fence stops it.
  const side = go(gx + 64 + 40, start.y, 0, dir, 140);
  assert.ok(Math.abs(side.y - gy) < 24 && Math.abs(side.y - (gy + off * 60 + dir * 140)) > 30, 'blocked by the fence');
  assert.equal(blocked(w, side.x, side.y), false);
});

test('a house stops you and a diagonal into the wall slides along it', () => {
  const h = Object.values(w.houses)[0];
  // From the left of the house walk right: stopped at its wall.
  const y = h.y - 30;
  const start = { x: h.x - 90, y };
  assert.equal(blocked(w, start.x, start.y), false);
  const hit = go(start.x, start.y, 1, 0, 120);
  assert.ok(hit.x < h.x - 48 + 1 && hit.x > start.x, 'stopped at the wall');
  // Diagonal down-right: x stops at the wall, y keeps going.
  const from = { x: start.x, y: h.y - 80 };
  const slide = go(from.x, from.y, Math.SQRT1_2, Math.SQRT1_2, 80);
  assert.ok(slide.y > from.y + 40, 'slid down along the wall');
  assert.ok(slide.x < h.x - 48 + 1, 'still outside the wall');
});

test('a big frame cannot jump over a fence', () => {
  const d = w.districts[0];
  const x = d.x + d.w / 2 + 200;
  const y = d.y + d.h / 2;
  const r = advance(w, x - d.w, y, 1, 0, d.w * 2); // across the whole district, no gate on the side
  assert.ok(r.x < d.x + d.w + 10, 'stays inside the right fence');
});
