<script lang="ts">
  import type {
    ButtonAsk,
    ButtonDef,
    PermissionMode,
    ProjectIcon as ProjectIconDef,
    ResolvedIcon,
    SkillInfo,
    Visibility,
  } from '../../../../shared/api.ts';
  import Button from '../components/Button/Button.svelte';
  import Checkbox from '../components/Checkbox/Checkbox.svelte';
  import ChoiceButton from '../components/ChoiceButton/ChoiceButton.svelte';
  import Dialog from '../components/Dialog/Dialog.svelte';
  import Icon from '../components/Icon/Icon.svelte';
  import type { IconName } from '../components/Icon/icons.ts';
  import IconButton from '../components/IconButton/IconButton.svelte';
  import ProjectIcon from '../components/ProjectIcon/ProjectIcon.svelte';
  import Section from '../components/Section/Section.svelte';
  import SelectField from '../components/SelectField/SelectField.svelte';
  import TextField from '../components/TextField/TextField.svelte';
  import { api } from '../stores/api.ts';
  import { go, href } from '../stores/router.svelte.ts';
  import { app, loadProjects } from '../stores/state.svelte.ts';
  import { toast, toastError } from '../stores/toasts.svelte.ts';
  import { PROJECT_COLORS } from '../tokens/tokens.ts';

  /** Project id, or "new" to add a folder by hand. */
  let { id }: { id: string } = $props();

  const isNew = $derived(id === 'new');
  const existing = $derived(app.projects.find((p) => p.id === id) ?? null);

  const SYMBOLS: IconName[] = ['home', 'book', 'board', 'terminal', 'code', 'table', 'folder', 'database'];
  const ASKS: { value: ButtonAsk; label: string }[] = [
    { value: 'nothing', label: 'Nothing' },
    { value: 'text', label: 'Text' },
    { value: 'number', label: 'Number' },
    { value: 'pick-worktree', label: 'Pick worktree' },
  ];
  const MODES: { value: PermissionMode | 'locked'; label: string }[] = [
    { value: 'default', label: 'Default' },
    { value: 'acceptEdits', label: 'Accept edits' },
    { value: 'plan', label: 'Plan' },
    { value: 'auto', label: 'Auto' },
    { value: 'bypassPermissions', label: 'Bypass permissions' },
    { value: 'locked', label: 'Locked to default' },
  ];
  const SCOPES: { scope: SkillInfo['scope'] | 'missing'; title: string }[] = [
    { scope: 'project', title: 'Project skills · .claude/skills in this repo' },
    { scope: 'global', title: 'Global skills · ~/.claude/skills' },
    { scope: 'plugin', title: 'Plugin skills' },
    { scope: 'missing', title: 'Buttons whose skill is gone' },
  ];

  let name = $state('');
  let group = $state('');
  let path = $state('');
  /** What is typed in the folder field; it becomes `path` (and saves) on blur or Enter, never half-typed. */
  let pathDraft = $state('');
  let visibility = $state<Visibility>('pinned');
  let icon = $state<ProjectIconDef>({ kind: 'auto' });
  let buttons = $state<ButtonDef[]>([]);
  let loadedFor = $state<string | null>(null);
  let skills = $state<SkillInfo[] | null>(null);
  let skillsError = $state('');
  let removing = $state(false);
  let saving = $state(false);
  let fileInput = $state<HTMLInputElement>();
  let form = $state<HTMLFormElement>();
  /** JSON of what the server has, so autosave only sends real changes. */
  let savedJson = '';
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  /** The control changed last; it flashes green once its change is saved. */
  let touched: Element | null = null;

  // Fill the form once per project (not on every projects reload, which would drop edits).
  $effect(() => {
    if (loadedFor === id) return;
    if (isNew) {
      name = path = pathDraft = '';
      group = app.config?.groups[0] ?? 'Projects';
      visibility = 'pinned';
      icon = { kind: 'auto' };
      buttons = [];
      loadedFor = id;
    } else if (existing) {
      savedJson = '';
      ({ name, group, path, visibility } = existing);
      pathDraft = path;
      icon = structuredClone($state.snapshot(existing.icon));
      buttons = structuredClone($state.snapshot(existing.buttons));
      loadedFor = id;
    }
  });

  $effect(() => {
    if (isNew) return;
    skills = null;
    skillsError = '';
    api<SkillInfo[]>('skills', { params: { id } }).then(
      (list) => (skills = list),
      (err: unknown) => (skillsError = err instanceof Error ? err.message : String(err)),
    );
  });

  const groups = $derived([...new Set([...(app.config?.groups ?? []), ...app.projects.map((p) => p.group)])]);
  const detected = $derived<ResolvedIcon | null>(existing?.icon.kind === 'auto' ? existing.resolvedIcon : null);
  const preview = $derived<ResolvedIcon>(
    icon.kind === 'auto' ? (detected ?? { kind: 'none' }) : icon.kind === 'symbol' ? { ...icon } : { ...icon },
  );

  const skillCommand = (s: { name: string }) => `/${s.name}`;
  const label = (skill: string) => {
    const words = skill.replace(/^.*:/, '').replace(/[-_]+/g, ' ');
    return words.charAt(0).toUpperCase() + words.slice(1);
  };

  /** Discovered skills plus buttons whose skill was not found (so they are not dropped silently). */
  const skillRows = $derived.by(() => {
    const list: { name: string; description: string; scope: SkillInfo['scope'] | 'missing' }[] = [...(skills ?? [])];
    for (const b of buttons)
      if (b.skill && skills && !skills.some((s) => skillCommand(s) === b.skill))
        list.push({ name: b.skill.slice(1), description: '', scope: 'missing' });
    return list;
  });
  const promptButtons = $derived(buttons.filter((b) => !b.skill));
  const buttonFor = (s: { name: string }) => buttons.find((b) => b.skill === skillCommand(s));

  function toggleSkill(s: { name: string }, on: boolean) {
    if (!on) {
      buttons = buttons.filter((b) => b.skill !== skillCommand(s));
      return;
    }
    let bid = s.name.replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
    while (buttons.some((b) => b.id === bid)) bid += '-2';
    buttons.push({ id: bid, label: label(s.name), skill: skillCommand(s), ask: 'nothing', confirm: false });
  }

  function addPromptButton() {
    let n = 1;
    while (buttons.some((b) => b.id === `prompt-${n}`)) n++;
    buttons.push({ id: `prompt-${n}`, label: '', prompt: '', ask: 'nothing', confirm: false });
  }

  const modeOf = (b: ButtonDef) => (b.lockDefaultMode ? 'locked' : (b.permissionMode ?? 'default'));
  function setMode(b: ButtonDef, v: string) {
    b.lockDefaultMode = v === 'locked' || undefined;
    b.permissionMode = v === 'locked' || v === 'default' ? undefined : (v as PermissionMode);
  }

  function pickSymbol(symbol: string) {
    icon = { kind: 'symbol', symbol, color: icon.kind === 'symbol' ? icon.color : PROJECT_COLORS[0].value };
  }
  function pickColor(color: string) {
    icon = { kind: 'symbol', symbol: icon.kind === 'symbol' ? icon.symbol : 'home', color };
  }

  /** The image goes into the config as a small data URL (`icon.path`, max 4096 chars on the server). */
  async function upload(file: File) {
    const bitmap = await createImageBitmap(file);
    for (const size of [64, 40, 24]) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const scale = Math.max(size / bitmap.width, size / bitmap.height);
      const w = bitmap.width * scale;
      const h = bitmap.height * scale;
      canvas.getContext('2d')!.drawImage(bitmap, (size - w) / 2, (size - h) / 2, w, h);
      const url = canvas.toDataURL('image/webp', 0.8);
      if (url.length <= 4096) {
        icon = { kind: 'image', path: url };
        return;
      }
    }
    toast('That image is too detailed for an icon; try a simpler one', 'error');
  }

  /** Folder picker over GET /api/folders: the folders live on the shub machine, the dialog runs on this device. */
  let browsing = $state<{ path: string; parent: string | null; folders: string[] } | null>(null);
  async function browse(at = pathDraft.trim()) {
    const res = await api<NonNullable<typeof browsing>>('folders', at ? { query: { path: at } } : {}).catch(() =>
      at ? api<NonNullable<typeof browsing>>('folders') : null,
    );
    if (res) browsing = res;
    else toast('Could not list folders', 'error');
  }
  function useFolder(folder: string) {
    path = pathDraft = folder;
    if (isNew && !name.trim()) name = folder.split('/').pop() ?? '';
    browsing = null;
  }

  const bodyOf = () => ({
    name: name.trim(),
    group: group.trim() || 'Projects',
    path: path.trim(),
    visibility,
    icon: $state.snapshot(icon),
    buttons: $state.snapshot(buttons).map((b) => ({ ...b, label: b.label.trim() || label(b.skill ?? 'Prompt') })),
  });

  // Existing projects save themselves: every valid change goes to the server after a short pause (typing stays smooth).
  // The timer is not cleared on unmount, so a change made just before leaving the page still lands.
  $effect(() => {
    if (isNew || loadedFor !== id) return;
    const json = JSON.stringify(bodyOf());
    if (!savedJson) savedJson = json;
    clearTimeout(saveTimer);
    if (json === savedJson || !form?.checkValidity()) return;
    const target = id;
    const control = touched;
    saveTimer = setTimeout(() => void autosave(target, json, control), 600);
  });

  function flash(el: Element | null) {
    if (!el?.isConnected || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const green = getComputedStyle(el).getPropertyValue('--status-your-turn');
    el.animate([{ boxShadow: `0 0 0 3px ${green}` }, { boxShadow: '0 0 0 3px transparent' }], 800);
  }

  async function autosave(target: string, json: string, control: Element | null) {
    saving = true;
    const res = await api<{ approval?: unknown }>('projectUpdate', {
      params: { id: target },
      body: JSON.parse(json),
    }).catch(toastError);
    saving = false;
    if (!res) return;
    savedJson = json;
    if (res.approval) toast('Waiting for your approval', 'needs-you');
    else {
      toast('Saved', 'neutral', 1500);
      flash(control);
    }
    await loadProjects();
  }

  async function create(e: SubmitEvent) {
    e.preventDefault();
    saving = true;
    const body = bodyOf();
    const res = await api<{ id?: string; approval?: unknown }>('projectCreate', { body }).catch(toastError);
    saving = false;
    if (!res) return;
    await loadProjects();
    if (res.approval) toast('Waiting for your approval', 'needs-you');
    else toast(`Added ${body.name}`);
    go('p', res.id ?? id);
  }

  async function remove() {
    removing = false;
    const ok = await api('projectDelete', { params: { id } }).then(() => true, toastError);
    if (!ok) return;
    await loadProjects();
    toast(`Removed ${name} from the hub`);
    go();
  }
</script>

<div class="page">
  <form
    class="content"
    bind:this={form}
    onsubmit={create}
    oninputcapture={(e) => (touched = e.target as Element)}
    onchangecapture={(e) => (touched = e.target as Element)}
    onclickcapture={(e) => (touched = (e.target as Element).closest('button, input, select'))}
  >
    <a class="back" href={isNew ? href() : href('p', id)}>← {isNew ? 'Back' : (existing?.name ?? 'Back')}</a>
    <h1>{isNew ? 'Add a project' : 'Project settings'}</h1>

    {#if !isNew && !existing && app.ready}
      <p class="muted">No project with the id {id}.</p>
    {:else}
      <div class="grid">
        <TextField label="Name" bind:value={name} required autocomplete="off" />
        <TextField label="Group" bind:value={group} list="groups" required autocomplete="off" />
        <datalist id="groups"
          >{#each groups as g (g)}<option value={g}></option>{/each}</datalist
        >
        <div class="span folder">
          <div class="grow">
            <TextField
              label="Folder (sessions start here)"
              bind:value={pathDraft}
              onchange={() => (path = pathDraft)}
              required
              mono
              autocomplete="off"
            />
          </div>
          <Button icon="folder" onclick={() => browse()}>Browse…</Button>
        </div>
      </div>

      <Section title="Icon">
        <div class="row">
          <ChoiceButton shape="card" pressed={icon.kind === 'auto'} onclick={() => (icon = { kind: 'auto' })}>
            <ProjectIcon icon={detected ?? { kind: 'none' }} name={name || '?'} size="lg" />
            <span class="stack">
              <span class="strong"
                >Auto{detected?.kind === 'github' ? ': GitHub' : detected?.kind === 'gitlab' ? ': GitLab' : ''}</span
              >
              <span class="muted small"
                >{detected?.host ? `from git remote ${detected.host}` : 'from the git remote, if there is one'}</span
              >
            </span>
          </ChoiceButton>
          <ChoiceButton shape="card" pressed={icon.kind === 'image'} onclick={() => fileInput?.click()}>
            {#if icon.kind === 'image'}<ProjectIcon icon={preview} {name} size="lg" />{:else}<span
                class="upload"
                aria-hidden="true"><Icon name="upload" /></span
              >{/if}
            Upload image
          </ChoiceButton>
          <input
            bind:this={fileInput}
            class="visually-hidden"
            type="file"
            accept="image/*"
            tabindex="-1"
            aria-label="Icon image"
            onchange={(e) => {
              const f = e.currentTarget.files?.[0];
              if (f) void upload(f).catch(toastError);
              e.currentTarget.value = '';
            }}
          />
        </div>
        <TextField
          label="Or an image URL"
          type="url"
          placeholder="https://…"
          mono
          autocomplete="off"
          value={icon.kind === 'image' && icon.path.startsWith('https://') ? icon.path : ''}
          onchange={(e) => {
            const url = e.currentTarget.value.trim();
            icon = url ? { kind: 'image', path: url } : { kind: 'auto' };
          }}
        />
        <span class="muted small">Or pick a symbol and colour:</span>
        <div class="row">
          <div class="row tight" role="group" aria-label="Symbol">
            {#each SYMBOLS as s (s)}
              <ChoiceButton
                shape="square"
                aria-label="{s} symbol"
                pressed={icon.kind === 'symbol' && icon.symbol === s}
                onclick={() => pickSymbol(s)}><Icon name={s} /></ChoiceButton
              >
            {/each}
          </div>
          <div class="row tight" role="group" aria-label="Colour">
            {#each PROJECT_COLORS as c (c.value)}
              <ChoiceButton
                shape="swatch"
                swatch={c.value}
                aria-label={c.name}
                pressed={icon.kind === 'symbol' && icon.color === c.value}
                onclick={() => pickColor(c.value)}
              />
            {/each}
          </div>
          {#if icon.kind === 'symbol'}<ProjectIcon icon={preview} {name} size="lg" />{/if}
        </div>
      </Section>

      <Section title="Visibility">
        <div class="row tight" role="group" aria-label="Visibility">
          <ChoiceButton pressed={visibility === 'pinned'} onclick={() => (visibility = 'pinned')}
            >Pinned in sidebar</ChoiceButton
          >
          <ChoiceButton pressed={visibility === 'dormant'} onclick={() => (visibility = 'dormant')}
            >Dormant (search only)</ChoiceButton
          >
        </div>
      </Section>

      {#if !isNew}
        <Section
          title="Buttons from skills"
          description="Found automatically. Tick a skill to show it as a button in this project."
        >
          {#if skillsError}
            <p class="muted">Could not read the skills: {skillsError}</p>
          {:else if !skills}
            <p class="muted">Looking for skills…</p>
          {:else}
            <details class="skills">
              <summary
                >{skillRows.length} skills, {skillRows.filter((s) => buttonFor(s)).length} shown as buttons</summary
              >
              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col"><span class="visually-hidden">Show as button</span></th>
                      <th scope="col">Skill</th>
                      <th scope="col">Asks for</th>
                      <th scope="col">Confirm</th>
                      <th scope="col">Permission mode</th>
                    </tr>
                  </thead>
                  {#each SCOPES as sc (sc.scope)}
                    {@const rows = skillRows.filter((s) => s.scope === sc.scope)}
                    {#if rows.length}
                      <tbody>
                        <tr><th class="group" colspan="5" scope="colgroup">{sc.title}</th></tr>
                        {#each rows as s (s.name)}
                          {@const b = buttonFor(s)}
                          <tr>
                            <td>
                              <Checkbox
                                label="Show {s.name} as button"
                                hideLabel
                                checked={!!b}
                                onchange={(e) => toggleSkill(s, e.currentTarget.checked)}
                              />
                            </td>
                            <td>
                              <span class="stack">
                                <code>/{s.name}</code>
                                {#if s.description}<span class="muted small">{s.description}</span>{/if}
                              </span>
                            </td>
                            {#if b}
                              <td>
                                <SelectField
                                  label="{s.name} asks for"
                                  hideLabel
                                  size="sm"
                                  bind:value={b.ask}
                                  options={ASKS}
                                />
                              </td>
                              <td><Checkbox label="Confirm {s.name}" hideLabel bind:checked={b.confirm} /></td>
                              <td>
                                <SelectField
                                  label="Permission mode for {s.name}"
                                  hideLabel
                                  size="sm"
                                  bind:value={() => modeOf(b), (v) => setMode(b, v)}
                                  options={MODES}
                                />
                              </td>
                            {:else}
                              <td class="muted">–</td>
                              <td class="muted">–</td>
                              <td class="muted">–</td>
                            {/if}
                          </tr>
                        {/each}
                      </tbody>
                    {/if}
                  {/each}
                </table>
              </div>
            </details>
            {#if !skillRows.length}<p class="muted">No skills found in this project or in ~/.claude/skills.</p>{/if}
          {/if}

          {#each promptButtons as b (b.id)}
            <div class="prompt">
              <div class="grid">
                <TextField label="Button label" bind:value={b.label} required />
                <div class="row tight end">
                  <SelectField label="Asks for" size="sm" bind:value={b.ask} options={ASKS} />
                  <SelectField
                    label="Permission mode"
                    size="sm"
                    bind:value={() => modeOf(b), (v) => setMode(b, v)}
                    options={MODES}
                  />
                  <Checkbox label="Confirm" bind:checked={b.confirm} />
                  <IconButton
                    label="Remove {b.label || 'this button'}"
                    icon="close"
                    tone="muted"
                    onclick={() => (buttons = buttons.filter((x) => x.id !== b.id))}
                  />
                </div>
                <div class="span">
                  <TextField
                    label="Prompt"
                    rows={3}
                    bind:value={() => b.prompt ?? '', (v) => (b.prompt = v)}
                    required
                    hint={'{input} is replaced with what the button asks for.'}
                  />
                </div>
              </div>
            </div>
          {/each}
          <div class="row">
            <Button variant="dashed" icon="plus" onclick={addPromptButton}>Own prompt button</Button>
          </div>
          <p class="muted small">Your choices are saved in ~/.config/shub (versioned in your dotfiles).</p>
        </Section>
      {/if}

      <div class="foot">
        {#if !isNew}
          <div class="stack start">
            <Button variant="danger" onclick={() => (removing = true)}>Remove from hub</Button>
            <span class="muted small">The folder and its sessions stay untouched.</span>
          </div>
        {/if}
        <span class="grow"></span>
        {#if isNew}
          <Button variant="ghost" onclick={() => history.back()}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={saving}>Add project</Button>
        {:else}
          <span class="muted small" role="status">{saving ? 'Saving…' : 'Changes save automatically'}</span>
        {/if}
      </div>
    {/if}
  </form>
</div>

<Dialog open={browsing !== null} title="Pick a folder" description={browsing?.path} onclose={() => (browsing = null)}>
  <ul class="folders">
    {#if browsing?.parent}<li>
        <button type="button" onclick={() => browse(browsing!.parent!)}><Icon name="folder" /> ..</button>
      </li>{/if}
    {#each browsing?.folders ?? [] as f (f)}<li>
        <button type="button" onclick={() => browse(`${browsing!.path === '/' ? '' : browsing!.path}/${f}`)}
          ><Icon name="folder" /> {f}</button
        >
      </li>{:else}<li class="muted small">No subfolders</li>{/each}
  </ul>
  {#snippet actions()}
    <Button variant="ghost" onclick={() => (browsing = null)}>Cancel</Button>
    <Button variant="primary" onclick={() => useFolder(browsing!.path)}>Use this folder</Button>
  {/snippet}
</Dialog>

<Dialog
  open={removing}
  title="Remove {name} from the hub?"
  description="Only the entry goes. The folder {path} and its Claude history stay on disk; you can import it again later."
  onclose={() => (removing = false)}
>
  {#snippet actions()}
    <Button variant="ghost" onclick={() => (removing = false)}>Cancel</Button>
    <Button variant="danger" onclick={remove}>Remove</Button>
  {/snippet}
</Dialog>

<style>
  .page {
    min-height: 100%;
    padding: var(--space-8) var(--space-4) var(--space-12);
    background: var(--bg);
  }

  .content {
    max-width: var(--size-page);
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
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

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, var(--size-sidebar-min)), 1fr));
    gap: var(--space-4);
  }

  .span {
    grid-column: 1 / -1;
  }

  .folders {
    max-height: 50vh;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
  }

  .folders button {
    display: flex;
    gap: var(--space-2-5);
    align-items: center;
    width: 100%;
    padding: var(--space-2) var(--space-2-5);
    font: inherit;
    font-family: var(--font-mono);
    color: var(--fg);
    text-align: start;
    background: none;
    border: 0;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .folders button:hover,
  .folders button:focus-visible {
    background: var(--raised);
  }

  .folder {
    display: flex;
    gap: var(--space-2-5);
    align-items: end;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2-5);
  }

  .tight {
    gap: var(--space-2);
  }

  .end {
    align-items: flex-end;
  }

  .stack {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
  }

  .start {
    align-items: flex-start;
  }

  .strong {
    font-weight: var(--weight-medium);
  }

  .muted {
    margin: 0;
    color: var(--muted);
  }

  .small {
    font-size: var(--text-sm);
  }

  .upload {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--size-tile-lg);
    height: var(--size-tile-lg);
    border: var(--hairline) dashed var(--muted);
    border-radius: var(--radius-md);
    color: var(--muted);
  }

  .skills summary {
    cursor: pointer;
    font-size: var(--text-md);
    color: var(--fg-2);
  }

  .skills[open] summary {
    margin-bottom: var(--space-2-5);
  }

  .table-wrap {
    overflow-x: auto;
    border: var(--hairline) solid var(--line);
    border-radius: var(--radius-lg);
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-md);
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

  th.group {
    background: var(--panel);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    color: var(--fg-2);
  }

  code {
    font-family: var(--font-mono);
    color: var(--fg);
  }

  .prompt {
    padding: var(--space-4);
    border: var(--hairline) solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--panel);
  }

  .foot {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: var(--space-2);
    padding-top: var(--space-4);
    border-top: var(--hairline) solid var(--line);
  }

  .grow {
    flex: 1 1 auto;
  }
</style>
