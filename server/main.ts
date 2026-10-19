// Entry point: build the context, create every module, wire their services, start listening.
// Each server/<name>/index.ts exports `create(ctx, services)` -> { module, service? }.
// Services are looked up at call time through `services`, so creation order only matters for startup work.
import { createContext } from './context.ts';
import type { ShubModule } from './module.ts';
import type { Services } from './services.ts';
import * as state from './state/index.ts';
import * as config from './config/index.ts';
import * as auth from './auth/index.ts';
import * as permissions from './permissions/index.ts';
import * as notify from './notify/index.ts';
import * as sessions from './sessions/index.ts';
import * as hooks from './hooks/index.ts';
import * as docker from './docker/index.ts';
import * as skills from './skills/index.ts';
import * as projects from './projects/index.ts';
import * as plugins from './plugins/index.ts';
import * as updates from './updates/index.ts';
import * as api from './api/index.ts';

// Started from a git hook or another repo's tooling, GIT_DIR and friends would point every `git` call shub
// and its sessions make at that repo instead of the folder they name.
for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_PREFIX'])
  delete process.env[key];

const ctx = createContext();
const services = {} as Services;
const modules: ShubModule[] = [];

function use<K extends keyof Services>(key: K | null, created: { module: ShubModule; service?: Services[K] }): void {
  modules.push(created.module);
  if (key && created.service) services[key] = created.service;
}

use('state', state.create(ctx, services));
use('config', config.create(ctx, services));
use('auth', auth.create(ctx, services));
use('permissions', permissions.create(ctx, services));
use('notify', notify.create(ctx, services));
use('sessions', sessions.create(ctx, services));
use(null, hooks.create(ctx, services));
use('docker', docker.create(ctx, services));
use('skills', skills.create(ctx, services));
use(null, projects.create(ctx, services));
use('plugins', plugins.create(ctx, services));
use(null, updates.create(ctx, services));

// The api module owns the HTTP server: auth check, routing, events WebSocket, static web app.
const server = await api.listen(ctx, services, modules);

for (const m of modules) await m.start?.();
console.log(`shub listening on http://${ctx.host}:${ctx.port}`);

async function shutdown(): Promise<void> {
  for (const m of [...modules].reverse()) await m.stop?.();
  server.close();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
