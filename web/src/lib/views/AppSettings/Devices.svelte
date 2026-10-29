<script lang="ts">
  // Settings area Devices: paired devices and their levels, pairing a new one, phone access, known machines.
  import { onMount } from 'svelte';
  import type { Device, PhoneSetup } from '../../../../../shared/api.ts';
  import Button from '../../components/Button/Button.svelte';
  import ChoiceButton from '../../components/ChoiceButton/ChoiceButton.svelte';
  import Dialog from '../../components/Dialog/Dialog.svelte';
  import Icon from '../../components/Icon/Icon.svelte';
  import Section from '../../components/Section/Section.svelte';
  import TextField from '../../components/TextField/TextField.svelte';
  import { when } from '../../format.ts';
  import { api } from '../../stores/api.ts';
  import { fleet, removeMachine, renameMachine } from '../../stores/machines.svelte.ts';
  import { app, ui } from '../../stores/state.svelte.ts';
  import { toast, toastError } from '../../stores/toasts.svelte.ts';

  interface Props {
    devices: Device[];
    onapprove: (d: Device) => void;
    onunpair: (d: Device) => void;
    /** A device changed here: load the list again. */
    onchange: () => void;
  }
  let { devices, onapprove, onunpair, onchange }: Props = $props();

  let renamingMachine = $state<{ origin: string; name: string } | null>(null);
  const myDevice = $derived(app.me?.device ?? null);
  let pairing = $state<{ code: string; url: string; qrSvg: string; expiresAt: string } | null>(null);
  let phone = $state<PhoneSetup | null>(null);
  let serving = $state(false);
  let serveError = $state('');
  let now = $state(Date.now());
  let renaming = $state<Device | null>(null);
  let newName = $state('');

  const left = $derived(pairing ? Math.max(0, Date.parse(pairing.expiresAt) - now) : 0);
  const countdown = $derived(`${Math.floor(left / 60_000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}`);

  /** Approving and changing levels work on a trusted host and from a phone at level Control. */
  const local = $derived(!!app.me?.local);
  const LEVEL_OPTIONS = [
    { value: 'view', label: 'View' },
    { value: 'prompts', label: 'Prompts' },
    { value: 'control', label: 'Control' },
  ];

  async function setLevel(d: Device, level: string) {
    await api('deviceUpdate', { params: { id: d.id }, body: { level } }).catch(toastError);
    onchange();
  }

  const ts = $derived(phone?.tailscale);
  const shared = $derived(!!ts?.served && !!phone?.publicUrl);
  const phoneReady = $derived(!!ts?.running && !!ts.https && shared);
  const loadPhone = () => api<PhoneSetup>('phoneSetup').then((p) => (phone = p), toastError);

  async function share() {
    serving = true;
    serveError = '';
    await api<PhoneSetup>('phoneSetupServe').then(
      (p) => (phone = p),
      (err: Error) => (serveError = err.message),
    );
    serving = false;
  }

  onMount(() => {
    void loadPhone();
    const tick = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(tick);
  });

  async function newCode() {
    pairing = (await api<typeof pairing>('pairingStart').catch(toastError)) ?? null;
  }

  async function doRename(e: SubmitEvent) {
    e.preventDefault();
    if (!renaming) return;
    const id = renaming.id;
    renaming = null;
    await api('deviceUpdate', { params: { id }, body: { name: newName } }).catch(toastError);
    onchange();
  }
</script>

