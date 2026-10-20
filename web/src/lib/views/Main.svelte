<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import type {
    ButtonDef,
    ProjectView,
    ServiceContainer,
    Session,
    SessionLink,
    StartSessionRequest,
    Worktree,
  } from '../../../../shared/api.ts';
  import AppShell from '../components/AppShell/AppShell.svelte';
  import BottomPanel from '../components/BottomPanel/BottomPanel.svelte';
  import Button from '../components/Button/Button.svelte';
  import Checkbox from '../components/Checkbox/Checkbox.svelte';
  import Dialog from '../components/Dialog/Dialog.svelte';
  import Drawer from '../components/Drawer/Drawer.svelte';
  import EmptyState from '../components/EmptyState/EmptyState.svelte';
  import Icon from '../components/Icon/Icon.svelte';
  import IconButton from '../components/IconButton/IconButton.svelte';
  import Kbd from '../components/Kbd/Kbd.svelte';
  import Menu, { type MenuItem } from '../components/Menu/Menu.svelte';
  import ProjectIcon from '../components/ProjectIcon/ProjectIcon.svelte';
  import ProjectRow from '../components/ProjectRow/ProjectRow.svelte';
  import ServicesTree from '../components/ServicesTree/ServicesTree.svelte';
  import SessionRow from '../components/SessionRow/SessionRow.svelte';
  import SessionTab from '../components/SessionTab/SessionTab.svelte';
  import Sidebar from '../components/Sidebar/Sidebar.svelte';
  import SidebarSection from '../components/SidebarSection/SidebarSection.svelte';
  import SplitView from '../components/SplitView/SplitView.svelte';
  import StatusBadge from '../components/StatusBadge/StatusBadge.svelte';
  import StatusDot from '../components/StatusDot/StatusDot.svelte';
  import { projectBadge } from '../status.ts';
  import TabBar from '../components/TabBar/TabBar.svelte';
  import TerminalView from '../components/TerminalView/TerminalView.svelte';
  import TextField from '../components/TextField/TextField.svelte';
  import Wordmark from '../components/Wordmark/Wordmark.svelte';
  import { api, ApiError } from '../stores/api.ts';
  import { go, href, parseHash, router } from '../stores/router.svelte.ts';
  import {
    app,
    closeSession,
    loadProjects,
    needsYouCount,
    sessionHref,
    sessionsOf,
    shellsOf,
    startSession,
    ui,
  } from '../stores/state.svelte.ts';
  import { serviceAction, serviceInspect, serviceLogs } from '../stores/services.ts';
  import { toast, toastError } from '../stores/toasts.svelte.ts';

  // Settings pages render here instead of the project, so the sidebar stays.
  let { children }: { children?: Snippet } = $props();

  // ---------- derived view state ----------
  const route = $derived(router.route);
  const project = $derived<ProjectView | null>(
    route.name === 'project' ? (app.projects.find((p) => p.id === route.projectId) ?? null) : null,
  );
  const tabs = $derived(project ? sessionsOf(project.id) : []);
  const active = $derived<Session | null>(
    (route.name === 'project' && tabs.find((s) => s.id === route.sessionId)) || tabs[0] || null,
  );
  const globalSession = $derived(app.sessions.find((s) => s.kind === 'global') ?? null);
  const needsYou = $derived(needsYouCount() > 0);
  const pendingApprovals = $derived(app.approvals.filter((a) => a.state === 'pending').length);

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
  /** What a folded group still shows: who needs you, else what is working. */
  function groupBadge(projects: ProjectView[]) {
    const list = projects.flatMap((p) => sessionsOf(p.id));
    const waiting = list.filter((s) => s.status === 'needs-you').length;
    if (waiting) return { text: `${waiting} needs you`, tone: 'needs-you' as const };
    const working = list.filter((s) => s.status === 'working').length;
    return working ? { text: `${working} working`, tone: 'working' as const } : null;
  }
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
  let projectMenu = $state<{ project: ProjectView; x: number; y: number } | null>(null);
  let confirm = $state<{ title: string; body: string; action: string; danger?: boolean; run: () => void } | null>(null);
  let ask = $state<{ button: ButtonDef; value: string; worktrees: Worktree[] | null } | null>(null);
  let linkDraft = $state<{ session: Session; label: string; url: string } | null>(null);
  let restorable = $state<{ session: Session; on: boolean }[]>([]);
  let services = $state<ServiceContainer[]>([]);
  let dragId: string | null = null;

  const shells = $derived(active ? shellsOf(active.id) : []);
  const panelTabs = $derived([
    { id: 'services', label: 'Services' },
    ...shells.map((s, i) => ({ id: s.id, label: `Terminal ${i + 1}`, closable: true })),
  ]);

  // When the shown terminal goes away (closed or exited), show another terminal or hide the panel, never Services.
  let seen: { active?: string; ids: string[] } = { ids: [] };
  $effect(() => {
    const ids = shells.map((s) => s.id);
    if (active?.id === seen.active && seen.ids.includes(panelTab) && !ids.includes(panelTab)) {
      if (ids.length) panelTab = ids.at(-1)!;
      else {
        panelOpen = false;
        panelTab = 'services';
      }
    }
    seen = { active: active?.id, ids };
  });

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

  onMount(() => {
    api<Session[]>('restorable').then(
      (list) => (restorable = list.filter((s) => s.kind !== 'shell').map((session) => ({ session, on: true }))),
      () => {},
    );
  });

  // The old #/g page is now the drawer: open it and stay on the last project.
  let lastProjectHash = '#/';
  $effect(() => {
    if (route.name === 'global') {
      ui.drawer = true;
      history.replaceState(null, '', lastProjectHash);
      router.route = parseHash(lastProjectHash);
    } else lastProjectHash = location.hash || '#/';
  });

  // ---------- actions ----------
  async function newSession(p: ProjectView | null = project, extra: Partial<StartSessionRequest> = {}) {
    const s = await startSession({ projectId: p?.id ?? null, kind: p ? 'claude' : 'global', ...extra });
    if (s?.kind === 'global') ui.drawer = true;
    else if (s && s.kind !== 'shell') location.hash = sessionHref(s);
  }

  async function newChat() {
    if (globalSession) await closeSession(globalSession.id);
    await newSession(null);
  }

  async function newShell() {
    if (!active) return;
    const s = await startSession({ projectId: active.projectId, kind: 'shell', parentId: active.id });
    if (s) {
      panelOpen = true;
      panelTab = s.id;
    }
  }

  /** The prompt a button will run, as shown before starting it. */
  const preview = (b: ButtonDef, input = '') =>
    b.skill ? `${b.skill}${input ? ` ${input}` : ''}` : (b.prompt ?? '').replaceAll('{input}', input);

  function confirmButton(b: ButtonDef, input?: string) {
    confirm = {
      title: `Run ${b.label}?`,
      body: `Starts claude with "${preview(b, input)}" in ${project?.path ?? 'this project'}.`,
      action: 'Run',
      run: () => newSession(project, { buttonId: b.id, input }),
    };
  }

  async function runButton(button: ButtonDef) {
    if (!project) return;
    if (button.ask === 'nothing') {
      if (button.confirm) confirmButton(button);
      else void newSession(project, { buttonId: button.id });
      return;
    }
    ask = { button, value: '', worktrees: null };
    if (button.ask !== 'pick-worktree') return;
    // GET /api/projects/:id/worktrees -> [{path, branch}]; a 404 (older server) falls back to a text field.
    const list = await api<Worktree[]>('projectWorktrees', { params: { id: project.id } }).catch((err: unknown) => {
      if (!(err instanceof ApiError && err.status === 404)) toastError(err);
      return null;
    });
    if (ask?.button.id === button.id) ask.worktrees = list;
  }

  function submitAsk(e: SubmitEvent) {
    e.preventDefault();
    if (!ask) return;
    const { button, value } = ask;
    ask = null;
    if (button.confirm) confirmButton(button, value);
    else void newSession(project, { buttonId: button.id, input: value });
  }

  function rename(s: Session, name: string) {
    void api('sessionUpdate', { params: { id: s.id }, body: { name } }).catch(toastError);
    s.name = name;
  }

  function close(s: Session) {
    const run = () => void closeSession(s.id);
    if (s.status === 'working')
      confirm = { title: `Close ${s.name}?`, body: 'It is still working.', action: 'Close', danger: true, run };
    else run();
  }

  function menuItems(s: Session): MenuItem[] {
    const plugin = app.plugins.flatMap((p) =>
      p.enabled ? p.sessionMenuActions.map((a) => ({ id: `plugin:${p.name}:${a.id}`, label: a.label })) : [],
    );
    const own = app.projects.find((p) => p.id === s.projectId);
    const buttons = (own?.buttons ?? [])
      .filter((b) => b.confirm)
      .map((b, i) => ({
        id: `button:${b.id}`,
        label: `${b.label}${b.ask !== 'nothing' ? '…' : ''}`,
        separator: i === 0,
      }));
    return [
      { id: 'rename', label: 'Rename' },
      { id: 'link', label: 'Add link…', hint: s.links[0]?.label },
      { id: 'pause', label: s.status === 'paused' ? 'Resume session' : 'Pause session' },
      ...plugin,
      ...buttons,
      { id: 'close', label: 'Close session', separator: true, danger: true },
    ];
  }

  function onMenu(s: Session, id: string) {
    if (id === 'rename') renamingId = s.id;
    else if (id === 'link') linkDraft = { session: s, label: '', url: '' };
    else if (id === 'pause')
      void api(s.status === 'paused' ? 'sessionResume' : 'sessionPause', { params: { id: s.id } }).catch(toastError);
    else if (id === 'close') close(s);
    else if (id.startsWith('button:')) {
      const b = project?.buttons.find((x) => x.id === id.slice(7));
      if (b) void runButton(b);
    } else if (id.startsWith('plugin:')) {
      const [, name, actionId] = id.split(':');
      void api('pluginAction', {
        params: { name, actionId },
        body: { sessionId: s.id, projectId: s.projectId ?? undefined },
      }).catch(toastError);
    }
  }

  function projectMenuItems(p: ProjectView): MenuItem[] {
    return [
      { id: 'new', label: 'New session' },
      { id: 'settings', label: 'Project settings' },
      { id: 'visibility', label: p.visibility === 'pinned' ? 'Make dormant (search only)' : 'Pin to sidebar' },
      {
        id: 'remove',
        label: 'Remove from hub',
        separator: true,
        danger: true,
        description: 'The folder and its sessions stay.',
      },
    ];
  }

  async function onProjectMenu(p: ProjectView, id: string) {
    if (id === 'new') void newSession(p);
    else if (id === 'settings') go('settings', 'project', p.id);
    else if (id === 'visibility') {
      const visibility = p.visibility === 'pinned' ? 'dormant' : 'pinned';
      await api('projectUpdate', { params: { id: p.id }, body: { visibility } }).catch(toastError);
      void loadProjects();
      toast(visibility === 'dormant' ? `${p.name} is dormant; find it with Alt K` : `${p.name} is pinned`);
    } else if (id === 'remove')
      confirm = {
        title: `Remove ${p.name} from the hub?`,
        body: `Only the entry goes. The folder ${p.path} and its Claude history stay on disk.`,
        action: 'Remove',
        danger: true,
        run: async () => {
          await api('projectDelete', { params: { id: p.id } }).catch(toastError);
          await loadProjects();
          if (project?.id === p.id) go();
        },
      };
  }

  function saveLink() {
    if (!linkDraft) return;
    const link: SessionLink = { source: 'user', label: linkDraft.label.trim(), url: linkDraft.url.trim() };
    void api('sessionLink', { params: { id: linkDraft.session.id }, body: link }).catch(toastError);
    linkDraft = null;
  }

  async function restore(ids: string[]) {
    restorable = [];
    const list = await api<Session[]>('restore', { body: { ids } }).catch(toastError);
    if (list) toast(`Resumed ${list.length} ${list.length === 1 ? 'session' : 'sessions'}`);
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
    const moved = moving.group !== group;
    moving.group = group;
    list.forEach((p, i) => (p.order = i));
    const ids = [...list, ...app.projects.filter((p) => !list.includes(p)).sort((a, b) => a.order - b.order)].map(
      (p) => p.id,
    );
    void (async () => {
      if (moved) await api('projectUpdate', { params: { id: moving.id }, body: { group } }).catch(toastError);
      await api('projectsReorder', { body: { ids } }).catch(toastError);
      void loadProjects();
    })();
  }

  // ---------- shortcuts: Alt only, never Ctrl ----------
  function nextNeedsYou() {
    const list = app.sessions.filter((s) => s.status === 'needs-you');
    if (!list.length) return toast('Nothing needs you');
    const i = list.findIndex((s) => s.id === active?.id);
    const next = list[(i + 1) % list.length];
    if (next.kind === 'global') ui.drawer = true;
    else location.hash = sessionHref(next);
  }

  function selectTab(i: number) {
    const s = tabs[(i + tabs.length) % tabs.length];
    if (s) location.hash = sessionHref(s);
  }

  // Remembered per browser; storage can be missing or throw (private window).
  let sidebarCollapsed = $state(false);
  try {
    sidebarCollapsed = localStorage.getItem('shub.sidebar.collapsed') === '1';
  } catch {
    // starts open
  }
  function toggleSidebar() {
    sidebarCollapsed = !sidebarCollapsed;
    try {
      if (sidebarCollapsed) localStorage.setItem('shub.sidebar.collapsed', '1');
      else localStorage.removeItem('shub.sidebar.collapsed');
    } catch {
      // not remembered, still toggles
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    const index = tabs.findIndex((s) => s.id === active?.id);
    const digit = /^Digit([1-9])$/.exec(e.code);
    if (digit) selectTab(Number(digit[1]) - 1);
    else if (e.key === '?' || e.code === 'Slash') ui.shortcuts = !ui.shortcuts;
    else
      switch (e.code) {
        case 'KeyB':
          toggleSidebar();
          break;
        case 'KeyG':
          ui.drawer = !ui.drawer;
          break;
        case 'KeyJ':
          nextNeedsYou();
          break;
        case 'KeyK':
          ui.search = !ui.search;
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
    <Sidebar collapsed={sidebarCollapsed} ontoggle={toggleSidebar}>
      {#snippet header()}
        <div class="brand">
          <Wordmark accent={project?.accent} {needsYou} />
          <IconButton
            label="New project"
            icon="plus"
            size="md"
            variant="outline"
            href={href('settings', 'project', 'new')}
          />
        </div>
        <button type="button" class="search" onclick={() => (ui.search = true)}>
          <Icon name="search" />
          <span class="grow">Search projects</span>
          <Kbd keys="Alt K" />
        </button>
        <button type="button" class="global" aria-expanded={ui.drawer} onclick={() => (ui.drawer = !ui.drawer)}>
          <span class="global-icon" aria-hidden="true"><Icon name="sparkle" size="sm" weight={2} /></span>
          <span class="grow">Global Claude</span>
          {#if globalSession}<StatusDot status={globalSession.status} />{/if}
          <Kbd keys="Alt G" />
        </button>
        {#if pendingApprovals > 1}
          <span class="approvals"><StatusBadge text="{pendingApprovals} approvals waiting" tone="needs-you" /></span>
        {/if}
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
        <SidebarSection
          title={group.name}
          collapsedBadge={groupBadge(group.projects)}
          ondrop={() => dropProject(group.name, null)}
        >
          {#each group.projects as p (p.id)}
            {@const list = sessionsOf(p.id)}
            <ProjectRow
              project={p}
              sessions={list}
              href={href('p', p.id)}
              settingsHref={href('settings', 'project', p.id)}
              selected={p.id === project?.id}
              onnewsession={() => newSession(p)}
              ondragstart={(e) => {
                dragId = p.id;
                e.dataTransfer?.setData('text/plain', p.name);
              }}
              ondrop={() => dropProject(group.name, p.id)}
              onmenu={(e) => (projectMenu = { project: p, x: e.clientX, y: e.clientY })}
            >
              {#each list as s (s.id)}
                <SessionRow
                  session={s}
                  href={sessionHref(s)}
                  selected={s.id === active?.id}
                  closing={app.closing[s.id]}
                />
              {/each}
            </ProjectRow>
          {/each}
        </SidebarSection>
      {/each}

      {#if app.ready && groups.length === 0}
        <p class="hint">No projects yet. Add one with the + button.</p>
      {/if}

      {#snippet rail()}
        <button type="button" class="rail-item" title="Search projects (Alt K)" onclick={() => (ui.search = true)}>
          <Icon name="search" />
        </button>
        <button
          type="button"
          class="rail-item"
          title="Global Claude (Alt G)"
          aria-expanded={ui.drawer}
          onclick={() => (ui.drawer = !ui.drawer)}
        >
          <span class="global-icon" aria-hidden="true"><Icon name="sparkle" size="sm" weight={2} /></span>
          {#if globalSession}<span class="rail-dot"><StatusDot status={globalSession.status} /></span>{/if}
        </button>
        {#each groups as group (group.name)}
          <hr class="rail-group" title={group.name} />
          {#each group.projects as p (p.id)}
            {@const badge = projectBadge(sessionsOf(p.id).map((s) => s.status))}
            <a
              class="rail-item"
              class:selected={p.id === project?.id}
              href={href('p', p.id)}
              title={badge ? `${p.name} · ${badge.text}` : p.name}
              aria-current={p.id === project?.id ? 'page' : undefined}
            >
              <ProjectIcon icon={p.resolvedIcon} name={p.name} />
              {#if badge}<span class="rail-dot"><StatusDot status={badge.tone} /></span>{/if}
            </a>
          {/each}
        {/each}
      {/snippet}

      {#snippet footer()}
        <div class="hints">
          {#if dormantCount}<span>{dormantCount} dormant projects · find them with Alt K</span>{/if}
          <span><Kbd keys="Alt J" /> next that needs you · <Kbd keys="Alt ?" /> shortcuts</span>
        </div>
        <a class="user" href={href('settings')}>
          <span class="avatar" aria-hidden="true"
            >{(app.me?.name ?? 'You').slice(0, 1).toUpperCase()}{#if app.update?.latest}<span class="update-dot"
              ></span>{/if}</span
          >
          {#if app.update?.latest}<span class="visually-hidden">Update available</span>{/if}
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

  {#if children}
    <div class="page-scroll">{@render children()}</div>
  {:else if !project}
    <EmptyState
      title={route.name === 'project' && app.ready ? 'Project not found' : 'Pick a project'}
      body="Or open the global Claude with Alt G."
    />
  {:else}
    <header class="head">
      <ProjectIcon icon={project.resolvedIcon} name={project.name} size="lg" />
      <div class="title">
        <h1>{project.name}</h1>
        <span class="path"
          >{split ? `${tabs.length} sessions side by side` : project.path}{project.resolvedIcon.host && !split
            ? ` · ${project.resolvedIcon.host}`
            : ''}</span
        >
      </div>
      <div class="actions">
        <Button variant="primary" onclick={() => newSession()}>New session</Button>
        {#each project.buttons as b (b.id)}
          <Button variant={b.skill || b.prompt ? 'secondary' : 'dashed'} onclick={() => runButton(b)}
            >{b.label}{b.ask !== 'nothing' ? '…' : ''}</Button
          >
        {/each}
        <Button icon="split" pressed={split} onclick={() => (split = !split)}
          >{split ? 'Split view on' : 'Split view'}</Button
        >
        <Button icon="services" pressed={panelOpen} onclick={() => (panelOpen = !panelOpen)}
          >Services{services.length ? ` · ${services.length}` : ''}</Button
        >
        <IconButton
          label="Project settings"
          icon="gear"
          size="lg"
          variant="outline"
          href={href('settings', 'project', project.id)}
        />
      </div>
    </header>

    {#if !split}
      <TabBar label="Sessions">
        {#each tabs as s (s.id)}
          <SessionTab
            session={s}
            selected={s.id === active?.id}
            closing={app.closing[s.id]}
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
      <SplitView sessions={tabs} selectedId={active?.id} onselect={(id) => go('p', project.id, id)}>
        {#snippet pane(s)}
          <TerminalView sessionId={s.id} accent={project.accent} label={s.name} compact />
        {/snippet}
      </SplitView>
    {:else if active}
      {#key active.id}
        <TerminalView sessionId={active.id} accent={project.accent} label={active.name} focused={!ui.drawer} />
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
        onclose={(id) => {
          const s = shells.find((x) => x.id === id);
          if (s) close(s);
        }}
        onhide={() => (panelOpen = false)}
        context={services[0]?.project}
      >
        {#if panelTab !== 'services' && shells.some((s) => s.id === panelTab)}
          {#key panelTab}
            <TerminalView sessionId={panelTab} accent={project.accent} label="Plain terminal" compact focused />
          {/key}
        {:else}
          <ServicesTree
            containers={services}
            onaction={(a, c) => serviceAction(a, c, active)}
            loadLogs={serviceLogs}
            loadInspect={serviceInspect}
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

<Dialog open={!!ask} title={ask?.button.label ?? ''} onclose={() => (ask = null)}>
  {#if ask && project}
    <form id="ask-form" class="form" onsubmit={submitAsk}>
      <div class="ask-head">
        <ProjectIcon icon={project.resolvedIcon} name={project.name} />
        <span class="muted">New session in <code>{project.path}</code></span>
      </div>
      {#if ask.button.ask === 'pick-worktree' && ask.worktrees?.length}
        <fieldset class="worktrees">
          <legend>Worktree</legend>
          {#each ask.worktrees as w (w.path)}
            <label class="worktree">
              <input type="radio" name="worktree" value={w.path} bind:group={ask.value} required />
              <span class="stack"><span>{w.branch || 'detached'}</span><code class="muted">{w.path}</code></span>
            </label>
          {/each}
        </fieldset>
      {:else}
        <TextField
          label={ask.button.ask === 'pick-worktree'
            ? 'Worktree (name or path)'
            : ask.button.ask === 'number'
              ? 'Number'
              : 'Ticket number, URL or text'}
          type={ask.button.ask === 'number' ? 'number' : 'text'}
          bind:value={ask.value}
          required
          autocomplete="off"
          hint={ask.button.ask === 'pick-worktree' && ask.worktrees === null ? 'Loading the worktree list…' : undefined}
        />
      {/if}
      <p class="runs">
        Runs <code>claude</code>
        <code>"{preview(ask.button, ask.value || '…')}"</code>
        {#if ask.button.lockDefaultMode}· locked to the default permission mode{/if}
      </p>
    </form>
  {/if}
  {#snippet actions()}
    <Button variant="ghost" onclick={() => (ask = null)}>Cancel</Button>
    <Button variant="primary" type="submit" form="ask-form">{ask?.button.confirm ? 'Next' : 'Start session'}</Button>
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

{#if projectMenu}
  {@const p = projectMenu.project}
  <Menu
    label="Project menu for {p.name}"
    items={projectMenuItems(p)}
    x={projectMenu.x}
    y={projectMenu.y}
    onselect={(id) => onProjectMenu(p, id)}
    onclose={() => (projectMenu = null)}
  />
{/if}

<Dialog
  open={restorable.length > 0}
  title="Resume {restorable.length} {restorable.length === 1 ? 'session' : 'sessions'}?"
  description="These were running before the machine restarted. Unticked ones are given up."
  onclose={() => (restorable = [])}
>
  <div class="restore">
    {#each restorable as r (r.session.id)}
      <Checkbox
        label={r.session.name}
        hint={app.projects.find((p) => p.id === r.session.projectId)?.name ?? 'Global Claude'}
        bind:checked={r.on}
      />
    {/each}
  </div>
  {#snippet actions()}
    <Button variant="ghost" onclick={() => (restorable = [])}>Not now</Button>
    <Button variant="primary" onclick={() => restore(restorable.filter((r) => r.on).map((r) => r.session.id))}
      >Resume {restorable.filter((r) => r.on).length}</Button
    >
  {/snippet}
</Dialog>

<Drawer
  open={ui.drawer}
  title="Global Claude"
  subtitle="Not tied to a project · runs in ~ · always on"
  closeLabel="Close drawer (Alt G)"
  onclose={() => (ui.drawer = false)}
>
  {#snippet icon()}<span class="global-icon lg" aria-hidden="true"><Icon name="sparkle" weight={2} /></span>{/snippet}
  {#snippet actions()}<Button size="sm" onclick={newChat}>New chat</Button>{/snippet}
  {#if globalSession && globalSession.status !== 'exited'}
    {#key globalSession.id}
      <TerminalView sessionId={globalSession.id} label="Global Claude" focused />
    {/key}
  {:else}
    <EmptyState title="The global Claude is not running" body="It can add projects and start sessions for you.">
      <Button variant="primary" onclick={() => newSession(null)}>Start it</Button>
    </EmptyState>
  {/if}
  {#snippet footer()}
    <strong class="foot-title">What Claude sessions may do with the shub command</strong>
    Add projects, change project settings, start sessions (with a skill or prompt), read session status. Removing projects
    or closing other sessions stays with you.
  {/snippet}
</Drawer>

<style>
  .page-scroll {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
  }

  .brand {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 var(--space-1-5);

    /* The sidebar's hide button sits right of this row. */
    margin-right: calc(var(--size-control) + var(--space-2));
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

  .global[aria-expanded='true'] {
    background: var(--raised);
  }

  .rail-item {
    position: relative;
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--size-control);
    height: var(--size-control);
    padding: 0;
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--fg-2);
    cursor: pointer;
  }

  .rail-item:hover {
    background: var(--bg);
  }

  .rail-item.selected {
    background: var(--raised);
  }

  .rail-dot {
    position: absolute;
    top: 0;
    right: 0;
    display: flex;
  }

  .rail-group {
    flex: none;
    width: var(--size-control);
    margin: var(--space-1) 0;
    border: 0;
    border-top: var(--hairline) solid var(--line);
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

  .user:hover,
  .user:focus-visible {
    outline: var(--hairline) solid var(--line);
    background: var(--raised);
    color: var(--fg);
  }

  .avatar {
    position: relative;
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

  .update-dot {
    position: absolute;
    top: 0;
    right: 0;
    width: var(--size-dot);
    height: var(--size-dot);
    border-radius: var(--radius-round);
    background: var(--pink);
    box-shadow: 0 0 0 var(--hairline) var(--bg);
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

  .approvals {
    padding: 0 var(--space-1-5);
  }

  .ask-head {
    display: flex;
    align-items: center;
    gap: var(--space-2-5);
  }

  .muted {
    color: var(--muted);
  }

  code {
    font-family: var(--font-mono);
    font-size: var(--text-md);
  }

  .runs {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--muted);
  }

  .worktrees {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    border: 0;
  }

  .worktrees legend {
    margin-bottom: var(--space-1-5);
    padding: 0;
    font-weight: var(--weight-medium);
  }

  .worktree {
    display: flex;
    align-items: center;
    gap: var(--space-2-5);
    padding: var(--space-2) var(--space-2-5);
    border: var(--hairline) solid var(--line);
    border-radius: var(--radius-md);
    cursor: pointer;
  }

  .worktree input {
    accent-color: var(--primary);
  }

  .stack {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .restore {
    display: flex;
    flex-direction: column;
    gap: var(--space-2-5);
  }

  .foot-title {
    display: block;
    color: var(--fg-2);
    font-weight: var(--weight-medium);
  }
</style>
