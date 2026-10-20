// This phone's sign-in (docs/SECURITY.md): a P-256 key pair whose private half cannot be read out, kept in
// IndexedDB; every few minutes the app signs a challenge and gets a short-lived token, held in memory only.
// Desktop browsers have no key here and keep their cookie.
import { ROUTES } from '../../../../shared/api.ts';

interface Stored {
  deviceId: string;
  keys: CryptoKeyPair;
}

/** The device exists but nobody approved it on the machine yet. */
export class PendingError extends Error {}

const DB = 'shub-device';
const STORE = 'device';
const RENEW_BEFORE_MS = 30_000;

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
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

let stored: Promise<Stored | undefined> | undefined;
let token: { value: string; expires: number } | null = null;
let signingIn: Promise<string> | null = null;

const load = () => (stored ??= tx<Stored | undefined>('readonly', (s) => s.get('self')).catch(() => undefined));

/** New key pair for pairing; only the public half ever leaves the phone. */
export async function newKeys(): Promise<{ keys: CryptoKeyPair; publicKey: JsonWebKey }> {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  return { keys, publicKey: await crypto.subtle.exportKey('jwk', keys.publicKey) };
}

export async function rememberDevice(deviceId: string, keys: CryptoKeyPair): Promise<void> {
  await tx('readwrite', (s) => s.put({ deviceId, keys } satisfies Stored, 'self'));
  stored = Promise.resolve({ deviceId, keys });
  token = null;
}

export async function forgetDevice(): Promise<void> {
  await tx('readwrite', (s) => s.delete('self')).catch(() => {});
  stored = Promise.resolve(undefined);
  token = null;
}

async function post<T>(route: string, body: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(route.split(' ')[1], {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json().catch(() => ({}))) as T };
}

async function signIn({ deviceId, keys }: Stored): Promise<string> {
  const challenge = await post<{ nonce?: string }>(ROUTES.authChallenge, { deviceId });
  if (challenge.status === 409) throw new PendingError('waiting for approval on the machine');
  if (challenge.status === 404) {
    // Unpaired on the machine: drop the key so the app shows the sign-in page again.
    await forgetDevice();
    throw new Error('this phone is no longer paired');
  }
  if (!challenge.data.nonce) throw new Error(`sign-in failed (${challenge.status})`);
  const nonce = challenge.data.nonce;
  const raw = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    keys.privateKey,
    new TextEncoder().encode(`shub-login:${nonce}`),
  );
  const signature = btoa(String.fromCharCode(...new Uint8Array(raw)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const session = await post<{ token?: string; expiresAt?: string }>(ROUTES.authSession, {
    deviceId,
    nonce,
    signature,
  });
  if (!session.data.token || !session.data.expiresAt) throw new Error(`sign-in failed (${session.status})`);
  token = { value: session.data.token, expires: Date.parse(session.data.expiresAt) };
  return token.value;
}

/** Bearer token for this phone, renewed shortly before it runs out; null on a desktop (cookie). */
export async function deviceToken(fresh = false): Promise<string | null> {
  const device = await load();
  if (!device) return null;
  if (!fresh && token && token.expires - Date.now() > RENEW_BEFORE_MS) return token.value;
  signingIn ??= signIn(device).finally(() => (signingIn = null));
  return signingIn;
}

export async function deviceId(): Promise<string | null> {
  return (await load())?.deviceId ?? null;
}
