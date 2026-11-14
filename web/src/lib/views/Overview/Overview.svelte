<script lang="ts">
  // Overview (#/overview): the running sessions as live terminals in one grid that fills the screen, so you can work
  // in many at once; paused and not-started ones wait below as small cards. Click a pane to type in it; Alt arrows, Alt 1 to 9, Alt J and Alt Enter move between panes; Alt W closes the focused one; Alt Shift arrows swap it with the pane next to it.
  // Drag a pane's title onto another pane's edge to move it there (middle: swap), drag the bars to resize; the layout is
  // remembered per project until "Reset layout".
  import { untrack } from 'svelte';
  import type { ProjectView, Session } from '../../../../../shared/api.ts';
  import Button from '../../components/Button/Button.svelte';
  import EmptyState from '../../components/EmptyState/EmptyState.svelte';
  import Icon from '../../components/Icon/Icon.svelte';
  import SelectField from '../../components/SelectField/SelectField.svelte';
  import SessionCard from '../../components/SessionCard/SessionCard.svelte';
  import SplitView from '../../components/SplitView/SplitView.svelte';
  import TerminalView from '../../components/TerminalView/TerminalView.svelte';
  import ProjectPicker from './ProjectPicker.svelte';
  import ConfirmDialog, { type Confirm } from '../Main/ConfirmDialog.svelte';
  import {
    capLive,
    gridColumns,
    gridLayout,
    LIVE,
    MAX_LIVE,
    neighbour,
    neighbourByRect,
    overviewSessions,
    parseLayout,
    pruneMinimized,
    reconcile,
    swap,
    type Layout,
  } from '../../overview.ts';
  import { store, storedJson } from '../../stored.ts';
  import { villageBack } from '../../stores/router.svelte.ts';
  import { toast } from '../../stores/toasts.svelte.ts';
  import {
    app,
    childrenOf,
    closeSession,
    needsYouCount,
    sendKeys,
    sessionHref,
    startSession,
    ui,
  } from '../../stores/state.svelte.ts';

  let projectId = $state('');
  let focusId = $state<string | null>(null);
  let maxId = $state<string | null>(null);
  let w = $state(0);
  let h = $state(0);
  const shown = $derived(overviewSessions(app.sessions, projectId || null));
  // Minimized sessions wait in the strip below, remembered in this browser; one that needs you always stays up.
  const KEY = 'shub.overview.minimized';
  const saved = storedJson(KEY);
  let minimized = $state<string[]>(Array.isArray(saved) ? saved.filter((x) => typeof x === 'string') : []);
  const setMinimized = (list: string[]) => store(KEY, JSON.stringify((minimized = list)));
  $effect(() => {
    const kept = pruneMinimized(minimized, app.sessions);
    if (kept !== minimized) setMinimized(kept);
  });
  // Which sessions the grid holds is remembered, not derived from status: a restart turns paused sessions live, and
  // they must not fill the grid. `placed` = ever had a pane (stays until the session is gone or you minimize it),
  // `known` = seen before. A session never seen before (just started) still gets its pane; a known one without a
  // placed mark waits in the strip until "Show", Alt K or Alt N.
  const ids = (key: string) => {
    const v = storedJson(key);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  };
  const PLACED_KEY = 'shub.overview.placed';
  const KNOWN_KEY = 'shub.overview.known';
  let placed = $state(ids(PLACED_KEY));
  let known = $state(ids(KNOWN_KEY));
  const remember = (key: string, list: string[]) => store(key, JSON.stringify(list));
  $effect(() => {
    const p = pruneMinimized(placed, app.sessions);
    if (p !== placed) remember(PLACED_KEY, (placed = p));
    const k = pruneMinimized(known, app.sessions);
    if (k !== known) remember(KNOWN_KEY, (known = k));
  });
  // Past MAX_LIVE the cells are unreadable: the overflow waits in the strip, "Show" promotes one (not remembered).
  let promoted = $state<string[]>([]);
  // A just-started session is 'new' until Claude does something: it only gets a pane once promoted (Alt N, Alt K).
  const wantsLive = (s: Session) =>
    (LIVE.has(s.status) || (s.status === 'new' && promoted.includes(s.id))) &&
    (s.status === 'needs-you' || !minimized.includes(s.id)) &&
    (!known.includes(s.id) || placed.includes(s.id) || promoted.includes(s.id));
  const capped = $derived(capLive(shown.filter(wantsLive), MAX_LIVE, promoted));
  const live = $derived(capped.live);
  const quiet = $derived(shown.filter((s) => !live.includes(s)));
  $effect(() => {
    const seenNow = shown.filter((s) => s.status !== 'new').map((s) => s.id);
    const onGrid = live.map((s) => s.id);
    untrack(() => {
      const k = seenNow.filter((id) => !known.includes(id));
      if (k.length) remember(KNOWN_KEY, (known = [...known, ...k]));
      const p = onGrid.filter((id) => !placed.includes(id));
      if (p.length) remember(PLACED_KEY, (placed = [...placed, ...p]));
    });
  });
  // A dragged layout is remembered per project filter ('' = all). Until the first drag the grid stays automatic: it is
  // shown as a tree too (so it has bars), but only a drag stores it. Live-set changes are folded in by reconcile.
  const LAYOUT_KEY = 'shub.overview.layout';
  const savedLayouts = storedJson(LAYOUT_KEY);
  const loaded: Record<string, Layout> = {};
  for (const [k, v] of Object.entries(
    savedLayouts && typeof savedLayouts === 'object' && !Array.isArray(savedLayouts) ? savedLayouts : {},
  )) {
    const t = parseLayout(JSON.stringify(v));
    if (t) loaded[k] = t;
  }
  let custom = $state(loaded);
  const setLayout = (t: Layout | null) => {
    const next = { ...custom };
    if (t) next[projectId] = t;
    else delete next[projectId];
    custom = next;
    store(LAYOUT_KEY, JSON.stringify(next));
  };
  // Layouts of deleted projects go (once the project list has loaded).
  $effect(() => {
    if (!app.projects.length) return;
    const keys = Object.keys(custom).filter((k) => k && !project(k));
    if (!keys.length) return;
    const next = { ...custom };
    for (const k of keys) delete next[k];
    custom = next;
    store(LAYOUT_KEY, JSON.stringify(next));
  });
  const layout = $derived(
    custom[projectId]
      ? reconcile(
          custom[projectId],
          live.map((s) => s.id),
        )
      : gridLayout(
          live.map((s) => s.id),
          gridColumns(live.length, w, h),
        ),
  );
  const HIDE_KEY = 'shub.overview.stripHidden';
  let stripHidden = $state(storedJson(HIDE_KEY) === true);
  const toggleStrip = () => store(HIDE_KEY, JSON.stringify((stripHidden = !stripHidden)));
  const project = (id: string | null) => app.projects.find((p) => p.id === id);

  const ARROWS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' } as const;

  // Alt N: ask which project, then start the session as a new pane here and focus it (never leaves the grid).
  let picking = $state(false);
  async function newSession(p: ProjectView) {
    picking = false;
    const s = await startSession({ projectId: p.id, kind: 'claude' });
    if (s) showPane(s);
  }
  // Alt K search also lands here (new or resumed sessions), so it never leaves the grid.
  function showPane(s: Session) {
    promoted = [...promoted, s.id]; // past the cap it still gets its pane
    setMinimized(minimized.filter((x) => x !== s.id));
    focusId = s.id;
  }
  // A session that appears while the grid is open (after an approval, from another tab or the CLI) gets its pane too,
  // without stealing the focus.
  let seen: Set<string> | null = null;
  $effect(() => {
    const fresh = shown
      .filter((s) => seen && !seen.has(s.id) && (LIVE.has(s.status) || s.status === 'new'))
      .map((s) => s.id);
    seen = new Set(shown.map((s) => s.id));
    if (fresh.length)
      untrack(() => {
        promoted = [...promoted, ...fresh];
        setMinimized(minimized.filter((x) => !fresh.includes(x)));
      });
  });
  $effect(() => {
    ui.showInGrid = showPane;
    return () => (ui.showInGrid = null);
  });

  // Alt W closes the focused session; like the tab bar, it asks first when panes or work would be lost.
  let confirm = $state<Confirm | null>(null);
  function closeFocused() {
    const s = live.find((x) => x.id === focusId);
    if (!s) return;
    const run = () => void closeSession(s.id);
    const panes = childrenOf(s.id).length;
    if (panes)
      confirm = {
        title: `Close ${s.name} and its ${panes === 1 ? 'pane' : `${panes} panes`}?`,
        body: 'They end with it.',
        action: 'Close all',
        danger: true,
        run,
      };
    else if (s.status === 'working')
      confirm = { title: `Close ${s.name}?`, body: 'It is still working.', action: 'Close', danger: true, run };
    else run();
  }

  function onKeydown(e: KeyboardEvent) {
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    const i = live.findIndex((s) => s.id === focusId);
    const digit = /^Digit([1-9])$/.exec(e.code);
    let target: Session | undefined;
    if (e.code === 'KeyO') location.hash = villageBack();
    else if (e.code === 'KeyK') ui.search = !ui.search;
    else if (e.code === 'KeyN') picking = !picking;
    else if (e.code === 'KeyW') closeFocused();
    else if (e.code === 'Enter') {
      if (live[i]) location.hash = sessionHref(live[i]);
    } else if (e.code in ARROWS && e.shiftKey) {
      // Swap the focused pane with its neighbour on screen (the tree is always there, auto grid included).
      const nb = layout && live[i] ? neighbourByRect(layout, live[i].id, ARROWS[e.code as keyof typeof ARROWS]) : '';
      if (layout && nb && nb !== focusId && !maxId) setLayout(swap(layout, focusId!, nb));
    } else if (e.code in ARROWS && maxId) {
      // Only one pane is visible: the arrows step through the panes in order.
      const back = e.code === 'ArrowLeft' || e.code === 'ArrowUp';
      target = live[(Math.max(i, 0) + (back ? -1 : 1) + live.length) % live.length];
    } else if (e.code in ARROWS) {
      const dir = ARROWS[e.code as keyof typeof ARROWS];
      const id = i < 0 ? live[0]?.id : custom[projectId] ? neighbourByRect(layout, live[i].id, dir) : undefined;
      target = id
        ? live.find((s) => s.id === id)
        : live[neighbour(i, dir, gridColumns(live.length, w, h), live.length)];
    } else if (digit) target = live[Number(digit[1]) - 1];
    else if (e.code === 'KeyJ') {
      const hot = live.filter((s) => s.status === 'needs-you');
      if (!hot.length) toast('Nothing needs you');
      else target = hot[(hot.findIndex((s) => s.id === focusId) + 1) % hot.length];
    } else return;
    e.preventDefault();
    e.stopPropagation();
    if (target) focusId = target.id;
    if (target && maxId) maxId = target.id; // a maximized pane follows the focus
  }
