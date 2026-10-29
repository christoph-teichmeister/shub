<script lang="ts">
  // The desktop sidebar: projects by group (or the Active group) with their sessions, child worktrees and subagents,
  // plugin sections, the collapsed rail and the footer with usage and settings.
  import type { ChildWorktree, Config, ProjectView, Session } from '../../../../../shared/api.ts';
  import Conflicts from '../../components/Conflicts/Conflicts.svelte';
  import AgentRow from '../../components/AgentRow/AgentRow.svelte';
  import Icon from '../../components/Icon/Icon.svelte';
  import Kbd from '../../components/Kbd/Kbd.svelte';
  import MachineSwitcher from '../../components/MachineSwitcher/MachineSwitcher.svelte';
  import ProjectIcon from '../../components/ProjectIcon/ProjectIcon.svelte';
  import ProjectRow from '../../components/ProjectRow/ProjectRow.svelte';
  import SessionRow from '../../components/SessionRow/SessionRow.svelte';
  import Sidebar from '../../components/Sidebar/Sidebar.svelte';
  import SidebarSection from '../../components/SidebarSection/SidebarSection.svelte';
  import StatusBadge from '../../components/StatusBadge/StatusBadge.svelte';
  import StatusDot from '../../components/StatusDot/StatusDot.svelte';
  import Wordmark from '../../components/Wordmark/Wordmark.svelte';
  import WorktreeRow from '../../components/WorktreeRow/WorktreeRow.svelte';
  import { childStart, placeChildren, sessionsIn } from '../../children.ts';
  import { dropPositions, projectBadge } from '../../status.ts';
  import { api } from '../../stores/api.ts';
  import { href } from '../../stores/router.svelte.ts';
  import {
    app,
    loadProjects,
    needsYouCount,
    placeRolled,
    rolledUp,
    sessionHref,
    sessionsOf,
    startSession,
    ui,
    unpinSession,
  } from '../../stores/state.svelte.ts';
  import { toastError } from '../../stores/toasts.svelte.ts';

  interface Props {
    /** The open project, its session open in the control center and the focused pane. */
    project: ProjectView | null;
    root: Session | null;
    active: Session | null;
    onnewsession: (p: ProjectView) => void;
    onrename: (s: Session, name: string) => void;
    onnextneedsyou: () => void;
    onsessionmenu: (menu: { session: Session; x: number; y: number }) => void;
    onprojectmenu: (menu: { project: ProjectView; x: number; y: number }) => void;
    onworktreemenu: (menu: { worktree: ChildWorktree; x: number; y: number }) => void;
  }
  let {
    project,
    root,
    active,
    onnewsession,
    onrename,
    onnextneedsyou,
    onsessionmenu,
    onprojectmenu,
    onworktreemenu,
  }: Props = $props();

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
  const groupBadge = (projects: ProjectView[]) => projectBadge(projects.flatMap((p) => sessionsOf(p.id).map(rolledUp)));
  const needsYouTotal = $derived(needsYouCount());
  // Crabs in the village queue: everyone who needs you or whose turn it is.
  const villageQueue = $derived(
    app.sessions.filter((s) => s.kind !== 'shell' && (s.status === 'needs-you' || s.status === 'your-turn')).length,
  );
  const dormantCount = $derived(app.projects.filter((p) => p.visibility === 'dormant').length);

  // ---------- Child worktrees: created by a session, nested under it ----------
  const placed = $derived(placeChildren(app.children, app.sessions));
  // Worktree children start folded under their session (or project); opened ones stay open until a reload.
  let openChildren = $state<Record<string, boolean>>({});
  const childrenOpen = (key: string, list: ChildWorktree[]) =>
    openChildren[key] ?? list.some((w) => sessionsIn(w, app.sessions).some((c) => c.id === active?.id));
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const worktreeCount = (list: ChildWorktree[]) => plural(list.length, 'worktree');
  /** What a session's fold hides: its worktrees and its running subagents. */
  const foldLabel = (kids: ChildWorktree[], agents: unknown[]) =>
    [kids.length && worktreeCount(kids), agents.length && plural(agents.length, 'subagent')].filter(Boolean).join(', ');
  async function openChild(w: ChildWorktree) {
    const request = childStart(w);
    const s = request && (await startSession(request));
    if (s) location.hash = sessionHref(s);
  }

  const pluginSections = $derived(
    app.plugins
      .filter((p) => p.enabled)
      .flatMap((p) => p.sections.filter((s) => s.content).map((s) => ({ plugin: p.name, ...s, content: s.content! }))),
  );

  function pluginEntry(plugin: string, action: string | undefined, entryId: string) {
    if (action)
      void api('pluginAction', { params: { name: plugin, actionId: action }, body: { entryId } }).catch(toastError);
  }

  // ---------- drag and drop order ----------
  let dragId: string | null = null;
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
  /**
   * Drop the dragged session next to `target` in `list` (the project's sessions in tab or sidebar order).
   * A dragged session is pinned on top.
   */
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
  const dragSessionStart = (s: Session) => (e: DragEvent) => {
    dragSession = s.id;
    e.dataTransfer?.setData('text/plain', s.name);
  };

  // Alt Up/Down: previous/next session in sidebar order, across projects.
  export function stepSidebar(dir: number) {
    const shown = app.config?.activeGroup ? activeProjects : groups.flatMap((g) => g.projects);
    const flat = shown.flatMap((p) => placeRolled(sessionsOf(p.id)));
    if (!flat.length) return;
    const i = flat.findIndex((s) => s.id === root?.id);
    const next = flat[i < 0 ? (dir > 0 ? 0 : flat.length - 1) : (i + dir + flat.length) % flat.length];
    location.hash = sessionHref(next);
  }

  // Remembered per browser; storage can be missing or throw (private window).
  let sidebarCollapsed = $state(false);
  try {
    sidebarCollapsed = localStorage.getItem('shub.sidebar.collapsed') === '1';
  } catch {
    // starts open
  }
  export function toggleSidebar() {
    sidebarCollapsed = !sidebarCollapsed;
    try {
      if (sidebarCollapsed) localStorage.setItem('shub.sidebar.collapsed', '1');
      else localStorage.removeItem('shub.sidebar.collapsed');
    } catch {
      // not remembered, still toggles
    }
  }
