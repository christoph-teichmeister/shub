// Tiny router: modules register handlers for the routes in shared/api.ts.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ClientKind, Right } from '../../shared/api.ts';

/** Who is calling. Resolved by the auth module before a handler runs. */
export interface Caller {
  kind: ClientKind;
  /** "chris", "session:<id>", "plugin:<name>", "cli". */
  id: string;
  rights: Right[];
  /** The paired device of a cookie user; absent for Bearer callers. */
  deviceId?: string;
}

export interface Request {
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  caller: Caller;
  raw: IncomingMessage;
  json<T = unknown>(): Promise<T>;
  body(): Promise<Buffer>;
}

export type Handler = (req: Request, res: ServerResponse) => Promise<unknown> | unknown;

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
  /** Routes that need no login (health, login, pairing redeem, hooks with their own token). */
  public: boolean;
}

export class Router {
  #routes: Route[] = [];

  /** `spec` is a value of ROUTES, e.g. "GET /api/sessions/:id". */
  add(spec: string, handler: Handler, options: { public?: boolean } = {}): void {
    const [method, path] = spec.split(' ');
    const keys: string[] = [];
    const pattern = new RegExp(
      '^' +
        path.replace(/:([a-zA-Z]+)/g, (_, key: string) => {
          keys.push(key);
          return '([^/]+)';
        }) +
        '$',
    );
    this.#routes.push({ method, pattern, keys, handler, public: options.public ?? false });
  }

  match(method: string, path: string): { route: Route; params: Record<string, string> } | null {
    for (const route of this.#routes) {
      if (route.method !== method) continue;
      const m = route.pattern.exec(path);
      if (!m) continue;
      const params: Record<string, string> = {};
      route.keys.forEach((key, i) => (params[key] = decodeURIComponent(m[i + 1])));
      return { route, params };
    }
    return null;
  }
}

export function readBody(req: IncomingMessage, limit = 20 * 1024 * 1024): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, 'body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export function sendJson(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value ?? null);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

export function requireRight(caller: Caller, right: Right): void {
  if (!caller.rights.includes(right)) throw new HttpError(403, `missing right: ${right}`);
}

/** Holders of the access token only: the browser user or the CLI with the token file. */
export function requireUser(caller: Caller): void {
  if (caller.kind !== 'user' && caller.kind !== 'cli') throw new HttpError(403, 'only the user may do this');
}
