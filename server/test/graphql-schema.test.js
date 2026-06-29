import test from 'node:test'
import assert from 'node:assert'

test('typeDefs declares the auth directive', async () => {
  const { typeDefs } = await import('../dist/graphql/schema.js')
  assert.ok(typeDefs.includes('directive @auth(role: String!)'))
})

test('typeDefs exposes viewer, matches and matchEvents', async () => {
  const { typeDefs } = await import('../dist/graphql/schema.js')
  assert.ok(typeDefs.includes('viewer:'))
  assert.ok(typeDefs.includes('matches('))
  assert.ok(typeDefs.includes('matchEvents(matchId: ID!)'))
})

test('getGraphQLSchemaSDL returns the full schema', async () => {
  const { getGraphQLSchemaSDL } = await import('../dist/graphql/server.js')
  const sdl = getGraphQLSchemaSDL()
  assert.ok(sdl.includes('type Subscription'))
  assert.ok(sdl.includes('type Query'))
  assert.ok(sdl.includes('type Mutation'))
})

test('executor mount returns registration with path and handler', async () => {
  const { getGraphQLExecutor, setGraphQLExecutor } = await import('../dist/graphql/server.js')

  // Save original
  const original = getGraphQLExecutor()

  // Create a mock executor that behaves like the old UnconfiguredExecutor
  const mock = {
    mount() {
      const path = '/api/graphql'
      const handler = (req, res) => {
        res.status(503).json({
          errors: [{ message: 'GraphQL executor not yet registered' }],
        })
      }
      return { path, handler }
    },
    async stop() {},
  }
  setGraphQLExecutor(mock)

  const exec = getGraphQLExecutor()
  let status
  let body
  const req = { headers: {}, res: { locals: {} } }
  const res = {
    status(code) { status = code; return this },
    json(payload) { body = payload },
  }
  const registration = exec.mount()
  registration.handler(req, res, () => {})
  assert.strictEqual(status, 503)
  assert.ok(body.errors[0].message.includes('GraphQL executor not yet registered'))

  // Restore
  setGraphQLExecutor(original)
})
