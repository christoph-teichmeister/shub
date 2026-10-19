<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    header: Snippet;
    children: Snippet;
    footer?: Snippet;
  }
  let { header, children, footer }: Props = $props();
</script>

<nav class="sidebar" aria-label="Projects">
  <div class="header">{@render header()}</div>
  <div class="scroll">{@render children()}</div>
  {#if footer}<div class="footer">{@render footer()}</div>{/if}
</nav>

<style>
  .sidebar {
    flex: 0 0 var(--size-sidebar);
    min-width: var(--size-sidebar-min);
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-4) var(--space-3);
    background: var(--panel);
    border-right: var(--hairline) solid var(--line);
    overflow: hidden;
  }

  .header {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .scroll {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .footer {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
</style>
