<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { Session } from '../../../../../shared/api.ts';
  import { equalize, resize, type Layout } from '../../overview.ts';
  import { idleWithAgents, STATUS_LABEL } from '../../status.ts';
  import IconButton from '../IconButton/IconButton.svelte';
  import StatusDot from '../StatusDot/StatusDot.svelte';

  interface Props {
    /** Up to `limit` sessions (four by default); more are ignored. */
    sessions: Session[];
    /** More than four panes: the overview. */
    limit?: number;
    /** Fixed column count (rows follow); without it 1, 2, 3 or 2 x 2 as before. */
    columns?: number;
    selectedId?: string | null;
    onselect?: (id: string) => void;
    /** Adds a minimize button to each header. */
    onminimize?: (id: string) => void;
    /** Project name and accent colour of a session: shown as a chip and a colour strip in its header. */
    projectOf?: (s: Session) => { name: string; accent?: string } | undefined;
    /** Extra header content per pane (e.g. Allow/Deny), shown before the minimize button. */
    actions?: Snippet<[Session]>;
    /** Adds an Open link (to the session's normal view) to each header. */
    hrefFor?: (s: Session) => string;
    /** Adds a maximize button (and double-click on the title) to each header; Esc is left to the terminal. */
    maximizable?: boolean;
    /** The maximized pane's session id (bindable), so the parent can move it, e.g. with the keyboard. */
    maximizedId?: string | null;
    /** Free-tiling layout (leaves are session ids): nested boxes with drag bars instead of the grid. Ignored while a pane
     *  is maximized. Without it the grid renders as before. */
    layout?: Layout | null;
    /** The layout after a bar was dragged (or double-clicked to equalize). */
    onlayout?: (layout: Layout) => void;
    /** Pane body, usually a compact TerminalView. */
    pane: Snippet<[Session]>;
  }
  let {
    sessions,
    limit = 4,
    columns,
    selectedId = null,
    onselect,
    onminimize,
    projectOf,
    actions,
    hrefFor,
    maximizable = false,
    maximizedId = $bindable(null),
    layout = null,
    onlayout,
    pane,
  }: Props = $props();
  // The maximized pane fills the grid; the others unmount (their sessions keep running, the terminals reattach on restore).
  const all = $derived(sessions.slice(0, limit));
  const shown = $derived(all.filter((s) => !maximizedId || s.id === maximizedId));
  const tree = $derived(layout && !maximizedId ? layout : null);
  const byId = $derived(new Map(all.map((s) => [s.id, s])));
  const BAR = 6; // px, keep in sync with .bar
  // Drags the bar before child `index + 1` of the split at `path`: the pointer's distance from where it went down is a
  // ratio of the split's free space, applied to the layout as it was then, so the divider follows the pointer exactly.
  function drag(e: PointerEvent, path: number[], index: number) {
    if (!tree || e.button) return;
    const bar = e.currentTarget as HTMLElement;
    const box = bar.parentElement!;
    const row = box.classList.contains('row');
    const rect = box.getBoundingClientRect();
    const span = (row ? rect.width : rect.height) - BAR * box.querySelectorAll(':scope > .bar').length;
    const start = tree;
    const from = row ? e.clientX : e.clientY;
    const stop = new AbortController();
    e.preventDefault();
    bar.setPointerCapture(e.pointerId);
    bar.addEventListener(
      'pointermove',
      (m) => span > 0 && onlayout?.(resize(start, path, index, ((row ? m.clientX : m.clientY) - from) / span)),
      { signal: stop.signal },
    );
    for (const type of ['pointerup', 'pointercancel'])
      bar.addEventListener(type, () => stop.abort(), { signal: stop.signal });
  }
  const toggleMax = (id: string) => (maximizedId = maximizedId === id ? null : id);
  $effect(() => {
    if (maximizedId && !all.some((s) => s.id === maximizedId)) maximizedId = null;
  });
</script>

