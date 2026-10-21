<script lang="ts">
  // Crab village (#/village): every session as a crab on a map of the groups and projects. Crabs walk to the spot
  // their status gives them (crabs.ts) on a 140 ms step; the map itself is laid out once per set of projects
  // (world.ts).
  import { onMount, untrack } from 'svelte';
  import type { Session, SessionStatus } from '../../../../../shared/api.ts';
  import { villageBack } from '../../stores/router.svelte.ts';
  import { app, sessionHref } from '../../stores/state.svelte.ts';
  import { STATUS_LABEL } from '../../status.ts';
  import { asleep, crabSessions, crabSpots, queueOrder, type CrabSpot } from '../../village/crabs.ts';
  import { buildWorld, type VillageProject } from '../../village/world.ts';
  import Crab, { type Bubble } from './Crab.svelte';
  import CrabCard from './CrabCard.svelte';
  import House from './House.svelte';

  const STEP_MS = 140;
  const WALK = 8; // px per step

  let activeOnly = $state(false);
  let only = $state<string | null>(null);
  /** null: fit the map to the window. */
  let zoomSet = $state<number | null>(null);
  let viewportWidth = $state(0);
  let hovered = $state<string | null>(null);
  let t = $state(0);
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const sessions = $derived(crabSessions(app.sessions));
  const projects = $derived<VillageProject[]>(
    app.projects
      // Dormant projects only while they have a session, like the sidebar.
      .filter((p) => p.visibility === 'pinned' || sessions.some((s) => s.projectId === p.id))
      .sort((a, b) => a.order - b.order)
      .map((p) => ({ id: p.id, name: p.name, group: p.group, color: p.accent })),
  );
  const active = $derived(new Set(sessions.flatMap((s) => (s.projectId ? [s.projectId] : []))));
  // The map only changes with the projects shown and which of them have a session, not on every status change.
  const worldKey = $derived(
    JSON.stringify([
      app.config?.groups,
      projects,
      activeOnly,
      projects.filter((p) => active.has(p.id)).map((p) => p.id),
    ]),
  );
  const world = $derived.by(() => {
    void worldKey;
    return untrack(() => buildWorld({ groups: app.config?.groups ?? [], projects, active, activeOnly }));
  });

  // Join order of the queue survives between updates; queueOrder hands back the new one.
  let joined: Record<string, number> = {};
  const queue = $derived.by(() => {
    const q = queueOrder(sessions, joined);
    joined = q.joined;
    return q.order;
  });
  const spots = $derived(crabSpots(world, sessions, queue, t));

  // ---------- walking ----------
  type Pos = { x: number; y: number; dir: number; moving: boolean };
  let pos = $state<Record<string, Pos>>({});
  const at = (c: CrabSpot<Session>): Pos => (!still && pos[c.session.id]) || { x: c.x, y: c.y, dir: 1, moving: false };

  function step() {
    if (document.hidden) return;
    t++;
    for (const c of spots) {
      const p = pos[c.session.id];
      if (!p) {
        pos[c.session.id] = { x: c.x, y: c.y, dir: 1, moving: false };
        continue;
      }
      const dx = c.x - p.x;
      const dy = c.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d > 0.5) {
        const s = Math.min(d, WALK);
        p.x += (dx / d) * s;
        p.y += (dy / d) * s;
      }
      if (Math.abs(dx) > 1) p.dir = dx < 0 ? -1 : 1;
      p.moving = d > 3;
    }
  }
  onMount(() => {
    if (still) return;
    const timer = setInterval(step, STEP_MS);
    return () => clearInterval(timer);
  });

  // ---------- what each crab shows ----------
  const projectById = $derived(new Map(app.projects.map((p) => [p.id, p])));
  const dim = (group: string | undefined) => (only && group !== only ? 0.3 : 1);

  function body(c: CrabSpot<Session>, p: Pos, i: number): string {
    if (p.moving) return `crab-walk${t % 2}`;
    if (c.pose === 'work') return `crab-work${Math.floor(t / 2) % 2}`;
    if (c.pose === 'sleep') return 'crab-sleep0';
    return (t + i * 7) % 26 === 0 ? 'crab-blink0' : 'crab-idle0';
  }

  function bubble(status: SessionStatus): Bubble | null {
    const zz = Math.floor(t / 5) % 2 ? 'zZ' : 'z';
    if (status === 'needs-you') return { text: '!', tone: 'needs-you' };
    if (status === 'your-turn') return { text: '...', tone: 'your-turn' };
    if (status === 'waiting') return { text: zz, tone: 'waiting' };
    if (asleep(status)) return { text: zz, tone: 'paused' };
    return null;
  }

  const label = (c: CrabSpot<Session>) =>
    `${c.session.name}, ${c.house?.project.name ?? 'global Claude'}, ${STATUS_LABEL[c.session.status]}` +
    (c.queuePos >= 0 ? `, number ${c.queuePos + 1} in line` : '');

  // ---------- zoom, card ----------
  const fit = $derived(Math.min(1, Math.max(0.35, (viewportWidth - 6) / world.W)));
  const zoom = $derived(zoomSet ?? fit);
  const setZoom = (z: number) => (zoomSet = Math.min(1.4, Math.max(0.4, Math.round(z * 10) / 10)));

  const card = $derived.by(() => {
    const c = spots.find((x) => x.session.id === hovered);
    if (!c) return null;
    const p = at(c);
    const below = p.y * zoom < 300;
    return {
      c,
      x: Math.min(Math.max(p.x * zoom, 150), world.W * zoom - 150),
      y: below ? p.y * zoom + 10 : (p.y - 60) * zoom - 10,
      below,
    };
  });

  // ---------- header ----------
  const ORDER: SessionStatus[] = ['needs-you', 'your-turn', 'working', 'waiting', 'paused', 'new'];
  const counts = $derived(
    ORDER.map((status) => ({ status, n: sessions.filter((s) => s.status === status).length })).filter((c) => c.n),
  );

  /** Map paths as rotated strips, one per segment, a little longer so the joints overlap. */
  const strips = $derived(
    world.paths.flatMap((p) =>
      p.pts.slice(1).map((b, i) => {
        const a = p.pts[i];
        const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
        const len = Math.hypot(dx, dy) || 1;
        const ext = p.width * 0.55;
        return {
          kind: p.kind,
          h: p.width,
          x: a[0] - (dx / len) * ext,
          y: a[1] - (dy / len) * ext - p.width / 2,
          len: len + ext * 2,
          deg: (Math.atan2(dy, dx) * 180) / Math.PI,
        };
      }),
    ),
  );
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const crabsIn = (id: string) => spots.filter((c) => c.district?.id === id).length;

  function onKeydown(e: KeyboardEvent) {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.code !== 'KeyV') return;
    e.preventDefault();
    e.stopPropagation();
    location.hash = villageBack();
  }
