<script lang="ts">
  import type { Session } from '../../../../../shared/api.ts';
  import { COMPACT_AT, contextFill, STATUS_LABEL, waitTitle } from '../../status.ts';
  import Icon from '../Icon/Icon.svelte';
  import IconButton from '../IconButton/IconButton.svelte';
  import StatusDot from '../StatusDot/StatusDot.svelte';

  interface Props {
    session: Session;
    selected?: boolean;
    /** Fades out, says "Closing" and takes no input while the session shuts down. */
    closing?: boolean;
    /** Bindable: true while the name is being edited (double-click or Alt R). */
    renaming?: boolean;
    onselect?: () => void;
    onrename?: (name: string) => void;
    /** The –: takes the tab out of the bar, the session keeps running. */
    onhide?: () => void;
    /** The ✕: ends the session. */
    onclose?: () => void;
    /** The compact chip, shown from COMPACT_AT % context: sends /compact. */
    oncompact?: () => void;
    /** Right-click or the tab's menu button; `at` is where the menu opens. */
    onmenu?: (at: { x: number; y: number }) => void;
    /** Drag and drop to reorder; `after` when dropped on the right half. */
    ondragstart?: (e: DragEvent) => void;
    ondrop?: (after: boolean) => void;
  }
  let {
    session,
    selected = false,
    closing = false,
    renaming = $bindable(false),
    onselect,
    onrename,
    onhide,
    onclose,
    oncompact,
    onmenu,
    ondragstart,
    ondrop,
  }: Props = $props();
  let over = $state<'before' | 'after' | null>(null);
  const fill = $derived(contextFill(session));
  // Typed into a running turn, /compact would queue as a prompt: only offered on your turn.
  const canCompact = $derived(session.status === 'your-turn');
  // ✕ turns red under the pointer: it sits next to hide, so a slip shows before the click.
  let closeHot = $state(false);
  const half = (e: DragEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return e.clientX > r.left + r.width / 2 ? 'after' : 'before';
  };

  let el = $state<HTMLDivElement>();
  // Keeps the active tab visible when the bar overflows; 'nearest' leaves the page itself alone.
  $effect(() => {
    if (selected) el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });

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
</script>

<div
  bind:this={el}
  class="tab {session.status}"
  class:selected
  class:closing
  inert={closing}
  role="presentation"
  draggable={ondragstart && !renaming ? 'true' : undefined}
  {ondragstart}
  ondragover={ondrop ? (e) => (e.preventDefault(), (over = half(e))) : undefined}
  ondragleave={() => (over = null)}
  ondrop={ondrop ? (e) => (e.preventDefault(), (over = null), ondrop(half(e) === 'after')) : undefined}
  class:over-before={over === 'before'}
  class:over-after={over === 'after'}
  oncontextmenu={onmenu ? (e) => (e.preventDefault(), onmenu({ x: e.clientX, y: e.clientY })) : undefined}
