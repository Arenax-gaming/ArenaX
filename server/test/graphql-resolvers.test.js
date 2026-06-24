import test from 'node:test'
import assert from 'node:assert'

test('typeDefs includes Subscription type', async () => {
  const { typeDefs } = await import('../dist/graphql/schema.js')
  assert.ok(typeDefs.includes('type Subscription'))
  assert.ok(typeDefs.includes('viewerRatingChanged'))
  assert.ok(typeDefs.includes('matchEvents'))
})

test('typeDefs includes Mutation type', async () => {
  const { typeDefs } = await import('../dist/graphql/schema.js')
  assert.ok(typeDefs.includes('type Mutation'))
  assert.ok(typeDefs.includes('joinMatchmakingQueue'))
  assert.ok(typeDefs.includes('leaveMatchmakingQueue'))
})

test('resolvers exports Query and Subscription keys', async () => {
  const { resolvers } = await import('../dist/graphql/resolvers.js')
  assert.ok(resolvers.Query)
  assert.ok(resolvers.Subscription)
  assert.ok(resolvers.Mutation)
})

test('Subscription.viewerRatingChanged has subscribe and resolve', async () => {
  const { resolvers } = await import('../dist/graphql/resolvers.js')
  const sub = resolvers.Subscription.viewerRatingChanged
  assert.ok(typeof sub.subscribe === 'function')
  assert.ok(typeof sub.resolve === 'function')
})

test('publishToTopic delivers to subscribers', async () => {
  const { publishToTopic } = await import('../dist/graphql/resolvers.js')
  const received = []
  const unsub = await (async () => {
    const { subscribeToTopic } = await import('../dist/graphql/resolvers.js')
    return subscribeToTopic('test-topic', (payload) => { received.push(payload) })
  })()
  publishToTopic('test-topic', { hello: 'world' })
  assert.strictEqual(received.length, 1)
  assert.deepStrictEqual(received[0], { hello: 'world' })
  unsub()
})
