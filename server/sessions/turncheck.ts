// Who has the ball when a turn ended with background work still running? A small model reads the last message.
import { execFile } from 'node:child_process';

export type TurnVerdict = 'working' | 'needs-you' | 'your-turn';

export interface TurnNote {
  /** Claude's last message of the turn. */
  message: string;
  /** One line per background task still running when the turn ended. */
  tasks: string[];
}

/** The verdict, or null when the model gave no usable answer. Tests swap this out. */
export type TurnChecker = (note: TurnNote) => Promise<TurnVerdict | null>;

const ASK =
  'A coding assistant ended its turn while background tasks may still run. Decide who has the ball:\n' +
  'WORKING: the message says it waits for a background task, agent or run that will wake it up itself; the user has nothing to do.\n' +
  'NEEDS-YOU: it asks the user a question, wants a decision, approval or a manual step.\n' +
  'YOUR-TURN: it is finished and reports a result to read.\n' +
  'A question to the user beats WORKING. Reply with exactly one word: WORKING, NEEDS-YOU or YOUR-TURN.\n\n';

/** The last verdict word of the answer. */
export function parseVerdict(raw: string): TurnVerdict | null {
  const m = [...raw.toUpperCase().matchAll(/\b(WORKING|NEEDS-YOU|YOUR-TURN)\b/g)].pop();
  return m ? (m[1].toLowerCase() as TurnVerdict) : null;
}

// Same call shape as the titler: no tools, no user hooks, nothing written to ~/.claude/projects.
export const defaultTurnChecker: TurnChecker = ({ message, tasks }) =>
  new Promise((resolve) => {
    const args = ['-p', '--model', 'haiku', '--no-session-persistence', '--setting-sources', '', '--tools', ''];
    const child = execFile('claude', args, { timeout: 60_000 }, (err, stdout) =>
      resolve(err ? null : parseVerdict(stdout)),
    );
    child.stdin?.end(
      `${ASK}Background tasks:\n${tasks.join('\n') || '(none listed)'}\n\nLast message:\n${message.slice(-2000)}`,
    );
  });
