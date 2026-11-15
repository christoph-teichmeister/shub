// HTTP client for the CLI commands. Auth: SHUB_TOKEN (inside sessions) or the access token file.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createContext } from '../../../server/context.ts';

/** Expected failures: printed without a stack trace. */
export class CliError extends Error {}

export function baseUrl(): string {
  return (process.env.SHUB_URL ?? 'http://127.0.0.1:4780').replace(/\/$/, '');
}

function token(): string {
  if (process.env.SHUB_TOKEN) return process.env.SHUB_TOKEN;
  const file = join(createContext().paths.stateDir, 'token');
  try {
    return readFileSync(file, 'utf8').trim();
  } catch {
    throw new CliError(`no SHUB_TOKEN set and no token file at ${file}. Has shub been started once?`);
  }
}

/** Platform-aware: the service manager differs, a git checkout has none. */
export function unreachable(url: string, platform: NodeJS.Platform = process.platform): string {
  const status =
    platform === 'darwin'
      ? 'launchctl print gui/$(id -u)/com.github.christoph-teichmeister.shub'
      : 'systemctl --user status shub';
  return `shub is not reachable at ${url}. Run \`shub doctor\`. Not started yet: \`shub start\` (or \`shub service install\` to run it in the background). Installed as a service: \`${status}\`.`;
}

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(baseUrl() + path, {
      method,
      headers: { authorization: `Bearer ${token()}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    if (err instanceof CliError) throw err;
    throw new CliError(unreachable(baseUrl()));
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new CliError(`${method} ${path} failed (${res.status}): ${data?.error ?? text}`);
  return data as T;
}

export function output(value: unknown, json: boolean, human: () => string): void {
  console.log(json ? JSON.stringify(value, null, 2) : human());
}

export function table(rows: string[][]): string {
  if (rows.length === 0) return '';
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => (r[i] ?? '').length)));
  return rows
    .map((r) =>
      r
        .map((c, i) => c.padEnd(widths[i]))
        .join('  ')
        .trimEnd(),
    )
    .join('\n');
}

/** `--name value` / `--name=value` / boolean `--flag`; everything else is positional. */
export function parse(
  args: string[],
  valued: string[],
): { positional: string[]; flags: Record<string, string | true> } {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < args.length; i++) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(args[i]);
    if (!m) positional.push(args[i]);
    else if (m[2] !== undefined) flags[m[1]] = m[2];
    else if (valued.includes(m[1])) {
      if (args[i + 1] === undefined) throw new CliError(`--${m[1]} needs a value`);
      flags[m[1]] = args[++i];
    } else flags[m[1]] = true;
  }
  return { positional, flags };
}
