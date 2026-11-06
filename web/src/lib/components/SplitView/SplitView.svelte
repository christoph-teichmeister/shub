<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { Session } from '../../../../../shared/api.ts';
  import { idleWithAgents, STATUS_LABEL } from '../../status.ts';
  import IconButton from '../IconButton/IconButton.svelte';
  import StatusDot from '../StatusDot/StatusDot.svelte';

  interface Props {
    /** Up to `limit` sessions (four by default); more are ignored. */
    sessions: Session[];
    /** More than four panes: the overview. */
    limit?: number;
    /** Fixed column count (rows follow); without it 1, 2, 3 or 2 x 2 as before. */
    columns?: number;
    selectedId?: string | null;
    onselect?: (id: string) => void;
    /** Adds a minimize button to each header. */
    onminimize?: (id: string) => void;
    /** Pane body, usually a compact TerminalView. */
    pane: Snippet<[Session]>;
  }
  let { sessions, limit = 4, columns, selectedId = null, onselect, onminimize, pane }: Props = $props();
  const shown = $derived(sessions.slice(0, limit));
</script>

<div
  class="grid {columns ? 'cols' : `n${shown.length}`}"
  style:--cols={columns}
  style:--rows={columns ? Math.ceil(shown.length / columns) : undefined}
>
  {#each shown as session (session.id)}
    <section
      class="pane {session.status}"
      class:selected={session.id === selectedId}
      aria-label={session.name}
      onfocusin={() => onselect?.(session.id)}
    >
      <div class="head">
        <button type="button" class="title" onclick={() => onselect?.(session.id)}>
          <StatusDot status={session.status} idle={idleWithAgents(session)} />
          <span class="name">{session.name}</span>
          <span class="status">{STATUS_LABEL[session.status]}</span>
        </button>
        {#if onminimize}
          <IconButton label="Minimize" icon="minus" size="xs" onclick={() => onminimize(session.id)} />
        {/if}
      </div>
      <div class="body">{@render pane(session)}</div>
    </section>
  {/each}
</div>

<style>
  .grid {
    flex: 1 1 auto;
    min-height: 0;
    display: grid;
    gap: var(--space-2);
    padding: var(--space-2);
    background: var(--panel);
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-template-rows: repeat(2, minmax(0, 1fr));
  }

  .cols {
    grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
    grid-template-rows: repeat(var(--rows), minmax(0, 1fr));
  }

  .n1 {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr);
  }

  .n2 {
    grid-template-rows: minmax(0, 1fr);
  }

  .pane {
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: var(--hairline) solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--term-bg);
  }

  .n3 .pane:first-child {
    grid-row: span 2;
  }

  .pane.selected {
    border-color: var(--primary);
  }

  .pane.needs-you {
    border: var(--ring) solid var(--status-needs-you);
  }

  .head {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: var(--size-tab);
    padding: 0 var(--space-3);
    background: var(--panel);
    color: var(--fg-2);
  }

  .title {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: 100%;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .needs-you .head {
    background: var(--status-needs-you-bg);
    color: var(--status-needs-you-fg);
  }

  .name {
    flex: 1 1 auto;
    font-weight: var(--weight-medium);
  }

  .status {
    font-size: var(--text-sm);
    color: var(--muted);
  }

  .needs-you .status {
    color: var(--status-needs-you);
  }

  .working .status {
    color: var(--status-working);
  }

  .your-turn .status {
    color: var(--status-your-turn);
  }

  .body {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
  }
</style>
