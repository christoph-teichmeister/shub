<script lang="ts">
  // Settings area Sessions: the default permission mode, trusted sessions and notifications.
  import { onMount } from 'svelte';
  import type { Config } from '../../../../../shared/api.ts';
  import Button from '../../components/Button/Button.svelte';
  import Checkbox from '../../components/Checkbox/Checkbox.svelte';
  import ChoiceButton from '../../components/ChoiceButton/ChoiceButton.svelte';
  import Dialog from '../../components/Dialog/Dialog.svelte';
  import Section from '../../components/Section/Section.svelte';
  import TextField from '../../components/TextField/TextField.svelte';
  import { api } from '../../stores/api.ts';
  import { PERMISSION_MODES } from '../../permissionModes.ts';
  import { pushEnabled, pushSupported, subscribePush } from '../../stores/push.ts';
  import { app, loadConfig } from '../../stores/state.svelte.ts';
  import { toast, toastError } from '../../stores/toasts.svelte.ts';

  /** Push was turned on here: the device list shows it. */
  let { onpush }: { onpush: () => void } = $props();

  const MODES = PERMISSION_MODES;

  let root = $state(app.config?.projectsRoot ?? '');
  let savingRoot = $state(false);
  async function saveRoot() {
    savingRoot = true;
    const config = await api<Config>('settings', { body: { projectsRoot: root.trim() } })
      .catch(toastError)
      .finally(() => (savingRoot = false));
    if (config) app.config = config;
  }

  let push = $state(false);
  onMount(() => void pushEnabled().then((on) => (push = on)));

  async function setNotification(key: keyof Config['notifications'], value: boolean) {
    if (!app.config) return;
    const notifications = { ...app.config.notifications, [key]: value };
    const config = await api<Config>('settings', { body: { notifications } }).catch(toastError);
    if (config) app.config = config;
    else void loadConfig();
  }

  /** The change waiting for the user's confirm: a prompt-skipping mode or the trust switch. */
  let risky = $state<{ title: string; body: string; confirm: string; run: () => void } | null>(null);
  /** Separate from `risky` so the dialog keeps its text while it closes. */
  let riskyOpen = $state(false);
  const ask = (r: NonNullable<typeof risky>) => ((risky = r), (riskyOpen = true));

  function chooseMode(m: (typeof MODES)[number]) {
    if (m.value === (app.config?.defaultPermissionMode ?? 'default')) return;
    if (!m.risky) return void setDefaultMode(m.value);
    ask({
      confirm: 'Make default',
      title: `Make ${m.label} the default?`,
      body: 'Every new session can edit files and run commands without asking. Use only in sandboxes.',
      run: () => void setDefaultMode(m.value),
    });
  }

  function chooseTrust(on: boolean) {
    if (!on) return void setTrustSessions(false);
    ask({
      confirm: 'Turn on',
      title: 'Let sessions act without your approval?',
      body: 'Project sessions can start sessions and change projects, buttons and links without asking you. The sessions they start skip every prompt.',
      run: () => void setTrustSessions(true),
    });
  }

  async function setDefaultMode(defaultPermissionMode: string) {
    const config = await api<Config>('settings', { body: { defaultPermissionMode } }).catch(toastError);
    if (config) app.config = config;
    else void loadConfig();
  }

  async function setTrustSessions(trustSessions: boolean) {
    const config = await api<Config>('settings', { body: { trustSessions } }).catch(toastError);
    if (config) app.config = config;
    else void loadConfig();
  }

  async function turnOnPush() {
    await subscribePush().then(() => {
      push = true;
      toast('Push is on for this device');
      onpush();
    }, toastError);
  }
</script>

