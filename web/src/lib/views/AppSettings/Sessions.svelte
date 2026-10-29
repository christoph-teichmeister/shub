<script lang="ts">
  // Settings area Sessions: the default permission mode, trusted sessions and notifications.
  import { onMount } from 'svelte';
  import type { Config, LaunchPermissionMode } from '../../../../../shared/api.ts';
  import Button from '../../components/Button/Button.svelte';
  import Checkbox from '../../components/Checkbox/Checkbox.svelte';
  import ChoiceButton from '../../components/ChoiceButton/ChoiceButton.svelte';
  import Section from '../../components/Section/Section.svelte';
  import { api } from '../../stores/api.ts';
  import { pushEnabled, pushSupported, subscribePush } from '../../stores/push.ts';
  import { app, loadConfig } from '../../stores/state.svelte.ts';
  import { toast, toastError } from '../../stores/toasts.svelte.ts';

  /** Push was turned on here: the device list shows it. */
  let { onpush }: { onpush: () => void } = $props();

  const MODES: { value: LaunchPermissionMode; label: string; hint: string; risky?: boolean }[] = [
    { value: 'default', label: 'Ask first', hint: 'Asks before commands and edits.' },
    { value: 'acceptEdits', label: 'Accept edits', hint: 'Edits files freely, asks for commands.' },
    { value: 'plan', label: 'Plan', hint: 'Reads and plans, changes nothing.' },
    { value: 'auto', label: 'Auto', hint: 'Skips prompts with a safety check.', risky: true },
    { value: 'bypassPermissions', label: 'Bypass', hint: 'Skips every prompt. Only in sandboxes.', risky: true },
    { value: 'inherit', label: 'My Claude settings', hint: 'Uses your ~/.claude settings as they are.' },
  ];

  let push = $state(false);
  onMount(() => void pushEnabled().then((on) => (push = on)));

  async function setNotification(key: keyof Config['notifications'], value: boolean) {
    if (!app.config) return;
    const notifications = { ...app.config.notifications, [key]: value };
    const config = await api<Config>('settings', { body: { notifications } }).catch(toastError);
    if (config) app.config = config;
    else void loadConfig();
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
    description="Used by sessions you start and the global Claude. A project button's own mode wins."
  >
    <div class="modes" role="group" aria-label="Permission mode for new sessions">
      {#each MODES as m (m.value)}
        <ChoiceButton
          shape="card"
          pressed={(app.config?.defaultPermissionMode ?? 'default') === m.value}
          onclick={() => setDefaultMode(m.value)}
        >
          <span class="stack mode">
            <span class="strong" class:risky={m.risky}>{m.label}{m.risky ? ' ⚠' : ''}</span>
            <span class="muted small">{m.hint}</span>
          </span>
        </ChoiceButton>
      {/each}
    </div>
  </Section>
  <Section
    title="Sessions may act without asking"
    description="A project session can start sessions and change projects, buttons and links without an approval. Sessions they start run with bypass permissions on. Still one level deep and limited to 5 starts an hour. Stays on this machine."
  >
    <Checkbox
      label="Skip the approval"
      checked={!!app.config?.trustSessions}
      onchange={(e) => setTrustSessions(e.currentTarget.checked)}
    />
  </Section>
</div>

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
  .card {
    padding: var(--space-4) var(--space-5);
    border: var(--hairline) solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--panel);
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
