import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { BUILT_IN_THEMES, resolveTokens, TOKEN_GROUPS, TOKEN_NAMES } from '../web/src/lib/tokens/tokens.ts';

test('the theme editor lists every token once', () => {
  const listed = TOKEN_GROUPS.flatMap((g) => g.tokens.map((t) => t.name));
  assert.deepEqual([...listed].sort(), [...TOKEN_NAMES].sort());
});

test('the theme preview shows every token', () => {
  const src = [
    'views/ThemeEditor',
    'components/Button/Button',
    'components/StatusBadge/StatusBadge',
    'components/Wordmark/Wordmark',
  ]
    .map((f) => readFileSync(new URL(`../web/src/lib/${f}.svelte`, import.meta.url), 'utf8'))
    .join('\n');
  // The ANSI swatches loop over the colour names: `var(--term-{c})`, `var(--term-bright-{c})`.
  const ansi = /^term-(bright-)?(black|red|green|yellow|blue|magenta|cyan|white)$/;
  const used = (n: string) =>
    src.includes(`var(--${n})`) || (ansi.test(n) && src.includes(`var(--${n.replace(/[a-z]+$/, '{c}')})`));
  assert.deepEqual(
    TOKEN_NAMES.filter((n) => !used(n)),
    [],
  );
});

test('terminal colours follow their UI colour until set', () => {
  const monokai = BUILT_IN_THEMES[0];
  assert.equal(resolveTokens(monokai, { pink: '#123456' })['term-red'], '#123456');
  assert.equal(resolveTokens(monokai, { pink: '#123456', 'term-red': '#ff0000' })['term-red'], '#ff0000');
});