</script>

{#snippet sessionRows(list: Session[], projectId: string)}
  {@const top = list.filter((s) => !placed.nested.has(s.id))}
  {#each top as s (s.id)}
    {@const kids = placed.byOrigin.get(s.id) ?? []}
    {@const agents = s.agents ?? []}
    {@const open = childrenOpen(s.id, kids)}
    <!-- The fold chevron sits in the gutter left of the row, so a folded session takes one line. -->
    <div class="folder">
      <SessionRow
        session={rolledUp(s)}
        href={sessionHref(s)}
        selected={s.id === root?.id}
        closing={app.closing[s.id]}
        onmenu={(at) => onsessionmenu({ session: s, ...at })}
        ondragstart={dragSessionStart(s)}
        ondrop={(after) => dropSession(top, s, after)}
        onunpin={() => unpinSession(s)}
        onrename={(name) => onrename(s, name)}
      />
      {#if kids.length || agents.length}
        <button
          type="button"
          class="fold"
          aria-label={foldLabel(kids, agents)}
          title="{open ? 'Hide' : 'Show'} {foldLabel(kids, agents)}"
          aria-expanded={open}
          onclick={() => (openChildren[s.id] = !open)}
        >
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size="xs" weight={2} />
        </button>
      {/if}
    </div>
    {#if open}
      {#each agents as a (a.id)}<div class="child"><AgentRow agent={a} /></div>{/each}
      {#each kids as w (w.path)}{@render childRow(w)}{/each}
    {/if}
  {/each}
  {@render childGroup(projectId, placed.orphans.get(projectId) ?? [])}
{/snippet}

{#snippet childGroup(key: string, list: ChildWorktree[])}
  {#if list.length}
    {@const open = childrenOpen(key, list)}
    <!-- Worktrees whose creating session closed: a row of its own, folded from the same gutter as a session. -->
    <div class="folder orphans">
      <button
        type="button"
        class="orphan-row"
        aria-expanded={open}
        title="{open ? 'Hide' : 'Show'} orphaned worktrees"
        onclick={() => (openChildren[key] = !open)}
      >
        <span class="fold" aria-hidden="true">
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size="xs" weight={2} />
        </span>
        <Icon name="folder" size="xs" />
        <span class="grow">Orphaned worktrees</span>
        <span class="orphan-count">{worktreeCount(list)}</span>
      </button>
    </div>
    {#if open}{#each list as w (w.path)}{@render childRow(w)}{/each}{/if}
  {/if}
{/snippet}

{#snippet childRow(w: ChildWorktree)}
  <div class="child">
    {#each sessionsIn(w, app.sessions) as c (c.id)}
      <SessionRow
        session={c}
        href={sessionHref(c)}
        selected={c.id === active?.id}
        closing={app.closing[c.id]}
        onmenu={(at) => onsessionmenu({ session: c, ...at })}
        onrename={(name) => onrename(c, name)}
      />
    {:else}
      <WorktreeRow
        worktree={w}
        onopen={childStart(w) ? () => openChild(w) : undefined}
        onmenu={(at) => onworktreemenu({ worktree: w, ...at })}
      />
    {/each}
  </div>
{/snippet}

{#snippet villageButton()}
  <a
    class="rail-item"
    href={href('village')}
    title={villageQueue ? `Crab village · ${villageQueue} in line (Alt V)` : 'Crab village (Alt V)'}
  >
    <Icon name="crab" />
    <span class="visually-hidden">Crab village{villageQueue ? `, ${villageQueue} in line` : ''}</span>
    {#if villageQueue}<span class="rail-badge" aria-hidden="true">{villageQueue}</span>{/if}
  </a>
{/snippet}

<Sidebar collapsed={sidebarCollapsed} ontoggle={toggleSidebar}>
  {#snippet header()}
    <div class="brand">
      <Wordmark accent={project?.accent} {needsYou} />
      <span class="grow"></span>
      {@render villageButton()}
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
    <MachineSwitcher />
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
    <Conflicts />
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
        {@const list = placeRolled(sessionsOf(p.id))}
        {@const g = grace(p.id)}
        <div style:opacity={g?.opacity}>
          <ProjectRow
            project={p}
            sessions={list}
            href={href('p', p.id)}
            settingsHref={href('settings', 'project', p.id)}
            selected={p.id === project?.id}
            countdown={g?.text}
            onnewsession={() => onnewsession(p)}
            onmenu={(e) => onprojectmenu({ project: p, x: e.clientX, y: e.clientY })}
          >
            {@render sessionRows(list, p.id)}
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
          {@const list = placeRolled(sessionsOf(p.id))}
          <ProjectRow
            project={p}
            sessions={list}
            href={href('p', p.id)}
            settingsHref={href('settings', 'project', p.id)}
            selected={p.id === project?.id}
            onnewsession={() => onnewsession(p)}
            ondragstart={(e) => {
              dragId = p.id;
              e.dataTransfer?.setData('text/plain', p.name);
            }}
            ondrop={() => dropProject(group.name, p.id)}
            onmenu={(e) => onprojectmenu({ project: p, x: e.clientX, y: e.clientY })}
          >
            {@render sessionRows(list, p.id)}
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
      title={dormantCount ? `Search or add project (Alt K) · ${dormantCount} dormant` : 'Search or add project (Alt K)'}
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
    {@render villageButton()}
    {#if needsYouTotal}
      <button
        type="button"
        class="rail-item rail-next"
        aria-label="{needsYouTotal} need you, jump to the next (Alt J)"
        title="Next that needs you (Alt J)"
        onclick={onnextneedsyou}>{needsYouTotal}</button
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
        {@const badge = projectBadge(list.map(rolledUp))}
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
    {#if app.usage.fiveHour || app.usage.sevenDay}
      <div class="usage">
        {#each [['5h', app.usage.fiveHour], ['7d', app.usage.sevenDay]] as const as [label, l] (label)}
          {#if l}
            <span
              class="meter"
              class:warn={l.used >= 70}
              class:danger={l.used >= 90}
              title={`${label} limit: ${Math.round(l.used)}% used${l.resetsAt ? `, resets ${new Date(l.resetsAt * 1000).toLocaleString()}` : ''}`}
            >
              <span class="meter-label">{label}</span>
              <span class="meter-bar"><span style:width={`${Math.min(100, l.used)}%`}></span></span>
              <span class="meter-pct">{Math.round(l.used)}%</span>
            </span>
          {/if}
        {/each}
      </div>
    {/if}
    <div class="footbar">
      <div class="user">
        <span class="avatar" aria-hidden="true">{(app.me?.name ?? 'You').slice(0, 1).toUpperCase()}</span>
        <span class="grow user-text">
          <span class="user-name">{app.me?.name ?? 'You'}</span>
          <span class="user-sub">{app.connected ? 'Connected' : 'Offline, reconnecting'}</span>
          <span class="user-sub">v{app.update?.current ?? __APP_VERSION__}</span>
        </span>
      </div>
      <a class="rail-item" href={href('settings')} title="Settings"
        ><Icon name="gear" />{#if app.update?.latest}<span class="update-dot"></span><span class="visually-hidden"
            >Update available</span
          >{/if}<span class="visually-hidden">Settings</span></a
      >
      <button type="button" class="rail-item" title="Shortcuts (Alt ?)" onclick={() => (ui.shortcuts = true)}
        >?<span class="visually-hidden">Shortcuts</span></button
      >
    </div>
  {/snippet}
</Sidebar>

<style>
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

  .rail-badge {
    position: absolute;
    top: calc(var(--space-0-5) * -1);
    right: calc(var(--space-0-5) * -1);
    min-width: var(--size-check);
    padding: 0 var(--space-1);
    border-radius: var(--radius-pill);
    background: var(--status-needs-you);
    color: var(--on-accent);
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    line-height: var(--leading-base);
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

  .grow {
    flex: 1 1 auto;
    min-width: 0;
  }

  .orphans {
    margin-top: var(--space-2-5);
  }

  .orphan-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-1) var(--space-2-5);
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--muted);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .orphan-row:hover,
  .orphan-row:focus-visible {
    background: var(--raised);
    color: var(--fg);
  }

  .orphan-count {
    flex: none;
    font-size: var(--text-xs);
  }

  .folder {
    position: relative;
  }

  .fold {
    position: absolute;
    top: 50%;
    left: calc(-1 * var(--space-5));
    display: grid;
    place-items: center;
    width: var(--space-5);
    height: var(--space-5);
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    transform: translateY(-50%);
  }

  .fold:hover {
    color: var(--fg);
  }

  .orphan-row:hover .fold {
    color: var(--fg);
  }

  .child {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    padding-left: var(--space-4);
  }

  .hint {
    margin: 0;
    padding: 0 var(--space-1-5);
    color: var(--muted);
  }

  .usage {
    display: flex;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-1-5) 0;
    font-size: var(--text-xs);
    color: var(--muted);
    border-top: var(--hairline) solid var(--line);
  }

  .meter {
    flex: 1 1 0;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--space-1-5);
  }

  .meter-bar {
    flex: 1 1 auto;
    height: var(--space-1);
    border-radius: var(--radius-pill);
    background: var(--raised);
    overflow: hidden;
  }

  .meter-bar > span {
    display: block;
    height: 100%;
    background: var(--status-your-turn);
  }

  .meter.warn .meter-bar > span {
    background: var(--yellow);
  }

  .meter.danger .meter-bar > span {
    background: var(--pink);
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

  .footbar .update-dot {
    top: var(--space-1-5);
    right: var(--space-1-5);
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

  .approvals {
    padding: 0 var(--space-1-5);
  }
</style>
