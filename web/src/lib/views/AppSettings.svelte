<script lang="ts">
  import { onMount } from 'svelte';
  import type { ActivityEntry, Config, Device, PluginInfo, Right } from '../../../../shared/api.ts';
  import Button from '../components/Button/Button.svelte';
  import Checkbox from '../components/Checkbox/Checkbox.svelte';
  import ChoiceButton from '../components/ChoiceButton/ChoiceButton.svelte';
  import Dialog from '../components/Dialog/Dialog.svelte';
  import Section from '../components/Section/Section.svelte';
  import StatusBadge from '../components/StatusBadge/StatusBadge.svelte';
  import { api } from '../stores/api.ts';
  import { pushEnabled, pushSupported, subscribePush } from '../stores/push.ts';
  import { href } from '../stores/router.svelte.ts';
  import { app, loadConfig, loadPlugins, ui } from '../stores/state.svelte.ts';
  import { toast, toastError } from '../stores/toasts.svelte.ts';
  import { applyTheme, BUILT_IN_THEMES, resolveTokens } from '../tokens/tokens.ts';

  const RIGHTS: Record<Right, string> = {
    read: 'read sessions',
    'projects.write': 'change projects',
    'sessions.start': 'start sessions with a free prompt (asks)',
    'sessions.start.button': 'start sessions with project buttons',
    'sessions.link': 'add session links',
    'buttons.write': 'change project buttons (asks)',
    'ui.contribute': 'sidebar sections and menu actions',
  };
  const NOTIFICATIONS: { key: keyof Config['notifications']; label: string }[] = [
    { key: 'desktopNeedsYou', label: 'Desktop: when a session needs me' },
    { key: 'pushNeedsYou', label: 'Phone push: when a session needs me' },
    { key: 'pushYourTurn', label: 'Also on "your turn" (every finished turn)' },
    { key: 'noPushWhileDesktopFocused', label: 'No phone push while the desktop window is focused' },
  ];

  const themes = $derived([...BUILT_IN_THEMES, ...(app.config?.themes ?? []).filter((t) => !t.builtIn)]);
  const active = $derived(app.config?.activeTheme ?? 'monokai');
  const myDevice = $derived(app.me?.device ?? null);
  const settingsActions = $derived(
    app.plugins.flatMap((p) => (p.enabled ? p.settingsActions.map((a) => ({ plugin: p.name, ...a })) : [])),
  );

  let devices = $state<Device[]>([]);
  let pairing = $state<{ code: string; url: string; qrSvg: string; expiresAt: string } | null>(null);
  let now = $state(Date.now());
  let push = $state(false);
  let unpair = $state<Device | null>(null);
  let rotating = $state(false);
  let logs = $state<{ plugin: string; lines: string[] } | null>(null);
  let activity = $state<ActivityEntry[] | null>(null);

  const left = $derived(pairing ? Math.max(0, Date.parse(pairing.expiresAt) - now) : 0);
  const countdown = $derived(`${Math.floor(left / 60_000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}`);

  const loadDevices = () =>
    api<Device[]>('devices').then(
      (list) => (devices = list),
      () => (devices = []),
    );

  onMount(() => {
    void loadDevices();
    void pushEnabled().then((on) => (push = on));
    const tick = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(tick);
  });

  async function useTheme(id: string) {
    const t = themes.find((x) => x.id === id);
    if (t) applyTheme(t);
    const config = await api<Config>('settings', { body: { activeTheme: id } }).catch(toastError);
    if (config) app.config = config;
  }

  async function setNotification(key: keyof Config['notifications'], value: boolean) {
    if (!app.config) return;
    const notifications = { ...app.config.notifications, [key]: value };
    const config = await api<Config>('settings', { body: { notifications } }).catch(toastError);
    if (config) app.config = config;
    else void loadConfig();
  }

  async function newCode() {
    pairing = (await api<typeof pairing>('pairingStart').catch(toastError)) ?? null;
  }

  async function turnOnPush() {
    await subscribePush().then(() => {
      push = true;
      toast('Push is on for this device');
      void loadDevices();
    }, toastError);
  }

  async function doUnpair(d: Device) {
    unpair = null;
    await api('deviceDelete', { params: { id: d.id } }).then(() => toast(`${d.name} unpaired`), toastError);
    void loadDevices();
  }

  async function updatePlugin(p: PluginInfo, body: { enabled?: boolean; grantedRights?: Right[] }) {
    await api('pluginUpdate', { params: { name: p.name }, body }).catch(toastError);
    void loadPlugins();
  }

  async function showLogs(name: string) {
    const res = await api<{ lines: string[] }>('pluginLogs', { params: { name } }).catch(toastError);
    if (res) logs = { plugin: name, lines: res.lines };
  }

  async function rotate() {
    rotating = false;
    const res = await api<{ tokenFile: string }>('rotateToken').catch(toastError);
    if (res) toast(`New access token written to ${res.tokenFile}. Other devices are signed out.`, 'neutral', 8000);
  }

  async function signOut() {
    await api('logout').catch(() => {});
    location.replace('/#/login');
    location.reload();
  }

  async function showActivity() {
    activity = (await api<ActivityEntry[]>('activity', { query: { limit: '100' } }).catch(toastError)) ?? null;
  }

  async function undo(e: ActivityEntry) {
    await api('undo', { params: { id: e.id } }).then(() => toast('Undone'), toastError);
    void showActivity();
  }

  const swatches = (id: string) => {
    const t = resolveTokens(themes.find((x) => x.id === id) ?? BUILT_IN_THEMES[0]);
    return [t.bg, t.panel, t.primary, t.pink, t['status-working'], t['status-your-turn']];
  };
  const when = (iso: string) => new Date(iso).toLocaleString();
