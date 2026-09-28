# Session Timeout Feature

## Overview

The session timeout feature provides users with a warning before their session expires, allowing them to extend their session or save their work. This prevents users from being abruptly logged out while actively using the application.

## Features

### 1. Countdown Timer Before Logout

- **Warning Time**: 5 minutes before session expiry
- **Session Duration**: 2 hours
- **Check Interval**: Every second for accurate countdown
- **Visual Timer**: Displayed in both modal and inline alerts

### 2. Dismissible Modal

- Shows 5 minutes before session expiry
- Cannot be dismissed without taking action (extend or logout)
- Auto-extends session if user doesn't respond within grace period
- Focus management for accessibility
- Keyboard navigation support (Tab, Escape)

### 3. Activity Extends Session

- User activity (click, mousemove, keydown, scroll, touchstart) resets the timer
- Activity during warning period clears the warning
- Silent token refresh when extending session

### 4. Grace Period for Action

- **Grace Period**: 2 minutes after warning starts
- If user doesn't respond within grace period, session auto-extends
- Prevents users from being logged out while actively using the app

## API

### Context Provider

```tsx
import { SessionTimeoutProvider } from "@/contexts/SessionTimeoutContext";

<SessionTimeoutProvider>
  {children}
</SessionTimeoutProvider>
```

### Hooks

#### `useSessionTimeoutContext()`

Returns the session timeout context with:

- `state`: Current timeout state
  - `isWarning`: Boolean - whether warning is active
  - `timeRemaining`: Number - seconds until expiry
  - `isExpired`: Boolean - whether session has expired
- `showWarning`: Boolean - whether to show warning modal
- `timeRemaining`: Number - seconds until expiry
- `extendSession()`: Function - extends session by 2 hours
- `forceLogout()`: Function - logs out immediately
- `resetTimer()`: Function - resets the session timer
- `gracePeriodExpired`: Boolean - whether grace period has expired

#### `useSessionState()`

Returns current session timeout state.

#### `useSessionTimeRemaining()`

Returns time remaining until session expiry in seconds.

#### `useSessionWarning()`

Returns whether session warning is active.

#### `useSessionExtender()`

Returns function to extend the session.

#### `useGracePeriodExpired()`

Returns whether grace period has expired.

### Components

#### `SessionTimeoutModal`

Modal shown when session is about to expire.

```tsx
import { SessionTimeoutModal } from "@/components/ui/SessionTimeoutModal";

<SessionTimeoutModal
  isOpen={showWarning}
  timeRemaining={timeRemaining}
  onExtend={extendSession}
  onForceLogout={forceLogout}
  onClose={onClose}
/>
```

**Props:**
- `isOpen`: Boolean - whether modal is open
- `timeRemaining`: Number - seconds until expiry
- `onExtend`: Function - called when extending session
- `onForceLogout`: Function - called when logging out
- `onClose`: Function - called when closing modal

#### `SessionTimeoutAlert`

Inline alert shown in warning period.

```tsx
import { SessionTimeoutAlert } from "@/components/ui/SessionTimeoutModal";

<SessionTimeoutAlert
  timeRemaining={timeRemaining}
  onExtend={extendSession}
/>
```

**Props:**
- `timeRemaining`: Number - seconds until expiry
- `onExtend`: Function - called when extending session

#### `SessionGracePeriodAlert`

Alert shown during grace period (last 2 minutes).

```tsx
import { SessionGracePeriodAlert } from "@/components/ui/SessionTimeoutModal";

<SessionGracePeriodAlert
  timeRemaining={timeRemaining}
  onExtend={extendSession}
  onLogout={onLogout}
/>
```

**Props:**
- `timeRemaining`: Number - seconds until expiry
- `onExtend`: Function - called when extending session
- `onLogout`: Function - called when logging out

#### `SessionTimeoutIndicator`

Small indicator showing remaining time.

```tsx
import { SessionTimeoutIndicator } from "@/components/ui/SessionTimeoutModal";

<SessionTimeoutIndicator timeRemaining={timeRemaining} />
```

**Props:**
- `timeRemaining`: Number - seconds until expiry

## Usage Example

```tsx
"use client";

import { useEffect } from "react";
import { useSessionTimeoutContext } from "@/contexts/SessionTimeoutContext";
import { SessionTimeoutModal } from "@/components/ui/SessionTimeoutModal";

export default function Dashboard() {
  const {
    showWarning,
    timeRemaining,
    extendSession,
    forceLogout,
    gracePeriodExpired,
  } = useSessionTimeoutContext();
  
  return (
    <div>
      {/* Your dashboard content */}
      
      {/* Session timeout warning modal */}
      <SessionTimeoutModal
        isOpen={showWarning}
        timeRemaining={timeRemaining}
        onExtend={extendSession}
        onForceLogout={forceLogout}
        onClose={() => {}} // Can't close without action
      />
      
      {/* Grace period alert (shown automatically by modal) */}
      {gracePeriodExpired && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50">
          <p>Session about to expire! Extend now.</p>
        </div>
      )}
    </div>
  );
}
```

## Integration with Existing Code

The session timeout provider is already integrated into `AppLayout.tsx` so it's available throughout the app. Components can use the hooks to access session timeout state and take appropriate actions.

### Auto-Logout Protection

To prevent unsaved work from being lost:

1. Show warning 5 minutes before expiry
2. Allow user to extend session (saves draft automatically)
3. Grace period ensures active users don't get logged out
4. Auto-extend after grace period if no action taken

## Constants

```ts
export const SESSION_DURATION_SECONDS = 2 * 60 * 60;  // 2 hours
export const WARNING_TIME_SECONDS = 5 * 60;          // 5 minutes
export const GRACE_PERIOD_SECONDS = 2 * 60;          // 2 minutes
export const CHECK_INTERVAL_MS = 1000;               // 1 second
```

## Accessibility

- Focus trapping in modal
- Keyboard navigation (Tab, Escape)
- ARIA labels and roles
- Screen reader support for countdown timer
- Reduced motion support

## Security

- User activity is tracked client-side
- Session extension requires server validation
- Token refresh happens before actual expiry
- No sensitive data stored in localStorage

## Customization

To customize the session timeout behavior:

1. Change constants in `useSessionTimeout.ts` or `SessionTimeoutContext.tsx`
2. Adjust warning time: `WARNING_TIME_SECONDS`
3. Adjust session duration: `SESSION_DURATION_SECONDS`
4. Adjust grace period: `GRACE_PERIOD_SECONDS`
5. Adjust check interval: `CHECK_INTERVAL_MS`

## Testing

### Manual Testing

1. Log in to the application
2. Wait 1 hour and 55 minutes (or modify constants for faster testing)
3. Verify warning modal appears
4. Verify countdown timer counts down
5. Click "Extend Session" and verify session extends
6. Wait 2 minutes and verify auto-extend works

### Automated Testing

```ts
// Example test (using jest)
it("shows warning 5 minutes before expiry", () => {
  // Mock Date.now() to simulate time passing
  const mockDate = new Date();
  mockDate.setHours(mockDate.getHours() + 2);
  
  // Test implementation
});
```

## Future Enhancements

- [ ] Customize warning time per user
- [ ] Extend session indefinitely with user consent
- [ ] Save draft automatically before logout
- [ ] Notification system for active sessions
- [ ] Multi-device session management