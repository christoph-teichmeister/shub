<script lang="ts">
  // The "+" on a house: a new Claude session in that project, with a first prompt or one of its buttons.
  import type { ButtonDef, ProjectView, StartSessionRequest } from '../../../../../shared/api.ts';
  import { onMount } from 'svelte';
  import TextField from '../../components/TextField/TextField.svelte';
  import { startSession } from '../../stores/state.svelte.ts';

  interface Props {
    project: ProjectView;
    /** Where it points, in px inside the scaled map, like the crab card. */
    x: number;
    y: number;
    below: boolean;
    onclose: () => void;
  }
  let { project, x, y, below, onclose }: Props = $props();
  let prompt = $state('');
  let busy = $state(false);
  const fieldId = 'village-pop-prompt';
  onMount(() => document.getElementById(fieldId)?.focus());

  // The crab walks out of its house on its own; the village stays open.
  async function start(extra: Partial<StartSessionRequest>) {
    busy = true;
    const s = await startSession({ projectId: project.id, kind: 'claude', ...extra });
    busy = false;
    if (s) onclose();
  }

  function submit(e: SubmitEvent) {
    e.preventDefault();
    void start(prompt.trim() ? { prompt: prompt.trim() } : {});
  }

  /** A button that asks for something takes the text above as its input. */
  const fromButton = (b: ButtonDef) =>
    void start({ buttonId: b.id, ...(b.ask !== 'nothing' && prompt.trim() && { input: prompt.trim() }) });
</script>

<form
  class="pop parchment"
  class:below
  style:left="{x}px"
  style:top="{y}px"
  aria-label="New session in {project.name}"
  data-keep
  onsubmit={submit}
>
  <strong>New session in {project.name}</strong>
  <TextField
    id={fieldId}
    label="First prompt (optional)"
    bind:value={prompt}
    rows={3}
    placeholder="What should the crab do?"
  />
  {#if project.buttons.length}
    <div class="skills" role="group" aria-label="Or start with a button">
      <span>Or start with a button</span>
      <div class="row">
        {#each project.buttons as b (b.id)}
          <button
            type="button"
            class="chip"
            disabled={busy}
            title={b.ask !== 'nothing' ? 'Takes the text above as its input' : undefined}
            onclick={() => fromButton(b)}>{b.label}</button
          >
        {/each}
      </div>
    </div>
  {/if}
  <div class="row end">
    <button type="button" class="btn small" onclick={onclose}>Cancel</button>
    <button type="submit" class="btn small primary" disabled={busy}>Start session</button>
  </div>
</form>

<style>
  .pop {
    position: absolute;
    z-index: var(--z-menu);
    transform: translate(-50%, -100%);
    width: var(--size-village-pop);
    display: flex;
    flex-direction: column;
    gap: var(--space-2-5);
    padding: var(--space-3) var(--space-3-5);
    border: var(--ring) solid var(--village-parchment-line);
    border-radius: var(--radius-xs);
    background: var(--village-parchment);
    box-shadow:
      0 0 0 var(--ring) var(--village-ink),
      0 var(--space-2-5) var(--space-6) var(--shadow);
    color: var(--village-ink);
    font: var(--text-base) / var(--leading-tight) var(--font-pixel);
  }

  .pop.below {
    transform: translate(-50%, 0);
  }

  strong {
    font-size: var(--text-lg);
  }

  .skills {
    display: flex;
    flex-direction: column;
    gap: var(--space-1-5);
    color: var(--village-ink-muted);
    font-size: var(--text-md);
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1-5);
  }

  .end {
    justify-content: flex-end;
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

  .chip:hover {
    background: var(--village-gold);
  }

  .chip:focus-visible {
    outline: var(--ring) solid var(--village-gold);
    outline-offset: var(--ring);
  }
</style>
