<script lang="ts">
  import { api } from '../../stores/api.ts';
  import { app, loadConflicts } from '../../stores/state.svelte.ts';
  import { toastError } from '../../stores/toasts.svelte.ts';
  import Button from '../Button/Button.svelte';
  import Dialog from '../Dialog/Dialog.svelte';
  import StatusBadge from '../StatusBadge/StatusBadge.svelte';

  /** `list` draws the open conflicts as rows (Settings > Sync); otherwise just the header badge. */
  let { list = false }: { list?: boolean } = $props();

  let key = $state<string | null>(null);
  const current = $derived(app.conflicts.find((c) => c.key === key));
  // Below Control a device only sees that conflicts exist.
  const canPick = $derived(!app.me?.caller?.level || app.me.caller.level === 'control');

  const show = (v: unknown) => (v === undefined ? '(none)' : typeof v === 'string' ? v : JSON.stringify(v));
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  /** One row per field of an object item; anything else is a single "value" row. */
  const rows = $derived.by(() => {
    if (!current) return [];
    const [a, b] = [current.ours, current.theirs].map((s) => (s.deleted ? undefined : s.body));
    if (!isObject(a) || !isObject(b)) return [{ field: 'value', a: a ?? '(removed)', b: b ?? '(removed)' }];
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].map((field) => ({ field, a: a[field], b: b[field] }));
  });
  const who = (hosts: string[]) => hosts.join(', ') || 'this host';

  async function pick(pick: 'ours' | 'theirs') {
    const res = await api('groupResolve', { body: { key, pick } }).catch(toastError);
    await loadConflicts();
    if (res) key = !list ? (app.conflicts[0]?.key ?? null) : null;
  }
</script>

{#if app.conflicts.length}
  {#if list}
    <ul class="list">
      {#each app.conflicts as c (c.key)}
        <li class="item">
          <span class="grow strong">{c.key}</span>
          <Button variant="ghost" onclick={() => (key = c.key)}>{canPick ? 'Compare' : 'View'}</Button>
        </li>
      {/each}
    </ul>
  {:else}
    <button type="button" class="badge" onclick={() => (key = app.conflicts[0].key)}>
      <StatusBadge text="{app.conflicts.length} sync conflict{app.conflicts.length > 1 ? 's' : ''}" tone="needs-you" />
    </button>
  {/if}
{:else if list}
  <p class="muted small">No conflicts.</p>
{/if}

<Dialog
  open={!!current}
  title="Two versions of {current?.key}"
  description={canPick
    ? 'Changed on two hosts while apart. This host keeps its own until you pick one whole version.'
    : 'Changed on two hosts while apart. A device with Control level can pick.'}
  onclose={() => (key = null)}
>
  {#if current}
    <div class="grid" role="table">
      <span class="head">Field</span>
      <span class="head">{who(current.ours.hosts)} (here)</span>
      <span class="head">{who(current.theirs.hosts)}</span>
      {#each rows as r (r.field)}
        <span class="field">{r.field}</span>
        <code class:diff={!same(r.a, r.b)}>{show(r.a)}</code>
        <code class:diff={!same(r.a, r.b)}>{show(r.b)}</code>
      {/each}
    </div>
  {/if}
  {#snippet actions()}
    <Button variant="ghost" onclick={() => (key = null)}>Close</Button>
    {#if canPick}
      <Button variant="ghost" onclick={() => pick('ours')}>Keep this host's</Button>
      <Button onclick={() => pick('theirs')}>Take the other</Button>
    {/if}
  {/snippet}
</Dialog>

<style>
  .badge {
    all: unset;
    cursor: pointer;
  }

  .grid {
    display: grid;
    grid-template-columns: auto 1fr 1fr;
    gap: var(--space-1) var(--space-3);
    align-items: start;
  }

  .head,
  .field {
    color: var(--muted);
    font-size: var(--text-xs);
  }

  code {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    padding: 0 var(--space-1);
    border-radius: var(--radius-sm);
  }

  .diff {
    background: color-mix(in srgb, var(--status-needs-you) 25%, transparent);
  }
</style>
