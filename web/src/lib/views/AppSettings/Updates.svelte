<script lang="ts">
  // Settings area Updates: the running version, channel, mode, install and roll back, the changelog.
  import type { ReleaseNotes, UpdateStatus } from '../../../../../shared/api.ts';
  import Button from '../../components/Button/Button.svelte';
  import Dialog from '../../components/Dialog/Dialog.svelte';
  import Markdown from '../../components/Markdown/Markdown.svelte';
  import Section from '../../components/Section/Section.svelte';
  import SelectField from '../../components/SelectField/SelectField.svelte';
  import { when } from '../../format.ts';
  import { api } from '../../stores/api.ts';
  import { app, loadUpdate } from '../../stores/state.svelte.ts';
  import { toastError } from '../../stores/toasts.svelte.ts';

  interface Props {
    /** Set while the launcher installs or rolls back; the page's attention bar can start an install too. */
    switching: { to: string; verb: string } | null;
    oninstall: (version: string) => void;
    onrollback: (version: string) => void;
  }
  let { switching, oninstall, onrollback }: Props = $props();

  const CHANNELS = [
    { value: 'stable', label: 'Stable' },
    { value: 'beta', label: 'Beta (pre-releases)' },
  ];
  const UPDATE_MODES = [
    { value: 'ask', label: 'Ask me first' },
    { value: 'auto', label: 'Install automatically' },
    { value: 'off', label: 'Don\'t check (only "Check now")' },
  ];

  let releases = $state<ReleaseNotes[] | null>(null);
  async function showChangelog() {
    releases = (await api<ReleaseNotes[]>('changelog').catch(toastError)) ?? null;
  }

  const update = $derived(app.update);
  /** A failed update, or a switch that waits for a restart; a plain success needs no line. */
  const lastNote = $derived(
    update?.last && (!update.last.ok || update.last.to !== update.current) ? update.last : null,
  );
  let checking = $state(false);

  async function checkUpdates() {
    checking = true;
    const status = await api<UpdateStatus>('updateCheck').catch(toastError);
    checking = false;
    if (status) app.update = status;
  }

  async function setChannel(channel: string) {
    const status = await api<UpdateStatus>('updateChannel', { body: { channel } }).catch(toastError);
    if (status) app.update = status;
    else void loadUpdate();
  }

  async function setMode(mode: string) {
    const status = await api<UpdateStatus>('updateMode', { body: { mode } }).catch(toastError);
    if (status) app.update = status;
    else void loadUpdate();
  }
</script>

{#if update}
  <div class="card">
    <Section title="shub {update.current}">
      {#snippet aside()}<Button size="sm" onclick={showChangelog}>Changelog</Button>{/snippet}
      {#if update.managedBy === 'git'}
        <p class="muted">shub runs from a git checkout, so git manages its updates: pull, then restart shub.</p>
      {:else}
        <div class="stack gap">
          {#if update.latest}
            <div class="item top notice">
              <span class="grow stack gap">
                <span class="strong">shub {update.latest} is available</span>
                <Markdown md={update.changelog || 'No release notes.'} />
                <span class="row">
                  <Button
                    variant="primary"
                    disabled={!!switching}
                    onclick={() => update.latest && oninstall(update.latest)}>Install {update.latest}</Button
                  >
                  {#if !switching}<span class="muted small">shub restarts; sessions keep running.</span>{/if}
                </span>
              </span>
            </div>
          {/if}
          {#if switching}
            <p class="row muted" role="status">
              <span class="spinner" aria-hidden="true"></span>
              {switching.verb} shub {switching.to}: downloading, checking the signature, restarting. Sessions keep
              running; this page reconnects by itself.
            </p>
          {:else if lastNote}
            <p class={lastNote.ok ? 'muted' : 'error'} role={lastNote.ok ? undefined : 'alert'}>
              {lastNote.message}
            </p>
          {/if}
          <SelectField
            label="Release channel"
            hint="Beta gets new versions first, from every merge into develop."
            bind:value={() => update.channel, (v) => setChannel(v)}
            options={CHANNELS}
          />
          <SelectField
            label="New versions"
            hint="shub checks as soon as a release is out, unless off. Automatic installs restart shub; sessions keep running."
            bind:value={() => update.mode, (v) => setMode(v)}
            options={UPDATE_MODES}
          />
          <div class="row">
            <Button onclick={checkUpdates} disabled={checking}>{checking ? 'Checking' : 'Check now'}</Button>
            {#if update.previous}
              <Button disabled={!!switching} onclick={() => update.previous && onrollback(update.previous)}
                >Roll back to {update.previous}</Button
              >
            {/if}
            <span class="muted small">
              {update.checkError
                ? `Last check failed: ${update.checkError}`
                : update.checkedAt
                  ? `Checked ${when(update.checkedAt)}${update.latest ? '' : ' · up to date'}`
                  : 'Not checked yet'}
            </span>
          </div>
          {#if update.previous}
            <p class="muted small">
              Roll back only if this version misbehaves. If a new version does not start, shub goes back by itself.
            </p>
          {/if}
        </div>
      {/if}
    </Section>
  </div>
{/if}

<Dialog
  open={!!releases}
  title="Changelog"
  description="What changed in shub {app.update?.current ?? ''} and the releases before it."
  onclose={() => (releases = null)}
>
  <div class="changelog">
    {#each releases ?? [] as r (r.version)}
      <section>
        <h3 class="row">{r.version} <span class="muted small">{new Date(r.publishedAt).toLocaleDateString()}</span></h3>
        <Markdown md={r.notes || 'No release notes.'} />
      </section>
    {/each}
    {#if releases && !releases.length}<p class="muted">No releases yet.</p>{/if}
  </div>
</Dialog>

<style>
  .spinner {
    width: 14px;
    height: 14px;
    flex: none;
    border: 2px solid var(--line);
    border-top-color: var(--primary);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .spinner {
      animation-duration: 3s;
    }
  }

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

  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2-5);
  }

  .stack {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
  }

  .gap {
    gap: var(--space-2-5);
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

  .top {
    align-items: flex-start;
  }

  .notice {
    border-color: var(--primary);
  }

  .error {
    margin: 0;
    color: var(--danger);
  }

  .changelog {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    max-height: 60vh;
    overflow-y: auto;
  }

  .changelog h3 {
    margin: 0;
    font-size: var(--text-md);
  }
</style>
