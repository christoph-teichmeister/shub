<script lang="ts">
  import type { ChildWorktree } from '../../../../../shared/api.ts';
  import { childLabel } from '../../children.ts';
  import Icon from '../Icon/Icon.svelte';

  interface Props {
    worktree: ChildWorktree;
    /** Starts (or resumes) Claude there; left out while busy. */
    onopen?: () => void;
  }
  let { worktree, onopen }: Props = $props();
  const title = $derived(
    worktree.busy
      ? `A Claude is still working in ${worktree.path}`
      : `${worktree.conversation ? 'Resume the last conversation' : 'Start Claude'} in ${worktree.path}`,
  );
</script>

<button
  type="button"
  class="row"
  class:busy={worktree.busy}
  class:merged={worktree.state === 'merged'}
  disabled={!onopen}
  {title}
  onclick={onopen}
>
  <span class="mark" aria-hidden="true"><Icon name="folder" size="xs" /></span>
  <span class="name">{worktree.name}</span>
  {#if worktree.conversation && !worktree.busy}
    <span class="resume" aria-label="has a conversation to resume"><Icon name="message" size="xs" /></span>
  {/if}
  <span class="status">{childLabel(worktree)}</span>
</button>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-1) var(--space-2-5);
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--muted);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .row:disabled {
    cursor: default;
  }

  .row:focus-visible,
  .row:hover:not(:disabled) {
    background: var(--raised);
    color: var(--fg);
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
</style>
