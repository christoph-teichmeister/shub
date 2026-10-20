<script lang="ts">
  import { PROMPT_SKIPPING_MODES, type PermissionMode, type Session } from '../../../../../shared/api.ts';
  import { STATUS_LABEL } from '../../status.ts';
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
    onclose?: () => void;
    onmenu?: (e: MouseEvent) => void;
  }
  let {
    session,
    selected = false,
    closing = false,
    renaming = $bindable(false),
    onselect,
    onrename,
    onclose,
    onmenu,
  }: Props = $props();

  const skipsPrompts = $derived(PROMPT_SKIPPING_MODES.includes(session.permissionMode as PermissionMode));

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
  class="tab {session.status}"
  class:selected
  class:closing
  inert={closing}
  role="presentation"
  oncontextmenu={onmenu ? (e) => (e.preventDefault(), onmenu(e)) : undefined}
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
    >
      {session.name}
    </button>
    <span id="status-{session.id}" class="visually-hidden">{STATUS_LABEL[session.status]}</span>
  {/if}
  {#if skipsPrompts}
    <span class="skips" title="Runs in {session.permissionMode} mode: Claude acts without asking"
      >{session.permissionMode === 'auto' ? 'auto' : 'bypass'}</span
    >
  {/if}
  {#if closing}
    <span class="badge-closing">Closing</span>
  {/if}
  {#each session.links.slice(0, 1) as link (link.url)}
    <a class="chip" href={link.url} target="_blank" rel="noreferrer">{link.label}</a>
  {/each}
  {#if onclose}
    <span class="close"
      ><IconButton label="Close {session.name}" icon="close" size="xs" tone="muted" onclick={onclose} /></span
    >
  {/if}
</div>

<style>
  .tab {
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
    border-color: var(--line);
    border-bottom-color: var(--term-bg);
    background: var(--term-bg);
    color: var(--fg);
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
    height: 100%;
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

  .chip {
    font-size: var(--text-xs);
    padding: 0 var(--space-1-5);
    border-radius: var(--radius-xs);
    background: var(--raised);
    color: var(--link);
    text-decoration: none;
  }

  .skips {
    font-size: var(--text-xs);
    padding: 0 var(--space-1-5);
    border-radius: var(--radius-xs);
    border: var(--hairline) solid var(--danger);
    color: var(--danger);
  }

  .close {
    visibility: hidden;
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

  .tab.selected .close,
  .tab:hover .close,
  .tab:focus-within .close {
    visibility: visible;
  }
</style>
