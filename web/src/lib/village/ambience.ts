// Time of day and the ambient life of the crab village. Pure: every position is a function of the view's step
// counter `t`, so a frozen `t` (reduced motion, hidden tab) is a still scene. Small fixed lists, a few per step.
import { rng, type Point, type World } from './world.ts';

export type TimeOfDay = 'morning' | 'day' | 'evening' | 'night';
export const TIMES: TimeOfDay[] = ['morning', 'day', 'evening', 'night'];

/** 5-9 morning, 9-18 day, 18-21 evening, else night. */
export const timeOfDay = (hour: number): TimeOfDay =>
  hour >= 5 && hour < 9 ? 'morning' : hour >= 9 && hour < 18 ? 'day' : hour >= 18 && hour < 21 ? 'evening' : 'night';
/** Lanterns, lit windows and fireflies. */
export const isDark = (tod: TimeOfDay) => tod === 'evening' || tod === 'night';

/** About one of these per this many map px², so a big world is as lively as a small one. */
const PER_AREA = 160_000;

/** Where the fireflies and the dew hang about: seeded, so the same map gets the same ones. */
export function ambientSpots(w: World): { fireflies: Point[]; dew: Point[] } {
  const R = rng(7);
  const n = Math.max(22, Math.round((w.W * w.H) / PER_AREA));
  const spread = (n: number): Point[] =>
    Array.from({ length: n }, () => [Math.round(R() * w.W), Math.round(R() * w.H)]);
  return { fireflies: spread(n), dew: spread(n + 4) };
}

/** Butterflies flutter round points spread over the map (golden-ratio steps: even, and the same every time). */
const flyAt = (i: number): Point => [(0.1 + i * 0.618034) % 1, (0.2 + i * 0.381966 * 1.7) % 1];
const FLIES = (w: World) => Math.max(6, Math.round((w.W * w.H) / 1_000_000));
const POND_SPARKLES: Point[] = [
  [-60, -40],
  [40, -20],
  [-10, 40],
  [70, 30],
];

export interface Mover {
  x: number;
  y: number;
  /** Sprite file name in /village/, without .svg. */
  src: string;
  /** -1 faces left. */
  dir: number;
}

/** Butterflies flutter around fixed points of the map. */
export const butterflies = (w: World, t: number): Mover[] =>
  Array.from({ length: FLIES(w) }, (_, i) => {
    const [fx, fy] = flyAt(i);
    return {
      x: Math.round(fx * w.W + Math.sin(t * 0.05 + i * 2) * 60 + Math.sin(t * 0.13 + i) * 14),
      y: Math.round(fy * w.H + Math.sin(t * 0.08 + i * 3) * 36 + Math.sin(t * 0.21 + i) * 8),
      src: `fly-${i % 2 ? 'blue' : 'orange'}${(t + i) % 2}`,
      dir: 1,
    };
  });

/** Birds cross the map at different heights, left to right, and come round again; a few more on a bigger map. */
export const birds = (w: World, t: number): Mover[] =>
  Array.from({ length: 2 + Math.round((w.W * w.H) / 3_000_000) }, (_, i) => ({
    x: Math.round(((t * 7 + i * 1400) % (w.W + 1000)) - 500),
    y: Math.round(w.H * (0.06 + ((i * 0.37) % 0.8)) + Math.sin(t * 0.1 + i) * 14),
    src: `bird${Math.floor(t / 2 + i) % 2}`,
    dir: 1,
  }));

/** Two ducks circle on the pond, opposite each other. */
export const ducks = (w: World, t: number): Mover[] =>
  [0, 1].map((i) => {
    const a = t * 0.025 + i * Math.PI;
    return {
      x: Math.round(w.pond.x + Math.cos(a) * 82),
      y: Math.round(w.pond.y + 8 + Math.sin(a) * 46),
      src: `duck${Math.floor(t / 3 + i) % 2}`,
      // Swimming anticlockwise on screen: right along the bottom, left along the top.
      dir: Math.sin(a) > 0 ? -1 : 1,
    };
  });

/** Cloud shadows drift across, left to right; more of them on a bigger map. */
export const clouds = (w: World, t: number) =>
  Array.from({ length: 3 + Math.round((w.W * w.H) / 3_000_000) }, (_, i) => ({
    x: Math.round(((t * 1.1 + i * 900) % (w.W + 900)) - 500),
    y: Math.round(w.H * (0.12 + ((i * 0.3) % 0.8))),
    w: 420 - (i % 3) * 60,
    h: 170 - (i % 3) * 20,
  }));

/** Sparkles on the pond, blinking in turn. */
export const pondSparkles = (w: World, t: number) =>
  POND_SPARKLES.map(([dx, dy], i) => ({ x: w.pond.x + dx, y: w.pond.y + dy, on: (t + i * 3) % 8 < 2 }));

/** Fireflies wander round their spot and blink; fewer in the evening. */
export const fireflyFrame = (spots: Point[], tod: TimeOfDay, t: number) =>
  spots.slice(0, tod === 'night' ? spots.length : 10).map(([bx, by], i) => ({
    x: Math.round(bx + Math.sin(t * 0.04 + i) * 30),
    y: Math.round(by + Math.sin(t * 0.06 + i * 2) * 20),
    on: (t + i * 3) % 10 < 6,
  }));

/** Morning dew: sparkles here and there on the grass. */
export const dewFrame = (spots: Point[], t: number) => spots.map(([x, y], i) => ({ x, y, on: (t + i * 2) % 12 < 3 }));

/** A celebration `step`s (of 140 ms) after it started: the hop height and the confetti, empty once it is over. */
export const CHEER_STEPS = 24;
const CONFETTI = [
  'var(--pink)',
  'var(--village-gold)',
  'var(--status-working)',
  'var(--status-your-turn)',
  'var(--purple)',
  'var(--village-paper)',
];
export function cheerFrame(step: number, big: boolean) {
  const hop = step < 12 ? -Math.round(Math.abs(Math.sin(step * 0.55)) * (big ? 18 : 12)) : 0;
  const n = big ? 18 : 9;
  const confetti = Array.from({ length: step < CHEER_STEPS ? n : 0 }, (_, i) => {
    const a = -Math.PI / 2 + (i / (n - 1) - 0.5) * 2.4;
    const v = 4 + (i % 3) * 1.6 + (big ? 1.5 : 0);
    return {
      x: Math.round(Math.cos(a) * v * step),
      y: Math.round(Math.sin(a) * v * step + 0.45 * step * step),
      color: CONFETTI[i % CONFETTI.length],
      opacity: 1 - step / CHEER_STEPS,
    };
  });
  return { hop, confetti };
}
