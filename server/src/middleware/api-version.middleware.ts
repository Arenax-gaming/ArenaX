import type { Request, Response, NextFunction, RequestHandler } from 'express'

/**
 * Foundation for the API versioning + deprecation strategy tracked in #476.
 *
 * Strategy: URL-segment versioning (`/api/v1/...`, `/api/v2/...`) with
 * `Accept` header overrides for clients that want to pin an older
 * version without changing URLs. URL was chosen over header-only
 * versioning because every existing log line, CDN rule, and metric
 * already keys on the URL; preserving that gives migration teams a
 * cheap analytics signal.
 *
 * What this file owns:
 *   - The shape of the version registry: which versions are live,
 *     which are deprecated, when the sunset date is.
 *   - The middleware that resolves a request's version from URL or
 *     header, stashes it on `res.locals.apiVersion`, and adds the
 *     `Deprecation` / `Sunset` response headers from RFC 8594 when
 *     applicable.
 *   - A small helper for routers that want to mount per-version
 *     controllers without repeating the `/api/vN` prefix everywhere.
 *
 * Controller migration: existing routes stay on whichever path they
 * have today. As they move under `/api/vN/…` they pick up the
 * deprecation headers automatically — no per-controller changes.
 */

export type ApiVersionStatus = 'live' | 'deprecated' | 'sunset'

export interface ApiVersionDescriptor {
    name: string // "v1", "v2026-06"
    status: ApiVersionStatus
    /** ISO timestamp the version started accepting traffic. */
    introducedAt: string
    /** Set when status is `deprecated`. */
    deprecatedAt?: string
    /** Set when status is `deprecated`. RFC 8594 Sunset header. */
    sunsetAt?: string
    /** Optional URL to the migration guide. RFC 8594 Link header. */
    migrationGuide?: string
}

export interface ApiVersionRegistry {
    list(): ApiVersionDescriptor[]
    /** Look up the version by name (case-insensitive). */
    resolve(name: string): ApiVersionDescriptor | null
    /** Default version when the URL doesn't include one. */
    getDefault(): ApiVersionDescriptor
}

export class InMemoryApiVersionRegistry implements ApiVersionRegistry {
    private readonly versions = new Map<string, ApiVersionDescriptor>()
    private defaultVersion: ApiVersionDescriptor | null = null

    register(version: ApiVersionDescriptor, options: { default?: boolean } = {}): void {
        if (version.status === 'deprecated' && (!version.deprecatedAt || !version.sunsetAt)) {
            throw new Error(
                `api-version: "${version.name}" is deprecated but missing deprecatedAt/sunsetAt`,
            )
        }
        this.versions.set(version.name.toLowerCase(), version)
        if (options.default) {
            this.defaultVersion = version
        }
    }

    list(): ApiVersionDescriptor[] {
        return Array.from(this.versions.values())
    }

    resolve(name: string): ApiVersionDescriptor | null {
        return this.versions.get(name.toLowerCase()) ?? null
    }

    getDefault(): ApiVersionDescriptor {
        if (!this.defaultVersion) {
            throw new Error('api-version: no default version registered')
        }
        return this.defaultVersion
    }
}

const VERSION_URL_PATTERN = /^\/api\/(v[A-Za-z0-9._-]+)(\/|$)/
const ACCEPT_VERSION_PATTERN = /version=([A-Za-z0-9._-]+)/

function resolveRequestedVersion(req: Request): { fromUrl: boolean; name: string | null } {
    const urlMatch = req.path.match(VERSION_URL_PATTERN)
    if (urlMatch) return { fromUrl: true, name: urlMatch[1] }

    const accept = req.headers['accept']
    if (typeof accept === 'string') {
        const headerMatch = accept.match(ACCEPT_VERSION_PATTERN)
        if (headerMatch) return { fromUrl: false, name: headerMatch[1] }
    }

    return { fromUrl: false, name: null }
}

export interface ApiVersionLocals {
    apiVersion: ApiVersionDescriptor
    apiVersionFromUrl: boolean
}

/**
 * Resolve the request's version, attach it to `res.locals`, set
 * deprecation headers when applicable, and reject sunset versions
 * with 410 Gone.
 *
 * Mount this on the API router before the per-version sub-routers
 * (e.g. `app.use('/api', apiVersionMiddleware(registry))`).
 */
export function apiVersionMiddleware(registry: ApiVersionRegistry): RequestHandler {
    return (req: Request, res: Response, next: NextFunction) => {
        const requested = resolveRequestedVersion(req)
        let descriptor: ApiVersionDescriptor | null = requested.name
            ? registry.resolve(requested.name)
            : null

        if (requested.name && !descriptor) {
            res.status(404).json({
                error: 'unknown_api_version',
                requested: requested.name,
                supported: registry.list().map((v) => v.name),
            })
            return
        }

        if (!descriptor) {
            descriptor = registry.getDefault()
        }

        if (descriptor.status === 'sunset') {
            res.status(410).json({
                error: 'api_version_sunset',
                version: descriptor.name,
                sunsetAt: descriptor.sunsetAt,
                migrationGuide: descriptor.migrationGuide,
            })
            return
        }

        if (descriptor.status === 'deprecated') {
            // RFC 8594 deprecation signalling. Clients SHOULD log these
            // headers; an admin dashboard tracking version usage will
            // surface them automatically.
            if (descriptor.deprecatedAt) res.setHeader('Deprecation', descriptor.deprecatedAt)
            if (descriptor.sunsetAt) res.setHeader('Sunset', descriptor.sunsetAt)
            if (descriptor.migrationGuide) {
                res.setHeader(
                    'Link',
                    `<${descriptor.migrationGuide}>; rel="deprecation"; type="text/html"`,
                )
            }
        }

        const locals = res.locals as Partial<ApiVersionLocals>
        locals.apiVersion = descriptor
        locals.apiVersionFromUrl = requested.fromUrl
        next()
    }
}
