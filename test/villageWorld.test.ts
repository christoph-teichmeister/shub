import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildWorld,
  inRect,
  machineSpot,
  MAX_MACHINES,
  MAX_TENTS,
  tentSpot,
  type Point,
  type Rect,
  type VillageProject,
  type World,
} from '../web/src/lib/village/world.ts';

const groups = ['Projects', 'private', 'work', 'everyday', 'Extra'];
const counts: Record<string, number> = { Projects: 7, private: 4, work: 6, everyday: 4, Extra: 2 };
const projects: VillageProject[] = Object.entries(counts).flatMap(([group, n]) =>
  Array.from({ length: n }, (_, i) => ({ id: `${group}-${i}`, name: `${group} ${i}`, group, color: '#e6db74' })),
);
const active = new Set(['work-0', 'work-3', 'private-1', 'Projects-6', 'everyday-2']);
const world = (activeOnly = false) => buildWorld({ groups, projects, active, activeOnly });

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const plazaRect = (w: World): Rect => ({
  x: w.plaza.x - w.plaza.w / 2,
  y: w.plaza.y - w.plaza.h / 2,
  w: w.plaza.w,
  h: w.plaza.h,
});
const pondRect = (w: World): Rect => ({ x: w.pond.x - 140, y: w.pond.y - 96, w: 280, h: 192 });
/** Points every 8 px along a path. */
const samples = (pts: Point[]) =>
  pts.slice(1).flatMap((b, i) => {
    const a = pts[i];
    const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 8);
    return Array.from({ length: n + 1 }, (_, j): Point => [
      a[0] + ((b[0] - a[0]) * j) / n,
      a[1] + ((b[1] - a[1]) * j) / n,
    ]);
  });

test('districts, plaza and pond do not overlap, with one to five groups', () => {
  assert.equal(world().districts.length, 5);
  for (let n = 1; n <= groups.length; n++) {
    const w = buildWorld({
      groups: groups.slice(0, n),
      projects: projects.filter((p) => groups.indexOf(p.group) < n),
      active,
      activeOnly: false,
    });
    assert.equal(w.districts.length, n);
    const areas = [...w.districts, plazaRect(w), pondRect(w)];
    areas.forEach((a, i) =>
      areas.slice(i + 1).forEach((b) => assert.ok(!overlaps(a, b), `${JSON.stringify(a)} ${JSON.stringify(b)}`)),
    );
    for (const a of areas) assert.ok(a.x >= 0 && a.y >= 0 && a.x + a.w <= w.W && a.y + a.h <= w.H);
  }
});

test('paths stay out of districts and the pond; decoration stays off paths', () => {
  const w = world();
  for (const p of w.paths)
    for (const [x, y] of samples(p.pts)) {
      // A spur ends on its district's fence, so look a little inside.
      for (const d of w.districts) assert.ok(!inRect(x, y, d, -12), `path in ${d.id} at ${x},${y}`);
      assert.ok(!inRect(x, y, pondRect(w), p.width / 2), `path in the pond at ${x},${y}`);
    }
  const pts = w.paths.flatMap((p) => samples(p.pts).map((pt) => [pt, p.width / 2] as const));
  for (const d of w.decor) for (const [[x, y], half] of pts) assert.ok(Math.hypot(d.x - x, d.y - y) >= half, d.sprite);
  for (const d of w.decor) for (const z of w.districts) assert.ok(!inRect(d.x, d.y, z), `${d.sprite} in ${z.id}`);
});

test('every project gets a house inside its own district', () => {
  const w = world();
  assert.equal(Object.keys(w.houses).length, projects.length);
  for (const p of projects) {
    const h = w.houses[p.id];
    assert.equal(h.district.id, p.group);
    assert.ok(inRect(h.x, h.y, h.district), p.id);
    assert.ok(inRect(h.x - 48, h.y - 92, h.district) && inRect(h.x + 48, h.y, h.district), `${p.id} sprite`);
    assert.ok(inRect(h.desk.x, h.desk.y, h.district, -8), `${p.id} desk`);
    assert.equal(h.active, active.has(p.id));
  }
  // Houses of one district keep apart.
  const list = Object.values(w.houses);
  list.forEach((a, i) => list.slice(i + 1).forEach((b) => assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > 90)));
});

test('the layout is deterministic and hats follow the group names', () => {
  assert.deepEqual(world(), world());
  const outfits = Object.fromEntries(world().districts.map((d) => [d.id, d.outfit]));
  assert.deepEqual(outfits, {
    Projects: 'projects',
    private: 'private',
    work: 'work',
    everyday: 'everyday',
    Extra: 'work',
  });
});

test('Active only keeps the projects with a session and shrinks the map', () => {
  const all = world();
  const only = world(true);
  assert.deepEqual(Object.keys(only.houses).sort(), [...active].sort());
  assert.ok(only.W * only.H < all.W * all.H);
  assert.ok(!only.districts.some((d) => d.id === 'Extra'));
});

test('tents and machines stay inside their district and off every other house', () => {
  const w = world();
  const list = Object.values(w.houses);
  const box = (x: number, y: number, bw: number, bh: number): Rect => ({ x: x - bw / 2, y: y - bh, w: bw, h: bh });
  for (const h of list) {
    const things = [
      ...Array.from({ length: MAX_TENTS }, (_, i) => tentSpot(h, i)).map((p) => box(p.x, p.y, 56, 44)),
      ...Array.from({ length: MAX_MACHINES }, (_, i) => machineSpot(h, i)).map((p) => box(p.x, p.y, 36, 36)),
    ];
    for (const r of things) {
      const d = h.district;
      assert.ok(r.x >= d.x && r.y >= d.y && r.x + r.w <= d.x + d.w && r.y + r.h <= d.y + d.h, h.project.id);
      for (const o of list)
        if (o !== h) assert.ok(!overlaps(r, box(o.x, o.y, 96, 92)), `${h.project.id} on ${o.project.id}`);
    }
  }
});
