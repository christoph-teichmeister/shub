<script lang="ts">
  // Settings area Plugins: installed plugins, their rights, actions, updates and logs.
  import type { PluginInfo, Right } from '../../../../../shared/api.ts';
  import Button from '../../components/Button/Button.svelte';
  import Checkbox from '../../components/Checkbox/Checkbox.svelte';
  import Dialog from '../../components/Dialog/Dialog.svelte';
  import Section from '../../components/Section/Section.svelte';
  import StatusBadge from '../../components/StatusBadge/StatusBadge.svelte';
  import { api } from '../../stores/api.ts';
  import { app, loadPlugins } from '../../stores/state.svelte.ts';
  import { toast, toastError } from '../../stores/toasts.svelte.ts';

  const RIGHTS: Record<Right, string> = {
    read: 'read sessions',
    'projects.write': 'change projects',
    'sessions.start': 'start sessions with a free prompt (asks)',
    'sessions.start.button': 'start sessions with project buttons',
    'sessions.link': 'add session links',
    'buttons.write': 'change project buttons (asks)',
    'ui.contribute': 'sidebar sections and menu actions',
  };

  const settingsActions = $derived(
    app.plugins.flatMap((p) => (p.enabled ? p.settingsActions.map((a) => ({ plugin: p.name, ...a })) : [])),
  );

  let logs = $state<{ plugin: string; lines: string[] } | null>(null);

  async function updatePlugin(p: PluginInfo, body: { enabled?: boolean; grantedRights?: Right[] }) {
    await api('pluginUpdate', { params: { name: p.name }, body }).catch(toastError);
    void loadPlugins();
  }

  let upgrading = $state<string | null>(null);
  async function upgradePlugin(p: PluginInfo) {
    upgrading = p.name;
    const res = await api<PluginInfo>('pluginUpgrade', { params: { name: p.name } }).catch(toastError);
    upgrading = null;
    if (res) toast(`${p.name} updated to ${res.version}`);
    void loadPlugins();
  }

  async function showLogs(name: string) {
    const res = await api<{ lines: string[] }>('pluginLogs', { params: { name } }).catch(toastError);
    if (res) logs = { plugin: name, lines: res.lines };
  }
</script>

<div class="card">
  <Section title="Installed plugins">
    {#snippet aside()}<code>shub plugin add &lt;git-url&gt;</code>{/snippet}
    {#if !app.plugins.length}<p class="muted">No plugins installed.</p>{/if}
    <ul class="list">
      {#each app.plugins as p (p.name)}
        {@const actions = settingsActions.filter((a) => a.plugin === p.name)}
        <li class="item top">
          <Checkbox
            label="Enable {p.name} plugin"
            hideLabel
            checked={p.enabled}
            onchange={(e) => updatePlugin(p, { enabled: e.currentTarget.checked })}
          />
          <span class="grow stack gap">
            <span class="strong">{p.name} <span class="muted small">{p.version} · {p.source}</span></span>
            {#if p.description}<span class="muted small">{p.description}</span>{/if}
            <details class="more">
              <summary>Rights: {p.grantedRights.length} of {p.requestedRights.length} granted</summary>
              <fieldset class="rights">
                <legend class="muted small">Rights it asks for (tick to grant)</legend>
                {#each p.requestedRights as r (r)}
                  <Checkbox
                    label={RIGHTS[r] ?? r}
                    checked={p.grantedRights.includes(r)}
                    onchange={(e) =>
                      updatePlugin(p, {
                        grantedRights: e.currentTarget.checked
                          ? [...p.grantedRights, r]
                          : p.grantedRights.filter((x) => x !== r),
                      })}
                  />
                {/each}
              </fieldset>
            </details>
            {#if actions.length}
              <span class="row">
                {#each actions as a (a.id)}
                  <Button
                    size="sm"
                    onclick={() =>
                      api('pluginAction', { params: { name: a.plugin, actionId: a.id }, body: {} }).then(
                        () => toast(`${a.label} sent to ${a.plugin}`),
                        toastError,
                      )}>{a.label}</Button
                  >
                {/each}
              </span>
            {/if}
          </span>
          <StatusBadge text={p.running ? 'running' : 'stopped'} tone={p.running ? 'done' : 'neutral'} />
          {#if p.updateAvailable}
            <Button size="sm" disabled={upgrading === p.name} onclick={() => upgradePlugin(p)}
              >{upgrading === p.name ? 'Updating…' : 'Update'}</Button
            >
          {/if}
          <Button size="sm" onclick={() => showLogs(p.name)}>Logs</Button>
        </li>
      {/each}
    </ul>
  </Section>
</div>

<Dialog open={!!logs} title="Logs of {logs?.plugin}" onclose={() => (logs = null)}>
  <pre class="log">{logs?.lines.join('\n') || 'No output yet.'}</pre>
</Dialog>

<style>
  .card {
    padding: var(--space-4) var(--space-5);
    border: var(--hairline) solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--panel);
  }

  .more summary {
    color: var(--link);
    font-size: var(--text-md);
    cursor: pointer;
  }

  .more[open] summary {
    margin-bottom: var(--space-2-5);
  }

  .grow {
    flex: 1 1 auto;
    min-width: 0;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2-5);
  }

  .stack {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
  }

  .gap {
    gap: var(--space-2-5);
  }

  .strong {
    font-weight: var(--weight-medium);
    color: var(--fg);
  }

  .muted {
    margin: 0;
    color: var(--muted);
  }

  .small {
    font-size: var(--text-sm);
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .item {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2-5);
    padding: var(--space-3);
    border: var(--hairline) solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--bg);
  }

  .top {
    align-items: flex-start;
  }

  .rights {
    display: flex;
    flex-direction: column;
    gap: var(--space-1-5);
    margin: 0;
    padding: 0;
    border: 0;
  }

  .rights legend {
    margin-bottom: var(--space-1-5);
    padding: 0;
  }

  code,
  .log {
    font-family: var(--font-mono);
  }

  .log {
    max-height: 60vh;
    margin: 0;
    padding: var(--space-3);
    overflow: auto;
    border-radius: var(--radius-md);
    background: var(--term-bg);
    font-size: var(--text-sm);
    color: var(--fg-2);
    white-space: pre-wrap;
  }
</style>
