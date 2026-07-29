# WebSocket Memory Leak Fix

## Issue Description

WebSocket connection handlers in the ArenaX application had memory leaks that caused gradual memory increase over time with multiple concurrent connections. The leaks were identified in two main areas:

1. **game.socket.ts** - Game session WebSocket handler
2. **websocketPool.service.ts** - General WebSocket connection pool service

## Root Causes

### game.socket.ts

1. **Orphaned action queues**: The `actionQueues` and `actionTimers` module-level maps were never cleaned up when game sessions ended
2. **Uncleared timers**: Timer references in `actionTimers` persisted indefinitely after sessions were deleted
3. **Missing event listener cleanup**: Socket event listeners were not removed on disconnect, causing listener accumulation

### websocketPool.service.ts

1. **Event handler accumulation**: Connection event handlers were stored but never removed during service destruction
2. **Missing socket cleanup**: Active sockets were not properly disconnected and cleaned up on service destroy
3. **No connection limits**: No limits on total connections or per-user connections, allowing unbounded growth
4. **Stale data accumulation**: Offline message queues could accumulate stale messages without periodic cleanup
5. **No memory monitoring**: No mechanism to detect or alert on high memory usage

## Fixes Implemented

### game.socket.ts

#### 1. Action Queue and Timer Cleanup
```typescript
// Clean up action queue and timer for this session
actionQueues.delete(sessionId);
const timer = actionTimers.get(sessionId);
if (timer) {
  clearTimeout(timer);
  actionTimers.delete(sessionId);
}
```

**Location**: `cleanupSocketFromSession()` function when session has no remaining sockets

**Impact**: Prevents orphaned queues and timers from accumulating in memory

#### 2. Event Listener Removal
```typescript
socket.on('disconnect', async () => {
  // ... existing cleanup logic ...
  
  // Remove all event listeners for this socket to prevent memory leaks
  socket.removeAllListeners();
});
```

**Location**: Disconnect handler in `initGameSocket()`

**Impact**: Ensures all event listeners are removed when a socket disconnects

### websocketPool.service.ts

#### 1. Event Handler Storage and Cleanup
```typescript
// Store event handlers for proper cleanup
private _connectionHandler: ((socket: Socket) => void) | null = null;
```

**Cleanup in destroy()**:
```typescript
if (this._io && this._connectionHandler) {
  this._io.off('connection', this._connectionHandler);
  this._connectionHandler = null;
}
```

**Impact**: Properly removes connection event handlers when service is destroyed

#### 2. Socket Cleanup on Destroy
```typescript
// Disconnect all active sockets
if (this._io) {
  this._io.sockets.sockets.forEach((socket: Socket) => {
    socket.disconnect(true);
    socket.removeAllListeners();
  });
}
```

**Impact**: Ensures all active sockets are properly disconnected and cleaned up

#### 3. Connection Limits
```typescript
// Maximum number of concurrent connections per user
const MAX_CONNECTIONS_PER_USER = 10;
// Maximum total connections across all users
const MAX_TOTAL_CONNECTIONS = 1000;
```

**Enforcement in init()**:
- Checks total connection limit before accepting new connections
- Checks per-user connection limit during authentication
- Rejects connections with appropriate error messages when limits are exceeded

**Impact**: Prevents unbounded connection growth and resource exhaustion

#### 4. Automatic Cleanup
```typescript
// Automatic cleanup interval for stale data
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
```

**Implementation**:
- Periodic cleanup of stale queued messages in offline queue
- Removes messages older than `MESSAGE_TTL_MS` (5 minutes)
- Logs cleanup activity for monitoring

**Impact**: Prevents stale data accumulation in offline message queues

#### 5. Memory Monitoring
```typescript
// Memory usage alert threshold (MB)
const MEMORY_ALERT_THRESHOLD_MB = 500;
```

**Implementation**:
- Checks memory usage during heartbeat interval
- Logs error alerts when heap usage exceeds threshold
- Includes connection and queue statistics in alerts

**Impact**: Provides early warning of memory issues for operational monitoring

