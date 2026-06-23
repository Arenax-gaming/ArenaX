/**
 * Foundation for the centralised secret management work tracked in #484.
 *
 * The existing code reads secrets directly from `process.env`. This file
 * introduces a {@link SecretProvider} abstraction so the same call sites
 * can swap to HashiCorp Vault, AWS Secrets Manager, or Doppler without
 * touching service code.
 *
 * Behaviours:
 *   - Lazy fetch + in-process cache, so the hot path doesn't hit Vault
 *     on every request.
 *   - TTL-based rotation so a rotated secret stops being served from
 *     the cache within `cacheTtlMs` of its rotation time.
 *   - Audit hook (`onAccess`) every time a secret is read — production
 *     wiring sends this to the existing audit.service so secret access
 *     shows up in the audit trail without a per-secret patch.
 *   - Strict mode (`requireKey`) that throws when a secret is missing,
 *     matching the production behaviour we want when JWT_SECRET / db
 *     creds aren't configured.
 *
 * Real Vault wiring lives in a follow-up — the current
 * EnvSecretProvider keeps the .env-as-source-of-truth contract intact
 * while the rest of the service migrates.
 */

export interface SecretAccessEvent {
    key: string
    hit: 'cache' | 'fresh'
    timestamp: number
    /** Caller-supplied label so the audit trail names the use site. */
    requester?: string
}

export interface SecretProvider {
    /** Fetch a secret; return null when the key is unknown. */
    get(key: string, requester?: string): Promise<string | null>
    /** Strict variant: throws when the secret is missing or empty. */
    requireKey(key: string, requester?: string): Promise<string>
    /** Force the next read of `key` to bypass the cache. */
    invalidate(key: string): void
    /** Wipe every cached secret. Test + shutdown helper. */
    invalidateAll(): void
}

export interface SecretProviderOptions {
    cacheTtlMs?: number
    onAccess?: (event: SecretAccessEvent) => void
    now?: () => number
}

interface CacheEntry {
    value: string | null
    fetchedAt: number
}

abstract class BaseSecretProvider implements SecretProvider {
    protected readonly cache = new Map<string, CacheEntry>()
    protected readonly cacheTtlMs: number
    protected readonly onAccess: (event: SecretAccessEvent) => void
    protected readonly now: () => number

    constructor(options: SecretProviderOptions = {}) {
        this.cacheTtlMs = options.cacheTtlMs ?? 60_000
        this.onAccess = options.onAccess ?? (() => undefined)
        this.now = options.now ?? Date.now
    }

    protected abstract fetch(key: string): Promise<string | null>

    async get(key: string, requester?: string): Promise<string | null> {
        const cached = this.cache.get(key)
        const now = this.now()
        if (cached && now - cached.fetchedAt < this.cacheTtlMs) {
            this.onAccess({ key, hit: 'cache', timestamp: now, requester })
            return cached.value
        }
        const fresh = await this.fetch(key)
        this.cache.set(key, { value: fresh, fetchedAt: now })
        this.onAccess({ key, hit: 'fresh', timestamp: now, requester })
        return fresh
    }

    async requireKey(key: string, requester?: string): Promise<string> {
        const value = await this.get(key, requester)
        if (!value) {
            throw new Error(`secrets.service: required secret "${key}" is missing or empty.`)
        }
        return value
    }

    invalidate(key: string): void {
        this.cache.delete(key)
    }

    invalidateAll(): void {
        this.cache.clear()
    }
}

/**
 * Default provider. Reads secrets from `process.env` so dev / test
 * deployments work the same way they always have. Production swaps
 * this out for a Vault / AWS Secrets Manager implementation through
 * {@link setSecretProvider}.
 */
export class EnvSecretProvider extends BaseSecretProvider {
    protected async fetch(key: string): Promise<string | null> {
        const raw = process.env[key]
        if (!raw) return null
        return raw
    }
}

/**
 * Provider that delegates to an async lookup function. Use this from
 * a Vault adapter so the adapter only has to implement `lookup` —
 * caching, audit, and `requireKey` come from the base class.
 */
export class DelegatingSecretProvider extends BaseSecretProvider {
    constructor(
        private readonly lookup: (key: string) => Promise<string | null>,
        options: SecretProviderOptions = {},
    ) {
        super(options)
    }

    protected fetch(key: string): Promise<string | null> {
        return this.lookup(key)
    }
}

let activeProvider: SecretProvider = new EnvSecretProvider()

export function getSecretProvider(): SecretProvider {
    return activeProvider
}

export function setSecretProvider(provider: SecretProvider): void {
    activeProvider = provider
}

export async function getSecret(key: string, requester?: string): Promise<string | null> {
    return activeProvider.get(key, requester)
}

export async function requireSecret(key: string, requester?: string): Promise<string> {
    return activeProvider.requireKey(key, requester)
}
