<script lang="ts">
  import type { ServiceContainer } from '../../../../../shared/api.ts';
  import Icon from '../Icon/Icon.svelte';
  import IconButton from '../IconButton/IconButton.svelte';

  export type ServiceAction = 'start' | 'stop' | 'restart' | 'send-logs';

  interface Props {
    containers: ServiceContainer[];
    onaction: (action: ServiceAction, container: ServiceContainer) => void;
    loadLogs: (id: string) => Promise<string>;
    loadInspect: (id: string) => Promise<unknown>;
    /** Host for port links. */
    host?: string;
  }
  let { containers, onaction, loadLogs, loadInspect, host = location.hostname }: Props = $props();

  const KIND: Record<ServiceContainer['kind'], { title: string; text?: string; icon?: 'database' | 'worker' }> = {
    python: { title: 'Python', text: 'py' },
    postgres: { title: 'PostgreSQL', icon: 'database' },
    redis: { title: 'Redis', text: 'rd' },
    rabbitmq: { title: 'RabbitMQ', text: 'mq' },
    celery: { title: 'Celery worker', icon: 'worker' },
    node: { title: 'Node.js', text: 'js' },
    nginx: { title: 'nginx', text: 'nx' },
    other: { title: 'Container', text: '·' },
  };
  const TABS = ['Log', 'Env', 'Ports', 'Inspect'] as const;

  let selectedId = $state<string | null>(null);
  let tab = $state<(typeof TABS)[number]>('Log');
  let collapsed = $state<Record<string, boolean>>({});
  let detail = $state<{ key: string; log?: string; inspect?: unknown; error?: string } | null>(null);

  const groups = $derived(
    Object.entries(Object.groupBy(containers, (c) => c.project)) as [string, ServiceContainer[]][],
  );
  const selected = $derived(containers.find((c) => c.id === selectedId) ?? containers[0] ?? null);

  $effect(() => {
    const c = selected;
    const t = tab;
    if (!c) return;
    const key = `${c.id}:${t}`;
    if (t === 'Log') loadLogs(c.id).then((log) => (detail = { key, log }), fail(key));
    if (t === 'Env' || t === 'Inspect') loadInspect(c.id).then((inspect) => (detail = { key, inspect }), fail(key));
  });

  function fail(key: string) {
    return (err: unknown) => (detail = { key, error: err instanceof Error ? err.message : String(err) });
  }

  function env(inspect: unknown): string {
    const list = (inspect as { Config?: { Env?: string[] } } | undefined)?.Config?.Env;
    return list?.join('\n') ?? 'No environment';
  }

  const output = $derived.by(() => {
    if (!selected) return 'Pick a container';
    if (tab === 'Ports')
      return selected.ports.map((p) => `${p.host} -> ${p.container}`).join('\n') || 'No published ports';
    if (detail?.key !== `${selected.id}:${tab}`) return 'Loading…';
    if (detail.error) return detail.error;
    if (tab === 'Log') return detail.log || 'No log output';
    return tab === 'Env' ? env(detail.inspect) : JSON.stringify(detail.inspect, null, 2);
  });

  const up = (list: ServiceContainer[]) => list.filter((c) => c.state === 'running').length;
</script>

