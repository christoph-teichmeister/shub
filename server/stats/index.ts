// Usage history for the Stats tab: events from the bus and the hooks in one sqlite table, read back as a report.
import { join, resolve } from 'node:path';
import { ROUTES, type Session } from '../../shared/api.ts';
import { requireUser } from '../api/router.ts';
import type { Context } from '../context.ts';
import type { ShubModule } from '../module.ts';
import type { Services, Stats } from '../services.ts';
import { claudeDir } from '../sessions/old.ts';
import { buildReport, digest, type StatRow } from './report.ts';
import { readFrom, sumUsage } from './tokens.ts';

const KEEP_DAYS = 400;
const LIMIT_EVERY_MS = 60_000;

export function create(ctx: Context, services: Services): { module: ShubModule; service: Stats } {
  const { db, migrate } = services.state;
  migrate('stats', [
    `CREATE TABLE stats_events (ts INTEGER NOT NULL, session TEXT NOT NULL, project TEXT, kind TEXT NOT NULL,
       a TEXT NOT NULL DEFAULT '', b TEXT NOT NULL DEFAULT '', n REAL NOT NULL DEFAULT 0)`,
    'CREATE INDEX stats_events_ts ON stats_events (ts)',
    'CREATE TABLE stats_offsets (file TEXT PRIMARY KEY, off INTEGER NOT NULL)',
  ]);
  const insert = db.prepare(
    'INSERT INTO stats_events (ts, session, project, kind, a, b, n) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  const projectOf = (id: string): string | null => services.sessions.get(id)?.projectId ?? null;
  const record = (session: string, kind: string, a = '', b = '', n = 0, ts = Date.now()): void => {
    try {
      insert.run(ts, session, projectOf(session), kind, a, b, n);
    } catch (err) {
      console.warn('shub: recording a stat failed', err);
    }
  };

  /** Token usage of the lines a transcript got since the last look (first look: the whole file, by line time). */
  const readTokens = (session: string, path: unknown): void => {
    if (typeof path !== 'string' || !path.endsWith('.jsonl')) return;
    const file = resolve(path);
    if (!file.startsWith(join(claudeDir(), 'projects') + '/')) return;
    try {
      const from =
        (db.prepare('SELECT off FROM stats_offsets WHERE file = ?').get(file) as { off: number } | undefined)?.off ?? 0;
      const { text, offset } = readFrom(file, from);
      for (const r of sumUsage(text)) record(session, 'tokens', r.model, JSON.stringify(r.tokens), 0, r.ts);
      db.prepare(
        'INSERT INTO stats_offsets (file, off) VALUES (?, ?) ON CONFLICT (file) DO UPDATE SET off = excluded.off',
      ).run(file, offset);
    } catch {
      // transcript not written yet, or gone
    }
  };

  const service: Stats = {
    hook(session: Session, event: string, payload: Record<string, unknown>) {
      // A subagent's tool calls count too; its tokens live in its own transcript and are not read.
      const tool = typeof payload.tool_name === 'string' ? payload.tool_name : '';
      if (event === 'PostToolUse' && tool) {
        record(session.id, 'tool', tool);
        const command = (payload.tool_input as { command?: unknown } | undefined)?.command;
        if (tool === 'Bash' && typeof command === 'string') {
          if (/\bgit\s+(-\S+\s+)*commit\b/.test(command)) record(session.id, 'commit');
          if (/\b(gh\s+pr\s+create|glab\s+mr\s+create)\b/.test(command)) record(session.id, 'pr');
        }
      } else if (event === 'PermissionRequest' && tool) {
        const input = payload.tool_input as { command?: unknown; file_path?: unknown } | undefined;
        const what = String(input?.command ?? input?.file_path ?? '')
          .trim()
          .split(/\s+/)
          .slice(0, 2)
          .join(' ');
        record(session.id, 'asked', tool, what.slice(0, 60));
      } else if (event === 'PermissionDenied' && tool) record(session.id, 'denied', tool);
      else if (event === 'PostCompact') record(session.id, 'compact');
      else if (event === 'Stop' && !payload.agent_id) {
        // Same fixed delay as the context fill: Claude writes its last reply to the transcript a moment later.
        setTimeout(() => readTokens(session.id, payload.transcript_path), 1000);
      }
    },
  };

  const report = (days: number, now = Date.now()) => {
    const rows = db
      .prepare('SELECT * FROM stats_events WHERE ts >= ?')
      .all(now - (days + 1) * 86400_000) as unknown as StatRow[];
    return buildReport(rows, days, now, (id) => services.sessions.get(id)?.name ?? id.slice(0, 8));
  };

  /** The digest goes out once 7 days have passed since the last one (the first one 7 days after this version starts). */
  const sendDigest = (): void => {
    const now = Date.now();
    const last = (
      db.prepare("SELECT off FROM stats_offsets WHERE file = 'digest'").get() as { off: number } | undefined
    )?.off;
    if (last === undefined) {
      db.prepare("INSERT INTO stats_offsets (file, off) VALUES ('digest', ?)").run(now);
      return;
    }
    // ponytail: one fixed rhythm; a toggle and a weekday choice come when someone asks.
    if (now - last < 7 * 86400_000 || new Date(now).getHours() < 8) return;
    db.prepare("UPDATE stats_offsets SET off = ? WHERE file = 'digest'").run(now);
    const { title, body } = digest(report(7, now));
    services.notify.info(title, body, '/#/stats', 'stats-digest');
  };
  let timer: NodeJS.Timeout | undefined;

  let lastLimit = 0;
  const off = ctx.bus.on((e) => {
    if (e.type === 'session.status') record(e.sessionId, 'status', e.status);
    else if (e.type === 'session.closed') record(e.sessionId, 'closed');
    else if (e.type === 'usage.updated' && Date.now() - lastLimit >= LIMIT_EVERY_MS) {
      lastLimit = Date.now();
      const { fiveHour, sevenDay } = e.usage;
      if (fiveHour || sevenDay) record('', 'limit', String(sevenDay?.used ?? 0), '', fiveHour?.used ?? 0);
    }
  });

  return {
    service,
    module: {
      name: 'stats',
      start() {
        db.prepare('DELETE FROM stats_events WHERE ts < ?').run(Date.now() - KEEP_DAYS * 86400_000);
        sendDigest();
        timer = setInterval(sendDigest, 3600_000);
      },
      stop() {
        off();
        clearInterval(timer);
      },
      routes(router) {
        router.add(ROUTES.stats, (req) => {
          requireUser(req.caller);
          const days = Math.min(365, Math.max(1, Number(req.query.get('days')) || 30));
          return report(days);
        });
      },
    },
  };
}
