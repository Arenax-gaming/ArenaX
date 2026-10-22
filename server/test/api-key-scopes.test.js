const assert = require('node:assert');
const { describe, it, before, after } = require('node:test');
const express = require('express');

const {
  ApiGatewayService,
  InMemoryApiKeyStore,
  hashApiKey,
} = require('../dist/services/api-gateway.service.js');
const { createPublicApiRouter } = require('../dist/routes/public-api.routes.js');

describe('Scoped API keys (#1420)', () => {
  let store;
  let gateway;
  let server;
  let baseUrl;
  const submittedResults = [];

  before(async () => {
    store = new InMemoryApiKeyStore();
    gateway = new ApiGatewayService(store);

    const tournaments = {
      async listTournaments() {
        return { tournaments: [{ id: 't1', name: 'Spring Cup' }], total: 1 };
      },
      async getTournament(id) {
        return id === 't1' ? { id: 't1', name: 'Spring Cup' } : null;
      },
      async handleMatchResult(tournamentId, matchId, result) {
        submittedResults.push({ tournamentId, matchId, result });
        return { ok: true };
      },
    };

    const app = express();
    app.use(express.json());
    app.use('/v1/public', createPublicApiRouter({ gateway, tournaments }));
    // eslint-disable-next-line no-unused-vars
    app.use((err, _req, res, _next) => {
      res.status(err.status ?? 500).json({ error: err.message });
    });

    await new Promise(resolve => {
      server = app.listen(0, resolve);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}/v1/public`;
  });

  after(() => new Promise(resolve => server.close(resolve)));

  const resultBody = { playerAScore: 3, playerBScore: 1, winnerId: 'player-a', resultType: 'WIN' };

  function get(path, key) {
    return fetch(`${baseUrl}${path}`, { headers: key ? { 'x-api-key': key } : {} });
  }

  function postResult(key) {
    return fetch(`${baseUrl}/tournaments/t1/matches/m1/results`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key },
      body: JSON.stringify(resultBody),
    });
  }

  it('read-only key can read tournaments but gets 403 writing results', async () => {
    const { rawKey } = await gateway.createKey({
      name: 'read-only partner',
      userId: 'admin-1',
      permissions: ['read:tournaments'],
      expiresInDays: 30,
    });

    const list = await get('/tournaments', rawKey);
    assert.strictEqual(list.status, 200);
    assert.strictEqual((await list.json()).tournaments[0].id, 't1');

    const one = await get('/tournaments/t1', rawKey);
    assert.strictEqual(one.status, 200);

    const before = submittedResults.length;
    const write = await postResult(rawKey);
    assert.strictEqual(write.status, 403);
    assert.match((await write.json()).error, /write:results/);
    assert.strictEqual(submittedResults.length, before, 'handler must not run');
  });

  it('key with write:results can submit results', async () => {
    const { rawKey } = await gateway.createKey({
      name: 'results bot',
      userId: 'admin-1',
      permissions: ['read:tournaments', 'write:results'],
      expiresInDays: 30,
    });

    const res = await postResult(rawKey);
    assert.strictEqual(res.status, 201);
    assert.deepStrictEqual(submittedResults.at(-1), {
      tournamentId: 't1',
      matchId: 'm1',
      result: { matchId: 'm1', ...resultBody },
    });
  });

  it('rejects missing and unknown keys with 401', async () => {
    assert.strictEqual((await get('/tournaments')).status, 401);
    assert.strictEqual((await get('/tournaments', 'ax_not-a-real-key')).status, 401);
  });

  it('stores only the hash of the key', async () => {
    const { id, rawKey } = await gateway.createKey({
      name: 'hash check',
      userId: 'admin-1',
      permissions: ['read:tournaments'],
      expiresInDays: 0,
    });
    const record = await store.findById(id);
    assert.notStrictEqual(record.key, rawKey);
    assert.strictEqual(record.key, hashApiKey(rawKey));
    assert.ok(!Object.values(record).includes(rawKey));
  });

  it('rejects unknown scopes', async () => {
    await assert.rejects(
      gateway.createKey({ name: 'bad', userId: 'admin-1', permissions: ['delete:everything'], expiresInDays: 1 }),
      err => err.status === 400,
    );
  });

  it('rotation keeps the old key valid during the overlap period', async () => {
    const { id, rawKey: oldKey } = await gateway.createKey({
      name: 'rotating',
      userId: 'admin-1',
      permissions: ['read:tournaments'],
      expiresInDays: 30,
    });

    const rotated = await gateway.rotateKey(id, 'admin-1', 3600);
    assert.ok(rotated.oldKeyValidUntil instanceof Date);
    assert.strictEqual(rotated.id === id, false);

    // Both keys work during the overlap; the new key inherits scopes.
    assert.strictEqual((await get('/tournaments', oldKey)).status, 200);
    assert.strictEqual((await get('/tournaments', rotated.rawKey)).status, 200);
    assert.strictEqual((await postResult(rotated.rawKey)).status, 403);

    // Once the overlap has elapsed only the new key is accepted.
    await store.update(id, { graceExpiresAt: new Date(Date.now() - 1000) });
    assert.strictEqual((await get('/tournaments', oldKey)).status, 401);
    assert.strictEqual((await get('/tournaments', rotated.rawKey)).status, 200);

    await assert.rejects(gateway.rotateKey(id, 'admin-1', 60), err => err.status === 409);
  });

  it('rotation with zero overlap revokes the old key immediately', async () => {
    const { id, rawKey: oldKey } = await gateway.createKey({
      name: 'hard rotate',
      userId: 'admin-1',
      permissions: ['read:tournaments'],
      expiresInDays: 30,
    });

    const rotated = await gateway.rotateKey(id, null, 0);
    assert.strictEqual(rotated.oldKeyValidUntil, null);
    assert.strictEqual((await get('/tournaments', oldKey)).status, 401);
    assert.strictEqual((await get('/tournaments', rotated.rawKey)).status, 200);
  });

  it('admin scope updates take effect on the next request', async () => {
    const { id, rawKey } = await gateway.createKey({
      name: 'upgrade me',
      userId: 'admin-1',
      permissions: ['read:tournaments'],
      expiresInDays: 30,
    });
    assert.strictEqual((await postResult(rawKey)).status, 403);

    await gateway.adminUpdatePermissions(id, ['read:tournaments', 'write:results']);
    assert.strictEqual((await postResult(rawKey)).status, 201);
  });
});
