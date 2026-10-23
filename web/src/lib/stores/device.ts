// A browser's or phone's sign-in on each of its machines (docs/SECURITY.md): per machine a P-256 key pair whose private half
// cannot be read out, kept in IndexedDB; every few minutes the app signs a challenge and gets a short-lived
// token, held in memory only.
import { ROUTES } from '../../../../shared/api.ts';

export interface Machine {
  /** https://host[:port] of that machine's shub; this page's own origin for the machine the app came from. */
  origin: string;
  deviceId: string;
  keys: CryptoKeyPair;
  /** Its hostname (GET /api/health `machine`), or the host part of the origin. */
  name: string;
}

/** The device exists but nobody approved it yet. */
export class PendingError extends Error {}

const DB = 'shub-device';
const STORE = 'machines';
const RENEW_BEFORE_MS = 30_000;
const SELECTED = 'shub.machine';

export const here = location.origin;

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      // v1 kept one record "self" for this origin; v2 keeps one per machine.
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'origin' });
      if (req.result.objectStoreNames.contains('device')) {
        const old = req.transaction!.objectStore('device').get('self');
        old.onsuccess = () => {
          const v = old.result as { deviceId: string; keys: CryptoKeyPair } | undefined;
          if (v) req.transaction!.objectStore(STORE).put({ origin: here, name: location.hostname, ...v });
          req.result.deleteObjectStore('device');
        };
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const store = (await db()).transaction(STORE, mode).objectStore(STORE);
  return new Promise((resolve, reject) => {
    const req = run(store);
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

let all: Promise<Machine[]> | undefined;
const tokens = new Map<string, { value: string; expires: number }>();
const signingIn = new Map<string, Promise<string>>();

export const machines = (): Promise<Machine[]> =>
  (all ??= tx<Machine[]>('readonly', (s) => s.getAll()).catch(() => []));
const find = async (origin: string) => (await machines()).find((m) => m.origin === origin);

/** The machine the app shows; this page's own one unless another was picked and is still paired. */
export async function selectedOrigin(): Promise<string> {
  const picked = localStorage.getItem(SELECTED);
  return picked && (await find(picked)) ? picked : here;
}

export function select(origin: string): void {
  if (origin === here) localStorage.removeItem(SELECTED);
  else localStorage.setItem(SELECTED, origin);
}

/** New key pair for pairing; only the public half ever leaves the phone. */
export async function newKeys(): Promise<{ keys: CryptoKeyPair; publicKey: JsonWebKey }> {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  return { keys, publicKey: await crypto.subtle.exportKey('jwk', keys.publicKey) };
}

export async function rememberDevice(machine: Machine): Promise<void> {
  await tx('readwrite', (s) => s.put(machine));
  all = undefined;
  tokens.delete(machine.origin);
}

export async function forgetDevice(origin = here): Promise<void> {
  await tx('readwrite', (s) => s.delete(origin)).catch(() => {});
  all = undefined;
  tokens.delete(origin);
}

async function post<T>(origin: string, route: string, body: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(origin + route.split(' ')[1], {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json().catch(() => ({}))) as T };
}

const b64url = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

async function signIn({ origin, deviceId, keys }: Machine): Promise<string> {
  const challenge = await post<{ nonce?: string }>(origin, ROUTES.authChallenge, { deviceId });
  if (challenge.status === 409) throw new PendingError('waiting for approval');
  if (challenge.status === 404) {
    // Unpaired on that machine: drop the key so the app offers to pair again.
    await forgetDevice(origin);
    throw new Error('this phone is no longer paired with that machine');
  }
  if (!challenge.data.nonce) throw new Error(`sign-in failed (${challenge.status})`);
  const nonce = challenge.data.nonce;
  const raw = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    keys.privateKey,
    new TextEncoder().encode(`shub-login:${nonce}`),
  );
  const session = await post<{ token?: string; expiresAt?: string }>(origin, ROUTES.authSession, {
    deviceId,
    nonce,
    signature: b64url(raw),
  });
  if (!session.data.token || !session.data.expiresAt) throw new Error(`sign-in failed (${session.status})`);
  tokens.set(origin, { value: session.data.token, expires: Date.parse(session.data.expiresAt) });
  return session.data.token;
}

/** Bearer token for this device on a machine, renewed shortly before it runs out; null without a key. */
export async function deviceToken(origin = here, fresh = false): Promise<string | null> {
  const machine = await find(origin);
  if (!machine) return null;
  const token = tokens.get(origin);
  if (!fresh && token && token.expires - Date.now() > RENEW_BEFORE_MS) return token.value;
  let pending = signingIn.get(origin);
  if (!pending) {
    pending = signIn(machine).finally(() => signingIn.delete(origin));
    signingIn.set(origin, pending);
  }
  return pending;
}

export async function deviceId(origin = here): Promise<string | null> {
  return (await find(origin))?.deviceId ?? null;
}