</script>

<div class="page">
  <div class="content">
    <a class="back" href={href()}>← Back to sessions</a>
    <header class="head">
      <span class="avatar" aria-hidden="true">{(app.me?.name ?? 'You').slice(0, 1).toUpperCase()}</span>
      <div class="grow">
        <h1>Settings</h1>
        <span class="muted">{app.me?.name ?? 'You'} · {location.host}</span>
      </div>
      <Button onclick={signOut}>Sign out</Button>
    </header>

    <Section title="Theme" description="The terminal uses the same palette.">
      <div class="row" role="group" aria-label="Theme">
        {#each themes as t (t.id)}
          <ChoiceButton shape="card" pressed={t.id === active} onclick={() => useTheme(t.id)}>
            <span class="swatches" aria-hidden="true">
              {#each swatches(t.id) as c, i (i)}<span class="sw" style:--sw={c}></span>{/each}
            </span>
            {t.name}
            {#if !t.builtIn}<span class="muted small">custom</span>{/if}
          </ChoiceButton>
        {/each}
        <a class="new" href={href('settings', 'theme', 'new')}>+ New theme</a>
      </div>
      {#if themes.some((t) => !t.builtIn)}
        <div class="row small">
          Edit:
          {#each themes.filter((t) => !t.builtIn) as t (t.id)}<a href={href('settings', 'theme', t.id)}>{t.name}</a
            >{/each}
        </div>
      {/if}
    </Section>

    <Section title="Phone pairing">
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
            <li>The phone must be in your Tailscale network.</li>
            <li>Scan the code with the phone camera; shub opens and signs the phone in. No token to type.</li>
            <li>Add it to the home screen and allow notifications for push.</li>
          </ol>
          {#if pairing}
            <span class="muted small" aria-live="polite">
              {left > 0 ? `Code is single-use and runs out in ${countdown}.` : 'The code ran out.'}
            </span>
            <div class="row"><Button size="sm" onclick={newCode}>New code</Button></div>
          {/if}
        </div>
      </div>

      <ul class="list">
        {#each devices as d (d.id)}
          <li class="item">
            <span class="grow stack">
              <span class="strong">{d.name}{d.id === myDevice?.id ? ' · this device' : ''}</span>
              <span class="muted small"
                >{d.kind} · paired {d.pairedAt.slice(0, 10)} · last seen {when(d.lastSeenAt)} · push {d.push
                  ? 'on'
                  : 'off'}</span
              >
            </span>
            {#if d.push}<Button
                size="sm"
                onclick={() => api('pushTest').then(() => toast('Test push sent'), toastError)}>Test push</Button
              >{/if}
            {#if d.id !== myDevice?.id}<Button size="sm" variant="danger" onclick={() => (unpair = d)}>Unpair</Button
              >{/if}
          </li>
        {/each}
      </ul>
      {#if pushSupported() && !push}
        <div class="row"><Button onclick={turnOnPush}>Turn on push on this device</Button></div>
      {:else if !pushSupported()}
        <span class="muted small">This browser has no web push.</span>
      {/if}
    </Section>

    <Section
      title="Plugins"
      description="Each plugin is its own process with its own token; it can only do what its manifest asked for and you granted."
    >
      {#snippet aside()}<code>shub plugin add &lt;git-url&gt;</code>{/snippet}
      {#if !app.plugins.length}<p class="muted">No plugins installed.</p>{/if}
      <ul class="list">
        {#each app.plugins as p (p.name)}
          <li class="item top">
            <Checkbox
              label="Enable {p.name} plugin"
              hideLabel
              checked={p.enabled}
              onchange={(e) => updatePlugin(p, { enabled: e.currentTarget.checked })}
            />
            <span class="grow stack">
              <span class="strong">{p.name} <span class="muted small">{p.version} · {p.source}</span></span>
              {#if p.description}<span class="muted small">{p.description}</span>{/if}
              <fieldset class="rights">
                <legend class="muted small">Rights it asks for (tick to grant)</legend>
                {#each p.requestedRights as r (r)}
                  <Checkbox
                    label={RIGHTS[r] ?? r}
                    checked={p.grantedRights.includes(r)}
                    onchange={(e) =>
                      updatePlugin(p, {
                        grantedRights: e.currentTarget.checked
                          ? [...p.grantedRights, r]
                          : p.grantedRights.filter((x) => x !== r),
                      })}
                  />
                {/each}
              </fieldset>
            </span>
            <StatusBadge text={p.running ? 'running' : 'stopped'} tone={p.running ? 'done' : 'neutral'} />
            <Button size="sm" onclick={() => showLogs(p.name)}>Logs</Button>
          </li>
        {/each}
      </ul>
    </Section>

    <Section title="Notifications">
      <div class="stack gap">
        {#each NOTIFICATIONS as n (n.key)}
          <Checkbox
            label={n.label}
            checked={!!app.config?.notifications[n.key]}
            onchange={(e) => setNotification(n.key, e.currentTarget.checked)}
          />
        {/each}
      </div>
    </Section>

    <Section title="More">
      <div class="row">
        <Button onclick={() => (ui.shortcuts = true)}>Shortcuts</Button>
        <Button onclick={showActivity}>Activity log</Button>
        <Button onclick={() => (location.hash = href('settings', 'import'))}>Import projects again</Button>
        {#each settingsActions as a (a.plugin + a.id)}
          <Button
            onclick={() =>
              api('pluginAction', { params: { name: a.plugin, actionId: a.id }, body: {} }).then(
                () => toast(`${a.label} sent to ${a.plugin}`),
                toastError,
              )}>{a.label} <span class="muted small">· {a.plugin}</span></Button
          >
        {/each}
        <Button variant="danger" onclick={() => (rotating = true)}>Rotate access token</Button>
      </div>
    </Section>
  </div>
</div>

<Dialog
  open={!!unpair}
  title="Unpair {unpair?.name}?"
  description="It is signed out at once and needs a new QR code to come back."
  onclose={() => (unpair = null)}
>
  {#snippet actions()}
    <Button variant="ghost" onclick={() => (unpair = null)}>Cancel</Button>
    <Button variant="danger" onclick={() => unpair && doUnpair(unpair)}>Unpair</Button>
  {/snippet}
</Dialog>

<Dialog
  open={rotating}
  title="Rotate the access token?"
  description="A new token is written to the token file; every other browser and phone is signed out. Session and plugin tokens keep working."
  onclose={() => (rotating = false)}
>
  {#snippet actions()}
    <Button variant="ghost" onclick={() => (rotating = false)}>Cancel</Button>
    <Button variant="danger" onclick={rotate}>Rotate</Button>
  {/snippet}
</Dialog>

<Dialog open={!!logs} title="Logs of {logs?.plugin}" onclose={() => (logs = null)}>
  <pre class="log">{logs?.lines.join('\n') || 'No output yet.'}</pre>
</Dialog>

<Dialog
  open={!!activity}
  title="Activity log"
  description="What you, sessions and plugins changed."
  onclose={() => (activity = null)}
>
  <ul class="list log-list">
    {#each activity ?? [] as e (e.id)}
      <li class="item">
        <span class="grow stack">
          <span><span class="strong">{e.action}</span> · {e.actor}</span>
          <span class="muted small">{when(e.at)} · {e.detail}</span>
        </span>
        {#if e.undo}<Button size="sm" onclick={() => undo(e)}>Undo</Button>{/if}
      </li>
    {/each}
    {#if activity && !activity.length}<li class="muted">Nothing yet.</li>{/if}
  </ul>
</Dialog>

<style>
  .page {
    min-height: 100%;
    padding: var(--space-8) var(--space-4) var(--space-12);
    background: var(--bg);
  }

  .content {
    max-width: var(--size-page);
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
  }

  .back {
    font-size: var(--text-md);
    text-decoration: none;
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  h1 {
    margin: 0;
    font-size: var(--text-xl);
    font-weight: var(--weight-semibold);
  }

  .avatar {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--size-control-lg);
    height: var(--size-control-lg);
    border-radius: var(--radius-round);
    background: var(--purple);
    color: var(--on-accent);
    font-weight: var(--weight-semibold);
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

  .new {
    padding: var(--space-2-5) var(--space-3-5);
    border: var(--hairline) dashed var(--line-strong);
    border-radius: var(--radius-lg);
    text-decoration: none;
  }

  .swatches {
    display: inline-flex;
  }

  .sw {
    width: var(--space-3);
    height: var(--space-6);
    background: var(--sw);
  }

  .sw:first-child {
    border-radius: var(--radius-xs) 0 0 var(--radius-xs);
  }

  .sw:last-child {
    border-radius: 0 var(--radius-xs) var(--radius-xs) 0;
  }

  .pair {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-5);
    align-items: flex-start;
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
    background: var(--panel);
  }

  .top {
    align-items: flex-start;
  }

  .rights {
    display: flex;
    flex-direction: column;
    gap: var(--space-1-5);
    margin: var(--space-2) 0 0;
    padding: 0;
    border: 0;
  }

  .rights legend {
    margin-bottom: var(--space-1-5);
    padding: 0;
  }

  code,
  .log {
    font-family: var(--font-mono);
  }

  .log {
    max-height: 60vh;
    margin: 0;
    padding: var(--space-3);
    overflow: auto;
    border-radius: var(--radius-md);
    background: var(--term-bg);
    font-size: var(--text-sm);
    color: var(--fg-2);
    white-space: pre-wrap;
  }

  .log-list {
    max-height: 60vh;
    overflow-y: auto;
  }
</style>
