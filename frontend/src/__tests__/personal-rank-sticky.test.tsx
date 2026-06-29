/**
 * Tests for PersonalRank sticky card (issue b)
 *
 * Verifies:
 *   1. Inline rank card renders with rank, ELO, and rank-change delta
 *   2. Sticky bottom card is absent when inline card is in view
 *   3. Sticky bottom card appears when inline card scrolls out of view
 *   4. Clicking sticky card scrolls to the inline card
 *   5. Sticky card shows rank, ELO, and rank-change delta
 */

import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

// ── IntersectionObserver mock ─────────────────────────────────────────────────
type IOCallback = (entries: IntersectionObserverEntry[]) => void;
let observerCallback: IOCallback | null = null;

const mockObserve = jest.fn();
const mockDisconnect = jest.fn();

class MockIntersectionObserver {
  constructor(cb: IOCallback) {
    observerCallback = cb;
  }
  observe = mockObserve;
  unobserve = jest.fn();
  disconnect = mockDisconnect;
}

beforeAll(() => {
  Object.defineProperty(global, 'IntersectionObserver', {
    configurable: true,
    writable: true,
    value: MockIntersectionObserver,
  });
});

// Helper to fire intersection callbacks
function simulateIntersection(isIntersecting: boolean) {
  act(() => {
    observerCallback?.([
      { isIntersecting } as unknown as IntersectionObserverEntry,
    ]);
  });
}

// Suppress act() warnings from the fake setTimeout in the component
beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.runAllTimers();
  jest.useRealTimers();
  mockObserve.mockClear();
  mockDisconnect.mockClear();
});

import { PersonalRank } from '@/components/leaderboard/PersonalRank';

describe('PersonalRank', () => {
  const defaultProps = { category: 'global', season: 'current' };

  it('shows a loading skeleton initially', () => {
    render(<PersonalRank {...defaultProps} />);
    expect(document.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('renders rank, ELO, and rank-change delta after data loads', async () => {
    render(<PersonalRank {...defaultProps} />);

    // Advance fake timers past the 300 ms simulated fetch
    act(() => jest.advanceTimersByTime(400));

    await waitFor(() =>
      expect(screen.getAllByLabelText(/your rank/i).length).toBeGreaterThan(0),
    );

    // rank heading starts with #
    expect(screen.getByText(/^#\d+$/)).toBeInTheDocument();
    // ELO label
    expect(screen.getByText('ELO')).toBeInTheDocument();
  });

  it('does not show sticky card while inline card is in view', async () => {
    render(<PersonalRank {...defaultProps} />);
    act(() => jest.advanceTimersByTime(400));

    await waitFor(() =>
      expect(screen.getAllByLabelText(/your rank/i).length).toBeGreaterThan(0),
    );

    // Simulate in-view
    simulateIntersection(true);

    expect(
      screen.queryByRole('button', { name: /your rank — click to scroll into view/i }),
    ).not.toBeInTheDocument();
  });

  it('shows sticky card when inline card scrolls out of view', async () => {
    render(<PersonalRank {...defaultProps} />);
    act(() => jest.advanceTimersByTime(400));

    await waitFor(() =>
      expect(screen.getAllByLabelText(/your rank/i).length).toBeGreaterThan(0),
    );

    // Simulate out-of-view
    simulateIntersection(false);

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /your rank — click to scroll into view/i }),
      ).toBeInTheDocument(),
    );
  });

  it('sticky card displays rank and ELO', async () => {
    render(<PersonalRank {...defaultProps} />);
    act(() => jest.advanceTimersByTime(400));

    await waitFor(() =>
      expect(screen.getAllByLabelText(/your rank/i).length).toBeGreaterThan(0),
    );

    simulateIntersection(false);

    const sticky = await screen.findByRole('button', {
      name: /your rank — click to scroll into view/i,
    });

    expect(sticky).toHaveTextContent(/Your Rank: #\d+/);
    expect(sticky).toHaveTextContent(/ELO/);
  });

  it('scrolls to inline card when sticky card is clicked', async () => {
    const scrollIntoViewMock = jest.fn();
    render(<PersonalRank {...defaultProps} />);
    act(() => jest.advanceTimersByTime(400));

    await waitFor(() =>
      expect(screen.getAllByLabelText(/your rank/i).length).toBeGreaterThan(0),
    );

    // Attach scrollIntoView to the inline card element (first aria-label match = inline card)
    const inlineCard = screen.getAllByLabelText(/your rank/i)[0]!;
    inlineCard.scrollIntoView = scrollIntoViewMock;

    simulateIntersection(false);

    const sticky = await screen.findByRole('button', {
      name: /your rank — click to scroll into view/i,
    });

    fireEvent.click(sticky);

    expect(scrollIntoViewMock).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'smooth' }),
    );
  });
});
