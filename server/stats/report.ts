// Pure aggregation: raw stats_events rows -> the StatsReport the Stats tab draws.
import type { StatsReport, TokenSums } from '../../shared/api.ts';
import { costUsd } from './prices.ts';

/** One row of stats_events. `kind`: status | closed | tool | asked | denied | compact | commit | pr | tokens | limit. */
export interface StatRow {
  ts: number;
  session: string;
  project: string | null;
  kind: string;
  /** status / tool / model / seven-day percent (limit). */
  a: string;
  /** command summary (asked) / TokenSums as JSON (tokens). */
  b: string;
  /** five-hour percent (limit). */
  n: number;
}

// ponytail: one status span is capped, so a missed hook cannot book a whole night; spans are not split at midnight.
const SPAN_CAP_MS = 3 * 3600_000;
const TIMED = new Set(['working', 'needs-you', 'your-turn']);

export const dayOf = (ts: number): string => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const empty = (): TokenSums => ({ input: 0, output: 0, cacheRead: 0, cacheCreate: 0 });
const add = (to: TokenSums, from: TokenSums): void => {
  to.input += from.input;
  to.output += from.output;
  to.cacheRead += from.cacheRead;
  to.cacheCreate += from.cacheCreate;
};
const total = (t: TokenSums): number => t.input + t.output + t.cacheRead + t.cacheCreate;
const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

