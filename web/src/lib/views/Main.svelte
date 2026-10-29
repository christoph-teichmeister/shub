<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import type {
    ButtonDef,
    ChildWorktree,
    ProjectView,
    ServiceContainer,
    Session,
    StartSessionRequest,
    Worktree,
  } from '../../../../shared/api.ts';
  import AppShell from '../components/AppShell/AppShell.svelte';
  import { noteFile } from '../stores/noteFile.svelte.ts';
  import NotesPanel from '../components/NotesPanel/NotesPanel.svelte';
  import BottomPanel from '../components/BottomPanel/BottomPanel.svelte';
  import Button from '../components/Button/Button.svelte';
  import Checkbox from '../components/Checkbox/Checkbox.svelte';
  import CommandChip from '../components/CommandChip/CommandChip.svelte';
  import Dialog from '../components/Dialog/Dialog.svelte';
  import Drawer from '../components/Drawer/Drawer.svelte';
  import EmptyState from '../components/EmptyState/EmptyState.svelte';
  import Icon from '../components/Icon/Icon.svelte';
  import IconButton from '../components/IconButton/IconButton.svelte';
  import Menu, { type MenuItem } from '../components/Menu/Menu.svelte';
  import ProjectIcon from '../components/ProjectIcon/ProjectIcon.svelte';
  import ServicesTree from '../components/ServicesTree/ServicesTree.svelte';
  import SessionTab from '../components/SessionTab/SessionTab.svelte';
  import SplitView from '../components/SplitView/SplitView.svelte';
  import TabBar from '../components/TabBar/TabBar.svelte';
  import PausedPanel from '../components/PausedPanel/PausedPanel.svelte';
  import TerminalView from '../components/TerminalView/TerminalView.svelte';
  import TextField from '../components/TextField/TextField.svelte';
  import ConfirmDialog, { type Confirm } from './Main/ConfirmDialog.svelte';
  import MainSidebar from './Main/MainSidebar.svelte';
  import ProjectMenu from './Main/ProjectMenu.svelte';
  import SessionMenu from './Main/SessionMenu.svelte';
  import WorktreesDialog from './Main/WorktreesDialog.svelte';
  import { api, ApiError } from '../stores/api.ts';
  import { TIPS } from './shortcuts.ts';
  import { go, href, parseHash, router } from '../stores/router.svelte.ts';
  import {
    app,
    closeSession,
    compact,
    sessionHref,
    sessionsOf,
    childrenOf,
    placeRolled,
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
  const sessions = $derived(project ? placeRolled(sessionsOf(project.id)) : []);
  // The session open in the control center; the route may name one of its panes (second Claude, terminal).
  const root = $derived<Session | null>(
    (route.name === 'project' &&
      sessions.find((s) => s.id === route.sessionId || childrenOf(s.id).some((c) => c.id === route.sessionId))) ||
      sessions[0] ||
      null,
  );
  const panes = $derived(root ? [root, ...childrenOf(root.id)] : []);
  // The focused pane.
  const active = $derived<Session | null>(
    (route.name === 'project' && panes.find((s) => s.id === route.sessionId)) || root,
  );
  const globalSession = $derived(app.sessions.find((s) => s.kind === 'global') ?? null);

  // ---------- local UI state ----------
  let split = $state(false);
  let panelOpen = $state(false);
  let notesOpen = $state(false);
  // A note the terminal linked opens the panel on that file.
  $effect(() => {
    if (noteFile.target) notesOpen = true;
  });
  let renamingId = $state<string | null>(null);
  let menu = $state<{ session: Session; x: number; y: number } | null>(null);
  let worktreeMenu = $state<{ worktree: ChildWorktree; x: number; y: number } | null>(null);
  let newMenu = $state<{ x: number; y: number } | null>(null);
  let projectMenu = $state<{ project: ProjectView; x: number; y: number } | null>(null);
  let confirm = $state<Confirm | null>(null);
  let ask = $state<{ button: ButtonDef; value: string; worktrees: Worktree[] | null } | null>(null);
  let restorable = $state<{ session: Session; on: boolean }[]>([]);
  let services = $state<ServiceContainer[]>([]);
  let mainSidebar = $state<ReturnType<typeof MainSidebar>>();
  let worktreesDialog = $state<ReturnType<typeof WorktreesDialog>>();

  $effect(() => {
    const id = root?.kind === 'claude' ? root.id : null;
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

  /** A pane in the open session's control center: a terminal or a second Claude, focused. */
  async function newPane(kind: 'shell' | 'claude', cwd?: string) {
    if (!root) return;
    const s = await startSession({ projectId: root.projectId, kind, parentId: root.id, cwd });
    if (s) location.hash = sessionHref(s);
    return s?.id;
  }
  const newShell = (cwd?: string) => newPane('shell', cwd);

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

  const openWorktrees = () => project && worktreesDialog?.open(project);

  function rename(s: Session, name: string) {
    void api('sessionUpdate', { params: { id: s.id }, body: { name } }).catch(toastError);
    s.name = name;
  }

  function close(s: Session) {
    const run = () => void closeSession(s.id);
    // Ending a session ends its panes too.
    const panes = childrenOf(s.id);
    const list = panes.map((c) => `${c.name}${c.status === 'working' ? ' (working)' : ''}`).join(', ');
    if (panes.length)
      confirm = {
        title: `Close ${s.name} and its ${panes.length === 1 ? 'pane' : `${panes.length} panes`}?`,
        body: `${list} end${panes.length === 1 ? 's' : ''} with it.`,
        action: 'Close all',
        danger: true,
        run,
      };
    else if (s.status === 'working')
      confirm = { title: `Close ${s.name}?`, body: 'It is still working.', action: 'Close', danger: true, run };
    else run();
  }

  /** The tab bar's + menu: a Claude session, a terminal, then the project's own buttons. */
  function newMenuItems(p: ProjectView): MenuItem[] {
    return [
      { id: 'claude', label: 'New Claude session', hint: 'Alt N' },
      { id: 'terminal', label: 'New terminal tab', hint: root ? 'Alt Shift T' : 'Alt T' },
      ...(root
        ? [
            { id: 'pane-claude', label: 'Claude in this session', separator: true },
            { id: 'pane-shell', label: 'Terminal in this session', hint: 'Alt T' },
          ]
        : []),
      ...p.buttons.map((b, i) => ({
        id: `button:${b.id}`,
        label: `${b.label}${b.ask !== 'nothing' ? '…' : ''}`,
        separator: i === 0,
      })),
    ];
  }

  function onNewMenu(p: ProjectView, id: string) {
    if (id === 'claude') void newSession(p);
    else if (id === 'terminal') void newTerminal(p);
    else if (id === 'pane-claude') void newPane('claude');
    else if (id === 'pane-shell') void newPane('shell');
    else {
      const b = p.buttons.find((x) => `button:${x.id}` === id);
      if (b) void runButton(b);
    }
  }

  async function restore(ids: string[]) {
    restorable = [];
    const list = await api<Session[]>('restore', { body: { ids } }).catch(toastError);
    if (list?.length)
      toast(list.length === 1 ? 'Resuming 1 session' : `Resuming ${list.length} sessions, one after another`);
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
    const s = sessions[(i + sessions.length) % sessions.length];
    if (s) location.hash = sessionHref(s);
  }

  function onKeydown(e: KeyboardEvent) {
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    const index = sessions.findIndex((s) => s.id === root?.id);
    const digit = /^Digit([1-9])$/.exec(e.code);
    if (digit) selectTab(Number(digit[1]) - 1);
    else if (e.key === '?' || e.code === 'Slash') ui.shortcuts = !ui.shortcuts;
    else
      switch (e.code) {
        case 'KeyB':
          mainSidebar?.toggleSidebar();
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
        case 'KeyV':
          go('village');
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
        case 'ArrowUp':
          mainSidebar?.stepSidebar(-1);
          break;
        case 'ArrowDown':
          mainSidebar?.stepSidebar(1);
          break;
        case 'KeyS':
          split = !split;
          break;
        case 'KeyD':
          panelOpen = !panelOpen;
          break;
        case 'KeyM':
          notesOpen = !notesOpen;
          break;
        case 'KeyT':
          void (e.shiftKey || !root ? newTerminal() : newShell());
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
    <MainSidebar
      bind:this={mainSidebar}
      {project}
      {root}
      {active}
      onnewsession={(p) => newSession(p)}
      onrename={rename}
      onnextneedsyou={nextNeedsYou}
      onsessionmenu={(m) => (menu = m)}
      onprojectmenu={(m) => (projectMenu = m)}
      onworktreemenu={(m) => (worktreeMenu = m)}
    />
  {/snippet}

  {#if children}
    <div class="page-scroll">{@render children()}</div>
  {:else if !project}
    <EmptyState
      title={route.name === 'project' && app.ready ? 'Project not found' : 'Pick a project'}
      body="Or open the global Claude with Alt G."
    >
      <p class="tip">{TIPS[Math.floor(Math.random() * TIPS.length)]}</p>
    </EmptyState>
  {:else}
    <TabBar label="Panes">
      {#snippet leading()}
        <span class="project" title={[project.path, project.resolvedIcon.host].filter(Boolean).join(' · ')}>
          <ProjectIcon icon={project.resolvedIcon} name={project.name} size="sm" />
          <h1 class="label">{project.name}</h1>
        </span>
      {/snippet}
      {#if !split}
        {#each panes as s (s.id)}
          <SessionTab
            session={s}
            selected={s.id === active?.id}
            closing={app.closing[s.id]}
            bind:renaming={() => renamingId === s.id, (v) => (renamingId = v ? s.id : null)}
            onselect={() => (location.hash = sessionHref(s))}
            onrename={(name) => rename(s, name)}
            onclose={() => close(s)}
            oncompact={() => compact(s)}
            onmenu={(at) => (menu = { session: s, ...at })}
          />
        {/each}
      {/if}
      {#snippet trailing()}
        <button
          type="button"
          class="new"
          aria-haspopup="menu"
          aria-expanded={!!newMenu}
          title="New session (Alt N), terminal (Alt T) or project button"
          onclick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            newMenu = { x: r.left, y: r.bottom };
          }}><Icon name="plus" /><Icon name="chevron-down" size="sm" /><span class="visually-hidden">New</span></button
        >
        {#if active?.kind === 'shell' && !active.parentId && !split}
          <Button size="sm" icon="sparkle" onclick={() => claudeHere(active)}>Start Claude here</Button>
        {/if}
        <span class="views">
          <Button size="sm" variant="ghost" icon="folder" title="Worktrees" onclick={openWorktrees}
            ><span class="label">Worktrees</span></Button
          >
          <Button
            size="sm"
            variant="ghost"
            icon="split"
            pressed={split}
            title="Split view (Alt S)"
            onclick={() => (split = !split)}><span class="label">Split</span></Button
          >
          <Button
            size="sm"
            variant="ghost"
            icon="book"
            pressed={notesOpen}
            title="Notes: a Markdown draft you and Claude write together (Alt M)"
            onclick={() => (notesOpen = !notesOpen)}><span class="label">Notes</span></Button
          >
          <Button
            size="sm"
            variant="ghost"
            icon="services"
            pressed={panelOpen}
            title="Services (Alt D)"
            onclick={() => (panelOpen = !panelOpen)}
            ><span class="label">Services</span>{#if services.length}<span class="count">{services.length}</span
              >{/if}</Button
          >
          <span class="divider" aria-hidden="true"></span>
          <IconButton
            label="Project settings"
            icon="sliders"
            size="md"
            tone="muted"
            href={href('settings', 'project', project.id)}
          />
        </span>
      {/snippet}
    </TabBar>

    <div class="work">
      <div class="term">
        {#if split && panes.length}
          <SplitView sessions={panes} selectedId={active?.id} onselect={(id) => go('p', project.id, id)}>
            {#snippet pane(s)}
              {#if s.status === 'paused'}
                <PausedPanel session={s} />
              {:else}
                <TerminalView sessionId={s.id} accent={project.accent} label={s.name} compact />
              {/if}
            {/snippet}
          </SplitView>
        {:else if active?.status === 'paused'}
          <PausedPanel session={active} />
        {:else if active}
          {#key active.id}
            <TerminalView sessionId={active.id} accent={project.accent} label={active.name} focused={!ui.drawer} />
          {/key}
          <CommandChip session={active} onterminal={newShell} />
        {:else}
          <EmptyState
            title="No session yet"
            body={sessions.length
              ? 'Open a session from the sidebar or start one with Alt N.'
              : 'Start one here or with Alt N.'}
          >
            <Button variant="primary" onclick={() => newSession()}>New session</Button>
          </EmptyState>
        {/if}
      </div>
      {#if notesOpen && root}
        {#key root.id + (noteFile.target?.file ?? '')}
          <NotesPanel
            sessionId={root.id}
            claudeId={root.kind === 'claude' ? root.id : undefined}
            note={noteFile.target}
            onback={() => (noteFile.target = null)}
            onhide={() => (notesOpen = false)}
          />
        {/key}
      {/if}
    </div>

    {#if panelOpen && root}
      <BottomPanel
        tabs={[{ id: 'services', label: 'Services' }]}
        active="services"
        onselect={() => {}}
        onhide={() => (panelOpen = false)}
        context={services[0]?.project}
      >
        <ServicesTree
          containers={services}
          onaction={(a, c) => serviceAction(a, c, root)}
          loadLogs={serviceLogs}
          loadInspect={serviceInspect}
        />
      </BottomPanel>
    {/if}
  {/if}
</AppShell>

{#if newMenu && project}
  {@const p = project}
  <Menu
    label="New in {p.name}"
    items={newMenuItems(p)}
    x={newMenu.x}
    y={newMenu.y}
    onselect={(id) => onNewMenu(p, id)}
    onclose={() => (newMenu = null)}
  />
{/if}

<SessionMenu
  bind:menu
  {project}
  onrename={(s) => {
    // Renaming happens in the tab, so a sidebar row of another session opens it first.
    if (s.id !== active?.id) location.hash = sessionHref(s);
    renamingId = s.id;
  }}
  onclose={close}
  onclaudehere={(s) => void claudeHere(s)}
  onrunbutton={(b) => void runButton(b)}
/>

<ConfirmDialog bind:confirm />

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

{#if worktreeMenu}
  {@const w = worktreeMenu.worktree}
  <Menu
    label="Menu for {w.name}"
    items={[{ id: 'delete', label: 'Delete worktree', danger: true }]}
    x={worktreeMenu.x}
    y={worktreeMenu.y}
    onselect={() => worktreesDialog?.askClose(w)}
    onclose={() => (worktreeMenu = null)}
  />
{/if}

<ProjectMenu
  bind:menu={projectMenu}
  current={project}
  onnewsession={(p) => void newSession(p)}
  onnewterminal={(p) => void newTerminal(p)}
  onconfirm={(c) => (confirm = c)}
/>

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

<WorktreesDialog bind:this={worktreesDialog} onconfirm={(c) => (confirm = c)} onnewsession={newSession} />

<style>
  .tip {
    margin: var(--space-4) 0 0;
    max-width: 40ch;
    color: var(--muted);
    font-size: var(--text-sm);
  }

  .work {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
  }

  .term {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .page-scroll {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
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

  .project {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: var(--size-control-xs);
    margin-right: var(--space-2);
    padding: 0 var(--space-3) 0 var(--space-1);
    border-right: var(--hairline) solid var(--line);
  }

  h1 {
    margin: 0;
    font-size: var(--text-base);
    font-weight: var(--weight-semibold);
    white-space: nowrap;
  }

  /* Looks like the icon buttons next to it; the chevron says it opens a menu. */
  .new {
    display: inline-flex;
    align-items: center;
    gap: var(--space-0-5);
    height: var(--size-control-sm);
    margin-left: var(--space-1);
    padding: 0 var(--space-1-5);
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--muted);
    cursor: pointer;
  }

  .new:hover,
  .new[aria-expanded='true'] {
    background: var(--raised);
    color: var(--fg);
  }

  /* Narrow pane: the project shows as its icon, buttons as icons; the words stay for screen readers. */
  @container tabbar (width < 960px) {
    .label {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }

    .project {
      gap: 0;
    }
  }

  .views {
    display: flex;
    align-items: center;
    gap: var(--space-0-5);
    margin-left: auto;
  }

  .count {
    padding: 0 var(--space-1-5);
    border-radius: var(--radius-md);
    background: var(--line-strong);
    font-size: var(--text-xs);
  }

  .divider {
    width: var(--hairline);
    height: var(--space-4);
    margin: 0 var(--space-1);
    background: var(--line-strong);
  }

  .form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
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
