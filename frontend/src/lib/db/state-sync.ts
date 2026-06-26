import { db } from './db';
import { offlineStorage } from './offline-storage';
import { SyncEvent } from './types';

// ---------------------------------------------------------------------------
// StateSync — synchronises local IndexedDB state with the remote API
// ---------------------------------------------------------------------------

type SyncHandler = (event: SyncEvent) => Promise<boolean>;

class StateSync {
  private syncHandlers = new Map<string, SyncHandler[]>();
  private syncTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Register a handler for a specific store. Handlers are called in order
   * until one returns `true`.
   */
  on(store: string, handler: SyncHandler): void {
    const existing = this.syncHandlers.get(store) ?? [];
    existing.push(handler);
    this.syncHandlers.set(store, existing);
  }

  /**
   * Queue a write event locally. Will be synced when online.
   */
  async queueWrite(store: string, action: SyncEvent['action'], key: string, value?: unknown): Promise<void> {
    await offlineStorage.queueWrite({
      store,
      action,
      key,
      value,
      timestamp: Date.now(),
      synced: false,
    });
  }

  /**
   * Attempt immediate sync. Calls registered handlers for each pending event.
   */
  async syncNow(): Promise<{ synced: number; failed: number }> {
    const pending = await offlineStorage.getPendingWrites();
    if (pending.length === 0) return { synced: 0, failed: 0 };

    let synced = 0;
    let failed = 0;

    for (const event of pending) {
      const handlers = this.syncHandlers.get(event.store);
      if (!handlers || handlers.length === 0) continue;

      let handled = false;
      for (const handler of handlers) {
        try {
          handled = await handler(event);
          if (handled) break;
        } catch (err) {
          console.error(`[StateSync] Handler failed for ${event.store}:${event.key}`, err);
        }
      }

      if (handled) {
        await offlineStorage.removeSynced(event.id);
        synced++;
      } else {
        event.retryCount++;
        if (event.retryCount >= 5) {
          await offlineStorage.removeSynced(event.id);
          console.warn(`[StateSync] Dropping event after 5 retries: ${event.store}:${event.key}`);
          failed++;
        } else {
          await db.set('pendingSync', event);
        }
      }
    }

    return { synced, failed };
  }

  /**
   * Start periodic sync (e.g., every 30 seconds).
   */
  startPeriodicSync(intervalMs = 30_000): void {
    if (this.syncTimer) return;
    this.syncTimer = setInterval(() => this.syncNow(), intervalMs);
  }

  /**
   * Stop periodic sync.
   */
  stopPeriodicSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  /**
   * Force sync and clean up.
   */
  async destroy(): Promise<void> {
    this.stopPeriodicSync();
    await this.syncNow();
    this.syncHandlers.clear();
  }
}

export const stateSync = new StateSync();