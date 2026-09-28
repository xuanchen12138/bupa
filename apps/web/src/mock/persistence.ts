/**
 * Versioned snapshot storage for the in-browser demo service.
 *
 * The whole mock state is one JSON document. Every mutation writes the full document, which
 * keeps saves atomic (one IndexedDB `put`) and makes "what is on disk" trivially inspectable.
 * Runtime-only objects (AbortControllers, consent waiters, listeners) never enter the snapshot.
 *
 * This module has no React or path-alias imports so it can be unit-tested with plain Node.
 */

export const SNAPSHOT_VERSION = 1;

export interface SnapshotEnvelope<T> {
  version: number;
  savedAt: string;
  data: T;
}

export interface SnapshotStore<T> {
  readonly kind: 'indexeddb' | 'memory';
  load(): Promise<SnapshotEnvelope<T> | null>;
  save(envelope: SnapshotEnvelope<T>): Promise<void>;
  clear(): Promise<void>;
}

export type PersistenceStatus =
  | { state: 'loading' }
  | { state: 'ready'; savedAt: string | null; store: SnapshotStore<unknown>['kind'] }
  | { state: 'saving'; savedAt: string | null; store: SnapshotStore<unknown>['kind'] }
  /** The last write failed; in-memory state is intact and can be retried. */
  | {
      state: 'error';
      message: string;
      savedAt: string | null;
      store: SnapshotStore<unknown>['kind'];
    }
  /** Storage exists but its content could not be understood; nothing is overwritten. */
  | { state: 'corrupt'; message: string }
  /** No usable storage; the demo runs in memory and forgets everything on reload. */
  | { state: 'unavailable'; message: string };

export class PersistenceError extends Error {
  readonly reason: unknown;
  constructor(message: string, reason?: unknown) {
    super(message);
    this.name = 'PersistenceError';
    this.reason = reason;
  }
}

/* ------------------------------------------------------------ IndexedDB */
const DB_NAME = 'my-bupa-agent-demo';
const STORE_NAME = 'snapshots';
const KEY = 'mock-state';

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains(STORE_NAME))
        open.result.createObjectStore(STORE_NAME);
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error ?? new Error('Could not open IndexedDB'));
    open.onblocked = () => reject(new Error('IndexedDB is blocked by another tab'));
  });
}

export class IndexedDbSnapshotStore<T> implements SnapshotStore<T> {
  readonly kind = 'indexeddb' as const;
  private db: Promise<IDBDatabase> | null = null;

  static available() {
    try {
      return typeof indexedDB !== 'undefined' && indexedDB !== null;
    } catch {
      return false;
    }
  }

  private connection() {
    this.db ??= openDatabase().catch((error) => {
      this.db = null;
      throw error;
    });
    return this.db;
  }

  async load() {
    const db = await this.connection();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const value = await request(tx.objectStore(STORE_NAME).get(KEY));
    return (value as SnapshotEnvelope<T> | undefined) ?? null;
  }

  async save(envelope: SnapshotEnvelope<T>) {
    const db = await this.connection();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'));
      tx.objectStore(STORE_NAME).put(envelope, KEY);
    });
  }

  async clear() {
    const db = await this.connection();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB clear failed'));
      tx.objectStore(STORE_NAME).delete(KEY);
    });
  }
}

/* --------------------------------------------------------------- Memory */
/** Used in tests and when the browser offers no IndexedDB. Forgets everything on reload. */
export class MemorySnapshotStore<T> implements SnapshotStore<T> {
  readonly kind = 'memory' as const;
  private value: SnapshotEnvelope<T> | null = null;
  /** Tests can make the next write fail to exercise the error path. */
  failNextSave: Error | null = null;

  async load() {
    return this.value ? structuredClone(this.value) : null;
  }
  async save(envelope: SnapshotEnvelope<T>) {
    if (this.failNextSave) {
      const error = this.failNextSave;
      this.failNextSave = null;
      throw error;
    }
    this.value = structuredClone(envelope);
  }
  async clear() {
    this.value = null;
  }
}

/* --------------------------------------------------------------- Writer */
/**
 * Serialises writes so the latest state always wins and a slow write never overtakes a newer
 * one. `flush()` resolves once everything queued so far is on disk (or has failed).
 */
export class SnapshotWriter<T> {
  private queue: Promise<void> = Promise.resolve();
  private pending: SnapshotEnvelope<T> | null = null;
  private inFlight = false;
  private readonly store: SnapshotStore<T>;
  private readonly onStatus: (status: PersistenceStatus) => void;

  // Explicit fields rather than parameter properties so Node can run this file with type
  // stripping alone (parameter properties need a transform).
  constructor(store: SnapshotStore<T>, onStatus: (status: PersistenceStatus) => void) {
    this.store = store;
    this.onStatus = onStatus;
  }

  write(data: T) {
    this.pending = { version: SNAPSHOT_VERSION, savedAt: new Date().toISOString(), data };
    if (!this.inFlight) this.queue = this.queue.then(() => this.drain());
    return this.queue;
  }

  flush() {
    return this.queue;
  }

  private async drain() {
    this.inFlight = true;
    try {
      while (this.pending) {
        const envelope = this.pending;
        this.pending = null;
        this.onStatus({ state: 'saving', savedAt: null, store: this.store.kind });
        try {
          await this.store.save(envelope);
          this.onStatus({ state: 'ready', savedAt: envelope.savedAt, store: this.store.kind });
        } catch (error) {
          this.onStatus({
            state: 'error',
            message: error instanceof Error ? error.message : 'Could not save',
            savedAt: null,
            store: this.store.kind,
          });
          // Keep the state so a retry can write it again.
          this.pending ??= envelope;
          break;
        }
      }
    } finally {
      this.inFlight = false;
    }
  }

  /** Retry the last failed write, if any. */
  retry() {
    if (this.pending && !this.inFlight) this.queue = this.queue.then(() => this.drain());
    return this.queue;
  }

  hasPending() {
    return this.pending !== null;
  }
}
