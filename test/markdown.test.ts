import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseMarkdown } from '../web/src/lib/markdown.ts';

test('release notes: headings, one list per run of items, paragraphs, code and PR links', () => {
  const md = '### Fixes\n\n- park a `session` (#58)\n- other\n\nChanges since\nv1.';
  assert.deepEqual(parseMarkdown(md), [
    { kind: 'heading', level: 3, text: [{ text: 'Fixes' }] },
    {
      kind: 'list',
      items: [
        [{ text: 'park a ' }, { text: 'session', code: true }, { text: ' (' }, { text: '#58', pr: 58 }, { text: ')' }],
        [{ text: 'other' }],
      ],
    },
    { kind: 'p', text: [{ text: 'Changes since' }, { text: ' ' }, { text: 'v1.' }] },
  ]);
});
