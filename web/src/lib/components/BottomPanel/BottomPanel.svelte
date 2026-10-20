<script lang="ts">
  import { tabKeys } from '../../tabKeys.ts';
  import type { Snippet } from 'svelte';
  import IconButton from '../IconButton/IconButton.svelte';

  interface Props {
    /** `closable` tabs get an "x" that calls `onclose`. */
    tabs: { id: string; label: string; closable?: boolean }[];
    active: string;
    onselect: (id: string) => void;
    /** "+" button: new plain terminal (Alt Shift T). */
    onnew?: () => void;
    onclose?: (id: string) => void;
    onhide: () => void;
    /** Small mono context, e.g. the compose project. */
    context?: string;
    children: Snippet;
  }
  let { tabs, active, onselect, onnew, onclose, onhide, context, children }: Props = $props();
</script>

<section class="panel" aria-label="Bottom panel">
  <div class="bar">
    <div class="tabs" role="tablist" tabindex="-1" aria-label="Bottom panel" onkeydown={tabKeys}>
      {#each tabs as tab (tab.id)}
        <button
          type="button"
          role="tab"
          class="tab"
          aria-selected={tab.id === active}
          tabindex={tab.id === active ? 0 : -1}
          onclick={() => onselect(tab.id)}>{tab.label}</button
        >
        {#if tab.closable && onclose}<IconButton
            label="Close {tab.label}"
            icon="close"
            size="xs"
            tone="muted"
            onclick={() => onclose(tab.id)}
          />{/if}
      {/each}
      {#if onnew}<IconButton
          label="New plain terminal (Alt Shift T)"
          icon="plus"
          size="xs"
          tone="muted"
          onclick={onnew}
        />{/if}
    </div>
    {#if context}<span class="context">{context}</span>{/if}
    <span class="spacer"></span>
    <IconButton label="Hide panel (Alt D)" icon="chevron-down" size="xs" tone="muted" onclick={onhide} />
  </div>
  <div class="content" role="tabpanel">{@render children()}</div>
</section>

<style>
  .panel {
    flex: 0 0 var(--size-panel);
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-top: var(--hairline) solid var(--line);
    background: var(--panel);
    font-size: var(--text-md);
  }

  .bar {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-2-5);
    height: var(--size-control);
    padding: 0 var(--space-2-5);
    border-bottom: var(--hairline) solid var(--line);
  }

  .tabs {
    display: flex;
    align-items: center;
    gap: var(--space-0-5);
  }

  .tab {
    height: var(--size-control-xs);
    padding: 0 var(--space-2-5);
    border: 0;
    border-bottom: var(--ring) solid transparent;
    background: transparent;
    color: var(--muted);
    font-size: var(--text-md);
    cursor: pointer;
  }

  .tab[aria-selected='true'] {
    border-bottom-color: var(--primary);
    color: var(--fg);
    font-weight: var(--weight-semibold);
  }

  .context {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--muted);
  }

  .spacer {
    flex: 1 1 auto;
  }

  .content {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
  }
</style>
