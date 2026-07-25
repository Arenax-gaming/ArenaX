/**
 * Tests for issue #734 — the /play page and MatchmakingQueue must use
 * design-token classes instead of hardcoded dark-theme colours
 * (gray-900 gradient, text-white) so both light and dark themes render
 * correctly.
 */

import React from 'react';
import { render } from '@testing-library/react';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({
    settings: { game: { controls: {} } },
  }),
}));

jest.mock('@/components/game/GameModeSelector', () => {
  const MockGameModeSelector = () => <div data-testid="game-mode-selector" />;
  MockGameModeSelector.displayName = 'MockGameModeSelector';
  return MockGameModeSelector;
});

jest.mock('@/components/game/SkillQuickAccessBar', () => {
  const MockSkillQuickAccessBar = () => <div data-testid="skill-bar" />;
  MockSkillQuickAccessBar.displayName = 'MockSkillQuickAccessBar';
  return MockSkillQuickAccessBar;
});

jest.mock('@/components/game/MobileGameControls', () => {
  const MockMobileGameControls = () => <div data-testid="mobile-controls" />;
  MockMobileGameControls.displayName = 'MockMobileGameControls';
  return MockMobileGameControls;
});

import PlayPage from '@/app/[locale]/play/page';
import MatchmakingQueue from '@/components/game/MatchmakingQueue';

const HARDCODED_DARK_CLASSES = [
  'gray-900',
  'text-white',
  'bg-white/10',
  'border-white/20',
];

describe('play page theming (#734)', () => {
  it('uses the theme-aware hero gradient and no hardcoded dark classes', () => {
    const { container } = render(<PlayPage />);

    expect(container.querySelector('.bg-gradient-hero')).not.toBeNull();
    for (const cls of HARDCODED_DARK_CLASSES) {
      expect(container.innerHTML).not.toContain(cls);
    }
  });
});

describe('MatchmakingQueue theming (#734)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('uses the theme-aware hero gradient and no hardcoded dark classes', () => {
    const { container } = render(
      <MatchmakingQueue
        gameMode="ranked"
        onCancel={jest.fn()}
        onMatchFound={jest.fn()}
      />
    );

    expect(container.querySelector('.bg-gradient-hero')).not.toBeNull();
    for (const cls of HARDCODED_DARK_CLASSES) {
      expect(container.innerHTML).not.toContain(cls);
    }
  });
});
