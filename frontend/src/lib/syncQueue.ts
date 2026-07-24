"use client";

import { idbGet, idbSet } from "./offlineStorage";

const QUEUE_KEY = "offline:sync-queue";

export interface SyncItem {
  id: string;
  url: string;
  method: string;
  body?: string;
  headers?: Record<string, string>;
  /** Unix ms timestamp – used for Last-Write-Wins conflict resolution */
  timestamp: number;
}

async function readQueue(): Promise<SyncItem[]> {
  return (await idbGet<SyncItem[]>(QUEUE_KEY)) ?? [];
}

async function writeQueue(queue: SyncItem[]): Promise<void> {
  await idbSet(QUEUE_KEY, queue);
}

/** Enqueue a mutation that should be replayed when back online. */
export async function enqueueSync(
  item: Omit<SyncItem, "id" | "timestamp">
): Promise<void> {
  const queue = await readQueue();

  // Last-Write-Wins: if the same URL+method already exists, replace with newer timestamp
  const idx = queue.findIndex(
    (q) => q.url === item.url && q.method === item.method
  );

  const entry: SyncItem = {
    ...item,
    id: crypto.randomUUID(),
    timestamp: Date.now(),
  };

  if (idx >= 0) {
    queue.splice(idx, 1, entry);
  } else {
    queue.push(entry);
  }

  await writeQueue(queue);
}

/** Replay all queued mutations in chronological order. Removes each on success. */
export async function flushSyncQueue(
  onProgress?: (remaining: number) => void
): Promise<void> {
  let queue = await readQueue();
  // Ensure chronological order
  queue.sort((a, b) => a.timestamp - b.timestamp);

  for (const item of [...queue]) {
    try {
      const token =
        typeof localStorage !== "undefined"
          ? (localStorage.getItem("auth_token") ??
            sessionStorage.getItem("auth_token"))
          : null;

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...item.headers,
      };
      if (token) headers.Authorization = `Bearer ${token}`;

      const res = await fetch(item.url, {
        method: item.method,
        body: item.body,
        headers,
      });

      // 2xx or 409 (conflict already resolved server-side) → remove from queue
      if (res.ok || res.status === 409) {
        queue = queue.filter((q) => q.id !== item.id);
        await writeQueue(queue);
        onProgress?.(queue.length);
      }
    } catch {
      // Network still unavailable – stop and try again later
      break;
    }
  }
}

export async function getSyncQueueLength(): Promise<number> {
  return (await readQueue()).length;
}
