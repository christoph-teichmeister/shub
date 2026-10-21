<script lang="ts">
  // Crab village (#/village): every session as a crab on a map of the groups and projects. Crabs walk to the spot
  // their status gives them (crabs.ts) on a 140 ms step; the map itself is laid out once per set of projects
  // (world.ts).
  import { onMount, tick, untrack } from 'svelte';
  import type { Session, SessionStatus } from '../../../../../shared/api.ts';
  import { commandTarget } from '../../../../../shared/commands.ts';
  import { api } from '../../stores/api.ts';
  import { villageBack } from '../../stores/router.svelte.ts';
  import { app, compact, sendKeys, sessionHref } from '../../stores/state.svelte.ts';
  import { toastError } from '../../stores/toasts.svelte.ts';
  import { contextFill, STATUS_LABEL } from '../../status.ts';
  import {
    asleep,
    backpack,
    crabSessions,
    crabSpots,
    moodOf,
    queueOrder,
    walkQueue,
    type CrabSpot,
    type Mood,
  } from '../../village/crabs.ts';
  import { CHEER_STEPS, cheerFrame, isDark, timeOfDay, TIMES, type TimeOfDay } from '../../village/ambience.ts';
  import { clampPan, clampZoom, fitWorld, minZoom, zoomAt, type Pan } from '../../village/camera.ts';
  import { findPath, goalKey } from '../../village/path.ts';
  import { autotiles, LAYERS, TILE } from '../../village/tiles.ts';
  import { advance, blocked, direction, inReach, SPEED, standSpot } from '../../village/walk.ts';
  import { buildWorld, type Point, type VillageProject } from '../../village/world.ts';
  import Ambience from './Ambience.svelte';
  import Crab, { type Bubble } from './Crab.svelte';
  import CrabCard, { type CardAction } from './CrabCard.svelte';
  import House from './House.svelte';
  import NewProject from './NewProject.svelte';
  import NewSession from './NewSession.svelte';
  import Yard from './Yard.svelte';

  const STEP_MS = 140;
  const WALK = 8; // px per step

  let activeOnly = $state(false);
  let only = $state<string | null>(null);
  /** The camera: the world sits at translate(pan) scale(zoom) in the clipped viewport. Fitted follows the window. */
  let zoom = $state(1);
  let pan = $state<Pan>({ x: 0, y: 0 });
  let fitted = $state(true);
  /** The camera follows you while you walk; dragging the map lets go, walking takes it up again. */
  let following = $state(false);
  let vw = $state(0);
  let vh = $state(0);
  let hovered = $state<string | null>(null);
  /** The crab whose card stays open with its actions (click, arrow keys). */
  let pinned = $state<string | null>(null);
  /** Project of the open new-session popover. */
  let pop = $state<string | null>(null);
  /** The new project dialog, with the district of the lot it came from. */
  let building = $state<{ group: string | null } | null>(null);
  let viewport = $state<HTMLElement>();
  let t = $state(0);
  /** The clock, moved on every step (every 30 s with reduced motion): time in line, time of day, confetti. */
  let now = $state(Date.now());
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

  // ---------- chime ----------
  // Off by default; the AudioContext is made on the toggle, since audio needs a user gesture.
  const CHIME_KEY = 'shub-village-chime';
  let chime = $state(false);
  try {
    chime = localStorage.getItem(CHIME_KEY) === '1';
  } catch {}
  let audio: AudioContext | null = null;
  function beep() {
    try {
      audio ??= new AudioContext();
      void audio.resume();
      [660, 880].forEach((f, i) => {
        const o = audio!.createOscillator();
        const g = audio!.createGain();
        o.type = 'square';
        o.frequency.value = f;
        g.gain.value = 0.035;
        o.connect(g).connect(audio!.destination);
        const at = audio!.currentTime + i * 0.11;
        o.start(at);
        o.stop(at + 0.09);
      });
    } catch {
      // No audio here: the chime stays silent.
    }
  }
  function toggleChime() {
    chime = !chime;
    try {
      localStorage.setItem(CHIME_KEY, chime ? '1' : '0');
    } catch {}
    if (chime) beep();
  }
  // A crab joining the line chimes; the line the village opens with does not.
  let seen: Set<string> | null = null;
  $effect(() => {
    if (seen && chime && queue.some((id) => !seen!.has(id))) beep();
    if (app.ready) seen = new Set(queue);
  });

  // ---------- time of day ----------
  // "Now" follows the clock; a pinned time stays in localStorage.
  const TIME_KEY = 'shub-village-time';
  let pinnedTime = $state<TimeOfDay | null>(null);
  try {
    const v = localStorage.getItem(TIME_KEY);
    pinnedTime = TIMES.find((x) => x === v) ?? null;
  } catch {}
  function setTime(v: TimeOfDay | null) {
    pinnedTime = v;
    try {
      if (v) localStorage.setItem(TIME_KEY, v);
      else localStorage.removeItem(TIME_KEY);
    } catch {}
  }
  const clockTime = $derived(timeOfDay(new Date(now).getHours()));
  const tod = $derived(pinnedTime ?? clockTime);
  const dark = $derived(isDark(tod));
  const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

  // ---------- walking ----------
  type Pos = { x: number; y: number; dir: number; moving: boolean };
  let pos = $state<Record<string, Pos>>({});
  /** Route per crab: the waypoints still to walk, the goal tile they were made for. */
  const routes = new Map<string, { goal: number; world: unknown; pts: Point[] }>();
  const at = (c: CrabSpot<Session>): Pos => (!still && pos[c.session.id]) || { x: c.x, y: c.y, dir: 1, moving: false };

  function step() {
    if (document.hidden) return;
    // Crabs there on the first step stand at their spot; later ones come out of their house's door.
    const fresh = t > 0;
    t++;
    now = Date.now();
    for (const c of spots) {
      const p = pos[c.session.id];
      if (!p) {
        const door = fresh && c.house;
        pos[c.session.id] = door
          ? { x: c.house!.x, y: c.house!.y + 4, dir: 1, moving: true }
          : { x: c.x, y: c.y, dir: 1, moving: false };
        continue;
      }
      // Follow the route along paths and through gates; it is made again when the target moves to another tile.
      const goal = goalKey(world, c.x, c.y);
      let r = routes.get(c.session.id);
      if (!r || r.goal !== goal || r.world !== world) {
        r = { goal, world, pts: findPath(world, [p.x, p.y], [c.x, c.y]) };
        routes.set(c.session.id, r);
      }
      let left = WALK;
      while (left > 0 && r.pts.length) {
        const dx = r.pts[0][0] - p.x;
        const dy = r.pts[0][1] - p.y;
        const d = Math.hypot(dx, dy);
        if (Math.abs(dx) > 1) p.dir = dx < 0 ? -1 : 1;
        if (d <= left) {
          [p.x, p.y] = r.pts.shift()!;
          left -= d;
        } else {
          p.x += (dx / d) * left;
          p.y += (dy / d) * left;
          left = 0;
        }
      }
      p.moving = Math.hypot(c.x - p.x, c.y - p.y) > 3;
    }
  }
  onMount(() => {
    // Still: no walking, but the minutes in line and the time of day move on.
    const timer = still ? setInterval(() => (now = Date.now()), 30_000) : setInterval(step, STEP_MS);
    viewport?.focus({ preventScroll: true });
    // You walk on your own frame loop (smooth); a hidden tab does not get frames.
    let raf = 0;
    let last = 0;
    const frame = (ts: number) => {
      raf = requestAnimationFrame(frame);
      const dt = last ? Math.min(ts - last, 250) : 0;
      last = ts;
      const [vx, vy] = direction(held.has('left'), held.has('right'), held.has('up'), held.has('down'));
      if (vx || vy) go(vx, vy, (SPEED * dt) / 1000);
      else me.moving = false;
      follow(dt);
    };
    if (!still) raf = requestAnimationFrame(frame);
    const blur = () => held.clear();
    addEventListener('blur', blur);
    return () => {
      clearInterval(timer);
      cancelAnimationFrame(raf);
      removeEventListener('blur', blur);
    };
  });

  // ---------- you ----------
  // You start seated at your desk; WASD stands you up and walks you (walk.ts keeps you out of walls and fences).
  let seated = $state(true);
  let me = $state({
    x: untrack(() => world.you.x),
    y: untrack(() => world.you.y),
    dir: 1,
    /** Distance walked, for the walk frames. */
    dist: 0,
    moving: false,
  });
  const held = new Set<string>();
  const HELD: Record<string, string> = {
    a: 'left',
    d: 'right',
    w: 'up',
    s: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right',
    ArrowUp: 'up',
    ArrowDown: 'down',
  };
  function go(vx: number, vy: number, dist: number) {
    if (seated) {
      seated = false;
      [me.x, me.y] = standSpot(world);
    }
    const r = advance(world, me.x, me.y, vx, vy, dist);
    me.x = r.x;
    me.y = r.y;
    me.dist += r.moved;
    me.moving = r.moved > 0;
    if (vx) me.dir = vx < 0 ? -1 : 1;
    following = true;
    fitted = false;
  }
  /** The camera glides to you (at once with reduced motion), kept inside the pan clamp. */
  function follow(dt: number) {
    if (!following || !vw) return;
    const goal = clampPan({ x: vw / 2 - me.x * zoom, y: vh / 2 - me.y * zoom }, zoom, world, vw, vh);
    const k = still ? 1 : 1 - Math.exp(-dt / 120);
    const [dx, dy] = [goal.x - pan.x, goal.y - pan.y];
    if (Math.abs(dx) < 0.3 && Math.abs(dy) < 0.3) {
      if (dx || dy) pan = goal;
      return;
    }
    pan = { x: pan.x + dx * k, y: pan.y + dy * k };
  }
  /** What E would do now: talk to the nearest crab in reach, or sit at your desk. Nothing while seated. */
  const target = $derived(
    seated
      ? null
      : inReach(
          world,
          me,
          spots.map((c) => ({ id: c.session.id, ...at(c) })),
        ),
  );
  function sit() {
    seated = true;
    held.clear();
    me.moving = false;
    [me.x, me.y] = [world.you.x, world.you.y];
  }
  function interact() {
    if (target?.kind === 'crab') void pin(target.id);
    else if (target?.kind === 'desk') sit();
  }
  // A new map (a project came or went) keeps you where you stand unless that is now inside something.
  $effect(() => {
    const w = world;
    untrack(() => {
      if (!seated && !blocked(w, me.x, me.y)) return;
      seated = true;
      [me.x, me.y] = [w.you.x, w.you.y];
    });
  });

  // ---------- what each crab shows ----------
  const projectById = $derived(new Map(app.projects.map((p) => [p.id, p])));
  const workingIn = $derived(new Set(sessions.filter((s) => s.status === 'working').map((s) => s.projectId)));
  /** After dark: a glow on every lit window and on your desk lamp. */
  const lights = $derived<Point[]>(
    dark
      ? [
          ...Object.values(world.houses)
            .filter((h) => h.active)
            .map((h): Point => [h.x, h.y - 30]),
          [world.you.x + 36, world.you.y - 60],
        ]
      : [],
  );
  const dim = (group: string | undefined) => (only && group !== only ? 0.3 : 1);

  /** Minutes since the status changed: how long a queued crab has been in line. */
  const waited = (s: Session) => Math.max(0, Math.floor((now - Date.parse(s.statusSince)) / 60_000));
  /** A queued crab turns to you and waves while you stand this close. */
  const GREET = 150;
  const greets = (c: CrabSpot<Session>, p: Pos) =>
    !seated && c.queuePos >= 0 && !p.moving && Math.hypot(me.x - p.x, me.y - p.y) < GREET;
  const moodFor = (c: CrabSpot<Session>, p: Pos): Mood | null =>
    c.queuePos < 0 || p.moving ? null : greets(c, p) ? 'wave' : moodOf(waited(c.session));

  function body(c: CrabSpot<Session>, p: Pos, i: number, mood: Mood | null): string {
    if (p.moving) return `crab-walk${t % 2}`;
    // Waving claws: the work frames, faster when angry.
    if (mood === 'wave') return `crab-work${Math.floor(t / 3) % 2}`;
    if (c.pose === 'work' || mood === 'angry') return `crab-work${Math.floor(t / 2) % 2}`;
    if (c.pose === 'sleep') return 'crab-sleep0';
    return (t + i * 7) % 26 === 0 ? 'crab-blink0' : 'crab-idle0';
  }

  function bubble(status: SessionStatus, mood: Mood | null): Bubble | null {
    const zz = Math.floor(t / 5) % 2 ? 'zZ' : 'z';
    if (mood === 'angry') return { text: '!!', tone: 'angry' };
    if (status === 'needs-you') return { text: '!', tone: 'needs-you' };
    if (status === 'your-turn') return { text: '...', tone: 'your-turn' };
    if (status === 'waiting') return { text: zz, tone: 'waiting' };
    if (asleep(status)) return { text: zz, tone: 'paused' };
    return null;
  }

  /** A hop and confetti for a turn that just ended (big for a merged worktree); none with reduced motion. */
  function cheer(id: string) {
    const c = still ? undefined : app.cheers[id];
    const n = c ? Math.floor((now - c.at) / STEP_MS) : -1;
    return c && n >= 0 && n < CHEER_STEPS ? cheerFrame(n, c.big) : null;
  }

  function lift(mood: Mood | null, i: number): number {
    if (mood === 'tap') return t % 3 === 0 ? -2 : 0;
    if (mood === 'angry') return t % 6 < 2 ? -6 : 0;
    if (mood === 'calm') return -Math.round(Math.abs(Math.sin(t * 0.25 + i)) * 2);
    return 0;
  }

  // ---------- tents and machines ----------
  const worktreesOf = $derived(Map.groupBy(app.children, (w) => w.projectId));
  /** Whose services a house's machines show: its first Claude session (services are per project folder). */
  const servicesFrom = $derived(
    new Map(
      sessions
        .filter((s) => s.kind === 'claude' && s.projectId)
        .reverse()
        .map((s) => [s.projectId!, s.id]),
    ),
  );

  const label = (c: CrabSpot<Session>) =>
    `${c.session.name}, ${c.house?.project.name ?? 'global Claude'}, ${STATUS_LABEL[c.session.status]}` +
    (c.queuePos >= 0 ? `, number ${c.queuePos + 1} in line` : '');

  // ---------- camera, card ----------
  function fit() {
    ({ zoom, pan } = fitWorld(world, vw, vh));
    fitted = true;
    following = false;
  }
  /** The zoom at which the world just covers the window: no further out, so no bare bar shows. */
  const minZ = $derived(vw && vh ? minZoom(world, vw, vh) : 0.1);
  /** Zoom around a screen point of the viewport (its centre for the buttons). */
  function zoomTo(next: number, cx = vw / 2, cy = vh / 2) {
    const r = zoomAt(pan, zoom, next, cx, cy, minZ);
    zoom = r.zoom;
    pan = clampPan(r.pan, zoom, world, vw, vh);
    fitted = false;
  }
  const nudge = (d: number) => zoomTo(Math.round((zoom + d) * 10) / 10);
  // Fitted follows the window and the map; a free camera only keeps the map covering the window.
  $effect(() => {
    if (!vw || !vh) return;
    if (fitted) untrack(fit);
    else {
      const z = clampZoom(
        untrack(() => zoom),
        minZ,
      );
      zoom = z;
      pan = clampPan(
        untrack(() => pan),
        z,
        world,
        vw,
        vh,
      );
    }
  });

  // ---------- culling ----------
  // Only what lies in the camera rect plus a margin is rendered (crabs, decoration, ambience). The rect snaps outwards
  // to a coarse grid, so panning only changes what is drawn once in a while, not on every pointer move.
  const CULL = 256;
  const MARGIN = 192;
  const vx0 = $derived(Math.floor((-pan.x / zoom - MARGIN) / CULL) * CULL);
  const vy0 = $derived(Math.floor((-pan.y / zoom - MARGIN) / CULL) * CULL);
  const vx1 = $derived(Math.ceil(((vw - pan.x) / zoom + MARGIN) / CULL) * CULL);
  const vy1 = $derived(Math.ceil(((vh - pan.y) / zoom + MARGIN) / CULL) * CULL);
  const view = $derived({ x: vx0, y: vy0, w: vx1 - vx0, h: vy1 - vy0 });
  const onScreen = (x: number, y: number) => x >= vx0 && x <= vx1 && y >= vy0 && y <= vy1;
  /** Decoration standing in the view: index and sprite. The far decoration is painted into the ground canvas. */
  const decor = $derived(world.decor.flatMap((d, i) => (!d.far && onScreen(d.x, d.y) ? [{ d, i }] : [])));

  let drag: { id: number; x: number; y: number; px: number; py: number; on: boolean } | null = null;
  let dragged = false;
  function onDown(e: PointerEvent) {
    if (e.button !== 0 || (e.target as Element).closest('input, textarea, select, [data-keep]')) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, px: pan.x, py: pan.y, on: false };
  }
  function onMove(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.on) {
      if (Math.hypot(dx, dy) < 4) return; // still a click
      drag.on = true;
      // Captured only now, so a click on a crab or button keeps its own target.
      viewport?.setPointerCapture(e.pointerId);
    }
    pan = clampPan({ x: drag.px + dx, y: drag.py + dy }, zoom, world, vw, vh);
    fitted = false;
    following = false;
  }
  function onUp() {
    if (drag?.on) {
      dragged = true;
      setTimeout(() => (dragged = false), 0);
    }
    drag = null;
  }
  /** The click that ends a drag is no click. */
  function onClickCapture(e: MouseEvent) {
    if (!dragged) return;
    e.stopPropagation();
    e.preventDefault();
  }
  /** Wheel zoom needs a non-passive listener to keep the page from scrolling. */
  function wheel(node: HTMLElement) {
    const on = (e: WheelEvent) => {
      e.preventDefault();
      const r = node.getBoundingClientRect();
      zoomTo(
        zoom * Math.exp(-e.deltaY * 0.0015),
        e.clientX - r.left - node.clientLeft,
        e.clientY - r.top - node.clientTop,
      );
    };
    node.addEventListener('wheel', on, { passive: false });
    return { destroy: () => node.removeEventListener('wheel', on) };
  }

  /** Where a card or popover hangs for a map point, in viewport px: above it, or below near the top edge. */
  function hang(x: number, y: number, top = 60, under = 10) {
    const sx = x * zoom + pan.x;
    const sy = y * zoom + pan.y;
    const below = sy < 330;
    return {
      x: Math.min(Math.max(sx, 165), Math.max(165, vw - 165)),
      y: below ? sy + under * zoom : sy - top * zoom - 10,
      below,
    };
  }

  const card = $derived.by(() => {
    const c = spots.find((x) => x.session.id === (pinned ?? hovered));
    if (!c) return null;
    const p = at(c);
    return { c, ...hang(p.x, p.y) };
  });
  const popAt = $derived.by(() => {
    const h = pop ? world.houses[pop] : undefined;
    const project = pop ? projectById.get(pop) : undefined;
    return h && project ? { project, ...hang(h.x, h.y, 100, 30) } : null;
  });

  // ---------- acting on a crab ----------
  const open = (s: Session) => (location.hash = sessionHref(s));
  const call = (p: Promise<unknown>) => void p.catch(toastError);
  /** Handed-over commands the session itself can run (CommandChip's Run); the rest need its terminal. */
  const runnable = (s: Session) =>
    (s.pendingCommands ?? []).flatMap((c, index) => {
      const kind = commandTarget(c, app.sessions, s.id).kind;
      return kind === 'self' || kind === 'session' ? [{ index, command: c.command }] : [];
    });
  const run = (s: Session, index: number) =>
    call(api('sessionCommand', { params: { id: s.id }, body: { index, action: 'run' } }));

  function actions(s: Session): CardAction[] {
    const out: CardAction[] = [];
    // The keys the phone sends: 1 yes, 3 no.
    if (s.pendingPermission)
      out.push(
        { label: 'Allow', kbd: 'Y', primary: true, run: () => void sendKeys(s.id, ['1']) },
        { label: 'Deny', kbd: 'N', run: () => void sendKeys(s.id, ['3']) },
      );
    const cmds = runnable(s);
    cmds.forEach(({ index, command }, i) =>
      out.push({
        label: cmds.length > 1 ? `Run ${i + 1}` : 'Run',
        kbd: i === 0 ? 'R' : undefined,
        primary: !s.pendingPermission,
        title: command,
        run: () => run(s, index),
      }),
    );
    if (s.status === 'paused')
      out.push({ label: 'Wake up', primary: true, run: () => call(api('sessionResume', { params: { id: s.id } })) });
    else if (s.waitingFor)
      out.push({
        label: 'Wake up',
        primary: true,
        title: 'Stop waiting',
        run: () => call(api('sessionUpdate', { params: { id: s.id }, body: { waitingFor: null } })),
      });
    if (contextFill(s)?.compact)
      out.push({
        label: 'Compact',
        disabled: s.status !== 'your-turn',
        title: s.status === 'your-turn' ? 'Send /compact' : 'Once it is your turn',
        run: () => compact(s),
      });
    out.push({ label: 'Open', kbd: 'Enter', run: () => open(s) });
    return out;
  }

  async function pin(id: string | null) {
    pinned = id;
    pop = null;
    await tick();
  }

  const WALK_KEYS: Record<string, 1 | -1> = { ArrowDown: 1, ArrowRight: 1, j: 1, ArrowUp: -1, ArrowLeft: -1, k: -1 };

  /** Keyboard triage while the map (or a crab on it) has focus; typing in a popover is left alone. */
  function onMapKey(e: KeyboardEvent) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'Escape') {
      if (!pinned && !pop) return;
      e.preventDefault();
      pinned = pop = null;
      viewport?.focus();
      return;
    }
    const el = e.target as HTMLElement;
    if (el !== viewport && !el.classList.contains('crab')) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    // WASD walks you; the arrows too once you are up (seated, they walk the queue).
    const dir = HELD[k];
    if (dir && (k.length === 1 || !seated)) {
      e.preventDefault();
      held.add(dir);
      if (still && !e.repeat) {
        const [vx, vy] = direction(dir === 'left', dir === 'right', dir === 'up', dir === 'down');
        go(vx, vy, TILE);
        follow(0);
      }
      return;
    }
    if (k === 'e') {
      e.preventDefault();
      interact();
      return;
    }
    const step = WALK_KEYS[k];
    if (step && seated) {
      e.preventDefault();
      const id = walkQueue(queue, pinned, step);
      if (id) void pin(id);
      return;
    }
    // The queue keys are the desk's: they only work while you sit there.
    if (!seated) return;
    const id = pinned ?? (el !== viewport ? hovered : null);
    const s = sessions.find((x) => x.id === id);
    if (!s) return;
    const first = runnable(s)[0];
    if (k === 'Enter') open(s);
    else if (k === 'y' && s.pendingPermission) void sendKeys(s.id, ['1']);
    else if (k === 'n' && s.pendingPermission) void sendKeys(s.id, ['3']);
    else if (k === 'r' && first) run(s, first.index);
    else return;
    e.preventDefault();
  }

  function onMapKeyUp(e: KeyboardEvent) {
    const dir = HELD[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    if (dir) held.delete(dir);
  }

  /** A click on the bare map closes the card and the popover. */
  function onMapClick(e: MouseEvent) {
    if ((e.target as Element).closest('button, a, input, textarea, select, [data-keep]')) return;
    pinned = pop = null;
  }

  // ---------- header ----------
  const ORDER: SessionStatus[] = ['needs-you', 'your-turn', 'working', 'waiting', 'paused', 'new'];
  const counts = $derived(
    ORDER.map((status) => ({ status, n: sessions.filter((s) => s.status === status).length })).filter((c) => c.n),
  );

  // ---------- ground ----------
  // Roads, lane, plaza, forest floor and water as autotiles, plus the far decoration (everything off the roads and away
  // from buildings), drawn once per map into a canvas with one pixel per sprite pixel and scaled up with the map (crisp,
  // no seams, one node; the 140 ms step never touches it). Every sprite is rasterized once into a small canvas first:
  // thousands of drawImage calls from a canvas are cheap, from an SVG each one would rasterize again.
  let ground = $state<HTMLCanvasElement>();
  const bitmaps = new Map<string, Promise<HTMLCanvasElement>>();
  const bitmap = (name: string) => {
    let b = bitmaps.get(name);
    if (!b) {
      b = (async () => {
        const img = new Image();
        img.src = `/village/${name}.svg`;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        c.getContext('2d')?.drawImage(img, 0, 0);
        return c;
      })();
      bitmaps.set(name, b);
    }
    return b;
  };
  $effect(() => {
    const canvas = ground;
    const g = world.ground;
    const far = world.decor.filter((d) => d.far).sort((a, b) => a.y - b.y);
    if (!canvas) return;
    let gone = false;
    void Promise.all([
      Promise.all(LAYERS.map(async (l) => ({ img: await bitmap(l.sprite), tiles: autotiles(g, l.is) }))),
      Promise.all([...new Set(far.map((d) => d.sprite))].map(async (n) => [n, await bitmap(n)] as const)),
    ]).then(([layers, used]) => {
      const ctx = canvas.getContext('2d');
      if (gone || !ctx) return;
      const t0 = performance.now();
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const { img, tiles } of layers)
        for (const { x, y, mask } of tiles)
          ctx.drawImage(img, (mask % 4) * 16, (mask >> 2) * 16, 16, 16, x / 2, y / 2, 16, 16);
      const sprites = new Map(used);
      for (const d of far) {
        const img = sprites.get(d.sprite)!;
        ctx.drawImage(img, Math.round((d.x - d.w / 2) / 2), Math.round((d.y - d.h) / 2), img.width, img.height);
      }
      canvas.dataset.drawMs = String(Math.round(performance.now() - t0));
      canvas.dataset.drawn = '';
    });
    return () => (gone = true);
  });
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
    <div class="row seg" role="group" aria-label="Time of day">
      <button
        type="button"
        class="btn small"
        aria-pressed={pinnedTime === null}
        title="Follow the clock ({clockTime})"
        onclick={() => setTime(null)}>Now</button
      >
      {#each TIMES as d (d)}
        <button type="button" class="btn small" aria-pressed={pinnedTime === d} onclick={() => setTime(d)}
          >{cap(d)}</button
        >
      {/each}
    </div>
    <button type="button" class="btn small" onclick={() => (building = { group: null })}>+ New project</button>
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
    <button
      type="button"
      class="btn small"
      aria-pressed={chime}
      title="A short chime when a crab joins the line"
      onclick={toggleChime}>Chime</button
    >
    <div class="row seg" role="group" aria-label="Zoom">
      <button type="button" class="btn small" aria-pressed={fitted} onclick={fit}>Fit</button>
      <button type="button" class="btn small" aria-label="Zoom out" onclick={() => nudge(-0.1)}>−</button>
      <button type="button" class="btn small" aria-label="Zoom in" onclick={() => nudge(0.1)}>+</button>
    </div>
    <span class="muted">{Math.round(zoom * 100)} %</span>
  </header>

  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <div class="frame">
    <div
      class="viewport"
      bind:this={viewport}
      bind:clientWidth={vw}
      bind:clientHeight={vh}
      use:wheel
      role="region"
      aria-label="Crab village map"
      aria-describedby="village-keys"
      tabindex="0"
      onkeydown={onMapKey}
      onkeyup={onMapKeyUp}
      onfocusout={(e) => !viewport?.contains(e.relatedTarget as Node | null) && held.clear()}
      onclick={onMapClick}
      onclickcapture={onClickCapture}
      onpointerdown={onDown}
      onpointermove={onMove}
      onpointerup={onUp}
      onpointercancel={onUp}
      onscroll={() => viewport?.scrollTo(0, 0)}
    >
      <div
        class="world"
        style:width="{world.W}px"
        style:height="{world.H}px"
        style:transform="translate({pan.x}px, {pan.y}px) scale({zoom})"
      >
        <canvas class="ground" bind:this={ground} width={world.W / 2} height={world.H / 2}></canvas>
        {#each world.districts as d (d.id)}
          <div
            class="zone"
            style:left="{d.x}px"
            style:top="{d.y}px"
            style:width="{d.w}px"
            style:height="{d.h}px"
            style:opacity={dim(d.id)}
          >
            <span class="fence h top" class:gated={d.gate[1] === d.y} style:--gate="{d.gate[0] - d.x + 6}px"></span>
            <span class="fence h bottom" class:gated={d.gate[1] !== d.y} style:--gate="{d.gate[0] - d.x + 6}px"></span>
            <span class="fence v left"></span>
            <span class="fence v right"></span>
            {#each [-1, 1] as side (side)}
              <img
                class="gatepost"
                src="/village/gatepost.svg"
                alt=""
                style:left="{d.gate[0] - d.x + side * TILE}px"
                style:top="{d.gate[1] - d.y}px"
              />
            {/each}
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
        {#each decor as { d, i } (i)}
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
          {@const working = workingIn.has(h.project.id)}
          <House
            house={h}
            {working}
            lit={working || (dark && h.active)}
            {t}
            dim={dim(h.district.id)}
            onplus={() => {
              pinned = null;
              pop = h.project.id;
            }}
          />
          <Yard
            house={h}
            worktrees={worktreesOf.get(h.project.id) ?? []}
            sessionId={servicesFrom.get(h.project.id) ?? null}
            {t}
            dim={dim(h.district.id)}
          />
        {/each}
        {#each world.lots as l (l.district.id)}
          <button
            type="button"
            class="lot"
            style:left="{l.x}px"
            style:top="{l.y}px"
            style:z-index={l.y}
            style:opacity={dim(l.district.id)}
            aria-label="New project in {l.district.id}"
            onclick={() => (building = { group: l.district.id })}>+ New project</button
          >
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
          <img
            src="/village/you-{!seated ? 'desk' : still ? 0 : Math.floor(t / 3) % 2}.svg"
            alt={seated ? 'You, at your desk' : 'Your desk'}
          />
        </div>
        {#if !seated}
          <img
            class="obj me"
            src="/village/you-walk{me.moving && !still ? 1 + (Math.floor(me.dist / 14) % 2) : 0}.svg"
            alt="You"
            style:left="{me.x}px"
            style:top="{me.y}px"
            style:z-index={Math.round(me.y)}
            style:--flip={me.dir}
          />
        {/if}
        {#if target}
          <span
            class="prompt"
            aria-hidden="true"
            style:left="{me.x}px"
            style:top="{me.y - 78}px"
            style:z-index={Math.round(me.y) + 2}><kbd>E</kbd> {target.kind === 'crab' ? 'talk' : 'sit'}</span
          >
        {/if}
        <span
          class="plate yours"
          style:left="{me.x}px"
          style:top="{me.y - (seated ? 96 : 52)}px"
          style:z-index={Math.round(me.y) + 1}>You · {queue.length} in line</span
        >
        {#each spots as c, i (c.session.id)}
          {@const p = at(c)}
          {#if onScreen(p.x, p.y) || pinned === c.session.id}
            {@const outfit = c.district?.outfit ?? 'mayor'}
            {@const mood = moodFor(c, p)}
            {@const bag = c.pose === 'sleep' ? null : backpack(c.session.context?.tokens)}
            {@const party = cheer(c.session.id)}
            <Crab
              x={p.x}
              y={p.y}
              dir={c.pose === 'sleep' ? 1 : greets(c, p) ? (me.x < p.x ? -1 : 1) : p.dir}
              body={body(c, p, i, mood)}
              sleeping={c.pose === 'sleep' && !p.moving}
              {outfit}
              color={c.house?.project.color ?? 'transparent'}
              bubble={bubble(c.session.status, mood)}
              babies={c.pose === 'work' && !p.moving && c.session.status === 'working'
                ? (c.session.agents ?? []).map((_, j) => `crab-walk${(t + j) % 2}`)
                : []}
              pack={bag?.size ?? null}
              sweat={!!bag?.sweat}
              pant={!!bag?.pant}
              lift={party?.hop || lift(mood, i)}
              dust={mood === 'tap'}
              confetti={party?.confetti ?? []}
              {t}
              label={label(c)}
              describedby={hovered === c.session.id ? 'village-card' : undefined}
              dim={dim(c.district?.id)}
              ring={pinned === c.session.id}
              onclick={() => void pin(pinned === c.session.id ? null : c.session.id)}
              ondblclick={() => open(c.session)}
              onenter={() => (hovered = c.session.id)}
              onleave={() => hovered === c.session.id && (hovered = null)}
            />
          {/if}
        {/each}
        <Ambience {world} {tod} {t} {lights} {view} />
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
          waited={waited(card.c.session)}
          x={card.x}
          y={card.y}
          below={card.below}
          actions={pinned === card.c.session.id ? actions(card.c.session) : undefined}
          onclose={() => {
            pinned = null;
            viewport?.focus();
          }}
        />
      {/if}
      {#if popAt}
        {#key popAt.project.id}
          <NewSession
            project={popAt.project}
            x={popAt.x}
            y={popAt.y}
            below={popAt.below}
            onclose={() => (pop = null)}
          />
        {/key}
      {/if}
    </div>
  </div>

  <footer>
    <span><b class="needs-you">!</b> needs you</span>
    <span><b class="your-turn">...</b> your turn</span>
    <span><b class="waiting">zZ</b> waiting · <b class="paused-tag">zZ</b> paused</span>
    <span id="village-keys"
      >Click a crab to pin its card, drag to pan, wheel to zoom. Map keys: <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd
        >D</kbd
      >
      walk · <kbd>E</kbd> talk to a crab, sit at your desk · at your desk: <kbd>↑</kbd><kbd>↓</kbd> queue ·
      <kbd>Enter</kbd> open · <kbd>Y</kbd><kbd>N</kbd> allow, deny · <kbd>R</kbd> run · <kbd>Esc</kbd> close ·
      <kbd>Alt V</kbd> back</span
    >
  </footer>
  {#if building}
    <NewProject group={building.group} onclose={() => (building = null)} />
  {/if}
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

  /* Buttons, keys and form colours of the village, also for the card, the popover and the dialog. */
  .village :global(.btn) {
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

  .village :global(.btn:hover:not(:disabled)) {
    filter: brightness(1.08);
  }

  .village :global(.btn:focus-visible) {
    outline: var(--ring) solid var(--village-gold);
    outline-offset: var(--ring);
  }

  .village :global(.btn[aria-pressed='true']),
  .village :global(.btn.primary) {
    background: var(--village-gold);
  }

  .village :global(.btn:disabled) {
    cursor: default;
    opacity: 0.55;
  }

  .village :global(.btn.small) {
    min-height: var(--size-control-sm);
    padding: 0 var(--space-2-5);
    font-size: var(--text-md);
  }

  .village :global(.btn kbd) {
    border-color: var(--village-wood-dark);
    background: var(--village-paper);
  }

  /* App components (Dialog, TextField, Checkbox) in parchment: they read these. */
  .village :global(.parchment) {
    --panel: var(--village-parchment);
    --raised: var(--village-paper);
    --fg: var(--village-ink);
    --fg-2: var(--village-ink);
    --muted: var(--village-ink-muted);
    --line: var(--village-parchment-line);
    --line-strong: var(--village-parchment-line);
    --primary: var(--village-wood-dark);

    font-family: var(--font-pixel);
  }

  .village :global(.parchment .control) {
    border-width: var(--space-0-5);
    border-radius: var(--radius-xs);
    background: var(--village-paper);
    font-family: var(--font-pixel);
  }

  .village :global(.parchment .control.mono) {
    font-family: var(--font-mono);
  }

  .village :global(.parchment dialog) {
    border: var(--ring) solid var(--village-parchment-line);
    border-radius: var(--radius-xs);
    box-shadow:
      0 0 0 var(--ring) var(--village-ink),
      0 var(--space-3) var(--space-8) var(--shadow);
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

  /* The viewport fills the window; the world moves inside it (pan, zoom), nothing scrolls. */
  .frame {
    display: flex;
    flex: 1 1 0;
    min-height: 0;
  }

  .viewport {
    position: relative;
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    cursor: grab;
    touch-action: none;
    border: var(--space-1-5) solid var(--village-wood-dark);
    border-radius: var(--radius-sm);
    box-shadow: 0 0 0 var(--ring) var(--village-ink);
    background: var(--village-grass);
  }

  .viewport:focus-visible {
    outline: var(--ring) solid var(--village-gold);
  }

  .lot {
    position: absolute;
    transform: translate(-50%, -100%);
    padding: var(--space-3) var(--space-3-5);
    border: var(--space-0-5) dashed var(--village-wood-dark);
    border-radius: var(--radius-xs);
    background: var(--village-grass);
    color: var(--village-parchment);
    font: var(--weight-semibold) var(--text-md) var(--font-pixel);
    text-shadow: 0 var(--ring) 0 var(--village-ink);
    cursor: pointer;
  }

  .lot:hover,
  .lot:focus-visible {
    border-color: var(--village-gold);
    outline: none;
  }

  .world {
    position: absolute;
    top: 0;
    left: 0;
    overflow: hidden;
    transform-origin: 0 0;
    user-select: none;
    background: var(--village-grass) url('/village/tile-grass.svg');
    background-size: calc(var(--village-px) * 32);
    image-rendering: pixelated;
  }

  /* Half the map's size in pixels: one canvas pixel per sprite pixel. */
  .ground {
    position: absolute;
    inset: 0;
    z-index: 1;
    width: 100%;
    height: 100%;
    image-rendering: pixelated;
    pointer-events: none;
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

  .fence.h.gated {
    /* the gate: a two tile gap, --gate px from the fence's left */
    mask-image: linear-gradient(
      90deg,
      var(--village-wood) calc(var(--gate) - 32px),
      transparent 0 calc(var(--gate) + 32px),
      var(--village-wood) 0
    );
  }

  .gatepost {
    position: absolute;
    z-index: 1;
    width: calc(var(--village-px) * 8);
    transform: translate(-50%, -80%);
    image-rendering: pixelated;
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

  .me {
    width: calc(var(--village-px) * 16);
    height: calc(var(--village-px) * 24);
    transform: translate(-50%, -100%) scaleX(var(--flip, 1));
  }

  .prompt {
    position: absolute;
    transform: translate(-50%, -100%);
    padding: var(--space-0-5) var(--space-1-5);
    border: var(--ring) solid var(--village-gold);
    border-radius: var(--radius-xs);
    background: var(--village-ink);
    color: var(--village-parchment);
    font: var(--weight-semibold) var(--text-md) / 1 var(--font-pixel);
    white-space: nowrap;
    pointer-events: none;
  }

  .prompt kbd {
    color: var(--village-gold);
  }

  .world > .plate.yours {
    transform: translate(-50%, -100%);
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

  .village :global(kbd) {
    margin-left: var(--space-1);
    padding: 0 var(--space-1);
    border: var(--ring) solid var(--village-parchment-line);
    border-radius: var(--radius-xs);
    background: var(--village-parchment);
    color: var(--village-ink);
    font: var(--weight-semibold) var(--text-sm) var(--font-pixel);
  }
</style>
