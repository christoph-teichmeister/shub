<script lang="ts">
  import type { Session } from '../../../../../shared/api.ts';
  import { STATUS_LABEL } from '../../status.ts';
  import StatusDot from '../StatusDot/StatusDot.svelte';

  interface Props {
    session: Session;
    href: string;
    selected?: boolean;
    /** Fades out and says "Closing" instead of the status while the session shuts down. */
    closing?: boolean;
  }
  let { session, href, selected = false, closing = false }: Props = $props();
</script>

<a
  class="row {session.status}"
  class:selected
  class:closing
  inert={closing}
  {href}
  aria-current={selected ? 'page' : undefined}
>
  <StatusDot status={session.status} />
  <span class="name">{session.name}</span>
  <span class="status">{closing ? 'Closing' : STATUS_LABEL[session.status]}</span>
</a>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2-5);
    border-radius: var(--radius-sm);
    color: var(--fg-2);
    text-decoration: none;
    transition: opacity var(--duration-slow) var(--ease-standard);
  }

  .closing {
    opacity: 0.4;
  }

  .row:hover,
  .selected {
    background: var(--raised);
    color: var(--fg);
  }

  .name {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .status {
    flex: none;
    font-size: var(--text-xs);
    color: var(--muted);
  }

  /* muted on raised is below 4.5:1 */
  :where(.row:hover, .selected) .status {
    color: var(--fg-2);
  }

  .new:not(:hover, .selected) .name {
    color: var(--muted);
  }

  .needs-you {
    background: var(--status-needs-you-bg);
    color: var(--status-needs-you-fg);
  }

  .needs-you .status {
    color: var(--status-needs-you-fg);
  }

  .working .status {
    color: var(--status-working);
  }

  .your-turn .status {
    color: var(--status-your-turn);
  }
</style>
