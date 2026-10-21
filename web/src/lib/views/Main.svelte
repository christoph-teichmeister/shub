<script lang="ts">
  import { onMount, untrack, type Snippet } from 'svelte';
  import type {
    ButtonDef,
    Config,
    ProjectView,
    ServiceContainer,
    Session,
    SessionLink,
    StartSessionRequest,
    Worktree,
    WorktreeInfo,
  } from '../../../../shared/api.ts';
  import AppShell from '../components/AppShell/AppShell.svelte';
  import BottomPanel from '../components/BottomPanel/BottomPanel.svelte';
  import Button from '../components/Button/Button.svelte';
  import Checkbox from '../components/Checkbox/Checkbox.svelte';
  import CommandChip from '../components/CommandChip/CommandChip.svelte';
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
  import { dropPositions, placeSessions, projectBadge } from '../status.ts';
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
    startClaudeHere,
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
  const sessions = $derived(project ? placeSessions(sessionsOf(project.id), false) : []);
  const tabs = $derived(sessions.filter((s) => !hiddenTabs.includes(s.id)));
  const active = $derived<Session | null>(
    (route.name === 'project' && sessions.find((s) => s.id === route.sessionId)) || tabs[0] || null,
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

  // ---------- Hidden tabs: the tab's ✕ takes a session out of the tab bar, the sidebar keeps it ----------
  // Kept per browser; storage can be missing or throw (private window).
  // ponytail: ids of closed sessions are never pruned; a few bytes each, prune once sessions load reliably first.
  let hiddenTabs = $state<string[]>(
    (() => {
      try {
        return JSON.parse(localStorage.getItem('shub.tabs.hidden') ?? '[]') as string[];
      } catch {
        return [];
      }
    })(),
  );
  $effect(() => {
    try {
      localStorage.setItem('shub.tabs.hidden', JSON.stringify(hiddenTabs));
    } catch {
      // not remembered, the tab is back after a reload
    }
  });
  function showTab(id: string) {
    if (hiddenTabs.includes(id)) hiddenTabs = hiddenTabs.filter((x) => x !== id);
  }
  function hideTab(s: Session) {
    if (s.id === active?.id) {
      const i = tabs.findIndex((t) => t.id === s.id);
      const next = tabs[i + 1] ?? tabs[i - 1];
      location.hash = next ? sessionHref(next) : href('p', s.projectId);
    }
    hiddenTabs = [...hiddenTabs, s.id];
  }
  // Opening a session (sidebar, a link, a shortcut) brings its tab back.
  $effect(() => {
    const id = route.name === 'project' ? route.sessionId : null;
    if (id) untrack(() => showTab(id));
  });
  // So does starting to need you, so a hidden session never waits unseen (a status seen on load is no change).
  let lastStatus: Record<string, Session['status']> = {};
  $effect(() => {
    for (const s of app.sessions) {
      const was = lastStatus[s.id];
      if (s.status === 'needs-you' && was && was !== 'needs-you') untrack(() => showTab(s.id));
      lastStatus[s.id] = s.status;
    }
  });

  // ---------- Active group: projects with a session, kept ACTIVE_GRACE after the last one closes ----------
  const ACTIVE_GRACE = 10 * 60_000;
  // Kept per browser so a reload keeps the countdown; storage can be missing or throw (private window).
  let leftAt = $state<Record<string, number>>(
    (() => {
      try {
        return JSON.parse(localStorage.getItem('shub.active.leftAt') ?? '{}') as Record<string, number>;
      } catch {
        return {};
      }
    })(),
  );
  $effect(() => {
    try {
      localStorage.setItem('shub.active.leftAt', JSON.stringify(leftAt));
    } catch {
      // not remembered, the countdown still runs
    }
  });
  let now = $state(Date.now());
  let wasActive = new Set<string>();
  $effect(() => {
    const live = new Set(app.sessions.filter((s) => s.kind !== 'shell' && s.projectId).map((s) => s.projectId!));
    for (const id of wasActive) if (!live.has(id)) leftAt[id] = Date.now();
    for (const id of live) delete leftAt[id];
    wasActive = live;
  });
  $effect(() => {
    if (!Object.keys(leftAt).length) return;
    const tick = setInterval(() => {
      now = Date.now();
      for (const [id, at] of Object.entries(leftAt)) if (now - at >= ACTIVE_GRACE) delete leftAt[id];
    }, 1000);
    return () => clearInterval(tick);
  });
  const activeProjects = $derived(
    app.config?.activeGroup
      ? app.projects
          .filter((p) => sessionsOf(p.id).length || p.id in leftAt)
          .sort((a, b) => a.name.localeCompare(b.name))
      : [],
  );
  async function toggleActiveGroup() {
    if (!app.config) return;
    const activeGroup = !app.config.activeGroup;
    app.config.activeGroup = activeGroup;
    const config = await api<Config>('settings', { body: { activeGroup } }).catch(toastError);
    if (config) app.config = config;
    else app.config.activeGroup = !activeGroup;
  }
  /** Time left and opacity (1 -> 0.4) for a project in its grace; null while it has sessions. */
  function grace(id: string) {
    if (!(id in leftAt)) return null;
    const left = Math.max(0, ACTIVE_GRACE - (now - leftAt[id]));
    const text = `${Math.floor(left / 60_000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}`;
    return { text, opacity: 0.4 + 0.6 * (left / ACTIVE_GRACE) };
  }

  /** What a folded group still shows: who needs you, else what is working. */
  const groupBadge = (projects: ProjectView[]) => projectBadge(projects.flatMap((p) => sessionsOf(p.id)));
  const needsYouTotal = $derived(needsYouCount());
  const dormantCount = $derived(app.projects.filter((p) => p.visibility === 'dormant').length);

  // ---------- Worktrees: the open project's worktrees, searchable, with a terminal or Claude in each ----------
  let wt = $state<{ projectId: string; list: WorktreeInfo[] | null; query: string } | null>(null);
  async function loadWorktrees(fetch = false) {
    const projectId = wt?.projectId;
    if (!projectId) return;
    const query = { projectId, ...(fetch ? { fetch: '1' } : {}) };
    const list = await api<WorktreeInfo[]>('worktrees', { query }).catch((err: unknown) => {
      toastError(err);
      return null;
    });
    if (list && wt?.projectId === projectId) wt.list = list;
  }
  function openWorktrees() {
    if (!project) return;
    wt = { projectId: project.id, list: null, query: '' };
    // The quick list first, then once more after `git fetch --prune` so merged and remote-gone are current.
    void loadWorktrees().then(() => loadWorktrees(true));
  }
  // A session ending is often a /worktree-close run; reload without fetching.
  $effect(() => {
    void app.sessions.length;
    untrack(() => void loadWorktrees());
  });
  // Sessions come and go between loads; a session in a worktree always makes it active.
  const worktrees = $derived(
    (wt?.list ?? []).map((w) =>
      app.sessions.some((s) => s.cwd === w.path || s.cwd.startsWith(`${w.path}/`))
        ? { ...w, state: 'active' as const }
        : w,
    ),
  );
  const shownWorktrees = $derived.by(() => {
    const q = wt?.query.trim().toLowerCase() ?? '';
    return q ? worktrees.filter((w) => `${w.name} ${w.branch} ${w.state}`.toLowerCase().includes(q)) : worktrees;
  });
  /** Closing would lose work, git would refuse, or the session must end first. */
  const KEEP = ['active', 'locked', 'dirty', 'not-pushed'];
  const mergedWorktrees = $derived(worktrees.filter((w) => w.state === 'merged'));
  const age = (iso: string | null) => {
    const days = iso ? Math.floor((Date.now() - Date.parse(iso)) / 86_400_000) : null;
    return days === null ? '' : days < 1 ? 'today' : `${days}d`;
  };
  const closer = (p: ProjectView) => p.buttons.find((b) => b.skill === '/worktree-close');

  /** A plain terminal (its own tab) or a Claude session in the worktree. */
  async function startIn(w: WorktreeInfo, kind: 'shell' | 'claude') {
    const name = kind === 'shell' ? `Terminal · ${w.name}` : undefined;
    const s = await startSession({ projectId: w.projectId, kind, cwd: w.path, name });
    if (!s) return;
    wt = null;
    location.hash = sessionHref(s);
  }

  /** A project with a /worktree-close button closes through a Claude session (containers etc.), others by plain git. */
  async function closeWorktree(w: WorktreeInfo, open: boolean) {
    const p = app.projects.find((x) => x.id === w.projectId);
    if (!p) return;
    const button = closer(p);
    if (button) {
      if (open) {
        wt = null;
        await newSession(p, { buttonId: button.id, input: w.path });
      } else await startSession({ projectId: p.id, kind: 'claude', buttonId: button.id, input: w.path });
      return;
    }
    const { branchDeleted } = await api<{ branchDeleted: boolean }>('worktreeRemove', {
      body: { projectId: p.id, path: w.path },
    });
    toast(`Closed ${w.name}${w.branch ? (branchDeleted ? ' and its branch' : `; branch ${w.branch} kept`) : ''}`);
  }

  function closeAllMerged() {
    const list = mergedWorktrees;
    confirm = {
      title: `Close ${list.length} merged worktrees?`,
      body: `${list.map((w) => w.name).join(', ')}. With a /worktree-close button each gets its own session.`,
      action: 'Close all',
      danger: true,
      run: async () => {
        for (const w of list) await closeWorktree(w, false).catch(toastError);
        await loadWorktrees();
      },
    };
  }

  function askClose(w: WorktreeInfo) {
    const p = app.projects.find((x) => x.id === w.projectId);
    if (!p) return;
    if (w.state === 'folder-gone') {
      confirm = {
        title: `Prune ${p.name}?`,
        body: `${w.path} is gone; git forgets it and every other missing worktree of ${p.name}.`,
        action: 'Prune',
        run: () =>
          void api('worktreePrune', { body: { projectId: p.id } })
            .then(() => loadWorktrees())
            .catch(toastError),
      };
      return;
    }
    const button = closer(p);
    confirm = {
      title: `Close ${w.name}?`,
      body: button
        ? `Starts claude with "/worktree-close ${w.path}" in ${p.path}.`
        : `Removes ${w.path}` +
          (!w.branch ? '.' : w.state === 'merged' ? ` and its branch ${w.branch}.` : `; branch ${w.branch} stays.`),
      action: 'Close',
      danger: !button,
      run: () =>
        void closeWorktree(w, true)
          .then(() => loadWorktrees())
          .catch(toastError),
    };
  }
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
  let waitDraft = $state<{ session: Session; reason: string; check: string; every: number } | null>(null);
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

  $effect(() => {
    if (!app.jump) return;
    if (app.jump.from === active?.id) location.hash = sessionHref(app.jump.to);
    app.jump = null;
  });

  /** A plain terminal as its own tab, in the project folder. */
  async function newTerminal(p: ProjectView | null = project) {
    if (!p) return;
    const s = await startSession({ projectId: p.id, kind: 'shell' });
    if (s) location.hash = sessionHref(s);
  }

  /** Claude in a new tab, in the folder the terminal has been cd'd to. */
  async function claudeHere(shell: Session) {
    const s = await startClaudeHere(shell.id);
    if (s) location.hash = sessionHref(s);
  }

  async function newShell(cwd?: string) {
    if (!active) return;
    const s = await startSession({ projectId: active.projectId, kind: 'shell', parentId: active.id, cwd });
    if (s) {
      panelOpen = true;
      panelTab = s.id;
    }
    return s?.id;
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
    // Buttons start sessions in the open project, so a sidebar row of another project leaves them out.
    const buttons = (s.projectId === project?.id ? project.buttons : [])
      .filter((b) => b.confirm)
      .map((b, i) => ({
        id: `button:${b.id}`,
        label: `${b.label}${b.ask !== 'nothing' ? '…' : ''}`,
        separator: i === 0,
      }));
    return [
      { id: 'rename', label: 'Rename' },
      { id: 'link', label: 'Add link…', hint: s.links[0]?.label },
      ...(s.kind === 'shell'
        ? s.parentId
          ? []
          : [{ id: 'claude-here', label: 'Start Claude here' }]
        : [
            s.waitingFor
              ? { id: 'ready', label: 'Stop waiting', hint: s.waitingFor }
              : { id: 'wait', label: 'Wait for…' },
          ]),
      ...(hiddenTabs.includes(s.id) ? [] : [{ id: 'hide', label: 'Hide tab' }]),
      { id: 'pause', label: s.status === 'paused' ? 'Resume session' : 'Pause session' },
      ...plugin,
      ...buttons,
      { id: 'close', label: 'Close session', separator: true, danger: true },
    ];
  }

  function onMenu(s: Session, id: string) {
    if (id === 'rename') {
      // Renaming happens in the tab, so a sidebar row of another session opens it first.
      if (s.id !== active?.id) location.hash = sessionHref(s);
      renamingId = s.id;
    } else if (id === 'link') linkDraft = { session: s, label: '', url: '' };
    else if (id === 'wait') waitDraft = { session: s, reason: '', check: '', every: 30 };
    else if (id === 'ready')
      void api('sessionUpdate', { params: { id: s.id }, body: { waitingFor: null } }).catch(toastError);
    else if (id === 'pause')
      void api(s.status === 'paused' ? 'sessionResume' : 'sessionPause', { params: { id: s.id } }).catch(toastError);
    else if (id === 'close') close(s);
    else if (id === 'claude-here') void claudeHere(s);
    else if (id === 'hide') hideTab(s);
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
      { id: 'terminal', label: 'New terminal' },
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
    else if (id === 'terminal') void newTerminal(p);
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

  function saveWait() {
    if (!waitDraft) return;
    const { session, reason, check, every } = waitDraft;
    const body = { waitingFor: reason.trim(), waitCheck: check.trim() || undefined, waitEveryMinutes: every };
    void api('sessionUpdate', { params: { id: session.id }, body }).catch(toastError);
    waitDraft = null;
  }

  async function restore(ids: string[]) {
    restorable = [];
    const list = await api<Session[]>('restore', { body: { ids } }).catch(toastError);
    if (list?.length)
      toast(list.length === 1 ? 'Resuming 1 session' : `Resuming ${list.length} sessions, one after another`);
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

  let dragSession: string | null = null;
  /** Drop the dragged session next to `target` in `list` (the project's sessions in tab or sidebar order). */
  function dropSession(list: Session[], target: Session, after: boolean) {
    const id = dragSession;
    dragSession = null;
    if (!id || !list.some((s) => s.id === id)) return; // another project's session
    const i = list.indexOf(target) + (after ? 1 : 0);
    const positions = dropPositions(list, id, list[i]?.id ?? null);
    if (!Object.keys(positions).length) return;
    for (const s of list) if (s.id in positions) s.position = positions[s.id];
    void api('sessionsReorder', { body: { positions } }).catch(toastError);
  }
  function unpinSession(s: Session) {
    s.position = null;
    void api('sessionsReorder', { body: { positions: { [s.id]: null } } }).catch(toastError);
  }
  const dragSessionStart = (s: Session) => (e: DragEvent) => {
    dragSession = s.id;
    e.dataTransfer?.setData('text/plain', s.name);
  };

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
          void (e.shiftKey ? newShell() : newTerminal());
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
          <button
            type="button"
            class="rail-item global"
            title="Global Claude (Alt G)"
            aria-expanded={ui.drawer}
            onclick={() => (ui.drawer = !ui.drawer)}
          >
            <span class="global-icon" aria-hidden="true"><Icon name="sparkle" size="sm" weight={2} /></span>
            <span class="visually-hidden">Global Claude</span>
            {#if globalSession}<span class="rail-dot"><StatusDot status={globalSession.status} /></span>{/if}
          </button>
        </div>
        <button type="button" class="search" onclick={() => (ui.search = true)}>
          <Icon name="search" />
          <span class="grow">Search or add project</span>
          <Kbd keys="Alt K" />
        </button>
        <div class="filter">
          <div class="segments" role="group" aria-label="Show projects">
            <button
              type="button"
              aria-pressed={!app.config?.activeGroup}
              onclick={() => app.config?.activeGroup && toggleActiveGroup()}>All</button
            >
            <button
              type="button"
              aria-pressed={!!app.config?.activeGroup}
              title="Only projects with a session (kept 10 minutes after the last one closes)"
              onclick={() => app.config?.activeGroup || toggleActiveGroup()}>Active</button
            >
          </div>
          {#if dormantCount}
            <button type="button" class="dormant" title="Find them with Alt K" onclick={() => (ui.search = true)}
              >{dormantCount} dormant</button
            >
          {/if}
        </div>
        {#if pendingApprovals > 1}
          <span class="approvals"><StatusBadge text="{pendingApprovals} approvals waiting" tone="needs-you" /></span>
        {/if}
      {/snippet}

      {#each pluginSections as section (section.plugin + section.id)}
        <SidebarSection
          title={section.title}
          defaultCollapsed
          badge={section.content.badge}
          entries={section.content.entries}
          onentry={(entry) => pluginEntry(section.plugin, entry.action, entry.id)}
        />
      {/each}

      {#if app.config?.activeGroup}
        <SidebarSection
          title="Active"
          collapsedBadge={groupBadge(activeProjects)}
          entries={activeProjects.length ? undefined : []}
        >
          {#each activeProjects as p (p.id)}
            {@const list = placeSessions(sessionsOf(p.id), true)}
            {@const g = grace(p.id)}
            <div style:opacity={g?.opacity}>
              <ProjectRow
                project={p}
                sessions={list}
                href={href('p', p.id)}
                settingsHref={href('settings', 'project', p.id)}
                selected={p.id === project?.id}
                countdown={g?.text}
                onnewsession={() => newSession(p)}
                onmenu={(e) => (projectMenu = { project: p, x: e.clientX, y: e.clientY })}
              >
                {#each list as s (s.id)}
                  <SessionRow
                    session={s}
                    href={sessionHref(s)}
                    selected={s.id === active?.id}
                    closing={app.closing[s.id]}
                    onmenu={(at) => (menu = { session: s, ...at })}
                    ondragstart={dragSessionStart(s)}
                    ondrop={(after) => dropSession(list, s, after)}
                    onunpin={() => unpinSession(s)}
                  />
                {/each}
              </ProjectRow>
            </div>
          {/each}
        </SidebarSection>
      {:else}
        {#each groups as group (group.name)}
          <SidebarSection
            title={group.name}
            collapsedBadge={groupBadge(group.projects)}
            ondrop={() => dropProject(group.name, null)}
          >
            {#each group.projects as p (p.id)}
              {@const list = placeSessions(sessionsOf(p.id), true)}
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
                    onmenu={(at) => (menu = { session: s, ...at })}
                    ondragstart={dragSessionStart(s)}
                    ondrop={(after) => dropSession(list, s, after)}
                    onunpin={() => unpinSession(s)}
                  />
                {/each}
              </ProjectRow>
            {/each}
          </SidebarSection>
        {/each}
      {/if}

      {#if app.ready && !app.config?.activeGroup && groups.length === 0}
        <p class="hint">No projects yet. Add one with the + button.</p>
      {/if}

      {#snippet rail()}
        <button
          type="button"
          class="rail-item"
          title={dormantCount
            ? `Search or add project (Alt K) · ${dormantCount} dormant`
            : 'Search or add project (Alt K)'}
          onclick={() => (ui.search = true)}
        >
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
        {#if needsYouTotal}
          <button
            type="button"
            class="rail-item rail-next"
            aria-label="{needsYouTotal} need you, jump to the next (Alt J)"
            title="Next that needs you (Alt J)"
            onclick={nextNeedsYou}>{needsYouTotal}</button
          >
        {/if}
        {#if pendingApprovals > 1}
          <span class="rail-count" title="{pendingApprovals} approvals waiting">
            <StatusBadge text={String(pendingApprovals)} tone="needs-you" />
          </span>
        {/if}
        {#each pluginSections as section (section.plugin + section.id)}
          {@const badge = section.content.badge}
          <button
            type="button"
            class="rail-item"
            title={badge ? `${section.title} · ${badge.text}` : section.title}
            onclick={toggleSidebar}
          >
            <Icon name="board" />
            {#if badge && badge.tone !== 'neutral'}<span class="rail-dot"><StatusDot status={badge.tone} /></span>{/if}
          </button>
        {/each}
        {#each app.config?.activeGroup ? [{ name: 'Active', projects: activeProjects }] : groups as group (group.name)}
          <hr class="rail-group" title={group.name} />
          {#each group.projects as p (p.id)}
            {@const list = sessionsOf(p.id)}
            {@const badge = projectBadge(list)}
            <a
              class="rail-item"
              class:selected={p.id === project?.id}
              href={href('p', p.id)}
              title={[p.name, badge?.text, ...list.map((s) => `${s.name}: ${s.status}`)].filter(Boolean).join('\n')}
              aria-current={p.id === project?.id ? 'page' : undefined}
            >
              <ProjectIcon icon={p.resolvedIcon} name={p.name} />
              {#if badge}<span class="rail-dot"><StatusDot status={badge.tone} /></span>{/if}
            </a>
          {/each}
        {/each}
        <a
          class="rail-item rail-user"
          href={href('settings')}
          title="{app.me?.name ?? 'You'} · {app.connected ? 'Connected' : 'Offline, reconnecting'}{app.update?.latest
            ? ' · update available'
            : ''} · settings"
        >
          <span class="avatar" class:offline={!app.connected} aria-hidden="true"
            >{(app.me?.name ?? 'You').slice(0, 1).toUpperCase()}{#if app.update?.latest}<span class="update-dot"
              ></span>{/if}</span
          >
        </a>
      {/snippet}

      {#snippet footer()}
        <div class="footbar">
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
          <button type="button" class="rail-item" title="Shortcuts (Alt ?)" onclick={() => (ui.shortcuts = true)}
            >?<span class="visually-hidden">Shortcuts</span></button
          >
        </div>
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
          >{split ? `${sessions.length} sessions side by side` : project.path}{project.resolvedIcon.host && !split
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
        <Button icon="folder" onclick={openWorktrees}>Worktrees</Button>
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
            onhide={() => hideTab(s)}
            onmenu={(at) => (menu = { session: s, ...at })}
            ondragstart={dragSessionStart(s)}
            ondrop={(after) => dropSession(sessions, s, after)}
          />
        {/each}
        {#snippet trailing()}
          <IconButton label="New session (Alt N)" icon="plus" size="md" tone="muted" onclick={() => newSession()} />
          <IconButton
            label="New terminal (Alt T)"
            icon="terminal"
            size="md"
            tone="muted"
            onclick={() => newTerminal()}
          />
          {#if active?.kind === 'shell' && !active.parentId}
            <Button size="sm" icon="sparkle" onclick={() => claudeHere(active)}>Start Claude here</Button>
          {/if}
          <span class="tab-hint">Double-click a tab to rename</span>
        {/snippet}
      </TabBar>
    {/if}

    {#if split && sessions.length}
      <SplitView {sessions} selectedId={active?.id} onselect={(id) => go('p', project.id, id)}>
        {#snippet pane(s)}
          <TerminalView sessionId={s.id} accent={project.accent} label={s.name} compact />
        {/snippet}
      </SplitView>
    {:else if active}
      {#key active.id}
        <TerminalView sessionId={active.id} accent={project.accent} label={active.name} focused={!ui.drawer} />
      {/key}
      <CommandChip session={active} onterminal={newShell} />
    {:else}
      <EmptyState
        title={sessions.length ? 'All tabs hidden' : 'No session yet'}
        body={sessions.length
          ? 'Open a session from the sidebar or start one with Alt N.'
          : 'Start one here or with Alt N.'}
      >
        <Button variant="primary" onclick={() => newSession()}>New session</Button>
      </EmptyState>
    {/if}

    {#if panelOpen && active}
      <BottomPanel
        tabs={panelTabs}
        active={panelTabs.some((t) => t.id === panelTab) ? panelTab : 'services'}
        onselect={(id) => (panelTab = id)}
        onnew={() => newShell()}
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

<Dialog
  open={!!waitDraft}
  title="Wait for…"
  description="Parks the session as waiting, so it stops asking for your turn."
  onclose={() => (waitDraft = null)}
>
  {#if waitDraft}
    <form
      id="wait-form"
      class="form"
      onsubmit={(e) => {
        e.preventDefault();
        saveWait();
      }}
    >
      <label class="field"
        ><span>Waiting for</span><input
          bind:value={waitDraft.reason}
          placeholder="Kai's answer on MR !2213"
          required
        /></label
      >
      <label class="field"
        ><span>How can Haiku tell it happened?</span><textarea
          bind:value={waitDraft.check}
          rows="4"
          placeholder="Look at merge request !2213 in ai/ai-portal on GitLab. Done once Kai has written a new comment or approved it after today 11:00."
        ></textarea></label
      >
      <p class="wait-hint">
        Be exact: where to look (link, or MR / issue number and repo), whose action, what counts as done. Haiku checks
        it read-only, once right away and then at the interval below, and hands the session back when it happened. Leave
        it empty to only park the session.
      </p>
      <label class="field"
        ><span>Check every</span><select bind:value={waitDraft.every}>
          {#each [15, 30, 60, 120] as m (m)}<option value={m}>{m < 60 ? `${m} minutes` : `${m / 60} h`}</option>{/each}
        </select></label
      >
    </form>
  {/if}
  {#snippet actions()}
    <Button variant="ghost" onclick={() => (waitDraft = null)}>Cancel</Button>
    <Button variant="primary" type="submit" form="wait-form"
      >{waitDraft?.check.trim() ? 'Wait and check' : 'Wait'}</Button
    >
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

<Dialog
  open={!!wt}
  title={`Worktrees of ${app.projects.find((p) => p.id === wt?.projectId)?.name ?? ''}`}
  onclose={() => (wt = null)}
>
  {#if wt}
    <div class="form">
      <TextField label="Search" bind:value={wt.query} placeholder="Name, branch or state" autocomplete="off" />
      {#if wt.list === null}
        <p class="muted">Loading the worktrees…</p>
      {:else if !shownWorktrees.length}
        <p class="muted">{worktrees.length ? 'No worktree matches.' : 'No worktrees besides the main checkout.'}</p>
      {:else}
        <ul class="wt-list">
          {#each shownWorktrees as w (w.path)}
            <li class="wt-row">
              <span class="stack grow">
                <span class="wt-name"
                  >{w.name}
                  <StatusBadge
                    text={w.state.replace('-', ' ')}
                    tone={w.state === 'active' ? 'working' : KEEP.includes(w.state) ? 'neutral' : 'done'}
                  /></span
                >
                <code class="muted" title={w.path}
                  >{[w.branch || 'detached', age(w.lastCommitAt)].filter(Boolean).join(' · ')}</code
                >
              </span>
              {#if w.state !== 'folder-gone'}
                <Button size="sm" icon="terminal" aria-label="Terminal in {w.name}" onclick={() => startIn(w, 'shell')}
                  >Terminal</Button
                >
                <Button size="sm" icon="sparkle" aria-label="Claude in {w.name}" onclick={() => startIn(w, 'claude')}
                  >Claude</Button
                >
              {/if}
              {#if !KEEP.includes(w.state)}
                <Button size="sm" variant="ghost" onclick={() => askClose(w)}
                  >{w.state === 'folder-gone' ? 'Prune' : 'Close'}</Button
                >
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
  {#snippet actions()}
    {#if mergedWorktrees.length > 1}
      <Button variant="ghost" onclick={closeAllMerged}>Close all merged ({mergedWorktrees.length})</Button>
    {/if}
    <Button variant="primary" onclick={() => (wt = null)}>Done</Button>
  {/snippet}
</Dialog>

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

  .search {
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

  .filter {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .segments {
    display: flex;
    padding: var(--space-0-5);
    border-radius: var(--radius-md);
    background: var(--bg);
  }

  .segments button,
  .dormant {
    padding: var(--space-1) var(--space-2-5);
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .segments button[aria-pressed='true'] {
    background: var(--raised);
    color: var(--fg);
  }

  .segments button:hover,
  .dormant:hover {
    color: var(--fg);
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

  .rail-next {
    background: var(--status-needs-you);
    color: var(--on-accent);
    font-weight: var(--weight-semibold);
  }

  .rail-next:hover {
    background: var(--status-needs-you);
    filter: brightness(1.1);
  }

  .rail-user {
    margin-top: auto;
  }

  .avatar.offline {
    opacity: 0.5;
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

  .footbar {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding-top: var(--space-2);
    border-top: var(--hairline) solid var(--line);
  }

  .user {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--space-2-5);
    padding: var(--space-1) var(--space-1-5);
    border-radius: var(--radius-md);
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

  .field textarea {
    padding: var(--space-2) var(--space-2-5);
    border: var(--hairline) solid var(--line-strong);
    border-radius: var(--radius-md);
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    font-size: var(--text-base);
    resize: vertical;
  }

  .wait-hint {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--muted);
  }

  .field select,
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

  .wt-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1-5);
    max-height: 50vh;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
  }

  .wt-row {
    display: flex;
    align-items: center;
    gap: var(--space-1-5);
    padding: var(--space-2) var(--space-2-5);
    border: var(--hairline) solid var(--line);
    border-radius: var(--radius-md);
  }

  .wt-name {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    overflow-wrap: anywhere;
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
