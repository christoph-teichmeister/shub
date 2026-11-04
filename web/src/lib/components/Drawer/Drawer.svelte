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
  let dialog = $state<HTMLDialogElement>();
  // Modal like Dialog: focus moves in and stays, the page behind is inert. The panel mounts once the dialog is
  // open, so a terminal inside keeps the focus it takes; the dialog closes when the panel has slid out.
  let shown = $state(false);
  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    shown = open;
  });
  // Same timing as the sidebar fold; the token is 0ms under prefers-reduced-motion.
  // The CSS minifier rewrites 200ms as .2s, so read the unit too.
  const duration = () => {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--duration-base').trim();
    return (parseFloat(v) || 0) * (v.endsWith('ms') ? 1 : 1000);
  };
</script>

<dialog
  bind:this={dialog}
  class="layer"
  aria-labelledby={id}
  oncancel={(e) => {
    e.preventDefault(); // Escape: slide out first, like the close button
    onclose();
  }}
  onclose={() => open && onclose()}
>
  {#if shown}
    <div class="backdrop" aria-hidden="true" onclick={onclose} transition:fade={{ duration: duration() }}></div>
    <div
      class="drawer"
      transition:fly={{ x: '100%', opacity: 1, duration: duration(), easing: cubicOut }}
      onoutroend={() => dialog?.close()}
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
    </div>
  {/if}
</dialog>

<style>
  /* The whole window in the top layer; the backdrop and the panel inside it draw. */
  .layer {
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100%;
    max-width: none;
    max-height: none;
    margin: 0;
    padding: 0;
    border: 0;
    overflow: hidden;
    background: transparent;
    color: inherit;
  }

  .layer::backdrop {
    background: transparent;
  }

  .backdrop {
    position: fixed;
    inset: 0;
    background: var(--shadow);
  }

  .drawer {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
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
