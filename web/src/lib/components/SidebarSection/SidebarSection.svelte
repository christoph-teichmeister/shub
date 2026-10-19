<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { SidebarSectionContent } from '../../../../../shared/api.ts';
  import Icon from '../Icon/Icon.svelte';
  import StatusBadge from '../StatusBadge/StatusBadge.svelte';

  type Entry = SidebarSectionContent['entries'][number];
  interface Props {
    title: string;
    badge?: SidebarSectionContent['badge'];
    /** Shown instead of `badge` only while collapsed, e.g. sessions that need you in a folded group. */
    collapsedBadge?: SidebarSectionContent['badge'];
    /** Plugin entries; rendered as small rows (link when `url`, button when `action`). */
    entries?: Entry[];
    onentry?: (entry: Entry) => void;
    /** Drop target for dragging projects into this group. */
    ondrop?: (e: DragEvent) => void;
    children?: Snippet;
  }
  let { title, badge, collapsedBadge, entries, onentry, ondrop, children }: Props = $props();
  let over = $state(false);

  // Remembered per browser; storage can be missing or throw (private window).
  const key = $derived(`shub.collapsed.${title}`);
  let collapsed = $state(false);
  $effect(() => {
    try {
      collapsed = localStorage.getItem(key) === '1';
    } catch {
      collapsed = false;
    }
  });
  const shown = $derived(collapsed ? (collapsedBadge ?? badge) : badge);
  function toggle() {
    collapsed = !collapsed;
    try {
      if (collapsed) localStorage.setItem(key, '1');
      else localStorage.removeItem(key);
    } catch {
      // not remembered, still toggles
    }
  }
</script>

<section
  class="section"
  class:over
  aria-label={title}
  ondragover={ondrop ? (e) => (e.preventDefault(), (over = true)) : undefined}
  ondragleave={() => (over = false)}
  ondrop={ondrop ? (e) => ((over = false), ondrop(e)) : undefined}
>
  <h2 class="title">
    <button type="button" class="toggle" aria-expanded={!collapsed} onclick={toggle}>
      <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} size="xs" weight={2} />
      <span class="grow">{title}</span>
    </button>
    {#if shown}<StatusBadge text={shown.text} tone={shown.tone} />{/if}
  </h2>
  {#if entries && !collapsed}
    <ul class="entries">
      {#each entries as entry (entry.id)}
        <li>
          {#if entry.url}
            <a class="entry {entry.tone ?? 'neutral'}" href={entry.url} target="_blank" rel="noreferrer">
              <span class="entry-title">{entry.title}</span>
              {#if entry.subtitle}<span class="entry-sub">{entry.subtitle}</span>{/if}
            </a>
          {:else}
            <button
              type="button"
              class="entry {entry.tone ?? 'neutral'}"
              disabled={!entry.action}
              onclick={() => onentry?.(entry)}
            >
              <span class="entry-title">{entry.title}</span>
              {#if entry.subtitle}<span class="entry-sub">{entry.subtitle}</span>{/if}
            </button>
          {/if}
        </li>
      {/each}
      {#if entries.length === 0}<li class="empty">Nothing here</li>{/if}
    </ul>
  {/if}
  {#if !collapsed && children}<div class="body">{@render children()}</div>{/if}
</section>

<style>
  .section {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    border-radius: var(--radius-md);
  }

  .over {
    outline: var(--hairline) dashed var(--primary);
  }

  .title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    margin: 0;
    padding: 0 var(--space-1-5) var(--space-1-5);
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--muted);
  }

  .toggle {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
    text-align: left;
    cursor: pointer;
  }

  .toggle:hover {
    color: var(--fg-2);
  }

  .grow {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .entries {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
  }

  .entry {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    padding: var(--space-1-5) var(--space-2-5);
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--fg-2);
    font-size: var(--text-md);
    text-align: left;
    text-decoration: none;
    cursor: pointer;
  }

  .entry:disabled {
    cursor: default;
  }

  .entry:hover:not(:disabled) {
    background: var(--raised);
  }

  .entry-sub {
    font-size: var(--text-xs);
    color: var(--muted);
  }

  :where(.entry:hover) .entry-sub {
    color: var(--fg-2);
  }

  .needs-you {
    background: var(--status-needs-you-bg);
    color: var(--status-needs-you-fg);
  }

  .needs-you .entry-sub {
    color: var(--status-needs-you);
  }

  .working .entry-sub {
    color: var(--status-working);
  }

  .done .entry-sub {
    color: var(--status-your-turn);
  }

  .empty {
    padding: var(--space-1) var(--space-2-5);
    font-size: var(--text-sm);
    color: var(--muted);
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
  }
</style>
