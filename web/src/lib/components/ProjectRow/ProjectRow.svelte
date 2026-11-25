<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { ProjectView, Session } from '../../../../../shared/api.ts';
  import { projectBadge } from '../../status.ts';
  import Icon from '../Icon/Icon.svelte';
  import IconButton from '../IconButton/IconButton.svelte';
  import ProjectIcon from '../ProjectIcon/ProjectIcon.svelte';
  import StatusBadge from '../StatusBadge/StatusBadge.svelte';
  import { isFolded, setFolded } from '../../stores/folded.svelte.ts';

  interface Props {
    project: ProjectView;
    sessions: Session[];
    href: string;
    settingsHref: string;
    selected?: boolean;
    onnewsession?: () => void;
    /** Drag and drop to reorder; the parent decides what a drop means. */
    ondragstart?: (e: DragEvent) => void;
    ondrop?: (e: DragEvent) => void;
    /** Right-click (or the context-menu key) on the row: the view opens the project menu. */
    onmenu?: (e: MouseEvent) => void;
    /** Time left in the Active group after the last session closed, e.g. "9:41"; shown instead of the badge. */
    countdown?: string;
    /** Session rows under the project. */
    children?: Snippet;
  }
  let {
    project,
    sessions,
    href,
    settingsHref,
    selected = false,
    onnewsession,
    ondragstart,
    ondrop,
    onmenu,
    countdown,
    children,
  }: Props = $props();
  const badge = $derived(projectBadge(sessions));
  let over = $state(false);

  // Folding hides the session rows; kept in the shared folded store so the Active group can sink folded projects.
  const collapsed = $derived(isFolded(project.id));
  // A new session (Alt K, buttons, resume) or a jump into this project unfolds it, so the session is never hidden.
  let seen = { selected: false, count: 0 };
  $effect(() => {
    const grew = selected && sessions.length > seen.count;
    const entered = selected && !seen.selected;
    seen = { selected, count: sessions.length };
    if ((grew || entered) && collapsed) {
      setFolded(project.id, false);
    }
  });
  const foldable = $derived(!!children && sessions.length > 0);
  // Folded rows hide the sessions, so a count pill tells how many there are; unlike the badge it stays on hover.
  const folded = $derived(foldable && collapsed);
  // Folded rows must not hide live work: sessions that are neither paused, waiting nor exited tint the pill.
  const active = $derived(sessions.filter((s) => !['paused', 'waiting', 'exited'].includes(s.status)).length);
  function toggle() {
    setFolded(project.id, !collapsed);
  }
</script>

<div class="project">
  <div
    class="row"
    class:selected
    class:missing={project.missing}
    title={project.missing ? `Not on this machine: ${project.path}` : undefined}
    class:over
    draggable={ondragstart ? 'true' : undefined}
    role="group"
    aria-label={project.name}
    {ondragstart}
    oncontextmenu={onmenu ? (e) => (e.preventDefault(), onmenu(e)) : undefined}
    ondragover={ondrop ? (e) => (e.preventDefault(), e.stopPropagation(), (over = true)) : undefined}
    ondragleave={() => (over = false)}
    ondrop={ondrop ? (e) => (e.stopPropagation(), (over = false), ondrop(e)) : undefined}
  >
    {#if foldable}
      <!-- Takes the icon's place on hover: the sidebar scrolls, so a gutter left of the row would be clipped. -->
      <button
        type="button"
        class="fold"
        aria-expanded={!collapsed}
        aria-label="{collapsed ? 'Show' : 'Hide'} sessions of {project.name}"
        title="{collapsed ? 'Show' : 'Hide'} sessions"
        onclick={toggle}
      >
        <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} size="xs" weight={2} />
      </button>
    {/if}
    <a class="link" {href} aria-current={selected ? 'page' : undefined}>
      <ProjectIcon icon={project.resolvedIcon} name={project.name} />
      <span class="name">{project.name}</span>
    </a>
    <!-- The number stays rightmost; the actions fade in to its left, over the end of the name. -->
    <span class="tail">
      <span class="actions">
        {#if project.remoteUrl}
          <IconButton label="Open {project.name} remote" icon="link" href={project.remoteUrl} external />
        {/if}
        {#if !project.missing}
          <IconButton label="New session in {project.name}" icon="plus" onclick={onnewsession} />
        {/if}
        <IconButton label="Project settings for {project.name}" icon="gear" href={settingsHref} variant="filled" />
      </span>
      {#if folded}<span class="count" title="{sessions.length} sessions{active ? `, ${active} active` : ''}"
          ><StatusBadge text={String(sessions.length)} tone={active ? 'working' : 'neutral'} /></span
        >{/if}
      {#if countdown}
        <span class="badge" title="Leaves the Active group in {countdown}"
          ><StatusBadge text={countdown} tone="neutral" /></span
        >
      {:else if badge}<span class="badge"><StatusBadge text={badge.text} tone={badge.tone} /></span>{/if}
    </span>
  </div>
  {#if children && !(foldable && collapsed)}<div class="sessions">{@render children()}</div>{/if}
</div>

<style>
  .project {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
  }

  .row {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-height: var(--size-control-lg);
    padding: 0 var(--space-1) 0 var(--space-2-5);
    border-radius: var(--radius-md);
    color: var(--fg-2);

    --row-bg: transparent;
  }

  .row:hover,
  .row:focus-within {
    outline: var(--hairline) solid var(--line);

    --row-bg: var(--bg);

    background: var(--bg);
  }

  .selected,
  .selected:hover {
    --row-bg: var(--raised);

    background: var(--raised);
    color: var(--fg);
    font-weight: var(--weight-medium);
  }

  .over {
    box-shadow: inset 0 var(--ring) 0 var(--primary);
  }

  .link {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--space-2-5);
    padding: var(--space-1-5) 0;
    color: inherit;
    text-decoration: none;
  }

  .fold {
    position: absolute;
    left: var(--space-2-5);
    z-index: 1;
    display: none;
    place-items: center;
    width: var(--size-tile);
    height: var(--size-tile);
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: var(--raised);
    color: var(--fg-2);
    cursor: pointer;
  }

  .fold:hover {
    color: var(--fg);
  }

  .row:hover .fold,
  .row:focus-within .fold {
    display: grid;
  }

  .missing .link {
    opacity: 0.5;
  }

  .count {
    display: flex;
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tail {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .actions {
    position: absolute;
    right: 100%;
    display: flex;
    gap: var(--space-1);
    padding-left: var(--space-4);
    background: linear-gradient(to right, transparent, var(--row-bg) var(--space-4));
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--duration-base) var(--ease-standard);
  }

  .row:hover .actions,
  .row:focus-within .actions {
    opacity: 1;
    pointer-events: auto;
  }

  @media (prefers-reduced-motion: reduce) {
    .actions {
      transition: none;
    }
  }

  .sessions {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    padding-left: var(--space-8);
  }
</style>
