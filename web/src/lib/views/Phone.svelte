<script lang="ts">
  // Phone layout (viewport < 700 px), same routes as the desktop: #/ is the overview, #/p/<id>/<session> a terminal.
  import type { ServiceContainer, Session, SessionStatus } from '../../../../shared/api.ts';
  import Button from '../components/Button/Button.svelte';
  import Dialog from '../components/Dialog/Dialog.svelte';
  import Icon from '../components/Icon/Icon.svelte';
  import IconButton from '../components/IconButton/IconButton.svelte';
  import ProjectIcon from '../components/ProjectIcon/ProjectIcon.svelte';
  import ServicesTree from '../components/ServicesTree/ServicesTree.svelte';
  import StatusDot from '../components/StatusDot/StatusDot.svelte';
  import TerminalView from '../components/TerminalView/TerminalView.svelte';
  import Wordmark from '../components/Wordmark/Wordmark.svelte';
  import { STATUS_LABEL } from '../status.ts';
  import { api } from '../stores/api.ts';
  import { href, router } from '../stores/router.svelte.ts';
  import { app, needsYouCount, sendKeys, sessionHref, sessionsOf, startSession, ui } from '../stores/state.svelte.ts';
  import { serviceAction, serviceInspect, serviceLogs } from '../stores/services.ts';

  const route = $derived(router.route);
  const open = $derived<Session | null>(
    route.name === 'global'
      ? (app.sessions.find((s) => s.kind === 'global') ?? null)
      : route.name === 'project'
        ? ((route.sessionId ? app.sessions.find((s) => s.id === route.sessionId) : sessionsOf(route.projectId)[0]) ??
          null)
        : null,
  );
  const projectOf = (s: Session) => app.projects.find((p) => p.id === s.projectId) ?? null;
  const visible = $derived(app.sessions.filter((s) => s.kind !== 'shell'));
  const SECTIONS: { status: SessionStatus; title: string }[] = [
    { status: 'needs-you', title: 'Needs you' },
    { status: 'working', title: 'Working' },
    { status: 'your-turn', title: 'Your turn' },
  ];

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
  const title = (s: Session) => `${projectOf(s)?.name ?? 'Global'} · ${s.name}`;

  async function newIn(projectId: string | null) {
    picking = false;
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
          >{p?.name ?? 'Global Claude'} · {STATUS_LABEL[open.status]}</span
        >
      </div>
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
      <TerminalView sessionId={open.id} accent={p?.accent} label={open.name} compact />
    {/key}

    {#if open.pendingPermission}
      <div class="permission" role="group" aria-label="Answer the permission question">
        <span class="ask">Allow: {open.pendingPermission.tool} · {open.pendingPermission.summary}</span>
        <div class="big">
          <button type="button" class="key yes" onclick={() => sendKeys(open.id, ['1'])}>1 Yes</button>
          <button type="button" class="key" onclick={() => sendKeys(open.id, ['2'])}>2 Always</button>
          <button type="button" class="key no" onclick={() => sendKeys(open.id, ['3'])}>3 No</button>
        </div>
      </div>
    {/if}

    <div class="quick" role="group" aria-label="Quick keys">
      {#each QUICK as q (q.key)}
        <button type="button" class="qk" aria-label={q.aria} onclick={() => sendKeys(open.id, [q.key])}
          >{q.label}</button
        >
      {/each}
    </div>
    <form class="input" onsubmit={send}>
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
  </div>
{:else}
  <div class="overview">
    <header class="bar">
      <span class="grow"><Wordmark needsYou={needsYouCount() > 0} /></span>
      <IconButton label="Search projects" icon="search" size="lg" onclick={() => (ui.search = true)} />
      <IconButton label="Settings" icon="gear" size="lg" href={href('settings')} />
    </header>

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
                  <span class="grow strong">{title(s)}</span>
                  <span class="sub">{age(s.lastActivityAt)}</span>
                </div>
                {#if s.pendingPermission}
                  <p class="ask">Allow: {s.pendingPermission.tool} · {s.pendingPermission.summary}?</p>
                  <div class="card-actions">
                    <Button variant="primary" onclick={() => sendKeys(s.id, ['1'])}>Yes</Button>
                    <Button onclick={() => sendKeys(s.id, ['3'])}>No</Button>
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
                <StatusDot status={s.status} />
                <span class="grow">{title(s)}</span>
                <span class="sub">{sec.status === 'working' ? age(s.lastActivityAt) : STATUS_LABEL[s.status]}</span>
              </a>
            {/if}
          {/each}
        </section>
      {/if}
    {/each}
    {#if !SECTIONS.some((sec) => visible.some((s) => s.status === sec.status))}
      <p class="empty">Nothing running. Start a session below.</p>
    {/if}

    <div class="footer"><Button variant="primary" block onclick={() => (picking = true)}>New session</Button></div>
  </div>
{/if}

<Dialog open={picking} title="New session in" onclose={() => (picking = false)}>
  <div class="pick">
    <Button block onclick={() => newIn(null)}>Global Claude</Button>
    {#each app.projects.filter((p) => p.visibility === 'pinned') as p (p.id)}
      <Button block onclick={() => newIn(p.id)}>{p.name}</Button>
    {/each}
  </div>
</Dialog>

<style>
  .overview,
  .term-page {
    min-height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--bg);
  }

  .term-page {
    height: 100%;
  }

  .overview {
    gap: var(--space-5);
    padding: 0 var(--space-4) var(--space-6);
  }

  .bar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-1);
  }

  .term-page .bar {
    padding: var(--space-2) var(--space-3);
    border-bottom: var(--hairline) solid var(--line);
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
    color: var(--muted);
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
    font-size: var(--text-xs);
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
    min-height: var(--size-control-lg);
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
    margin-left: auto;
    padding: var(--space-2);
  }

  .empty {
    margin: 0;
    color: var(--muted);
  }

  .footer {
    margin-top: auto;
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
    padding: var(--space-3);
    border-top: var(--ring) solid var(--status-needs-you);
    background: var(--status-needs-you-bg);
  }

  .big {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
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
    min-width: var(--size-control-lg);
    height: var(--size-control-lg);
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
    padding: var(--space-2) var(--space-3) var(--space-3);
    background: var(--panel);
  }

  .input input {
    flex: 1 1 auto;
    min-width: 0;
    height: var(--size-control-lg);
    padding: 0 var(--space-3);
    border: var(--hairline) solid var(--line-strong);
    border-radius: var(--radius-md);
    background: var(--bg);
    color: var(--fg);
  }

  .send {
    width: var(--size-control-lg);
    height: var(--size-control-lg);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: var(--radius-md);
    background: var(--primary);
    color: var(--primary-fg);
    cursor: pointer;
  }
</style>
