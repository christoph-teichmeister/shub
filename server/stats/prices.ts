// USD per million tokens, from https://platform.claude.com/docs/en/about-claude/pricing (checked 2026-11-24).
import type { TokenSums } from '../../shared/api.ts';

interface Price {
  input: number;
  output: number;
  cacheWrite: number; // 5-minute write
  cacheRead: number;
}

/** Longest matching prefix wins, so dated ids (claude-haiku-4-5-20251001) find their family. */
const PRICES: [string, Price][] = [
  ['claude-fable-5-2', { input: 8, output: 40, cacheWrite: 10, cacheRead: 0.2 }],
  ['claude-mythos-5-2', { input: 8, output: 40, cacheWrite: 10, cacheRead: 0.2 }],
  ['claude-fable-5-1', { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 0.25 }],
  ['claude-mythos-5-1', { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 0.25 }],
  ['claude-fable-5', { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 1 }],
  ['claude-mythos-5', { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 1 }],
  ['claude-opus-5-5', { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 }],
  ['claude-opus-5', { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 }],
  ['claude-opus-4-8', { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 }],
  ['claude-opus-4-7', { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 }],
  ['claude-opus-4-6', { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 }],
  ['claude-opus-4-5', { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 }],
  ['claude-opus-4', { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 }], // 4 and 4.1
  ['claude-sonnet-5-5', { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.1 }],
  ['claude-sonnet-5', { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 }],
  ['claude-sonnet-4', { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 }],
  // ponytail: Haiku 5.5 is priced for prompts up to 100K; prompts over it cost 5x, which per-day sums cannot see.
  ['claude-haiku-5-5', { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 }],
  ['claude-haiku-4-5', { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 }],
];
PRICES.sort((a, b) => b[0].length - a[0].length);

/**
 * Cost in USD at standard API rates, i.e. what the tokens would cost on the pay-per-token API; on a subscription
 * it is a yardstick, not a bill. Unknown models cost 0.
 * ponytail: every cache write is priced as a 5-minute write (1-hour writes cost 1.6x more).
 */
export function costUsd(model: string, t: TokenSums): number {
  const p = PRICES.find(([prefix]) => model.startsWith(prefix))?.[1];
  if (!p) return 0;
  return (t.input * p.input + t.output * p.output + t.cacheCreate * p.cacheWrite + t.cacheRead * p.cacheRead) / 1e6;
}
