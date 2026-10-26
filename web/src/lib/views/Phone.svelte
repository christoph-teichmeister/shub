<script lang="ts">
  // Phone layout (viewport < 700 px), same routes as the desktop: #/ is the overview, #/p/<id>/<session> a terminal.
  import ChatView from '../components/ChatView/ChatView.svelte';
  import CommandChip from '../components/CommandChip/CommandChip.svelte';
  import MachineSwitcher from '../components/MachineSwitcher/MachineSwitcher.svelte';
  import { fleet } from '../stores/machines.svelte.ts';
  import {
    API_VERSION,
    type ChildWorktree,
    type OldSession,
    type ServiceContainer,
    type Session,
    type SessionStatus,
  } from '../../../../shared/api.ts';
  import Button from '../components/Button/Button.svelte';
  import Dialog from '../components/Dialog/Dialog.svelte';
  import TextField from '../components/TextField/TextField.svelte';
  import Icon from '../components/Icon/Icon.svelte';
  import IconButton from '../components/IconButton/IconButton.svelte';
  import ProjectIcon from '../components/ProjectIcon/ProjectIcon.svelte';
  import ServicesTree from '../components/ServicesTree/ServicesTree.svelte';
  import StatusDot from '../components/StatusDot/StatusDot.svelte';
  import PausedPanel from '../components/PausedPanel/PausedPanel.svelte';
  import TerminalView from '../components/TerminalView/TerminalView.svelte';
  import Conflicts from '../components/Conflicts/Conflicts.svelte';
  import Wordmark from '../components/Wordmark/Wordmark.svelte';
  import { idleWithAgents, statusLabel } from '../status.ts';
  import { childLabel, childStart, sessionsIn } from '../children.ts';
  import { api } from '../stores/api.ts';
  import { href, router } from '../stores/router.svelte.ts';
  import {
    app,
    childrenOf,
    needsYouCount,
    sendKeys,
    sessionHref,
    sessionsOf,
    startSession,
    ui,
  } from '../stores/state.svelte.ts';
  import { serviceAction, serviceInspect, serviceLogs } from '../stores/services.ts';
  import { pushEnabled, pushSupported, subscribePush } from '../stores/push.ts';
  import { toast, toastError } from '../stores/toasts.svelte.ts';

  const route = $derived(router.route);
  const open = $derived<Session | null>(
    route.name === 'global'
      ? (app.sessions.find((s) => s.kind === 'global') ?? null)
      : route.name === 'project'
        ? ((route.sessionId ? app.sessions.find((s) => s.id === route.sessionId) : sessionsOf(route.projectId)[0]) ??
          null)
        : null,
  );
  // The open session's panes (a second Claude, terminals): the open one may be a pane itself.
  const panes = $derived.by(() => {
    const root = open?.parentId ? (app.sessions.find((s) => s.id === open.parentId) ?? open) : open;
    return root ? [root, ...childrenOf(root.id)] : [];
  });
  const projectOf = (s: Session) => app.projects.find((p) => p.id === s.projectId) ?? null;
  const visible = $derived(app.sessions.filter((s) => s.kind !== 'shell'));
  const SECTIONS: { status: SessionStatus; title: string }[] = [
    { status: 'needs-you', title: 'Needs you' },
    { status: 'working', title: 'Working' },
    { status: 'your-turn', title: 'Your turn' },
    { status: 'new', title: 'Not started' },
    { status: 'waiting', title: 'Waiting' },
  ];

  /** Worktrees sessions created with no Claude of shub's running there: a tap starts or resumes one. */
  const dormant = $derived(app.children.filter((w) => !sessionsIn(w, app.sessions).length));
  async function openChild(w: ChildWorktree) {
    const request = childStart(w);
    const s = request && (await startSession(request));
    if (s) location.hash = sessionHref(s);
  }

  // Conversations other hosts of the group ran, merged into this list with their host as a badge. The sync only
  // lists them (the machine chips below switch to another machine's own live sessions).
  let others = $state<OldSession[]>([]);
  const projectIds = $derived(app.projects.map((p) => p.id).join(','));
  let visibleTick = $state(0);
  $effect(() => {
    const onShow = () => document.visibilityState === 'visible' && visibleTick++;
    document.addEventListener('visibilitychange', onShow);
    return () => document.removeEventListener('visibilitychange', onShow);
  });
  $effect(() => {
    void visibleTick; // refetch when the phone comes back from the background
    const ids = projectIds ? projectIds.split(',') : [];
    let stale = false;
    void Promise.all(ids.map((id) => api<OldSession[]>('oldSessions', { params: { id } }).catch(() => []))).then(
      (lists) =>
        stale ||
        (others = lists
          .flat()
          .filter((o) => o.host && o.resumable !== false)
          .slice(0, 20)),
    );
    return () => (stale = true);
  });
  async function resumeOther(o: OldSession) {
    const s = await startSession({
      projectId: o.projectId,
      kind: 'claude',
      name: o.firstPrompt.slice(0, 40),
      resumeClaudeSessionId: o.claudeSessionId,
      fork: true, // always safe from the phone; taking a conversation over is the desktop overlay's explicit button
    });
    if (s) location.hash = sessionHref(s);
  }
  // Claude sessions open as a chat, the live terminal stays one tap away (and is the only view of a shell).
  let terminalIds = $state<Record<string, boolean>>({});
  const chat = $derived(!!open && open.kind !== 'shell' && open.status !== 'paused' && !terminalIds[open.id]);

  let picking = $state(false);
  let showServices = $state(false);
  let services = $state<ServiceContainer[]>([]);
  let message = $state('');

  $effect(() => {
    const id = showServices && open?.kind === 'claude' ? open.id : null;
    void (id && app.servicesVersion[id]);
    if (!id) return;
    api<ServiceContainer[]>('services', { params: { id } }).then(
      (list) => (services = list),
      () => (services = []),
    );
  });

  const age = (iso: string) => {
    const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
    return min < 60 ? `${min} min` : min < 1440 ? `${Math.round(min / 60)} h` : `${Math.round(min / 1440)} d`;
  };
  const projectName = (s: Session) => projectOf(s)?.name ?? 'Global Claude';

  // Phone push is the point of the phone view: offer it once, where the user lands, not three screens deep.
  const PUSH_HIDE = 'shub.pushPrompt';
  let pushOffer = $state(false);
  $effect(() => {
    let hidden: string | null = null;
    try {
      hidden = localStorage.getItem(PUSH_HIDE);
    } catch {
      // storage blocked: offer again next time
    }
    if (hidden || !pushSupported() || Notification.permission === 'denied') return;
    void pushEnabled().then((on) => (pushOffer = !on));
  });
  const hidePushOffer = () => {
    pushOffer = false;
    try {
      localStorage.setItem(PUSH_HIDE, '1');
    } catch {
      // storage blocked: the offer comes back
    }
  };
  async function turnOnPush() {
    await subscribePush().then(() => {
      pushOffer = false;
      toast('Push is on: you get a ping when a session needs you');
    }, toastError);
  }

  // The permission question: one line until tapped (the terminal shows the full command anyway).
  let askOpen = $state(false);
  $effect(() => {
    void open?.pendingPermission?.summary;
    askOpen = false;
  });

  // Quick keys cost a row; a phone keyboard has no Esc or arrows, so they start shown and the choice sticks.
  const KEYS_SHOWN = 'shub.quickKeys';
  let keysShown = $state(true);
  try {
    keysShown = localStorage.getItem(KEYS_SHOWN) !== '0';
  } catch {
    // storage blocked: shown
  }
  function toggleKeys() {
    keysShown = !keysShown;
    try {
      localStorage.setItem(KEYS_SHOWN, keysShown ? '1' : '0');
    } catch {
      // not remembered
    }
  }

  // Pictures: the picker (or camera) hands each file to the paste route, which saves it and types its path
  // into the prompt, exactly like a paste on the desktop. The user adds a line and sends.
  let fileInput = $state<HTMLInputElement>();
  let attaching = $state(false);
  async function attach(e: Event & { currentTarget: HTMLInputElement }) {
    const files = [...(e.currentTarget.files ?? [])];
    e.currentTarget.value = '';
    if (!open || !files.length) return;
    attaching = true;
    try {
      for (const body of files) await api('sessionPaste', { params: { id: open.id }, body });
      toast(files.length === 1 ? 'Picture added to your message' : `${files.length} pictures added to your message`);
    } catch (err) {
      toastError(err);
    } finally {
      attaching = false;
    }
  }

  // New session sheet: pinned projects, plus a search over all of them once the list gets long.
  let pickQuery = $state('');
  const pickable = $derived.by(() => {
    const q = pickQuery.trim().toLowerCase();
    return q
      ? app.projects.filter((p) => p.name.toLowerCase().includes(q))
      : app.projects.filter((p) => p.visibility === 'pinned');
  });

  async function newIn(projectId: string | null) {
    picking = false;
    pickQuery = '';
    const s = await startSession({ projectId, kind: projectId ? 'claude' : 'global' });
    if (s) location.hash = sessionHref(s);
  }

  function send(e: SubmitEvent) {
    e.preventDefault();
    if (!open) return;
    const text = message;
    message = '';
    void sendKeys(open.id, text ? [text, 'Enter'] : ['Enter']);
  }

  const QUICK: { label: string; key: string; aria?: string }[] = [
    { label: 'Esc', key: 'Escape' },
    { label: 'Ctrl C', key: 'C-c' },
    { label: '↑', key: 'Up', aria: 'Arrow up' },
    { label: '↓', key: 'Down', aria: 'Arrow down' },
    // Claude's fullscreen UI scrolls its chat on these, whatever the touch swipe does.
    { label: 'PgUp', key: 'PageUp', aria: 'Page up' },
    { label: 'PgDn', key: 'PageDown', aria: 'Page down' },
    { label: 'Tab', key: 'Tab' },
    { label: '/', key: '/', aria: 'Slash' },
  ];
