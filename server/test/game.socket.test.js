const { afterEach, test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { Server } = require('socket.io');
const { io: createClient } = require('socket.io-client');

const { initGameSocket } = require('../dist/websockets/game.socket');
const {
  GameSessionService,
  clearSessionStore,
} = require('../dist/services/game-session.service');

const servers = [];
const clients = [];

afterEach(async () => {
  for (const client of clients.splice(0)) {
    if (client.connected) {
      client.disconnect();
    }
  }

  await Promise.all(
    servers.splice(0).map(
      ({ ioServer, httpServer }) =>
        new Promise((resolve) => {
          ioServer.close(() => {
            httpServer.close(() => resolve());
          });
        }),
    ),
  );

  clearSessionStore();
});

function waitFor(predicate, timeoutMs = 1000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const check = () => {
      if (predicate()) {
        resolve();
        return;
      }

      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error('Timed out waiting for condition'));
        return;
      }

      setTimeout(check, 10);
    };

    check();
  });
}

test('disconnect removes joined session resources even when players are app ids', async () => {
  const httpServer = http.createServer();
  const ioServer = new Server(httpServer);
  initGameSocket(ioServer);
  servers.push({ ioServer, httpServer });

  httpServer.listen(0, '127.0.0.1');
  await once(httpServer, 'listening');

  const address = httpServer.address();
  const url = `http://127.0.0.1:${address.port}/game`;

  const gameSessionService = new GameSessionService();
  const session = gameSessionService.createSession(['player-1'], 'ranked');

  const client = createClient(url, {
    transports: ['websocket'],
    forceNew: true,
  });
  clients.push(client);

  await once(client, 'connect');
  client.emit('join', session.id);
  await once(client, 'joined');

  assert.equal(gameSessionService.getActiveSessionCount(), 1);

  client.disconnect();

  await waitFor(() => gameSessionService.getSession(session.id) === undefined);
  assert.equal(gameSessionService.getActiveSessionCount(), 0);
});
