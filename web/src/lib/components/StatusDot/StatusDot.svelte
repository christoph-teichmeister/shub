<script lang="ts">
  import type { SessionStatus } from '../../../../../shared/api.ts';
  import Icon from '../Icon/Icon.svelte';

  let { status }: { status: SessionStatus } = $props();
</script>

{#if status === 'your-turn'}
  <span class="mark your-turn" aria-hidden="true"><Icon name="check" size="xs" weight={2.4} /></span>
{:else if status === 'paused'}
  <span class="mark paused" aria-hidden="true"><Icon name="pause" size="xs" weight={2.4} /></span>
{:else}
  <span class="dot {status}" aria-hidden="true"></span>
{/if}

<style>
  .dot {
    flex: none;
    width: var(--size-dot);
    height: var(--size-dot);
    border-radius: var(--radius-round);
  }

  .needs-you {
    background: var(--status-needs-you);
  }

  .working {
    border: var(--ring) solid var(--status-working);
  }

  .new {
    border: var(--ring) dashed var(--muted);
  }

  .exited {
    border: var(--ring) solid var(--muted);
  }

  .mark {
    display: inline-flex;
    flex: none;
  }

  .your-turn {
    color: var(--status-your-turn);
  }

  .paused {
    color: var(--muted);
  }
</style>