</script>

{#if open}
  {@const p = projectOf(open)}
  <div class="term-page">
    <header class="bar">
      <IconButton label="Back to overview" icon="chevron-left" size="lg" href={href()} />
      <div class="grow">
        <h1 class="name">{open.name}</h1>
        <span class="sub" class:needs={open.status === 'needs-you'}
          >{p?.name ?? 'Global Claude'} · {statusLabel(open)}</span
        >
      </div>
      {#if open.kind !== 'shell' && open.status !== 'paused'}
        <IconButton
          label={chat ? 'Show terminal' : 'Show chat'}
          icon={chat ? 'terminal' : 'message'}
          size="lg"
          variant="outline"
          onclick={() => (terminalIds[open.id] = chat)}
        />
      {/if}
      {#if open.kind === 'claude'}
        <IconButton
          label="Services"
          icon="services"
          size="lg"
          variant="outline"
          pressed={showServices}
          onclick={() => (showServices = !showServices)}
        />
      {/if}
    </header>

    {#if panes.length > 1}
      <nav class="panes" aria-label="Panes">
        {#each panes as s (s.id)}
          <a
            href={sessionHref(s)}
            aria-current={s.id === open.id ? 'page' : undefined}
            class:needs={s.status === 'needs-you'}>{s.name}</a
          >
        {/each}
      </nav>
    {/if}

    {#if showServices}
      <div class="services">
        <ServicesTree
          containers={services}
          onaction={(a, c) => serviceAction(a, c, open)}
          loadLogs={serviceLogs}
          loadInspect={serviceInspect}
        />
      </div>
    {/if}

    {#key open.id}
      {#if open.status === 'paused'}
        <PausedPanel session={open} />
      {:else if !chat}
        <TerminalView sessionId={open.id} accent={p?.accent} label={open.name} compact follow />
      {/if}
    {/key}

    {#snippet prompts()}
      <CommandChip
        session={open}
        phone
        onterminal={async (cwd) => {
          const shell = await startSession({
            projectId: open.projectId,
            kind: 'shell',
            parentId: panes[0]?.id ?? open.id,
            cwd,
          });
          if (shell) location.hash = sessionHref(shell);
          return shell?.id;
        }}
      />

      {#if open.pendingPermission}
        <div class="permission" role="group" aria-label="Answer the permission question">
          <button
            type="button"
            class="ask-line"
            class:open={askOpen}
            aria-expanded={askOpen}
            onclick={() => (askOpen = !askOpen)}
          >
            <span class="ask-tool">Allow {open.pendingPermission.tool}?</span>
            <span class="ask-summary">{open.pendingPermission.summary}</span>
          </button>
          <div class="big">
            <button type="button" class="key yes" onclick={() => sendKeys(open.id, ['1'])}>Yes</button>
            <button type="button" class="key no" onclick={() => sendKeys(open.id, ['3'])}>No</button>
            <button type="button" class="key always" onclick={() => sendKeys(open.id, ['2'])}>Always</button>
          </div>
        </div>
      {/if}

      {#if chat}
        <div class="chat-tools">
          <button
            type="button"
            class="keys-toggle"
            aria-label="Toggle quick keys"
            aria-pressed={keysShown}
            title="Toggle quick keys"
            onclick={toggleKeys}><Icon name={keysShown ? 'chevron-down' : 'terminal'} /></button
          >
          <button
            type="button"
            class="keys-toggle"
            aria-label="Attach a picture"
            title="Attach a picture"
            disabled={attaching}
            onclick={() => fileInput?.click()}><Icon name="upload" /></button
          >
        </div>
      {/if}

      {#if keysShown}
        <div class="quick" role="group" aria-label="Quick keys">
          {#each QUICK as q (q.key)}
            <button type="button" class="qk" aria-label={q.aria} onclick={() => sendKeys(open.id, [q.key])}
              >{q.label}</button
            >
          {/each}
        </div>
      {/if}
    {/snippet}

    {#if chat}
      {#key open.id}
        <ChatView session={open}>{@render prompts()}</ChatView>
      {/key}
    {:else}
      {@render prompts()}
    {/if}

    <input
      bind:this={fileInput}
      type="file"
      accept="image/*"
      multiple
      hidden
      aria-label="Pictures to send"
      onchange={attach}
    />

    {#if !chat}
      <form class="input" onsubmit={send}>
        <button
          type="button"
          class="keys-toggle"
          aria-label="Toggle quick keys"
          aria-pressed={keysShown}
          title="Toggle quick keys"
          onclick={toggleKeys}><Icon name={keysShown ? 'chevron-down' : 'terminal'} /></button
        >
        <button
          type="button"
          class="keys-toggle"
          aria-label="Attach a picture"
          title="Attach a picture"
          disabled={attaching}
          onclick={() => fileInput?.click()}><Icon name="upload" /></button
        >
        <label class="visually-hidden" for="phone-msg">Message to Claude</label>
        <input
          id="phone-msg"
          bind:value={message}
          placeholder="Message to Claude…"
          autocomplete="off"
          enterkeyhint="send"
        />
        <button type="submit" class="send" aria-label="Send"><Icon name="send" /></button>
      </form>
    {/if}
  </div>
{:else}
  <div class="overview">
    <header class="bar">
      <span class="grow"><Wordmark needsYou={needsYouCount() > 0} /></span>
      <Conflicts />
      <IconButton label="Search projects" icon="search" size="lg" onclick={() => (ui.search = true)} />
      <IconButton label="Settings" icon="gear" size="lg" href={href('settings')} />
    </header>
    {#if fleet.list.length}<MachineSwitcher />{/if}
    {#if app.apiMismatch !== null && !app.unreachable}
      <p class="unreachable">
        {fleet.list.find((m) => m.origin === fleet.selected)?.name.split('.')[0] ?? 'This machine'} runs a shub with API {app.apiMismatch},
        this app speaks {API_VERSION}. Update the older one; until then some things may fail.
      </p>
    {/if}
    {#if app.unreachable}
      <p class="unreachable">
        {fleet.list.find((m) => m.origin === fleet.selected)?.name.split('.')[0] ?? 'This machine'} does not answer. It may
        be off.
      </p>
    {/if}

    {#if pushOffer}
      <section class="offer" aria-label="Push notifications">
        <Icon name="bell" />
        <p class="grow">Get a ping when a session needs you, even with shub closed.</p>
        <Button variant="primary" onclick={turnOnPush}>Turn on</Button>
        <Button variant="ghost" onclick={hidePushOffer}>Not now</Button>
      </section>
    {/if}

    {#each SECTIONS as sec (sec.status)}
      {@const list = visible.filter((s) => s.status === sec.status)}
      {#if list.length}
        <section class="section" aria-labelledby="h-{sec.status}">
          <h2 id="h-{sec.status}" class:needs={sec.status === 'needs-you'}>{sec.title} · {list.length}</h2>
          {#each list as s (s.id)}
            {@const p = projectOf(s)}
            {#if sec.status === 'needs-you'}
              <article class="card needs-card">
                <div class="card-head">
                  {#if p}<ProjectIcon icon={p.resolvedIcon} name={p.name} />{:else}<Icon name="sparkle" />{/if}
                  <span class="grow stack"
                    ><span class="strong">{s.name}</span><span class="sub">{projectName(s)}</span></span
                  >
                  <span class="sub age">{age(s.lastActivityAt)}</span>
                </div>
                {#if s.pendingPermission}
                  <p class="ask">Allow: {s.pendingPermission.tool} · {s.pendingPermission.summary}?</p>
                  <div class="card-actions">
                    <Button variant="primary" onclick={() => sendKeys(s.id, ['1'])}>Yes</Button>
                    <Button onclick={() => sendKeys(s.id, ['3'])}>No</Button>
                    <a class="open" href={sessionHref(s)}>Open</a>
                  </div>
                {:else if s.pendingCommands?.length}
                  <p class="ask">{statusLabel(s)} · {s.pendingCommands[0].command}</p>
                  <div class="card-actions">
                    <a class="open" href={sessionHref(s)}>Open</a>
                  </div>
                {:else}
                  <div class="card-actions">
                    <a class="open" href={sessionHref(s)}>Open terminal</a>
                  </div>
                {/if}
              </article>
            {:else}
              <a class="card row" href={sessionHref(s)}>
                <StatusDot status={s.status} idle={idleWithAgents(s)} />
                <span class="grow stack"
                  ><span class="row-name">{s.name}</span><span class="sub">{projectName(s)}</span></span
                >
                <span class="sub age">{sec.status === 'working' ? age(s.lastActivityAt) : statusLabel(s)}</span>
              </a>
            {/if}
          {/each}
        </section>
      {/if}
    {/each}
    {#if others.length}
      <section class="section" aria-labelledby="h-others">
        <h2 id="h-others">On other hosts · {others.length}</h2>
        {#each others as o (o.claudeSessionId)}
          <button class="card row child" onclick={() => resumeOther(o)}>
            <span class="grow stack"
              ><span class="row-name">{o.firstPrompt.slice(0, 60)}</span><span class="sub"
                >{app.projects.find((p) => p.id === o.projectId)?.name} · {age(o.lastAt)}</span
              ></span
            >
            <span class="sub">{o.host}{o.running ? ' · running' : ''} · {o.running ? 'Fork' : 'Resume'}</span>
          </button>
        {/each}
      </section>
    {/if}
    {#if dormant.length}
      <section class="section" aria-labelledby="h-worktrees">
        <h2 id="h-worktrees">Worktrees · {dormant.length}</h2>
        {#each dormant as w (w.path)}
          <button
            type="button"
            class="card row child"
            class:merged={w.state === 'merged'}
            disabled={!childStart(w)}
            onclick={() => openChild(w)}
          >
            <Icon name="folder" size="sm" />
            <span class="grow">{app.projects.find((p) => p.id === w.projectId)?.name ?? ''} · {w.name}</span>
            {#if w.conversation && !w.busy}<Icon name="message" size="sm" label="Has a conversation to resume" />{/if}
            <span class="sub">{childLabel(w)}</span>
          </button>
        {/each}
      </section>
    {/if}
    {#if !SECTIONS.some((sec) => visible.some((s) => s.status === sec.status))}
      <p class="empty">Nothing running. Start a session below.</p>
    {/if}

    <div class="footer"><Button variant="primary" block onclick={() => (picking = true)}>New session</Button></div>
  </div>
{/if}

<Dialog
  open={picking}
  title="New session in"
  onclose={() => {
    picking = false;
    pickQuery = '';
  }}
>
  <div class="pick">
    {#if app.projects.length > 5}
      <TextField label="Find a project" hideLabel placeholder="Find a project…" bind:value={pickQuery} />
    {/if}
    {#if !pickQuery.trim()}<Button block onclick={() => newIn(null)}>Global Claude</Button>{/if}
    {#each pickable as p (p.id)}
      <Button block onclick={() => newIn(p.id)}>{p.name}</Button>
    {/each}
    {#if pickQuery.trim() && !pickable.length}<p class="empty">No project matches.</p>{/if}
  </div>
</Dialog>

<style>
  .panes {
    display: flex;
    gap: var(--space-2);
    padding: var(--space-1-5) var(--space-3);
    overflow-x: auto;
  }

  .panes a {
    flex: none;
    display: inline-flex;
    align-items: center;
    min-height: var(--size-control-md);
    padding: 0 var(--space-3);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    color: var(--muted);
    text-decoration: none;
  }

  .panes a[aria-current='page'] {
    color: var(--fg);
    border-color: var(--primary);
  }

  .panes a.needs {
    color: var(--status-needs-you-fg);
    border-color: var(--status-needs-you);
  }

  .overview,
  .term-page {
    min-height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--bg);
  }

  .term-page {
    height: 100%;
    height: 100dvh;
  }

  .overview {
    gap: var(--space-5);
    padding: 0 max(var(--space-4), env(safe-area-inset-right)) 0 max(var(--space-4), env(safe-area-inset-left));
  }

  .bar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: calc(var(--space-3) + env(safe-area-inset-top)) var(--space-1) var(--space-3);
  }

  .term-page .bar {
    padding: calc(var(--space-2) + env(safe-area-inset-top)) var(--space-3) var(--space-2);
    border-bottom: var(--hairline) solid var(--line);
  }

  .unreachable {
    padding: var(--space-2) var(--space-1);
    color: var(--muted);
  }

  .grow {
    flex: 1 1 auto;
    min-width: 0;
  }

  .name {
    margin: 0;
    overflow: hidden;
    font-size: var(--text-base);
    font-weight: var(--weight-semibold);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sub {
    font-size: var(--text-sm);
    color: var(--fg-2);
  }

  .age {
    flex: none;
    white-space: nowrap;
  }

  .stack {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .stack > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .offer {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-3-5);
    border: var(--hairline) solid var(--line-strong);
    border-radius: var(--radius-lg);
    background: var(--panel);
  }

  .offer p {
    margin: 0;
  }

  .needs {
    color: var(--status-needs-you);
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  h2 {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--muted);
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: var(--space-2-5);
    padding: var(--space-3) var(--space-3-5);
    border: var(--hairline) solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--panel);
    color: var(--fg);
    text-decoration: none;
  }

  .card.row {
    flex-direction: row;
    align-items: center;
    min-height: var(--size-touch);
  }

  .row-name {
    font-weight: var(--weight-medium);
  }

  .child {
    font: inherit;
    text-align: left;
  }

  .child.merged {
    opacity: 0.55;
  }

  .needs-card {
    border-color: var(--status-needs-you);
    background: var(--status-needs-you-bg);
  }

  .needs-card .sub {
    color: var(--status-needs-you-fg);
  }

  .card-head {
    display: flex;
    align-items: center;
    gap: var(--space-2-5);
  }

  .strong {
    font-weight: var(--weight-medium);
  }

  .ask {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--text-md);
    color: var(--status-needs-you-fg);
  }

  .card-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .open {
    display: inline-flex;
    align-items: center;
    min-height: var(--size-touch);
    margin-left: auto;
    padding: 0 var(--space-3);
    border: var(--hairline) solid var(--status-needs-you);
    border-radius: var(--radius-md);
    color: var(--status-needs-you-fg);
    font-weight: var(--weight-medium);
    text-decoration: none;
  }

  .empty {
    margin: 0;
    color: var(--muted);
  }

  /* Always in thumb reach, however long the list gets. */
  .footer {
    position: sticky;
    bottom: 0;
    margin: auto calc(-1 * var(--space-4)) 0;
    padding: var(--space-3) var(--space-4) calc(var(--space-3) + env(safe-area-inset-bottom));
    background: linear-gradient(transparent, var(--bg) var(--space-3));
  }

  .pick {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .services {
    max-height: 45vh;
    overflow: auto;
    border-bottom: var(--hairline) solid var(--line);
    background: var(--panel);
  }

  .permission {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3) var(--space-3);
    border-top: var(--ring) solid var(--status-needs-you);
    background: var(--status-needs-you-bg);
  }

  /* One line until tapped: the terminal above already shows the whole command. */
  .ask-line {
    display: flex;
    gap: var(--space-2);
    min-height: var(--size-control-md);
    padding: 0;
    border: 0;
    background: none;
    color: var(--status-needs-you-fg);
    font: inherit;
    font-family: var(--font-mono);
    font-size: var(--text-md);
    text-align: left;
    cursor: pointer;
  }

  .ask-tool {
    flex: none;
    font-weight: var(--weight-semibold);
  }

  .ask-summary {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ask-line.open {
    align-items: flex-start;
  }

  .ask-line.open .ask-summary {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .big {
    display: grid;
    grid-template-columns: 1.4fr 1fr 0.9fr;
    gap: var(--space-2);
  }

  .key {
    height: var(--size-phone-key);
    border: var(--hairline) solid var(--line-strong);
    border-radius: var(--radius-lg);
    background: var(--panel);
    color: var(--fg);
    font-size: var(--text-lg);
    font-weight: var(--weight-semibold);
    cursor: pointer;
  }

  .key.yes {
    border-color: transparent;
    background: var(--primary);
    color: var(--primary-fg);
  }

  .key.no {
    border-color: var(--danger);
    color: var(--danger);
  }

  /* A standing grant: reachable, but never the thumb's easy target next to No. */
  .key.always {
    border-style: dashed;
    background: none;
    font-size: var(--text-md);
    font-weight: var(--weight-regular);
    color: var(--fg-2);
  }

  .quick {
    display: flex;
    gap: var(--space-1-5);
    padding: var(--space-2) var(--space-3);
    overflow-x: auto;
    border-top: var(--hairline) solid var(--line);
    background: var(--panel);
  }

  .qk {
    flex: 1 0 auto;
    min-width: var(--size-touch);
    height: var(--size-touch);
    padding: 0 var(--space-2-5);
    border: var(--hairline) solid var(--line-strong);
    border-radius: var(--radius-md);
    background: var(--raised);
    color: var(--fg);
    font-family: var(--font-mono);
    font-size: var(--text-md);
    cursor: pointer;
  }

  .input {
    display: flex;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3) calc(var(--space-3) + env(safe-area-inset-bottom));
    background: var(--panel);
  }

  .input input {
    flex: 1 1 auto;
    min-width: 0;
    height: var(--size-touch);
    padding: 0 var(--space-3);
    border: var(--hairline) solid var(--line-strong);
    border-radius: var(--radius-md);
    background: var(--bg);
    color: var(--fg);
  }

  .keys-toggle,
  .send {
    flex: none;
    width: var(--size-touch);
    height: var(--size-touch);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: var(--radius-md);
    background: var(--primary);
    color: var(--primary-fg);
    cursor: pointer;
  }

  .keys-toggle {
    border: var(--hairline) solid var(--line-strong);
    background: var(--raised);
    color: var(--fg-2);
  }

  .chat-tools {
    display: flex;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-3);
    background: var(--panel);
  }

  .keys-toggle:disabled {
    opacity: 0.5;
  }
</style>
