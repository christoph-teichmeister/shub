<script lang="ts">
  import type { SubagentRun } from '../../../../../shared/api.ts';
  import Icon from '../Icon/Icon.svelte';

  interface Props {
    agent: SubagentRun;
  }
  let { agent }: Props = $props();
</script>

<div class="row" title="Subagent {agent.type}{agent.activity ? `: ${agent.activity}` : ''}">
  <span class="mark" aria-hidden="true"><Icon name="sparkle" size="xs" /></span>
  <span class="name">{agent.type}</span>
  <span class="activity">{agent.activity ?? 'working'}</span>
</div>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2-5);
    color: var(--muted);
  }

  .mark {
    display: flex;
    flex: none;
    color: var(--status-working);
  }

  .name {
    flex: none;
    max-width: 60%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .activity {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
