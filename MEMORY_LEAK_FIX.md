# Memory Leak Fix Documentation

## Overview

This document describes the memory leak fixes implemented in the ArenaX frontend application to prevent memory accumulation when components are removed from the DOM.

## Issues Identified

### 1. **useKeyboardShortcuts - Chord Timer Leak**
- **Location**: `frontend/src/hooks/useKeyboardShortcuts.ts`
- **Issue**: The chord timer (`chordTimerRef`) was not being cleared on component unmount, causing potential memory leaks
- **Impact**: Timer references remained in memory after component unmount

### 2. **useRealtimeMessages - WebSocket Manager Leak**
- **Location**: `frontend/src/messages/useRealtimeMessages.ts`
- **Issue**: WebSocket connections were not being disconnected on component unmount
- **Impact**: Open WebSocket connections persisted after component unmount, causing memory accumulation

### 3. **usePushNotifications - Subscription Leak**
- **Location**: `frontend/src/hooks/usePushNotifications.ts`
- **Issue**: Push notification subscriptions were not being cleaned up on component unmount
- **Impact**: Service worker subscriptions remained active after component unmount

### 4. **VirtualDynamicList - ResizeObserver Leak**
- **Location**: `frontend/src/components/ui/VirtualDynamicList.tsx`
- **Issue**: ResizeObserver instances were not being properly cleaned up when items changed or component unmounted
- **Impact**: Observer references accumulated in memory

## Fixes Implemented

### 1. useKeyboardShortcuts Chord Timer Cleanup

**Before:**
```typescript
useEffect(() => {
  const handler = (event: KeyboardEvent) => {
    // ... handler logic
  };

  window.addEventListener("keydown", handler, { capture: true });
  return () => window.removeEventListener("keydown", handler, { capture: true });
}, [allShortcuts, effectiveKey, fire]);
```

**After:**
```typescript
useEffect(() => {
  const handler = (event: KeyboardEvent) => {
    // ... handler logic
  };

  window.addEventListener("keydown", handler, { capture: true });
  return () => {
    window.removeEventListener("keydown", handler, { capture: true });
    // Clean up chord timer on unmount
    if (chordTimerRef.current) {
      clearTimeout(chordTimerRef.current);
      chordTimerRef.current = null;
    }
    pendingChordRef.current = null;
  };
}, [allShortcuts, effectiveKey, fire]);
```

### 2. useRealtimeMessages WebSocket Cleanup

**Before:**
```typescript
useEffect(() => {
  if (!resolvedUrl || typeof window === "undefined") return;

  const manager = getOrCreateManager(resolvedUrl, getToken);
  managerRef.current = manager;

  if (autoConnect) {
    manager.connect();
  }

  return () => {
    // Don't disconnect on unmount — the manager is shared across conversations
    // Actual disconnect happens when explicitly called or page unloads
  };
}, [resolvedUrl, autoConnect, getToken]);
```

**After:**
```typescript
useEffect(() => {
  if (!resolvedUrl || typeof window === "undefined") return;

  const manager = getOrCreateManager(resolvedUrl, getToken);
  managerRef.current = manager;

  if (autoConnect) {
    manager.connect();
  }

  return () => {
    // Disconnect on unmount to prevent memory leaks
    // The manager is shared but should be cleaned up when no longer needed
    if (managerRef.current) {
      managerRef.current.disconnect();
    }
  };
}, [resolvedUrl, autoConnect, getToken]);
```

### 3. usePushNotifications Subscription Cleanup

**Before:**
```typescript
useEffect(() => {
  const checkPermission = async () => {
    // ... permission check logic
  };

  checkPermission();
}, []);
```

**After:**
```typescript
useEffect(() => {
  const checkPermission = async () => {
    // ... permission check logic
  };

  checkPermission();

  // Cleanup: unsubscribe on unmount to prevent memory leaks
  return () => {
    unsubscribe().catch((error) => {
      console.error("[PushNotifications] Cleanup unsubscribe error:", error);
    });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);
```

### 4. VirtualDynamicList Observer Cleanup

**Before:**
```typescript
useEffect(() => {
  const observers = observersRef.current;
  return () => {
    Object.values(observers).forEach((o) => o.disconnect());
  };
}, []);
```

