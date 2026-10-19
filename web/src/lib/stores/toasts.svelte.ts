export interface ToastItem {
  id: number;
  message: string;
  tone: 'neutral' | 'error' | 'needs-you';
}

let next = 1;
export const toasts = $state<ToastItem[]>([]);

export function toast(message: string, tone: ToastItem['tone'] = 'neutral', ms = 4000): void {
  const id = next++;
  toasts.push({ id, message, tone });
  setTimeout(() => dismissToast(id), ms);
}

export function dismissToast(id: number): void {
  const i = toasts.findIndex((t) => t.id === id);
  if (i >= 0) toasts.splice(i, 1);
}

/** Toast for a failed call; returns undefined so it can end a catch chain. */
export function toastError(err: unknown): undefined {
  toast(err instanceof Error ? err.message : String(err), 'error');
  return undefined;
}
