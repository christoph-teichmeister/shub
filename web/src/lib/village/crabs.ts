// Where each session's crab stands on the map and what it does there. Pure: the view walks the crabs
// towards these targets on its own clock.
import type { Session, SessionStatus } from '../../../../shared/api.ts';
import { COMPACT_AT, WARN_AT } from '../status.ts';
import type { District, House, World } from './world.ts';

export type CrabSession = Pick<Session, 'id' | 'kind' | 'projectId' | 'status' | 'statusSince'>;
export type Pose = 'idle' | 'work' | 'sleep';

export interface CrabSpot<S extends CrabSession = CrabSession> {
  session: S;
  /** Target, bottom centre of the crab. */
  x: number;
  y: number;
  pose: Pose;
  house: House | null;
  district: District | null;
  /** Place in the queue at your desk, -1 when not queued. */
  queuePos: number;
  /** The global Claude: the mayor at the town hall. */
  mayor: boolean;
}

/** These queue at your desk. */
export const queued = (status: SessionStatus) => status === 'needs-you' || status === 'your-turn';
/** These nap on the lounger by their house. */
export const asleep = (status: SessionStatus) => status === 'paused' || status === 'waiting' || status === 'exited';

/** Context below this many tokens is a small backpack; up to WARN_AT a medium one, from there a big one. */
export const PACK_AT = 80_000;

/** The backpack a crab carries for its context: size, sweat from WARN_AT, panting from COMPACT_AT. */
export function backpack(tokens: number | null | undefined): { size: 0 | 1 | 2; sweat: boolean; pant: boolean } | null {
  if (tokens == null) return null;
  return {
    size: tokens < PACK_AT ? 0 : tokens < WARN_AT ? 1 : 2,
    sweat: tokens >= WARN_AT,
    pant: tokens >= COMPACT_AT,
  };
}

/** How a crab in the queue feels after `minutes` there: a bob, foot-tapping, waving claws, angry jumps. */
export type Mood = 'calm' | 'tap' | 'wave' | 'angry';
export const moodOf = (minutes: number): Mood =>
  minutes >= 30 ? 'angry' : minutes >= 15 ? 'wave' : minutes >= 5 ? 'tap' : 'calm';

/** Sessions that get a crab: Claude sessions and the global Claude, not plain terminals. */
export const crabSessions = <S extends CrabSession>(sessions: S[]): S[] => sessions.filter((s) => s.kind !== 'shell');

/**
 * Queue order: needs-you first, then by when they joined. `joined` maps id -> join number from the last call;
 * new arrivals join after everyone there (several at once by their last activity). Returns the new map too.
 */
export function queueOrder(
  sessions: CrabSession[],
  joined: Readonly<Record<string, number>>,
): { order: string[]; joined: Record<string, number> } {
  const inLine = sessions.filter((s) => queued(s.status));
  const next: Record<string, number> = {};
  let n = Math.max(0, ...Object.values(joined));
  for (const s of inLine) if (joined[s.id] != null) next[s.id] = joined[s.id];
  const arrivals = inLine.filter((s) => next[s.id] == null).sort((a, b) => a.statusSince.localeCompare(b.statusSince));
  for (const s of arrivals) next[s.id] = ++n;
  const rank = (s: CrabSession) => (s.status === 'needs-you' ? 0 : 1);
  const order = inLine.sort((a, b) => rank(a) - rank(b) || next[a.id] - next[b.id]).map((s) => s.id);
  return { order, joined: next };
}

/**
 * Keyboard triage: the crab `step` places on from `current` in the queue, wrapping round; from outside the
 * queue it starts at the front (needs-you first). null for an empty queue.
 */
export function walkQueue(queue: readonly string[], current: string | null, step: 1 | -1): string | null {
  if (!queue.length) return null;
  const i = current === null ? -1 : queue.indexOf(current);
  return i < 0 ? queue[0] : queue[(i + step + queue.length) % queue.length];
}

/** Keeps a crab that is at home inside its fence. */
export function clampTo(d: District, x: number, y: number): [number, number] {
  return [Math.min(Math.max(x, d.x + 40), d.x + d.w - 40), Math.min(Math.max(y, d.y + 70), d.y + d.h - 12)];
}

/** A crab is this wide: a crab in the queue keeps this far from the others while it walks. */
export const SPACE = 52;

