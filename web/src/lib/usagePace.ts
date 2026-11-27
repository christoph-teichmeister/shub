// Even-pace % of a usage limit window: where usage would stand if used evenly from window start to its end.

const clampPct = (p: number): number => Math.min(100, Math.max(0, p));

/** Pace over the whole window that resets at `resetsAt` (unix seconds). */
export function pace(resetsAt: number, windowSec: number, nowSec = Date.now() / 1000): number {
  return clampPct(100 - ((resetsAt - nowSec) / windowSec) * 100);
}

/** Pace of a 7d window that counts only until the work week ends: the last Friday 16:00 (local time) before the reset. */
export function workweekPace(resetsAt: number, nowSec = Date.now() / 1000): number {
  const end = new Date(resetsAt * 1000);
  end.setHours(16, 0, 0, 0);
  end.setDate(end.getDate() - ((end.getDay() + 2) % 7)); // back to Friday (0 = Sunday, 5 = Friday)
  if (end.getTime() / 1000 >= resetsAt) end.setDate(end.getDate() - 7); // Friday 16:00 not before the reset
  const endSec = end.getTime() / 1000;
  return clampPct(((nowSec - (resetsAt - 7 * 86400)) / (endSec - (resetsAt - 7 * 86400))) * 100);
}
