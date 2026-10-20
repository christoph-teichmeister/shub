<script lang="ts">
  import type { Snippet } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import IconButton from '../IconButton/IconButton.svelte';

  interface Props {
    open: boolean;
    title: string;
    subtitle?: string;
    /** Label of the close button, e.g. "Close drawer (Alt G)". */
    closeLabel?: string;
    onclose: () => void;
    /** Leading tile next to the title. */
    icon?: Snippet;
    /** Buttons before the close button. */
    actions?: Snippet;
    footer?: Snippet;
    children: Snippet;
  }
  let { open, title, subtitle, closeLabel = 'Close', onclose, icon, actions, footer, children }: Props = $props();
  const id = `drawer-${Math.random().toString(36).slice(2, 8)}`;
  let aside = $state<HTMLElement>();
  // Same timing as the sidebar fold; the token is 0ms under prefers-reduced-motion.
  const duration = () =>
    parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--duration-base')) || 0;
</script>

<svelte:window
  onkeydown={(e) => {
    if (open && e.key === 'Escape' && !e.defaultPrevented && aside?.contains(e.target as Node)) onclose();
  }}
/>

{#if open}
  <div class="backdrop" aria-hidden="true" onclick={onclose} transition:fade={{ duration: duration() }}></div>
  <aside
    bind:this={aside}
    class="drawer"
    aria-labelledby={id}
    transition:fly={{ x: '100%', opacity: 1, duration: duration(), easing: cubicOut }}
  >
    <header class="head">
      {#if icon}{@render icon()}{/if}
      <div class="title">
        <h2 {id}>{title}</h2>
        {#if subtitle}<span class="subtitle">{subtitle}</span>{/if}
      </div>
      {#if actions}{@render actions()}{/if}
      <IconButton label={closeLabel} icon="close" size="md" tone="muted" onclick={onclose} />
    </header>
    <div class="body">{@render children()}</div>
    {#if footer}<footer class="foot">{@render footer()}</footer>{/if}
  </aside>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: var(--z-menu);
    background: var(--shadow);
  }

  .drawer {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    z-index: var(--z-menu);
    width: min(var(--size-drawer), 100%);
    display: flex;
    flex-direction: column;
    border-left: var(--hairline) solid var(--line-strong);
    background: var(--panel);
    box-shadow: 0 0 var(--space-12) var(--shadow);
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3-5) var(--space-4);
    border-bottom: var(--hairline) solid var(--line);
  }

  .title {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  h2 {
    margin: 0;
    font-size: var(--text-lg);
    font-weight: var(--weight-semibold);
  }

  .subtitle {
    font-size: var(--text-sm);
    color: var(--muted);
  }

  .body {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .foot {
    padding: var(--space-3) var(--space-4);
    border-top: var(--hairline) solid var(--line);
    font-size: var(--text-sm);
    color: var(--muted);
  }
</style>
