<script lang="ts">
  // Alt N in the overview: pick the project for a new session, so you never leave the grid.
  import type { ProjectView } from '../../../../../shared/api.ts';
  import Dialog from '../../components/Dialog/Dialog.svelte';
  import ProjectIcon from '../../components/ProjectIcon/ProjectIcon.svelte';
  import { app } from '../../stores/state.svelte.ts';

  interface Props {
    open: boolean;
    /** Listed first and preselected. */
    preferred?: string;
    onpick: (p: ProjectView) => void;
    onclose: () => void;
  }
  let { open, preferred, onpick, onclose }: Props = $props();

  let query = $state('');
  let cursor = $state(0);
  const q = $derived(query.trim().toLowerCase());
  const list = $derived(
    app.projects
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.group.toLowerCase().includes(q))
      .sort((a, b) => Number(b.id === preferred) - Number(a.id === preferred)),
  );

  $effect(() => {
    void q;
    void open;
    cursor = 0;
    if (!open) query = '';
  });

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') cursor = Math.min(cursor + 1, list.length - 1);
    else if (e.key === 'ArrowUp') cursor = Math.max(cursor - 1, 0);
    else if (e.key === 'Enter' && list[cursor]) onpick(list[cursor]);
    else return;
    e.preventDefault();
    document.getElementById(`pick-${cursor}`)?.scrollIntoView({ block: 'nearest' });
  }
</script>

<Dialog {open} title="New session in which project?" {onclose}>
  <div class="picker">
    <label class="visually-hidden" for="pick-q">Project</label>
    <!-- svelte-ignore a11y_autofocus -->
    <input
      id="pick-q"
      type="search"
      bind:value={query}
      placeholder="Project or group"
      autocomplete="off"
      autofocus
      {onkeydown}
    />
    <div class="results" role="listbox" aria-label="Projects">
      {#each list as p, i (p.id)}
        <div
          id="pick-{i}"
          class="hit"
          class:active={i === cursor}
          role="option"
          tabindex="-1"
          aria-selected={i === cursor}
          onpointermove={() => (cursor = i)}
          onclick={() => onpick(p)}
          onkeydown={() => {}}
        >
          <ProjectIcon icon={p.resolvedIcon} name={p.name} />
          <span class="name">{p.name}</span>
          <span class="group">{p.group}</span>
        </div>
      {:else}
        <p class="empty">No project found</p>
      {/each}
    </div>
  </div>
</Dialog>

<style>
  .picker {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  input {
    height: var(--size-control-lg);
    padding: 0 var(--space-3);
    border: var(--hairline) solid var(--line-strong);
    border-radius: var(--radius-md);
    background: var(--bg);
    color: var(--fg);
  }

  .results {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    max-height: 50vh;
    overflow-y: auto;
  }

  .hit {
    display: flex;
    align-items: center;
    gap: var(--space-2-5);
    padding: var(--space-2);
    border-radius: var(--radius-md);
    cursor: pointer;
  }

  .hit.active {
    background: var(--raised);
  }

  .name {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .group,
  .empty {
    font-size: var(--text-sm);
    color: var(--muted);
  }

  .empty {
    margin: 0;
    padding: var(--space-3) var(--space-2);
  }
</style>
