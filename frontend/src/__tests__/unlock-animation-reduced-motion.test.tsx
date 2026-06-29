/**
 * Tests for UnlockAnimation reduced-motion support (issue d)
 *
 * Verifies:
 *   1. Achievement title and rarity are always rendered
 *   2. With full motion: scale/translate CSS classes are applied
 *   3. With reduced motion: only opacity transition class is applied (no scale/translate)
 *   4. Sparkle elements are suppressed when reduced motion is active
 *   5. Dismiss button calls onClose
 */

import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { UnlockAnimation } from '@/components/achievements/UnlockAnimation';
import type { AchievementFull } from '@/data/achievements';

// ── framer-motion mock (useReducedMotion is from framer-motion) ──────────────
let mockReducedMotion = false;

jest.mock('framer-motion', () => ({
  useReducedMotion: () => mockReducedMotion,
}));

// ── Sample achievement fixtures ───────────────────────────────────────────────
const legendaryAchievement: AchievementFull = {
  id: 'a1',
  title: 'Legend',
  description: 'Reach 2000 ELO',
  icon: '👑',
  progress: 2000,
  total: 2000,
  unlocked: true,
  rarity: 'legendary',
  category: 'progression',
  points: 250,
  requirements: [],
};

const commonAchievement: AchievementFull = {
  id: 'a2',
  title: 'First Blood',
  description: 'Win your first match',
  icon: '⚔️',
  progress: 1,
  total: 1,
  unlocked: true,
  rarity: 'common',
  category: 'combat',
  points: 10,
  requirements: [],
};

beforeEach(() => {
  jest.useFakeTimers();
  mockReducedMotion = false;
});

afterEach(() => {
  jest.runAllTimers();
  jest.useRealTimers();
});

describe('UnlockAnimation — always shows title and rarity', () => {
  it('renders achievement title in full-motion mode', async () => {
    mockReducedMotion = false;
    render(<UnlockAnimation achievement={legendaryAchievement} onClose={() => {}} />);
    act(() => jest.advanceTimersByTime(100));
    expect(screen.getByText('Legend')).toBeInTheDocument();
  });

  it('renders achievement title in reduced-motion mode', async () => {
    mockReducedMotion = true;
    render(<UnlockAnimation achievement={legendaryAchievement} onClose={() => {}} />);
    act(() => jest.advanceTimersByTime(100));
    expect(screen.getByText('Legend')).toBeInTheDocument();
  });

  it('renders rarity indicator in full-motion mode', async () => {
    mockReducedMotion = false;
    render(<UnlockAnimation achievement={legendaryAchievement} onClose={() => {}} />);
    act(() => jest.advanceTimersByTime(100));
    expect(screen.getByText(/legendary/i)).toBeInTheDocument();
  });

  it('renders rarity indicator in reduced-motion mode', async () => {
    mockReducedMotion = true;
    render(<UnlockAnimation achievement={legendaryAchievement} onClose={() => {}} />);
    act(() => jest.advanceTimersByTime(100));
    expect(screen.getByText(/legendary/i)).toBeInTheDocument();
  });
});

describe('UnlockAnimation — motion classes', () => {
  it('applies scale/translate transition in full-motion mode', async () => {
    mockReducedMotion = false;
    const { container } = render(
      <UnlockAnimation achievement={legendaryAchievement} onClose={() => {}} />,
    );
    act(() => jest.advanceTimersByTime(100));
    // The card element should have the full-motion transition class
    const card = container.querySelector('[role="status"]');
    expect(card?.className).toMatch(/scale-100/);
  });

  it('applies only opacity transition in reduced-motion mode (no scale)', async () => {
    mockReducedMotion = true;
    const { container } = render(
      <UnlockAnimation achievement={legendaryAchievement} onClose={() => {}} />,
    );
    act(() => jest.advanceTimersByTime(100));
    const card = container.querySelector('[role="status"]');
    // Should not have scale or translate classes
    expect(card?.className).not.toMatch(/scale-/);
    expect(card?.className).not.toMatch(/translate-y/);
    // Should be visible (opacity-100)
    expect(card?.className).toMatch(/opacity-100/);
  });
});

describe('UnlockAnimation — sparkles', () => {
  it('renders sparkle elements for legendary achievement in full-motion mode', async () => {
    mockReducedMotion = false;
    const { container } = render(
      <UnlockAnimation achievement={legendaryAchievement} onClose={() => {}} />,
    );
    act(() => jest.advanceTimersByTime(100));
    const sparkles = container.querySelectorAll('.animate-ping');
    expect(sparkles.length).toBeGreaterThan(0);
  });

  it('suppresses sparkle elements when reduced motion is active', async () => {
    mockReducedMotion = true;
    const { container } = render(
      <UnlockAnimation achievement={legendaryAchievement} onClose={() => {}} />,
    );
    act(() => jest.advanceTimersByTime(100));
    const sparkles = container.querySelectorAll('.animate-ping');
    expect(sparkles.length).toBe(0);
  });

  it('does not render sparkles for common achievements', async () => {
    mockReducedMotion = false;
    const { container } = render(
      <UnlockAnimation achievement={commonAchievement} onClose={() => {}} />,
    );
    act(() => jest.advanceTimersByTime(100));
    const sparkles = container.querySelectorAll('.animate-ping');
    expect(sparkles.length).toBe(0);
  });
});

describe('UnlockAnimation — dismiss', () => {
  it('calls onClose when dismiss button is clicked', async () => {
    const onClose = jest.fn();
    mockReducedMotion = true; // skip animation delay
    render(<UnlockAnimation achievement={commonAchievement} onClose={onClose} />);
    act(() => jest.advanceTimersByTime(100));

    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('auto-dismisses after 4 seconds', async () => {
    const onClose = jest.fn();
    mockReducedMotion = true;
    render(<UnlockAnimation achievement={commonAchievement} onClose={onClose} />);

    // entrance timer
    act(() => jest.advanceTimersByTime(100));
    // auto-dismiss timer
    act(() => jest.advanceTimersByTime(4000));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});
