<script lang="ts">
  import type { ChildWorktree } from '../../../../../shared/api.ts';
  import { childLabel } from '../../children.ts';
  import Icon from '../Icon/Icon.svelte';
  import IconButton from '../IconButton/IconButton.svelte';

  interface Props {
    worktree: ChildWorktree;
    /** Starts (or resumes) Claude there; left out while busy. */
    onopen?: () => void;
    onmenu?: (at: { x: number; y: number }) => void;
  }
  let { worktree, onopen, onmenu }: Props = $props();
  const title = $derived(
    worktree.busy
      ? `A Claude is still working in ${worktree.path}`
      : `${worktree.conversation ? 'Resume the last conversation' : 'Start Claude'} in ${worktree.path}`,
  );
</script>

<div
  class="row"
  role="presentation"
  class:busy={worktree.busy}
  class:merged={worktree.state === 'merged'}
  oncontextmenu={onmenu ? (e) => (e.preventDefault(), onmenu({ x: e.clientX, y: e.clientY })) : undefined}
>
  <button type="button" class="open" disabled={!onopen} {title} onclick={onopen}>
    <span class="mark" aria-hidden="true"><Icon name="folder" size="xs" /></span>
    <span class="name">{worktree.name}</span>
    {#if worktree.conversation && !worktree.busy}
      <span class="resume" aria-label="has a conversation to resume"><Icon name="message" size="xs" /></span>
    {/if}
    <span class="status">{childLabel(worktree)}</span>
  </button>
  {#if onmenu}
    <span class="actions"
      ><IconButton
        label="Menu for {worktree.name}"
        icon="more"
        size="xs"
        tone="muted"
        onclick={(e) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          onmenu({ x: r.left, y: r.bottom });
        }}
      /></span
    >
  {/if}
</div>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding-right: var(--space-1);
    border-radius: var(--radius-sm);
    color: var(--muted);
  }

  .open {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-1-5) var(--space-1) var(--space-2-5);
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .open:disabled {
    cursor: default;
  }

  .row:hover,
  .row:focus-within {
    background: var(--raised);
    color: var(--fg);
  }

  .actions {
    display: none;
  }

  .row:hover .actions,
  .row:focus-within .actions {
    display: flex;
  }

  .merged {
    opacity: 0.55;
  }

  .mark,
  .resume {
    display: flex;
    flex: none;
  }

  .name {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .status {
    flex: none;
    font-size: var(--text-xs);
  }

  .busy .status {
    color: var(--status-working);
  }

  .row:has(.actions):hover .status,
  .row:has(.actions):focus-within .status {
    display: none;
  }
</style>
