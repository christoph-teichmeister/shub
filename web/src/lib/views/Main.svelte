<script lang="ts">
  import type {
    Approval,
    ButtonDef,
    ProjectView,
    ServiceContainer,
    Session,
    SessionLink,
    StartSessionRequest,
  } from '../../../../shared/api.ts';
  import AppShell from '../components/AppShell/AppShell.svelte';
  import BottomPanel from '../components/BottomPanel/BottomPanel.svelte';
  import Button from '../components/Button/Button.svelte';
  import Dialog from '../components/Dialog/Dialog.svelte';
  import EmptyState from '../components/EmptyState/EmptyState.svelte';
  import Icon from '../components/Icon/Icon.svelte';
  import IconButton from '../components/IconButton/IconButton.svelte';
  import Kbd from '../components/Kbd/Kbd.svelte';
  import Menu, { type MenuItem } from '../components/Menu/Menu.svelte';
  import ProjectIcon from '../components/ProjectIcon/ProjectIcon.svelte';
  import ProjectRow from '../components/ProjectRow/ProjectRow.svelte';
  import ServicesTree, { type ServiceAction } from '../components/ServicesTree/ServicesTree.svelte';
  import SessionRow from '../components/SessionRow/SessionRow.svelte';
  import SessionTab from '../components/SessionTab/SessionTab.svelte';
  import Sidebar from '../components/Sidebar/Sidebar.svelte';
  import SidebarSection from '../components/SidebarSection/SidebarSection.svelte';
  import SplitView from '../components/SplitView/SplitView.svelte';
  import StatusDot from '../components/StatusDot/StatusDot.svelte';
  import TabBar from '../components/TabBar/TabBar.svelte';
  import TerminalView from '../components/TerminalView/TerminalView.svelte';
  import Wordmark from '../components/Wordmark/Wordmark.svelte';
  import { api } from '../stores/api.ts';
  import { go, href, router } from '../stores/router.svelte.ts';
  import { app, needsYouCount, sessionsOf, shellsOf } from '../stores/state.svelte.ts';
  import { toast, toastError } from '../stores/toasts.svelte.ts';
  import { SHORTCUTS } from './shortcuts.ts';

  // ---------- derived view state ----------
  const route = $derived(router.route);
  const isGlobal = $derived(route.name === 'global');
  const project = $derived<ProjectView | null>(
    route.name === 'project' ? (app.projects.find((p) => p.id === route.projectId) ?? null) : null,
  );
  const tabs = $derived(isGlobal ? sessionsOf(null) : project ? sessionsOf(project.id) : []);
  const active = $derived<Session | null>(
    (route.name === 'project' && tabs.find((s) => s.id === route.sessionId)) || tabs[0] || null,
  );
  const globalSession = $derived(app.sessions.find((s) => s.kind === 'global') ?? null);
  const needsYou = $derived(needsYouCount() > 0);

  const groups = $derived.by(() => {
    const names = [...(app.config?.groups ?? [])];
    for (const p of app.projects) if (!names.includes(p.group)) names.push(p.group);
    return names
      .map((name) => ({
        name,
        projects: app.projects
          .filter((p) => p.group === name && p.visibility === 'pinned')
          .sort((a, b) => a.order - b.order),
      }))
      .filter((g) => g.projects.length);
  });
  const dormantCount = $derived(app.projects.filter((p) => p.visibility === 'dormant').length);
  const pluginSections = $derived(
    app.plugins
      .filter((p) => p.enabled)
      .flatMap((p) => p.sections.filter((s) => s.content).map((s) => ({ plugin: p.name, ...s, content: s.content! }))),
  );

  // ---------- local UI state ----------
  let split = $state(false);
  let panelOpen = $state(false);
  let panelTab = $state('services');
  let renamingId = $state<string | null>(null);
  let menu = $state<{ session: Session; x: number; y: number } | null>(null);
  let confirm = $state<{ title: string; body: string; action: string; danger?: boolean; run: () => void } | null>(null);
  let ask = $state<{ button: ButtonDef; value: string } | null>(null);
  let linkDraft = $state<{ session: Session; label: string; url: string } | null>(null);
  let shortcutsOpen = $state(false);
  let services = $state<ServiceContainer[]>([]);
  let dragId: string | null = null;

  const shells = $derived(active ? shellsOf(active.id) : []);
  const panelTabs = $derived([
    { id: 'services', label: 'Services' },
    ...shells.map((s, i) => ({ id: s.id, label: `Terminal ${i + 1}` })),
  ]);

  $effect(() => {
    const id = active?.kind === 'claude' ? active.id : null;
    void (id && app.servicesVersion[id]);
    if (!id) {
      services = [];
      return;
    }
    api<ServiceContainer[]>('services', { params: { id } }).then(
      (list) => (services = list),
      () => (services = []),
    );
  });

  // ---------- actions ----------
  const sessionHref = (s: Session) => (s.projectId ? href('p', s.projectId, s.id) : href('g'));

  async function start(req: StartSessionRequest): Promise<Session | undefined> {
    const res = await api<Session | { approval: Approval }>('sessionStart', { body: req }).catch(toastError);
    if (!res) return;
    if ('approval' in res) {
      toast(`Waiting for your approval: ${res.approval.summary}`, 'needs-you');
      return;
    }
    if (!app.sessions.some((s) => s.id === res.id)) app.sessions.push(res);
    return res;
  }

  async function newSession(p: ProjectView | null = project, extra: Partial<StartSessionRequest> = {}) {
    const s = await start({ projectId: p?.id ?? null, kind: p ? 'claude' : 'global', ...extra });
    if (s && s.kind !== 'shell') location.hash = sessionHref(s);
  }

  async function newShell() {
    if (!active) return;
    const s = await start({ projectId: active.projectId, kind: 'shell', parentId: active.id });
    if (s) {
      panelOpen = true;
      panelTab = s.id;
    }
  }

  function runButton(button: ButtonDef) {
    if (!project) return;
    if (button.ask !== 'nothing') ask = { button, value: '' };
    else if (button.confirm)
      confirm = {
        title: `Run ${button.label}?`,
        body: button.prompt || button.skill || '',
        action: 'Run',
        run: () => newSession(project, { buttonId: button.id }),
      };
    else void newSession(project, { buttonId: button.id });
  }

  function rename(s: Session, name: string) {
    void api('sessionUpdate', { params: { id: s.id }, body: { name } }).catch(toastError);
    s.name = name;
  }

  function close(s: Session) {
    const run = () => void api('sessionClose', { params: { id: s.id } }).catch(toastError);
    if (s.status === 'working')
      confirm = { title: `Close ${s.name}?`, body: 'It is still working.', action: 'Close', danger: true, run };
    else run();
  }

  function menuItems(s: Session): MenuItem[] {
    const plugin = app.plugins.flatMap((p) =>
      p.enabled ? p.sessionMenuActions.map((a) => ({ id: `plugin:${p.name}:${a.id}`, label: a.label })) : [],
    );
    return [
      { id: 'rename', label: 'Rename' },
      { id: 'link', label: 'Add link…', hint: s.links[0]?.label },
      { id: 'pause', label: s.status === 'paused' ? 'Resume session' : 'Pause session' },
      ...plugin,
      { id: 'close', label: 'Close session', separator: true, danger: true },
    ];
  }

  function onMenu(s: Session, id: string) {
    if (id === 'rename') renamingId = s.id;
    else if (id === 'link') linkDraft = { session: s, label: '', url: '' };
    else if (id === 'pause')
      void api(s.status === 'paused' ? 'sessionResume' : 'sessionPause', { params: { id: s.id } }).catch(toastError);
    else if (id === 'close') close(s);
    else if (id.startsWith('plugin:')) {
      const [, name, actionId] = id.split(':');
      void api('pluginAction', {
        params: { name, actionId },
        body: { sessionId: s.id, projectId: s.projectId ?? undefined },
      }).catch(toastError);
    }
  }

  function saveLink() {
    if (!linkDraft) return;
    const link: SessionLink = { source: 'user', label: linkDraft.label.trim(), url: linkDraft.url.trim() };
    void api('sessionLink', { params: { id: linkDraft.session.id }, body: link }).catch(toastError);
    linkDraft = null;
  }

  async function logs(id: string): Promise<string> {
    const res = await api<unknown>('serviceLogs', { params: { containerId: id } });
    if (typeof res === 'string') return res;
    const r = res as { logs?: string; text?: string };
    return r.logs ?? r.text ?? JSON.stringify(res, null, 2);
  }

  async function serviceAction(action: ServiceAction, c: ServiceContainer) {
    if (action !== 'send-logs') {
      await api('serviceAction', { params: { containerId: c.id, action } }).catch(toastError);
      return;
    }
    if (!active) return;
    const text = await logs(c.id).catch(toastError);
    if (text === undefined) return;
    const tail = text.split('\n').slice(-200).join('\n');
    await api('sessionPaste', { params: { id: active.id }, body: `Logs of ${c.name}:\n${tail}\n` })
      .then(() => toast(`Logs of ${c.name} sent to ${active!.name}`))
      .catch(toastError);
  }

  function pluginEntry(plugin: string, action: string | undefined, entryId: string) {
    if (action)
      void api('pluginAction', { params: { name: plugin, actionId: action }, body: { entryId } }).catch(toastError);
  }

  // ---------- drag and drop order ----------
  function dropProject(group: string, beforeId: string | null) {
    const moving = app.projects.find((p) => p.id === dragId);
    dragId = null;
    if (!moving || moving.id === beforeId) return;
    const list = app.projects
      .filter((p) => p.group === group && p.visibility === 'pinned' && p.id !== moving.id)
      .sort((a, b) => a.order - b.order);
    const at = beforeId ? list.findIndex((p) => p.id === beforeId) : -1;
    list.splice(at < 0 ? list.length : at, 0, moving);
    moving.group = group;
    list.forEach((p, i) => (p.order = i));
    void api('projectsReorder', {
      body: { projects: list.map((p) => ({ id: p.id, group: p.group, order: p.order })) },
    }).catch(toastError);
  }

  // ---------- shortcuts: Alt only, never Ctrl ----------
  let lastProjectHash = '#/';
  $effect(() => {
    if (!isGlobal) lastProjectHash = location.hash || '#/';
  });

  function nextNeedsYou() {
    const list = app.sessions.filter((s) => s.status === 'needs-you');
    if (!list.length) return toast('Nothing needs you');
    const i = list.findIndex((s) => s.id === active?.id);
    location.hash = sessionHref(list[(i + 1) % list.length]);
  }

  function selectTab(i: number) {
    const s = tabs[(i + tabs.length) % tabs.length];
    if (s) location.hash = sessionHref(s);
  }

  function onKeydown(e: KeyboardEvent) {
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    const index = tabs.findIndex((s) => s.id === active?.id);
    const digit = /^Digit([1-9])$/.exec(e.code);
    if (digit) selectTab(Number(digit[1]) - 1);
    else if (e.key === '?' || e.code === 'Slash') shortcutsOpen = !shortcutsOpen;
    else
      switch (e.code) {
        case 'KeyG':
          location.hash = isGlobal ? lastProjectHash : href('g');
          break;
        case 'KeyJ':
          nextNeedsYou();
          break;
        case 'KeyK':
          toast('Search is not built yet');
          break;
        case 'KeyN':
          void newSession();
          break;
        case 'BracketLeft':
          selectTab(index - 1);
          break;
        case 'BracketRight':
          selectTab(index + 1);
          break;
        case 'KeyS':
          split = !split;
          break;
        case 'KeyD':
          panelOpen = !panelOpen;
          break;
        case 'KeyT':
          void newShell();
          break;
        case 'KeyR':
          if (active) renamingId = active.id;
          break;
        case 'KeyW':
          if (active) close(active);
          break;
        default:
          return;
      }
    e.preventDefault();
    e.stopPropagation();
  }
