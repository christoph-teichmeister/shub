<script lang="ts">
  import type { Session } from '../../../../../shared/api.ts';
  import { statusLabel, waitTitle } from '../../status.ts';
  import IconButton from '../IconButton/IconButton.svelte';
  import StatusDot from '../StatusDot/StatusDot.svelte';

  interface Props {
    session: Session;
    href: string;
    selected?: boolean;
    /** Fades out and says "Closing" instead of the status while the session shuts down. */
    closing?: boolean;
    /** Right-click or the hover menu button; `at` is where the menu opens. */
    onmenu?: (at: { x: number; y: number }) => void;
    /** Drag and drop to reorder; `after` when dropped on the lower half. */
    ondragstart?: (e: DragEvent) => void;
    ondrop?: (after: boolean) => void;
    /** Shows a pin on a pinned session (dragged or pinned via the menu, it stays on top); clicking it lets the session sort by status again. */
    onunpin?: () => void;
  }
  let { session, href, selected = false, closing = false, onmenu, ondragstart, ondrop, onunpin }: Props = $props();
  let over = $state<'before' | 'after' | null>(null);
  const half = (e: DragEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return e.clientY > r.top + r.height / 2 ? 'after' : 'before';
  };
</script>

<div
  class="row {session.status}"
  class:selected
  class:closing
  inert={closing}
  role="presentation"
  draggable={ondragstart ? 'true' : undefined}
  {ondragstart}
  ondragover={ondrop ? (e) => (e.preventDefault(), e.stopPropagation(), (over = half(e))) : undefined}
  ondragleave={() => (over = null)}
  ondrop={ondrop
    ? (e) => (e.preventDefault(), e.stopPropagation(), (over = null), ondrop(half(e) === 'after'))
    : undefined}
  class:over-before={over === 'before'}
  class:over-after={over === 'after'}
  oncontextmenu={onmenu ? (e) => (e.preventDefault(), onmenu({ x: e.clientX, y: e.clientY })) : undefined}
>
  <a
    class="link"
    {href}
    aria-current={selected ? 'page' : undefined}
    title={session.pendingCommands?.map((c) => c.command).join('\n') ?? waitTitle(session)}
  >
    <StatusDot status={session.status} />
    <span class="name">{session.name}</span>
    <span class="status">{closing ? 'Closing' : statusLabel(session)}</span>
  </a>
  {#if onmenu && !closing}
    <span class="actions"
      ><IconButton
        label="Menu for {session.name}"
        icon="more"
        size="xs"
        tone="muted"
        onclick={(e) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          onmenu({ x: r.left, y: r.bottom });
        }}
      /></span
    >
  {/if}
  <!-- Last, so the hover menu opening beside it never shifts it. -->
  {#if onunpin && session.position != null && !closing}
    <IconButton label="Unpin {session.name}" icon="pin" size="xs" tone="muted" onclick={onunpin} />
  {/if}
</div>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding-right: var(--space-1);
    border-radius: var(--radius-sm);
    color: var(--fg-2);
    transition: opacity var(--duration-slow) var(--ease-standard);
  }

  .link {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-1-5) var(--space-1) var(--space-2-5);
    color: inherit;
    text-decoration: none;
  }

  .over-before {
    box-shadow: inset 0 var(--ring) 0 var(--primary);
  }

  .over-after {
    box-shadow: inset 0 calc(-1 * var(--ring)) 0 var(--primary);
  }

  .closing {
    opacity: 0.4;
  }

  .row:hover,
  .row:focus-within,
  .selected {
    background: var(--raised);
    color: var(--fg);
  }

  .name {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .status {
    flex: none;
    font-size: var(--text-xs);
    color: var(--muted);
  }

  .actions {
    display: none;
  }

  .row:hover .actions,
  .row:focus-within .actions {
    display: flex;
  }

  /* muted on raised is below 4.5:1 */
  :where(.row:hover, .row:focus-within, .selected) .status {
    color: var(--fg-2);
  }

  .new:not(:hover, .selected) .name {
    color: var(--muted);
  }

  .needs-you {
    background: var(--status-needs-you-bg);
    color: var(--status-needs-you-fg);
  }

  .needs-you .status {
    color: var(--status-needs-you-fg);
  }

  .working .status {
    color: var(--status-working);
  }

  .your-turn .status {
    color: var(--status-your-turn);
  }

  .row:has(.actions):hover .status,
  .row:has(.actions):focus-within .status {
    display: none;
  }
</style>
