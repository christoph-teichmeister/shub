import assert from 'node:assert/strict';
import { test } from 'node:test';
import { liveShells } from './liveness.ts';

const ps = (shell: string) => `
 10 1 tmux -L shub
 20 10 /bin/bash -l -c claude "$@"
 30 20 claude --resume abc
 31 30 npm exec @playwright/mcp@latest
 32 30 /bin/bash -c source /home/u/.claude/shell-snapshots/s.sh && eval '${shell}'
 33 99 /bin/bash -c source /home/u/.claude/shell-snapshots/s.sh && eval 'sleep 5'`;

test('liveShells counts background shells of this pane only, not MCP servers or servers', () => {
  assert.equal(liveShells(ps('claude -p review'), 20), 1);
  assert.equal(liveShells(ps('npm run dev'), 20), 0);
  assert.equal(liveShells('', 20), 0);
});