</script>

<svelte:window onkeydowncapture={onKeydown} />

<AppShell>
  {#snippet sidebar()}
    <Sidebar>
      {#snippet header()}
        <div class="brand">
          <Wordmark accent={project?.accent} {needsYou} />
          <IconButton label="New project" icon="plus" size="md" variant="outline" href={href('settings', 'new')} />
        </div>
        <button type="button" class="search" onclick={() => toast('Search is not built yet')}>
          <Icon name="search" />
          <span class="grow">Search projects</span>
          <Kbd keys="Alt K" />
        </button>
        <a class="global" href={href('g')} aria-current={isGlobal ? 'page' : undefined}>
          <span class="global-icon" aria-hidden="true"><Icon name="sparkle" size="sm" weight={2} /></span>
          <span class="grow">Global Claude</span>
          {#if globalSession}<StatusDot status={globalSession.status} />{/if}
          <Kbd keys="Alt G" />
        </a>
      {/snippet}

      {#each pluginSections as section (section.plugin + section.id)}
        <SidebarSection
          title={section.title}
          badge={section.content.badge}
          entries={section.content.entries}
          onentry={(entry) => pluginEntry(section.plugin, entry.action, entry.id)}
        />
      {/each}

      {#each groups as group (group.name)}
        <SidebarSection title={group.name} ondrop={() => dropProject(group.name, null)}>
          {#each group.projects as p (p.id)}
            {@const list = sessionsOf(p.id)}
            <ProjectRow
              project={p}
              sessions={list}
              href={href('p', p.id)}
              settingsHref={href('settings', 'p', p.id)}
              selected={p.id === project?.id}
              onnewsession={() => newSession(p)}
              ondragstart={(e) => {
                dragId = p.id;
                e.dataTransfer?.setData('text/plain', p.name);
              }}
              ondrop={() => dropProject(group.name, p.id)}
            >
              {#each list as s (s.id)}
                <SessionRow session={s} href={sessionHref(s)} selected={s.id === active?.id} />
              {/each}
            </ProjectRow>
          {/each}
        </SidebarSection>
      {/each}

      {#if app.ready && groups.length === 0}
        <p class="hint">No projects yet. Add one with the + button.</p>
      {/if}

      {#snippet footer()}
        <div class="hints">
          {#if dormantCount}<span>{dormantCount} dormant projects · find them with Alt K</span>{/if}
          <span><Kbd keys="Alt J" /> next that needs you · <Kbd keys="Alt ?" /> shortcuts</span>
        </div>
        <a class="user" href={href('settings')}>
          <span class="avatar" aria-hidden="true">{(app.me?.name ?? 'You').slice(0, 1).toUpperCase()}</span>
          <span class="grow user-text">
            <span class="user-name">{app.me?.name ?? 'You'}</span>
            <span class="user-sub">{app.connected ? 'Connected' : 'Offline, reconnecting'}</span>
          </span>
          <Icon name="gear" />
          <span class="visually-hidden">Settings</span>
        </a>
      {/snippet}
    </Sidebar>
  {/snippet}

  {#if !project && !isGlobal}
    <EmptyState
      title={route.name === 'project' && app.ready ? 'Project not found' : 'Pick a project'}
      body="Or open the global Claude with Alt G."
    />
  {:else}
    <header class="head">
      {#if project}
        <ProjectIcon icon={project.resolvedIcon} name={project.name} size="lg" />
      {:else}
        <span class="global-icon lg" aria-hidden="true"><Icon name="sparkle" weight={2} /></span>
      {/if}
      <div class="title">
        <h1>{project?.name ?? 'Global Claude'}</h1>
        <span class="path"
          >{split ? `${tabs.length} sessions side by side` : project ? project.path : 'Talks to every project'}{project
            ?.resolvedIcon.host && !split
            ? ` · ${project.resolvedIcon.host}`
            : ''}</span
        >
      </div>
      <div class="actions">
        <Button variant="primary" onclick={() => newSession()}>New session</Button>
        {#each project?.buttons ?? [] as b (b.id)}
          <Button variant={b.skill || b.prompt ? 'secondary' : 'dashed'} onclick={() => runButton(b)}
            >{b.label}{b.ask !== 'nothing' ? '…' : ''}</Button
          >
        {/each}
        <Button icon="split" pressed={split} onclick={() => (split = !split)}
          >{split ? 'Split view on' : 'Split view'}</Button
        >
        {#if project}
          <Button icon="services" pressed={panelOpen} onclick={() => (panelOpen = !panelOpen)}
            >Services{services.length ? ` · ${services.length}` : ''}</Button
          >
          <IconButton
            label="Project settings"
            icon="gear"
            size="lg"
            variant="outline"
            href={href('settings', 'p', project.id)}
          />
        {/if}
      </div>
    </header>

    {#if !split}
      <TabBar label="Sessions">
        {#each tabs as s (s.id)}
          <SessionTab
            session={s}
            selected={s.id === active?.id}
            bind:renaming={() => renamingId === s.id, (v) => (renamingId = v ? s.id : null)}
            onselect={() => (location.hash = sessionHref(s))}
            onrename={(name) => rename(s, name)}
            onclose={() => close(s)}
            onmenu={(e) => (menu = { session: s, x: e.clientX, y: e.clientY })}
          />
        {/each}
        {#snippet trailing()}
          <IconButton label="New session (Alt N)" icon="plus" size="md" tone="muted" onclick={() => newSession()} />
          {#if active}
            <IconButton
              label="Session menu"
              icon="more"
              size="md"
              tone="muted"
              onclick={(e) => {
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                menu = { session: active!, x: r.left, y: r.bottom };
              }}
            />
          {/if}
          <span class="tab-hint">Double-click a tab to rename</span>
        {/snippet}
      </TabBar>
    {/if}

    {#if split && tabs.length}
      <SplitView sessions={tabs} selectedId={active?.id} onselect={(id) => go('p', project?.id, id)}>
        {#snippet pane(s)}
          <TerminalView sessionId={s.id} accent={project?.accent} label={s.name} compact />
        {/snippet}
      </SplitView>
    {:else if active}
      {#key active.id}
        <TerminalView sessionId={active.id} accent={project?.accent} label={active.name} focused />
      {/key}
    {:else}
      <EmptyState title="No session yet" body="Start one here or with Alt N.">
        <Button variant="primary" onclick={() => newSession()}>New session</Button>
      </EmptyState>
    {/if}

    {#if panelOpen && active}
      <BottomPanel
        tabs={panelTabs}
        active={panelTabs.some((t) => t.id === panelTab) ? panelTab : 'services'}
        onselect={(id) => (panelTab = id)}
        onnew={newShell}
        onhide={() => (panelOpen = false)}
        context={services[0]?.project}
      >
        {#if panelTab !== 'services' && shells.some((s) => s.id === panelTab)}
          {#key panelTab}
            <TerminalView sessionId={panelTab} accent={project?.accent} label="Plain terminal" compact focused />
          {/key}
        {:else}
          <ServicesTree
            containers={services}
            onaction={serviceAction}
            loadLogs={logs}
            loadInspect={(id) => api('serviceInspect', { params: { containerId: id } })}
          />
        {/if}
      </BottomPanel>
    {/if}
  {/if}
</AppShell>

{#if menu}
  {@const s = menu.session}
  <Menu
    label="Session menu"
    items={menuItems(s)}
    x={menu.x}
    y={menu.y}
    onselect={(id) => onMenu(s, id)}
    onclose={() => (menu = null)}
  />
{/if}

<Dialog open={!!confirm} title={confirm?.title ?? ''} description={confirm?.body} onclose={() => (confirm = null)}>
  {#snippet actions()}
    <Button variant="ghost" onclick={() => (confirm = null)}>Cancel</Button>
    <Button
      variant={confirm?.danger ? 'danger' : 'primary'}
      onclick={() => {
        confirm?.run();
        confirm = null;
      }}>{confirm?.action}</Button
    >
  {/snippet}
</Dialog>

<Dialog
  open={!!ask}
  title={ask?.button.label ?? ''}
  description={ask?.button.prompt ?? ask?.button.skill}
  onclose={() => (ask = null)}
>
  {#if ask}
    <form
      id="ask-form"
      class="form"
      onsubmit={(e) => {
        e.preventDefault();
        const a = ask!;
        ask = null;
        void newSession(project, { buttonId: a.button.id, input: a.value });
      }}
    >
      <label class="field">
        <span>{ask.button.ask === 'pick-worktree' ? 'Worktree' : ask.button.ask === 'number' ? 'Number' : 'Input'}</span
        >
        <input
          type={ask.button.ask === 'number' ? 'number' : 'text'}
          bind:value={ask.value}
          required
          autocomplete="off"
        />
      </label>
    </form>
  {/if}
  {#snippet actions()}
    <Button variant="ghost" onclick={() => (ask = null)}>Cancel</Button>
    <Button variant="primary" type="submit" form="ask-form">Start</Button>
  {/snippet}
</Dialog>

<Dialog open={!!linkDraft} title="Add link" onclose={() => (linkDraft = null)}>
  {#if linkDraft}
    <form
      id="link-form"
      class="form"
      onsubmit={(e) => {
        e.preventDefault();
        saveLink();
      }}
    >
      <label class="field"><span>Label</span><input bind:value={linkDraft.label} required /></label>
      <label class="field"><span>URL</span><input type="url" bind:value={linkDraft.url} required /></label>
    </form>
  {/if}
  {#snippet actions()}
    <Button variant="ghost" onclick={() => (linkDraft = null)}>Cancel</Button>
    <Button variant="primary" type="submit" form="link-form">Add</Button>
  {/snippet}
</Dialog>

<Dialog
  open={shortcutsOpen}
  title="Shortcuts"
  description="All on Alt, so they never clash with Claude Code or the shell (Ctrl K, Ctrl J, Ctrl C stay theirs)."
  onclose={() => (shortcutsOpen = false)}
>
  <dl class="shortcuts">
    {#each SHORTCUTS as [what, keys] (what)}
      <dt>{what}</dt>
      <dd>
        {#each keys as k (k)}<Kbd keys={k} />{/each}
      </dd>
    {/each}
  </dl>
</Dialog>

<style>
  .brand {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 var(--space-1-5);
  }

  .search,
  .global {
    display: flex;
    align-items: center;
    gap: var(--space-2-5);
    height: var(--size-control-lg);
    padding: 0 var(--space-3);
    border: var(--hairline) solid var(--line);
    border-radius: var(--radius-md);
    background: var(--bg);
    color: var(--muted);
    text-align: left;
    text-decoration: none;
    cursor: pointer;
  }

  .global {
    background: transparent;
    color: var(--fg);
    font-weight: var(--weight-medium);
  }

  .global[aria-current='page'] {
    background: var(--raised);
  }

  .global-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--size-tile);
    height: var(--size-tile);
    border-radius: var(--radius-round);
    background: var(--yellow);
    color: var(--on-accent);
  }

  .global-icon.lg {
    width: var(--size-tile-lg);
    height: var(--size-tile-lg);
  }

  .grow {
    flex: 1 1 auto;
    min-width: 0;
  }

  .hint {
    margin: 0;
    padding: 0 var(--space-1-5);
    color: var(--muted);
  }

  .hints {
    display: flex;
    flex-direction: column;
    gap: var(--space-1-5);
    padding: var(--space-2-5) var(--space-1-5) 0;
    border-top: var(--hairline) solid var(--line);
    font-size: var(--text-sm);
    color: var(--muted);
  }

  .user {
    display: flex;
    align-items: center;
    gap: var(--space-2-5);
    padding: var(--space-2);
    border-radius: var(--radius-md);
    background: var(--bg);
    color: var(--muted);
    text-decoration: none;
  }

  .avatar {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--size-avatar);
    height: var(--size-avatar);
    border-radius: var(--radius-round);
    background: var(--purple);
    color: var(--on-accent);
    font-weight: var(--weight-semibold);
  }

  .user-text {
    display: flex;
    flex-direction: column;
  }

  .user-name {
    color: var(--fg);
    font-weight: var(--weight-medium);
  }

  .user-sub {
    font-size: var(--text-xs);
  }

  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3-5) var(--space-5);
    border-bottom: var(--hairline) solid var(--line);
  }

  .title {
    flex: 1 1 0;
    min-width: var(--size-rename);
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
  }

  h1 {
    margin: 0;
    font-size: var(--text-xl);
    font-weight: var(--weight-semibold);
    line-height: var(--leading-tight);
  }

  .path {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .tab-hint {
    margin-left: auto;
    align-self: center;
    padding-right: var(--space-2);
    font-size: var(--text-sm);
    color: var(--muted);
    white-space: nowrap;
  }

  .form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-size: var(--text-sm);
    color: var(--fg-2);
  }

  .field input {
    height: var(--size-control-md);
    padding: 0 var(--space-2-5);
    border: var(--hairline) solid var(--line-strong);
    border-radius: var(--radius-md);
    background: var(--bg);
    color: var(--fg);
    font-size: var(--text-base);
  }

  .shortcuts {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--space-3) var(--space-6);
    align-items: center;
    margin: 0;
  }

  .shortcuts dd {
    display: flex;
    gap: var(--space-1);
    margin: 0;
  }
</style>
