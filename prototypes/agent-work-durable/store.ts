/** Local SQLite only. No network driver, extension loading, credentials or key material. */
import { DatabaseSync } from 'node:sqlite';
import { closeSync, constants, lstatSync, openSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { canonicalHash, canonicalize } from '../../src/core/canonical.js';
import { Simulation } from '../agent-work/engine.js';
import type { AuditBundle, Config } from '../agent-work/contracts.js';
import { LedgerError, type AtomicAuditStore, type Binding, type Checkpoint, type CommitResult, type StoredAudit } from './contracts.js';

const SCHEMA = 1;
const MAX_AUDIT_BYTES = 16 * 1024 * 1024;
const queues = new Map<string, Promise<void>>();
const snapshot = <T>(value: T): T => JSON.parse(canonicalize(value)) as T;
const requireThat = (condition: unknown, code: string): void => { if (!condition) throw new LedgerError(code); };
function bindingFor(config: Config): Binding {
  return { tenantId: config.accountableEntity.tenantId, merchantId: config.accountableEntity.merchantId,
    simulationId: config.simulationId, configHash: canonicalHash(config), mode: 'OFFLINE_SIMULATION', unit: 'FAKE_CREDIT' };
}
function databasePath(directory: string): string {
  requireThat(typeof directory === 'string' && directory.length > 0, 'STORE_DIRECTORY');
  const absolute = resolve(directory);
  const info = lstatSync(absolute);
  requireThat(info.isDirectory() && !info.isSymbolicLink() && realpathSync(absolute) === absolute, 'PRIVATE_DIRECTORY_REQUIRED');
  if (process.platform !== 'win32') requireThat((info.mode & 0o077) === 0, 'PRIVATE_DIRECTORY_REQUIRED');
  return join(absolute, 'ledger.sqlite');
}
function requireFile(filename: string): void {
  const info = lstatSync(filename);
  requireThat(info.isFile() && !info.isSymbolicLink() && info.nlink === 1 && info.size > 0, 'STORE_FILE_INVALID');
  if (process.platform !== 'win32') requireThat((info.mode & 0o077) === 0, 'PRIVATE_FILE_REQUIRED');
}
function busy(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'errcode' in error && [5, 6].includes(Number(error.errcode));
}
function serial<T>(key: string, action: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const pending = previous.then(action);
  const tail = pending.then(() => undefined, () => undefined);
  queues.set(key, tail);
  void tail.then(() => { if (queues.get(key) === tail) queues.delete(key); });
  return pending;
}

export class SQLiteAuditStore implements AtomicAuditStore {
  readonly binding: Readonly<Binding>;
  readonly #filename: string;
  readonly #db: DatabaseSync;
  readonly #fileIdentity: string;
  #closed = false;
  #uncertaintyCode: string | null = null;

  private constructor(filename: string, config: Config) {
    const major = Number(process.versions.node.split('.')[0]);
    requireThat(major >= 24 && major <= 26, 'NODE_24_TO_26_REQUIRED');
    this.#filename = filename;
    const identity = lstatSync(filename);
    this.#fileIdentity = `${identity.dev}:${identity.ino}`;
    this.binding = Object.freeze(bindingFor(config));
    this.#db = new DatabaseSync(filename, { allowExtension: false, enableDoubleQuotedStringLiterals: false });
    // Zero synchronous busy wait avoids blocking another in-process async transaction.
    this.#db.exec('PRAGMA busy_timeout=0; PRAGMA synchronous=FULL; PRAGMA trusted_schema=OFF; PRAGMA foreign_keys=ON;');
  }

  static async create(directory: string, config: Config): Promise<SQLiteAuditStore> {
    const trustedConfig = snapshot(config);
    const sim = new Simulation(trustedConfig); // Validate the unchanged fake-only engine configuration.
    const filename = databasePath(directory);
    // Exclusive creation; an existing, empty, corrupted or linked database is never overwritten.
    const fd = openSync(filename, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    closeSync(fd);
    const store = new SQLiteAuditStore(filename, trustedConfig);
    try {
      store.#db.exec(`PRAGMA journal_mode=DELETE;
        BEGIN IMMEDIATE;
        CREATE TABLE ledger (
          singleton INTEGER PRIMARY KEY CHECK(singleton=1),
          binding_json TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>=0),
          audit_json TEXT NOT NULL, audit_head TEXT NOT NULL, audit_digest TEXT NOT NULL
        ) STRICT;
        PRAGMA user_version=1;`);
      const bundle = sim.exportAudit();
      store.#db.prepare('INSERT INTO ledger VALUES (1, ?, 0, ?, ?, ?)').run(canonicalize(store.binding), canonicalize(bundle), bundle.head, canonicalHash(bundle));
      store.#db.exec('COMMIT');
      return store;
    } catch (error) {
      try { store.#db.exec('ROLLBACK'); } catch { /* No transaction may have begun. */ }
      store.#db.close(); store.#closed = true;
      // Preserve a failed initialization for inspection; never silently seed a replacement.
      throw error;
    }
  }

  static async open(directory: string, config: Config, expected?: Checkpoint): Promise<SQLiteAuditStore> {
    const trustedConfig = snapshot(config);
    const retainedCheckpoint = expected === undefined ? undefined : snapshot(expected);
    new Simulation(trustedConfig);
    const filename = databasePath(directory); requireFile(filename);
    const store = new SQLiteAuditStore(filename, trustedConfig);
    try {
      await store.transact(async current => {
        if (retainedCheckpoint !== undefined) requireThat(canonicalize(current.checkpoint) === canonicalize(retainedCheckpoint), 'RETAINED_CHECKPOINT_MISMATCH');
        await Simulation.restore(current.bundle, current.checkpoint.auditHead);
        return { bundle: current.bundle, value: undefined };
      });
      return store;
    } catch (error) { await store.close(); throw error; }
  }

  async #begin(): Promise<void> {
    const deadline = Date.now() + 5000;
    for (;;) {
      try { this.#db.exec('BEGIN IMMEDIATE'); return; }
      catch (error) {
        if (!busy(error)) throw error;
        if (Date.now() >= deadline) throw new LedgerError('STORE_BUSY_RETRY_SAME_REQUEST');
        await delay(10);
      }
    }
  }

  async #commit(): Promise<void> {
    const deadline = Date.now() + 5000;
    for (;;) {
      try { this.#db.exec('COMMIT'); return; }
      catch (error) {
        // SQLite leaves a reader-blocked SQLITE_BUSY transaction active. Retry
        // only that COMMIT, never the operation that produced the reservation.
        if (typeof error === 'object' && error !== null && 'errcode' in error && error.errcode === 5) {
          if (Date.now() >= deadline) throw new LedgerError('STORE_BUSY_RETRY_SAME_REQUEST');
          await delay(10);
          continue;
        }
        this.#uncertaintyCode = 'COMMIT_UNCERTAIN_REOPEN_AND_RETRY_SAME_REQUEST';
        throw new LedgerError(this.#uncertaintyCode);
      }
    }
  }

  #checkFile(): void {
    requireFile(this.#filename);
    const identity = lstatSync(this.#filename);
    requireThat(`${identity.dev}:${identity.ino}` === this.#fileIdentity, 'STORE_FILE_REPLACED_REOPEN');
  }

  #read(): StoredAudit {
    const schema = this.#db.prepare('PRAGMA user_version').get();
    requireThat(schema?.user_version === SCHEMA, 'STORE_SCHEMA');
    const rows = this.#db.prepare('SELECT singleton, binding_json, version, audit_json, audit_head, audit_digest FROM ledger').all();
    requireThat(rows.length === 1, 'STORE_ROW_COUNT');
    const row = rows[0]!;
    requireThat(row.singleton === 1 && row.binding_json === canonicalize(this.binding), 'TENANT_OR_CONFIG_MISMATCH');
    requireThat(typeof row.version === 'number' && Number.isSafeInteger(row.version) && row.version >= 0, 'STORE_VERSION');
    requireThat(typeof row.audit_json === 'string' && Buffer.byteLength(row.audit_json, 'utf8') <= MAX_AUDIT_BYTES, 'STORE_AUDIT_SIZE');
    const bundle: AuditBundle = JSON.parse(row.audit_json as string) as AuditBundle;
    requireThat(canonicalize(bundle) === row.audit_json && canonicalHash(bundle) === row.audit_digest && bundle.head === row.audit_head, 'STORE_INTEGRITY');
    requireThat(canonicalHash(bundle.config) === this.binding.configHash && bundle.config.accountableEntity.tenantId === this.binding.tenantId && bundle.config.accountableEntity.merchantId === this.binding.merchantId, 'TENANT_OR_CONFIG_MISMATCH');
    return { checkpoint: { storageVersion: row.version as number, auditHead: bundle.head }, bundle };
  }

  transact<T>(operation: (current: StoredAudit) => Promise<{ bundle: AuditBundle; value: T }>): Promise<CommitResult<T>> {
    return serial(this.#filename, async () => {
      requireThat(!this.#closed, 'STORE_CLOSED');
      if (this.#uncertaintyCode !== null) throw new LedgerError(this.#uncertaintyCode);
      this.#checkFile();
      await this.#begin();
      let committed = false;
      try {
        const current = this.#read();
        const next = await operation(snapshot(current));
        requireThat(canonicalHash(next.bundle.config) === this.binding.configHash, 'TENANT_OR_CONFIG_MISMATCH');
        const serialized = canonicalize(next.bundle);
        requireThat(Buffer.byteLength(serialized, 'utf8') <= MAX_AUDIT_BYTES, 'STORE_CAPACITY');
        const changed = serialized !== canonicalize(current.bundle);
        const checkpoint = { storageVersion: current.checkpoint.storageVersion + (changed ? 1 : 0), auditHead: next.bundle.head };
        requireThat(Number.isSafeInteger(checkpoint.storageVersion), 'STORE_VERSION');
        this.#checkFile();
        if (changed) this.#db.prepare('UPDATE ledger SET version=?, audit_json=?, audit_head=?, audit_digest=? WHERE singleton=1 AND version=?').run(checkpoint.storageVersion, serialized, next.bundle.head, canonicalHash(next.bundle), current.checkpoint.storageVersion);
        await this.#commit(); committed = true;
        return { checkpoint, value: next.value };
      } finally {
        if (!committed) {
          try { this.#db.exec('ROLLBACK'); }
          catch {
            this.#uncertaintyCode = 'ROLLBACK_UNCERTAIN_REOPEN_AND_RETRY_SAME_REQUEST';
            throw new LedgerError(this.#uncertaintyCode);
          }
        }
      }
    });
  }

  close(): Promise<void> {
    return serial(this.#filename, async () => {
      if (!this.#closed) { this.#db.close(); this.#closed = true; }
    });
  }
}
