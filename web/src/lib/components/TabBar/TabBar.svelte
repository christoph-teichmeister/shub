<script lang="ts">
  import type { Snippet } from 'svelte';
  import { tabKeys } from '../../tabKeys.ts';

  interface Props {
    label: string;
    /** The tabs; none (split view) leaves the bar with its leading and trailing parts. */
    children?: Snippet;
    /** Content before the tabs (the project name). */
    leading?: Snippet;
    /** Content after the tabs (new-tab button, view toggles); never scrolls away. */
    trailing?: Snippet;
  }
  let { label, children, leading, trailing }: Props = $props();

  // The tabs' width settles after the tab itself scrolled into view (and changes with the window): follow it.
  let tabs = $state<HTMLDivElement>();
  $effect(() => {
    if (!tabs) return;
    const el = tabs;
    const keep = new ResizeObserver(() =>
      el
        .querySelector('[aria-selected="true"]')
        ?.closest('[role="tablist"] > *')
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' }),
    );
    keep.observe(el);
    return () => keep.disconnect();
  });

  // Only the tabs scroll, and without a scrollbar (it sat on the line): a plain wheel scrolls them sideways.
  function onwheel(e: WheelEvent) {
    const el = e.currentTarget as HTMLElement;
    if (!e.deltaY || el.scrollWidth <= el.clientWidth) return;
    el.scrollLeft += e.deltaY;
    e.preventDefault();
  }
</script>

<div class="bar">
  {#if leading}<div class="leading">{@render leading()}</div>{/if}
  {#if children}
    <div bind:this={tabs} class="tabs" role="tablist" tabindex="-1" aria-label={label} onkeydown={tabKeys} {onwheel}>
      {@render children()}
    </div>
  {/if}
  {#if trailing}<div class="trailing">{@render trailing()}</div>{/if}
</div>

<style>
  .bar {
    container: tabbar / inline-size;
    display: flex;
    align-items: flex-end;
    gap: var(--space-0-5);
    padding: var(--space-2) var(--space-3) 0;

    /* Inset shadow, not a border, so the selected tab can cover the line. */
    box-shadow: inset 0 calc(-1 * var(--hairline)) 0 var(--line);
  }

  /* As tall as a tab and centred in it: aligned to the bottom, the buttons sat on the line. */
  .leading,
  .trailing {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: var(--space-0-5);
    height: var(--size-tab);
  }

  .trailing {
    flex-grow: 1;
  }

  .tabs {
    display: flex;
    flex: 0 1 auto;
    min-width: 0;
    gap: var(--space-0-5);
    overflow-x: auto;
    scrollbar-width: none;
  }
</style>
