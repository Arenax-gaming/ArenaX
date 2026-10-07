# Security Advisory: Twitch OAuth token substitution

| | |
|---|---|
| **ID** | ARENAX-2026-002 |
| **Component** | `server` — `src/services/auth.service.ts` |
| **Severity** | High |
| **Status** | Fixed |
| **Issue** | [#1160](https://github.com/Arenax-gaming/ArenaX/issues/1160) |

## Summary

`validateTwitchToken` forwarded a user-supplied Twitch access token directly to
the Twitch Helix `/users` endpoint, using only ArenaX's `TWITCH_CLIENT_ID` in the
`Client-Id` header. It never verified that the token had actually been **issued
to** that client id.

As a result, any Twitch access token — including one issued to an unrelated
Twitch application controlled by an attacker — was accepted. An attacker who
registered their own Twitch app, sent a victim through that app's OAuth consent
screen, and captured the resulting token could authenticate to ArenaX as the
victim and take over their ArenaX account.

## Affected code (before)

```ts
async function validateTwitchToken(accessToken: string) {
    const response = await axios.get('https://api.twitch.tv/helix/users', {
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Client-Id': process.env.TWITCH_CLIENT_ID || ''   // never verified
        }
    });

    const { email, id, login } = response.data.data[0];
    return { email: email || `${id}@twitch.local`, username: login || `twitch_${id}`, providerId: id };
}
```

The `Client-Id` header only tells Twitch which app is *asking*. It does not
constrain which app the bearer token was minted for, so the check was cosmetic.

## Impact

* Authentication bypass / account takeover for any user who has linked Twitch.
* No interaction with the victim's ArenaX password was required.

## Fix

Two independent controls were added in a new module,
`server/src/services/twitch-oauth.service.ts`:

### 1. Authorization Code flow (preferred)

`POST /auth/social/twitch` now accepts a short-lived `code` plus the
`redirectUri` it was issued for. The code is redeemed **server-side** at
`https://id.twitch.tv/oauth2/token` using our client id *and* client secret, so
the resulting token provably belongs to ArenaX and the client never has to
handle a Twitch token at all.

Implemented by `exchangeTwitchAuthorizationCode` and
`resolveTwitchProfileFromAuthorizationCode`.

### 2. Introspection of the legacy access-token path

For existing clients that still post an `accessToken`, the token is first
introspected via `https://id.twitch.tv/oauth2/validate`. Twitch reports the
`client_id` the token was issued to, and the request is rejected with **401**
unless it matches `TWITCH_CLIENT_ID`.

A mismatch is logged as a security alert (expected vs presented client id, plus
the Twitch user id) so substitution attempts are detectable:

```ts
if (introspection.client_id !== clientId) {
    logger.warn('Security alert: rejected Twitch token issued to a different application', { ... });
    throw new HttpError(401, 'Twitch token was issued to a different application');
}
```

Expired, revoked and malformed tokens are rejected because Twitch answers `401`
to `/oauth2/validate` for them.

## Verification

`server/test/twitch-oauth.service.test.js` covers:

| Scenario | Expectation |
|---|---|
| Token issued to a different Twitch app | `401`, Helix never called |
| Expired / revoked token | `401` |
| Valid token for our `client_id` | profile returned, `Client-Id` forwarded |
| Authorization code exchange | code redeemed server-side with our secret |
| Expired / already-used code | `401` |
| Missing `redirectUri` with a code | `400` |
| `TWITCH_CLIENT_ID` unset | `503` (fails closed) |

## Operator actions

1. Set `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` (see `server/.env.example`).
2. Register `https://<your-domain>/api/v1/auth/twitch/callback` as an allowed
   redirect URI in the Twitch developer console.
3. Request the `user:read:email` scope so the profile lookup can return an email.
4. Prefer the Authorization Code flow on all clients; the `accessToken` path is
   retained only for backwards compatibility.
5. Review Twitch login logs for
   `Security alert: rejected Twitch token issued to a different application`.

## References

* Twitch — [Validate access token](https://dev.twitch.tv/docs/authentication/validate-tokens/)
* Twitch — [OAuth authorization code grant flow](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#authorization-code-grant-flow)
