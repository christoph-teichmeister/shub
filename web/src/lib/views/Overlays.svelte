<script lang="ts">
  // Overlays every signed-in screen shares: search (Alt K), approvals, the shortcut overview (Alt ?).
  import type { Approval, OldSession, ProjectView } from '../../../../shared/api.ts';
  import Button from '../components/Button/Button.svelte';
  import Dialog from '../components/Dialog/Dialog.svelte';
  import Icon from '../components/Icon/Icon.svelte';
  import Kbd from '../components/Kbd/Kbd.svelte';
  import ProjectIcon from '../components/ProjectIcon/ProjectIcon.svelte';
  import { api } from '../stores/api.ts';
  import { go } from '../stores/router.svelte.ts';
  import { app, loadApprovals, loadProjects, sessionHref, startSession, ui } from '../stores/state.svelte.ts';
  import { toast, toastError } from '../stores/toasts.svelte.ts';
  import { SHORTCUTS } from './shortcuts.ts';

  // ---------- search ----------
  let query = $state('');
  let cursor = $state(0);
  let oldByProject = $state<Record<string, OldSession[]>>({});
  let oldLoading = false;

  type Hit =
    | { kind: 'dormant' | 'pinned'; project: ProjectView }
    | { kind: 'old'; project: ProjectView; old: OldSession }
    | { kind: 'add' };

  const q = $derived(query.trim().toLowerCase());
  const matches = (p: ProjectView) =>
    !q || p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q) || p.group.toLowerCase().includes(q);

  const hits = $derived.by((): Hit[] => {
    const dormant = app.projects.filter((p) => p.visibility === 'dormant' && matches(p));
    const pinned = q ? app.projects.filter((p) => p.visibility === 'pinned' && matches(p)) : [];
    const old: Hit[] =
      q.length < 2
        ? []
        : app.projects.flatMap((p) =>
            (oldByProject[p.id] ?? [])
              .filter((o) => o.firstPrompt.toLowerCase().includes(q) || matches(p))
              .slice(0, 5)
              .map((o) => ({ kind: 'old' as const, project: p, old: o })),
          );
    return [
      ...dormant.map((p) => ({ kind: 'dormant' as const, project: p })),
      ...pinned.map((p) => ({ kind: 'pinned' as const, project: p })),
      ...old.slice(0, 20),
      // The sidebar has no + button any more: adding a project lives here.
      { kind: 'add' as const },
    ];
  });
  const GROUPS = [
    { kind: 'dormant', title: 'Dormant projects' },
    { kind: 'pinned', title: 'Pinned' },
    { kind: 'old', title: 'Old sessions' },
    { kind: 'add', title: 'New' },
  ] as const;

  // Old sessions are only fetched once a query is typed, one request per project, cached while open.
  $effect(() => {
    if (!ui.search || q.length < 2 || oldLoading) return;
    oldLoading = true;
    for (const p of app.projects)
      if (!(p.id in oldByProject))
        api<OldSession[]>('oldSessions', { params: { id: p.id } }).then(
          (list) => (oldByProject[p.id] = list),
          () => (oldByProject[p.id] = []),
        );
  });

  $effect(() => {
    if (!ui.search) {
      query = '';
      oldByProject = {};
      oldLoading = false;
    }
  });

  $effect(() => {
    void q;
    cursor = 0;
  });

  const close = () => (ui.search = false);

  async function pin(p: ProjectView) {
    await api('projectUpdate', { params: { id: p.id }, body: { visibility: 'pinned' } }).catch(toastError);
    await loadProjects();
    toast(`${p.name} is pinned in the sidebar`);
  }

  async function newSession(p: ProjectView) {
    close();
    const s = await startSession({ projectId: p.id, kind: 'claude' });
    if (s) location.hash = sessionHref(s);
  }

  async function resume(h: Extract<Hit, { kind: 'old' }>, takeOver = false) {
    close();
    const s = await startSession({
      projectId: h.project.id,
      kind: 'claude',
      name: h.old.firstPrompt.slice(0, 40),
      resumeClaudeSessionId: h.old.claudeSessionId,
      fork: !!h.old.host && !takeOver,
      takeOver,
    });
    if (s) location.hash = sessionHref(s);
  }

  function open(h: Hit) {
    if (h.kind === 'old') return h.old.resumable === false ? undefined : void resume(h);
    close();
    if (h.kind === 'add') go('settings', 'project', 'new');
    else go('p', h.project.id);
  }

  function onSearchKey(e: KeyboardEvent) {
    const h = hits[cursor];
    if (e.key === 'ArrowDown') cursor = Math.min(cursor + 1, hits.length - 1);
    else if (e.key === 'ArrowUp') cursor = Math.max(cursor - 1, 0);
    else if (e.key === 'Enter' && e.altKey && h && h.kind !== 'add') void newSession(h.project);
    else if (e.key === 'Enter' && h) open(h);
    else if (e.altKey && e.code === 'KeyP' && h && h.kind !== 'add') void pin(h.project);
    else return;
    e.preventDefault();
    document.getElementById(`hit-${cursor}`)?.scrollIntoView({ block: 'nearest' });
  }

  // ---------- approvals ----------
  let later = $state<string[]>([]);
  const pending = $derived(app.approvals.filter((a) => a.state === 'pending'));
  const approval = $derived<Approval | null>(pending.find((a) => !later.includes(a.id)) ?? null);
  const asker = $derived.by(() => {
    const id = approval?.requestedBy.replace(/^session:/, '');
    return app.sessions.find((s) => s.id === id) ?? null;
  });
  const approvalProject = $derived(app.projects.find((p) => p.id === approval?.projectId) ?? null);
  const ACTIONS: Record<Approval['action'], string> = {
    'session.start': 'wants to start a new session',
    'buttons.write': 'wants to change project buttons',
    'projects.write': 'wants to change projects',
  };
  const who = (a: Approval) =>
    a.requestedBy.startsWith('plugin:')
      ? `Plugin ${a.requestedBy.slice(7)}`
      : a.requestedBy === 'global-claude' || a.requestedBy === 'session:global'
        ? 'The global Claude'
        : 'A session';

  async function decide(a: Approval, approve: boolean) {
    const res = await api<Approval>('approvalDecide', { params: { id: a.id }, body: { approve } }).catch(toastError);
    if (!res) return;
    const i = app.approvals.findIndex((x) => x.id === a.id);
    if (i >= 0) app.approvals[i] = res;
    else void loadApprovals();
    toast(approve ? 'Approved' : 'Rejected');
  }
