<script lang="ts">
  import type { Snippet } from 'svelte';
  import { tabKeys } from '../../tabKeys.ts';

  interface Props {
    label: string;
    children: Snippet;
    /** Content after the tabs (new-tab button, hints). */
    trailing?: Snippet;
  }
  let { label, children, trailing }: Props = $props();
</script>

<div class="bar">
  <div class="tabs" role="tablist" tabindex="-1" aria-label={label} onkeydown={tabKeys}>{@render children()}</div>
  {#if trailing}<div class="trailing">{@render trailing()}</div>{/if}
</div>

<style>
  /* Mirrored vertically, children flipped back, so the scrollbar sits above the tabs, not over the line.
     Everything below is written upside down: top here is the bottom on screen. */
  .bar {
    display: flex;
    align-items: flex-start;
    gap: var(--space-0-5);
    padding: 0 var(--space-3) var(--space-2);

    /* Inset shadow, not a border: the bar scrolls, which would clip a selected tab overlapping a border. */
    box-shadow: inset 0 var(--hairline) 0 var(--line);
    overflow-x: auto;
    transform: scaleY(-1);
  }

  .bar > * {
    transform: scaleY(-1);
  }

  /* As tall as a tab and centred in it: aligned to the bottom, the buttons sat on the line. */
  .trailing {
    flex: 1 0 auto;
    display: flex;
    align-items: center;
    gap: var(--space-0-5);
    height: var(--size-tab);
  }

  .tabs {
    display: flex;
    gap: var(--space-0-5);
  }
</style>
