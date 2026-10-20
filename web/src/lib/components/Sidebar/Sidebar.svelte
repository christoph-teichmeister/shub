<script lang="ts">
  import type { Snippet } from 'svelte';
  import IconButton from '../IconButton/IconButton.svelte';

  interface Props {
    header: Snippet;
    children: Snippet;
    footer?: Snippet;
    /** Folded to a slim rail that only shows the toggle. */
    collapsed?: boolean;
    /** Shows the toggle button in the top right corner; the first header row leaves room for it. */
    ontoggle?: () => void;
  }
  let { header, children, footer, collapsed = false, ontoggle }: Props = $props();
</script>

<nav class="sidebar" class:collapsed aria-label="Projects">
  {#if ontoggle}
    <span class="toggle">
      <IconButton
        label="{collapsed ? 'Show' : 'Hide'} sidebar (Alt B)"
        icon="sidebar"
        size="md"
        tone="muted"
        onclick={ontoggle}
      />
    </span>
  {/if}
  <div class="content" inert={collapsed}>
    <div class="header">{@render header()}</div>
    <div class="scroll">{@render children()}</div>
    {#if footer}<div class="footer">{@render footer()}</div>{/if}
  </div>
</nav>

<style>
  .sidebar {
    --rail: calc(var(--size-control) + 2 * var(--space-3));

    position: relative;
    flex: 0 0 var(--size-sidebar);
    min-width: var(--size-sidebar-min);
    display: flex;
    padding: var(--space-4) var(--space-3);
    background: var(--panel);
    border-right: var(--hairline) solid var(--line);
    overflow: hidden;
    transition:
      flex-basis var(--duration-base) var(--ease-standard),
      min-width var(--duration-base) var(--ease-standard);
  }

  .collapsed {
    flex-basis: var(--rail);
    min-width: var(--rail);
  }

  .toggle {
    position: absolute;
    top: var(--space-4);
    right: var(--space-3);
    z-index: 1;
  }

  /* Fixed width, so the content is clipped while the sidebar folds instead of reflowing. */
  .content {
    flex: none;
    width: calc(var(--size-sidebar) - 2 * var(--space-3));
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    transition:
      opacity var(--duration-base) var(--ease-standard),
      visibility 0s;
  }

  .collapsed .content {
    opacity: 0;
    visibility: hidden;
    transition:
      opacity var(--duration-base) var(--ease-standard),
      visibility 0s var(--duration-base);
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
