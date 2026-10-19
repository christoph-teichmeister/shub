import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverSkills, parseFrontmatter } from './index.ts';

function skill(dir: string, body: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), body);
}

test('frontmatter: plain, quoted, folded and continuation values', () => {
  const meta = parseFrontmatter(
    [
      '---',
      'name: "worktree-start"',
      'description: >',
      '  Start work on a',
      '  worktree.',
      "other: 'it''s'",
      'long: first part',
      '  second part',
      '---',
      'body',
    ].join('\n'),
  );
  assert.equal(meta.name, 'worktree-start');
  assert.equal(meta.description, 'Start work on a worktree.');
  assert.equal(meta.other, "it's");
  assert.equal(meta.long, 'first part second part');
});

test('discovers project, global and plugin skills; project shadows global', () => {
  const root = mkdtempSync(join(tmpdir(), 'shub-skills-'));
  const home = join(root, 'home');
  const project = join(root, 'proj');
  skill(join(project, '.claude/skills/deploy'), '---\nname: deploy\ndescription: project deploy\n---\n');
  skill(join(home, '.claude/skills/deploy'), '---\nname: deploy\ndescription: global deploy\n---\n');
  skill(join(home, '.claude/skills/notes'), 'no frontmatter');
  skill(join(home, '.claude/plugins/cache/market/caveman/1.0.0/skills/caveman'), '---\ndescription: talk short\n---\n');
  const skills = discoverSkills(project, home);
  assert.deepEqual(
    skills.map((s) => [s.name, s.scope, s.description]),
    [
      ['deploy', 'project', 'project deploy'],
      ['notes', 'global', ''],
      ['caveman:caveman', 'plugin', 'talk short'],
    ],
  );
});
