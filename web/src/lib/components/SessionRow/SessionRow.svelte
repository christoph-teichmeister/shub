<script lang="ts">
  import type { Session } from '../../../../../shared/api.ts';
  import { contextFill, idleWithAgents, statusLabel, waitTitle } from '../../status.ts';
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
    /** Double-click renames in place; only called on a change. */
    onrename?: (name: string) => void;
  }
  let {
    session,
    href,
    selected = false,
    closing = false,
    onmenu,
    ondragstart,
    ondrop,
    onunpin,
    onrename,
  }: Props = $props();
  let renaming = $state(false);
  let draft = $state('');
  let input = $state<HTMLInputElement>();
  $effect(() => {
    if (renaming && input) {
      draft = session.name;
      input.focus();
      input.select();
    }
  });
  function commit() {
    if (!renaming) return;
    renaming = false;
    const name = draft.trim();
    if (name && name !== session.name) onrename?.(name);
  }
  let over = $state<'before' | 'after' | null>(null);
  const fill = $derived(contextFill(session));
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
  draggable={ondragstart && !renaming ? 'true' : undefined}
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
  {#if renaming}
    <div class="link">
      <StatusDot status={session.status} idle={idleWithAgents(session)} />
      <label class="visually-hidden" for="rename-{session.id}">Session name</label>
      <input
        id="rename-{session.id}"
        class="rename"
        bind:this={input}
        bind:value={draft}
        onblur={commit}
        onkeydown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') renaming = false;
        }}
      />
    </div>
  {:else}
    <a
      class="link"
      {href}
      ondblclick={onrename ? (e) => (e.preventDefault(), (renaming = true)) : undefined}
      aria-current={selected ? 'page' : undefined}
      title={[session.pendingCommands?.map((c) => c.command).join('\n') ?? waitTitle(session), fill?.title]
        .filter(Boolean)
        .join('\n') || undefined}
    >
      <StatusDot status={session.status} idle={idleWithAgents(session)} />
      <span class="name">{session.name}</span>
      <span class="status">{closing ? 'Closing' : statusLabel(session)}</span>
    </a>
  {/if}
  {#if onmenu && !closing && !renaming}
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
  {#if fill}
    <span class="fill {fill.level}" style:--fill="{fill.pct}%" aria-hidden="true"></span>
  {/if}
  <!-- Last, so the hover menu opening beside it never shifts it. -->
  {#if onunpin && session.position != null && !closing}
    <IconButton label="Unpin {session.name}" icon="pin" size="xs" tone="muted" onclick={onunpin} />
  {/if}
</div>

<style>
  .row {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding-right: var(--space-1);
    border-radius: var(--radius-sm);
    color: var(--fg-2);
    transition: opacity var(--duration-slow) var(--ease-standard);
  }

  /* Context fill along the bottom edge: quiet until 120k tokens, then yellow, from 160k danger. */
  .fill {
    position: absolute;
    inset: auto 0 0;
    height: var(--space-0-5);
    border-radius: 0 0 var(--radius-sm) var(--radius-sm);
    background: linear-gradient(to right, var(--c) var(--fill), transparent var(--fill));
    pointer-events: none;
  }

  .low {
    --c: var(--muted);
  }

  .mid {
    --c: var(--yellow);
  }

  .high {
    --c: var(--danger);
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

  .rename {
    flex: 1 1 auto;
    min-width: 0;
    height: var(--size-control-xs);
    padding: 0 var(--space-1-5);
    border-radius: var(--radius-xs);
    border: var(--hairline) solid var(--primary);
    background: var(--bg);
    color: var(--fg);
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
