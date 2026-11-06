<script lang="ts">
  // Overview (#/overview): every running session as a status card in one grid, for a big screen. Reads the live
  // store only; the grid fills the width by itself (auto-fill).
  import SessionCard from '../../components/SessionCard/SessionCard.svelte';
  import EmptyState from '../../components/EmptyState/EmptyState.svelte';
  import SelectField from '../../components/SelectField/SelectField.svelte';
  import { overviewSessions } from '../../overview.ts';
  import { villageBack } from '../../stores/router.svelte.ts';
  import { app, childrenOf, needsYouCount, sendKeys, sessionHref } from '../../stores/state.svelte.ts';

  let projectId = $state('');
  const shown = $derived(overviewSessions(app.sessions, projectId || null));
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
  {#if shown.length}
    <div class="grid">
      {#each shown as s (s.id)}
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
  {:else}
    <EmptyState title="No running sessions" body="Start one in a project with Alt N." />
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

  .grid {
    display: grid;
    gap: var(--space-3);
    grid-template-columns: repeat(auto-fill, minmax(20rem, 1fr));
    align-content: start;
  }
</style>
