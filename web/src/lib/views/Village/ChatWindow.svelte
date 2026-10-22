<script lang="ts">
  // The live terminal of the crabs you opened, in a window floating over the map: a tab per crab, dragged by its
  // title bar, resized at its corner, kept inside the browser window. It opens beside the crab you opened (`near`)
  // until you first drag or resize it; from then on that rect stays in localStorage and wins.
  import type { Session } from '../../../../../shared/api.ts';
  import TerminalView from '../../components/TerminalView/TerminalView.svelte';
  import { app, sessionHref } from '../../stores/state.svelte.ts';
  import { STATUS_LABEL } from '../../status.ts';
  import { tabKeys } from '../../tabKeys.ts';
  import { beside, clampRect, type Rect } from '../../village/chats.ts';

  interface Props {
    tabs: Session[];
    active: string;
    onselect: (id: string) => void;
    onclosetab: (id: string) => void;
    /** The x and Alt W: closes every tab. */
    onclose: () => void;
    /** The opened crab's box in browser-window px: the window opens beside it (read once, when it opens). */
    near?: Rect;
  }
  let { tabs, active, onselect, onclosetab, onclose, near }: Props = $props();

  const KEY = 'shub-village-chat';
  let iw = $state(innerWidth);
  let ih = $state(innerHeight);
  let rect = $state<Rect>(load());
  /** Folded to the title bar; the terminal stays mounted so the session keeps its scrollback. */
  let folded = $state(false);
  const box = $derived(clampRect(rect, iw, ih));
  const shown = $derived(tabs.find((s) => s.id === active) ?? tabs[0]);
  const accent = (s: Session) => app.projects.find((p) => p.id === s.projectId)?.accent;

  function load(): Rect {
    try {
      const r = JSON.parse(localStorage.getItem(KEY) ?? '');
      if ([r.x, r.y, r.w, r.h].every(Number.isFinite)) return r;
    } catch {}
    const w = Math.min(720, innerWidth - 48);
    const h = Math.min(460, innerHeight - 48);
    if (near) return beside(near, w, h, innerWidth, innerHeight);
    // No crab to sit beside: bottom right, out of the way of the desk in the middle.
    return { x: innerWidth - w - 24, y: innerHeight - h - 24, w, h };
  }

  let el = $state<HTMLElement>();
  /** Puts the keyboard into the shown terminal (opening a crab that already has the shown tab). */
  export function focus() {
    el?.querySelector('textarea')?.focus();
  }

  /** A pointer on the title bar moves the window, on the corner grip resizes it. */
  let grab: { id: number; x: number; y: number; r: Rect; resize: boolean; moved?: boolean } | null = null;
  function down(e: PointerEvent, resize: boolean) {
    if (e.button !== 0 || (!resize && (e.target as Element).closest('button, a'))) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    grab = { id: e.pointerId, x: e.clientX, y: e.clientY, r: box, resize };
  }
  function move(e: PointerEvent) {
    if (!grab || e.pointerId !== grab.id) return;
    const { r } = grab;
    const dx = e.clientX - grab.x;
    const dy = e.clientY - grab.y;
    grab.moved = true;
    rect = clampRect(
      grab.resize
        ? { ...r, w: Math.min(r.w + dx, iw - r.x), h: Math.min(r.h + dy, ih - r.y) }
        : { ...r, x: r.x + dx, y: r.y + dy },
      iw,
      ih,
    );
  }
  function up() {
    if (!grab) return;
    // A plain click on the title bar keeps the placement beside the crab; only a drag or resize is saved.
    const { moved } = grab;
    grab = null;
    if (!moved) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(rect));
    } catch {}
  }
</script>

<svelte:window bind:innerWidth={iw} bind:innerHeight={ih} />

<section
  class="chat"
  bind:this={el}
  aria-label="Chat"
  style:left="{box.x}px"
  style:top="{box.y}px"
  style:width="{box.w}px"
  style:height={folded ? 'auto' : `${box.h}px`}
