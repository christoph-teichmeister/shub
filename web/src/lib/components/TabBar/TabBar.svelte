<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    label: string;
    children: Snippet;
    /** Content after the tabs (new-tab button, hints). */
    trailing?: Snippet;
  }
  let { label, children, trailing }: Props = $props();
</script>

<div class="bar">
  <div class="tabs" role="tablist" aria-label={label}>{@render children()}</div>
  {#if trailing}{@render trailing()}{/if}
</div>

<style>
  .bar {
    display: flex;
    align-items: flex-end;
    gap: var(--space-0-5);
    padding: var(--space-2) var(--space-3) 0;
    border-bottom: var(--hairline) solid var(--line);
    overflow-x: auto;
  }

  .tabs {
    display: flex;
    gap: var(--space-0-5);
  }
</style>
