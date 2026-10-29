<script lang="ts">
  // Settings area Sync: the group's other hosts, conflicts, and what this machine shares.
  import { onMount } from 'svelte';
  import type { Config, HostPeer, SyncCategory, TranscriptProgress } from '../../../../../shared/api.ts';
  import Checkbox from '../../components/Checkbox/Checkbox.svelte';
  import Conflicts from '../../components/Conflicts/Conflicts.svelte';
  import Section from '../../components/Section/Section.svelte';
  import StatusBadge from '../../components/StatusBadge/StatusBadge.svelte';
  import { when } from '../../format.ts';
  import { api } from '../../stores/api.ts';
  import { app, loadConfig } from '../../stores/state.svelte.ts';
  import { toastError } from '../../stores/toasts.svelte.ts';

  const SYNC: { key: SyncCategory; label: string; hint?: string; off?: boolean }[] = [
    { key: 'projects', label: 'Projects and groups', hint: 'Folders stay per machine; one missing here shows dimmed.' },
    { key: 'themes', label: 'Themes' },
    { key: 'terminal', label: 'Terminal' },
    { key: 'notifications', label: 'Notifications' },
    { key: 'permissionMode', label: 'Default permission mode' },
    { key: 'plugins', label: 'Plugins' },
    { key: 'pluginEnv', label: 'Plugin environment', hint: 'May hold secrets. Off unless you switch it on.' },
    { key: 'sessions', label: 'Session list' },
    { key: 'transcripts', label: 'Transcripts' },
  ];
  async function setSync(key: SyncCategory, value: boolean) {
    const config = await api<Config>('settings', { body: { sync: { [key]: value } } }).catch(toastError);
    if (config) app.config = config;
    else void loadConfig();
  }

  let hostPeers = $state<HostPeer[]>([]);
  let transcripts = $state<TranscriptProgress | null>(null);
  const mb = (bytes: number) => `${Math.round(bytes / 1_048_576).toLocaleString()} MB`;
  const loadPeers = () => {
    void api<TranscriptProgress>('groupTranscripts').then(
      (t) => (transcripts = t),
      () => (transcripts = null),
    );
    return api<HostPeer[]>('groupPeers').then(
      (list) => (hostPeers = list),
      () => (hostPeers = []),
    );
  };
  const PEER_STATES = { 'in-sync': 'In sync', 'catching-up': 'Catching up', conflict: 'Conflict waiting' } as const;
  const peerState = (p: HostPeer) =>
    p.state === 'offline' ? (p.since ? `Offline since ${when(p.since)}` : 'Offline') : PEER_STATES[p.state];

  onMount(() => {
    void loadPeers();
    const peers = setInterval(loadPeers, 10_000);
    return () => clearInterval(peers);
  });
</script>

<div class="card">
  <Section title="Other hosts" description="Hosts of your device group, found through the group, no addresses to type.">
    {#if !hostPeers.length}<p class="muted small">No other host yet.</p>{/if}
    <ul class="list">
      {#each hostPeers as p (p.id)}
        <li class="item">
          <span class="grow stack">
            <span class="strong">{p.name}</span>
            <span class="muted small">{p.url ?? 'no address published yet'}</span>
          </span>
          <StatusBadge
            text={peerState(p)}
            tone={p.state === 'in-sync' ? 'done' : p.state === 'conflict' ? 'needs-you' : 'neutral'}
          />
        </li>
      {/each}
    </ul>
  </Section>
</div>
<div class="card">
  <Section title="Conflicts" description="Changed on two hosts while apart. Each host keeps its own until you pick.">
    <Conflicts list />
  </Section>
</div>
<div class="card">
  <Section
    title="Sync"
    description="This choice is per machine: a category that is off is neither sent nor accepted here."
  >
    {#each SYNC as c (c.key)}
      <Checkbox
        label={c.label}
        hint={c.hint}
        checked={app.config?.sync?.[c.key] ?? c.key !== 'pluginEnv'}
        onchange={(e) => setSync(c.key, e.currentTarget.checked)}
      />
      {#if c.key === 'transcripts' && transcripts}
        <p class="muted small">
          {transcripts.running ? `Copying: ${mb(transcripts.done)} of ${mb(transcripts.total)}. ` : ''}{mb(
            transcripts.size,
          )} of transcripts on this machine.
        </p>
      {/if}
    {/each}
  </Section>
</div>

<style>
  .card {
    padding: var(--space-4) var(--space-5);
    border: var(--hairline) solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--panel);
  }

  .grow {
    flex: 1 1 auto;
    min-width: 0;
  }

  .stack {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
  }

  .strong {
    font-weight: var(--weight-medium);
    color: var(--fg);
  }

  .muted {
    margin: 0;
    color: var(--muted);
  }

  .small {
    font-size: var(--text-sm);
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .item {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2-5);
    padding: var(--space-3);
    border: var(--hairline) solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--bg);
  }
</style>
