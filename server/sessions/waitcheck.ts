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
  'Besides reading files, the web and MCP tools you may run read-only gh, glab and git commands ' +
  '(gh pr view, gh pr checks, glab mr view, glab ci status, git log and the like). ' +
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

/** claude.ai connectors are not in ~/.claude.json: `claude mcp list` names them, as "claude.ai GitHub: https://…". */
export function parseConnectors(out: string): string[] {
  return [...out.matchAll(/^claude\.ai (.+?): https?:\/\//gm)].map(
    (m) => `claude_ai_${m[1].replace(/[^A-Za-z0-9_-]/g, '_')}`,
  );
}

let connectors: { at: number; names: Promise<string[]> } | null = null;
/** The claude.ai connectors; `claude mcp list` takes seconds (it connects to each), so its answer is kept an hour. */
function claudeAiServers(): Promise<string[]> {
  if (!connectors || Date.now() - connectors.at > 3_600_000) {
    const names = new Promise<string[]>((resolve) =>
      execFile('claude', ['mcp', 'list'], { timeout: 60_000 }, (_err, stdout) =>
        resolve(parseConnectors(String(stdout ?? ''))),
      ),
    );
    connectors = { at: Date.now(), names };
  }
  return connectors.names;
}

// gh, glab and git commands that only read. Every other Bash call has no allow rule, so dontAsk refuses it.
const READ_BASH = [
  'gh pr view',
  'gh pr checks',
  'gh pr list',
  'gh issue view',
  'gh issue list',
  'gh run view',
  'gh run list',
  'gh release view',
  'gh release list',
  'glab mr view',
  'glab mr list',
  'glab issue view',
  'glab ci status',
  'glab ci list',
  'git log',
  'git show',
  'git status',
  'git ls-remote',
].flatMap((command) => [`Bash(${command})`, `Bash(${command} *)`]);

export function allowRules(servers: string[]): string[] {
  return [
    'Read',
    'Grep',
    'Glob',
    'WebFetch',
    'WebSearch',
    ...READ_BASH,
    ...servers.flatMap((s) => [
      ...READ_VERBS.map((verb) => `mcp__${s}__${verb}*`),
      `mcp__${s}__*_read`,
      `mcp__${s}__mr_discussions`,
    ]),
  ];
}

/** The user's own Bash allow rules, which load with their settings and may write (`glab mr update *`): the check
 *  denies them. A bare `Bash` allow would let everything through, so then all of Bash is denied. */
export function userBashDenies(cwd: string, home = homedir()): string[] {
  const dir = process.env.CLAUDE_CONFIG_DIR ?? join(home, '.claude');
  const files = [
    join(dir, 'settings.json'),
    join(dir, 'settings.local.json'),
    join(cwd, '.claude', 'settings.json'),
    join(cwd, '.claude', 'settings.local.json'),
  ];
  const rules = files.flatMap((file) => {
    try {
      const allow = JSON.parse(readFileSync(file, 'utf8')).permissions?.allow;
      return Array.isArray(allow) ? allow.filter((r): r is string => typeof r === 'string' && /^Bash\b/.test(r)) : [];
    } catch {
      return [];
    }
  });
  if (rules.some((r) => /^Bash(\((\*|:\*)?\))?$/.test(r))) return ['Bash'];
  return [...new Set(rules.filter((r) => !READ_BASH.includes(r)))];
}

const DENY = [
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
  'mcp__*__*_write',
];

export const defaultWaitChecker: WaitChecker = async (check, cwd) => {
  const servers = [...mcpServers(cwd), ...(await claudeAiServers())];
  return new Promise((resolve) => {
    const args = [
      '-p',
      '--model',
      'haiku',
      '--no-session-persistence',
      '--permission-mode',
      'dontAsk',
      '--allowedTools',
      ...allowRules(servers),
      '--disallowedTools',
      ...DENY,
      ...userBashDenies(cwd),
    ];
    const child = execFile('claude', args, { cwd, timeout: 180_000 }, (err, stdout) =>
      resolve(err ? null : parseCheck(stdout)),
    );
    child.stdin?.end(ASK + check.slice(0, 2000));
  });
};