</script>

<Dialog open={ui.search} title="Search projects and sessions" onclose={close}>
  <div class="search">
    <div class="input">
      <Icon name="search" />
      <label class="visually-hidden" for="search-q">Search</label>
      <!-- svelte-ignore a11y_autofocus -->
      <input
        id="search-q"
        type="search"
        bind:value={query}
        placeholder="Project, folder or what you asked"
        autocomplete="off"
        autofocus
        role="combobox"
        aria-expanded="true"
        aria-controls="search-results"
        aria-activedescendant={hits.length ? `hit-${cursor}` : undefined}
        onkeydown={onSearchKey}
      />
      <Kbd keys="Esc" />
    </div>
    <div id="search-results" class="results" role="listbox" aria-label="Results">
      {#if hits.length === 1}<p class="empty">{q ? 'Nothing found' : 'No dormant projects. Type to search.'}</p>{/if}
      {#each GROUPS as g (g.kind)}
        {@const list = hits.map((h, i) => ({ h, i })).filter((x) => x.h.kind === g.kind)}
        {#if list.length}
          <div class="group" role="presentation">{g.title}</div>
          {#each list as { h, i } (i)}
            <div
              id="hit-{i}"
              class="hit"
              class:active={i === cursor}
              role="option"
              tabindex="-1"
              aria-selected={i === cursor}
              onpointermove={() => (cursor = i)}
              onclick={(e) => (e.target as HTMLElement).closest('button') || open(h)}
              onkeydown={() => {}}
            >
              {#if h.kind === 'add'}
                <span class="tile" aria-hidden="true"><Icon name="plus" /></span>
                <span class="text">
                  <span class="name">Add a project</span>
                  <span class="sub">Pick a folder on this machine</span>
                </span>
              {:else if h.kind === 'old'}
                <span class="tile" aria-hidden="true"><Icon name="message" /></span>
                <span class="text" class:dimmed={h.old.resumable === false}>
                  <span class="name"
                    >"{h.old.firstPrompt.slice(0, 80)}" <span class="muted">in {h.project.name}</span></span
                  >
                  <span class="sub"
                    >{h.old.lastAt.slice(0, 10)} · {h.old.host
                      ? `from ${h.old.host}${h.old.running ? ', running there' : ''}${h.old.resumable === false ? ', not on this machine yet' : ''}`
                      : `${h.old.turns} turns`}</span
                  >
                </span>
                <Button size="sm" disabled={h.old.resumable === false} onclick={() => resume(h)}
                  >{h.old.host ? 'Fork' : 'Resume'}</Button
                >
                {#if h.old.host}
                  <Button
                    size="sm"
                    title="Moves the conversation here and stops it on {h.old.host}"
                    disabled={h.old.resumable === false}
                    onclick={() => resume(h, true)}>Take over</Button
                  >
                {/if}
              {:else}
                <ProjectIcon icon={h.project.resolvedIcon} name={h.project.name} />
                <span class="text">
                  <span class="name">{h.project.name}</span>
                  <span class="sub">{h.project.path} · {h.project.group}</span>
                </span>
                {#if h.kind === 'dormant'}
                  <Button size="sm" onclick={() => pin(h.project)}>Pin to sidebar</Button>
                {/if}
                <Button size="sm" variant={i === cursor ? 'primary' : 'secondary'} onclick={() => newSession(h.project)}
                  >New session</Button
                >
              {/if}
            </div>
          {/each}
        {/if}
      {/each}
    </div>
    <div class="keys">
      <span><Kbd keys="↑↓" /> move</span>
      <span><Kbd keys="Enter" /> open</span>
      <span><Kbd keys="Alt Enter" /> new session</span>
      <span><Kbd keys="Alt P" /> pin</span>
    </div>
  </div>
</Dialog>

<Dialog
  open={!!approval}
  tone="needs-you"
  title={approval ? `${who(approval)} ${ACTIONS[approval.action] ?? 'asks you'}` : ''}
  description={approval?.summary}
  onclose={() => approval && later.push(approval.id)}
>
  {#if approval}
    <dl class="facts">
      <dt>Asked by</dt>
      <dd>
        {asker
          ? `${app.projects.find((p) => p.id === asker.projectId)?.name ?? 'Global'} · ${asker.name}`
          : approval.requestedBy}
      </dd>
      <dt>Project</dt>
      <dd>{approvalProject?.name ?? (approval.projectId ? approval.projectId : 'Global Claude')}</dd>
      {#if approvalProject}
        <dt>Folder</dt>
        <dd class="mono">{approvalProject.path}</dd>
      {/if}
    </dl>
    <div class="prompt">
      <span class="label">{approval.action === 'session.start' ? 'Full prompt' : 'Change'}</span>
      <pre>{approval.detail}</pre>
      <span class="muted">shub can't tell where a prompt came from. Read it before you start it.</span>
    </div>
    <p class="note">
      These rules only cover requests through shub. Shell commands a session runs (e.g. <code>claude -p</code>,
      <code>tmux send-keys</code>) are guarded by Claude Code's own permission prompts, so keep risky sessions like
      reviews out of modes that skip them.
    </p>
    {#if pending.length > 1}<p class="note">{pending.length} approvals are waiting.</p>{/if}
  {/if}
  {#snippet actions()}
    {#if approval}
      {#if asker}
        <a class="asker" href={sessionHref(asker)} onclick={() => later.push(approval.id)}>Open the asking session</a>
      {/if}
      <Button variant="danger" onclick={() => decide(approval, false)}>Reject</Button>
      <Button onclick={() => decide(approval, true)}>{approval.action === 'session.start' ? 'Start' : 'Apply'}</Button>
    {/if}
  {/snippet}
</Dialog>

<Dialog
  open={ui.shortcuts}
  title="Shortcuts"
  description="Almost all on Alt (the village keys work on its map), so they never clash with Claude Code or the shell (Ctrl K, Ctrl J, Ctrl C stay theirs)."
  onclose={() => (ui.shortcuts = false)}
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
  .search {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .input {
    display: flex;
    align-items: center;
    gap: var(--space-2-5);
    height: var(--size-control-lg);
    padding: 0 var(--space-3);
    border: var(--hairline) solid var(--line-strong);
    border-radius: var(--radius-md);
    background: var(--bg);
    color: var(--muted);
  }

  .input input {
    flex: 1 1 auto;
    min-width: 0;
    height: 100%;
    border: 0;
    background: transparent;
    color: var(--fg);
    outline: none;
  }

  .input:focus-within {
    outline: var(--ring) solid var(--primary);
    outline-offset: var(--ring);
  }

  .results {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    max-height: 50vh;
    overflow-y: auto;
  }

  .group {
    padding: var(--space-2) var(--space-2) var(--space-1);
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--muted);
  }

  .dimmed {
    opacity: 0.5;
  }

  .hit {
    display: flex;
    align-items: center;
    gap: var(--space-2-5);
    padding: var(--space-2);
    border-radius: var(--radius-md);
    cursor: pointer;
  }

  .hit.active {
    background: var(--raised);
  }

  .text {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .name,
  .sub {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sub,
  .muted {
    font-size: var(--text-sm);
    color: var(--muted);
  }

  .hit.active .sub,
  .hit.active .muted {
    color: var(--fg-2);
  }

  .tile {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--size-tile);
    height: var(--size-tile);
    color: var(--muted);
  }

  .empty {
    margin: 0;
    padding: var(--space-3) var(--space-2);
    color: var(--muted);
  }

  .keys {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
    font-size: var(--text-sm);
    color: var(--muted);
  }

  .facts {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--space-1-5) var(--space-4);
    margin: 0;
  }

  .facts dt {
    color: var(--muted);
  }

  .facts dd {
    margin: 0;
  }

  .mono,
  pre,
  code {
    font-family: var(--font-mono);
  }

  .prompt {
    display: flex;
    flex-direction: column;
    gap: var(--space-1-5);
  }

  .label {
    font-weight: var(--weight-medium);
  }

  pre {
    max-height: 40vh;
    margin: 0;
    padding: var(--space-3) var(--space-3-5);
    overflow: auto;
    border: var(--hairline) solid var(--line);
    border-radius: var(--radius-md);
    background: var(--bg);
    font-size: var(--text-md);
    line-height: var(--leading-term);
    color: var(--fg-2);
    white-space: pre-wrap;
  }

  .note {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--muted);
  }

  .asker {
    margin-right: auto;
    align-self: center;
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
