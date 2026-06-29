import test from 'node:test'
import assert from 'node:assert'

test('getGraphQLExecutor returns an executor with mount and stop', async () => {
  const { getGraphQLExecutor } = await import('../dist/graphql/server.js')
  const exec = getGraphQLExecutor()
  assert.ok(typeof exec.mount === 'function')
  assert.ok(typeof exec.stop === 'function')
})

test('setGraphQLExecutor allows swapping executor', async () => {
  const { getGraphQLExecutor, setGraphQLExecutor } = await import('../dist/graphql/server.js')
  const original = getGraphQLExecutor()

  const mock = { mount() { return { path: '/test', handler: () => {} } }, async stop() {} }
  setGraphQLExecutor(mock)
  assert.strictEqual(getGraphQLExecutor(), mock)

  setGraphQLExecutor(original)
  assert.strictEqual(getGraphQLExecutor(), original)
})

test('getGraphQLSchemaSDL returns the schema string', async () => {
  const { getGraphQLSchemaSDL } = await import('../dist/graphql/server.js')
  const sdl = getGraphQLSchemaSDL()
  assert.ok(sdl.includes('directive @auth'))
  assert.ok(sdl.includes('type Subscription'))
  assert.ok(sdl.includes('type Query'))
})
