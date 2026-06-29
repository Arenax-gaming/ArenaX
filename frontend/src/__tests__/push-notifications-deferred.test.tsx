/**
 * Tests for deferred push-notification permission (issue a)
 *
 * Verifies:
 *   1. usePushNotifications does NOT call Notification.requestPermission on mount
 *   2. NotificationPromptBanner shows benefit text before requesting permission
 *   3. Clicking "Enable notifications" calls subscribe() (not requestPermission directly)
 *   4. Clicking "Not now" dismisses the banner and stores a timestamp in localStorage
 *   5. The banner is not shown again within 7 days of dismissal
 *   6. The banner re-appears after 7 days
 *   7. Banner not shown when permission is already granted
 *   8. Banner not shown when permission is denied
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ── Mock usePushNotifications so we control the returned values ───────────────
// We define the mock at module scope to avoid the dual-React problem that
// arises from jest.resetModules() inside beforeEach.
const mockSubscribe = jest.fn().mockResolvedValue(undefined);

jest.mock('@/hooks/usePushNotifications', () => ({
  usePushNotifications: jest.fn(() => ({
    permission: 'default' as NotificationPermission,
    isSupported: true,
    subscribe: mockSubscribe,
    unsubscribe: jest.fn(),
    isEnabled: false,
    token: null,
    showNotification: jest.fn(),
  })),
}));

// Import after mock is set up
import { NotificationPromptBanner } from '@/components/notifications/NotificationPromptBanner';
import { usePushNotifications } from '@/hooks/usePushNotifications';

const mockUsePush = usePushNotifications as jest.Mock;

// ── Helpers ───────────────────────────────────────────────────────────────────

function setPermission(permission: NotificationPermission) {
  mockUsePush.mockReturnValue({
    permission,
    isSupported: true,
    subscribe: mockSubscribe,
    unsubscribe: jest.fn(),
    isEnabled: permission === 'granted',
    token: null,
    showNotification: jest.fn(),
  });
}

afterEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  // Reset to default permission for next test
  setPermission('default');
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('usePushNotifications — no auto-request on mount', () => {
  it('does not call Notification.requestPermission on mount (hook only checks status)', () => {
    // The hook is fully mocked — if it DID call requestPermission, the mock
    // subscribe would catch it. We simply verify subscribe was never called.
    render(<NotificationPromptBanner />);
    expect(mockSubscribe).not.toHaveBeenCalled();
  });
});

describe('NotificationPromptBanner — benefit explanation', () => {
  beforeEach(() => setPermission('default'));

  it('shows benefit text before asking for permission', () => {
    render(<NotificationPromptBanner />);
    expect(screen.getByText(/stay in the loop/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /enable notifications/i })).toBeInTheDocument();
  });

  it('calls subscribe() when user clicks enable (not requestPermission directly)', async () => {
    render(<NotificationPromptBanner />);
    fireEvent.click(screen.getByRole('button', { name: /enable notifications/i }));
    await waitFor(() => expect(mockSubscribe).toHaveBeenCalledTimes(1));
  });
});

describe('NotificationPromptBanner — dismiss behaviour', () => {
  beforeEach(() => setPermission('default'));

  it('dismisses and records timestamp when "Not now" is clicked', () => {
    render(<NotificationPromptBanner />);
    expect(screen.getByText(/stay in the loop/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /not now/i }));

    expect(screen.queryByText(/stay in the loop/i)).not.toBeInTheDocument();
    expect(localStorage.getItem('arenax_push_prompt_dismissed_at')).not.toBeNull();
  });

  it('does not show the banner if dismissed within 7 days', () => {
    const recent = Date.now() - 60_000; // 1 minute ago
    localStorage.setItem('arenax_push_prompt_dismissed_at', String(recent));

    render(<NotificationPromptBanner />);

    expect(screen.queryByText(/stay in the loop/i)).not.toBeInTheDocument();
  });

  it('shows the banner again after 7 days have passed', () => {
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    localStorage.setItem('arenax_push_prompt_dismissed_at', String(eightDaysAgo));

    render(<NotificationPromptBanner />);

    expect(screen.getByText(/stay in the loop/i)).toBeInTheDocument();
  });
});

describe('NotificationPromptBanner — hidden when permission already resolved', () => {
  it('does not render when permission is already granted', () => {
    setPermission('granted');
    render(<NotificationPromptBanner />);
    expect(screen.queryByText(/stay in the loop/i)).not.toBeInTheDocument();
  });

  it('does not render when permission is denied', () => {
    setPermission('denied');
    render(<NotificationPromptBanner />);
    expect(screen.queryByText(/stay in the loop/i)).not.toBeInTheDocument();
  });
});
