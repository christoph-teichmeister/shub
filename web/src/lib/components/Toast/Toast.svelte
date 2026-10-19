<script lang="ts">
  import { dismissToast, toasts, type ToastItem } from '../../stores/toasts.svelte.ts';
  import IconButton from '../IconButton/IconButton.svelte';

  interface Props {
    /** Defaults to the app toast store; pass items to render a static stack (styleguide). */
    items?: ToastItem[];
    ondismiss?: (id: number) => void;
    /** Pinned to the bottom-right corner of the window. */
    fixed?: boolean;
  }
  let { items = toasts, ondismiss = dismissToast, fixed = true }: Props = $props();
</script>

<div class="stack" class:fixed role="status" aria-live="polite">
  {#each items as item (item.id)}
    <div class="toast {item.tone}">
      <span class="message">{item.message}</span>
      <IconButton label="Dismiss" icon="close" size="xs" tone="muted" onclick={() => ondismiss(item.id)} />
    </div>
  {/each}
</div>

<style>
  .stack {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    width: var(--size-toast);
    max-width: calc(100vw - var(--space-8));
  }

  .fixed {
    position: fixed;
    right: var(--space-4);
    bottom: var(--space-4);
    z-index: var(--z-toast);
  }

  .toast {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-2) var(--space-2) var(--space-3-5);
    border: var(--hairline) solid var(--line-strong);
    border-radius: var(--radius-lg);
    background: var(--panel);
    box-shadow: 0 var(--space-2) var(--space-6) var(--shadow);
  }

  .message {
    flex: 1 1 auto;
  }

  .error {
    border-color: var(--danger);
  }

  .needs-you {
    border-color: var(--status-needs-you);
    background: var(--status-needs-you-bg);
    color: var(--status-needs-you-fg);
  }
</style>
