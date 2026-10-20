<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { ProjectView, Session } from '../../../../../shared/api.ts';
  import { projectBadge } from '../../status.ts';
  import IconButton from '../IconButton/IconButton.svelte';
  import ProjectIcon from '../ProjectIcon/ProjectIcon.svelte';
  import StatusBadge from '../StatusBadge/StatusBadge.svelte';

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
    children,
  }: Props = $props();
  const badge = $derived(projectBadge(sessions.map((s) => s.status)));
  let over = $state(false);
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
    <a class="link" {href} aria-current={selected ? 'page' : undefined}>
      <ProjectIcon icon={project.resolvedIcon} name={project.name} />
      <span class="name">{project.name}</span>
    </a>
    {#if badge}<span class="badge"><StatusBadge text={badge.text} tone={badge.tone} /></span>{/if}
    <span class="actions">
      {#if !project.missing}
        <IconButton label="New session in {project.name}" icon="plus" onclick={onnewsession} />
      {/if}
      <IconButton label="Project settings for {project.name}" icon="gear" href={settingsHref} variant="filled" />
    </span>
  </div>
  {#if children}<div class="sessions">{@render children()}</div>{/if}
</div>

<style>
  .project {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-height: var(--size-control-lg);
    padding: 0 var(--space-1) 0 var(--space-2-5);
    border-radius: var(--radius-md);
    color: var(--fg-2);
  }

  .row:hover,
  .row:focus-within {
    outline: var(--hairline) solid var(--line);
    background: var(--bg);
  }

  .selected,
  .selected:hover {
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

  .missing .link {
    opacity: 0.5;
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .actions {
    display: none;
    gap: var(--space-1);
  }

  .row:hover .actions,
  .row:focus-within .actions {
    display: flex;
  }

  .row:hover .badge,
  .row:focus-within .badge {
    display: none;
  }

  .sessions {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    padding-left: var(--space-8);
  }
</style>
