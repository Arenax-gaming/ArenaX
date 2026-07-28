/**
 * MatchmakingQueue accessibility tests (issue #732)
 *
 * Covers:
 * - Cancel button has type="button" and the accessible name "Cancel Matchmaking"
 * - Decorative spinner/emoji block is aria-hidden
 * - Progress bar exposes progressbar semantics
 * - Queue status is announced via a polite live region
 */

import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';

import MatchmakingQueue from '@/components/game/MatchmakingQueue';

describe('MatchmakingQueue — accessibility', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  const renderQueue = (overrides: Partial<React.ComponentProps<typeof MatchmakingQueue>> = {}) =>
    render(
      <MatchmakingQueue
        gameMode="Ranked 1v1"
        onCancel={jest.fn()}
        onMatchFound={jest.fn()}
        {...overrides}
      />,
    );

  it('renders the cancel button with type="button"', () => {
    renderQueue();
    const btn = screen.getByRole('button', { name: 'Cancel Matchmaking' });
    expect(btn).toHaveAttribute('type', 'button');
  });

  it('announces the cancel button as "Cancel Matchmaking"', () => {
    renderQueue();
    expect(
      screen.getByRole('button', { name: 'Cancel Matchmaking' }),
    ).toBeInTheDocument();
  });

  it('calls onCancel when the cancel button is clicked', () => {
    const onCancel = jest.fn();
    renderQueue({ onCancel });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel Matchmaking' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('hides the decorative spinner and 🎮 emoji from assistive technology', () => {
    const { container } = renderQueue();
    const emoji = screen.getByText('🎮');
    expect(emoji.closest('[aria-hidden="true"]')).not.toBeNull();
    const spinner = container.querySelector('.animate-spin');
    expect(spinner?.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('exposes the progress bar with progressbar semantics', () => {
    renderQueue();
    const bar = screen.getByRole('progressbar', { name: 'Matchmaking progress' });
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(bar).toHaveAttribute('aria-valuenow', '0');
  });

  it('updates aria-valuenow as wait time progresses', () => {
    renderQueue();
    act(() => jest.advanceTimersByTime(3000));
    const bar = screen.getByRole('progressbar', { name: 'Matchmaking progress' });
    expect(bar).toHaveAttribute('aria-valuenow', '10');
  });

  it('announces the searching status in a polite live region', () => {
    renderQueue();
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveClass('sr-only');
    expect(status).toHaveTextContent('Searching for opponents in Ranked 1v1 mode');
  });

  it('announces "Match found" once a match is found', () => {
    const onMatchFound = jest.fn();
    renderQueue({ onMatchFound });
    act(() => jest.advanceTimersByTime(30000));
    expect(onMatchFound).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('Match found');
  });

  it('does not include the ticking wait timer inside the live region', () => {
    renderQueue();
    act(() => jest.advanceTimersByTime(5000));
    const status = screen.getByRole('status');
    expect(status).not.toHaveTextContent('0:05');
  });
});
