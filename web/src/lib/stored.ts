// Browser storage that never throws. It can be missing or blocked (private window, blocked site data): then reads
// come back empty and writes are not remembered, and the page works on without them.

type Area = 'local' | 'session';
const storage = (area: Area): Storage => (area === 'session' ? sessionStorage : localStorage);

/** The value under `key`; null when there is none or storage is blocked. */
export function stored(key: string, area: Area = 'local'): string | null {
  try {
    return storage(area).getItem(key);
  } catch {
    return null;
  }
}

/** Keeps `value` under `key`; null removes it. */
export function store(key: string, value: string | null, area: Area = 'local'): void {
  try {
    if (value === null) storage(area).removeItem(key);
    else storage(area).setItem(key, value);
  } catch {
    // not remembered
  }
}

/** The JSON value under `key`; null when there is none, it does not parse or storage is blocked. */
export function storedJson(key: string): unknown {
  try {
    return JSON.parse(stored(key) ?? 'null');
  } catch {
    return null;
  }
}
