// Does a finished turn still have background shells? Claude runs each as `/bin/bash -c source …/shell-snapshots/…`,
// a direct child of the claude process (MCP servers are children too, but never look like that).
import { execFileSync } from 'node:child_process';
import { ENDLESS_COMMANDS } from '../hooks/transition.ts';

/** Running background shells under the claude process in the pane `panePid`, from `ps -e -o pid=,ppid=,args=`.
 *  Servers and watchers do not count: Claude does not wait for them. */
export function liveShells(ps: string, panePid: number): number {
  const rows = ps
    .split('\n')
    .map((l) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l))
    .filter((m) => m !== null)
    .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), args: m[3] }));
  const claudes = new Set(
    rows.filter((r) => r.ppid === panePid && /(^|\/)claude(\s|$)/.test(r.args)).map((r) => r.pid),
  );
  return rows.filter(
    (r) =>
      claudes.has(r.ppid) && r.args.includes('/shell-snapshots/') && !ENDLESS_COMMANDS.some((re) => re.test(r.args)),
  ).length;
}

/** Same, for a live pane; 0 when ps or tmux fail (the model then decides from the message alone). */
export function livePaneShells(panePid: () => number): number {
  try {
    return liveShells(execFileSync('ps', ['-e', '-o', 'pid=,ppid=,args='], { encoding: 'utf8' }), panePid());
  } catch {
    return 0;
  }
}
