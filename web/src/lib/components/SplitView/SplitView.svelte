<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { Session } from '../../../../../shared/api.ts';
  import { STATUS_LABEL } from '../../status.ts';
  import StatusDot from '../StatusDot/StatusDot.svelte';

  interface Props {
    /** Up to four sessions; more are ignored. */
    sessions: Session[];
    selectedId?: string | null;
    onselect?: (id: string) => void;
    /** Pane body, usually a compact TerminalView. */
    pane: Snippet<[Session]>;
  }
  let { sessions, selectedId = null, onselect, pane }: Props = $props();
  const shown = $derived(sessions.slice(0, 4));
</script>

<div class="grid n{shown.length}">
  {#each shown as session (session.id)}
    <section
      class="pane {session.status}"
      class:selected={session.id === selectedId}
      aria-label={session.name}
      onfocusin={() => onselect?.(session.id)}
    >
      <button type="button" class="head" onclick={() => onselect?.(session.id)}>
        <StatusDot status={session.status} />
        <span class="name">{session.name}</span>
        <span class="status">{STATUS_LABEL[session.status]}</span>
      </button>
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
    border: 0;
    background: var(--panel);
    color: var(--fg-2);
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
