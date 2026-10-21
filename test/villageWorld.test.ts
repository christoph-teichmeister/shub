import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildWorld,
  inRect,
  machineSpot,
  MAX_MACHINES,
  MAX_TENTS,
  SIZES,
  tentSpot,
  type Rect,
  type VillageProject,
  type World,
} from '../web/src/lib/village/world.ts';
import { autotiles, cellAt, COBBLE, cornerMask, DIRT, GRASS, groundAt, TILE } from '../web/src/lib/village/tiles.ts';

const groups = ['Projects', 'private', 'work', 'everyday', 'Extra'];
const counts: Record<string, number> = { Projects: 7, private: 4, work: 6, everyday: 4, Extra: 2 };
const projects: VillageProject[] = Object.entries(counts).flatMap(([group, n]) =>
  Array.from({ length: n }, (_, i) => ({ id: `${group}-${i}`, name: `${group} ${i}`, group, color: '#e6db74' })),
);
const active = new Set(['work-0', 'work-3', 'private-1', 'Projects-6', 'everyday-2']);
const world = (activeOnly = false) => buildWorld({ groups, projects, active, activeOnly });

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const pondRect = (w: World): Rect => ({ x: w.pond.x - 140, y: w.pond.y - 96, w: 280, h: 192 });
/** Every path cell (dirt or cobble) as its rect. */
const pathCells = (w: World) => {
  const out: (Rect & { m: number })[] = [];
  for (let r = 0; r < w.ground.rows; r++)
    for (let c = 0; c < w.ground.cols; c++) {
      const m = cellAt(w.ground, c, r);
      if (m) out.push({ x: c * TILE, y: r * TILE, w: TILE, h: TILE, m });
    }
  return out;
};
const each = (f: (w: World, n: number) => void) => {
  for (let n = 1; n <= groups.length; n++)
    f(
      buildWorld({
        groups: groups.slice(0, n),
        projects: projects.filter((p) => groups.indexOf(p.group) < n),
        active,
        activeOnly: false,
      }),
      n,
    );
};

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
    const areas = [...w.districts, w.plaza, pondRect(w)];
    areas.forEach((a, i) =>
      areas.slice(i + 1).forEach((b) => assert.ok(!overlaps(a, b), `${JSON.stringify(a)} ${JSON.stringify(b)}`)),
    );
    for (const a of areas) assert.ok(a.x >= 0 && a.y >= 0 && a.x + a.w <= w.W && a.y + a.h <= w.H);
  }
});

test('the corner mask numbers all 16 variants: NW 1, NE 2, SW 4, SE 8', () => {
  const seen = new Set<number>();
  for (let i = 0; i < 16; i++) {
    const m = cornerMask(!!(i & 1), !!(i & 2), !!(i & 4), !!(i & 8));
    assert.equal(m, i);
    seen.add(m);
  }
  assert.equal(seen.size, 16);
  // One cell: four tiles round it, each with the cell in the opposite corner.
  const g = { cols: 3, rows: 3, cells: new Uint8Array([0, 0, 0, 0, 1, 0, 0, 0, 0]) };
  assert.deepEqual(
    autotiles(g, (m) => m === DIRT),
    [
      { x: 16, y: 16, mask: 8 },
      { x: 48, y: 16, mask: 4 },
      { x: 16, y: 48, mask: 2 },
      { x: 48, y: 48, mask: 1 },
    ],
  );
});

test('everything lines up on the tile grid', () => {
  each((w) => {
    assert.equal(w.W % TILE, 0);
    assert.equal(w.H % TILE, 0);
    assert.equal(w.ground.cells.length, (w.W / TILE) * (w.H / TILE));
    for (const r of [...w.districts, w.plaza]) for (const v of [r.x, r.y, r.w, r.h]) assert.equal(v % TILE, 0);
  });
});

test('every gate reaches the plaza along path cells; the queue stands on the cobbled lane', () => {
  each((w, n) => {
    const g = w.ground;
    const start = Math.floor((w.plaza.y + TILE) / TILE) * g.cols + Math.floor((w.plaza.x + w.plaza.w / 2) / TILE);
    assert.equal(g.cells[start], COBBLE);
    const seen = new Set([start]);
    const todo = [start];
    while (todo.length) {
      const i = todo.pop()!;
      const [c, r] = [i % g.cols, Math.floor(i / g.cols)];
      for (const [dc, dr] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ])
        if (cellAt(g, c + dc, r + dr) && !seen.has(i + dc + dr * g.cols)) {
          seen.add(i + dc + dr * g.cols);
          todo.push(i + dc + dr * g.cols);
        }
    }
    assert.equal(seen.size, pathCells(w).length, `${n} groups: every path cell is connected`);
    // A gate: the path cell just outside the middle of the fence that faces the road.
    for (const d of w.districts) {
      const c = Math.round((d.x + d.w / 2) / TILE);
      const below = d.y + d.h < w.plaza.y - 8 * TILE;
      const r = below ? (d.y + d.h) / TILE : d.y / TILE - 1;
      assert.ok(seen.has(r * g.cols + c) && seen.has(r * g.cols + c - 1), `${n} groups: gate of ${d.id}`);
    }
    for (const [x, y] of w.slots) assert.equal(groundAt(g, x, y), COBBLE, `slot ${x},${y}`);
  });
});

