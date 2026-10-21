<script lang="ts">
  // "+ New project": builds a house (POST /api/projects, the folder made with git init when missing), then its
  // first crab comes out (POST /api/sessions). The village stays open.
  import { untrack } from 'svelte';
  import type { Approval, CreateProjectRequest, ImportCandidate, ProjectView } from '../../../../../shared/api.ts';
  import Checkbox from '../../components/Checkbox/Checkbox.svelte';
  import Dialog from '../../components/Dialog/Dialog.svelte';
  import TextField from '../../components/TextField/TextField.svelte';
  import { api } from '../../stores/api.ts';
  import { app, loadProjects, startSession } from '../../stores/state.svelte.ts';
  import { toast, toastError } from '../../stores/toasts.svelte.ts';
  import { PROJECT_COLORS } from '../../tokens/tokens.ts';
  import { HAT_NAMES, outfitOf } from '../../village/world.ts';

  interface Props {
    /** The district of the lot it was opened from; null from the header. */
    group: string | null;
    onclose: () => void;
  }
  let { group: preset, onclose }: Props = $props();
  const NEW = '\u0000new';

  /** Districts in map order: config.json first, then groups only projects name. */
  const groups = $derived([...new Set([...(app.config?.groups ?? []), ...app.projects.map((p) => p.group)])]);
  let name = $state('');
  let path = $state('');
  /** The folder follows the name until it is edited. */
  let pathEdited = $state(false);
  let create = $state(true);
  let pick = $state(untrack(() => preset ?? groups[0] ?? NEW));
  let newGroup = $state('');
  let color = $state<string>(PROJECT_COLORS[0].value);
  let prompt = $state('');
  let busy = $state(false);
  let suggestions = $state<ImportCandidate[]>([]);

  const group = $derived(pick === NEW ? newGroup.trim() : pick);
  const outfit = $derived(outfitOf(group, pick === NEW ? groups.length : groups.indexOf(pick)));
  /** Next to the other projects of the district, else next to any project. */
  const parent = $derived.by(() => {
    const p = app.projects.find((x) => x.group === group) ?? app.projects[0];
    return p ? p.path.replace(/\/[^/]+\/?$/, '') : '';
  });
  $effect(() => {
    if (!pathEdited && parent && name.trim()) path = `${parent}/${name.trim()}`;
  });

  // Folders from your Claude history that are no project yet: the first-run import scan.
  $effect(() => {
    void api<ImportCandidate[]>('importCandidates').then(
      (list) => (suggestions = list),
      () => {},
    );
  });

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    const body: CreateProjectRequest = {
      name: name.trim(),
      path: path.trim(),
      group,
      icon: { kind: 'symbol', symbol: 'home', color },
      create,
    };
    const res = await api<ProjectView | { approval: Approval }>('projectCreate', { body }).catch(toastError);
    busy = false;
    if (!res) return;
    onclose();
    if ('approval' in res) return toast('Waiting for your approval', 'needs-you');
    await loadProjects();
    toast(`Built a house for ${res.name}`);
    await startSession({ projectId: res.id, kind: 'claude', ...(prompt.trim() && { prompt: prompt.trim() }) });
  }
</script>

