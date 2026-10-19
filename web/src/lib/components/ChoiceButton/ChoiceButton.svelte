<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  interface Props extends HTMLButtonAttributes {
    /** Selected choice (aria-pressed). */
    pressed: boolean;
    shape?: 'card' | 'pill' | 'square' | 'swatch';
    /** Fill of a `swatch` (CSS colour from data or a token). */
    swatch?: string;
    children?: Snippet;
  }
  let { pressed, shape = 'pill', swatch, children, type = 'button', ...rest }: Props = $props();
</script>

<button {type} class="choice {shape}" class:pressed aria-pressed={pressed} style:--swatch={swatch} {...rest}>
  {#if children}{@render children()}{/if}
</button>

<style>
  .choice {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2-5);
    border: var(--hairline) solid var(--line);
    background: var(--panel);
    color: var(--fg-2);
    cursor: pointer;
    transition: border-color var(--duration-fast) var(--ease-standard);
  }

  .choice:hover {
    border-color: var(--line-strong);
    color: var(--fg);
  }

  .pressed,
  .pressed:hover {
    border-color: var(--primary);
    color: var(--fg);
  }

  .pill {
    height: var(--size-control-lg);
    padding: 0 var(--space-4);
    border-radius: var(--radius-md);
  }

  .pill.pressed {
    background: var(--raised);
    font-weight: var(--weight-medium);
  }

  .card {
    justify-content: flex-start;
    padding: var(--space-2-5) var(--space-3-5);
    border-radius: var(--radius-lg);
    text-align: left;
  }

  .card.pressed {
    box-shadow: inset 0 0 0 var(--hairline) var(--primary);
  }

  .square {
    width: var(--size-control-md);
    height: var(--size-control-md);
    border-radius: var(--radius-md);
  }

  .square.pressed {
    background: var(--raised);
  }

  .swatch {
    width: var(--size-control-md);
    height: var(--size-control-md);
    border: 0;
    border-radius: var(--radius-round);
    background: var(--swatch);
  }

  .swatch.pressed {
    outline: var(--ring) solid var(--fg);
    outline-offset: var(--ring);
  }
</style>
