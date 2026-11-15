<script lang="ts">
  import { saved } from '../../stores/saved.svelte.ts';

  /** Inline "Changes save automatically" line that says "Saved" for a moment after each save, or why one did not happen. */
  let { saving = false, problem = '' }: { saving?: boolean; problem?: string } = $props();

  let showSaved = $state(false);
  $effect(() => {
    if (!saved.at) return;
    showSaved = true;
    const t = setTimeout(() => (showSaved = false), 2000);
    return () => clearTimeout(t);
  });
</script>

<span class="muted small" role="status" class:problem data-testid="save-status"
  >{problem ? `Not saved: ${problem}` : saving ? 'Saving…' : showSaved ? 'Saved' : 'Changes save automatically'}</span
>

<style>
  .problem {
    color: var(--fg);
    font-weight: var(--weight-medium);
  }
</style>
