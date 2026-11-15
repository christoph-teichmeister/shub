<script lang="ts">
  import { API_VERSION } from '../../../../../shared/api.ts';
  import { fleet } from '../../stores/machines.svelte.ts';
  import { app, retryNow } from '../../stores/state.svelte.ts';
  import Button from '../Button/Button.svelte';
  import Icon from '../Icon/Icon.svelte';

  interface Props {
    /** Defaults to what the app store says; pass one (or null for none) to render it statically (styleguide). */
    kind?: 'offline' | 'reconnecting' | 'mismatch' | null;
    machine?: string;
    /** Version of the other machine, for `mismatch`. */
    apiVersion?: number;
    /** When data last came in (ms); defaults to the store's. */
    since?: number | null;
    onretry?: () => void;
  }
  let { kind, machine, apiVersion, since, onretry = retryNow }: Props = $props();

  const live = $derived(
    app.unreachable
      ? 'offline'
      : app.apiMismatch !== null
        ? 'mismatch'
        : app.ready && app.reconnecting
          ? 'reconnecting'
          : null,
  );
  const shown = $derived(kind === undefined ? live : kind);
  const name = $derived(
    machine ?? fleet.list.find((m) => m.origin === fleet.selected)?.name.split('.')[0] ?? 'This machine',
  );
  const at = $derived(since === undefined ? app.lastOkAt : since);
  const time = $derived(at ? new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null);
</script>

{#if shown}
  <div class="banner {shown}" role="alert">
    <Icon name="warning" size="sm" weight={2} />
    <p class="text">
      {#if shown === 'offline'}
        {name} does not answer. It may be off.
      {:else if shown === 'reconnecting'}
        Connection lost. Reconnecting to {name}.
      {:else}
        {name} runs a shub with API {apiVersion ?? app.apiMismatch}, this app speaks {API_VERSION}. Update the older
        one; until then some things may fail.
      {/if}
      {#if time && shown !== 'mismatch'}<span class="since">Showing data from {time}.</span>{/if}
    </p>
    {#if shown !== 'mismatch'}<Button size="sm" onclick={onretry}>Retry now</Button>{/if}
  </div>
{/if}

<style>
  .banner {
    display: flex;
    align-items: center;
    gap: var(--space-2-5);
    padding: var(--space-2) var(--space-3);
    border-bottom: var(--hairline) solid var(--danger);
    background: color-mix(in srgb, var(--danger) 14%, var(--bg));
  }

  .reconnecting {
    border-color: var(--status-needs-you);
    background: var(--status-needs-you-bg);
    color: var(--status-needs-you-fg);
  }

  .text {
    flex: 1 1 auto;
    min-width: 0;
    margin: 0;
  }

  .since {
    margin-left: var(--space-1);
    color: var(--muted);
  }
</style>
