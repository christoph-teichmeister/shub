// Host-to-host sync of the device group over the tailnet. Every host has its own ECDSA key and is a `device:<id>`
// item of kind host (with its tailnet URL) in the group; a host signs in to another by signing a challenge, and the
// other checks its own copy of the group. Changes are pushed at once; everything missed is pulled on start and on a timer.
import {
  createPrivateKey,
  type KeyObject,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
  verify,
} from 'node:crypto';
import { hostname } from 'node:os';
import type { HostInfo, HostPeer, SyncSettings } from '../../shared/api.ts';
import { HttpError } from '../api/router.ts';
import { forSync, type GroupItem, type GroupStore } from './index.ts';

export const ROUND_MS = 5 * 60_000;
const CHALLENGE_TTL_MS = 60_000;
const TOKEN_TTL_MS = 5 * 60_000;
const PUSH_DELAY_MS = 300;
const REQUEST_TIMEOUT_MS = 10_000;

/** What a host signs: the nonce bound to its purpose. */
export const hostChallenge = (nonce: string): string => `shub-host:${nonce}`;

/** The body of a host's `device:<id>` item. */
interface HostBody {
  name: string;
  kind: 'host';
  publicKey: { kty: string; crv: string; x: string; y: string };
  url?: string;
}

export interface SyncDeps {
  /** What this host syncs (local.json); read per call, the user can change it any time. */
  sync(): SyncSettings | undefined;
  /** This host's own tailnet URL, if it has one. */
  url(): string | undefined;
  /** Items from another host were merged: reload what is built from them. */
  onMerged(): void;
  /** The transcript calls of other hosts (manifest, chunk); only reached by a signed-in group member. */
  serve?(action: 'manifest' | 'chunk', body: Record<string, unknown>): Promise<unknown>;
  /** After every round of pulling and pushing: the background work that needs the hosts (transcript copy). */
  onRound?(): void;
  fetch?: typeof fetch;
  name?: string;
}

type Action = 'challenge' | 'session' | 'pull' | 'push' | 'manifest' | 'chunk';

export class HostSync {
  #group: GroupStore;
  #deps: SyncDeps;
  #key: KeyObject;
  #publicKey: HostBody['publicKey'];
  #challenges = new Map<string, { hostId: string; expires: number }>();
  #tokens = new Map<string, { hostId: string; expires: number }>(); // tokens other hosts hold for us
  #out = new Map<string, string>(); // tokens we hold for other hosts, by their id
  #status = new Map<string, Pick<HostPeer, 'state' | 'since'>>();
  #dirty = new Set<string>();
  #timers: ReturnType<typeof setTimeout | typeof setInterval>[] = [];

  constructor(group: GroupStore, deps: SyncDeps) {
    this.#group = group;
    this.#deps = deps;
    let pem = group.meta('hostKey');
    if (!pem) {
      const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
      pem = group.setMeta('hostKey', privateKey.export({ type: 'pkcs8', format: 'pem' }) as string);
    }
    this.#key = createPrivateKey(pem);
    const { kty, crv, x, y } = createPublicKey(this.#key).export({ format: 'jwk' });
    this.#publicKey = { kty, crv, x, y } as HostBody['publicKey'];
    group.onChange((key) => {
      this.#dirty.add(key);
      const timer = setTimeout(() => void this.flush(), PUSH_DELAY_MS);
      timer.unref();
      this.#timers.push(timer);
    });
  }

  get hostId(): string {
    return this.#group.hostId;
  }

  /** Revoked: our own host item is a tombstone. Revoke wins, so a revoked host never makes itself a member again. */
  get revoked(): boolean {
    return !!this.#group.get(`device:${this.hostId}`)?.deleted;
  }

  /** Make this host a member of the group, with the URL it can be reached at. */
  announce(): void {
    if (this.revoked) return;
    const body: HostBody = { name: this.#deps.name ?? hostname(), kind: 'host', publicKey: this.#publicKey };
    const url = this.#deps.url();
    if (url) body.url = url;
    const have = this.#group.get(`device:${this.hostId}`);
    if (!have || JSON.stringify(have.body) !== JSON.stringify(body)) this.#group.put(`device:${this.hostId}`, body);
  }

  /** What another host needs to add this one to its group (the join step, see join()). */
  info(): HostInfo {
    this.announce();
    const body = this.#group.get(`device:${this.hostId}`)!.body as HostBody;
    return { id: this.hostId, name: body.name, url: body.url, publicKey: body.publicKey };
  }

  /**
   * Join step: the user's approved browser carried this host's key and URL from the other host. Adds the other host
   * to our group (never replacing a key we already know) and syncs at once, so both sides merge their items.
   * Whoever calls this has been checked as the consent (see server/auth: a trusted host or an approved browser).
   */
  join(host: unknown): void {
    const h = host as Partial<HostInfo> | undefined;
    let url: string | undefined;
    try {
      const u = new URL(String(h?.url));
      if (/^https?:$/.test(u.protocol)) url = u.origin;
    } catch {}
    const key = h?.publicKey;
    const valid =
      typeof h?.id === 'string' &&
      /^[\w-]{8,64}$/.test(h.id) &&
      typeof h.name === 'string' &&
      url &&
      key?.kty === 'EC' &&
      key.crv === 'P-256' &&
      !('d' in key);
    if (!valid) throw new HttpError(400, 'bad host');
    try {
      createPublicKey({ key: { kty: key.kty, crv: key.crv, x: key.x, y: key.y }, format: 'jwk' });
    } catch {
      throw new HttpError(400, 'bad host key');
    }
    if (h.id === this.hostId || this.revoked) throw new HttpError(409, 'cannot join this host to itself');
    const known = this.#group.get(`device:${h.id}`);
    if (known?.deleted) throw new HttpError(409, 'host was revoked');
    const knownKey = (known?.body as HostBody | null)?.publicKey;
    if (knownKey && (knownKey.x !== key.x || knownKey.y !== key.y)) throw new HttpError(409, 'host key differs');
    this.#group.put(`device:${h.id}`, {
      name: String(h.name).slice(0, 60),
      kind: 'host',
      publicKey: { kty: key.kty, crv: key.crv, x: key.x, y: key.y },
      url,
    } satisfies HostBody);
    void this.round();
  }

