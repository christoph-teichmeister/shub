<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type {
    ActivityEntry,
    Config,
    Device,
    HostPeer,
    TranscriptProgress,
    LaunchPermissionMode,
    PhoneSetup,
    PluginInfo,
    ReleaseNotes,
    Right,
    TerminalSettings,
    UpdateStatus,
  } from '../../../../shared/api.ts';
  import { terminalSettingsError, type SyncCategory } from '../../../../shared/api.ts';
  import Button from '../components/Button/Button.svelte';
  import Conflicts from '../components/Conflicts/Conflicts.svelte';
  import Checkbox from '../components/Checkbox/Checkbox.svelte';
  import ChoiceButton from '../components/ChoiceButton/ChoiceButton.svelte';
  import Dialog from '../components/Dialog/Dialog.svelte';
  import Icon from '../components/Icon/Icon.svelte';
  import Markdown from '../components/Markdown/Markdown.svelte';
  import Section from '../components/Section/Section.svelte';
  import SelectField from '../components/SelectField/SelectField.svelte';
  import StatusBadge from '../components/StatusBadge/StatusBadge.svelte';
  import TextField from '../components/TextField/TextField.svelte';
  import { api } from '../stores/api.ts';
  import { pushEnabled, pushSupported, subscribePush } from '../stores/push.ts';
  import { fleet, removeMachine, renameMachine } from '../stores/machines.svelte.ts';
  import { href, router } from '../stores/router.svelte.ts';
  import {
    app,
    deviceTerminal,
    loadConfig,
    loadPlugins,
    loadUpdate,
    setDeviceTerminal,
    terminalSettings,
    ui,
  } from '../stores/state.svelte.ts';
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
  const MODES: { value: LaunchPermissionMode; label: string; hint: string; risky?: boolean }[] = [
    { value: 'default', label: 'Ask first', hint: 'Asks before commands and edits.' },
    { value: 'acceptEdits', label: 'Accept edits', hint: 'Edits files freely, asks for commands.' },
    { value: 'plan', label: 'Plan', hint: 'Reads and plans, changes nothing.' },
    { value: 'auto', label: 'Auto', hint: 'Skips prompts with a safety check.', risky: true },
    { value: 'bypassPermissions', label: 'Bypass', hint: 'Skips every prompt. Only in sandboxes.', risky: true },
    { value: 'inherit', label: 'My Claude settings', hint: 'Uses your ~/.claude settings as they are.' },
  ];

  const CHANNELS = [
    { value: 'stable', label: 'Stable' },
    { value: 'beta', label: 'Beta (pre-releases)' },
  ];
  const UPDATE_MODES = [
    { value: 'ask', label: 'Ask me first' },
    { value: 'auto', label: 'Install automatically' },
    { value: 'off', label: 'Don\'t check (only "Check now")' },
  ];

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

  const CURSORS = [
    { value: 'underline', label: 'Underline' },
    { value: 'block', label: 'Block' },
    { value: 'bar', label: 'Bar' },
  ];
  const WEIGHTS = [
    { value: 'normal', label: 'Normal' },
    { value: 'bold', label: 'Bold' },
  ];
  const AREAS = [
    { id: 'appearance', title: 'Appearance', description: 'How shub and its terminals look.' },
    { id: 'sessions', title: 'Sessions', description: 'How new sessions start and when shub tells you about them.' },
    {
      id: 'devices',
      title: 'Devices',
      description: 'Phones that reach this shub, and the other machines this app knows.',
    },
    {
      id: 'sync',
      title: 'Sync',
      description: 'What this machine shares with your other devices. The devices themselves always sync.',
    },
    { id: 'plugins', title: 'Plugins', description: 'Each plugin can only do what it asked for and you granted.' },
    { id: 'updates', title: 'Updates', description: 'Which shub version runs and how new ones arrive.' },
    { id: 'account', title: 'Account & security', description: 'Who is signed in, what changed, the access token.' },
  ] as const;

  let renamingMachine = $state<{ origin: string; name: string } | null>(null);
  let query = $state('');
  let search = $state<HTMLInputElement>();
  const words = $derived(query.toLowerCase().split(/\s+/).filter(Boolean));
  /** Matching cards per area while searching; filled from the cards' rendered text by the effect below. */
  let hits = $state<Record<string, number>>({});
  let main = $state<HTMLElement>();
  /** The area in the URL (#/settings/<area>); none shows Sessions, or on a phone the area list. */
  const picked = $derived.by(() => {
    const r = router.route;
    return r.name === 'settings' ? AREAS.find((a) => a.id === r.rest[0]) : undefined;
  });
  const area = $derived(picked?.id ?? 'sessions');
  const panes = $derived(words.length ? AREAS : AREAS.filter((a) => a.id === area));

  /**
   * Search reads what the cards show (titles, labels, hints, options), so new settings are found without a word list.
   * Hides cards without every query word and areas without such a card; reruns when the query or the rendered text changes.
   */
  const HIGHLIGHT = 'settings-search';
  /** Folded parts that search opened to show a hit; they close again when the search ends. */
  const opened = new Set<HTMLDetailsElement>();

  function filterCards() {
    const next: Record<string, number> = {};
    const ranges: Range[] = [];
    for (const pane of main?.querySelectorAll<HTMLElement>('.pane') ?? []) {
      let n = 0;
      for (const card of pane.querySelectorAll<HTMLElement>('.card')) {
        const text = card.textContent?.toLowerCase() ?? '';
        card.hidden = !words.every((w) => text.includes(w));
        if (card.hidden) continue;
        n++;
        if (words.length) markWords(card, ranges);
      }
      next[pane.dataset.area ?? ''] = n;
    }
    hits = next;
    if (!words.length) {
      for (const d of opened) d.open = false;
      opened.clear();
    }
    CSS.highlights?.set(HIGHLIGHT, new Highlight(...ranges));
  }

  /** Adds a range for every query word in the card's text and opens folded parts that hold one. */
  function markWords(card: HTMLElement, ranges: Range[]) {
    const walk = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
    for (let node = walk.nextNode(); node; node = walk.nextNode()) {
      const text = node.textContent?.toLowerCase() ?? '';
      for (const w of words)
        for (let i = text.indexOf(w); i >= 0; i = text.indexOf(w, i + w.length)) {
          const range = new Range();
          range.setStart(node, i);
          range.setEnd(node, i + w.length);
          ranges.push(range);
          const fold = node.parentElement?.closest('details');
          if (fold && !fold.open && !node.parentElement?.closest('summary')) {
            fold.open = true;
            opened.add(fold);
          }
        }
    }
  }

  $effect(() => {
    void words;
    void tick().then(filterCards);
  });
  $effect(() => {
    if (!main) return;
    const watch = new MutationObserver(filterCards);
    watch.observe(main, { childList: true, subtree: true, characterData: true });
    return () => (watch.disconnect(), CSS.highlights?.delete(HIGHLIGHT));
  });

  function onKeydown(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (e.key !== '/' || e.altKey || e.ctrlKey || e.metaKey || t.closest('input, textarea, select, [contenteditable]'))
      return;
    e.preventDefault();
    search?.focus();
  }

  const terminal = $derived(terminalSettings());
  /** Fields the reset button clears: this device's own, or the shared ones. */
  const terminalOwn = $derived(deviceTerminal.value ?? app.config?.terminal ?? {});

  const themes = $derived([...BUILT_IN_THEMES, ...(app.config?.themes ?? []).filter((t) => !t.builtIn)]);
  const active = $derived(app.config?.activeTheme ?? 'monokai');
  const myDevice = $derived(app.me?.device ?? null);
  const settingsActions = $derived(
    app.plugins.flatMap((p) => (p.enabled ? p.settingsActions.map((a) => ({ plugin: p.name, ...a })) : [])),
  );

  let devices = $state<Device[]>([]);
  let pairing = $state<{ code: string; url: string; qrSvg: string; expiresAt: string } | null>(null);
  let phone = $state<PhoneSetup | null>(null);
  let serving = $state(false);
  let serveError = $state('');
  let now = $state(Date.now());
  let push = $state(false);
  let unpair = $state<Device | null>(null);
  let renaming = $state<Device | null>(null);
  let approving = $state<Device | null>(null);
  let newName = $state('');
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

  // Another device paired, was approved or removed.
  $effect(() => {
    if (app.devicesVersion) void loadDevices();
  });

  /** Approving and changing levels work on a trusted host and from a phone at level Control. */
  const local = $derived(!!app.me?.local);
  const LEVEL_OPTIONS = [
    { value: 'view', label: 'View' },
    { value: 'prompts', label: 'Prompts' },
    { value: 'control', label: 'Control' },
  ];

  async function approve(d: Device) {
    approving = null;
    await api('deviceApprove', { params: { id: d.id }, body: { confirm: true } }).then(
      () => toast(`${d.name} approved`),
      toastError,
    );
    void loadDevices();
  }

  async function setLevel(d: Device, level: string) {
    await api('deviceUpdate', { params: { id: d.id }, body: { level } }).catch(toastError);
    void loadDevices();
  }

  const pending = $derived(devices.filter((d) => d.state === 'pending'));
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
    void loadDevices();
    void loadPhone();
    void loadPeers();
    void pushEnabled().then((on) => (push = on));
    const tick = setInterval(() => (now = Date.now()), 1000);
    const peers = setInterval(loadPeers, 10_000);
    return () => (clearInterval(tick), clearInterval(peers));
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

  /** null resets a field (to the shared value on a device with its own settings, else to the default). */
  async function setTerminal(patch: { [K in keyof TerminalSettings]?: TerminalSettings[K] | null }) {
    if (deviceTerminal.value) {
      const error = terminalSettingsError(patch);
      if (error) return toastError(new Error(error));
      const own: Record<string, unknown> = { ...deviceTerminal.value, ...patch };
      for (const k of Object.keys(own)) if (own[k] === null) delete own[k];
      return setDeviceTerminal(own);
    }
    const config = await api<Config>('settings', { body: { terminal: patch } }).catch(toastError);
    if (config) app.config = config;
    else void loadConfig();
  }
  const numberInput = (key: 'fontSize' | 'lineHeight' | 'letterSpacing' | 'scrollback') => (e: Event) => {
    const v = (e.currentTarget as HTMLInputElement).valueAsNumber;
    void setTerminal({ [key]: Number.isNaN(v) ? null : v });
  };

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

  async function doRename(e: SubmitEvent) {
    e.preventDefault();
    if (!renaming) return;
    const id = renaming.id;
    renaming = null;
    await api('deviceUpdate', { params: { id }, body: { name: newName } }).catch(toastError);
    void loadDevices();
  }

  async function updatePlugin(p: PluginInfo, body: { enabled?: boolean; grantedRights?: Right[] }) {
    await api('pluginUpdate', { params: { name: p.name }, body }).catch(toastError);
    void loadPlugins();
  }

  let upgrading = $state<string | null>(null);
  async function upgradePlugin(p: PluginInfo) {
    upgrading = p.name;
    const res = await api<PluginInfo>('pluginUpgrade', { params: { name: p.name } }).catch(toastError);
    upgrading = null;
    if (res) toast(`${p.name} updated to ${res.version}`);
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

  /** Set while the launcher downloads, verifies and restarts shub; the line under the button says which step. */
  let switching = $state<{ to: string; verb: string } | null>(null);

  /** Starts the launcher, then polls until it reports a result or the new version answers (2 min at most). */
  async function switchVersion(to: string, verb: string, start: () => Promise<unknown>) {
    switching = { to, verb };
    const since = Date.now();
    if (await start().catch(toastError)) {
      const done = () => {
        const u = app.update;
        return u?.current === to || (!!u?.last && Date.parse(u.last.at) >= since - 5000);
      };
      while (!done() && Date.now() - since < 120_000) {
        await new Promise((r) => setTimeout(r, 2000));
        await loadUpdate();
      }
      if (!done()) toast('No answer from the launcher after 2 minutes; see update.log in the shub home.', 'error');
    }
    switching = null;
  }

  const installUpdate = (version: string) =>
    switchVersion(version, 'Installing', () => api('updateInstall', { body: { version } }));
  const rollBack = (version: string) => switchVersion(version, 'Rolling back to', () => api('updateRollback'));

  const swatches = (id: string) => {
    const t = resolveTokens(themes.find((x) => x.id === id) ?? BUILT_IN_THEMES[0]);
    return [t.bg, t.panel, t.primary, t.pink, t['status-working'], t['status-your-turn']];
  };
  const when = (iso: string) => new Date(iso).toLocaleString();
</script>

<svelte:window onkeydown={onKeydown} />

<div class="page">
  <header class="topbar">
    <a class="back" href={href()}>← {ui.phone ? 'Back' : 'Sessions'}</a>
    <h1>Settings</h1>
    <label class="search">
      <Icon name="search" size="sm" />
      <input
        bind:this={search}
        bind:value={query}
        type="search"
        placeholder="Search all settings: font, push, beta …"
        aria-label="Search all settings"
        autocomplete="off"
        onkeydown={(e) => e.key === 'Escape' && (query = '')}
      />
      {#if !query}<kbd>/</kbd>{/if}
    </label>
  </header>

  <div class="layout" class:picked={!!picked || words.length > 0}>
    <nav class="nav" aria-label="Settings areas">
      {#each AREAS as a (a.id)}
        <a
          href={href('settings', a.id)}
          class:on={!words.length && a.id === area}
          class:dim={words.length > 0 && !hits[a.id]}
          aria-current={!words.length && a.id === area ? 'page' : undefined}
          >{a.title}
          {#if words.length}{#if hits[a.id]}<span class="count">{hits[a.id]}</span>{/if}
          {:else if a.id === 'devices' && pending.length}<span class="badge">{pending.length}</span>
          {:else if a.id === 'plugins' && app.plugins.length}<span class="muted small">{app.plugins.length}</span>
          {:else if a.id === 'updates' && update?.latest && update.managedBy !== 'git'}<span class="new">new</span>
          {/if}</a
        >
      {/each}
      <div class="elsewhere">
        <button type="button" class="link" onclick={() => (ui.shortcuts = true)}>Keyboard shortcuts</button>
        <a class="plain" href={href('settings', 'import')}>Import projects</a>
      </div>
    </nav>

    <main class="main" bind:this={main}>
      <a class="up" href={href('settings')}>‹ All settings</a>
      {#if !words.length}
        {@render attention()}
      {:else if !Object.values(hits).some(Boolean)}
        <p class="muted">Nothing matches “{query}”.</p>
      {/if}

      {#each panes as a (a.id)}
        <section class="pane" data-area={a.id} hidden={words.length > 0 && !hits[a.id]} aria-labelledby="pane-{a.id}">
          <div class="pane-head">
            <h2 id="pane-{a.id}">{a.title}</h2>
            {#if words.length}<a href={href('settings', a.id)} onclick={() => (query = '')}>Open</a>
            {:else}<p class="muted">{a.description}</p>{/if}
          </div>
          {#if a.id === 'appearance'}{@render appearance()}
          {:else if a.id === 'sessions'}{@render sessions()}
          {:else if a.id === 'devices'}{@render devicesPane()}
          {:else if a.id === 'sync'}{@render sync()}
          {:else if a.id === 'plugins'}{@render plugins()}
          {:else if a.id === 'updates'}{@render updates()}
          {:else}{@render account()}{/if}
        </section>
      {/each}
    </main>
  </div>
</div>

{#snippet attention()}
  {@const showPending = area !== 'devices' ? pending : []}
  {@const showUpdate = area !== 'updates' && !!update?.latest && update.managedBy !== 'git'}
  {#if showPending.length || showUpdate}
    <div class="attention" role="region" aria-label="Needs attention">
      {#each showPending as d (d.id)}
        <div class="cta warn">
          <span class="dot" aria-hidden="true"></span>
          <span class="grow"><span class="strong">{d.name}</span> wants to connect</span>
          {#if local}
            <Button size="sm" onclick={() => (unpair = d)}>Reject</Button>
            <Button size="sm" variant="primary" onclick={() => (approving = d)}>Approve</Button>
          {:else}<span class="small">Approve on a trusted host</span>{/if}
        </div>
      {/each}
      {#if showUpdate && update?.latest}
        {@const latest = update.latest}
        <div class="cta">
          <span class="dot ok" aria-hidden="true"></span>
          <span class="grow"
            >shub <span class="strong">{latest}</span> is available ·
            <a href={href('settings', 'updates')}>What's new</a></span
          >
          <Button size="sm" variant="primary" disabled={!!switching} onclick={() => installUpdate(latest)}
            >{switching ? 'Installing…' : 'Install'}</Button
          >
        </div>
      {/if}
    </div>
  {/if}
{/snippet}

{#snippet appearance()}
  <div class="card">
    <Section title="Theme" description="The terminal uses the same palette.">
      {#snippet aside()}<a href={href('settings', 'theme', 'new')}>+ New theme</a>{/snippet}
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
      </div>
      {#if themes.some((t) => !t.builtIn)}
        <div class="row small">
          Edit:
          {#each themes.filter((t) => !t.builtIn) as t (t.id)}<a href={href('settings', 'theme', t.id)}>{t.name}</a
            >{/each}
        </div>
      {/if}
    </Section>
  </div>

  <div class="card">
    <Section title="Terminal">
      {#snippet aside()}
        <span class="segment" role="group" aria-label="Terminal settings apply to">
          <span>Applies to</span>
          <ChoiceButton pressed={!deviceTerminal.value} onclick={() => setDeviceTerminal(null)}
            >All devices</ChoiceButton
          >
          <ChoiceButton pressed={!!deviceTerminal.value} onclick={() => deviceTerminal.value || setDeviceTerminal({})}
            >This device only</ChoiceButton
          >
        </span>
      {/snippet}
      <p class="muted small">
        {deviceTerminal.value
          ? 'Changes stay in this browser. Fields you have not changed follow the settings of all devices.'
          : 'Changes apply on every device. Pick "This device only" to give this browser, e.g. the phone, its own font or size.'}
      </p>
      <div class="split">
        <div class="stack gap fields">
          <TextField
            label="Font"
            hint="CSS font list, first installed one wins. The font must be installed on the device that shows the terminal."
            mono
            value={terminal.fontFamily}
            maxlength={200}
            autocomplete="off"
            onchange={(e) => setTerminal({ fontFamily: e.currentTarget.value.trim() || null })}
          />
          <div class="row end">
            <TextField
              label="Size (px)"
              type="number"
              min="6"
              max="40"
              step="1"
              value={terminal.fontSize}
              onchange={numberInput('fontSize')}
            />
            <SelectField
              label="Cursor"
              bind:value={
                () => terminal.cursorStyle, (v) => setTerminal({ cursorStyle: v as TerminalSettings['cursorStyle'] })
              }
              options={CURSORS}
            />
            <Checkbox
              label="Blinking cursor"
              checked={terminal.cursorBlink}
              onchange={(e) => setTerminal({ cursorBlink: e.currentTarget.checked })}
            />
          </div>
          <TextField
            label="Scrollback (lines)"
            type="number"
            min="0"
            max="100000"
            step="500"
            value={terminal.scrollback}
            onchange={numberInput('scrollback')}
          />
          <details class="more">
            <summary>Fine tuning: fallback font, line height, spacing, weight</summary>
            <div class="stack gap">
              <TextField
                label="Fallback font"
                hint="Used on devices that have none of the fonts above, e.g. the phone. Keep a generic name like monospace at the end."
                mono
                value={terminal.fallbackFont}
                maxlength={200}
                autocomplete="off"
                onchange={(e) => setTerminal({ fallbackFont: e.currentTarget.value.trim() || null })}
              />
              <div class="row end">
                <TextField
                  label="Line height"
                  type="number"
                  min="1"
                  max="2"
                  step="0.05"
                  value={terminal.lineHeight}
                  onchange={numberInput('lineHeight')}
                />
                <TextField
                  label="Letter spacing (px)"
                  type="number"
                  min="-2"
                  max="10"
                  step="0.5"
                  value={terminal.letterSpacing}
                  onchange={numberInput('letterSpacing')}
                />
                <SelectField
                  label="Weight"
                  bind:value={
                    () => terminal.fontWeight, (v) => setTerminal({ fontWeight: v as TerminalSettings['fontWeight'] })
                  }
                  options={WEIGHTS}
                />
              </div>
            </div>
          </details>
        </div>
        <div class="stack gap preview">
          <span class="muted small">Preview</span>
          <pre
            class="term-sample"
            aria-label="Font sample"
            style:font-family="{terminal.fontFamily}, {terminal.fallbackFont}"
            style:font-size="{terminal.fontSize}px"
            style:font-weight={terminal.fontWeight}
            style:line-height={terminal.lineHeight}
            style:letter-spacing="{terminal.letterSpacing}px">~/shub $ git status{'\n'}0O 1lI {'{}'} [] =&gt; != ─┬─│</pre>
          {#if Object.keys(terminalOwn).length}
            <div>
              <Button
                size="sm"
                onclick={() => setTerminal(Object.fromEntries(Object.keys(terminalOwn).map((k) => [k, null])))}
                >{deviceTerminal.value ? 'Reset to shared' : 'Reset to defaults'}</Button
              >
            </div>
          {/if}
        </div>
      </div>
    </Section>
  </div>
{/snippet}

{#snippet sessions()}
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
      description="A project session can start sessions and change projects, buttons and links without an approval. Still one level deep and limited to 5 starts an hour. Stays on this machine."
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
{/snippet}

{#snippet notify(key: keyof Config['notifications'], label: string)}
  <Checkbox
    {label}
    hideLabel
    checked={!!app.config?.notifications[key]}
    onchange={(e) => setNotification(key, e.currentTarget.checked)}
  />
{/snippet}

{#snippet devicesPane()}
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
                {#if local}<Button size="sm" variant="primary" onclick={() => (approving = d)}>Approve</Button>
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
            {#if d.id !== myDevice?.id}<Button size="sm" variant="danger" onclick={() => (unpair = d)}
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
{/snippet}

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

{#snippet plugins()}
  <div class="card">
    <Section title="Installed plugins">
      {#snippet aside()}<code>shub plugin add &lt;git-url&gt;</code>{/snippet}
      {#if !app.plugins.length}<p class="muted">No plugins installed.</p>{/if}
      <ul class="list">
        {#each app.plugins as p (p.name)}
          {@const actions = settingsActions.filter((a) => a.plugin === p.name)}
          <li class="item top">
            <Checkbox
              label="Enable {p.name} plugin"
              hideLabel
              checked={p.enabled}
              onchange={(e) => updatePlugin(p, { enabled: e.currentTarget.checked })}
            />
            <span class="grow stack gap">
              <span class="strong">{p.name} <span class="muted small">{p.version} · {p.source}</span></span>
              {#if p.description}<span class="muted small">{p.description}</span>{/if}
              <details class="more">
                <summary>Rights: {p.grantedRights.length} of {p.requestedRights.length} granted</summary>
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
              </details>
              {#if actions.length}
                <span class="row">
                  {#each actions as a (a.id)}
                    <Button
                      size="sm"
                      onclick={() =>
                        api('pluginAction', { params: { name: a.plugin, actionId: a.id }, body: {} }).then(
                          () => toast(`${a.label} sent to ${a.plugin}`),
                          toastError,
                        )}>{a.label}</Button
                    >
                  {/each}
                </span>
              {/if}
            </span>
            <StatusBadge text={p.running ? 'running' : 'stopped'} tone={p.running ? 'done' : 'neutral'} />
            {#if p.updateAvailable}
              <Button size="sm" disabled={upgrading === p.name} onclick={() => upgradePlugin(p)}
                >{upgrading === p.name ? 'Updating…' : 'Update'}</Button
              >
            {/if}
            <Button size="sm" onclick={() => showLogs(p.name)}>Logs</Button>
          </li>
        {/each}
      </ul>
    </Section>
  </div>
{/snippet}

{#snippet updates()}
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
                      onclick={() => update.latest && installUpdate(update.latest)}>Install {update.latest}</Button
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
                <Button disabled={!!switching} onclick={() => update.previous && rollBack(update.previous)}
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
{/snippet}

{#snippet sync()}
  <div class="card">
    <Section
      title="Other hosts"
      description="Hosts of your device group, found through the group, no addresses to type."
    >
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
{/snippet}

{#snippet account()}
  <div class="card">
    <Section title="Signed in">
      <div class="row">
        <span class="avatar" aria-hidden="true">{(app.me?.name ?? 'You').slice(0, 1).toUpperCase()}</span>
        <span class="grow stack"
          ><span class="strong">{app.me?.name ?? 'You'}</span><span class="muted small">{location.host}</span></span
        >
        <Button onclick={showActivity}>Activity log</Button>
        <Button onclick={signOut}>Sign out</Button>
      </div>
    </Section>
  </div>
  <div class="card danger-zone">
    <Section
      title="Access token"
      description="Rotating writes a new token and signs out every other browser and phone. Session and plugin tokens keep working."
    >
      <div><Button variant="danger" onclick={() => (rotating = true)}>Rotate access token</Button></div>
    </Section>
  </div>
{/snippet}

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
  open={!!approving}
  title="Approve {approving?.name}?"
  description="A {approving?.kind} that redeemed a code made on {approving?.host ??
    'a host'} wants to join your devices. Only approve it if you just paired it yourself."
  onclose={() => (approving = null)}
>
  {#snippet actions()}
    <Button variant="ghost" onclick={() => (approving = null)}>Cancel</Button>
    <Button variant="primary" onclick={() => approving && approve(approving)}>Approve</Button>
  {/snippet}
</Dialog>

<Dialog open={!!renaming} title="Rename {renaming?.name}" onclose={() => (renaming = null)}>
  <form id="rename-device" onsubmit={doRename}>
    <TextField label="Device name" bind:value={newName} required autocomplete="off" />
  </form>
  {#snippet actions()}
    <Button variant="ghost" onclick={() => (renaming = null)}>Cancel</Button>
    <Button type="submit" form="rename-device">Save</Button>
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

  .page {
    min-height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--bg);
  }

  .topbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3) var(--space-6);
    padding: var(--space-3) var(--space-6);
    border-bottom: var(--hairline) solid var(--line);
  }

  .back {
    font-size: var(--text-md);
    text-decoration: none;
  }

  h1 {
    margin: 0;
    font-size: var(--text-lg);
    font-weight: var(--weight-semibold);
  }

  .search {
    flex: 1 1 var(--size-sidebar-min);
    max-width: var(--size-dialog);
    margin: 0 auto;
    display: flex;
    align-items: center;
    gap: var(--space-2-5);
    padding: var(--space-2) var(--space-3);
    border: var(--hairline) solid var(--line-strong);
    border-radius: var(--radius-md);
    background: var(--panel);
    color: var(--muted);
  }

  .search:focus-within {
    border-color: var(--primary);
  }

  .search input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--fg);
    font: inherit;
  }

  kbd {
    padding: 0 var(--space-1);
    border: var(--hairline) solid var(--line-strong);
    border-radius: var(--radius-xs);
    font-size: var(--text-xs);
  }

  .layout {
    flex: 1;
    display: flex;
    flex-wrap: wrap;
  }

  .nav {
    flex: 1 1 var(--size-tab-label);
    max-width: var(--size-sidebar-min);
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    padding: var(--space-5) var(--space-3);
    border-right: var(--hairline) solid var(--line);
  }

  .nav > a {
    display: flex;
    align-items: center;
    gap: var(--space-2-5);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    color: var(--fg-2);
    text-decoration: none;
  }

  .nav > a:hover {
    background: var(--panel);
    color: var(--fg);
  }

  .nav > a.on {
    background: var(--raised);
    color: var(--fg);
    font-weight: var(--weight-semibold);
  }

  .nav > a.dim {
    color: var(--muted);
  }

  .nav :is(.badge, .count, .new, .muted) {
    margin-left: auto;
    font-weight: var(--weight-regular);
  }

  .badge,
  .count {
    padding: 0 var(--space-2);
    border-radius: var(--radius-pill);
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
  }

  .badge {
    background: var(--status-needs-you-bg);
    color: var(--status-needs-you-fg);
  }

  .count {
    background: var(--raised);
    color: var(--yellow);
  }

  .new {
    font-size: var(--text-sm);
    color: var(--status-your-turn);
  }

  .elsewhere {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-1);
    margin-top: var(--space-6);
    padding: var(--space-4) var(--space-3) 0;
    border-top: var(--hairline) solid var(--line);
    font-size: var(--text-md);
  }

  .plain {
    text-decoration: none;
  }

  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--link);
    font: inherit;
    cursor: pointer;
  }

  .main {
    flex: 999 1 var(--size-dialog);
    min-width: 0;
    max-width: var(--size-page-wide);
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    padding: var(--space-6) var(--space-8) var(--space-12);
  }

  .up {
    display: none;
    text-decoration: none;
  }

  /* Phone width: the area list first, then one area with a way back. */
  @media (width <= 720px) {
    .nav {
      max-width: none;
      border-right: 0;
    }

    .main {
      padding: var(--space-4);
    }

    .layout.picked .nav,
    .layout:not(.picked) .main {
      display: none;
    }

    .up {
      display: block;
    }

    .nav > a {
      min-height: var(--size-touch);
    }

    .layout:not(.picked) .nav > a::after {
      content: '›';
      color: var(--muted);
    }

    .layout:not(.picked) .nav > a:not(:has(.badge, .count, .new, .muted))::after {
      margin-left: auto;
    }

    .layout:not(.picked) .nav > a.on {
      background: none;
      color: var(--fg-2);
      font-weight: var(--weight-regular);
    }
  }

  .pane {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .pane[hidden] {
    display: none;
  }

  .pane-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-1) var(--space-4);
  }

  .pane-head h2 {
    margin: 0;
    font-size: var(--text-xl);
    font-weight: var(--weight-semibold);
  }

  .pane-head p {
    flex-basis: 100%;
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

  .attention {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2-5);
  }

  .cta {
    flex: 1 1 var(--size-column);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border: var(--hairline) solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--panel);
  }

  .cta.warn {
    border-color: transparent;
    background: var(--status-needs-you-bg);
    color: var(--status-needs-you-fg);
  }

  .dot {
    width: var(--size-dot);
    height: var(--size-dot);
    flex: none;
    border-radius: var(--radius-round);
    background: var(--status-needs-you);
  }

  .dot.ok {
    background: var(--status-your-turn);
  }

  .segment {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1);
  }

  .split {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-5) var(--space-8);
    align-items: flex-start;
  }

  .fields {
    flex: 1 1 var(--size-preview);
    min-width: 0;
  }

  .preview {
    flex: 1 1 var(--size-column);
    min-width: 0;
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

  .end {
    align-items: flex-end;
  }

  .term-sample {
    margin: 0;
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-md);
    background: var(--term-bg);
    color: var(--term-fg);
    overflow-x: auto;
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

  .cta.warn .strong {
    color: inherit;
  }

  .muted {
    margin: 0;
    color: var(--muted);
  }

  .small {
    font-size: var(--text-sm);
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

  .rights {
    display: flex;
    flex-direction: column;
    gap: var(--space-1-5);
    margin: 0;
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

  .log-list {
    max-height: 60vh;
    overflow-y: auto;
  }

  .code {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-2);
  }
</style>
