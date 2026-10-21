<script lang="ts" module>
  export interface MenuItem {
    id: string;
    label: string;
    /** Muted text after the label, e.g. a linked card number. */
    hint?: string;
    /** Small line under the item, e.g. what a destructive action does. */
    description?: string;
    danger?: boolean;
    disabled?: boolean;
    /** Draws a divider before this item. */
    separator?: boolean;
  }
</script>

<script lang="ts">
  import { onMount } from 'svelte';

  interface Props {
    label: string;
    items: MenuItem[];
    onselect: (id: string) => void;
    onclose: () => void;
    /** Viewport position (fixed); omit to place it in the flow. */
    x?: number;
    y?: number;
  }
  let { label, items, onselect, onclose, x, y }: Props = $props();
  let menu = $state<HTMLDivElement>();

  const buttons = () => [...(menu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];

  onMount(() => {
    buttons()[0]?.focus();
    const away = (e: PointerEvent) => !menu?.contains(e.target as Node) && onclose();
    window.addEventListener('pointerdown', away, true);
    return () => window.removeEventListener('pointerdown', away, true);
  });

  function onkeydown(e: KeyboardEvent) {
    const list = buttons();
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') onclose();
    else if (e.key === 'ArrowDown') list[(i + 1) % list.length]?.focus();
    else if (e.key === 'ArrowUp') list[(i - 1 + list.length) % list.length]?.focus();
    else if (e.key === 'Home') list[0]?.focus();
    else if (e.key === 'End') list.at(-1)?.focus();
    else return;
    e.preventDefault();
  }
</script>

<div
  bind:this={menu}
  class="menu"
  class:floating={x !== undefined}
  role="menu"
  tabindex="-1"
  aria-label={label}
  style:left={x !== undefined ? `${x}px` : undefined}
  style:top={y !== undefined ? `${y}px` : undefined}
  {onkeydown}
>
  {#each items as item (item.id)}
    {#if item.separator}<div class="separator" role="separator"></div>{/if}
    <button
      type="button"
      role="menuitem"
      class="item"
      class:danger={item.danger}
      disabled={item.disabled}
      onclick={() => (onselect(item.id), onclose())}
    >
      {item.label}
      {#if item.hint}<span class="hint" title={item.hint}>{item.hint}</span>{/if}
    </button>
    {#if item.description}<span class="description">{item.description}</span>{/if}
  {/each}
</div>

<style>
  .menu {
    width: var(--size-menu);
    display: flex;
    flex-direction: column;
    padding: var(--space-1-5);
    border: var(--hairline) solid var(--line-strong);
    border-radius: var(--radius-lg);
    background: var(--panel);
    color: var(--fg);
    box-shadow: 0 var(--space-4) var(--space-8) var(--shadow);
  }

  .floating {
    position: fixed;
    z-index: var(--z-menu);
  }

  .item {
    display: flex;
    gap: var(--space-1-5);
    align-items: center;
    height: var(--size-control-md);
    padding: 0 var(--space-2-5);
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--fg);
    text-align: left;
    white-space: nowrap;
    cursor: pointer;
  }

  .item:hover,
  .item:focus-visible {
    background: var(--raised);
    outline: none;
  }

  .item:disabled {
    color: var(--muted);
    cursor: default;
  }

  .danger {
    color: var(--danger);
  }

  .hint {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--muted);
  }

  .item:hover .hint,
  .item:focus-visible .hint {
    color: var(--fg-2);
  }

  .description {
    padding: var(--space-0-5) var(--space-2-5) var(--space-1-5);
    font-size: var(--text-sm);
    color: var(--muted);
  }

  .separator {
    height: var(--hairline);
    margin: var(--space-1) 0;
    background: var(--line);
  }
</style>
