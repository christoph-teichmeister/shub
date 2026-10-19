<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import Icon from '../Icon/Icon.svelte';
  import type { IconName } from '../Icon/icons.ts';

  interface Props extends HTMLButtonAttributes {
    variant?: 'primary' | 'secondary' | 'ghost' | 'dashed' | 'danger';
    size?: 'sm' | 'md';
    icon?: IconName;
    /** Toggle buttons: sets aria-pressed and the pressed look. */
    pressed?: boolean;
    children: Snippet;
  }
  let { variant = 'secondary', size = 'md', icon, pressed, children, type = 'button', ...rest }: Props = $props();
</script>

<button {type} class="button {variant} {size}" class:pressed aria-pressed={pressed} {...rest}>
  {#if icon}<Icon name={icon} />{/if}
  {@render children()}
</button>

<style>
  .button {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    height: var(--size-control-md);
    padding: 0 var(--space-3);
    border-radius: var(--radius-md);
    border: var(--hairline) solid var(--line);
    background: var(--panel);
    color: var(--fg);
    cursor: pointer;
    white-space: nowrap;
    transition: background var(--duration-fast) var(--ease-standard);
  }

  .button:hover {
    background: var(--raised);
  }

  .button:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .sm {
    height: var(--size-control-sm);
    padding: 0 var(--space-2-5);
    font-size: var(--text-md);
  }

  .primary {
    border-color: transparent;
    background: var(--primary);
    color: var(--primary-fg);
    font-weight: var(--weight-semibold);
    padding: 0 var(--space-3-5);
  }

  .primary:hover {
    background: var(--primary);
    filter: brightness(1.08);
  }

  .ghost {
    border-color: transparent;
    background: transparent;
    color: var(--fg-2);
  }

  .dashed {
    border-style: dashed;
    background: transparent;
    color: var(--fg-2);
  }

  .danger {
    color: var(--danger);
  }

  .pressed {
    border-color: var(--primary);
    background: var(--raised);
    color: var(--fg);
    font-weight: var(--weight-medium);
  }
</style>
