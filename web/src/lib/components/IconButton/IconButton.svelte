<script lang="ts">
  import Icon from '../Icon/Icon.svelte';
  import type { IconName } from '../Icon/icons.ts';

  interface Props {
    /** Accessible name, also the tooltip. */
    label: string;
    icon: IconName;
    size?: 'xs' | 'sm' | 'md' | 'lg';
    variant?: 'ghost' | 'outline' | 'filled';
    tone?: 'default' | 'muted' | 'start' | 'stop' | 'accent';
    pressed?: boolean;
    disabled?: boolean;
    /** Renders a link instead of a button. */
    href?: string;
    /** Opens `href` in a new tab. */
    external?: boolean;
    onclick?: (e: MouseEvent) => void;
  }
  let {
    label,
    icon,
    size = 'sm',
    variant = 'ghost',
    tone = 'default',
    pressed,
    disabled = false,
    href,
    external = false,
    onclick,
  }: Props = $props();
  const iconSize = $derived(size === 'xs' ? 'sm' : size === 'lg' ? 'lg' : 'md');
</script>

{#if href}
  <a
    class="icon-button {size} {variant} {tone}"
    {href}
    target={external ? '_blank' : undefined}
    rel={external ? 'noreferrer' : undefined}
    aria-label={label}
    title={label}
  >
    <Icon name={icon} size={iconSize} />
  </a>
{:else}
  <button
    type="button"
    class="icon-button {size} {variant} {tone}"
    aria-label={label}
    title={label}
    aria-pressed={pressed}
    {disabled}
    {onclick}
  >
    <Icon name={icon} size={iconSize} />
  </button>
{/if}

<style>
  .icon-button {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: var(--hairline) solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--fg-2);
    cursor: pointer;
    text-decoration: none;
    transition: background var(--duration-fast) var(--ease-standard);
  }

  .icon-button:hover,
  .icon-button[aria-pressed='true'] {
    background: var(--raised);
    color: var(--fg);
  }

  .icon-button:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  .xs {
    width: var(--size-control-xs);
    height: var(--size-control-xs);
    border-radius: var(--radius-xs);
  }

  .sm {
    width: var(--size-control-sm);
    height: var(--size-control-sm);
  }

  .md {
    width: var(--size-control);
    height: var(--size-control);
    border-radius: var(--radius-md);
  }

  .lg {
    width: var(--size-control-md);
    height: var(--size-control-md);
    border-radius: var(--radius-md);
  }

  .outline {
    border-color: var(--line);
    background: var(--bg);
  }

  .filled {
    background: var(--raised);
    color: var(--fg);
  }

  .muted {
    color: var(--muted);
  }

  .start {
    color: var(--status-your-turn);
  }

  .stop {
    color: var(--danger);
  }

  .accent {
    color: var(--purple);
  }
</style>
