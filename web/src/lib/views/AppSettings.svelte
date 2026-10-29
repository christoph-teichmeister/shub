<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { Device } from '../../../../shared/api.ts';
  import Button from '../components/Button/Button.svelte';
  import Dialog from '../components/Dialog/Dialog.svelte';
  import Icon from '../components/Icon/Icon.svelte';
  import Account from './AppSettings/Account.svelte';
  import Appearance from './AppSettings/Appearance.svelte';
  import Devices from './AppSettings/Devices.svelte';
  import Plugins from './AppSettings/Plugins.svelte';
  import Sessions from './AppSettings/Sessions.svelte';
  import Sync from './AppSettings/Sync.svelte';
  import Updates from './AppSettings/Updates.svelte';
  import { api } from '../stores/api.ts';
  import { href, router } from '../stores/router.svelte.ts';
  import { app, loadUpdate, ui } from '../stores/state.svelte.ts';
  import { toast, toastError } from '../stores/toasts.svelte.ts';

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

  // Devices stay loaded on every area: the nav and the attention bar show the ones waiting for approval.
  let devices = $state<Device[]>([]);
  let unpair = $state<Device | null>(null);
  let approving = $state<Device | null>(null);

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

  async function approve(d: Device) {
    approving = null;
    await api('deviceApprove', { params: { id: d.id }, body: { confirm: true } }).then(
      () => toast(`${d.name} approved`),
      toastError,
    );
    void loadDevices();
  }

  const pending = $derived(devices.filter((d) => d.state === 'pending'));

  async function doUnpair(d: Device) {
    unpair = null;
    await api('deviceDelete', { params: { id: d.id } }).then(() => toast(`${d.name} unpaired`), toastError);
    void loadDevices();
  }

  onMount(() => void loadDevices());

  const update = $derived(app.update);

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
          {#if a.id === 'appearance'}<Appearance />
          {:else if a.id === 'sessions'}<Sessions onpush={() => void loadDevices()} />
          {:else if a.id === 'devices'}<Devices
              {devices}
              onapprove={(d) => (approving = d)}
              onunpair={(d) => (unpair = d)}
              onchange={() => void loadDevices()}
            />
          {:else if a.id === 'sync'}<Sync />
          {:else if a.id === 'plugins'}<Plugins />
          {:else if a.id === 'updates'}<Updates {switching} oninstall={installUpdate} onrollback={rollBack} />
          {:else}<Account />{/if}
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

<style>
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

  .grow {
    flex: 1 1 auto;
    min-width: 0;
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
</style>