<div class="card">
  <Section title="Paired devices">
    {#snippet aside()}
      {#if shared}<Button size="sm" variant="primary" onclick={newCode}>+ Pair a device</Button>{/if}
    {/snippet}
    <details class="more">
      <summary>What do the levels mean?</summary>
      <p class="muted small">
        View reads sessions and gets push. Prompts also answers approvals, permission questions and Run chips. Control
        also types in terminals and starts sessions. A new device (phone or browser) joins at Prompts once approved;
        approving and changing levels work on a trusted host (opened via localhost) and from a phone at level Control.
      </p>
    </details>
    {#if !devices.length}<p class="muted small">No paired devices yet.</p>{/if}
    <ul class="list">
      {#each devices as d (d.id)}
        <li class="item" class:waiting={d.state === 'pending'}>
          <span class="grow stack">
            <span class="strong"
              >{d.name}{d.id === myDevice?.id ? ' · this device' : ''}{d.state === 'pending'
                ? ' · waiting for approval'
                : ''}</span
            >
            <span class="muted small">{d.kind} · seen {when(d.lastSeenAt)} · push {d.push ? 'on' : 'off'}</span>
          </span>
          {#if d.kind !== 'desktop'}
            {#if d.state === 'pending'}
              {#if local}<Button size="sm" variant="primary" onclick={() => onapprove(d)}>Approve</Button>
              {:else}<span class="muted small">Approve on a trusted host</span>{/if}
            {:else if local}
              <span class="segment" role="group" aria-label="What {d.name} may do">
                {#each LEVEL_OPTIONS as o (o.value)}
                  <ChoiceButton pressed={d.level === o.value} onclick={() => setLevel(d, o.value)}
                    >{o.label}</ChoiceButton
                  >
                {/each}
              </span>
            {:else}<span class="muted small">{d.level}</span>{/if}
          {/if}
          {#if d.push}<Button
              size="sm"
              onclick={() =>
                api('pushTest', { query: { device: d.id } }).then(
                  () => toast(`Test push sent to ${d.name}`),
                  toastError,
                )}>Test push</Button
            >{/if}
          <Button size="sm" onclick={() => ((newName = d.name), (renaming = d))}>Rename</Button>
          {#if d.id !== myDevice?.id}<Button size="sm" variant="danger" onclick={() => onunpair(d)}
              >{d.state === 'pending' ? 'Reject' : 'Unpair'}</Button
            >{/if}
        </li>
      {/each}
    </ul>
    {#if pairing}{@render pairCode()}{/if}
  </Section>
</div>

{#if phone && ts}
  <div class="card">
    <Section title="Phone access" description="shub stays on this machine; the phone reaches it through Tailscale.">
      <details class="checks-box" open={!phoneReady}>
        <summary>
          {#if phoneReady}<span class="ok-text"><Icon name="check" size="sm" /> Ready</span>
            <span class="muted small">{phone.publicUrl} · tailnet only, not public</span>
          {:else}<span class="warn-text">Not ready yet: work through the checks</span>{/if}
        </summary>
        {@render checks()}
      </details>
    </Section>
  </div>
{/if}

{#if fleet.list.length > 0}
  <div class="card">
    <Section title="Machines" description="The machines this app knows. Removing one signs this device out there.">
      {#snippet aside()}
        {#if !ui.phone}<Button size="sm" onclick={() => (fleet.adding = true)}>+ Add a machine</Button>{/if}
      {/snippet}
      <ul class="list">
        {#each fleet.list as m (m.origin)}
          <li class="item">
            {#if renamingMachine?.origin === m.origin}
              <form
                class="grow rename"
                onsubmit={(e) => {
                  e.preventDefault();
                  const { origin, name } = renamingMachine!;
                  renamingMachine = null;
                  renameMachine(origin, name).catch(toastError);
                }}
              >
                <TextField label="Machine name" hideLabel bind:value={renamingMachine.name} />
                <Button size="sm" type="submit">Save</Button>
                <Button size="sm" onclick={() => (renamingMachine = null)}>Cancel</Button>
              </form>
            {:else}
              <span class="grow stack"
                ><span class="strong">{m.name}</span><span class="muted small">{new URL(m.origin).host}</span></span
              >
              <Button size="sm" onclick={() => (renamingMachine = { origin: m.origin, name: m.name })}>Rename</Button>
            {/if}
            {#if m.origin !== location.origin}<Button
                size="sm"
                variant="danger"
                onclick={() => removeMachine(m.origin).then(() => toast(`${m.name} removed`), toastError)}
                >Remove</Button
              >{/if}
          </li>
        {/each}
      </ul>
    </Section>
  </div>
{/if}

{#snippet checks()}
  {#if ts && phone}
    <ol class="checks">
      <li class:ok={ts.running}>
        <Icon name={ts.running ? 'check' : 'close'} size="sm" />
        <span class="stack">
          <span class="strong">Tailscale runs on this machine</span>
          {#if !ts.installed}<span class="muted small"
              >Install it: <a href="https://tailscale.com/download" target="_blank" rel="noreferrer"
                >tailscale.com/download</a
              ></span
            >{:else if !ts.running}<span class="muted small">Log in with <code>tailscale up</code>.</span>{/if}
        </span>
      </li>
      <li class:ok={ts.https}>
        <Icon name={ts.https ? 'check' : 'close'} size="sm" />
        <span class="stack">
          <span class="strong">HTTPS certificates are on</span>
          {#if !ts.https}<span class="muted small"
              >Turn on MagicDNS and HTTPS Certificates in the <a
                href="https://login.tailscale.com/admin/dns"
                target="_blank"
                rel="noreferrer">Tailscale admin console</a
              >.</span
            >{/if}
        </span>
      </li>
      <li class:ok={ts.phones.length > 0}>
        <Icon name={ts.phones.length ? 'check' : 'close'} size="sm" />
        <span class="stack">
          <span class="strong">Phone in the tailnet</span>
          <span class="muted small"
            >{ts.phones.length
              ? `Online: ${ts.phones.join(', ')}`
              : ts.offlinePhones.length
                ? `${ts.offlinePhones.join(', ')} is in the tailnet but offline: open Tailscale on the phone and connect.`
                : 'Install the Tailscale app on the phone and log in with the same account.'}</span
          >
        </span>
      </li>
      <li class:ok={shared}>
        <Icon name={shared ? 'check' : 'close'} size="sm" />
        <span class="stack">
          <span class="strong">shub shared in the tailnet</span>
          {#if shared}
            <span class="muted small">{phone.publicUrl} · tailnet only, not public</span>
          {:else}
            <span class="muted small">Runs <code>tailscale serve</code> for shub's port. Never Funnel.</span>
            {#if serveError}<span class="error small" role="alert">{serveError}</span>{/if}
            <div class="row">
              <Button size="sm" variant="primary" disabled={!ts.running || !ts.https || serving} onclick={share}
                >{serving ? 'Sharing…' : 'Share shub in the tailnet'}</Button
              >
            </div>
          {/if}
        </span>
      </li>
    </ol>
    <div class="row"><Button size="sm" onclick={loadPhone}>Check again</Button></div>
  {/if}
{/snippet}

{#snippet pairCode()}
  <div class="pair">
    {#if pairing && left > 0}
      <!-- The server renders the QR code as SVG (qrcode package), never user input. -->
      <div class="qr" role="img" aria-label="QR code for {pairing.url}">
        {@html pairing.qrSvg}
      </div>
    {:else}
      <div class="qr empty"><Button variant="primary" onclick={newCode}>Show a code</Button></div>
    {/if}
    <div class="steps">
      <ol>
        <li>Scan the code with the phone camera; shub opens and signs the phone in. No token to type.</li>
        <li>Add it to the home screen and allow notifications for push.</li>
        <li>Phone already has shub from another machine? There tap + above the sessions and scan or type this.</li>
      </ol>
      {#if pairing && left > 0}
        <span class="code"
          ><span class="muted small">Address</span> <code>{new URL(pairing.url).host}</code>
          <span class="muted small">Code</span>
          <code>{pairing.code.slice(0, 4)}-{pairing.code.slice(4)}</code></span
        >
      {/if}
      <span class="muted small" aria-live="polite">
        {left > 0 ? `Code is single-use and runs out in ${countdown}.` : 'The code ran out.'}
      </span>
      <div class="row">
        <Button size="sm" onclick={newCode}>New code</Button>
        <Button size="sm" variant="ghost" onclick={() => (pairing = null)}>Done</Button>
      </div>
    </div>
  </div>
{/snippet}

<Dialog open={!!renaming} title="Rename {renaming?.name}" onclose={() => (renaming = null)}>
  <form id="rename-device" onsubmit={doRename}>
    <TextField label="Device name" bind:value={newName} required autocomplete="off" />
  </form>
  {#snippet actions()}
    <Button variant="ghost" onclick={() => (renaming = null)}>Cancel</Button>
    <Button type="submit" form="rename-device">Save</Button>
  {/snippet}
</Dialog>

<style>
  .card {
    padding: var(--space-4) var(--space-5);
    border: var(--hairline) solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--panel);
  }

  .segment {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1);
  }

  .checks-box summary {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2-5);
    cursor: pointer;
  }

  .more summary {
    color: var(--link);
    font-size: var(--text-md);
    cursor: pointer;
  }

  .checks-box[open] summary {
    margin-bottom: var(--space-3);
  }

  .more[open] summary {
    margin-bottom: var(--space-2-5);
  }

  .ok-text {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    color: var(--status-your-turn);
    font-weight: var(--weight-medium);
  }

  .warn-text {
    color: var(--status-needs-you);
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

  .pair {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-5);
    align-items: flex-start;
  }

  .checks {
    display: flex;
    flex-direction: column;
    gap: var(--space-2-5);
    margin: 0 0 var(--space-3);
    padding: 0;
    list-style: none;
    color: var(--status-needs-you);
  }

  .checks li {
    display: flex;
    gap: var(--space-2-5);
    align-items: flex-start;
  }

  .checks li.ok {
    color: var(--status-your-turn);
  }

  .qr {
    width: var(--size-qr);
    height: var(--size-qr);
    flex: none;
    padding: var(--space-2);
    border-radius: var(--radius-lg);
    background: var(--qr-paper);
  }

  .qr.empty {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: var(--hairline) dashed var(--line-strong);
    background: transparent;
  }

  .steps {
    flex: 1 1 var(--size-sidebar-min);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  ol {
    margin: 0;
    padding-left: var(--space-5);
    color: var(--fg-2);
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

  .rename {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .item.waiting {
    border-color: transparent;
    background: var(--status-needs-you-bg);
  }

  .error {
    margin: 0;
    color: var(--danger);
  }

  code {
    font-family: var(--font-mono);
  }

  .code {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-2);
  }
</style>
