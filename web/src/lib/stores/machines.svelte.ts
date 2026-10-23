// The machines a browser or phone app knows: which one is shown, how the others are doing, adding one by its
// pairing code. Keys and tokens live in device.ts.
import type { HostInfo, HostPeer, Session } from '../../../../shared/api.ts';
import { api } from './api.ts';
import {
  deviceToken,
  forgetDevice,
  here,
  machines,
  newKeys,
  PendingError,
  rememberDevice,
  renameDevice,
  select,
  selectedOrigin,
} from './device.ts';
import { pushEnabled, sharePush } from './push.ts';

export interface MachineStatus {
  state: 'online' | 'offline' | 'pending';
  needsYou: number;
}

export const fleet = $state({
  /** Empty until this browser has a key (see Login). */
  list: [] as { origin: string; name: string }[],
  selected: here,
  status: {} as Record<string, MachineStatus>,
  /** The "Add a machine" dialog (also opened from Settings > Devices). */
  adding: false,
});

const POLL_MS = 20_000;
let polling: ReturnType<typeof setInterval> | undefined;

/**
 * The chips come from the group: every other host it lists gets this browser's own key and device id (the group
 * carries the device to that host), so one pairing is enough. Hosts known already stay as they are; when this
 * host cannot be asked the per-browser list is all there is.
 */
async function addGroupHosts(): Promise<void> {
  const own = (await machines()).find((m) => m.origin === here);
  if (!own) return;
  const peers = await api<HostPeer[]>('groupPeers', { origin: here }).catch(() => []);
  const known = new Set((await machines()).map((m) => m.origin));
  for (const { url, name } of peers) {
    if (!url || known.has(url)) continue;
    await rememberDevice({ origin: url, deviceId: own.deviceId, keys: own.keys, name });
  }
}

export async function loadMachines(): Promise<void> {
  await addGroupHosts();
  fleet.list = (await machines())
    .map(({ origin, name }) => ({ origin, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  fleet.selected = await selectedOrigin();
  if (fleet.list.length > 1 && !polling) {
    void pollOthers();
    polling = setInterval(() => void pollOthers(), POLL_MS);
  }
}

/** The machines not shown: online, waiting for approval, offline; and how many sessions need you there. */
async function pollOthers(): Promise<void> {
  for (const { origin } of fleet.list) {
    if (origin === fleet.selected) continue;
    try {
      const sessions = await api<Session[]>('sessions', { origin });
      fleet.status[origin] = { state: 'online', needsYou: sessions.filter((s) => s.status === 'needs-you').length };
    } catch {
      const pending = await deviceToken(origin).then(
        () => false,
        (err: unknown) => err instanceof PendingError,
      );
      fleet.status[origin] = { state: pending ? 'pending' : 'offline', needsYou: 0 };
    }
  }
}

/** Shows another machine: everything (sessions, events, terminals) reloads against it. */
export function switchTo(origin: string): void {
  select(origin);
  location.replace('/');
}

/** "pc", "pc.tail1234.ts.net", "https://pc.tail1234.ts.net:8443/" or a whole pairing link -> origin and code. */
export function parseTarget(address: string, code = ''): { origin: string; code: string } {
  const text = address.trim();
  const url = new URL(/^https?:\/\//.test(text) ? text : `https://${text}`);
  const fromLink = /^\/pair\/([^/]+)/.exec(url.pathname)?.[1];
  return { origin: url.origin, code: fromLink ? decodeURIComponent(fromLink) : code.trim() };
}

/**
 * Pairs this phone or browser with another machine: a new key for it, redeemed with that machine's code. The machine then
 * shows the phone as waiting; `waitForApproval` finishes once someone approves it there.
 */
export async function addMachine(address: string, code: string, deviceName: string, phone = true): Promise<string> {
  const target = parseTarget(address, code);
  if (!target.code) throw new Error('The pairing code is missing');
  const health = await fetch(`${target.origin}/api/health`).then(
    (r) => r.json() as Promise<{ machine?: string }>,
    () => {
      throw new Error(`${target.origin} does not answer. Is shub shared there (Settings > Phone)?`);
    },
  );
  const { keys, publicKey } = await newKeys();
  const res = await fetch(`${target.origin}/api/auth/pairing/redeem`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: target.code, deviceName, publicKey, kind: phone ? 'phone' : 'browser' }),
  });
  const data = (await res.json().catch(() => ({}))) as { device?: { id: string }; error?: string };
  if (!res.ok || !data.device) throw new Error(data.error ?? `Pairing failed (${res.status})`);
  const name = health.machine ?? new URL(target.origin).hostname.split('.')[0];
  await rememberDevice({ origin: target.origin, deviceId: data.device.id, keys, name });
  await loadMachines();
  return target.origin;
}

/** Resolves once the machine approved this phone; then it also gets the push subscription. */
export async function waitForApproval(origin: string, signal?: AbortSignal): Promise<void> {
  for (;;) {
    try {
      await deviceToken(origin, true);
      break;
    } catch (err) {
      if (!(err instanceof PendingError) || signal?.aborted) throw err;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  if (await pushEnabled()) await sharePush(origin).catch(() => {});
  fleet.status[origin] = { state: 'online', needsYou: 0 };
}

/**
 * After a browser was approved on another host: this browser is the courier that joins that host and the one the app
 * came from into one group. Each host tells its key and URL; the other adds it (server/group/sync.ts, docs/SECURITY.md).
 */
export async function joinHosts(origin: string): Promise<void> {
  if (origin === here) return;
  const [theirs, ours] = await Promise.all([
    api<HostInfo>('groupJoinOffer', { origin }),
    api<HostInfo>('groupJoinOffer', { origin: here }),
  ]);
  await api('groupJoin', { origin: here, body: { host: theirs } });
  await api('groupJoin', { origin, body: { host: ours } });
}

/** Forgets a machine on this phone and signs the phone out there (when reachable). */
export async function removeMachine(origin: string): Promise<void> {
  await api('logout', { origin }).catch(() => {});
  await forgetDevice(origin);
  if (origin === fleet.selected) select(here);
  await loadMachines();
}

/** Renames a machine on this device only; an empty name is ignored. */
export async function renameMachine(origin: string, name: string): Promise<void> {
  if (!name.trim()) return;
  await renameDevice(origin, name.trim());
  await loadMachines();
}
