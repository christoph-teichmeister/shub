// The village's chat window (views/Village/ChatWindow.svelte): which crabs have a tab, and where the window sits.

/** Open tabs in order, and the one shown. */
export type Chats = { ids: string[]; active: string | null };
export type Rect = { x: number; y: number; w: number; h: number };

export const NO_CHATS: Chats = { ids: [], active: null };
/** The smallest window, unless the browser window itself is smaller. */
export const MIN_W = 360;
export const MIN_H = 220;

/** Opens a crab's tab (at the end, once) and shows it. */
export const openTab = (c: Chats, id: string): Chats => ({
  ids: c.ids.includes(id) ? c.ids : [...c.ids, id],
  active: id,
});

/** Closes a tab; closing the shown one shows its right neighbour (or the left one at the end). */
export function closeTab(c: Chats, id: string): Chats {
  const i = c.ids.indexOf(id);
  const ids = c.ids.filter((x) => x !== id);
  return { ids, active: c.active === id ? (ids[Math.min(i, ids.length - 1)] ?? null) : c.active };
}

/** Only the tabs whose session is still there. */
export const keepTabs = (c: Chats, live: Set<string>): Chats => c.ids.filter((id) => !live.has(id)).reduce(closeTab, c);

/** Keeps the window inside a vw x vh browser window: at least MIN_W x MIN_H, at most the whole window. */
export function clampRect(r: Rect, vw: number, vh: number): Rect {
  const w = Math.max(Math.min(r.w, vw), Math.min(MIN_W, vw));
  const h = Math.max(Math.min(r.h, vh), Math.min(MIN_H, vh));
  return { x: Math.max(0, Math.min(r.x, vw - w)), y: Math.max(0, Math.min(r.y, vh - h)), w, h };
}
