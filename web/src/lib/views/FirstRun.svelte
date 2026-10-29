<script lang="ts">
  import type { ImportCandidate, ResolvedIcon, Visibility } from '../../../../shared/api.ts';
  import Button from '../components/Button/Button.svelte';
  import Checkbox from '../components/Checkbox/Checkbox.svelte';
  import ProjectIcon from '../components/ProjectIcon/ProjectIcon.svelte';
  import SelectField from '../components/SelectField/SelectField.svelte';
  import TextField from '../components/TextField/TextField.svelte';
  import Wordmark from '../components/Wordmark/Wordmark.svelte';
  import { api } from '../stores/api.ts';
  import { go, href } from '../stores/router.svelte.ts';
  import { app, loadProjects } from '../stores/state.svelte.ts';
  import { toast, toastError } from '../stores/toasts.svelte.ts';
  import { ago } from '../format.ts';

  /** True when shub has no projects yet (shown instead of the main view); false for "Import projects again". */
  let { firstRun = false }: { firstRun?: boolean } = $props();

  type Candidate = ImportCandidate & { resolvedIcon: ResolvedIcon };
  interface Row extends Candidate {
    add: boolean;
    group: string;
    /** Typing a group that is not in the list yet. */
    newGroup: boolean;
    visibility: Visibility;
  }

  let rows = $state<Row[] | null>(null);
  let error = $state('');
  let adding = $state(false);
  const defaultGroup = app.config?.groups[0] ?? 'Projects';
  const NEW_GROUP = '\0new';
  const groupOptions = $derived([
    ...[
      ...new Set([
        defaultGroup,
        ...(app.config?.groups ?? []),
        ...app.projects.map((p) => p.group),
        ...(rows ?? []).filter((r) => !r.newGroup).map((r) => r.group),
      ]),
    ]
      .filter(Boolean)
      .map((g) => ({ value: g, label: g })),
    { value: NEW_GROUP, label: 'New group…' },
  ]);
  const count = $derived(rows?.filter((r) => r.add).length ?? 0);

  api<Candidate[]>('importCandidates').then(
    (list) =>
      (rows = list.map((c) => ({
        ...c,
        add: c.resolvedIcon.kind !== 'none' || c.sessions >= 5,
        group: defaultGroup,
        newGroup: false,
        visibility: c.suggested,
      }))),
    (err: unknown) => (error = err instanceof Error ? err.message : String(err)),
  );

  async function addAll() {
    adding = true;
    let added = 0;
    for (const r of rows ?? []) {
      if (!r.add) continue;
      const ok = await api('projectCreate', {
        body: { name: r.name, path: r.path, group: r.group.trim() || defaultGroup, visibility: r.visibility },
      }).then(() => true, toastError);
      if (ok) added++;
    }
    adding = false;
    await loadProjects();
    toast(`Added ${added} ${added === 1 ? 'project' : 'projects'}`);
    go();
  }
</script>

<div class="page">
  <div class="content">
    {#if firstRun}<Wordmark size="lg" tagline />{:else}<a class="back" href={href('settings')}>← Settings</a>{/if}
    <h1>Pick your projects</h1>
    <p class="muted">
      Found in your Claude history (~/.claude/projects). Worktree folders are merged into their main project; icons come
      from the git remote. Unticked ones are not added; you can add them later.
    </p>

    {#if error}
      <p class="muted" role="alert">Could not read your Claude history: {error}</p>
    {:else if !rows}
      <p class="muted">Looking through ~/.claude/projects…</p>
    {:else if !rows.length}
      <p class="muted">No new folders found. Add one by hand.</p>
    {:else}
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col"><span class="visually-hidden">Add</span></th>
              <th scope="col">Folder</th>
              <th scope="col" class="num">Sessions</th>
              <th scope="col">Last used</th>
              <th scope="col">Add as</th>
            </tr>
          </thead>
          <tbody>
            {#each rows as r (r.path)}
              <tr class:off={!r.add}>
                <td><Checkbox label="Add {r.name}" hideLabel bind:checked={r.add} /></td>
                <td>
                  <span class="folder">
                    <ProjectIcon icon={r.resolvedIcon} name={r.name} />
                    <span class="stack">
                      <span class="name">{r.name}</span>
                      <span class="path">{r.path}{r.resolvedIcon.kind === 'none' ? ' · no git remote' : ''}</span>
                    </span>
                  </span>
                </td>
                <td class="num">{r.sessions}</td>
                <td>{ago(r.lastUsedAt)}</td>
                <td>
                  {#if r.add}
                    <span class="as">
                      {#if r.newGroup}
                        <!-- Back to the list once typed, so other rows can pick the new group too. -->
                        <TextField
                          label="New group for {r.name}"
                          hideLabel
                          placeholder="New group name"
                          bind:value={r.group}
                          onchange={() => (r.newGroup = !r.group.trim())}
                        />
                      {:else}
                        <SelectField
                          label="Group for {r.name}"
                          hideLabel
                          value={r.group}
                          options={groupOptions}
                          onchange={(e) => {
                            r.newGroup = e.currentTarget.value === NEW_GROUP;
                            r.group = r.newGroup ? '' : e.currentTarget.value;
                          }}
                        />
                      {/if}
                      <SelectField
                        label="Visibility for {r.name}"
                        hideLabel
                        bind:value={r.visibility}
                        options={[
                          { value: 'pinned', label: 'pinned' },
                          { value: 'dormant', label: 'dormant' },
                        ]}
                      />
                    </span>
                  {:else}<span class="muted">not added</span>{/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <p class="muted small">Rule of thumb: used in the last 2 weeks → pinned, older → dormant.</p>
    {/if}

    <div class="actions">
      <Button variant="ghost" onclick={() => go('settings', 'project', 'new')}>Add a folder by hand</Button>
      <span class="grow"></span>
      {#if !firstRun}<Button variant="ghost" onclick={() => go('settings')}>Cancel</Button>{/if}
      <Button variant="primary" disabled={!count || adding} onclick={addAll}
        >Add {count} {count === 1 ? 'project' : 'projects'}</Button
      >
    </div>
  </div>
</div>

<style>
  .page {
    min-height: 100%;
    padding: var(--space-8) var(--space-4) var(--space-12);
    background: var(--bg);
  }

  .content {
    max-width: var(--size-page-wide);
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .back {
    font-size: var(--text-md);
    text-decoration: none;
  }

  h1 {
    margin: 0;
    font-size: var(--text-xl);
    font-weight: var(--weight-semibold);
  }

  .muted {
    margin: 0;
    color: var(--muted);
  }

  .small {
    font-size: var(--text-sm);
  }

  .table-wrap {
    overflow-x: auto;
    border: var(--hairline) solid var(--line);
    border-radius: var(--radius-lg);
  }

  table {
    width: 100%;
    border-collapse: collapse;
  }

  th,
  td {
    padding: var(--space-2) var(--space-3);
    border-top: var(--hairline) solid var(--line);
    text-align: left;
    vertical-align: middle;
  }

  thead th {
    border-top: 0;
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--muted);
  }

  .num {
    text-align: right;
  }

  .folder {
    display: flex;
    align-items: center;
    gap: var(--space-2-5);
  }

  .stack {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .name {
    font-weight: var(--weight-medium);
  }

  .off .name,
  .off .num {
    color: var(--muted);
  }

  .path {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--muted);
  }

  .as {
    display: flex;
    gap: var(--space-2);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .grow {
    flex: 1 1 auto;
  }
</style>
