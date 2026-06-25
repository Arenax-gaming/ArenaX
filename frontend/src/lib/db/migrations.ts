import { db } from './db';
import { Migration, MigrationResult } from './types';

// ---------------------------------------------------------------------------
// Migration Manager
// ---------------------------------------------------------------------------

class MigrationManager {
  private migrations: Migration[] = [];
  private applied = new Set<number>();

  /**
   * Register a migration.
   */
  register(migration: Migration): void {
    if (this.migrations.some((m) => m.version === migration.version)) {
      throw new Error(`Migration version ${migration.version} already registered`);
    }
    this.migrations.push(migration);
    this.migrations.sort((a, b) => a.version - b.version);
  }

  /**
   * Register multiple migrations.
   */
  registerAll(migrations: Migration[]): void {
    for (const m of migrations) {
      this.register(m);
    }
  }

  /**
   * Run all pending migrations.
   */
  async runAll(): Promise<MigrationResult[]> {
    const results: MigrationResult[] = [];
    const currentVersion = await this.getCurrentVersion();

    const pending = this.migrations.filter((m) => m.version > currentVersion);
    if (pending.length === 0) {
      return [{ fromVersion: currentVersion, toVersion: currentVersion, success: true, durationMs: 0 }];
    }

    let version = currentVersion;

    for (const migration of pending) {
      const start = Date.now();
      try {
        await migration.up(await db.init());
        const durationMs = Date.now() - start;

        await this.setVersion(migration.version);
        version = migration.version;
        this.applied.add(migration.version);

        results.push({
          fromVersion: currentVersion,
          toVersion: migration.version,
          success: true,
          durationMs,
        });

        console.log(`[Migration] Applied v${migration.version}: ${migration.name}`);
      } catch (err) {
        const durationMs = Date.now() - start;
        results.push({
          fromVersion: currentVersion,
          toVersion: migration.version,
          success: false,
          error: err instanceof Error ? err.message : String(err),
          durationMs,
        });
        console.error(`[Migration] Failed v${migration.version}: ${migration.name}`, err);
        break;
      }
    }

    return results;
  }

  /**
   * Roll back the most recent migration.
   */
  async rollbackOne(): Promise<MigrationResult> {
    const currentVersion = await this.getCurrentVersion();
    const target = this.migrations.find((m) => m.version === currentVersion);

    if (!target) {
      return { fromVersion: currentVersion, toVersion: currentVersion, success: false, error: 'No migration to roll back', durationMs: 0 };
    }
    if (!target.down) {
      return { fromVersion: currentVersion, toVersion: currentVersion, success: false, error: 'Migration has no down function', durationMs: 0 };
    }

    const start = Date.now();
    try {
      await target.down(await db.init());
      const prevVersion = this.getPreviousVersion(currentVersion);
      await this.setVersion(prevVersion);
      this.applied.delete(currentVersion);

      const durationMs = Date.now() - start;
      console.log(`[Migration] Rolled back v${currentVersion}: ${target.name}`);
      return { fromVersion: currentVersion, toVersion: prevVersion, success: true, durationMs };
    } catch (err) {
      const durationMs = Date.now() - start;
      return {
        fromVersion: currentVersion,
        toVersion: currentVersion,
        success: false,
        error: err instanceof Error ? err.message : String(err),
        durationMs,
      };
    }
  }

  /**
   * List pending migrations.
   */
  getPending(): Migration[] {
    const currentVersion = this.getCurrentVersionSync();
    return this.migrations.filter((m) => m.version > currentVersion);
  }

  /**
   * List all registered migrations.
   */
  listAll(): Migration[] {
    return [...this.migrations];
  }

  // ── Internals ──────────────────────────────────────────────────────────

  private async getCurrentVersion(): Promise<number> {
    try {
      const version = await db.get<{ value: number }>('cache', '_migration_version');
      return version?.value ?? 0;
    } catch {
      return 0;
    }
  }

  private getCurrentVersionSync(): number {
    return Array.from(this.applied).reduce((max, v) => Math.max(max, v), 0);
  }

  private async setVersion(version: number): Promise<void> {
    await db.set('cache', { key: '_migration_version', value: version });
  }

  private getPreviousVersion(version: number): number {
    const sorted = this.migrations.map((m) => m.version).sort((a, b) => a - b);
    const idx = sorted.indexOf(version);
    return idx > 0 ? sorted[idx - 1] : 0;
  }
}

export const migrationManager = new MigrationManager();