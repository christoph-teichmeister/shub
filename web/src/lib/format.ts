// Small display formatters shared by views.

const MINUTE = 60_000;
const DAY = 86_400_000;

/** A countdown as minutes and seconds, e.g. "4:05". */
export const mmss = (ms: number): string =>
  `${Math.floor(ms / MINUTE)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

/** How long ago, short: "5 min", "3 h", "2 d" (phone session lists). */
export const shortAge = (iso: string): string => {
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / MINUTE));
  return min < 60 ? `${min} min` : min < 1440 ? `${Math.round(min / 60)} h` : `${Math.round(min / 1440)} d`;
};

/** Whole days ago: "today", "3d"; "" without a time (a worktree's last commit). */
export const dayAge = (iso: string | null): string => {
  const days = iso ? Math.floor((Date.now() - Date.parse(iso)) / DAY) : null;
  return days === null ? '' : days < 1 ? 'today' : `${days}d`;
};

/** "today", "yesterday", "5 days ago", "3 weeks ago", "2 months ago" (projects found on first run). */
export const ago = (iso: string): string => {
  const days = Math.floor((Date.now() - Date.parse(iso)) / DAY);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
};