<div class="parchment">
  <Dialog open title="Build a new house" {onclose}>
    <form id="village-new-project" class="form" onsubmit={submit}>
      <div class="preview">
        <span class="crab" aria-hidden="true">
          <img src="/village/crab-idle0.svg" alt="" />
          <span style:background={color} style:mask-image="url(/village/hat-{outfit}-mask.svg)"></span>
          <img src="/village/hat-{outfit}-detail.svg" alt="" />
        </span>
        <span class="hint">{HAT_NAMES[outfit]} for {group || 'the new district'}, in the project colour</span>
      </div>
      <TextField label="Name" bind:value={name} required autocomplete="off" />
      <TextField
        label="Folder"
        bind:value={path}
        mono
        required
        pattern="/.*"
        title="An absolute path"
        list="village-folders"
        autocomplete="off"
        hint={suggestions.length ? 'Suggestions: folders from your Claude history that are no project yet' : undefined}
        oninput={() => (pathEdited = true)}
      />
      <datalist id="village-folders">
        {#each suggestions as s (s.path)}<option value={s.path}>{s.name}</option>{/each}
      </datalist>
      <Checkbox label="Create the folder and run git init if it does not exist" bind:checked={create} />
      <div class="field" role="group" aria-label="District">
        <span class="label">District (group)</span>
        <div class="row">
          {#each [...groups, NEW] as g (g)}
            <button type="button" class="chip" aria-pressed={pick === g} onclick={() => (pick = g)}
              >{g === NEW ? '+ New district' : g}</button
            >
          {/each}
        </div>
      </div>
      {#if pick === NEW}
        <TextField label="New district name" bind:value={newGroup} required autocomplete="off" />
      {/if}
      <div class="field" role="group" aria-label="Colour">
        <span class="label">Colour</span>
        <div class="row">
          {#each PROJECT_COLORS as c (c.value)}
            <button
              type="button"
              class="swatch"
              style:background={c.value}
              aria-label={c.name}
              aria-pressed={color === c.value}
              onclick={() => (color = c.value)}
            ></button>
          {/each}
        </div>
      </div>
      <TextField
        label="First prompt (optional)"
        bind:value={prompt}
        rows={2}
        placeholder="What should the first crab do?"
      />
    </form>
    {#snippet actions()}
      <button type="button" class="btn" onclick={onclose}>Cancel</button>
      <button type="submit" class="btn primary" form="village-new-project" disabled={busy}
        >Build house and start session</button
      >
    {/snippet}
  </Dialog>
</div>

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3-5);
  }

  .preview {
    display: flex;
    align-items: center;
    gap: var(--space-3-5);
  }

  .crab {
    position: relative;
    flex: none;
    width: calc(var(--village-px) * 52);
    height: calc(var(--village-px) * 44);
    border: var(--space-0-5) solid var(--village-wood-dark);
    border-radius: var(--radius-xs);
    background: var(--village-grass) url('/village/tile-grass.svg');
    background-size: calc(var(--village-px) * 32);
  }

  .crab > * {
    position: absolute;
    left: calc(50% - var(--village-px) * 19);
    bottom: var(--space-1);
    width: calc(var(--village-px) * 38);
    height: calc(var(--village-px) * 38);
    image-rendering: pixelated;
  }

  .crab span {
    mask-size: 100% 100%;
  }

  .hint,
  .label {
    color: var(--village-ink-muted);
    font-size: var(--text-md);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1-5);
  }

  .label {
    color: var(--village-ink);
    font-weight: var(--weight-medium);
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1-5);
  }

  .chip {
    min-height: var(--size-control-sm);
    padding: 0 var(--space-2-5);
    border: var(--space-0-5) solid var(--village-parchment-line);
    border-radius: var(--radius-xs);
    background: var(--village-paper);
    color: var(--village-ink);
    font: var(--weight-semibold) var(--text-md) var(--font-pixel);
    cursor: pointer;
  }

  .chip[aria-pressed='true'] {
    border-color: var(--village-ink);
    background: var(--village-gold);
  }

  .swatch {
    width: var(--size-control-sm);
    height: var(--size-control-sm);
    padding: 0;
    border: var(--space-0-5) solid var(--village-ink);
    border-radius: var(--radius-xs);
    cursor: pointer;
  }

  .swatch[aria-pressed='true'] {
    box-shadow:
      0 0 0 var(--space-0-5) var(--village-parchment),
      0 0 0 var(--space-1-5) var(--village-ink);
  }

  .chip:focus-visible,
  .swatch:focus-visible {
    outline: var(--ring) solid var(--village-gold);
    outline-offset: var(--space-1);
  }
</style>