test('paths keep out of districts, the pond, houses, the town hall and your desk; decoration stays off them', () => {
  each((w, n) => {
    const hall: Rect = { x: w.hall.x - 66, y: w.hall.y - 124, w: 132, h: 124 };
    const desk: Rect = { x: w.you.x - 56, y: w.you.y - 92, w: 112, h: 92 };
    for (const p of pathCells(w)) {
      const at = `${n} groups: tile ${p.x / TILE},${p.y / TILE}`;
      for (const d of w.districts) assert.ok(!overlaps(p, d), `${at} in ${d.id}`);
      assert.ok(!overlaps(p, pondRect(w)), `${at} in the pond`);
      if (p.m === DIRT) for (const r of [hall, desk]) assert.ok(!overlaps(p, r), `${at} under the hall or desk`);
      if (p.m === COBBLE) assert.ok(overlaps(p, w.plaza) || !overlaps(p, hall), `${at}: lane under the hall`);
    }
    for (const d of w.decor) {
      assert.equal(groundAt(w.ground, d.x, d.y), GRASS, `${d.sprite} on a path`);
      for (const z of w.districts) assert.ok(!inRect(d.x, d.y, z), `${d.sprite} in ${z.id}`);
    }
  });
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

test('lantern posts stand beside the paths, off houses, districts, the pond and the decoration', () => {
  each((w, n) => {
    assert.ok(w.lanterns.length >= 4, `${n} groups: ${w.lanterns.length} lanterns`);
    for (const [x, y] of w.lanterns) {
      assert.ok(x > 0 && x < w.W && y - SIZES.lantern[1] > 0 && y < w.H, `${x},${y} off the map`);
      for (const [dx, dy] of [
        [-8, 0],
        [8, 0],
        [0, -8],
        [0, 8],
      ])
        assert.equal(groundAt(w.ground, x + dx, y + dy), GRASS, `${x},${y} on a path`);
      for (const d of w.districts)
        assert.ok(!inRect(x, y, d, 10) && !inRect(x, y - SIZES.lantern[1], d, 10), `${x},${y} in ${d.id}`);
      assert.ok(!inRect(x, y, pondRect(w)), `${x},${y} in the pond`);
      for (const d of w.decor) assert.ok(Math.hypot(d.x - x, d.y - y) >= 50, `${d.sprite} on a lantern`);
    }
  });
  assert.deepEqual(world().lanterns, world().lanterns);
});

test('the "+ New project" lot keeps clear of the houses, tents and machines of its district', () => {
  // Every number of houses per district, so the lot lands in every column, after houses jittered either way.
  for (let n = 1; n <= 9; n++) {
    const ps = Array.from({ length: n }, (_, i) => ({ id: `lot-${n}-${i}`, name: `p${i}`, group: 'g', color: '#fff' }));
    const w = buildWorld({ groups: ['g'], projects: ps, active: new Set(ps.map((p) => p.id)), activeOnly: false });
    const [l] = w.lots;
    const lot = { x: l.x - SIZES.lot[0] / 2, y: l.y - SIZES.lot[1], w: SIZES.lot[0], h: SIZES.lot[1] };
    const d = l.district;
    assert.ok(
      lot.x >= d.x && lot.x + lot.w <= d.x + d.w && lot.y + lot.h <= d.y + d.h,
      `${n}: lot leaves the district`,
    );
    const box = (x: number, y: number, bw: number, bh: number): Rect => ({ x: x - bw / 2, y: y - bh, w: bw, h: bh });
    for (const h of Object.values(w.houses)) {
      const things = [
        box(h.x, h.y, ...SIZES.house),
        ...Array.from({ length: MAX_TENTS }, (_, i) => tentSpot(h, i)).map((p) => box(p.x, p.y, ...SIZES.tent)),
        ...Array.from({ length: MAX_MACHINES }, (_, i) => machineSpot(h, i)).map((p) =>
          box(p.x, p.y, ...SIZES.machine),
        ),
      ];
      for (const r of things) assert.ok(!overlaps(lot, r), `${n} houses: lot on ${h.project.id} ${JSON.stringify(r)}`);
    }
  }
});

test('queue crabs stand apart and clear of your name plate', () => {
  for (const activeOnly of [false, true]) {
    const w = world(activeOnly);
    assert.ok(w.you.y - w.slots[0][1] >= 140, 'first slot is clear of the plate');
    for (let i = 1; i < w.slots.length; i++) assert.ok(w.slots[i - 1][1] - w.slots[i][1] >= 52, `slot ${i} spacing`);
  }
});