  start(): void {
    this.announce();
    void this.round();
    const timer = setInterval(() => void this.round(), ROUND_MS);
    timer.unref();
    this.#timers.push(timer);
  }

  stop(): void {
    this.#timers.forEach((t) => clearTimeout(t));
    this.#timers = [];
  }

  // ---------- serving the other hosts ----------

  /** A live host item of the group; revoked or unknown hosts have none. */
  #member(hostId: unknown): HostBody | undefined {
    const item = typeof hostId === 'string' ? this.#group.get(`device:${hostId}`) : undefined;
    const body = item?.body as HostBody | null | undefined;
    return item && !item.deleted && body?.kind === 'host' ? body : undefined;
  }

  /** The handler behind the group routes; throws HttpError. `token` is the Bearer token of pull and push. */
  handle(action: Action, body: Record<string, unknown>, token?: string): unknown | Promise<unknown> {
    const now = Date.now();
    if (action === 'challenge') {
      if (!this.#member(body.hostId)) throw new HttpError(403, 'not a host of this group');
      for (const [n, c] of this.#challenges) if (c.expires < now) this.#challenges.delete(n);
      const nonce = randomBytes(32).toString('base64url');
      this.#challenges.set(nonce, { hostId: body.hostId as string, expires: now + CHALLENGE_TTL_MS });
      return { nonce };
    }
    if (action === 'session') {
      const nonce = typeof body.nonce === 'string' ? body.nonce : '';
      const challenge = this.#challenges.get(nonce);
      this.#challenges.delete(nonce);
      const member = this.#member(body.hostId);
      if (!challenge || challenge.expires < now || challenge.hostId !== body.hostId || !member)
        throw new HttpError(401, 'unknown or expired challenge');
      const ok =
        typeof body.signature === 'string' &&
        verify(
          'sha256',
          Buffer.from(hostChallenge(nonce)),
          { key: createPublicKey({ key: member.publicKey, format: 'jwk' }), dsaEncoding: 'ieee-p1363' },
          Buffer.from(body.signature, 'base64url'),
        );
      if (!ok) throw new HttpError(401, 'bad signature');
      for (const [t, e] of this.#tokens) if (e.expires < now) this.#tokens.delete(t);
      const issued = randomBytes(32).toString('hex');
      this.#tokens.set(issued, { hostId: challenge.hostId, expires: now + TOKEN_TTL_MS });
      return { token: issued };
    }
    const entry = token ? this.#tokens.get(token) : undefined;
    if (!entry || entry.expires < now) throw new HttpError(401, 'sign in first');
    // Checked on every call: a host revoked while it holds a token is out at once.
    if (!this.#member(entry.hostId)) throw new HttpError(403, 'not a host of this group');
    if (action === 'manifest' || action === 'chunk') return this.#deps.serve!(action, body);
    return action === 'pull' ? { items: this.#outgoing() } : this.#accept(body.items);
  }

  /** Every item this host is willing to send: switched-off categories stay home. */
  #outgoing(): GroupItem[] {
    return this.#group.list().flatMap((i) => forSync(i, this.#deps.sync()) ?? []);
  }

  #accept(items: unknown): { changed: number; conflicts: number } {
    if (!Array.isArray(items)) throw new HttpError(400, 'items must be a list');
    let changed = 0;
    let conflicts = 0;
    for (const raw of items as GroupItem[]) {
      const valid =
        typeof raw?.key === 'string' &&
        raw.key.includes(':') &&
        typeof raw.deleted === 'boolean' &&
        raw.version &&
        Object.values(raw.version).every((n) => Number.isInteger(n));
      if (!valid) throw new HttpError(400, 'bad item');
      const item = forSync(raw, this.#deps.sync());
      if (!item) continue;
      const order = this.#group.merge(item);
      if (order === 'newer') changed++;
      if (order === 'conflict') conflicts++;
    }
    if (changed || conflicts) this.#deps.onMerged();
    return { changed, conflicts };
  }

  // ---------- dialing the other hosts ----------

  /** The other hosts the group lists, with how the last contact went. */
  peers(): HostPeer[] {
    return this.#group
      .list()
      .filter((i) => i.key !== `device:${this.hostId}` && this.#member(i.key.slice('device:'.length)))
      .map((i) => {
        const body = i.body as HostBody;
        const id = i.key.slice('device:'.length);
        return { id, name: body.name, url: body.url, state: 'offline', ...this.#status.get(id) } as HostPeer;
      });
  }

  async #post(url: string, action: Action, body: unknown, token?: string): Promise<any> {
    const res = await (this.#deps.fetch ?? fetch)(`${url}/api/group/${action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new HttpError(res.status, String(json.error ?? res.statusText));
    return json;
  }

  /** A signed-in call to another host; signs in first, and again once when the token ran out. */
  async call(peer: HostPeer, action: 'pull' | 'push' | 'manifest' | 'chunk', body: unknown): Promise<any> {
    for (let retry = 0; ; retry++) {
      let token = this.#out.get(peer.id);
      if (!token) {
        const { nonce } = await this.#post(peer.url!, 'challenge', { hostId: this.hostId });
        const signature = sign('sha256', Buffer.from(hostChallenge(nonce)), {
          key: this.#key,
          dsaEncoding: 'ieee-p1363',
        }).toString('base64url');
        token = (await this.#post(peer.url!, 'session', { hostId: this.hostId, nonce, signature })).token as string;
        this.#out.set(peer.id, token);
      }
      try {
        return await this.#post(peer.url!, action, body, token);
      } catch (err) {
        if ((err as HttpError).status !== 401 || retry) throw err;
        this.#out.delete(peer.id); // the token ran out: sign in again once
      }
    }
  }

  #fail(peer: HostPeer): void {
    this.#out.delete(peer.id);
    this.#status.set(peer.id, {
      state: 'offline',
      since: this.#status.get(peer.id)?.since ?? new Date().toISOString(),
    });
  }

  /** Pull what the peer has and push what we have; both sides end with the newer of every item. */
  async #exchange(peer: HostPeer): Promise<void> {
    this.#status.set(peer.id, { state: 'catching-up', since: this.#status.get(peer.id)?.since });
    try {
      const pulled = this.#accept((await this.call(peer, 'pull', {})).items);
      // ponytail: sends every item, not just the ones the peer lacks; fine for settings, narrow it for transcripts
      const pushed = await this.call(peer, 'push', { items: this.#outgoing() });
      this.#status.set(peer.id, { state: pulled.conflicts || pushed.conflicts ? 'conflict' : 'in-sync' });
    } catch {
      this.#fail(peer);
    }
  }

  /** Pull from and push to every host we can dial: on start and every few minutes. */
  async round(): Promise<void> {
    this.announce();
    if (this.revoked) return;
    await Promise.all(
      this.peers()
        .filter((p) => p.url)
        .map((p) => this.#exchange(p)),
    );
    this.#deps.onRound?.();
  }

  /** Push the items changed since the last flush to every reachable host; one that was offline gets a full catch-up. */
  async flush(): Promise<void> {
    const items = [...this.#dirty].flatMap((k) => {
      const item = this.#group.get(k);
      return (item && forSync(item, this.#deps.sync())) || [];
    });
    this.#dirty.clear();
    if (!items.length) return;
    await Promise.all(
      this.peers()
        .filter((p) => p.url)
        .map(async (peer) => {
          if (peer.state !== 'in-sync' && peer.state !== 'conflict') return this.#exchange(peer);
          try {
            const pushed = await this.call(peer, 'push', { items });
            if (pushed.conflicts) this.#status.set(peer.id, { state: 'conflict' });
          } catch {
            this.#fail(peer);
          }
        }),
    );
  }
}
