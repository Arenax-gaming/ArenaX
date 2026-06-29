import { IDBStore, CacheEntry } from './types';

const DB_NAME = 'arenax';
const DB_VERSION = 1;

// ---------------------------------------------------------------------------
// IndexedDB low-level wrapper
// ---------------------------------------------------------------------------

class Database {
  private db: IDBDatabase | null = null;
  private initPromise: Promise<IDBDatabase> | null = null;

  // ── Stores ───────────────────────────────────────────────────────────────

  readonly stores: IDBStore[] = [
    {
      name: 'cache',
      keyPath: 'key',
      indexes: [{ name: 'byTimestamp', keyPath: 'timestamp', options: { unique: false } as IDBIndexParameters }],
    },
    {
      name: 'matches',
      keyPath: 'id',
      indexes: [
        { name: 'byCreatedAt', keyPath: 'createdAt', options: { unique: false } as IDBIndexParameters },
        { name: 'byStatus', keyPath: 'status', options: { unique: false } as IDBIndexParameters },
      ],
    },
    {
      name: 'tournaments',
      keyPath: 'id',
      indexes: [{ name: 'byStartDate', keyPath: 'startDate', options: { unique: false } as IDBIndexParameters }],
    },
    {
      name: 'leaderboards',
      keyPath: 'id',
    },
    {
      name: 'profiles',
      keyPath: 'userId',
    },
    {
      name: 'pendingSync',
      keyPath: 'id',
      indexes: [
        { name: 'byStore', keyPath: 'store', options: { unique: false } as IDBIndexParameters },
        { name: 'bySynced', keyPath: 'synced', options: { unique: false } as IDBIndexParameters },
      ],
    },
  ];

  // ── Initialisation ───────────────────────────────────────────────────────

  async init(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
        const db = (event.target as IDBOpenDBRequest).result;
        this.createStores(db);
      };

      request.onsuccess = (event: Event) => {
        this.db = (event.target as IDBOpenDBRequest).result;

        this.db.onversionchange = () => {
          this.db?.close();
          this.db = null;
        };

        resolve(this.db);
      };

      request.onerror = (event: Event) => {
        reject((event.target as IDBOpenDBRequest).error);
      };
    });

    return this.initPromise;
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.initPromise = null;
    }
  }

  // ── CRUD operations ──────────────────────────────────────────────────────

  async get<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
    const db = await this.init();
    return new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.get(key);

      request.onsuccess = () => resolve(request.result ?? undefined);
      request.onerror = () => reject(request.error);
    });
  }

  async getAll<T>(storeName: string, query?: IDBValidKey | IDBKeyRange, count?: number): Promise<T[]> {
    const db = await this.init();
    return new Promise<T[]>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.getAll(query, count);

      request.onsuccess = () => resolve(request.result ?? []);
      request.onerror = () => reject(request.error);
    });
  }

  async set(storeName: string, value: unknown, key?: IDBValidKey): Promise<IDBValidKey> {
    const db = await this.init();
    return new Promise<IDBValidKey>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = key !== undefined ? store.put(value, key) : store.put(value);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async delete(storeName: string, key: IDBValidKey): Promise<void> {
    const db = await this.init();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.delete(key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async clear(storeName: string): Promise<void> {
    const db = await this.init();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async count(storeName: string, key?: IDBValidKey | IDBKeyRange): Promise<number> {
    const db = await this.init();
    return new Promise<number>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = key !== undefined ? store.count(key) : store.count();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // ── Cache-specific ───────────────────────────────────────────────────────

  async cacheGet<T>(key: string): Promise<T | null> {
    const entry = await this.get<CacheEntry<T>>('cache', key);
    if (!entry) return null;

    const now = Date.now();
    if (now - entry.timestamp > entry.ttl) {
      await this.delete('cache', key).catch(() => {});
      return null;
    }

    return entry.value;
  }

  async cacheSet<T>(key: string, value: T, ttlMs: number = 300_000): Promise<void> {
    const entry: CacheEntry<T> = {
      key,
      value,
      timestamp: Date.now(),
      ttl: ttlMs,
    };
    await this.set('cache', entry);
  }

  async cacheDelete(key: string): Promise<void> {
    await this.delete('cache', key).catch(() => {});
  }

  async cacheClear(): Promise<void> {
    await this.clear('cache').catch(() => {});
  }

  async cacheEvictExpired(): Promise<number> {
    const entries = await this.getAll<CacheEntry<unknown>>('cache');
    const now = Date.now();
    const expired = entries.filter((e) => now - e.timestamp > e.ttl);
    for (const entry of expired) {
      await this.delete('cache', entry.key).catch(() => {});
    }
    return expired.length;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  isSupported(): boolean {
    return typeof indexedDB !== 'undefined';
  }

  private createStores(db: IDBDatabase): void {
    for (const storeDef of this.stores) {
      if (!db.objectStoreNames.contains(storeDef.name)) {
        const store = db.createObjectStore(storeDef.name, {
          keyPath: storeDef.keyPath,
        });
        for (const idx of storeDef.indexes ?? []) {
          store.createIndex(idx.name, idx.keyPath, idx.options);
        }
      }
    }
  }
}

export const db = new Database();