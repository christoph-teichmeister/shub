<script lang="ts" module>
  export interface CardAction {
    label: string;
    /** Key on the focused map that does the same. */
    kbd?: string;
    primary?: boolean;
    disabled?: boolean;
    title?: string;
    run: () => void;
  }
</script>

<script lang="ts">
  // What a crab is up to: a preview while it is hovered or focused (the crab's aria-describedby), with its
  // actions once a click or the arrow keys pin it.
  import type { Session } from '../../../../../shared/api.ts';
  import { contextFill, statusLabel, waitTitle } from '../../status.ts';

  interface Props {
    id: string;
    session: Session;
    project: string;
    group: string;
    color: string;
    queuePos: number;
    /** Where it points, in px inside the scaled map; `below` hangs it under the spot instead of above. */
    x: number;
    y: number;
    below: boolean;
    /** Pinned cards take the pointer and show `actions`. */
    actions?: CardAction[];
    onclose?: () => void;
  }
  let { id, session: s, project, group, color, queuePos, x, y, below, actions, onclose }: Props = $props();
  const fill = $derived(contextFill(s));
  const agents = $derived(s.agents ?? []);
</script>

<div
  {id}
  class="card"
  class:below
  class:pinned={actions}
  style:left="{x}px"
  style:top="{y}px"
  role={actions ? 'dialog' : 'tooltip'}
  aria-label={actions ? s.name : undefined}
  data-keep
>
  <strong class="name"><span class="swatch {s.status}"></span>{s.name}</strong>
  <span class="meta"><span class="pill" style:background={color}>{project}</span>{group}</span>
  <span class="status">
    {statusLabel(s)}{queuePos >= 0 ? ` · #${queuePos + 1} in line` : ''}
  </span>
  {#if s.pendingPermission}<span>Asks: {s.pendingPermission.summary}</span>{/if}
  {#each s.pendingCommands ?? [] as c, i (i)}<code>{c.command}</code>{/each}
  {#if s.waitingFor}<span class="wait">{waitTitle(s)}</span>{/if}
  {#if agents.length && s.status === 'working'}
    <span class="meta">
      {agents.length}
      {agents.length === 1 ? 'subagent' : 'subagents'}: {agents.map((a) => a.type).join(', ')}
    </span>
  {/if}
  {#if fill}
    <span class="bar"><span class={fill.level} style:width="{fill.pct}%"></span></span>
    <span class="meta">{fill.title}{fill.compact ? ' · time to compact' : ''}</span>
  {/if}
  {#if actions}
    <div class="actions">
      {#each actions as a (a.label)}
        <button
          type="button"
          class="btn small"
          class:primary={a.primary}
          disabled={a.disabled}
          title={a.title}
          onclick={a.run}
          >{a.label}{#if a.kbd}<kbd>{a.kbd}</kbd>{/if}</button
        >
      {/each}
      <button type="button" class="btn small" aria-label="Close card" title="Close (Esc)" onclick={onclose}>×</button>
    </div>
  {:else}
    <span class="meta">Click to pin its card, double-click to open</span>
  {/if}
</div>

<style>
  .card {
    position: absolute;
    z-index: var(--z-menu);
    transform: translate(-50%, -100%);
    width: var(--size-village-card);
    display: flex;
    flex-direction: column;
    gap: var(--space-1-5);
    padding: var(--space-3) var(--space-3-5);
    border: var(--ring) solid var(--village-parchment-line);
    border-radius: var(--radius-xs);
    background: var(--village-parchment);
    box-shadow:
      0 0 0 var(--ring) var(--village-ink),
      0 var(--space-2-5) var(--space-6) var(--shadow);
    color: var(--village-ink);
    font: var(--text-base) / var(--leading-tight) var(--font-pixel);
    pointer-events: none;
  }

  .card.pinned {
    pointer-events: auto;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1-5);
    margin-top: var(--space-1);
  }

  .card.below {
    transform: translate(-50%, 0);
  }

  .name {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-lg);
  }

  .swatch {
    flex: none;
    width: var(--space-3);
    height: var(--space-3);
    border: var(--ring) solid var(--village-ink);
    background: var(--village-parchment);
  }

  .swatch.needs-you {
    background: var(--status-needs-you);
  }

  .swatch.your-turn {
    background: var(--status-your-turn);
  }

  .swatch.working,
  .swatch.starting {
    background: var(--status-working);
  }

  .swatch.waiting {
    background: var(--village-sky);
  }

  .swatch.paused,
  .swatch.exited {
    background: var(--village-wood);
  }

  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1-5);
    color: var(--village-ink-muted);
    font-size: var(--text-md);
  }

  .pill {
    padding: 0 var(--space-1-5);
    border: var(--ring) solid var(--village-ink);
    border-radius: var(--radius-xs);
    color: var(--village-ink);
  }

  .status {
    font-weight: var(--weight-semibold);
  }

  .wait {
    white-space: pre-line;
  }

  code {
    overflow-wrap: anywhere;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }

  .bar {
    height: var(--space-2);
    overflow: hidden;
    border: var(--ring) solid var(--village-parchment-line);
    border-radius: var(--radius-xs);
  }

  .bar span {
    display: block;
    height: 100%;
    background: var(--status-your-turn);
  }

  .bar .mid {
    background: var(--village-gold);
  }

  .bar .high {
    background: var(--village-alarm);
  }
</style>
