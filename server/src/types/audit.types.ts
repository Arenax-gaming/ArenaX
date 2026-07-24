/**
 * Canonical type definitions for the Comprehensive Audit Trail System.
 * Issue #471 — shared by audit.service.ts, audit-anchor.service.ts, and consumers.
 */

// ─── Enums ────────────────────────────────────────────────────────────────────

export enum AuditStatus {
  SUCCESS  = 'SUCCESS',
  FAILED   = 'FAILED',
  CRITICAL = 'CRITICAL',
}

// ─── Actor ────────────────────────────────────────────────────────────────────

export interface AuditActor {
  userId:    string;
  role:      string;
  ipAddress: string | null;
  userAgent: string | null;
}

// ─── Core event schema ────────────────────────────────────────────────────────

/**
 * Fully-specified audit event — the canonical unit written to the ledger.
 * Every field maps 1-to-1 to an AuditLog DB column.
 */
export interface AuditEvent {
  /** UUIDv4 — auto-assigned by AuditService.log() */
  eventId:      string;
  /** ISO-8601 string */
  timestamp:    string;
  actor:        AuditActor;
  /** Dot-separated domain.verb, e.g. "user.login", "wallet.withdraw" */
  action:       string;
  status:       AuditStatus;
  targetType:   string;
  targetId:     string;
  /** Before/after state delta or generic contextual metadata */
  payload: {
    before?: Record<string, unknown>;
    after?:  Record<string, unknown>;
    meta?:   Record<string, unknown>;
  };
  /** SHA-256 hex of the previous AuditLog entry (null for genesis) */
  previousHash: string | null;
  /** SHA-256 hex of this event's canonical fields + previousHash */
  hash:         string;
  /** Cross-service trace id */
  correlationId?: string;
  requestId?:     string;
}

// ─── Blockchain anchoring ─────────────────────────────────────────────────────

/**
 * Interface for blockchain anchor providers.
 * Swap implementations to target Arweave, Ethereum, Stellar Soroban, etc.
 */
export interface IBlockchainAnchorProvider {
  /**
   * Push the Merkle root of a batch of critical audit hashes to a public ledger.
   * Returns a transaction / proof identifier.
   */
  anchorHash(rootHash: string, metadata?: Record<string, unknown>): Promise<string>;
}
