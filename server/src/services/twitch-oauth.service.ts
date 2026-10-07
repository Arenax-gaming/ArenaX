import axios from 'axios';
import { HttpError } from '../utils/http-error';
import { logger } from './logger.service';

/**
 * Twitch OAuth helpers (Issue #1160).
 *
 * The previous implementation forwarded a user-supplied access token straight
 * to the Twitch Helix API. Any token minted for *any* Twitch application was
 * therefore accepted, so an attacker with their own Twitch app could log in as
 * an arbitrary Twitch user (token substitution).
 *
 * Two fixes live here:
 *
 *  1. `resolveTwitchProfileFromAuthorizationCode` — the preferred Authorization
 *     Code flow. A short-lived code is exchanged server-side using our client
 *     secret, so the client never hands us a token it obtained elsewhere.
 *  2. `validateTwitchToken` — the legacy access-token path, now hardened. The
 *     token is introspected via `/oauth2/validate` and rejected unless Twitch
 *     confirms it was issued to *our* `client_id`.
 */

const TWITCH_VALIDATE_URL = 'https://id.twitch.tv/oauth2/validate';
const TWITCH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const TWITCH_USERS_URL = 'https://api.twitch.tv/helix/users';

export interface TwitchProfile {
    email: string;
    username: string;
    providerId: string;
}

/**
 * Narrow HTTP surface used by the flow. It exists so unit tests can drive the
 * whole exchange without network I/O; production code passes the axios-backed
 * default.
 */
export interface TwitchHttpClient {
    get(url: string, config?: { headers?: Record<string, string> }): Promise<{ data: unknown }>;
    post(
        url: string,
        body?: unknown,
        config?: { headers?: Record<string, string> }
    ): Promise<{ data: unknown }>;
}

const defaultHttpClient: TwitchHttpClient = {
    get: (url, config) => axios.get(url, config),
    post: (url, body, config) => axios.post(url, body, config)
};

/** Subset of Twitch's `/oauth2/validate` response that we rely on. */
export interface TwitchTokenIntrospection {
    client_id: string;
    login: string;
    user_id: string;
    expires_in: number;
}

export interface TwitchTokenExchangeResult {
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number;
}

export interface TwitchOAuthOptions {
    client?: TwitchHttpClient;
    /** Injectable for tests; defaults to `process.env`. */
    env?: NodeJS.ProcessEnv;
}

interface TwitchHelixUser {
    id: string;
    login?: string;
    display_name?: string;
    email?: string;
}

/**
 * Twitch's `client_id` is required for every call, so a missing value is a
 * deployment error (503) rather than a client error.
 */
export function requireTwitchClientId(env: NodeJS.ProcessEnv = process.env): string {
    const clientId = env.TWITCH_CLIENT_ID?.trim();
    if (!clientId) {
        throw new HttpError(503, 'Twitch login is not configured');
    }
    return clientId;
}

function requireTwitchClientCredentials(env: NodeJS.ProcessEnv = process.env): {
    clientId: string;
    clientSecret: string;
} {
    const clientId = requireTwitchClientId(env);
    const clientSecret = env.TWITCH_CLIENT_SECRET?.trim();

    if (!clientSecret) {
        throw new HttpError(503, 'Twitch login is not configured');
    }

    return { clientId, clientSecret };
}

/** True when `error` looks like an axios failure carrying the given HTTP status. */
function hasHttpStatus(error: unknown, status: number): boolean {
    if (typeof error !== 'object' || error === null) {
        return false;
    }
    const response = (error as { response?: { status?: number } }).response;
    return response?.status === status;
}

/**
 * Ask Twitch which application a bearer token was issued to.
 *
 * Twitch answers 401 for tokens that are expired, revoked, or simply invalid,
 * which is exactly the signal we need to reject them.
 */
export async function introspectTwitchToken(
    accessToken: string,
    options: TwitchOAuthOptions = {}
): Promise<TwitchTokenIntrospection> {
    const client = options.client ?? defaultHttpClient;

    let response: { data: unknown };
    try {
        response = await client.get(TWITCH_VALIDATE_URL, {
            headers: { Authorization: `OAuth ${accessToken}` }
        });
    } catch (error) {
        // Expired / revoked / malformed token.
        if (hasHttpStatus(error, 401)) {
            throw new HttpError(401, 'Twitch token is invalid, expired or revoked');
        }

        logger.error('Twitch token introspection failed', {
            reason: error instanceof Error ? error.message : String(error)
        });
        throw new HttpError(502, 'Unable to verify Twitch token');
    }

    const data = response.data as Partial<TwitchTokenIntrospection> | null | undefined;

    if (!data || typeof data.client_id !== 'string' || typeof data.user_id !== 'string') {
        throw new HttpError(401, 'Twitch token introspection returned an unexpected payload');
    }

    return {
        client_id: data.client_id,
        user_id: data.user_id,
        login: typeof data.login === 'string' ? data.login : '',
        expires_in: typeof data.expires_in === 'number' ? data.expires_in : 0
    };
}