</script>

<svelte:window onkeydowncapture={onKeydown} />

<div class="village">
  <header>
    <a class="btn" href={villageBack()} title="Back to shub (Alt V)">← shub</a>
    <h1>Crab Village</h1>
    <div class="chips">
      {#each counts as c (c.status)}
        <span class="chip"><i class={c.status}></i>{c.n} {STATUS_LABEL[c.status]}</span>
      {/each}
    </div>
    <span class="grow"></span>
    <div class="row" role="group" aria-label="Show district">
      {#each [null, ...world.districts.map((d) => d.id)] as id (id)}
        <button type="button" class="btn small" aria-pressed={only === id} onclick={() => (only = id)}
          >{id ?? 'All'}</button
        >
      {/each}
    </div>
    <button
      type="button"
      class="btn small"
      aria-pressed={activeOnly}
      title="Only projects with a session"
      onclick={() => (activeOnly = !activeOnly)}>Active only</button
    >
    <div class="row seg" role="group" aria-label="Zoom">
      <button type="button" class="btn small" aria-pressed={zoomSet === null} onclick={() => (zoomSet = null)}
        >Fit</button
      >
      <button type="button" class="btn small" aria-label="Zoom out" onclick={() => setZoom(zoom - 0.1)}>−</button>
      <button type="button" class="btn small" aria-label="Zoom in" onclick={() => setZoom(zoom + 0.1)}>+</button>
    </div>
    <span class="muted">{Math.round(zoom * 100)} %</span>
  </header>

  <div class="viewport" bind:clientWidth={viewportWidth} role="region" aria-label="Crab village map">
    <div class="sized" style:width="{world.W * zoom}px" style:height="{world.H * zoom}px">
      <div class="world" style:width="{world.W}px" style:height="{world.H}px" style:transform="scale({zoom})">
        {#each strips as s, i (i)}
          <span
            class="strip {s.kind}"
            style:left="{s.x}px"
            style:top="{s.y}px"
            style:width="{s.len}px"
            style:height="{s.h}px"
            style:transform="rotate({s.deg}deg)"
          ></span>
        {/each}
        <span
          class="plaza"
          style:left="{world.plaza.x}px"
          style:top="{world.plaza.y}px"
          style:width="{world.plaza.w}px"
          style:height="{world.plaza.h}px"
        ></span>
        {#each world.districts as d (d.id)}
          <div
            class="zone"
            style:left="{d.x}px"
            style:top="{d.y}px"
            style:width="{d.w}px"
            style:height="{d.h}px"
            style:opacity={dim(d.id)}
          >
            <span class="fence h top"></span>
            <span class="fence h bottom"></span>
            <span class="fence v left"></span>
            <span class="fence v right"></span>
            <div class="sign">
              <span class="hat">
                <img src="/village/crab-idle0.svg" alt="" />
                <span style:mask-image="url(/village/hat-{d.outfit}-mask.svg)"></span>
                <img src="/village/hat-{d.outfit}-detail.svg" alt="" />
              </span>
              <span>{d.id}</span>
              <small>{d.hatName} · {plural(crabsIn(d.id), 'crab')} · {plural(d.projects.length, 'house')}</small>
            </div>
          </div>
        {/each}
        <img
          class="obj pond"
          src="/village/pond.svg"
          alt=""
          style:left="{world.pond.x}px"
          style:top="{world.pond.y}px"
        />
        {#each world.decor as d, i (i)}
          <img
            class="obj"
            src="/village/{d.sprite}.svg"
            alt=""
            width={d.w}
            height={d.h}
            style:left="{d.x}px"
            style:top="{d.y}px"
            style:z-index={d.y}
          />
        {/each}
        {#each Object.values(world.houses) as h (h.project.id)}
          <House
            house={h}
            working={sessions.some((s) => s.projectId === h.project.id && s.status === 'working')}
            dim={dim(h.district.id)}
          />
        {/each}
        <img
          class="obj hall"
          src="/village/townhall.svg"
          alt="Town hall"
          style:left="{world.hall.x}px"
          style:top="{world.hall.y}px"
          style:z-index={world.hall.y}
        />
        <span class="plate" style:left="{world.hall.x}px" style:top="{world.hall.y}px" style:z-index={world.hall.y}
          >Town hall · global Claude</span
        >
        <div class="obj you" style:left="{world.you.x}px" style:top="{world.you.y}px" style:z-index={world.you.y}>
          <span class="plate">You · {queue.length} in line</span>
          <img src="/village/you-{still ? 0 : Math.floor(t / 3) % 2}.svg" alt="You, at your desk" />
        </div>
        {#each spots as c, i (c.session.id)}
          {@const p = at(c)}
          {@const outfit = c.district?.outfit ?? 'mayor'}
          <Crab
            x={p.x}
            y={p.y}
            dir={c.pose === 'sleep' ? 1 : p.dir}
            body={body(c, p, i)}
            sleeping={c.pose === 'sleep' && !p.moving}
            {outfit}
            color={c.house?.project.color ?? 'transparent'}
            bubble={bubble(c.session.status)}
            babies={c.pose === 'work' && !p.moving && c.session.status === 'working'
              ? (c.session.agents ?? []).map((_, j) => `crab-walk${(t + j) % 2}`)
              : []}
            label={label(c)}
            describedby={hovered === c.session.id ? 'village-card' : undefined}
            dim={dim(c.district?.id)}
            onclick={() => (location.hash = sessionHref(c.session))}
            onenter={() => (hovered = c.session.id)}
            onleave={() => hovered === c.session.id && (hovered = null)}
          />
        {/each}
      </div>
      {#if card}
        {@const project = card.c.session.projectId ? projectById.get(card.c.session.projectId) : undefined}
        <CrabCard
          id="village-card"
          session={card.c.session}
          project={project?.name ?? 'global Claude'}
          group={project?.group ?? 'town hall'}
          color={project?.accent ?? 'transparent'}
          queuePos={card.c.queuePos}
          x={card.x}
          y={card.y}
          below={card.below}
        />
      {/if}
    </div>
  </div>

  <footer>
    <span><b class="needs-you">!</b> needs you</span>
    <span><b class="your-turn">...</b> your turn</span>
    <span><b class="waiting">zZ</b> waiting · <b class="paused-tag">zZ</b> paused</span>
    <span>Hover a crab for its card, click to open the session. <kbd>Alt V</kbd> goes back.</span>
  </footer>
</div>

<style>
  .village {
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: var(--space-2-5);
    padding: var(--space-4);
    background: var(--village-bg);
    color: var(--village-parchment);
    font-family: var(--font-pixel);
  }

  header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2-5) var(--space-3-5);
  }

  h1 {
    margin: 0;
    font-size: calc(var(--text-lg) * 1.6);
    font-weight: var(--weight-semibold);
    text-shadow: 0 var(--space-1) 0 var(--village-ink);
  }

  .chips,
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1-5);
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    padding: var(--space-0-5) var(--space-2);
    border: var(--ring) solid var(--village-parchment-line);
    border-radius: var(--radius-xs);
    background: var(--village-parchment);
    color: var(--village-ink);
    font-size: var(--text-md);
  }

  .chip i {
    width: var(--size-check);
    height: var(--size-check);
    border: var(--ring) solid var(--village-ink);
  }

  .needs-you {
    background: var(--status-needs-you);
  }

  .your-turn {
    background: var(--status-your-turn);
  }

  .working {
    background: var(--status-working);
  }

  .waiting {
    background: var(--village-sky);
  }

  .paused {
    background: var(--village-wood);
  }

  .new {
    background: var(--village-parchment);
  }

  .grow {
    flex: 1 1 auto;
  }

  .muted {
    color: var(--village-wood);
    font-size: var(--text-md);
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    min-height: var(--size-control-lg);
    padding: 0 var(--space-3-5);
    border: var(--space-0-5) solid var(--village-wood-dark);
    border-radius: var(--radius-xs);
    background: var(--village-wood);
    box-shadow: 0 var(--space-0-5) 0 var(--village-ink);
    color: var(--village-ink);
    font: var(--weight-semibold) var(--text-base) var(--font-pixel);
    text-decoration: none;
    cursor: pointer;
  }

  .btn:hover {
    filter: brightness(1.08);
  }

  .btn:focus-visible {
    outline: var(--ring) solid var(--village-gold);
    outline-offset: var(--ring);
  }

  .btn[aria-pressed='true'] {
    background: var(--village-gold);
  }

  .btn.small {
    min-height: var(--size-control-sm);
    padding: 0 var(--space-2-5);
    font-size: var(--text-md);
  }

  .seg {
    gap: 0;
  }

  .seg .btn {
    border-radius: 0;
  }

  .seg .btn:first-child {
    border-radius: var(--radius-xs) 0 0 var(--radius-xs);
  }

  .seg .btn:last-child {
    border-radius: 0 var(--radius-xs) var(--radius-xs) 0;
  }

  .viewport {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    border: var(--space-1-5) solid var(--village-wood-dark);
    border-radius: var(--radius-sm);
    box-shadow: 0 0 0 var(--ring) var(--village-ink);
    background: var(--village-grass);
  }

  .sized {
    position: relative;
  }

  .world {
    position: absolute;
    top: 0;
    left: 0;
    overflow: hidden;
    transform-origin: 0 0;
    background: var(--village-grass) url('/village/tile-grass.svg');
    background-size: calc(var(--village-px) * 32);
    image-rendering: pixelated;
  }

  .strip {
    position: absolute;
    z-index: 1;
    transform-origin: 0 50%;
    border-radius: var(--radius-pill);
    background: var(--village-wood) url('/village/tile-dirt.svg');
    background-size: calc(var(--village-px) * 32);
    box-shadow: inset 0 0 0 var(--ring) var(--village-wood-dark);
  }

  .strip.cobble,
  .plaza {
    z-index: 2;
    background: var(--village-wood) url('/village/tile-cobble.svg');
    background-size: calc(var(--village-px) * 16);
  }

  .plaza {
    position: absolute;
    z-index: 1;
    transform: translate(-50%, -50%);
    border-radius: var(--radius-round);
    box-shadow: inset 0 0 0 var(--space-1) var(--village-wood-dark);
  }

  .zone {
    position: absolute;
    z-index: 2;
    transition: opacity var(--duration-base) var(--ease-standard);
  }

  .fence {
    position: absolute;
    background-repeat: repeat-x;
  }

  .fence.h {
    left: calc(var(--village-px) * -3);
    right: calc(var(--village-px) * -3);
    height: calc(var(--village-px) * 14);
    background-image: url('/village/fence-h.svg');
    background-size: calc(var(--village-px) * 16) 100%;
  }

  .fence.top {
    top: calc(var(--village-px) * -7);
  }

  .fence.bottom {
    bottom: calc(var(--village-px) * -7);
  }

  .fence.v {
    top: 0;
    bottom: 0;
    width: calc(var(--village-px) * 6);
    background-image: url('/village/fence-v.svg');
    background-repeat: repeat-y;
    background-size: 100% calc(var(--village-px) * 16);
  }

  .fence.left {
    left: calc(var(--village-px) * -3);
  }

  .fence.right {
    right: calc(var(--village-px) * -3);
  }

  .sign {
    position: absolute;
    top: var(--space-5);
    left: var(--space-5);
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2-5) var(--space-1) var(--space-1-5);
    border: var(--space-0-5) solid var(--village-wood-dark);
    border-radius: var(--radius-xs);
    background: var(--village-wood);
    box-shadow: 0 var(--space-0-5) 0 var(--village-ink);
    color: var(--village-ink);
    font: var(--weight-semibold) var(--text-lg) var(--font-pixel);
    white-space: nowrap;
  }

  .sign small {
    font-size: var(--text-md);
    font-weight: var(--weight-regular);
  }

  .sign .hat {
    position: relative;
    width: calc(var(--village-px) * 13);
    height: calc(var(--village-px) * 13);
  }

  .sign .hat > * {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }

  .sign .hat span {
    background: var(--village-parchment);
    mask-size: 100% 100%;
  }

  .obj {
    position: absolute;
    transform: translate(-50%, -100%);
    image-rendering: pixelated;
  }

  .pond {
    z-index: 3;
    width: calc(var(--village-px) * 140);
    height: calc(var(--village-px) * 96);
    transform: translate(-50%, -50%);
  }

  .hall {
    width: calc(var(--village-px) * 66);
    height: calc(var(--village-px) * 62);
  }

  .you {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-0-5);
  }

  .you img {
    width: calc(var(--village-px) * 56);
    height: calc(var(--village-px) * 46);
    image-rendering: pixelated;
  }

  .plate {
    padding: var(--space-0-5) var(--space-1-5);
    border: var(--ring) solid var(--village-wood-dark);
    border-radius: var(--radius-xs);
    background: var(--village-parchment);
    color: var(--village-ink);
    font: var(--weight-semibold) var(--text-md) / 1 var(--font-pixel);
    white-space: nowrap;
  }

  .world > .plate {
    position: absolute;
    transform: translate(-50%, var(--space-1));
  }

  footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-4);
    color: var(--village-parchment);
    font-size: var(--text-md);
  }

  footer b {
    padding: 0 var(--space-1);
    border-radius: var(--radius-xs);
    color: var(--village-ink);
  }

  footer .paused-tag {
    background: var(--village-parchment);
  }

  kbd {
    padding: 0 var(--space-1);
    border: var(--ring) solid var(--village-parchment-line);
    border-radius: var(--radius-xs);
    background: var(--village-parchment);
    color: var(--village-ink);
    font: var(--weight-semibold) var(--text-sm) var(--font-pixel);
  }
</style>