<div class="card">
  <Section
    title="Permission mode for new sessions"
    description="Used by sessions you start and by the global Claude, the one session that belongs to no project (Alt G). A Quick action's own mode wins."
  >
    <div class="modes" role="group" aria-label="Permission mode for new sessions">
      {#each MODES as m (m.value)}
        <ChoiceButton
          shape="card"
          pressed={(app.config?.defaultPermissionMode ?? 'default') === m.value}
          onclick={() => chooseMode(m)}
        >
          <span class="stack mode">
            <span class="strong" class:risky={m.risky}
              >{m.label}{#if m.risky}<span aria-hidden="true"> ⚠</span> <span class="small">Risky</span>{/if}</span
            >
            <span class="muted small">{m.hint}</span>
          </span>
        </ChoiceButton>
      {/each}
    </div>
  </Section>
</div>
<div class="card">
  <Section
    title="Projects folder"
    description="New projects cloned from GitHub or GitLab go into a subfolder of this folder (e.g. private or work). Stays on this machine."
  >
    <div class="root">
      <div class="grow">
        <TextField
          label="Folder on this machine"
          hint="An existing folder. Empty: ~/PycharmProjects when it exists."
          mono
          bind:value={root}
          autocomplete="off"
          placeholder="~/PycharmProjects"
        />
      </div>
      <Button onclick={saveRoot} disabled={savingRoot || root.trim() === (app.config?.projectsRoot ?? '')}>Save</Button>
    </div>
  </Section>
</div>
<div class="card danger-zone">
  <Section
    title="Sessions may act without asking"
    description="A project session can start sessions and change projects, Quick actions and links without an approval. Sessions they start run with bypass permissions on. Still one level deep and limited to 5 starts an hour. Stays on this machine."
  >
    <Checkbox
      label="Skip the approval"
      checked={!!app.config?.trustSessions}
      onchange={(e) => {
        const on = e.currentTarget.checked;
        // The box shows the saved value until the confirm; same element, so focus stays.
        if (on) e.currentTarget.checked = false;
        chooseTrust(on);
      }}
    />
  </Section>
</div>

<Dialog open={riskyOpen} title={risky?.title ?? ''} description={risky?.body} onclose={() => (riskyOpen = false)}>
  {#snippet actions()}
    <Button variant="ghost" onclick={() => (riskyOpen = false)}>Cancel</Button>
    <Button
      variant="danger"
      onclick={() => {
        risky?.run();
        riskyOpen = false;
      }}>{risky?.confirm}</Button
    >
  {/snippet}
</Dialog>

<div class="card">
  <Section title="Notifications">
    <table class="matrix">
      <thead>
        <tr><th scope="col">When</th><th scope="col">Desktop</th><th scope="col">Phone push</th></tr>
      </thead>
      <tbody>
        <tr>
          <th scope="row"
            ><span class="strong">A session needs me</span><span class="muted small"
              >Permission question, approval, error</span
            ></th
          >
          <td>{@render notify('desktopNeedsYou', 'Desktop: a session needs me')}</td>
          <td>{@render notify('pushNeedsYou', 'Phone push: a session needs me')}</td>
        </tr>
        <tr>
          <th scope="row"
            ><span class="strong">It's my turn</span><span class="muted small">Every finished turn</span></th
          >
          <td><span class="muted" aria-label="Not on the desktop">–</span></td>
          <td>{@render notify('pushYourTurn', "Phone push: it's my turn")}</td>
        </tr>
      </tbody>
    </table>
    <Checkbox
      label="Quiet phone while I'm at the desk"
      hint="No phone push while the desktop window is focused."
      checked={!!app.config?.notifications.noPushWhileDesktopFocused}
      onchange={(e) => setNotification('noPushWhileDesktopFocused', e.currentTarget.checked)}
    />
    <div class="row">
      {#if push}
        <span class="muted small grow">Push is on in this browser.</span>
        <Button size="sm" onclick={() => api('pushTest').then(() => toast('Test push sent'), toastError)}
          >Send test push</Button
        >
      {:else if pushSupported()}
        <span class="muted small grow">Push is off in this browser.</span>
        <Button size="sm" onclick={turnOnPush}>Turn on push here</Button>
      {:else}<span class="muted small">This browser has no web push.</span>{/if}
    </div>
  </Section>
</div>

{#snippet notify(key: keyof Config['notifications'], label: string)}
  <Checkbox
    {label}
    hideLabel
    checked={!!app.config?.notifications[key]}
    onchange={(e) => setNotification(key, e.currentTarget.checked)}
  />
{/snippet}

<style>
  .root {
    display: flex;
    align-items: flex-end;
    gap: var(--space-3);
  }

  .card {
    padding: var(--space-4) var(--space-5);
    border: var(--hairline) solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--panel);
  }

  .danger-zone {
    border-color: color-mix(in srgb, var(--danger) 40%, transparent);
  }

  .modes {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(var(--size-preview-side), 1fr));
    gap: var(--space-2);
  }

  .mode {
    text-align: left;
  }

  .risky {
    color: var(--status-needs-you);
  }

  .matrix {
    width: 100%;
    border-collapse: collapse;
  }

  .matrix th,
  .matrix td {
    padding: var(--space-2-5) var(--space-2);
    border-top: var(--hairline) solid var(--line);
    text-align: center;
  }

  .matrix thead th {
    border-top: 0;
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    color: var(--muted);
  }

  .matrix tbody th {
    display: flex;
    flex-direction: column;
    font-weight: var(--weight-regular);
  }

  .matrix th:first-child {
    padding-left: 0;
    text-align: left;
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
</style>
