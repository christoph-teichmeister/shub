// Waits: what a parked session waits for, and the background check that ends the wait once it happened.
import type { Session, WaitCheck } from '../../shared/api.ts';
import type { Notify } from '../services.ts';
import type { WaitChecker } from './waitcheck.ts';

const WAIT_EVERY_MIN = 5;
/** Failed checks in a row before the user hears the check does not work. */
const WAIT_FAILS_NOTIFY = 3;

/** The check a wait for `reason` carries; null without a reason or a check prompt. */
export function newWaitCheck(
  reason: string | null,
  check?: { prompt: string; everyMinutes?: number; onDone?: string | null },
): WaitCheck | null {
  const prompt = reason && check?.prompt.trim().slice(0, 2000);
  return prompt
    ? {
        prompt,
        everyMinutes: Math.max(WAIT_EVERY_MIN, Math.round(check?.everyMinutes ?? 30)),
        // Runs at once, so the user sees right away whether the check makes sense.
        checkedAt: null,
        last: null,
        onDone: check?.onDone?.trim().slice(0, 2000) || null,
        failures: 0,
      }
    : null;
}

/** What a background check needs from the sessions service. */
export interface WaitHost {
  get(id: string): Session | undefined;
  /** Ends the wait: back to "your-turn". */
  endWait(id: string): Session;
  /** Stores the check with its latest answer, without an update event. */
  saveCheck(id: string, check: WaitCheck): void;
  emitUpdated(id: string): Session;
  /** Types into the session now, or resumes it first and types once Claude is up. */
  typeInto(id: string, type: () => void): void;
  pasteText(id: string, text: string): void;
  sendKeys(id: string, keys: string[]): void;
  notify(): Notify;
}

export class WaitChecks {
  #host: WaitHost;
  #checker: WaitChecker;
  /** Sessions whose background check is running right now. */
  #checking = new Set<string>();

  constructor(host: WaitHost, checker: WaitChecker) {
    this.#host = host;
    this.#checker = checker;
  }

  /** Runs the session's background check when it is due (or `force`); ends the wait once it happened. */
  async check(id: string, force = false): Promise<void> {
    const before = this.#host.get(id);
    const check = before?.status === 'waiting' ? before.waitCheck : null;
    if (!check || this.#checking.has(id)) return;
    const due = !check.checkedAt || Date.now() - Date.parse(check.checkedAt) >= check.everyMinutes * 60_000;
    if (!due && !force) return;
    this.#checking.add(id);
    try {
      const result = await this.#checker(check.prompt, before!.cwd).catch(() => null);
      const current = this.#host.get(id);
      // The wait changed or ended meanwhile: this answer belongs to an old check.
      if (current?.waitCheck?.prompt !== check.prompt || current.waitingFor !== before!.waitingFor) return;
      const last = result ? `${result.done ? 'DONE' : 'NOT YET'}: ${result.summary}` : 'Check failed';
      const failures = result ? 0 : (check.failures ?? 0) + 1;
      const updated = { ...check, checkedAt: new Date().toISOString(), last, failures };
      this.#host.saveCheck(id, updated);
      if (result?.done && current.status === 'waiting') {
        const session = this.#host.endWait(id);
        if (check.onDone) this.#resumeAfterWait(session, check.onDone.replaceAll('{summary}', result.summary));
        else this.#host.notify().needsYou(session, result.summary);
      } else {
        const session = this.#host.emitUpdated(id);
        if (failures === WAIT_FAILS_NOTIFY) {
          this.#host.notify().needsYou(session, `Wait check failed ${failures} times in a row: ${check.prompt}`);
        }
      }
    } finally {
      this.#checking.delete(id);
    }
  }

  /** The wait is over: Claude goes on with `text`; when that cannot be typed, the user hears of it instead. */
  #resumeAfterWait(session: Session, text: string): void {
    try {
      this.#host.typeInto(session.id, () => {
        this.#host.pasteText(session.id, text);
        this.#host.sendKeys(session.id, ['Enter']);
      });
    } catch (err) {
      console.error(`shub: wait follow-up for ${session.id}`, err);
      this.#host.notify().needsYou(session, `Done waiting, but shub could not send: ${text}`);
    }
  }
}
