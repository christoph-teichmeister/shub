import type { Session } from '../../shared/api.ts';
import { api, baseUrl, output } from './lib/client.ts';

export const summary = 'Is shub running? Version and session counts.';
export const usage = 'shub status [--json]';

export async function run(_args: string[], opts: { json: boolean }): Promise<void> {
  const health = await api<{ version: string; apiVersion: number }>('GET', '/api/health');
  const sessions = await api<Session[]>('GET', '/api/sessions').catch(() => null);
  const counts: Record<string, number> = {};
  for (const s of sessions ?? []) counts[s.status] = (counts[s.status] ?? 0) + 1;
  output({ url: baseUrl(), ...health, sessions: counts }, opts.json, () =>
    [
      `shub ${health.version} at ${baseUrl()} (API v${health.apiVersion})`,
      sessions
        ? `${sessions.length} sessions` +
          (sessions.length
            ? ': ' +
              Object.entries(counts)
                .map(([k, v]) => `${v} ${k}`)
                .join(', ')
            : '')
        : 'sessions: not available',
    ].join('\n'),
  );
}
