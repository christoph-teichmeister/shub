<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { Session } from '../../../../../shared/api.ts';
  import { equalize, rects, resize, setSizes, type Layout, type Rect } from '../../overview.ts';
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
  const shown = $derived(all.filter((s) => (!maximizedId || s.id === maximizedId) && (!place || place.has(s.id))));
  const tree = $derived(layout && !maximizedId ? layout : null);
  const byId = $derived(new Map(all.map((s) => [s.id, s])));
  // Tree mode: ONE flat keyed list of panes placed from rects(tree), so a pane never remounts when the tree changes shape.
  const place = $derived(tree ? rects(tree) : null);
  type Bar = {
    path: number[];
    index: number;
    row: boolean;
    sizes: number[];
    x: number;
    y: number;
    w: number;
    h: number;
  };
  // The drag bars as an overlay: (x, y) is the centre line of the divider, (w, h) the extent of its split.
  function barsOf(t: Layout, box: Rect, path: number[], out: Bar[] = []): Bar[] {
    if (typeof t === 'string') return out;
    const row = t.dir === 'row';
    let at = 0;
    t.children.forEach((c, i) => {
      const s = t.sizes[i];
      const r = row ? { ...box, x: box.x + at * box.w, w: box.w * s } : { ...box, y: box.y + at * box.h, h: box.h * s };
      if (i) out.push({ path, index: i - 1, row, sizes: t.sizes, x: r.x, y: r.y, w: box.w, h: box.h });
      barsOf(c, r, [...path, i], out);
      at += s;
    });
    return out;
  }
  const bars = $derived(tree ? barsOf(tree, { x: 0, y: 0, w: 1, h: 1 }, []) : []);
  // Drags a bar: the pointer's distance from where it went down is a ratio of the split's extent, applied to the split's
  // sizes as they were then but to the latest tree, so the divider follows the pointer exactly.
  function drag(e: PointerEvent, b: Bar) {
    if (!tree || e.button) return;
    const el = e.currentTarget as HTMLElement;
    const area = el.parentElement!;
    const pad = parseFloat(getComputedStyle(area).paddingLeft) || 0;
    const rect = area.getBoundingClientRect();
    const span = ((b.row ? rect.width : rect.height) - 2 * pad) * (b.row ? b.w : b.h);
    const from = b.row ? e.clientX : e.clientY;
    const stop = new AbortController();
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    el.addEventListener(
      'pointermove',
      (m) =>
        span > 0 &&
        tree &&
        onlayout?.(
          resize(setSizes(tree, b.path, b.sizes), b.path, b.index, ((b.row ? m.clientX : m.clientY) - from) / span),
        ),
      { signal: stop.signal },
    );
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
      el.addEventListener(type, () => stop.abort(), { signal: stop.signal });
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
    style:--x={place?.get(session.id)?.x}
    style:--y={place?.get(session.id)?.y}
    style:--w={place?.get(session.id)?.w}
    style:--h={place?.get(session.id)?.h}
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

<div
  class="grid {tree ? 'free' : maximizedId ? 'n1' : columns ? 'cols' : `n${shown.length}`}"
  style:--cols={columns}
  style:--rows={columns ? Math.ceil(shown.length / columns) : undefined}
>
  {#each shown as session, i (session.id)}
    {@render cell(session, i)}
  {/each}
  {#each bars as b (b.path.join() + ':' + b.index)}
    <div
      class="bar"
      class:row={b.row}
      role="separator"
      aria-orientation={b.row ? 'vertical' : 'horizontal'}
      title="Drag to resize, double-click to equalize"
      style:--x={b.x}
      style:--y={b.y}
      style:--w={b.w}
      style:--h={b.h}
      onpointerdown={(e) => drag(e, b)}
      ondblclick={() => onlayout?.(equalize(tree!, b.path))}
    ></div>
  {/each}
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

  /* Free layout: absolute panes and bars placed by the fractions --x --y --w --h of the padded area. */
  .free {
    display: block;
    position: relative;

    --area-w: calc(100% - 2 * var(--space-2));
    --area-h: calc(100% - 2 * var(--space-2));
    --g: 3px; /* half a bar */
  }

  .bar {
    position: absolute;
    touch-action: none;
    border-radius: var(--radius-pill);
  }

  .bar:hover {
    background: var(--line);
  }

  .bar.row {
    left: calc(var(--space-2) + var(--area-w) * var(--x) - var(--g));
    top: calc(var(--space-2) + var(--area-h) * var(--y));
    width: calc(2 * var(--g));
    height: calc(var(--area-h) * var(--h));
    cursor: col-resize;
  }

  .bar:not(.row) {
    left: calc(var(--space-2) + var(--area-w) * var(--x));
    top: calc(var(--space-2) + var(--area-h) * var(--y) - var(--g));
    width: calc(var(--area-w) * var(--w));
    height: calc(2 * var(--g));
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

  .free > .pane {
    position: absolute;
    left: calc(var(--space-2) + var(--area-w) * var(--x) + var(--g));
    top: calc(var(--space-2) + var(--area-h) * var(--y) + var(--g));
    width: calc(var(--area-w) * var(--w) - 2 * var(--g));
    height: calc(var(--area-h) * var(--h) - 2 * var(--g));
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
