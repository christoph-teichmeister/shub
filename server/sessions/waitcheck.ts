// Background check for a waiting session: a small model reads, never writes, whether what it waits for happened.
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface CheckResult {
  done: boolean;
  /** One short sentence: what happened, or why not yet. */
  summary: string;
}

/** Runs one check in the session's folder; null when the model gave no usable answer. Tests swap this out. */
export type WaitChecker = (check: string, cwd: string) => Promise<CheckResult | null>;

const ASK =
  'You check one thing for a developer. Only look things up, never change anything. ' +
  'Reply with exactly one line, in the language of the check: "DONE: <what happened, one short sentence>" ' +
  'or "NOT YET: <why not, one short sentence>".\n\nCheck:\n';

/** The last DONE / NOT YET line of the answer. */
export function parseCheck(raw: string): CheckResult | null {
  const lines = raw.trim().split('\n').reverse();
  for (const line of lines) {
    const m = /^\W*(DONE|NOT YET)\s*:\s*(.+)$/i.exec(line.trim());
    if (m)
      return {
        done: m[1].toUpperCase() === 'DONE',
        summary: m[2]
          .replace(/[*`]+$/, '')
          .trim()
          .slice(0, 200),
      };
  }
  return null;
}

// Reads only: the allow list covers look-ups, and the deny list wins over the user's own allow rules (which may
// include MCP writes). The user's settings still load, since that is where their MCP servers come from.
// Allow rules need the server's real name (`mcp__*__get*` matches nothing; deny rules do take the `*`).
const READ_VERBS = ['get', 'list', 'search', 'browse', 'read', 'query', 'fetch'];

/** The MCP servers Claude loads in `cwd`: user-wide and per-project ones from ~/.claude.json, plus .mcp.json. */
export function mcpServers(cwd: string, home = homedir()): string[] {
  const names = (file: string, pick: (json: any) => object | undefined): string[] => {
    try {
      return Object.keys(pick(JSON.parse(readFileSync(file, 'utf8'))) ?? {});
    } catch {
      return [];
    }
  };
  const user = join(process.env.CLAUDE_CONFIG_DIR ?? home, '.claude.json');
  return [
    ...new Set([
      ...names(user, (j) => j.mcpServers),
      ...names(user, (j) => j.projects?.[cwd]?.mcpServers),
      ...names(join(cwd, '.mcp.json'), (j) => j.mcpServers),
    ]),
  ];
}

export function allowRules(servers: string[]): string[] {
  return [
    'Read',
    'Grep',
    'Glob',
    'WebFetch',
    'WebSearch',
    ...servers.flatMap((s) => [...READ_VERBS.map((verb) => `mcp__${s}__${verb}*`), `mcp__${s}__mr_discussions`]),
  ];
}
const DENY = [
  'Bash',
  'Edit',
  'Write',
  'NotebookEdit',
  ...[
    'create',
    'update',
    'delete',
    'merge',
    'approve',
    'unapprove',
    'resolve',
    'publish',
    'bulk',
    'manage',
    'push',
    'upload',
    'rebase',
    'fork',
    'mark',
    'send',
    'set',
    'add',
    'remove',
    'move',
    'run',
  ].map((verb) => `mcp__*__${verb}*`),
];

export const defaultWaitChecker: WaitChecker = (check, cwd) =>
  new Promise((resolve) => {
    const args = [
      '-p',
      '--model',
      'haiku',
      '--no-session-persistence',
      '--permission-mode',
      'dontAsk',
      '--allowedTools',
      ...allowRules(mcpServers(cwd)),
      '--disallowedTools',
      ...DENY,
    ];
    const child = execFile('claude', args, { cwd, timeout: 180_000 }, (err, stdout) =>
      resolve(err ? null : parseCheck(stdout)),
    );
    child.stdin?.end(ASK + check.slice(0, 2000));
  });