export interface Walker {
  x: number;
  y: number;
  /** Unit direction of this step's move, [0, 0] when it stood. */
  v: [number, number];
  /** Place in the queue, -1 when not queued. */
  queuePos: number;
}

/**
 * Keeps queue crabs off each other while they walk the lane: a queue crab gives way to every crab ahead of it in
 * line and to every crab outside the queue (one leaving it, say). Behind or beside such a crab it hangs back at
 * SPACE; in its way it steps aside across its path, so it gets past. Moves the queue crabs in place, the front of the
 * line first, so the result is the same every time. The others never move.
 */
export function giveWay(ws: Walker[]): void {
  const rank = (w: Walker) => (w.queuePos < 0 ? -1 : w.queuePos);
  // ponytail: pairwise, and a crab pushed aside may land on one further back that then moves too; fine for a queue
  for (const b of ws.filter((w) => w.queuePos >= 0).sort((p, q) => p.queuePos - q.queuePos))
    for (const a of ws) {
      if (a === b || rank(a) >= rank(b)) continue;
      const [dx, dy] = [b.x - a.x, b.y - a.y];
      const d = Math.hypot(dx, dy);
      if (d >= SPACE) continue;
      const [vx, vy] = a.v;
      const along = dx * vx + dy * vy;
      if (along > 0) {
        // In its way: to the side of its path, the side b is already on (left when dead ahead).
        const side = dx * -vy + dy * vx < 0 ? -1 : 1;
        [b.x, b.y] = [a.x + vx * along - vy * side * SPACE, a.y + vy * along + vx * side * SPACE];
      } else {
        // Behind, beside or on top of it: back off along the line between them (up the lane when on top).
        const [ux, uy] = d ? [dx / d, dy / d] : vx || vy ? [-vx, -vy] : [0, -1];
        [b.x, b.y] = [a.x + ux * SPACE, a.y + uy * SPACE];
      }
    }
}

/**
 * Target spot and pose of every crab. `queue` is queueOrder().order; `t` is the view's step counter, which
 * moves the wanderers. Sessions of projects without a house (filtered out, unknown) get no crab.
 */
export function crabSpots<S extends CrabSession>(
  world: World,
  sessions: S[],
  queue: string[],
  t: number,
): CrabSpot<S>[] {
  const per: Record<string, number> = {};
  const out: CrabSpot<S>[] = [];
  crabSessions(sessions).forEach((s, idx) => {
    const house = s.projectId ? (world.houses[s.projectId] ?? null) : null;
    if (s.projectId && !house) return;
    const district = house?.district ?? null;
    const queuePos = queue.indexOf(s.id);
    const sleeping = asleep(s.status);
    // The n-th crab of a house in the same spot type stands next to the ones before it.
    const key = `${s.projectId ?? 'g'}/${sleeping ? 'sleep' : s.status}`;
    const k = (per[key] = (per[key] ?? -1) + 1);
    let x: number;
    let y: number;
    let pose: Pose = 'idle';
    if (queuePos >= 0) {
      const slot = world.slots[queuePos % world.slots.length];
      // Past the last spot the line goes on in a second row.
      x = slot[0] + Math.floor(queuePos / world.slots.length) * 64;
      y = slot[1];
    } else if (!house) {
      ({ x, y } = world.mayor);
      pose = sleeping ? 'sleep' : s.status === 'working' ? 'work' : 'idle';
    } else if (sleeping) {
      [x, y] = [house.x - 56 - k * 74, house.y + 46];
      pose = 'sleep';
    } else if (s.status === 'working') {
      const desk = house.desks[k % house.desks.length];
      [x, y] = [desk.x, desk.y - 14];
      pose = 'work';
    } else {
      // new, starting: strolls around its district.
      const d = district!;
      const ph = idx * 1.7;
      x = d.x + 60 + (d.w - 120) * (0.5 + 0.5 * Math.sin(t * 0.011 + ph));
      y = d.y + 110 + (d.h - 140) * (0.5 + 0.5 * Math.sin(t * 0.017 + ph * 1.3));
    }
    if (district && queuePos < 0) [x, y] = clampTo(district, x, y);
    out.push({ session: s, x, y, pose, house, district, queuePos, mayor: !house });
  });
  return out;
}