</script>

<svelte:window onkeydowncapture={onKeydown} />

<ProjectPicker
  open={picking}
  preferred={projectId || app.sessions.find((x) => x.id === focusId)?.projectId || undefined}
  onpick={newSession}
  onclose={() => (picking = false)}
/>
<ConfirmDialog bind:confirm />

<div class="overview">
  <header>
    <a class="back" href={villageBack()} title="Back to shub (Alt O)">← shub</a>
    <h1>Overview</h1>
    <span class="count">
      {shown.length}
      {shown.length === 1 ? 'session' : 'sessions'}{#if needsYouCount(shown)}
        · {needsYouCount(shown)} need you{/if}
    </span>
    <span class="grow"></span>
    {#if custom[projectId]}
      <Button size="sm" onclick={() => setLayout(null)}>Reset layout</Button>
    {/if}
    <SelectField
      label="Project"
      hideLabel
      size="sm"
      bind:value={projectId}
      options={[{ value: '', label: 'All projects' }, ...app.projects.map((p) => ({ value: p.id, label: p.name }))]}
    />
  </header>
  <div class="live" bind:clientWidth={w} bind:clientHeight={h}>
    {#if live.length}
      <SplitView
        sessions={live}
        limit={live.length}
        columns={gridColumns(live.length, w, h)}
        {layout}
        onlayout={setLayout}
        projectOf={(s) => project(s.projectId)}
        selectedId={focusId}
        onselect={(id) => (focusId = id)}
        maximizable
        bind:maximizedId={maxId}
        onmaximize={(id) => (location.hash = sessionHref(live.find((s) => s.id === id)!))}
        onminimize={(id) => setMinimized([...minimized, id])}
      >
        {#snippet actions(s)}
          {#if s.pendingPermission}
            <span class="ask" title="{s.pendingPermission.tool}: {s.pendingPermission.summary}">
              {s.pendingPermission.tool}: {s.pendingPermission.summary}
            </span>
            <Button size="sm" variant="primary" onclick={() => void sendKeys(s.id, ['1'])}>Allow</Button>
            <Button size="sm" onclick={() => void sendKeys(s.id, ['3'])}>Deny</Button>
          {/if}
        {/snippet}
        {#snippet pane(s)}
          <TerminalView
            sessionId={s.id}
            accent={project(s.projectId)?.accent}
            label={s.name}
            focused={s.id === focusId}
            compact
          />
        {/snippet}
      </SplitView>
    {:else}
      <EmptyState
        title="No active sessions"
        body={quiet.length
          ? 'Paused or not-started sessions wait in the strip below. Resume one, or start a new one with Alt N.'
          : 'Start one with Alt N.'}
      />
    {/if}
  </div>
  {#if quiet.length}
    <button type="button" class="strip-toggle" aria-expanded={!stripHidden} onclick={toggleStrip}>
      <Icon name={stripHidden ? 'chevron-right' : 'chevron-down'} size="xs" />
      {quiet.length} parked
    </button>
  {/if}
  {#if quiet.length && !stripHidden}
    <div class="quiet">
      {#each quiet as s (s.id)}
        {@const p = project(s.projectId)}
        <SessionCard
          session={s}
          href={sessionHref(s)}
          project={p?.name}
          accent={p?.accent}
          panes={childrenOf(s.id).length}
          flagged={s.status === 'your-turn' && minimized.includes(s.id)}
          onallow={() => void sendKeys(s.id, ['1'])}
          ondeny={() => void sendKeys(s.id, ['3'])}
          onrestore={LIVE.has(s.status)
            ? () => {
                setMinimized(minimized.filter((x) => x !== s.id));
                promoted = [...promoted, s.id];
              }
            : undefined}
        />
      {/each}
    </div>
  {/if}
</div>

<style>
  .overview {
    height: 100vh;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
    overflow: auto;
    background: var(--bg);
    color: var(--fg);
  }

  header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  h1 {
    margin: 0;
    font-size: var(--text-lg);
    font-weight: var(--weight-semibold);
  }

  .back {
    color: var(--muted);
    text-decoration: none;
  }

  .count {
    color: var(--muted);
    font-size: var(--text-sm);
  }

  .grow {
    flex: 1 1 auto;
  }

  .live {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
  }

  .strip-toggle {
    flex: none;
    align-self: flex-start;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: 0;
    border: 0;
    background: none;
    color: var(--muted);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .ask {
    min-width: 0;
    max-width: 50%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-sm);
  }

  .quiet {
    flex: none;
    display: grid;
    gap: var(--space-3);
    grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
  }
</style>
