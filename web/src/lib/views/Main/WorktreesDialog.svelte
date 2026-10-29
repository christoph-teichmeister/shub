<script lang="ts">
  // The open project's worktrees, searchable, with a terminal or Claude in each; closing goes through `onconfirm`.
  import { untrack } from 'svelte';
  import type { ProjectView, StartSessionRequest, WorktreeInfo } from '../../../../../shared/api.ts';
  import Button from '../../components/Button/Button.svelte';
  import Dialog from '../../components/Dialog/Dialog.svelte';
  import StatusBadge from '../../components/StatusBadge/StatusBadge.svelte';
  import TextField from '../../components/TextField/TextField.svelte';
  import { api } from '../../stores/api.ts';
  import { app, loadChildren, sessionHref, startSession } from '../../stores/state.svelte.ts';
  import { toast, toastError } from '../../stores/toasts.svelte.ts';
  import type { Confirm } from './ConfirmDialog.svelte';

  interface Props {
    onconfirm: (confirm: Confirm) => void;
    onnewsession: (p: ProjectView, extra: Partial<StartSessionRequest>) => Promise<void>;
  }
  let { onconfirm, onnewsession }: Props = $props();

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
  export function open(project: ProjectView) {
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
        await onnewsession(p, { buttonId: button.id, input: w.path });
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
    onconfirm({
      title: `Close ${list.length} merged worktrees?`,
      body: `${list.map((w) => w.name).join(', ')}. With a /worktree-close button each gets its own session.`,
      action: 'Close all',
      danger: true,
      run: async () => {
        for (const w of list) await closeWorktree(w, false).catch(toastError);
        await loadWorktrees();
      },
    });
  }

  /** Also for a worktree row in the sidebar, with this dialog closed. */
  export function askClose(w: WorktreeInfo) {
    const p = app.projects.find((x) => x.id === w.projectId);
    if (!p) return;
    if (w.state === 'folder-gone') {
      onconfirm({
        title: `Prune ${p.name}?`,
        body: `${w.path} is gone; git forgets it and every other missing worktree of ${p.name}.`,
        action: 'Prune',
        run: () =>
          void api('worktreePrune', { body: { projectId: p.id } })
            .then(() => loadWorktrees())
            .catch(toastError),
      });
      return;
    }
    const button = closer(p);
    onconfirm({
      title: `Close ${w.name}?`,
      body: button
        ? `Starts claude with "/worktree-close ${w.path}" in ${p.path}.`
        : `Removes ${w.path}` +
          (!w.branch ? '.' : w.state === 'merged' ? ` and its branch ${w.branch}.` : `; branch ${w.branch} stays.`),
      action: 'Close',
      danger: !button,
      run: () =>
        void closeWorktree(w, true)
          .then(() => Promise.all([loadWorktrees(), loadChildren(true)]))
          .catch(toastError),
    });
  }
</script>

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
  .form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .grow {
    flex: 1 1 auto;
    min-width: 0;
  }

  .muted {
    color: var(--muted);
  }

  code {
    font-family: var(--font-mono);
    font-size: var(--text-md);
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
</style>