>
  <div
    class="bar"
    role="presentation"
    onpointerdown={(e) => down(e, false)}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
  >
    <div class="tabs" role="tablist" aria-label="Open chats" tabindex="-1" onkeydown={tabKeys}>
      {#each tabs as s (s.id)}
        {@const on = s.id === shown.id}
        <span class="tab" class:on>
          <button
            type="button"
            role="tab"
            aria-selected={on}
            tabindex={on ? 0 : -1}
            title="{s.name} · {STATUS_LABEL[s.status]}"
            onclick={() => onselect(s.id)}
            ><span class="swatch {s.status}" aria-hidden="true"></span><span class="name">{s.name}</span><span
              class="visually-hidden">, {STATUS_LABEL[s.status]}</span
            ></button
          >
          <button
            type="button"
            class="x"
            tabindex={on ? 0 : -1}
            aria-label="Close {s.name}"
            onclick={() => onclosetab(s.id)}>×</button
          >
        </span>
      {/each}
    </div>
    <span class="grow"></span>
    <a class="btn small" href={sessionHref(shown)} title="Leave the village for the session's full view"
      >Open full view</a
    >
    <button
      type="button"
      class="btn small"
      aria-label={folded ? 'Expand chat' : 'Minimize chat'}
      aria-expanded={!folded}
      title={folded ? 'Expand' : 'Minimize'}
      onclick={() => (folded = !folded)}>{folded ? '▢' : '–'}</button
    >
    <button type="button" class="btn small" aria-label="Close chat" title="Close (Alt W)" onclick={onclose}>×</button>
  </div>
  <div class="body" role="tabpanel" aria-label={shown.name} hidden={folded}>
    {#key shown.id}
      <TerminalView sessionId={shown.id} accent={accent(shown)} label={shown.name} focused compact />
    {/key}
  </div>
  <span
    class="grip"
    hidden={folded}
    role="presentation"
    title="Resize"
    onpointerdown={(e) => down(e, true)}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
  ></span>
</section>

<style>
  .chat {
    position: fixed;
    z-index: var(--z-menu);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: var(--space-1) solid var(--village-wood-dark);
    border-radius: var(--radius-sm);
    background: var(--term-bg);
    box-shadow:
      0 0 0 var(--ring) var(--village-ink),
      0 var(--space-2-5) var(--space-6) var(--shadow);
    font-family: var(--font-pixel);
  }

  .bar {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--space-1-5);
    padding: var(--space-1-5);
    border-bottom: var(--space-0-5) solid var(--village-wood-dark);
    background: var(--village-wood);
    cursor: grab;
    user-select: none;
    touch-action: none;
  }

  .tabs {
    display: flex;
    gap: var(--space-1);
    min-width: 0;
    overflow-x: auto;
  }

  .tab {
    display: inline-flex;
    flex: none;
    align-items: center;
    max-width: var(--size-tab-label);
    border: var(--space-0-5) solid var(--village-wood-dark);
    border-radius: var(--radius-xs);
    background: var(--village-paper);
    color: var(--village-ink);
  }

  .tab.on {
    background: var(--village-parchment);
    box-shadow: 0 var(--space-0-5) 0 var(--village-ink);
  }

  .tab button {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    min-width: 0;
    min-height: var(--size-control-sm);
    padding: 0 var(--space-2);
    border: 0;
    background: none;
    color: inherit;
    font: var(--weight-semibold) var(--text-md) var(--font-pixel);
    cursor: pointer;
  }

  .tab button:focus-visible {
    outline: var(--ring) solid var(--village-gold);
    outline-offset: calc(var(--ring) * -1);
  }

  .tab .x {
    padding: 0 var(--space-1-5);
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .swatch {
    flex: none;
    width: var(--space-2-5);
    height: var(--space-2-5);
    border: var(--ring) solid var(--village-ink);
    background: var(--village-parchment);
  }

  .swatch.needs-you {
    background: var(--status-needs-you);
  }

  .swatch.your-turn {
    background: var(--status-your-turn);
  }

  .swatch.working,
  .swatch.starting {
    background: var(--status-working);
  }

  .swatch.waiting {
    background: var(--village-sky);
  }

  .swatch.paused,
  .swatch.exited {
    background: var(--village-wood);
  }

  .grow {
    flex: 1 1 var(--space-8);
  }

  .body[hidden],
  .grip[hidden] {
    display: none;
  }

  .body {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-height: 0;
  }

  .grip {
    position: absolute;
    right: 0;
    bottom: 0;
    width: var(--space-4);
    height: var(--space-4);
    background: linear-gradient(135deg, transparent 50%, var(--village-wood-dark) 0);
    cursor: nwse-resize;
    touch-action: none;
  }
</style>