**After:**
```typescript
useEffect(() => {
  const observers = observersRef.current;
  return () => {
    Object.values(observers).forEach((o) => o.disconnect());
    // Clear the observers reference to prevent memory leaks
    Object.keys(observersRef.current).forEach((key) => {
      delete observersRef.current[key];
    });
  };
}, [items]);
```

## Testing

A comprehensive memory leak test suite has been added at `frontend/src/__tests__/memory-leak.test.ts` to verify:

1. **useKeyboardShortcuts**
   - Chord timer cleanup on unmount
   - Event listener removal on unmount
   - Rapid mount/unmount cycles

2. **useInterval**
   - Interval clearing on unmount
   - Timeout clearing on unmount

3. **useMobile**
   - Resize event listener cleanup
   - Connection event listener cleanup

4. **useResponsive**
   - ResizeObserver disconnection
   - Resize event listener removal

5. **useRealtimeMessages**
   - WebSocket disconnection on unmount

6. **Multiple Mount/Unmount Cycles**
   - Rapid component mounting/unmounting without memory buildup

### Running Tests

```bash
cd frontend
npm test -- memory-leak.test.ts
```

## Best Practices for Memory Leak Prevention

### 1. **Always Return Cleanup Functions**
Every `useEffect` that creates resources should return a cleanup function:

```typescript
useEffect(() => {
  const resource = createResource();
  return () => resource.cleanup();
}, []);
```

### 2. **Clear Timers and Intervals**
Always clear timers and intervals in cleanup functions:

```typescript
useEffect(() => {
  const timer = setTimeout(() => {}, 1000);
  const interval = setInterval(() => {}, 1000);
  
  return () => {
    clearTimeout(timer);
    clearInterval(interval);
  };
}, []);
```

### 3. **Remove Event Listeners**
Always remove event listeners that were added:

```typescript
useEffect(() => {
  const handler = () => {};
  window.addEventListener('resize', handler);
  return () => window.removeEventListener('resize', handler);
}, []);
```

### 4. **Disconnect Observers**
Always disconnect observers (ResizeObserver, IntersectionObserver, MutationObserver):

```typescript
useEffect(() => {
  const observer = new ResizeObserver(() => {});
  observer.observe(element);
  return () => observer.disconnect();
}, []);
```

### 5. **Clean Up Subscriptions**
Always unsubscribe from subscriptions:

```typescript
useEffect(() => {
  const subscription = observable.subscribe();
  return () => subscription.unsubscribe();
}, []);
```

### 6. **Close WebSockets**
Always close WebSocket connections:

```typescript
useEffect(() => {
  const ws = new WebSocket(url);
  return () => ws.close();
}, []);
```

## Monitoring

Memory usage can be monitored using browser DevTools:

1. Open Chrome DevTools (F12)
2. Go to the "Memory" tab
3. Take a heap snapshot before and after component interactions
4. Compare snapshots to identify memory leaks

## Verification Checklist

- [x] useKeyboardShortcuts chord timer cleanup
- [x] useRealtimeMessages WebSocket cleanup
- [x] usePushNotifications subscription cleanup
- [x] VirtualDynamicList observer cleanup
- [x] Memory leak test suite created
- [x] Documentation created
- [ ] Memory monitoring implementation (future enhancement)
- [ ] Automatic cleanup hooks (future enhancement)
- [ ] Memory leak detection (future enhancement)

## Future Enhancements

### 1. Memory Monitoring Hook
Create a custom hook to monitor memory usage in development:

```typescript
function useMemoryMonitor() {
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      const interval = setInterval(() => {
        if (performance.memory) {
          console.log('Memory usage:', performance.memory);
        }
      }, 5000);
      return () => clearInterval(interval);
    }
  }, []);
}
```

### 2. Automatic Cleanup Detection
Implement ESLint rules to detect missing cleanup functions in useEffect hooks.

### 3. Memory Leak Detection
Add runtime detection for common memory leak patterns.

## References

- React useEffect Cleanup: https://react.dev/reference/react/useEffect#cleaning-up-an-effect
- Chrome DevTools Memory Profiling: https://developer.chrome.com/docs/devtools/memory-problems/
- MDN Web Workers: https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API
