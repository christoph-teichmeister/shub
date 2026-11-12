<script lang="ts">
  // Overview (#/overview): the running sessions as live terminals in one grid that fills the screen, so you can work
  // in many at once; paused and not-started ones wait below as small cards. Click a pane to type in it; Alt arrows, Alt 1 to 9, Alt J and Alt Enter move between panes.
  import type { Session } from '../../../../../shared/api.ts';
  import Button from '../../components/Button/Button.svelte';
  import EmptyState from '../../components/EmptyState/EmptyState.svelte';
  import Icon from '../../components/Icon/Icon.svelte';
  import SelectField from '../../components/SelectField/SelectField.svelte';
  import SessionCard from '../../components/SessionCard/SessionCard.svelte';
  import SplitView from '../../components/SplitView/SplitView.svelte';
  import TerminalView from '../../components/TerminalView/TerminalView.svelte';
  import { capLive, gridColumns, LIVE, MAX_LIVE, neighbour, overviewSessions, pruneMinimized } from '../../overview.ts';
  import { store, storedJson } from '../../stored.ts';
  import { villageBack } from '../../stores/router.svelte.ts';
  import { toast } from '../../stores/toasts.svelte.ts';
  import {
    app,
    childrenOf,
    needsYouCount,
    sendKeys,
    sessionHref,
    startSession,
    ui,
  } from '../../stores/state.svelte.ts';

  let projectId = $state('');
  let focusId = $state<string | null>(null);
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
  // Past MAX_LIVE the cells are unreadable: the overflow waits in the strip, "Show" promotes one (not remembered).
  let promoted = $state<string[]>([]);
  const wantsLive = (s: Session) => LIVE.has(s.status) && (s.status === 'needs-you' || !minimized.includes(s.id));
  const capped = $derived(capLive(shown.filter(wantsLive), MAX_LIVE, promoted));
  const live = $derived(capped.live);
  const quiet = $derived(shown.filter((s) => !live.includes(s)));
  const HIDE_KEY = 'shub.overview.stripHidden';
  let stripHidden = $state(storedJson(HIDE_KEY) === true);
  const toggleStrip = () => store(HIDE_KEY, JSON.stringify((stripHidden = !stripHidden)));
  const project = (id: string | null) => app.projects.find((p) => p.id === id);

  const ARROWS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' } as const;

  // Alt N: a session in the filtered project, else in the focused pane's project, else search for one. It shows up as a pane here.
  const newSession = () => {
    const id = projectId || app.sessions.find((x) => x.id === focusId)?.projectId;
    if (id) void startSession({ projectId: id, kind: 'claude' });
    else ui.search = true;
  };

  function onKeydown(e: KeyboardEvent) {
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    const i = live.findIndex((s) => s.id === focusId);
    const digit = /^Digit([1-9])$/.exec(e.code);
    let target: Session | undefined;
    if (e.code === 'KeyO') location.hash = villageBack();
    else if (e.code === 'KeyK') ui.search = !ui.search;
    else if (e.code === 'KeyN') newSession();
    else if (e.code === 'Enter') {
      if (live[i]) location.hash = sessionHref(live[i]);
    } else if (e.code in ARROWS) {
      target =
        live[
          i < 0 ? 0 : neighbour(i, ARROWS[e.code as keyof typeof ARROWS], gridColumns(live.length, w, h), live.length)
        ];
    } else if (digit) target = live[Number(digit[1]) - 1];
    else if (e.code === 'KeyJ') {
      const hot = live.filter((s) => s.status === 'needs-you');
      if (!hot.length) toast('Nothing needs you');
      else target = hot[(hot.findIndex((s) => s.id === focusId) + 1) % hot.length];
    } else return;
    e.preventDefault();
    e.stopPropagation();
    if (target) focusId = target.id;
  }
</script>

<svelte:window onkeydowncapture={onKeydown} />

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
        projectOf={(s) => project(s.projectId)}
        selectedId={focusId}
        onselect={(id) => (focusId = id)}
        maximizable
        hrefFor={sessionHref}
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
          : 'Start one in a project with Alt N.'}
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
