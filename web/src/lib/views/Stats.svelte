<script lang="ts">
  // Usage history: time per status, wait for you, tokens, limits, tools. Data from GET /api/stats (server/stats).
  import { onMount } from 'svelte';
  import type { StatsReport, TokenSums } from '../../../../shared/api.ts';
  import { api } from '../stores/api.ts';
  import { app } from '../stores/state.svelte.ts';
  import { gameBack } from '../stores/router.svelte.ts';

  let days = $state(30);
  let report = $state<StatsReport | null>(null);
  let failed = $state(false);

  async function load() {
    try {
      report = await api<StatsReport>('stats', { query: { days: String(days) } });
      failed = false;
    } catch {
      failed = true;
    }
  }
  onMount(load);

  const sumTokens = (t: TokenSums) => t.input + t.output + t.cacheRead + t.cacheCreate;
  const hours = (ms: number) => (ms >= 3600_000 ? `${(ms / 3600_000).toFixed(1)} h` : `${Math.round(ms / 60_000)} min`);
  const short = (n: number) =>
    n >= 1e9
      ? `${(n / 1e9).toFixed(1)}B`
      : n >= 1e6
        ? `${(n / 1e6).toFixed(1)}M`
        : n >= 1e3
          ? `${Math.round(n / 1e3)}k`
          : String(n);
  const projectName = (id: string | null) =>
    id ? (app.projects.find((p) => p.id === id)?.name ?? id) : 'Global / none';

  const usd = (n: number) => `$${n.toFixed(n >= 10 ? 0 : 2)}`;
  const costTotal = $derived(report?.daily.reduce((a, d) => a + d.costUsd, 0) ?? 0);
  const total = $derived(report?.daily.reduce((a, d) => a + d.workingMs, 0) ?? 0);
  const tokensTotal = $derived(report?.daily.reduce((a, d) => a + sumTokens(d.tokens), 0) ?? 0);
  const cacheHit = $derived.by(() => {
    const read = report?.daily.reduce((a, d) => a + d.tokens.cacheRead, 0) ?? 0;
    const input = report?.daily.reduce((a, d) => a + d.tokens.input + d.tokens.cacheCreate, 0) ?? 0;
    return read + input ? Math.round((read / (read + input)) * 100) : 0;
  });
  const waits = $derived((report?.daily.map((d) => d.medianNeedsYouMs).filter(Boolean) ?? []).sort((a, b) => a - b));
  const timeMax = $derived(Math.max(1, ...(report?.daily.map((d) => d.workingMs + d.needsYouMs + d.yourTurnMs) ?? [])));
  const tokenMax = $derived(Math.max(1, ...(report?.daily.map((d) => sumTokens(d.tokens)) ?? [])));
  const limitPoints = (pick: 'fiveHour' | 'sevenDay') => {
    const l = report?.limits ?? [];
    if (l.length < 2) return '';
    const t0 = l[0].ts;
    const span = Math.max(1, l.at(-1)!.ts - t0);
    return l.map((p) => `${(((p.ts - t0) / span) * 100).toFixed(1)},${(100 - (p[pick] ?? 0)).toFixed(1)}`).join(' ');
  };
</script>

