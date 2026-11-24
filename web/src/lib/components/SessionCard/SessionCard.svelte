<script lang="ts">
  import type { Session } from '../../../../../shared/api.ts';
  import { contextFill, idleWithAgents, statusLabel, waitTitle } from '../../status.ts';
  import { shortAge } from '../../format.ts';
  import Button from '../Button/Button.svelte';
  import StatusDot from '../StatusDot/StatusDot.svelte';

  interface Props {
    session: Session;
    href: string;
    /** Project name for the chip; none for the global Claude. */
    project?: string;
    accent?: string;
    /** Panes (second Claude, terminals) rolled up into this card. */
    panes?: number;
    onallow?: () => void;
    ondeny?: () => void;
    /** Shows a button (Resume while paused, else Show) that brings a parked session back into the grid. */
    onrestore?: () => void;
    /** Accent frame: a minimized session that is your turn now. */
    flagged?: boolean;
    /** A line for a session with nothing else to say, e.g. why it sits in the strip. */
    note?: string;
    /** One row: status, name, project, line and buttons side by side (the overview's strip). */
    compact?: boolean;
  }
  let {
    session,
    href,
    project,
    accent,
    panes = 0,
    onallow,
    ondeny,
    onrestore,
    flagged = false,
    note,
    compact = false,
  }: Props = $props();

  // A question (AskUserQuestion) is answered in the terminal, Allow/Deny would pick answer 1 or 3.
  const showAllow = $derived(!!session.pendingPermission && session.pendingPermission.tool !== 'AskUserQuestion');
  const fill = $derived(contextFill(session));
  const agent = $derived(session.agents?.find((a) => a.activity)?.activity);
  // What the session is doing or waiting for, most urgent first.
  const line = $derived(
    session.pendingPermission
      ? `${session.pendingPermission.tool}: ${session.pendingPermission.summary}`
      : (note ?? (session.waitingFor ? `Waiting for ${session.waitingFor}` : (agent ?? ''))),
  );
</script>

<article class="card {session.status}" class:flagged class:compact style:--accent={accent}>
  <a class="main" {href} title={waitTitle(session)}>
    <span class="head">
      <StatusDot status={session.status} idle={idleWithAgents(session)} />
      <span class="status">{statusLabel(session)}</span>
      <span class="age">{shortAge(session.statusSince)}</span>
    </span>
    <span class="name">{session.name}</span>
    <span class="meta">
      {#if project}<span class="chip">{project}</span>{/if}
      {#if panes}<span class="chip">+{panes} {panes === 1 ? 'pane' : 'panes'}</span>{/if}
    </span>
    <span class="line">{line}</span>
  </a>
  {#if (showAllow && onallow && ondeny) || onrestore}
    <div class="actions">
      {#if showAllow && onallow && ondeny}
        <Button size="sm" variant="primary" onclick={onallow}>Allow</Button>
        <Button size="sm" onclick={ondeny}>Deny</Button>
      {/if}
      {#if onrestore}<Button size="sm" onclick={onrestore}>{session.status === 'paused' ? 'Resume' : 'Show'}</Button
        >{/if}
    </div>
  {/if}
  {#if fill}<span class="fill {fill.level}" style:--fill="{fill.pct}%" title={fill.title}></span>{/if}
</article>

<style>
  .card {
    position: relative;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
    border: var(--hairline) solid var(--line);
    border-left: var(--ring) solid var(--accent, var(--line));
    border-radius: var(--radius-lg);
    background: var(--panel);
    color: var(--fg-2);
  }

  .card.needs-you {
    border: var(--ring) solid var(--status-needs-you);
    background: var(--status-needs-you-bg);
    color: var(--status-needs-you-fg);
  }

  .card.flagged {
    border: var(--ring) solid var(--status-your-turn);
  }

  .card.paused,
  .card.starting,
  .card.new {
    opacity: 0.7;
  }

  .main {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-1-5);
    padding: var(--space-3) var(--space-3) var(--space-3);
    color: inherit;
    text-decoration: none;
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    color: var(--muted);
  }

  .needs-you .status {
    color: var(--status-needs-you);
  }

  .working .status {
    color: var(--status-working);
  }

  .your-turn .status {
    color: var(--status-your-turn);
  }

  .age {
    margin-left: auto;
  }

  .name {
    font-size: var(--text-lg);
    font-weight: var(--weight-medium);
    color: var(--fg);
    overflow-wrap: anywhere;
  }

  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1-5);
  }

  .chip {
    padding: 0 var(--space-2);
    border: var(--hairline) solid var(--line);
    border-radius: var(--radius-pill);
    font-size: var(--text-xs);
    color: var(--muted);
  }

  .line {
    font-size: var(--text-sm);
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    padding: 0 var(--space-3) var(--space-3);
  }

  /* Context fill along the bottom edge, as in SessionRow. */
  .fill {
    position: absolute;
    inset: auto 0 0;
    height: var(--space-0-5);

    --c: var(--muted);

    background: linear-gradient(to right, var(--c) var(--fill), transparent var(--fill));
  }

  .fill.mid {
    --c: var(--yellow);
  }

  .fill.high {
    --c: var(--danger);
  }

  .compact {
    flex-direction: row;
    align-items: center;
  }

  .compact .main {
    flex-direction: row;
    align-items: center;
    min-width: 0;
    gap: var(--space-3);
    padding: var(--space-1-5) var(--space-3);
  }

  .compact .name {
    flex: 0 1 auto;
    font-size: var(--text-sm);
    overflow-wrap: normal;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .compact .line {
    flex: 1 1 0;
    min-width: 0;
    display: block;
    white-space: nowrap;
    line-clamp: 1;
  }

  .compact .age {
    margin-left: 0;
  }

  .compact .actions {
    flex-wrap: nowrap;
    padding: 0 var(--space-2) 0 0;
  }
</style>
