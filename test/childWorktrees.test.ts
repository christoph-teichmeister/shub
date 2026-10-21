import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ChildWorktree, Session } from '../shared/api.ts';
import { childLabel, childStart, placeChildren } from '../web/src/lib/children.ts';

const child = (over: Partial<ChildWorktree> = {}): ChildWorktree => ({
  projectId: 'p',
  path: '/r/.claude/worktrees/rev-12',
  name: 'rev-12',
  branch: '',
  state: 'detached',
  lastCommitAt: null,
  originSessionId: 'p-1',
  conversation: null,
  busy: false,
  ...over,
});
const session = (id: string, cwd: string, kind: Session['kind'] = 'claude') => ({ id, cwd, kind }) as Session;

test('a click resumes the newest conversation in the worktree, else starts fresh; never while busy', () => {
  const fresh = { projectId: 'p', kind: 'claude', cwd: '/r/.claude/worktrees/rev-12', name: 'rev-12' };
  assert.deepEqual(childStart(child()), fresh);
  const id = '0b0e4c2a-6a39-4d55-9f7e-0c6a1d2c3b4a';
  assert.deepEqual(childStart(child({ conversation: id })), { ...fresh, resumeClaudeSessionId: id });
  assert.equal(childStart(child({ conversation: id, busy: true })), null);
  assert.equal(childStart(child({ state: 'folder-gone' })), null);
  assert.equal(childLabel(child({ busy: true })), 'working');
  assert.equal(childLabel(child({ state: 'remote-gone' })), 'remote gone');
});

test('children sit under their live creator, else under the project; sessions in them leave the top level', () => {
  const a = child({ name: 'a', path: '/r/wt/a' });
  const b = child({ name: 'b', path: '/r/wt/b', originSessionId: 'p-gone' });
  const sessions = [session('p-1', '/r/wt/a'), session('p-2', '/r/wt/a/sub'), session('p-3', '/r/wt/b', 'shell')];
  const { byOrigin, orphans, nested } = placeChildren([a, b], sessions);
  assert.deepEqual(byOrigin.get('p-1'), [a]);
  assert.deepEqual(orphans.get('p'), [b]);
  assert.deepEqual([...nested], ['p-2']); // the creator itself and shells stay where they are
});