export function buildReport(rows: StatRow[], days: number, now: number, nameOf: (id: string) => string): StatsReport {
  const dayList: string[] = [];
  for (let i = days - 1; i >= 0; i--) dayList.push(dayOf(now - i * 86400_000));
  const daily = new Map(
    dayList.map((day) => [
      day,
      {
        day,
        workingMs: 0,
        needsYouMs: 0,
        yourTurnMs: 0,
        sessions: 0,
        tokens: empty(),
        costUsd: 0,
        commits: 0,
        prs: 0,
        compacts: 0,
        medianNeedsYouMs: 0,
      },
    ]),
  );
  const needsYou = new Map<string, number[]>();
  const sessionsPerDay = new Map<string, Set<string>>();
  const projects = new Map<
    string | null,
    { projectId: string | null; workingMs: number; needsYouMs: number; tokens: number; costUsd: number }
  >();
  const project = (id: string | null) => {
    if (!projects.has(id)) projects.set(id, { projectId: id, workingMs: 0, needsYouMs: 0, tokens: 0, costUsd: 0 });
    return projects.get(id)!;
  };
  const models = new Map<string, { tokens: TokenSums; costUsd: number }>();
  const tools = new Map<string, { tool: string; count: number; asked: number; denied: number }>();
  const tool = (name: string) => {
    if (!tools.has(name)) tools.set(name, { tool: name, count: 0, asked: 0, denied: 0 });
    return tools.get(name)!;
  };
  const asked = new Map<string, number>();
  const sessionTokens = new Map<string, { tokens: number; costUsd: number }>();
  const span = new Map<string, { first: number; last: number }>();
  const limits: StatsReport['limits'] = [];
  const commitDays = new Set<string>();
  let limitHits = 0;
  let compacts = 0;

  const bySession = new Map<string, StatRow[]>();
  for (const r of [...rows].sort((a, b) => a.ts - b.ts)) {
    const day = daily.get(dayOf(r.ts));
    if (r.kind === 'commit') commitDays.add(dayOf(r.ts));
    if (!day) continue;
    if (r.session) {
      const s = span.get(r.session);
      span.set(r.session, { first: s?.first ?? r.ts, last: r.ts });
      if (!sessionsPerDay.has(day.day)) sessionsPerDay.set(day.day, new Set());
      sessionsPerDay.get(day.day)!.add(r.session);
    }
    if (r.kind === 'status' || r.kind === 'closed') {
      if (!bySession.has(r.session)) bySession.set(r.session, []);
      bySession.get(r.session)!.push(r);
    } else if (r.kind === 'tool') tool(r.a).count++;
    else if (r.kind === 'asked') {
      tool(r.a).asked++;
      if (r.b) asked.set(`${r.a}: ${r.b}`, (asked.get(`${r.a}: ${r.b}`) ?? 0) + 1);
    } else if (r.kind === 'denied') tool(r.a).denied++;
    else if (r.kind === 'compact') (day.compacts++, compacts++);
    else if (r.kind === 'commit') day.commits++;
    else if (r.kind === 'pr') day.prs++;
    else if (r.kind === 'tokens') {
      const t = JSON.parse(r.b) as TokenSums;
      const cost = costUsd(r.a, t);
      add(day.tokens, t);
      day.costUsd += cost;
      if (!models.has(r.a)) models.set(r.a, { tokens: empty(), costUsd: 0 });
      add(models.get(r.a)!.tokens, t);
      models.get(r.a)!.costUsd += cost;
      project(r.project).tokens += total(t);
      project(r.project).costUsd += cost;
      const st = sessionTokens.get(r.session) ?? { tokens: 0, costUsd: 0 };
      sessionTokens.set(r.session, { tokens: st.tokens + total(t), costUsd: st.costUsd + cost });
    } else if (r.kind === 'limit') {
      const prev = limits.at(-1);
      limits.push({ ts: r.ts, fiveHour: r.n, sevenDay: Number(r.a) });
      if ((r.n >= 100 || Number(r.a) >= 100) && !(prev && ((prev.fiveHour ?? 0) >= 100 || (prev.sevenDay ?? 0) >= 100)))
        limitHits++;
    }
  }

  // Status spans: from one status row to the next of the same session (or its close, or now).
  for (const list of bySession.values()) {
    list.forEach((r, i) => {
      if (r.kind !== 'status' || !TIMED.has(r.a)) return;
      const ms = Math.min((list[i + 1]?.ts ?? now) - r.ts, SPAN_CAP_MS);
      const day = daily.get(dayOf(r.ts))!;
      if (r.a === 'working') ((day.workingMs += ms), (project(r.project).workingMs += ms));
      else if (r.a === 'your-turn') day.yourTurnMs += ms;
      else {
        day.needsYouMs += ms;
        project(r.project).needsYouMs += ms;
        if (!needsYou.has(day.day)) needsYou.set(day.day, []);
        needsYou.get(day.day)!.push(ms);
      }
    });
  }
  for (const d of daily.values()) {
    d.sessions = sessionsPerDay.get(d.day)?.size ?? 0;
    d.medianNeedsYouMs = median(needsYou.get(d.day) ?? []);
  }

  // Peak parallel sessions: sweep over [first, last] of each session.
  const edges: [number, number][] = [];
  for (const s of span.values()) edges.push([s.first, 1], [s.last + 1, -1]);
  edges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let open = 0;
  let peak = 0;
  for (const [, d] of edges) peak = Math.max(peak, (open += d));

  let streak = 0;
  for (let t = now; ; t -= 86400_000) {
    if (commitDays.has(dayOf(t))) streak++;
    else if (t < now) break; // today without a commit does not break the streak yet
    if (streak > 400) break;
  }

  return {
    days,
    daily: [...daily.values()],
    projects: [...projects.values()].sort((a, b) => b.workingMs + b.tokens - (a.workingMs + a.tokens)),
    models: [...models]
      .map(([model, m]) => ({ model, ...m }))
      .sort((a, b) => b.costUsd - a.costUsd || total(b.tokens) - total(a.tokens)),
    tools: [...tools.values()].sort((a, b) => b.count - a.count).slice(0, 15),
    asked: [...asked]
      .map(([command, count]) => ({ command, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    limits,
    limitHits,
    sessions: {
      started: span.size,
      medianMs: median([...span.values()].map((s) => s.last - s.first)),
      peakParallel: peak,
      compactsPerSession: span.size ? Math.round((compacts / span.size) * 10) / 10 : 0,
    },
    topSessions: [...sessionTokens]
      .map(([sessionId, st]) => ({ sessionId, name: nameOf(sessionId), ...st }))
      .sort((a, b) => b.costUsd - a.costUsd || b.tokens - a.tokens)
      .slice(0, 5),
    streak,
  };
}

const usd = (n: number): string => `$${n.toFixed(n >= 10 ? 0 : 2)}`;
const hm = (ms: number): string =>
  ms >= 3600_000 ? `${(ms / 3600_000).toFixed(1)} h` : `${Math.round(ms / 60_000)} min`;

/** The weekly digest as a notification: title and a few short lines. */
export function digest(r: StatsReport): { title: string; body: string } {
  const sum = (pick: (d: StatsReport['daily'][number]) => number) => r.daily.reduce((a, d) => a + pick(d), 0);
  const waits = r.daily.map((d) => d.medianNeedsYouMs).filter(Boolean);
  const lines = [
    `Claude worked ${hm(sum((d) => d.workingMs))}, waited ${hm(sum((d) => d.needsYouMs))} on you${waits.length ? ` (median ${hm(median(waits))})` : ''}`,
    `${r.sessions.started} sessions, ${sum((d) => d.commits)} commits, ${sum((d) => d.prs)} PRs`,
    `${usd(sum((d) => d.costUsd))} at API rates${r.models[0] ? `, most on ${r.models[0].model}` : ''}`,
  ];
  if (r.limitHits) lines.push(`Limit hit ${r.limitHits}x`);
  return { title: `shub: your last ${r.days} days`, body: lines.join('\n') };
}
