import test from 'node:test'
import assert from 'node:assert'

const importService = () => import('../dist/services/twitch-oauth.service.js')

/** An axios-shaped failure carrying an HTTP status. */
const httpFailure = (status) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status },
  })

const unexpected = (name) => () => {
  throw new Error(`unexpected ${name} call`)
}

test('rejects a Twitch token issued to a different application', async () => {
  const { validateTwitchToken } = await importService()

  let helixCalled = false
  const client = {
    get: async (url) => {
      if (url.includes('/oauth2/validate')) {
        // A perfectly valid token — but minted for somebody else's app.
        return {
          data: {
            client_id: 'attacker-application',
            login: 'victim',
            user_id: '12345',
            expires_in: 3600,
          },
        }
      }
      helixCalled = true
      return { data: { data: [] } }
    },
    post: unexpected('post'),
  }

  await assert.rejects(
    () => validateTwitchToken('attacker-token', { client, env: { TWITCH_CLIENT_ID: 'our-app' } }),
    (error) => error.status === 401 && /different application/.test(error.message),
    'a token issued to another Twitch app must be rejected with 401'
  )

  assert.strictEqual(
    helixCalled,
    false,
    'the Helix API must never be called for a foreign-application token'
  )
})

test('rejects an expired or revoked Twitch token', async () => {
  const { validateTwitchToken } = await importService()

  const client = {
    get: async () => {
      // Twitch answers 401 for tokens that are expired, revoked or invalid.
      throw httpFailure(401)
    },
    post: unexpected('post'),
  }

  await assert.rejects(
    () => validateTwitchToken('stale-token', { client, env: { TWITCH_CLIENT_ID: 'our-app' } }),
    (error) => error.status === 401 && /expired or revoked/.test(error.message)
  )
})

test('accepts a token issued to our application and returns the profile', async () => {
  const { validateTwitchToken } = await importService()

  let receivedClientId
  const client = {
    get: async (url, config) => {
      if (url.includes('/oauth2/validate')) {
        return {
          data: { client_id: 'our-app', login: 'arena_player', user_id: '999', expires_in: 3600 },
        }
      }
      receivedClientId = config?.headers?.['Client-Id']
      return {
        data: { data: [{ id: '999', login: 'arena_player', email: 'player@example.com' }] },
      }
    },
    post: unexpected('post'),
  }

  const profile = await validateTwitchToken('good-token', {
    client,
    env: { TWITCH_CLIENT_ID: 'our-app' },
  })

  assert.deepStrictEqual(profile, {
    email: 'player@example.com',
    username: 'arena_player',
    providerId: '999',
  })
  assert.strictEqual(receivedClientId, 'our-app')
})

test('falls back to a placeholder email when Twitch omits one', async () => {
  const { validateTwitchToken } = await importService()

  const client = {
    get: async (url) => {
      if (url.includes('/oauth2/validate')) {
        return { data: { client_id: 'our-app', login: 'no_email', user_id: '321', expires_in: 60 } }
      }
      return { data: { data: [{ id: '321', login: 'no_email' }] } }
    },
    post: unexpected('post'),
  }

  const profile = await validateTwitchToken('good-token', {
    client,
    env: { TWITCH_CLIENT_ID: 'our-app' },
  })

  assert.strictEqual(profile.email, '321@twitch.local')
  assert.strictEqual(profile.username, 'no_email')
})

test('authorization code flow exchanges the code server-side before profiling', async () => {
  const { resolveTwitchProfileFromAuthorizationCode } = await importService()

  let exchangedBody
  const client = {
    post: async (url, body) => {
      exchangedBody = body
      return { data: { access_token: 'server-issued-token', refresh_token: 'refresh', expires_in: 3600 } }
    },
    get: async (url) => {
      if (url.includes('/oauth2/validate')) {
        return { data: { client_id: 'our-app', login: 'coder', user_id: '7', expires_in: 3600 } }
      }
      return { data: { data: [{ id: '7', login: 'coder', email: 'coder@example.com' }] } }
    },
  }

  const profile = await resolveTwitchProfileFromAuthorizationCode(
    'auth-code-123',
    'https://app.example.com/auth/twitch/callback',
    { client, env: { TWITCH_CLIENT_ID: 'our-app', TWITCH_CLIENT_SECRET: 'super-secret' } }
  )

  assert.strictEqual(profile.providerId, '7')
  assert.strictEqual(exchangedBody.get('grant_type'), 'authorization_code')
  assert.strictEqual(exchangedBody.get('code'), 'auth-code-123')
  assert.strictEqual(exchangedBody.get('client_id'), 'our-app')
  assert.strictEqual(exchangedBody.get('client_secret'), 'super-secret')
})

test('rejects an expired or already-used authorization code', async () => {
  const { exchangeTwitchAuthorizationCode } = await importService()

  const client = {
    get: unexpected('get'),
    post: async () => {
      throw httpFailure(400)
    },
  }

  await assert.rejects(
    () =>
      exchangeTwitchAuthorizationCode('used-code', 'https://app.example.com/callback', {
        client,
        env: { TWITCH_CLIENT_ID: 'our-app', TWITCH_CLIENT_SECRET: 'super-secret' },
      }),
    (error) => error.status === 401 && /already used/.test(error.message)
  )
})

test('requires a redirect URI when exchanging an authorization code', async () => {
  const { exchangeTwitchAuthorizationCode } = await importService()

  const client = { get: unexpected('get'), post: unexpected('post') }

  await assert.rejects(
    () =>
      exchangeTwitchAuthorizationCode('code', '', {
        client,
        env: { TWITCH_CLIENT_ID: 'our-app', TWITCH_CLIENT_SECRET: 'super-secret' },
      }),
    (error) => error.status === 400
  )
})

test('fails closed when TWITCH_CLIENT_ID is not configured', async () => {
  const { validateTwitchToken } = await importService()

  const client = { get: unexpected('get'), post: unexpected('post') }

  await assert.rejects(
    () => validateTwitchToken('some-token', { client, env: {} }),
    (error) => error.status === 503
  )
})

test('rejects a token endpoint response without an access token', async () => {
  const { exchangeTwitchAuthorizationCode } = await importService()

  const client = {
    get: unexpected('get'),
    post: async () => ({ data: { token_type: 'bearer' } }),
  }

  await assert.rejects(
    () =>
      exchangeTwitchAuthorizationCode('code', 'https://app.example.com/callback', {
        client,
        env: { TWITCH_CLIENT_ID: 'our-app', TWITCH_CLIENT_SECRET: 'super-secret' },
      }),
    (error) => error.status === 502
  )
})