{#snippet cell(session: Session, i: number)}
  {@const proj = projectOf?.(session)}
  <section
    class="pane {session.status}"
    class:selected={session.id === selectedId}
    aria-label={session.name}
    style:--accent={proj?.accent}
    style:grid-column={!tree && columns && !maximizedId && i === shown.length - 1 && shown.length % columns
      ? `span ${columns - (shown.length % columns) + 1}`
      : undefined}
    onfocusin={() => onselect?.(session.id)}
  >
    <div class="head" class:accented={proj?.accent}>
      <button
        type="button"
        class="title"
        onclick={() => onselect?.(session.id)}
        ondblclick={() => maximizable && toggleMax(session.id)}
      >
        <StatusDot status={session.status} idle={idleWithAgents(session)} />
        <span class="name">{session.name}</span>
        {#if proj}<span class="chip">{proj.name}</span>{/if}
        <span class="status">{STATUS_LABEL[session.status]}</span>
      </button>
      {@render actions?.(session)}
      {#if hrefFor}
        <IconButton label="Open" icon="open" size="xs" href={hrefFor(session)} />
      {/if}
      {#if maximizable}
        <IconButton
          label={maximizedId ? 'Restore' : 'Maximize'}
          icon={maximizedId ? 'restore' : 'maximize'}
          size="xs"
          onclick={() => toggleMax(session.id)}
        />
      {/if}
      {#if onminimize && !maximizedId}
        <IconButton label="Minimize" icon="minus" size="xs" onclick={() => onminimize(session.id)} />
      {/if}
    </div>
    <div class="body">{@render pane(session)}</div>
  </section>
{/snippet}

{#snippet node(t: Layout, path: number[], size: number)}
  <div class="box {typeof t === 'string' ? '' : t.dir}" style:flex="{size} 1 0">
    {#if typeof t === 'string'}
      {@const session = byId.get(t)}
      {#if session}{@render cell(session, 0)}{/if}
    {:else}
      {#each t.children as c, i (typeof c === 'string' ? c : `split ${i}`)}
        {#if i}
          <div
            class="bar"
            role="separator"
            aria-orientation={t.dir === 'row' ? 'vertical' : 'horizontal'}
            title="Drag to resize, double-click to equalize"
            onpointerdown={(e) => drag(e, path, i - 1)}
            ondblclick={() => onlayout?.(equalize(tree!, path))}
          ></div>
        {/if}
        {@render node(c, [...path, i], t.sizes[i])}
      {/each}
    {/if}
  </div>
{/snippet}

<div
  class="grid {maximizedId || tree ? 'n1' : columns ? 'cols' : `n${shown.length}`}"
  style:--cols={columns}
  style:--rows={columns ? Math.ceil(shown.length / columns) : undefined}
>
  {#if tree}
    {@render node(tree, [], 1)}
  {:else}
    {#each shown as session, i (session.id)}
      {@render cell(session, i)}
    {/each}
  {/if}
</div>

<style>
  .grid {
    flex: 1 1 auto;
    min-height: 0;
    display: grid;
    gap: var(--space-2);
    padding: var(--space-2);
    background: var(--panel);
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-template-rows: repeat(2, minmax(0, 1fr));
  }

  .cols {
    grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
    grid-template-rows: repeat(var(--rows), minmax(0, 1fr));
  }

  .n1 {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr);
  }

  .n2 {
    grid-template-rows: minmax(0, 1fr);
  }

  .box {
    min-width: 0;
    min-height: 0;
    display: flex;
  }

  .row {
    flex-direction: row;
  }

  .col {
    flex-direction: column;
  }

  .bar {
    flex: none;
    touch-action: none;
    border-radius: var(--radius-pill);
  }

  .bar:hover {
    background: var(--line);
  }

  .row > .bar {
    width: 6px;
    cursor: col-resize;
  }

  .col > .bar {
    height: 6px;
    cursor: row-resize;
  }

  .pane {
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: var(--hairline) solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--term-bg);
  }

  .box > .pane {
    flex: 1 1 0;
    min-width: 0;
  }

  .n3 .pane:first-child {
    grid-row: span 2;
  }

  .pane.selected {
    border: var(--ring) solid var(--primary);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 25%, transparent);
  }

  /* Needs you wins over selected: the orange frame stays, the glow just goes. */
  .pane.selected.needs-you {
    border-color: var(--status-needs-you);
    box-shadow: none;
  }

  .head.accented {
    border-left: 3px solid var(--accent);
  }

  .chip {
    flex: none;
    max-width: 10rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 0 var(--space-2);
    border: var(--hairline) solid var(--line);
    border-radius: var(--radius-pill);
    font-size: var(--text-xs);
    color: var(--muted);
  }

  .pane.needs-you {
    border: var(--ring) solid var(--status-needs-you);
  }

  .head {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: var(--size-tab);
    padding: 0 var(--space-3);
    background: var(--panel);
    color: var(--fg-2);
  }

  .title {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: 100%;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .needs-you .head {
    background: var(--status-needs-you-bg);
    color: var(--status-needs-you-fg);
  }

  .name {
    flex: 1 1 auto;
    font-weight: var(--weight-medium);
  }

  .status {
    font-size: var(--text-sm);
    color: var(--muted);
  }

  .needs-you .status {
    color: var(--status-needs-you);
  }

  .working .status {
    color: var(--status-working);
  }

  .your-turn .status {
    color: var(--status-your-turn);
  }

  .body {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
  }
</style>
