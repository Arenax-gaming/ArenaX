const assert = require('node:assert');
const { describe, it, beforeEach } = require('node:test');

const { GameSessionService, clearSessionStore } = require('../dist/services/game-session.service.js');
const { cacheService } = require('../dist/services/cache.service.js');

describe('GameSessionService Distributed Cache', () => {
  let service;

  beforeEach(() => {
    clearSessionStore();
    service = new GameSessionService();
  });

  it('should create and retrieve game session from local and distributed cache', async () => {
    const session = await service.createSessionAsync(['player-1', 'player-2'], '1v1', { map: 'arena_alpha' });
    assert.ok(session.id);
    assert.strictEqual(session.gameMode, '1v1');

    const retrieved = await service.getSessionAsync(session.id);
    assert.ok(retrieved);
    assert.strictEqual(retrieved.id, session.id);

    // Verify key exists in cacheService
    const cachedData = await cacheService.get(`game:session:${session.id}`);
    assert.ok(cachedData);
    assert.strictEqual(cachedData.id, session.id);
  });

  it('should invalidate cache when session is removed', async () => {
    const session = await service.createSessionAsync(['p1', 'p2'], '2v2');
    await service.updateGameState(session.id, { score: 10 });

    await service.removeSessionAsync(session.id);

    const cachedData = await cacheService.get(`game:session:${session.id}`);
    assert.strictEqual(cachedData, null);

    const stateData = await cacheService.get(`game:state:${session.id}`);
    assert.strictEqual(stateData, null);
  });

  it('should update cached state when player acts', async () => {
    const session = await service.createSessionAsync(['player-x', 'player-y'], '1v1');
    await service.processPlayerAction(session.id, 'player-x', { type: 'ATTACK', power: 50 });

    const updatedSession = await service.getSessionAsync(session.id);
    assert.strictEqual(updatedSession.actions.length, 1);
    assert.strictEqual(updatedSession.actions[0].action.type, 'ATTACK');

    const cachedSession = await cacheService.get(`game:session:${session.id}`);
    assert.strictEqual(cachedSession.actions.length, 1);
  });
});
