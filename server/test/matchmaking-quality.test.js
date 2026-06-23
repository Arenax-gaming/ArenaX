import test from 'node:test'
import assert from 'node:assert'

test('MovingAverageSkillPredictor returns visible rating with low confidence for new players', async () => {
  const { MovingAverageSkillPredictor } = await import('../dist/services/matchmaking-quality.service.js')
  const predictor = new MovingAverageSkillPredictor()
  const prediction = predictor.predict({ playerId: 'p1', rating: 1200 })
  assert.strictEqual(prediction.predictedRating, 1200)
  assert.ok(prediction.confidence <= 0.2, 'confidence should be low for a player without history')
})

test('MovingAverageSkillPredictor blends recent ratings into the visible rating', async () => {
  const { MovingAverageSkillPredictor } = await import('../dist/services/matchmaking-quality.service.js')
  const predictor = new MovingAverageSkillPredictor(5)
  const prediction = predictor.predict({
    playerId: 'p1',
    rating: 1300,
    recentRatings: [1200, 1210, 1220, 1230, 1240],
  })
  // Mean of recent = 1220; blend = 0.6 * 1220 + 0.4 * 1300 = 1252
  assert.strictEqual(prediction.predictedRating, 1252)
  assert.ok(prediction.confidence > 0.3, 'confidence should rise with more samples')
})

test('scoreMatchQuality returns ~1 for tightly balanced teams', async () => {
  const { scoreMatchQuality } = await import('../dist/services/matchmaking-quality.service.js')
  const result = scoreMatchQuality({
    teamA: [
      { playerId: 'a1', rating: 1500, regionLatencyMs: 30, behaviourCluster: 'aggressive' },
      { playerId: 'a2', rating: 1500, regionLatencyMs: 30, behaviourCluster: 'support' },
    ],
    teamB: [
      { playerId: 'b1', rating: 1500, regionLatencyMs: 30, behaviourCluster: 'aggressive' },
      { playerId: 'b2', rating: 1500, regionLatencyMs: 30, behaviourCluster: 'support' },
    ],
  })
  assert.ok(result.score > 0.95, `expected near-perfect score, got ${result.score}`)
  assert.strictEqual(result.breakdown.skillBalance, 1)
  assert.strictEqual(result.breakdown.teamSizeBalance, 1)
})

test('scoreMatchQuality penalises team-size imbalance', async () => {
  const { scoreMatchQuality } = await import('../dist/services/matchmaking-quality.service.js')
  const result = scoreMatchQuality({
    teamA: [
      { playerId: 'a1', rating: 1500 },
      { playerId: 'a2', rating: 1500 },
    ],
    teamB: [{ playerId: 'b1', rating: 1500 }],
  })
  assert.ok(result.breakdown.teamSizeBalance < 1)
  assert.ok(result.score < 0.95)
})

test('scoreMatchQuality penalises a large skill gap', async () => {
  const { scoreMatchQuality } = await import('../dist/services/matchmaking-quality.service.js')
  const result = scoreMatchQuality({
    teamA: [{ playerId: 'a1', rating: 1000 }],
    teamB: [{ playerId: 'b1', rating: 1500 }],
  })
  assert.strictEqual(result.breakdown.skillBalance, 0)
})
