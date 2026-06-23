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

test('Unconfigured executor returns 503 with a GraphQL error envelope', async () => {
  const { getGraphQLExecutor } = await import('../dist/graphql/server.js')
  const exec = getGraphQLExecutor()
  let status
  let body
  const req = { headers: {}, res: { locals: {} } }
  const res = {
    status(code) { status = code; return this },
    json(payload) { body = payload },
  }
  // The mount helper attaches `handler` to the returned registration.
  const registration = exec.mount({ post() {}, get() {} })
  registration.handler(req, res, () => {})
  assert.strictEqual(status, 503)
  assert.ok(body.errors[0].message.includes('GraphQL executor not yet registered'))
})