/** Read the Twitch profile behind a token that has already been proven ours. */
export async function fetchTwitchProfile(
    accessToken: string,
    clientId: string,
    options: TwitchOAuthOptions = {}
): Promise<TwitchProfile> {
    const client = options.client ?? defaultHttpClient;

    let response: { data: unknown };
    try {
        response = await client.get(TWITCH_USERS_URL, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Client-Id': clientId
            }
        });
    } catch (error) {
        logger.error('Twitch Helix /users request failed', {
            reason: error instanceof Error ? error.message : String(error)
        });
        throw new HttpError(502, 'Unable to fetch the Twitch profile');
    }

    const users = (response.data as { data?: TwitchHelixUser[] } | null | undefined)?.data;
    const user = Array.isArray(users) ? users[0] : undefined;

    if (!user || typeof user.id !== 'string') {
        throw new HttpError(401, 'Twitch did not return a user for the supplied token');
    }

    return {
        // Twitch only returns `email` when the token carries the
        // `user:read:email` scope — fall back the same way the other providers do.
        email: user.email || `${user.id}@twitch.local`,
        username: user.login || user.display_name || `twitch_${user.id}`,
        providerId: user.id
    };
}

/**
 * Legacy path: validate a client-supplied access token.
 *
 * The token is introspected first and rejected when Twitch reports it was
 * issued to a different `client_id`. Without this check an attacker holding a
 * token from *their own* Twitch app could authenticate as any Twitch user.
 */
export async function validateTwitchToken(
    accessToken: string,
    options: TwitchOAuthOptions = {}
): Promise<TwitchProfile> {
    const clientId = requireTwitchClientId(options.env);
    const introspection = await introspectTwitchToken(accessToken, options);

    if (introspection.client_id !== clientId) {
        // Security alert: a token minted for another application was presented.
        logger.warn('Security alert: rejected Twitch token issued to a different application', {
            expectedClientId: clientId,
            presentedClientId: introspection.client_id,
            twitchUserId: introspection.user_id
        });
        throw new HttpError(401, 'Twitch token was issued to a different application');
    }

    return fetchTwitchProfile(accessToken, clientId, options);
}

/**
 * Exchange a Twitch Authorization Code for an access token, server-side.
 *
 * The code is single-use and short-lived, and the exchange is authenticated
 * with our client secret, so the resulting token provably belongs to our app.
 */
export async function exchangeTwitchAuthorizationCode(
    code: string,
    redirectUri: string,
    options: TwitchOAuthOptions = {}
): Promise<TwitchTokenExchangeResult> {
    const { clientId, clientSecret } = requireTwitchClientCredentials(options.env);
    const client = options.client ?? defaultHttpClient;

    if (!redirectUri) {
        throw new HttpError(400, 'redirectUri is required to complete Twitch login');
    }

    let response: { data: unknown };
    try {
        response = await client.post(
            TWITCH_TOKEN_URL,
            new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                code,
                grant_type: 'authorization_code',
                redirect_uri: redirectUri
            }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );
    } catch (error) {
        // 400/401/403 all mean "this code is not usable": expired, already
        // redeemed, or issued to a different client / redirect URI.
        if (
            hasHttpStatus(error, 400) ||
            hasHttpStatus(error, 401) ||
            hasHttpStatus(error, 403)
        ) {
            logger.warn('Twitch authorization code rejected', {
                reason: error instanceof Error ? error.message : String(error)
            });
            throw new HttpError(401, 'Twitch authorization code is invalid, expired or already used');
        }

        logger.error('Twitch authorization code exchange failed', {
            reason: error instanceof Error ? error.message : String(error)
        });
        throw new HttpError(502, 'Unable to complete Twitch login');
    }

    const data = response.data as
        | { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown }
        | null
        | undefined;

    if (!data || typeof data.access_token !== 'string' || data.access_token.length === 0) {
        throw new HttpError(502, 'Twitch token endpoint returned an unexpected payload');
    }

    return {
        accessToken: data.access_token,
        refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : undefined,
        expiresIn: typeof data.expires_in === 'number' ? data.expires_in : undefined
    };
}

/**
 * Preferred entry point: complete a Twitch login from an authorization code.
 *
 * The freshly issued token is still introspected so that a compromised or
 * misconfigured token endpoint cannot smuggle in a foreign-application token.
 */
export async function resolveTwitchProfileFromAuthorizationCode(
    code: string,
    redirectUri: string,
    options: TwitchOAuthOptions = {}
): Promise<TwitchProfile> {
    const exchanged = await exchangeTwitchAuthorizationCode(code, redirectUri, options);
    return validateTwitchToken(exchanged.accessToken, options);
}
