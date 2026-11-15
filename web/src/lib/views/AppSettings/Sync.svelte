<script lang="ts">
  // Settings area Sync: the group's other hosts, conflicts, and what this machine shares.
  import { onMount } from 'svelte';
  import type { Config, FolderStatus, SyncCategory, TranscriptProgress } from '../../../../../shared/api.ts';
  import Checkbox from '../../components/Checkbox/Checkbox.svelte';
  import Conflicts from '../../components/Conflicts/Conflicts.svelte';
  import Section from '../../components/Section/Section.svelte';
  import Button from '../../components/Button/Button.svelte';
  import StatusBadge from '../../components/StatusBadge/StatusBadge.svelte';
  import TextField from '../../components/TextField/TextField.svelte';
  import { when } from '../../format.ts';
  import { api } from '../../stores/api.ts';
  import { app, loadConfig } from '../../stores/state.svelte.ts';
  import { toastError } from '../../stores/toasts.svelte.ts';

  const SYNC: { key: SyncCategory; label: string; hint?: string; off?: boolean }[] = [
    { key: 'projects', label: 'Projects and groups', hint: 'Folders stay per machine; one missing here shows dimmed.' },
    { key: 'themes', label: 'Themes' },
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

  let status = $state<FolderStatus | null>(null);
  let transcripts = $state<TranscriptProgress | null>(null);
  let folder = $state(app.config?.syncFolder ?? '');
  let saving = $state(false);
  const mb = (bytes: number) => `${Math.round(bytes / 1_048_576).toLocaleString()} MB`;
  const load = () => {
    void api<TranscriptProgress>('groupTranscripts').then(
      (t) => (transcripts = t),
      () => (transcripts = null),
    );
    return api<FolderStatus>('groupFolder').then(
      (f) => (status = f),
      () => (status = null),
    );
  };
  async function saveFolder() {
    saving = true;
    const config = await api<Config>('settings', { body: { syncFolder: folder.trim() } })
      .catch(toastError)
      .finally(() => (saving = false));
    if (config) app.config = config;
    void load();
  }

  onMount(() => {
    void load();
    const timer = setInterval(load, 10_000);
    return () => clearInterval(timer);
  });
</script>

<div class="card">
  <Section
    title="Sync folder"
    description="Pick a folder that a sync tool keeps equal on all your machines. Leave it empty and shub works on this machine only."
  >
    <div class="row">
      <div class="grow">
        <TextField
          label="Folder on this machine"
          hint="An existing folder, e.g. ~/Sync/shub. Set it on every machine, to that machine's own copy of the synced folder."
          mono
          bind:value={folder}
          autocomplete="off"
          placeholder="~/Sync/shub"
        />
      </div>
      <Button onclick={saveFolder} disabled={saving || folder.trim() === (app.config?.syncFolder ?? '')}>Save</Button>
    </div>
    {#if status?.folder}
      <p class="muted small">
        {#if status.error}
          <StatusBadge text="Problem" tone="needs-you" /> {status.error}
        {:else}
          <StatusBadge text="Connected" tone="done" />
          {status.items} items{status.scannedAt ? `, last read ${when(status.scannedAt)}` : ''}.
        {/if}
      </p>
    {:else}
      <p class="muted small">No folder set: nothing is shared with your other machines.</p>
    {/if}
    <details class="how">
      <summary>How it works and how to set it up</summary>
      <p class="muted small">
        shub writes your settings, projects, session list and the conversations of the last 7 days into this folder, and
        reads what your other machines left there. shub does not send anything itself: a sync tool moves the folder, so
        a machine can be off while another one changes things. When you shut a machine down, its open sessions are put
        into the folder and another machine resumes them on its own.
      </p>
      <ol class="muted small">
        <li>
          Make a folder, e.g. <code>~/Sync/shub</code>, and let a sync tool keep it equal on all machines (Syncthing,
          Google Drive, Dropbox, a NAS).
        </li>
        <li>Enter it above on every machine, each with its own path to that folder, and save.</li>
        <li>Optional: keep the sync tool running at login, so it can carry off the handover when you shut down.</li>
      </ol>
      <p class="muted small">
        Without a folder, projects, themes and sessions stay on each machine. Two limits: uncommitted changes in a repo
        do not travel (git does that), and a crash or suspend does not hand sessions over. The folder holds full
        transcripts: keep it where only you can read.
      </p>
    </details>
  </Section>
</div>
<div class="card">
  <Section
    title="Conflicts"
    description="Changed on two machines while apart. Each machine keeps its own until you pick."
  >
    <Conflicts list />
  </Section>
</div>
<div class="card">
  <Section
    title="Sync"
    description="What goes into the sync folder and what is read from it, per machine. Does nothing until a folder is set."
  >
    {#each SYNC as c (c.key)}
      <Checkbox
        label={c.label}
        hint={c.hint}
        checked={app.config?.sync?.[c.key] ?? c.key !== 'pluginEnv'}
        disabled={!status?.folder}
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

  .how {
    margin-top: var(--space-3);
  }

  .how summary {
    cursor: pointer;
    font-size: var(--text-md);
    color: var(--fg-2);
  }

  .how[open] summary {
    margin-bottom: var(--space-2-5);
  }

  .how ol {
    padding-left: var(--space-5);
  }

  .row {
    display: flex;
    align-items: flex-end;
    gap: var(--space-2-5);
  }

  .grow {
    flex: 1 1 auto;
    min-width: 0;
  }

  .muted {
    margin: 0;
    color: var(--muted);
  }

  .small {
    font-size: var(--text-sm);
  }
</style>
