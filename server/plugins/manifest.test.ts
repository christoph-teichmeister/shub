import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_ENTRIES, MAX_STRING, sanitizeSection, validateManifest } from './manifest.ts';

const good = {
  name: 'hello',
  version: '0.1.0',
  start: ['python3', 'plugin.py'],
  rights: ['read', 'ui.contribute'],
  contributes: { sidebarSections: [{ id: 'hello', title: 'Hello' }], settingsActions: [{ id: 'log', label: 'Log' }] },
};

test('valid manifest passes', () => {
  const m = validateManifest(good);
  assert.equal(m.name, 'hello');
  assert.deepEqual(m.contributes?.sidebarSections, [{ id: 'hello', title: 'Hello' }]);
});

test('invalid manifests are rejected with the reason', () => {
  const bad: [unknown, RegExp][] = [
    [null, /JSON object/],
    [{ ...good, name: 'Hello' }, /name/],
    [{ ...good, name: '../x' }, /name/],
    [{ ...good, version: '' }, /version/],
    [{ ...good, start: [] }, /start/],
    [{ ...good, start: 'python3 plugin.py' }, /start/],
    [{ ...good, start: ['python3', ''] }, /start/],
    [{ ...good, rights: ['root'] }, /rights/],
    [{ ...good, rights: ['read', 'read'] }, /duplicates/],
    [{ ...good, extra: 1 }, /unknown key "extra"/],
    [{ ...good, contributes: { menus: [] } }, /unknown key "menus"/],
    [{ ...good, contributes: { sidebarSections: [{ id: 'a b', title: 'x' }] } }, /id must match/],
    [{ ...good, contributes: { sidebarSections: [{ id: 'a', title: '' }] } }, /title/],
    [
      {
        ...good,
        contributes: {
          settingsActions: [
            { id: 'a', label: 'x' },
            { id: 'a', label: 'y' },
          ],
        },
      },
      /duplicated/,
    ],
    [{ ...good, contributes: { settingsActions: {} } }, /must be an array/],
  ];
  for (const [value, re] of bad) assert.throws(() => validateManifest(value), re, JSON.stringify(value));
});

test('sanitizeSection caps entries and strings', () => {
  const entries = Array.from({ length: 80 }, (_, i) => ({ id: String(i), title: 'x'.repeat(500) }));
  const s = sanitizeSection({ entries, badge: { text: '2 need you', tone: 'needs-you' } });
  assert.equal(s.entries.length, MAX_ENTRIES);
  assert.equal(s.entries[0].title.length, MAX_STRING);
  assert.deepEqual(s.badge, { text: '2 need you', tone: 'needs-you' });
  assert.equal(sanitizeSection({ entries: [] }).badge, null);
});

test('sanitizeSection allows only http(s) urls and known tones', () => {
  const ok = sanitizeSection({ entries: [{ id: 'a', title: 'A', url: 'https://example.com/x', tone: 'done' }] });
  assert.equal(ok.entries[0].url, 'https://example.com/x');
  for (const url of ['javascript:alert(1)', 'file:///etc/passwd', '/relative', 'data:text/html,x']) {
    assert.throws(() => sanitizeSection({ entries: [{ id: 'a', title: 'A', url }] }), /url/, url);
  }
  assert.throws(() => sanitizeSection({ entries: [{ id: 'a', title: 'A', tone: 'red' }] }), /tone/);
  assert.throws(() => sanitizeSection({ entries: [{ id: 1, title: 'A' }] }), /id/);
  assert.throws(() => sanitizeSection({}), /entries/);
  assert.throws(() => sanitizeSection({ entries: [], badge: { text: 'x', tone: 'loud' } }), /badge.tone/);
});
