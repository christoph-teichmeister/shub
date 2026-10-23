// The device group's store: versioned items in shub.db. Settings, projects and (later) devices live here as one
// item each; every item carries a version vector (host id -> change counter) and a deleted flag (tombstone).
// Host-to-host sync, pairing and the conflict UI build on this; nothing here talks to the network.
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Config, SyncCategory, SyncSettings } from '../../shared/api.ts';
import type { Context } from '../context.ts';
import type { ShubModule } from '../module.ts';
import type { Services } from '../services.ts';

/** Host id -> how many changes that host made to the item. */
export type Version = Record<string, number>;

/** `kind:id`, kind being project, group, theme, plugin, device or setting. A removed item stays as a tombstone. */
export interface GroupItem {
  key: string;
  body: unknown;
  version: Version;
  deleted: boolean;
}

/** How a version relates to another: `newer` means it has seen everything the other has, and more. */
export type Order = 'newer' | 'older' | 'equal' | 'conflict';

export function compareVersions(a: Version, b: Version): Order {
  let ahead = false;
  let behind = false;
  for (const host of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const [x, y] = [a[host] ?? 0, b[host] ?? 0];
    if (x > y) ahead = true;
    if (x < y) behind = true;
  }
  return ahead && behind ? 'conflict' : ahead ? 'newer' : behind ? 'older' : 'equal';
}

export const kindOf = (key: string): string => key.slice(0, key.indexOf(':'));

/** Like compareVersions, but a revoked device always wins: a tombstone of a device is never a conflict. */
export function compareItems(a: GroupItem, b: GroupItem): Order {
  const order = compareVersions(a.version, b.version);
  if (order !== 'conflict' || kindOf(a.key) !== 'device' || a.deleted === b.deleted) return order;
  return a.deleted ? 'newer' : 'older';
}

/** The sync category an item belongs to; null for the devices, which always sync. */
export function categoryOf(key: string): SyncCategory | null {
  switch (kindOf(key)) {
    case 'project':
    case 'group':
      return 'projects';
    case 'theme':
      return 'themes';
    case 'plugin':
      return 'plugins';
    case 'setting':
      return (
        ({
          terminal: 'terminal',
          notifications: 'notifications',
          defaultPermissionMode: 'permissionMode',
          ui: 'themes',
        }[key.slice('setting:'.length)] as SyncCategory) ?? null
      );
    default:
      return null;
  }
}

/** Everything is on unless switched off, except the plugin env, which may hold secrets. */
export const syncOn = (sync: SyncSettings | undefined, category: SyncCategory): boolean =>
  sync?.[category] ?? category !== 'pluginEnv';

/**
 * What this host sends, and the only form it accepts: the item itself, null when its category is switched off,
 * a plugin without its `env` unless that switch is on.
 */
export function forSync(item: GroupItem, sync: SyncSettings | undefined): GroupItem | null {
  const category = categoryOf(item.key);
  if (category && !syncOn(sync, category)) return null;
  if (category === 'plugins' && !syncOn(sync, 'pluginEnv') && item.body && typeof item.body === 'object') {
    const { env: _env, ...body } = item.body as Record<string, unknown>;
    return { ...item, body };
  }
  return item;
}

/** Config settings that are one item each. */
const SINGLE = ['terminal', 'notifications', 'defaultPermissionMode'] as const;

/** The items the shared part of a config is made of. Built-in themes are code, not items. */
function itemsOf(c: Partial<Config>): Map<string, unknown> {
  const items = new Map<string, unknown>();
  for (const p of c.projects ?? []) items.set(`project:${p.id}`, p);
  (c.groups ?? []).forEach((name, order) => items.set(`group:${name}`, { name, order }));
  for (const t of c.themes ?? []) if (!t.builtIn) items.set(`theme:${t.id}`, t);
  for (const p of c.plugins ?? []) items.set(`plugin:${p.name}`, p);
  for (const key of SINGLE) if (c[key] !== undefined) items.set(`setting:${key}`, c[key]);
  if (c.activeTheme !== undefined || c.activeGroup !== undefined)
    items.set('setting:ui', { activeTheme: c.activeTheme, activeGroup: c.activeGroup });
  return items;
}

/** JSON with sorted keys, to compare bodies whatever order their fields were written in. */
const canon = (value: unknown): string =>
  JSON.stringify(value ?? null, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort()) : v,
  );

interface Row {
  key: string;
  body: string | null;
  version: string;
  deleted: number;
}

const toItem = (r: Row): GroupItem => ({
  key: r.key,
  body: r.body === null ? null : JSON.parse(r.body),
  version: JSON.parse(r.version),
  deleted: !!r.deleted,
});

export class GroupStore {
  #db: DatabaseSync;
  /** This host's id in every version vector. */
  readonly hostId: string;

  constructor(db: DatabaseSync, migrate: (module: string, statements: string[]) => void) {
    migrate('group', [
      // theirs: the other side's item while a conflict is open; the item itself stays as it is until it is settled.
      `CREATE TABLE group_items (key TEXT PRIMARY KEY, body TEXT, version TEXT NOT NULL,
         deleted INTEGER NOT NULL DEFAULT 0, theirs TEXT)`,
      'CREATE TABLE group_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
    ]);
    this.#db = db;
    this.hostId = this.#meta('host') ?? this.#setMeta('host', randomUUID());
  }

