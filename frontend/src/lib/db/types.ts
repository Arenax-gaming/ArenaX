export interface IDBStore {
  name: string;
  keyPath: string;
  indexes?: { name: string; keyPath: string; options?: IDBIndexParameters }[];
}

export interface CacheEntry<T = unknown> {
  key: string;
  value: T;
  timestamp: number;
  ttl: number; // ms
  version?: number;
}

export interface Migration {
  version: number;
  name: string;
  description: string;
  up: (db: IDBDatabase) => Promise<void>;
  down?: (db: IDBDatabase) => Promise<void>;
}

export interface MigrationResult {
  fromVersion: number;
  toVersion: number;
  success: boolean;
  error?: string;
  durationMs: number;
}

export interface SyncEvent {
  id: string;
  store: string;
  action: 'create' | 'update' | 'delete';
  key: string;
  value?: unknown;
  timestamp: number;
  synced: boolean;
  retryCount: number;
}
