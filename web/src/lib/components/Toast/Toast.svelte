<script lang="ts">
  import { dismissToast, toasts, type ToastItem } from '../../stores/toasts.svelte.ts';
  import Icon from '../Icon/Icon.svelte';
  import type { IconName } from '../Icon/icons.ts';
  import IconButton from '../IconButton/IconButton.svelte';

  interface Props {
    /** Defaults to the app toast store; pass items to render a static stack (styleguide). */
    items?: ToastItem[];
    ondismiss?: (id: number) => void;
    /** Pinned to the bottom-right corner of the window. */
    fixed?: boolean;
  }
  let { items = toasts, ondismiss = dismissToast, fixed = true }: Props = $props();

  const ICON: Record<ToastItem['tone'], IconName> = { neutral: 'check', error: 'warning', 'needs-you': 'bell' };
</script>

<div class="stack" class:fixed role="status" aria-live="polite">
  {#each items as item (item.id)}
    <div class="toast {item.tone}">
      <span class="icon"><Icon name={ICON[item.tone]} size="sm" weight={2} /></span>
      <span class="message">{item.message}</span>
      {#if item.action}
        <a class="action" href={item.action.href} onclick={() => ondismiss(item.id)}>{item.action.label}</a>
      {/if}
      <IconButton label="Dismiss" icon="close" size="xs" tone="muted" onclick={() => ondismiss(item.id)} />
      {#if item.ms}
        <!-- The draining line is the timer: it pauses on hover and dismisses when it runs out. -->
        <span class="timer" style:animation-duration="{item.ms}ms" onanimationend={() => ondismiss(item.id)}></span>
      {/if}
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
    position: relative;
    overflow: hidden;
    display: flex;
    align-items: center;
    gap: var(--space-2-5);
    padding: var(--space-2) var(--space-1-5) var(--space-2) var(--space-2-5);
    border: var(--hairline) solid var(--line-strong);
    border-radius: var(--radius-lg);
    background: var(--raised);
    box-shadow: 0 var(--space-2-5) var(--space-8) var(--shadow);
    animation: slide-in var(--duration-base) var(--ease-standard);
  }

  .icon {
    display: grid;
    flex: none;
    place-items: center;
    width: var(--size-tile);
    height: var(--size-tile);
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, currentcolor 14%, transparent);
  }

  .neutral .icon {
    color: var(--status-your-turn);
  }

  .message {
    flex: 1 1 auto;
    min-width: 0;
  }

  .action {
    flex: none;
    font-weight: 600;
  }

  .timer {
    position: absolute;
    bottom: 0;
    left: 0;
    width: 100%;
    height: var(--ring);
    background: var(--status-your-turn);
    transform-origin: left;
    animation: drain linear forwards;
  }

  .toast:hover .timer {
    animation-play-state: paused;
  }

  .error {
    border-color: var(--danger);
    background: color-mix(in srgb, var(--danger) 14%, var(--raised));
  }

  .error .icon {
    color: var(--danger);
  }

  .needs-you {
    border-color: var(--status-needs-you);
    background: var(--status-needs-you-bg);
    color: var(--status-needs-you-fg);
  }

  .needs-you .icon {
    color: var(--status-needs-you);
  }

  @keyframes slide-in {
    from {
      opacity: 0;
      transform: translateX(110%);
    }
  }

  @keyframes drain {
    to {
      transform: scaleX(0);
    }
  }
</style>
