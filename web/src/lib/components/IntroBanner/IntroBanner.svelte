<script lang="ts">
  import type { Snippet } from 'svelte';
  import { store, stored } from '../../stored.ts';
  import IconButton from '../IconButton/IconButton.svelte';

  let { id, children }: { id: string; children: Snippet } = $props();
  // The id is fixed per view.
  // svelte-ignore state_referenced_locally
  const key = `shub.intro.${id}`;
  let gone = $state(stored(key) === '1');
</script>

{#if !gone}
  <div class="intro" role="note">
    <span>{@render children()}</span>
    <IconButton
      label="Dismiss"
      icon="close"
      size="xs"
      onclick={() => {
        gone = true;
        store(key, '1');
      }}
    />
  </div>
{/if}

<style>
  .intro {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-1-5) var(--space-3);
    border: var(--hairline) solid var(--line);
    border-radius: var(--radius-md);
    background: var(--panel);
    color: var(--fg-2);
    font-size: var(--text-sm);
  }
</style>
