import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importCandidates, mainProjectPath } from './import.ts';

test('worktree paths merge into their main project', () => {
  assert.equal(mainProjectPath('/p/app/.claude/worktrees/feat-x'), '/p/app');
  assert.equal(mainProjectPath('/p/app/.worktrees/feat-x/sub'), '/p/app');
  assert.equal(mainProjectPath('/p/app'), '/p/app');
});

test('import candidates: cwd from transcripts, merged worktrees, pinned vs dormant, gone paths skipped', () => {
  const root = mkdtempSync(join(tmpdir(), 'shub-import-'));
  const claude = join(root, 'claude');
  const app = join(root, 'my.app');
  const old = join(root, 'old');
  mkdirSync(join(app, '.claude', 'worktrees', 'wt'), { recursive: true });
  mkdirSync(old);
  const now = Date.now();
  const transcript = (folder: string, file: string, cwd: string, ageDays: number) => {
    mkdirSync(join(claude, folder), { recursive: true });
    const path = join(claude, folder, file);
    writeFileSync(path, `{"type":"x"}\n{"cwd":${JSON.stringify(cwd)},"type":"user"}\n`);
    const t = (now - ageDays * 86400_000) / 1000;
    utimesSync(path, t, t);
  };
  transcript(app.replace(/[/.]/g, '-'), 'a.jsonl', app, 1);
  transcript(app.replace(/[/.]/g, '-'), 'b.jsonl', app, 2);
  transcript('wt', 'c.jsonl', join(app, '.claude', 'worktrees', 'wt'), 0);
  transcript('old', 'd.jsonl', old, 30);
  transcript('gone', 'e.jsonl', join(root, 'gone'), 0);
  transcript('known', 'f.jsonl', join(root), 0);

  const candidates = importCandidates(claude, new Set([root]), now);
  assert.deepEqual(
    candidates.map((c) => [c.name, c.sessions, c.suggested]),
    [
      ['my.app', 3, 'pinned'],
      ['old', 1, 'dormant'],
    ],
  );
});
