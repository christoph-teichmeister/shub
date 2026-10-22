import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDraft, spans } from '../web/src/lib/draft.ts';

test('inline: code, nested bold and italic, strike, and links that are http(s) only', () => {
  assert.deepEqual(spans('a **b *c* b** `d` ~~e~~'), [
    { text: 'a ' },
    { text: 'b ', bold: true },
    { text: 'c', bold: true, italic: true },
    { text: ' b', bold: true },
    { text: ' ' },
    { text: 'd', code: true },
    { text: ' ' },
    { text: 'e', strike: true },
  ]);
  assert.deepEqual(spans('see [the **post**](https://x.test/a) or [bad](javascript:x)'), [
    { text: 'see ' },
    { text: 'the ', href: 'https://x.test/a' },
    { text: 'post', href: 'https://x.test/a', bold: true },
    { text: ' or ' },
    { text: '[bad](javascript:x)' },
  ]);
  // snake_case and a lone star are no emphasis; "#58" is no PR link here.
  assert.deepEqual(spans('my_var_name 2 * 3 #58'), [{ text: 'my_var_name 2 * 3 #58' }]);
});

test('blocks: headings, paragraphs, nested and task lists, ordered lists, quotes, code, rules', () => {
  const md = [
    '# Title',
    'one',
    'two',
    '',
    '- a',
    '  - b',
    '- [x] done',
    '1. first',
    '2) second',
    '> quoted',
    '> more',
    '```ts',
    '# not a heading',
    '```',
    '---',
  ].join('\n');
  assert.deepEqual(parseDraft(md), [
    { kind: 'heading', level: 1, text: [{ text: 'Title' }] },
    { kind: 'p', text: [{ text: 'one' }, { text: ' ' }, { text: 'two' }] },
    {
      kind: 'list',
      ordered: false,
      items: [
        { text: [{ text: 'a' }], depth: 0 },
        { text: [{ text: 'b' }], depth: 1 },
        { text: [{ text: 'done' }], depth: 0, checked: true },
      ],
    },
    {
      kind: 'list',
      ordered: true,
      items: [
        { text: [{ text: 'first' }], depth: 0 },
        { text: [{ text: 'second' }], depth: 0 },
      ],
    },
    { kind: 'quote', text: [{ text: 'quoted' }, { text: ' ' }, { text: 'more' }] },
    { kind: 'code', text: '# not a heading', lang: 'ts' },
    { kind: 'rule' },
  ]);
});
