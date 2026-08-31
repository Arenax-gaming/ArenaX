# Session Timeout Feature

This document describes the session timeout implementation for ArenaX.

## Overview

The session timeout feature provides a comprehensive solution for managing user sessions, preventing abrupt logouts, and allowing users to extend their sessions when needed.

## Files

### Core Files

1. **`useSessionTimeout.ts`** - Hook for session timeout management
2. **`SessionTimeoutContext.tsx`** - React context for session state
3. **`SessionTimeoutModal.tsx`** - Modal component for session warnings

### Supporting Files

4. **`index.ts`** - Exports for hooks and components
5. **`SESSION_TIMEOUT_FEATURE.md`** - Detailed feature documentation
6. **`session-timeout-demo/page.tsx`** - Demo page showing usage

## Implementation Details

### Session Configuration

| Setting | Value | Description |
|---------|-------|-------------|
| Session Duration | 2 hours | Time before session expires |
| Warning Time | 5 minutes | Time before expiry to show warning |
| Grace Period | 2 minutes | Time to act before auto-extend |
| Check Interval | 1 second | How often to check session status |

### User Activity Tracking

The system tracks the following user activities:
- Mouse clicks
- Mouse movement
- Keyboard presses
- Scroll events
- Touch events
- Mouse down events

When any activity is detected, the session timer is reset.

## Usage

### Provider Setup

The session timeout provider is already set up in `AppLayout.tsx`, making it available throughout the app.

```tsx
<SessionTimeoutProvider>
  {children}
</SessionTimeoutProvider>
```

### Basic Usage

```tsx
import { useSessionTimeoutContext } from "@/contexts/SessionTimeoutContext";

function MyComponent() {
  const { state, showWarning, extendSession, forceLogout } = useSessionTimeoutContext();
  
  return (
    <div>
      <p>Time remaining: {state.timeRemaining} seconds</p>
      <button onClick={extendSession}>Extend Session</button>
    </div>
  );
}
```

### With Modal

```tsx
import { SessionTimeoutModal } from "@/components/ui/SessionTimeoutModal";
import { useSessionTimeoutContext } from "@/contexts/SessionTimeoutContext";

function MyComponent() {
  const { showWarning, extendSession, forceLogout } = useSessionTimeoutContext();
  
  return (
    <>
      {/* Your component content */}
      
      <SessionTimeoutModal
        isOpen={showWarning}
        timeRemaining={state.timeRemaining}
        onExtend={extendSession}
        onForceLogout={forceLogout}
        onClose={() => {}}
      />
    </>
  );
}
```

## API Reference

### Context Values

| Property | Type | Description |
|----------|------|-------------|
| `state` | `SessionTimeoutState` | Current session state |
| `showWarning` | `boolean` | Whether to show warning modal |
| `timeRemaining` | `number` | Seconds until session expires |
| `extendSession()` | `() => Promise<void>` | Extend session by 2 hours |
| `forceLogout()` | `() => void` | Force logout immediately |
| `resetTimer()` | `() => void` | Reset session timer |
| `gracePeriodExpired` | `boolean` | Whether grace period expired |

### State Properties

| Property | Type | Description |
|----------|------|-------------|
| `isWarning` | `boolean` | Warning is active |
| `timeRemaining` | `number` | Seconds until expiry |
| `isExpired` | `boolean` | Session has expired |

## Modal Components

### SessionTimeoutModal

```tsx
<SessionTimeoutModal
  isOpen={showWarning}
  timeRemaining={timeRemaining}
  onExtend={extendSession}
  onForceLogout={forceLogout}
  onClose={onClose}
/>
```

Props:
- `isOpen`: Boolean - Modal visibility
- `timeRemaining`: Number - Seconds until expiry
- `onExtend`: Function - Called when extending session
- `onForceLogout`: Function - Called when logging out
- `onClose`: Function - Called when closing modal

### SessionTimeoutAlert

Inline alert for warning period:

```tsx
<SessionTimeoutAlert
  timeRemaining={timeRemaining}
  onExtend={extendSession}
/>
```

### SessionGracePeriodAlert

Alert shown during grace period:

```tsx
<SessionGracePeriodAlert
  timeRemaining={timeRemaining}
  onExtend={extendSession}
  onLogout={onLogout}
/>
```

### SessionTimeoutIndicator

Small indicator for any location:

```tsx
<SessionTimeoutIndicator timeRemaining={timeRemaining} />
```

## Testing

### Manual Testing

1. Navigate to `/session-timeout-demo`
2. Monitor the session timer
3. Wait for warning (5 minutes before expiry)
4. Click "Extend Session" to extend
5. Verify activity resets timer

### Automated Testing

```tsx
// Example test
import { render, screen, act } from "@testing-library/react";
import { SessionTimeoutProvider } from "@/contexts/SessionTimeoutContext";
import { useSessionTimeRemaining } from "@/contexts/SessionTimeoutContext";

test("shows warning 5 minutes before expiry", () => {
  render(
    <SessionTimeoutProvider>
      <TestComponent />
    </SessionTimeoutProvider>
  );
  
  // Test implementation
});

function TestComponent() {
  const timeRemaining = useSessionTimeRemaining();
  return <div data-testid="timer">{timeRemaining}</div>;
}
```

## Accessibility

- Focus trapping in modal
- Keyboard navigation (Tab, Escape)
- ARIA labels and roles
- Screen reader support
- Reduced motion support

## Security

- User activity tracked client-side
- Session extension requires server validation
- Token refresh before actual expiry
- No sensitive data in localStorage

## Customization

To customize session timeout behavior, modify the constants in `SessionTimeoutContext.tsx`:

```tsx
export const SESSION_DURATION_SECONDS = 2 * 60 * 60;  // Change to desired duration
export const WARNING_TIME_SECONDS = 5 * 60;          // Change warning time
export const GRACE_PERIOD_SECONDS = 2 * 60;          // Change grace period
```

## Troubleshooting

### Session Not Extending

- Ensure `refreshAccessToken()` is working
- Check network connectivity
- Verify token is not expired

### Warning Not Showing

- Verify user is logged in
- Check time remaining calculation
- Ensure context provider is in tree

### Timer Not Updating

- Check interval is running
- Verify `Date.now()` is accessible
- Ensure component is mounted

## Future Enhancements

- [ ] Customize warning time per user
- [ ] Extend session indefinitely with consent
- [ ] Auto-save before logout
- [ ] Multi-device session management
- [ ] Session activity reporting
- [ ] Configurable timeout policies