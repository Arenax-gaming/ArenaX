// ---------------------------------------------------------------------------
// IndexedDB service for ArenaX — large data persistence, offline storage,
// state synchronization, and data migration.
// ---------------------------------------------------------------------------

export { db } from './db';
export { offlineStorage } from './offline-storage';
export { stateSync } from './state-sync';
export { migrationManager } from './migrations';
export type { IDBStore, CacheEntry, Migration, MigrationResult } from './types';