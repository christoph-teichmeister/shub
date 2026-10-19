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
  {#if trailing}{@render trailing()}{/if}
</div>

<style>
  .bar {
    display: flex;
    align-items: flex-end;
    gap: var(--space-0-5);
    padding: var(--space-2) var(--space-3) 0;

    /* Inset shadow, not a border: the bar scrolls, which would clip a selected tab overlapping a border. */
    box-shadow: inset 0 calc(-1 * var(--hairline)) 0 var(--line);
    overflow-x: auto;
  }

  .tabs {
    display: flex;
    gap: var(--space-0-5);
  }
</style>