>
  <StatusDot status={session.status} />
  {#if renaming}
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
  {:else}
    <button
      type="button"
      role="tab"
      class="label"
      aria-selected={selected}
      tabindex={selected ? 0 : -1}
      aria-describedby="status-{session.id}"
      onclick={onselect}
      ondblclick={() => (renaming = true)}
      title={[session.name, waitTitle(session), fill?.title].filter(Boolean).join('\n')}
    >
      {session.name}
    </button>
    <span id="status-{session.id}" class="visually-hidden">{STATUS_LABEL[session.status]}</span>
  {/if}
  {#if closing}
    <span class="badge-closing">Closing</span>
  {/if}
  {#if fill && fill.pct >= COMPACT_AT && oncompact && !closing}
    <button
      type="button"
      class="compact"
      disabled={!canCompact}
      title={canCompact ? `${fill.title}\nSend /compact` : `${fill.title}\nCompact once it is your turn`}
      onclick={oncompact}
      ><Icon name="restart" size="sm" />{fill.pct} %<span class="visually-hidden">, compact {session.name}</span
      ></button
    >
  {/if}
  {#each session.links.slice(0, 1) as link (link.url)}
    <a class="chip" href={link.url} target="_blank" rel="noreferrer">{link.label}</a>
  {/each}
  {#if onmenu || onhide || onclose}
    <span class="actions">
      {#if onmenu}
        <span
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
      {#if onhide}
        <span
          ><IconButton
            label="Hide {session.name} tab (stays in the sidebar)"
            icon="minus"
            size="xs"
            tone="muted"
            onclick={onhide}
          /></span
        >
      {/if}
      {#if onclose}
        <span role="presentation" onpointerenter={() => (closeHot = true)} onpointerleave={() => (closeHot = false)}
          ><IconButton
            label="Close {session.name}"
            icon="close"
            size="xs"
            tone={closeHot ? 'stop' : 'muted'}
            onclick={onclose}
          /></span
        >
      {/if}
    </span>
  {/if}
  {#if fill}
    <span class="fill {fill.level}" style:--fill="{fill.pct}%" aria-hidden="true"></span>
  {/if}
</div>

<style>
  /* Tabs shrink as one when the bar runs out of room (names end in …); the open one keeps its width. */
  .tab {
    position: relative;
    flex: 0 1 auto;
    min-width: var(--size-tab-min);
    overflow: hidden;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: var(--size-tab);
    padding: 0 var(--space-1) 0 var(--space-3-5);
    border: var(--hairline) solid transparent;
    border-radius: var(--radius-md) var(--radius-md) 0 0;
    color: var(--fg-2);
    white-space: nowrap;
    transition: opacity var(--duration-slow) var(--ease-standard);
  }

  .selected {
    flex-shrink: 0;
    border-color: var(--line);
    border-bottom-color: var(--term-bg);
    background: var(--term-bg);
    color: var(--fg);
  }

  .tab:not(.selected) {
    padding-right: var(--space-3-5);
  }

  .tab:not(.selected):hover {
    background: var(--raised);
    color: var(--fg);
  }

  .needs-you {
    color: var(--status-needs-you-fg);
  }

  .new:not(.selected, :hover) {
    color: var(--muted);
  }

  .label {
    min-width: 0;
    max-width: var(--size-tab-label);
    height: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  .rename {
    width: var(--size-rename);
    height: var(--size-control-xs);
    padding: 0 var(--space-1-5);
    border-radius: var(--radius-xs);
    border: var(--hairline) solid var(--primary);
    background: var(--bg);
    color: var(--fg);
  }

  /* Context fill along the bottom edge: quiet until 60 %, then yellow, from 80 % danger. */
  .fill {
    position: absolute;
    inset: auto 0 0;
    height: var(--space-0-5);
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

  .compact {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--text-xs);
    padding: 0 var(--space-1-5);
    border-radius: var(--radius-xs);
    border: var(--hairline) solid var(--danger);
    background: transparent;
    color: var(--danger);
    cursor: pointer;
  }

  .compact:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .chip {
    font-size: var(--text-xs);
    padding: 0 var(--space-1-5);
    border-radius: var(--radius-xs);
    background: var(--raised);
    color: var(--link);
    text-decoration: none;
  }

  .over-before {
    box-shadow: inset var(--ring) 0 0 var(--primary);
  }

  .over-after {
    box-shadow: inset calc(-1 * var(--ring)) 0 0 var(--primary);
  }

  .closing {
    opacity: 0.4;
  }

  .badge-closing {
    font-size: var(--text-xs);
    padding: 0 var(--space-1-5);
    border-radius: var(--radius-xs);
    border: var(--hairline) solid var(--line);
    color: var(--fg-2);
  }

  .actions {
    display: flex;
    flex: none;
    align-items: center;
  }

  /* Only the open tab has buttons: on a shrunk tab they would cover the name. Right-click still opens the menu. */
  .tab:not(.selected) .actions {
    display: none;
  }
</style>
