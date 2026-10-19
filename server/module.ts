// Every server module (server/<name>/index.ts) exports `create(deps)` returning a ShubModule.
import type { Server } from 'node:http';
import type { Router } from './api/router.ts';

export interface ShubModule {
  name: string;
  /** Register HTTP routes from shared/api.ts ROUTES. */
  routes?(router: Router): void;
  /** Called once the HTTP server listens (e.g. to attach WebSocket upgrades). */
  attach?(server: Server): void;
  /** Background work after startup (watchers, plugin processes, restore checks). */
  start?(): Promise<void> | void;
  stop?(): Promise<void> | void;
}