<div class="services">
  <div class="toolbar" role="toolbar" aria-label="Service actions" aria-orientation="vertical">
    <IconButton
      label="Start"
      icon="play"
      tone="start"
      disabled={!selected || selected.state === 'running'}
      onclick={() => selected && onaction('start', selected)}
    />
    <IconButton
      label="Stop"
      icon="stop"
      tone="stop"
      disabled={!selected || selected.state !== 'running'}
      onclick={() => selected && onaction('stop', selected)}
    />
    <IconButton
      label="Restart"
      icon="restart"
      disabled={!selected}
      onclick={() => selected && onaction('restart', selected)}
    />
    <IconButton
      label="Send logs to Claude"
      icon="message"
      tone="accent"
      disabled={!selected}
      onclick={() => selected && onaction('send-logs', selected)}
    />
  </div>

  <ul class="tree" role="tree" aria-label="Containers">
    {#each groups as [project, list] (project)}
      <li role="treeitem" aria-expanded={!collapsed[project]} aria-selected="false">
        <button type="button" class="group" onclick={() => (collapsed[project] = !collapsed[project])}>
          <Icon name={collapsed[project] ? 'chevron-right' : 'chevron-down'} size="xs" weight={2} />
          <span class="compose"><Icon name="compose" weight={1.4} /></span>
          <span class="grow">{project}</span>
          <span class="meta">{up(list)} of {list.length} up</span>
        </button>
        {#if !collapsed[project]}
          <ul role="group">
            {#each list as c (c.id)}
              {@const kind = KIND[c.kind]}
              {@const running = c.state === 'running'}
              <li
                role="treeitem"
                class="item"
                class:selected={c.id === selected?.id}
                aria-selected={c.id === selected?.id}
              >
                <button type="button" class="select" onclick={() => (selectedId = c.id)}>
                  <span class="state {running ? 'up' : c.state === 'restarting' ? 'busy' : 'down'}" aria-hidden="true"
                  ></span>
                  <span class="kind {c.kind}" title={kind.title}>
                    {#if kind.icon}<Icon name={kind.icon} size="xs" weight={1.8} />{:else}{kind.text}{/if}
                  </span>
                  <span class="grow">{c.name}</span>
                  <span class="visually-hidden">{c.status}</span>
                </button>
                {#if running && c.ports[0]}
                  <a class="port" href="http://{host}:{c.ports[0].host}" target="_blank" rel="noreferrer"
                    >:{c.ports[0].host}</a
                  >
                {:else if !running}
                  <span class="down-text">{c.status}</span>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </li>
    {/each}
    {#if containers.length === 0}<li class="none" role="none">No containers for this session</li>{/if}
  </ul>

  <div class="details">
    <div class="tabs" role="tablist" aria-label="Container details">
      {#each TABS as t (t)}
        <button type="button" role="tab" class="tab" aria-selected={t === tab} onclick={() => (tab = t)}>{t}</button>
      {/each}
    </div>
    <div class="panel" role="tabpanel" aria-label={tab}>
      <pre class="out">{output}</pre>
    </div>
  </div>
</div>

<style>
  .services {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    font-size: var(--text-md);
  }

  .toolbar {
    flex: 0 0 var(--size-toolbar);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-0-5);
    padding-top: var(--space-1);
    border-right: var(--hairline) solid var(--line);
  }

  .tree {
    flex: 0 0 var(--size-tree);
    overflow: auto;
    margin: 0;
    padding: var(--space-1) 0;
    list-style: none;
    border-right: var(--hairline) solid var(--line);
  }

  .tree ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .group,
  .select {
    display: flex;
    align-items: center;
    gap: var(--space-1-5);
    width: 100%;
    height: var(--size-row);
    padding: 0 var(--space-2);
    border: 0;
    background: transparent;
    color: var(--fg);
    text-align: left;
    cursor: pointer;
  }

  .group {
    font-weight: var(--weight-medium);
  }

  .compose {
    display: inline-flex;
    color: var(--status-working);
  }

  .grow {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .meta {
    font-size: var(--text-xs);
    font-weight: var(--weight-regular);
    color: var(--muted);
  }

  .item {
    display: flex;
    align-items: center;
    padding-right: var(--space-2);
    color: var(--fg-2);
  }

  .item .select {
    flex: 1 1 auto;
    min-width: 0;
    padding-left: var(--space-8);
    color: inherit;
  }

  .item:hover,
  .item.selected {
    background: var(--raised);
    color: var(--fg);
  }

  .state {
    flex: none;
    width: var(--size-dot);
    height: var(--size-dot);
    border-radius: var(--radius-round);
  }

  .state.up {
    background: var(--status-your-turn);
  }

  .state.busy {
    border: var(--ring) solid var(--status-working);
  }

  .state.down {
    border: var(--ring) solid var(--danger);
  }

  .kind {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--size-tile-xs);
    height: var(--size-tile-xs);
    border-radius: var(--radius-xs);
    font-family: var(--font-mono);
    font-size: var(--text-3xs);
    font-weight: var(--weight-bold);
    background: var(--raised);
    color: var(--fg);
  }

  .kind.python {
    background: var(--svc-python);
    color: var(--svc-python-fg);
  }

  .kind.postgres {
    background: var(--svc-postgres);
    color: var(--svc-postgres-fg);
  }

  .kind.redis {
    background: var(--svc-redis);
    color: var(--svc-redis-fg);
  }

  .kind.rabbitmq {
    background: var(--svc-rabbitmq);
    color: var(--svc-rabbitmq-fg);
  }

  .kind.celery {
    background: var(--svc-celery);
    color: var(--svc-celery-fg);
  }

  .kind.node {
    background: var(--svc-node);
    color: var(--svc-node-fg);
  }

  .kind.nginx {
    background: var(--svc-nginx);
    color: var(--svc-nginx-fg);
  }

  .port {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--link);
  }

  .down-text {
    font-size: var(--text-xs);
    color: var(--danger);
    white-space: nowrap;
  }

  .none {
    padding: var(--space-2) var(--space-3);
    color: var(--muted);
  }

  .details {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .tabs {
    flex: none;
    display: flex;
    align-items: flex-end;
    gap: var(--space-0-5);
    height: var(--size-control-sm);
    padding: 0 var(--space-2);
    border-bottom: var(--hairline) solid var(--line);
  }

  .tab {
    height: var(--size-control-xs);
    padding: 0 var(--space-3);
    border: 0;
    border-bottom: var(--ring) solid transparent;
    background: transparent;
    color: var(--muted);
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .tab[aria-selected='true'] {
    border-bottom-color: var(--primary);
    color: var(--fg);
  }

  .panel {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
  }

  .out {
    flex: 1 1 auto;
    margin: 0;
    padding: var(--space-2-5) var(--space-3-5);
    overflow: auto;
    background: var(--term-bg);
    color: var(--fg-2);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    line-height: var(--leading-term);
    white-space: pre-wrap;
  }
</style>