#### 6. Event Listener Removal on Disconnect
```typescript
socket.on('disconnect', () => {
  this._deregisterConnection(socket);
  // Remove all event listeners for this socket to prevent memory leaks
  socket.removeAllListeners();
});
```

**Impact**: Ensures individual socket event listeners are cleaned up on disconnect

## Configuration Constants

The following constants can be adjusted based on operational requirements:

| Constant | Default Value | Purpose |
|----------|---------------|---------|
| `MAX_CONNECTIONS_PER_USER` | 10 | Maximum concurrent connections per user |
| `MAX_TOTAL_CONNECTIONS` | 1000 | Maximum total connections across all users |
| `MEMORY_ALERT_THRESHOLD_MB` | 500 | Memory usage threshold for alerts (MB) |
| `CLEANUP_INTERVAL_MS` | 300000 (5 min) | Interval for automatic stale data cleanup |
| `MESSAGE_TTL_MS` | 300000 (5 min) | Time to keep messages in offline queue |

## Testing

### Test Suite Location
`server/test/websocket-memory-leak.test.ts`

### Test Coverage

1. **Connection Cleanup Tests**
   - Verifies connections are cleaned up on disconnect
   - Confirms event handlers are removed on destroy
   - Validates offline queue cleanup

2. **Connection Limit Tests**
   - Tests total connection limit enforcement
   - Verifies per-user connection limit enforcement

3. **Game Socket Tests**
   - Validates action queue cleanup on session end
   - Tests multiple session cleanup on disconnect

4. **Memory Stability Tests**
   - Tests memory stability over many connections
   - Verifies rapid connection handling

5. **Timer Cleanup Tests**
   - Confirms timers are cleaned up on destroy

### Running Tests

```bash
cd server
npx ts-node --transpile-only test/websocket-memory-leak.test.ts
```

## Monitoring and Alerts

### Memory Alerts

The service now logs error-level alerts when memory usage exceeds the configured threshold:

```javascript
logger.error('Memory usage alert', { 
  heapUsedMB: heapUsedMB.toFixed(2),
  threshold: MEMORY_ALERT_THRESHOLD_MB,
  connections: this._connections.size,
  offlineQueueSize: Array.from(this._offlineQueue.values()).reduce((sum, q) => sum + q.length, 0)
});
```

### Statistics

The `getStats()` method provides real-time statistics:

```typescript
{
  totalConnections: number,
  uniqueUsers: number,
  offlineQueueSize: number
}
```

### Cleanup Logging

Automatic cleanup operations are logged:

```javascript
logger.info('Automatic cleanup completed', { 
  offlineQueueSize: this._offlineQueue.size,
  connectionsSize: this._connections.size 
});
```

## Verification Steps

1. **Deploy the changes** to your environment
2. **Monitor memory usage** over time using the new alerts
3. **Run the test suite** to verify fixes work correctly
4. **Load test** with multiple concurrent connections to verify stability
5. **Check logs** for memory alerts and cleanup activity

## Expected Results

- Memory usage remains stable over time
- No gradual memory increase with concurrent connections
- Connections are properly cleaned up on disconnect
- Event listeners are removed when sockets disconnect
- Action queues and timers are cleaned up when sessions end
- Connection limits prevent unbounded growth
- Stale data is periodically removed from offline queues
- Memory alerts provide early warning of issues

## Rollback Plan

If issues arise after deployment:

1. Revert the changes to `game.socket.ts` and `websocketPool.service.ts`
2. Restart the WebSocket services
3. Monitor memory usage to confirm it returns to previous behavior

## Related Files

- `server/src/websockets/game.socket.ts` - Game session WebSocket handler
- `server/src/services/websocketPool.service.ts` - WebSocket connection pool service
- `server/test/websocket-memory-leak.test.ts` - Memory leak test suite

## Additional Notes

- The lint errors regarding missing type definitions (socket.io, @types/node) should be resolved by ensuring proper dependencies are installed in the project
- The memory monitoring uses Node.js `process.memoryUsage()` which is available in Node.js environments
- Connection limits can be adjusted based on server capacity and requirements
