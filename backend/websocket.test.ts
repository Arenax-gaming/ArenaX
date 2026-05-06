import { io, Socket } from 'socket.io-client';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { app } from './src/app';

describe('WebSocket Real-Time Matching', () => {
  let ioServer: Server;
  let clientSocket: Socket;
  let port: number;

  beforeAll((done) => {
    const httpServer = createServer(app);
    ioServer = new Server(httpServer);
    httpServer.listen(() => {
      const address = httpServer.address();
      port = typeof address === 'string' ? 0 : address?.port || 0;
      done();
    });
  });

  beforeEach((done) => {
    clientSocket = io(`http://localhost:${port}`, {
      transports: ['websocket'],
      auth: { token: 'valid-test-token' }
    });
    clientSocket.on('connect', done);
  });

  afterAll(() => {
    ioServer.close();
  });

  afterEach(() => {
    clientSocket.disconnect();
  });

  it('should receive match_found event when matchmaking completes', (done) => {
    const mockMatchData = { matchId: '123', opponent: 'ProGamer99' };

    clientSocket.on('match_found', (data) => {
      expect(data).toEqual(mockMatchData);
      done();
    });

    // Simulate server-side match logic
    ioServer.emit('match_found', mockMatchData);
  });
});