// Docker service helpers shared by the desktop bottom panel and the phone terminal.
import type { ServiceContainer, Session } from '../../../../shared/api.ts';
import type { ServiceAction } from '../components/ServicesTree/ServicesTree.svelte';
import { api } from './api.ts';
import { app } from './state.svelte.ts';
import { toast, toastError } from './toasts.svelte.ts';

/**
 * For an $effect: loads the containers of session `id` (none without one) into `set`, again on `services.changed`.
 * Returns the cleanup, so after a quick switch the slower answer for the session left behind is dropped.
 */
export function watchServices(id: string | null, set: (list: ServiceContainer[]) => void): (() => void) | undefined {
  void (id && app.servicesVersion[id]);
  if (!id) {
    set([]);
    return;
  }
  let gone = false;
  api<ServiceContainer[]>('services', { params: { id } }).then(
    (list) => gone || set(list),
    () => gone || set([]),
  );
  return () => (gone = true);
}

export async function serviceLogs(id: string): Promise<string> {
  const res = await api<unknown>('serviceLogs', { params: { containerId: id } });
  if (typeof res === 'string') return res;
  const r = res as { logs?: string; text?: string };
  return r.logs ?? r.text ?? JSON.stringify(res, null, 2);
}

export const serviceInspect = (id: string) => api('serviceInspect', { params: { containerId: id } });

/** start / stop / restart, or paste the last 200 log lines into `session`. */
export async function serviceAction(action: ServiceAction, c: ServiceContainer, session: Session | null) {
  if (action !== 'send-logs') {
    await api('serviceAction', { params: { containerId: c.id, action } }).catch(toastError);
    return;
  }
  if (!session) return;
  const text = await serviceLogs(c.id).catch(toastError);
  if (text === undefined) return;
  const tail = text.split('\n').slice(-200).join('\n');
  await api('sessionPaste', { params: { id: session.id }, body: `Logs of ${c.name}:\n${tail}\n` })
    .then(() => toast(`Logs of ${c.name} sent to ${session.name}`))
    .catch(toastError);
}
