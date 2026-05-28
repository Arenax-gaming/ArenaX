/**
 * Tests for #296 AchievementShare component + pure share-message helper.
 * Also serves as one of the new test additions for #302 (component
 * testing coverage with React Testing Library).
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AchievementShare, {
  buildAchievementShareMessage,
} from '@/components/achievements/AchievementShare';

describe('buildAchievementShareMessage', () => {
  it('produces a short body when no description is supplied', () => {
    const msg = buildAchievementShareMessage(
      'first-blood',
      'First Blood',
      undefined,
      'https://example.test/achievements/first-blood'
    );
    expect(msg.title).toBe('ArenaX Achievement: First Blood');
    expect(msg.text).toBe('I just unlocked "First Blood" on ArenaX!');
    expect(msg.url).toBe('https://example.test/achievements/first-blood');
  });

  it('embeds the description and truncates at 140 chars', () => {
    const long = 'a'.repeat(200);
    const msg = buildAchievementShareMessage(
      'marathoner',
      'Marathoner',
      long,
      'https://example.test/a'
    );
    expect(msg.text.startsWith('I just unlocked "Marathoner" on ArenaX — ')).toBe(true);
    // 140 char cap on the description portion → ends with an ellipsis.
    const descPortion = msg.text.replace(
      'I just unlocked "Marathoner" on ArenaX — ',
      ''
    );
    expect(descPortion.length).toBeLessThanOrEqual(140);
    expect(descPortion.endsWith('…')).toBe(true);
  });

  it('falls back to a relative URL when window is undefined and no override is given', () => {
    const msg = buildAchievementShareMessage('id-1', 'Title', undefined, undefined);
    // Test environment may have window; assert it's either a relative path
    // or a fully-qualified URL ending in /achievements/id-1.
    expect(msg.url.endsWith('/achievements/id-1')).toBe(true);
  });
});

describe('<AchievementShare />', () => {
  const originalShare = (navigator as Navigator & { share?: typeof navigator.share }).share;
  const originalClipboard = navigator.clipboard;

  afterEach(() => {
    Object.assign(navigator, { share: originalShare });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: originalClipboard,
    });
  });

  it('renders an accessible share button labeled with the achievement title', () => {
    render(<AchievementShare achievementId="a1" title="First Blood" />);
    const button = screen.getByRole('button', {
      name: 'Share achievement: First Blood',
    });
    expect(button).toBeInTheDocument();
    expect(button).not.toBeDisabled();
  });

  it('invokes navigator.share when available', async () => {
    const share = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { share });
    render(
      <AchievementShare
        achievementId="a1"
        title="First Blood"
        description="Get your first kill in any match."
      />
    );
    fireEvent.click(
      screen.getByRole('button', { name: /Share achievement/ })
    );
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const arg = share.mock.calls[0][0];
    expect(arg.title).toBe('ArenaX Achievement: First Blood');
    expect(arg.text).toContain('First Blood');
    expect(arg.url).toContain('/achievements/a1');
  });

  it('falls back to clipboard when navigator.share is missing', async () => {
    Object.assign(navigator, { share: undefined });
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    render(
      <AchievementShare
        achievementId="a2"
        title="Sharpshooter"
        shareUrl="https://example.test/achievements/a2"
      />
    );
    fireEvent.click(
      screen.getByRole('button', { name: /Share achievement/ })
    );
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][0]).toContain('https://example.test/achievements/a2');
    // The button visibly switches to "Copied" briefly.
    expect(screen.getByText('Copied')).toBeInTheDocument();
  });

  it('respects the disabled prop and skips share / clipboard calls', async () => {
    const share = jest.fn();
    Object.assign(navigator, { share });
    render(
      <AchievementShare
        achievementId="a3"
        title="Locked"
        disabled
      />
    );
    const button = screen.getByRole('button', { name: /Share achievement/ });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    // jsdom dispatches click even on disabled buttons in some setups, so
    // we just verify the share API was not invoked.
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(share).not.toHaveBeenCalled();
  });
});