  #meta(key: string): string | null {
    return (
      (this.#db.prepare('SELECT value FROM group_meta WHERE key = ?').get(key) as { value: string } | undefined)
        ?.value ?? null
    );
  }

  #setMeta(key: string, value: string): string {
    this.#db.prepare('INSERT OR REPLACE INTO group_meta (key, value) VALUES (?, ?)').run(key, value);
    return value;
  }

  #transaction<T>(fn: () => T): T {
    this.#db.exec('BEGIN');
    try {
      const result = fn();
      this.#db.exec('COMMIT');
      return result;
    } catch (err) {
      this.#db.exec('ROLLBACK');
      throw err;
    }
  }

  get(key: string): GroupItem | undefined {
    const row = this.#db.prepare('SELECT key, body, version, deleted FROM group_items WHERE key = ?').get(key);
    return row && toItem(row as unknown as Row);
  }

  /** Every item, tombstones included. */
  list(): GroupItem[] {
    return (
      this.#db.prepare('SELECT key, body, version, deleted FROM group_items ORDER BY key').all() as unknown as Row[]
    ).map(toItem);
  }

  /** Add or change an item as this host: its counter goes up by one. */
  put(key: string, body: unknown): GroupItem {
    return this.#write(key, body, false);
  }

  /** Remove an item: it stays as a tombstone so the removal syncs. For a device this is the revoke. */
  remove(key: string): GroupItem | undefined {
    const have = this.get(key);
    return have && !have.deleted ? this.#write(key, null, true) : undefined;
  }

  #write(key: string, body: unknown, deleted: boolean): GroupItem {
    const version = { ...this.get(key)?.version };
    version[this.hostId] = (version[this.hostId] ?? 0) + 1;
    this.#db
      .prepare('INSERT OR REPLACE INTO group_items (key, body, version, deleted, theirs) VALUES (?, ?, ?, ?, NULL)')
      .run(key, deleted ? null : JSON.stringify(body), JSON.stringify(version), deleted ? 1 : 0);
    return { key, body: deleted ? null : body, version, deleted };
  }

  /**
   * Take an item from another host. Newer replaces ours, older and equal change nothing; a conflict keeps our item
   * and parks theirs until it is settled. Returns how the incoming item compares to ours.
   */
  merge(incoming: GroupItem): Order {
    const ours = this.get(incoming.key);
    const order = ours ? compareItems(incoming, ours) : 'newer';
    if (order === 'newer') {
      this.#db
        .prepare('INSERT OR REPLACE INTO group_items (key, body, version, deleted, theirs) VALUES (?, ?, ?, ?, NULL)')
        .run(
          incoming.key,
          incoming.deleted ? null : JSON.stringify(incoming.body),
          JSON.stringify(incoming.version),
          incoming.deleted ? 1 : 0,
        );
    } else if (order === 'conflict') {
      this.#db.prepare('UPDATE group_items SET theirs = ? WHERE key = ?').run(JSON.stringify(incoming), incoming.key);
    }
    return order;
  }

  /** Items with an open conflict, with the other side's version. */
  conflicts(): { ours: GroupItem; theirs: GroupItem }[] {
    const rows = this.#db.prepare('SELECT key, theirs FROM group_items WHERE theirs IS NOT NULL').all() as {
      key: string;
      theirs: string;
    }[];
    return rows.map((r) => ({ ours: this.get(r.key)!, theirs: JSON.parse(r.theirs) }));
  }

  /** The synced part of a config (paths as stored, with `~`), built from the live items. */
  config(): Partial<Config> {
    const live = this.list().filter((i) => !i.deleted);
    const of = (kind: string) => live.filter((i) => kindOf(i.key) === kind).map((i) => i.body as never);
    const config: Record<string, unknown> = {
      projects: (of('project') as { order: number }[]).sort((a, b) => a.order - b.order),
      groups: (of('group') as { name: string; order: number }[]).sort((a, b) => a.order - b.order).map((g) => g.name),
      themes: of('theme'),
      plugins: of('plugin'),
    };
    for (const key of SINGLE) {
      const item = live.find((i) => i.key === `setting:${key}`);
      if (item) config[key] = item.body;
    }
    Object.assign(config, live.find((i) => i.key === 'setting:ui')?.body);
    return config as Partial<Config>;
  }

  /** Make the items match `config`: changed or new ones get a new version, missing ones become tombstones. */
  setConfig(config: Partial<Config>): void {
    const wanted = itemsOf(config);
    this.#transaction(() => {
      for (const [key, body] of wanted) {
        const have = this.get(key);
        if (!have || have.deleted || canon(have.body) !== canon(body)) this.put(key, body);
      }
      for (const item of this.list())
        if (!item.deleted && kindOf(item.key) !== 'device' && !wanted.has(item.key)) this.remove(item.key);
    });
  }

  /** First start: turn an existing config.json into items. Returns false when this was done before. */
  importConfig(config: Partial<Config>): boolean {
    if (this.imported()) return false;
    this.setConfig(config);
    this.#setMeta('imported', '1');
    return true;
  }

  imported(): boolean {
    return this.#meta('imported') !== null;
  }
}

export function create(_ctx: Context, services: Services): { module: ShubModule; service: GroupStore } {
  return { module: { name: 'group' }, service: new GroupStore(services.state.db, services.state.migrate) };
}
