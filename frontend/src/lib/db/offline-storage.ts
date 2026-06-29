import { db } from './db';
import { SyncEvent } from './types';

// ---------------------------------------------------------------------------
// OfflineStorage — queues writes made while offline and replays when online
// ---------------------------------------------------------------------------

class OfflineStorage {
  private online = navigator.onLine;
  private syncInProgress = false;

  constructor() {
    window.addEventListener('online', () => this.handleOnline());
    window.addEventListener('offline', () => { this.online = false; });
  }

  // ── Queue operations ───────────────────────────────────────────────────

  async queueWrite(event: Omit<SyncEvent, 'id' | 'retryCount'>): Promise<void> {
    const id = `${event.store}_${event.key}_${event.timestamp}`;
    const evt: SyncEvent = {
      ...event,
      id,
      retryCount: 0,
    };
    await db.set('pendingSync', evt);
  }

  async getPendingWrites(): Promise<SyncEvent[]> {
    const all = await db.getAll<SyncEvent & { id: string }>('pendingSync');
    return all.filter((e) => !e.synced);
  }

  async markSynced(id: string): Promise<void> {
    const evt = await db.get<SyncEvent & { id: string }>('pendingSync', id);
    if (evt) {
      evt.synced = true;
      await db.set('pendingSync', evt);
    }
  }

  async removeSynced(id: string): Promise<void> {
    await db.delete('pendingSync', id);
  }

  // ── Replay queue ───────────────────────────────────────────────────────

  async replayQueue(syncFn: (events: SyncEvent[]) => Promise<boolean>): Promise<{ synced: number; failed: number }> {
    if (this.syncInProgress) return { synced: 0, failed: 0 };
    this.syncInProgress = true;

    try {
      const pending = await this.getPendingWrites();
      if (pending.length === 0) return { synced: 0, failed: 0 };

      const result = await syncFn(pending);

      if (result) {
        for (const evt of pending) {
          await this.removeSynced(evt.id);
        }
        return { synced: pending.length, failed: 0 };
      }

      let synced = 0;
      let failed = 0;
      // Increment retry, remove if exceeded
      for (const evt of pending) {
        evt.retryCount++;
        if (evt.retryCount >= 5) {
          await this.removeSynced(evt.id);
          failed++;
        } else {
          const evtWithId = evt as SyncEvent & { id: string };
          evtWithId.id = evt.id;
          await db.set('pendingSync', evtWithId);
          synced++;
        }
      }
      return { synced, failed };
    } finally {
      this.syncInProgress = false;
    }
  }

  // ── Internal ───────────────────────────────────────────────────────────

  private async handleOnline(): Promise<void> {
    this.online = true;
    // This will be overridden by the consumer via replayQueue
  }

  get isOnline(): boolean {
    return this.online;
  }

  get pendingCount(): Promise<number> {
    return db.count('pendingSync');
  }
}

export const offlineStorage = new OfflineStorage();