<div class="stats">
  <header>
    <a class="back" href={gameBack()}>← shub</a>
    <h1>Stats</h1>
    <span class="grow"></span>
    {#each [7, 30, 90] as n (n)}
      <button type="button" class:on={days === n} onclick={() => ((days = n), load())}>{n} days</button>
    {/each}
  </header>

  {#if failed}
    <p class="muted">Stats did not load.</p>
  {:else if !report}
    <p class="muted">Loading…</p>
  {:else}
    <section class="tiles">
      <div><b>{hours(total)}</b><span>Claude working</span></div>
      <div>
        <b>{waits.length ? hours(waits[Math.floor(waits.length / 2)]) : '–'}</b><span>median wait for you</span>
      </div>
      <div><b>{short(tokensTotal)}</b><span>tokens, {cacheHit}% from cache</span></div>
      <div>
        <b>{report.sessions.started}</b><span>sessions, peak {report.sessions.peakParallel} parallel</span>
      </div>
      <div>
        <b>{report.daily.reduce((a, d) => a + d.commits, 0)} / {report.daily.reduce((a, d) => a + d.prs, 0)}</b><span
          >commits / PRs, streak {report.streak} d</span
        >
      </div>
      <div>
        <b>{usd(costTotal)}</b><span title="Tokens at pay-per-token API rates: a yardstick on a subscription"
          >at API rates</span
        >
      </div>
      <div><b>{report.sessions.compactsPerSession}</b><span>compacts per session</span></div>
    </section>

    <section>
      <h2>
        Time per day <small
          ><i class="working"></i> working <i class="needs"></i> waiting on you <i class="turn"></i> your turn</small
        >
      </h2>
      <div class="bars">
        {#each report.daily as d (d.day)}
          <div class="bar" title="{d.day}: {hours(d.workingMs)} working, {hours(d.needsYouMs)} waiting on you">
            <span class="turn" style:height="{(d.yourTurnMs / timeMax) * 100}%"></span>
            <span class="needs" style:height="{(d.needsYouMs / timeMax) * 100}%"></span>
            <span class="working" style:height="{(d.workingMs / timeMax) * 100}%"></span>
          </div>
        {/each}
      </div>
    </section>

    <section>
      <h2>Tokens per day <small>{usd(costTotal)} at API rates</small></h2>
      <div class="bars">
        {#each report.daily as d (d.day)}
          <div class="bar" title="{d.day}: {short(sumTokens(d.tokens))} tokens">
            <span class="working" style:height="{(sumTokens(d.tokens) / tokenMax) * 100}%"></span>
          </div>
        {/each}
      </div>
    </section>

    <section>
      <h2>
        Limits <small><i class="working"></i> 5 h <i class="needs"></i> 7 d, {report.limitHits}× at 100%</small>
      </h2>
      {#if report.limits.length < 2}
        <p class="muted">Collecting samples: they come from the status line while sessions run.</p>
      {:else}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" class="limits">
          <polyline class="l5" points={limitPoints('fiveHour')} vector-effect="non-scaling-stroke" />
          <polyline class="l7" points={limitPoints('sevenDay')} vector-effect="non-scaling-stroke" />
        </svg>
      {/if}
    </section>

    <div class="grid">
      <section>
        <h2>Projects</h2>
        <table>
          <tbody>
            {#each report.projects as p (p.projectId)}
              <tr
                ><td>{projectName(p.projectId)}</td><td>{hours(p.workingMs)}</td><td
                  >{short(p.tokens)} · {usd(p.costUsd)}</td
                ></tr
              >
            {/each}
          </tbody>
        </table>
      </section>
      <section>
        <h2>Models</h2>
        <table>
          <tbody>
            {#each report.models as m (m.model)}
              <tr><td>{m.model}</td><td>{short(sumTokens(m.tokens))}</td><td>{usd(m.costUsd)}</td></tr>
            {/each}
          </tbody>
        </table>
      </section>
      <section>
        <h2>Tools <small>calls / asked / denied</small></h2>
        <table>
          <tbody>
            {#each report.tools as t (t.tool)}
              <tr><td>{t.tool}</td><td>{t.count}</td><td>{t.asked} / {t.denied}</td></tr>
            {/each}
          </tbody>
        </table>
      </section>
      <section>
        <h2>Asked most <small>allowlist candidates</small></h2>
        <table>
          <tbody>
            {#each report.asked as a (a.command)}
              <tr><td class="mono">{a.command}</td><td>{a.count}×</td></tr>
            {/each}
          </tbody>
        </table>
      </section>
      <section>
        <h2>Most expensive sessions</h2>
        <table>
          <tbody>
            {#each report.topSessions as s (s.sessionId)}
              <tr><td>{s.name}</td><td>{short(s.tokens)} · {usd(s.costUsd)}</td></tr>
            {/each}
          </tbody>
        </table>
      </section>
    </div>
  {/if}
</div>

<style>
  .stats {
    min-height: 100vh;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-4);
    background: var(--bg);
    color: var(--fg);
  }

  header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  h1 {
    margin: 0;
    font-size: var(--text-lg);
    font-weight: var(--weight-semibold);
  }

  h2 {
    margin: 0 0 var(--space-2);
    font-size: var(--text-base);
    font-weight: var(--weight-semibold);
  }

  small,
  .muted,
  .tiles span {
    color: var(--muted);
    font-size: var(--text-sm);
    font-weight: var(--weight-regular);
  }

  .back {
    color: var(--muted);
    text-decoration: none;
  }

  .grow {
    flex: 1 1 auto;
  }

  header button {
    padding: var(--space-1) var(--space-3);
    border: var(--hairline) solid var(--line);
    border-radius: var(--radius-pill);
    background: transparent;
    color: var(--muted);
    cursor: pointer;
  }

  header button.on {
    border-color: var(--primary);
    color: var(--fg);
  }

  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: var(--space-3);
  }

  .tiles div {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-3);
    border: var(--hairline) solid var(--line);
    border-radius: var(--radius-md);
    background: var(--panel);
  }

  .tiles b {
    font-size: var(--text-xl);
  }

  .bars {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    height: 120px;
  }

  .bar {
    flex: 1 1 0;
    min-width: 0;
    height: 100%;
    display: flex;
    flex-direction: column-reverse;
    justify-content: flex-start;
  }

  .working {
    background: var(--status-working);
  }

  .needs {
    background: var(--status-needs-you);
  }

  .turn {
    background: var(--status-your-turn);
  }

  small i {
    display: inline-block;
    width: var(--size-dot);
    height: var(--size-dot);
    margin-left: var(--space-2);
    border-radius: var(--radius-round);
  }

  .limits {
    width: 100%;
    height: 120px;
    border: var(--hairline) solid var(--line);
    border-radius: var(--radius-md);
    background: var(--panel);
  }

  .limits polyline {
    fill: none;
    stroke-width: 1.5;
  }

  .l5 {
    stroke: var(--status-working);
  }

  .l7 {
    stroke: var(--status-needs-you);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: var(--space-4);
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-md);
  }

  td {
    padding: var(--space-1) var(--space-2);
    border-bottom: var(--hairline) solid var(--line);
  }

  td:not(:first-child) {
    text-align: right;
    color: var(--muted);
    white-space: nowrap;
  }

  .mono {
    font-family: var(--font-mono);
    overflow-wrap: anywhere;
  }
</style>
