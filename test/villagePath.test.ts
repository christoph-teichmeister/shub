import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blockers, findPath } from '../web/src/lib/village/path.ts';
import { crabSpots, type CrabSession } from '../web/src/lib/village/crabs.ts';
import { buildWorld, type Point, type Rect, type VillageProject } from '../web/src/lib/village/world.ts';
import { cellAt, GRASS, TILE } from '../web/src/lib/village/tiles.ts';

const groups = ['Projects', 'private', 'work', 'everyday'];
const projects: VillageProject[] = groups.flatMap((group) =>
  Array.from({ length: 4 }, (_, i) => ({ id: `${group}-${i}`, name: `${group} ${i}`, group, color: '#e6db74' })),
);
const w = buildWorld({ groups, projects, active: new Set(projects.map((p) => p.id)), activeOnly: false });

const hits = (p: Point, r: Rect) => p[0] > r.x && p[0] < r.x + r.w && p[1] > r.y && p[1] < r.y + r.h;
/** True when the segment a-b runs through the fence line of a district away from its gate. */
function crossesFence(a: Point, b: Point): string | null {
  for (const d of w.districts) {
    for (let t = 0; t <= 1; t += 0.02) {
      const p: Point = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      const inside = (q: Point) => q[0] > d.x && q[0] < d.x + d.w && q[1] > d.y && q[1] < d.y + d.h;
      const q: Point = [a[0] + (b[0] - a[0]) * Math.min(1, t + 0.02), a[1] + (b[1] - a[1]) * Math.min(1, t + 0.02)];
      if (inside(p) !== inside(q)) {
        const [gx, gy] = d.gate;
        const through = Math.abs(p[0] - gx) < TILE && Math.abs(p[1] - gy) < TILE;
        if (!through) return d.id;
      }
    }
  }
  return null;
}

test('a route exists from every crab spot type to every house and queue slot, through gates only', () => {
  const sessions: CrabSession[] = [];
  for (const status of ['working', 'paused', 'new', 'needs-you'] as const)
    for (const p of projects)
      sessions.push({ id: `${p.id}-${status}`, kind: 'claude', projectId: p.id, status, statusSince: '2026-01-01' });
  sessions.push({ id: 'g', kind: 'claude', projectId: null, status: 'working', statusSince: '2026-01-01' });
  const queue = sessions.filter((s) => s.status === 'needs-you').map((s) => s.id);
  const spots = crabSpots(w, sessions, queue, 7);
  assert.ok(spots.length > 0);
  // From every house door to every spot.
  const doors = Object.values(w.houses).map((h): Point => [h.x, h.y + 4]);
  for (const door of doors.filter((_, i) => i % 3 === 0))
    for (const c of spots.filter((_, i) => i % 5 === 0)) {
      const route = findPath(w, door, [c.x, c.y]);
      assert.deepEqual(route.at(-1), [c.x, c.y]);
      if (Math.hypot(c.x - door[0], c.y - door[1]) > 150) assert.ok(route.length > 1, 'a real route, not the fallback');
      let prev = door;
      for (const p of route) {
        assert.equal(crossesFence(prev, p), null, `fence crossed on the way to ${c.session.id}`);
        prev = p;
      }
    }
  // A crab leaving its fence goes through the gate of its district.
  const h = Object.values(w.houses)[0];
  const route = findPath(w, [h.x, h.y + 4], [w.slots[0][0], w.slots[0][1]]);
  const [gx, gy] = h.district.gate;
  assert.ok(
    route.some((p) => Math.abs(p[0] - gx) < TILE && Math.abs(p[1] - gy) <= TILE),
    'passes the gate',
  );
});

test('routes keep to paths and district grass, never through houses, the hall or your desk', () => {
  const stop = blockers(w);
  const from = Object.values(w.houses).map((h): Point => [h.x, h.y + 4]);
  for (const f of from)
    for (const to of [...w.slots, [w.mayor.x, w.mayor.y] as Point]) {
      const route = findPath(w, f, to);
      for (const p of route.slice(0, -1)) {
        for (const r of stop) assert.ok(!hits(p, r), `waypoint ${p} in a blocker`);
        const onGrass = cellAt(w.ground, Math.floor(p[0] / TILE), Math.floor(p[1] / TILE)) === GRASS;
        if (onGrass)
          assert.ok(
            w.districts.some((d) => hits(p, d)),
            `waypoint ${p} on open grass`,
          );
      }
    }
});

test('the desk keeps its front free: no route runs through the plaza in front of it', () => {
  const desk: Rect = { x: w.you.x - 56 - TILE / 2, y: w.you.y - 92 - TILE / 2, w: 112 + TILE, h: 92 + TILE };
  const route = findPath(w, [w.houses['work-0'].x, w.houses['work-0'].y + 4], [w.slots[0][0], w.slots[0][1]]);
  for (let i = 1; i < route.length; i++)
    for (let t = 0; t <= 1; t += 0.05) {
      const p: Point = [
        route[i - 1][0] + (route[i][0] - route[i - 1][0]) * t,
        route[i - 1][1] + (route[i][1] - route[i - 1][1]) * t,
      ];
      assert.ok(!hits(p, desk), `route at ${p} in front of the desk`);
    }
});

test('a point nowhere near a path falls back to the straight line', () => {
  const route = findPath(w, [5, 5], [6, 6]);
  assert.deepEqual(route.at(-1), [6, 6]);
});

test('on the big five-district world every house, queue slot and the mayor are reachable by a real route', () => {
  const g5 = ['Projects', 'private', 'work', 'everyday', 'Extra'];
  const ps: VillageProject[] = g5.flatMap((group, k) =>
    Array.from({ length: 3 + k }, (_, i) => ({ id: `${group}-${i}`, name: `${group} ${i}`, group, color: '#fff' })),
  );
  const big = buildWorld({ groups: g5, projects: ps, active: new Set(ps.map((p) => p.id)), activeOnly: false });
  assert.ok(big.W > 4000);
  const goals = [...big.slots, [big.mayor.x, big.mayor.y] as Point];
  for (const h of Object.values(big.houses))
    for (const to of goals) {
      const from: Point = [h.x, h.y + 4];
      const route = findPath(big, from, to);
      assert.deepEqual(route.at(-1), to);
      assert.ok(route.length > 2, `a real route from ${h.project.id}, not the fallback`);
      // Every hop stays short: the route follows tiles, it never jumps over the outskirts.
      let prev = from;
      for (const p of route.slice(0, -1)) {
        assert.ok(Math.hypot(p[0] - prev[0], p[1] - prev[1]) < TILE * 2.5, `jump ${prev} -> ${p}`);
        prev = p;
      }
    }
  // And between districts: door to door.
  const doors = Object.values(big.houses).map((h): Point => [h.x, h.y + 4]);
  for (const a of doors.filter((_, i) => i % 4 === 0))
    for (const b of doors.filter((_, i) => i % 5 === 1)) assert.ok(findPath(big, a, b).length > 1);
});
