<script lang="ts">
  // Overview (#/overview): the running sessions as live terminals in one grid that fills the screen, so you can work
  // in many at once; paused and not-started ones wait below as small cards. Click a pane to type in it.
  import EmptyState from '../../components/EmptyState/EmptyState.svelte';
  import SelectField from '../../components/SelectField/SelectField.svelte';
  import SessionCard from '../../components/SessionCard/SessionCard.svelte';
  import SplitView from '../../components/SplitView/SplitView.svelte';
  import TerminalView from '../../components/TerminalView/TerminalView.svelte';
  import { gridColumns, LIVE, overviewSessions } from '../../overview.ts';
  import { villageBack } from '../../stores/router.svelte.ts';
  import { app, childrenOf, needsYouCount, sendKeys, sessionHref } from '../../stores/state.svelte.ts';

  let projectId = $state('');
  let focusId = $state<string | null>(null);
  let w = $state(0);
  let h = $state(0);
  const shown = $derived(overviewSessions(app.sessions, projectId || null));
  const live = $derived(shown.filter((s) => LIVE.has(s.status)));
  const quiet = $derived(shown.filter((s) => !LIVE.has(s.status)));
  const project = (id: string | null) => app.projects.find((p) => p.id === id);

  function onKeydown(e: KeyboardEvent) {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.code !== 'KeyO') return;
    e.preventDefault();
    e.stopPropagation();
    location.hash = villageBack();
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
        selectedId={focusId}
        onselect={(id) => (focusId = id)}
      >
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
      <EmptyState title="No active sessions" body="Start one in a project with Alt N." />
    {/if}
  </div>
  {#if quiet.length}
    <div class="quiet">
      {#each quiet as s (s.id)}
        {@const p = project(s.projectId)}
        <SessionCard
          session={s}
          href={sessionHref(s)}
          project={p?.name}
          accent={p?.accent}
          panes={childrenOf(s.id).length}
          onallow={() => void sendKeys(s.id, ['1'])}
          ondeny={() => void sendKeys(s.id, ['3'])}
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

  .quiet {
    flex: none;
    display: grid;
    gap: var(--space-3);
    grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
  }
</style>
