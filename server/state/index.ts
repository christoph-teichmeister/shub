// One sqlite file for all runtime state. Each module owns its tables and creates them via migrate().
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Context } from '../context.ts';
import type { ShubModule } from '../module.ts';
import type { Services, StateDb } from '../services.ts';

export function openState(stateDir: string): StateDb {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(join(stateDir, 'shub.db'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(
    'CREATE TABLE IF NOT EXISTS migrations (module TEXT NOT NULL, step INTEGER NOT NULL, PRIMARY KEY (module, step))',
  );
  return { db, migrate: (module, statements) => migrate(db, module, statements) };
}

/** Runs the statements a module has not run yet. Statements are append-only: never edit or reorder old ones. */
function migrate(db: DatabaseSync, module: string, statements: string[]): void {
  const row = db.prepare('SELECT COALESCE(MAX(step), -1) AS done FROM migrations WHERE module = ?').get(module) as {
    done: number;
  };
  const insert = db.prepare('INSERT INTO migrations (module, step) VALUES (?, ?)');
  for (let step = row.done + 1; step < statements.length; step++) {
    db.exec('BEGIN');
    try {
      db.exec(statements[step]);
      insert.run(module, step);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

export function create(ctx: Context, _services: Services): { module: ShubModule; service: StateDb } {
  const state = openState(ctx.paths.stateDir);
  return { module: { name: 'state', stop: () => state.db.close() }, service: state };
}
