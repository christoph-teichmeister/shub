<script lang="ts">
  import type { Session } from '../../../../../shared/api.ts';
  import { api } from '../../stores/api.ts';
  import { toastError } from '../../stores/toasts.svelte.ts';
  import Button from '../Button/Button.svelte';

  interface Props {
    session: Session;
    phone?: boolean;
  }
  let { session, phone = false }: Props = $props();

  /** Sends the label shown too: the server refuses when Claude asked something else meanwhile. */
  function pick(index: number, choice: string) {
    void api('sessionChoice', { params: { id: session.id }, body: { index, choice } }).catch(toastError);
  }
</script>

{#if session.pendingChoices?.length}
  <section class="choices" class:phone aria-label="Answers Claude offers">
    {#each session.pendingChoices as choice, i (choice)}
      <Button variant={i === 0 ? 'primary' : 'secondary'} block={phone} onclick={() => pick(i, choice)}>{choice}</Button
      >
    {/each}
  </section>
{/if}

<style>
  .choices {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: 0 var(--space-4) var(--space-3);
  }

  .phone {
    margin: 0;
    padding: var(--space-2) var(--space-3);
  }
</style>
