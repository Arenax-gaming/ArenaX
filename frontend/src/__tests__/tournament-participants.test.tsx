import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  ParticipantAvatar,
  TournamentParticipants,
  hashUsername,
  getAvatarColor,
  AVATAR_COLORS,
} from '@/components/tournaments/TournamentParticipants';
import type { Tournament } from '@/types/tournament';

// ─── hashUsername ─────────────────────────────────────────────────────────────

describe('hashUsername', () => {
  it('returns the same value for the same username on every call', () => {
    expect(hashUsername('AlexPro')).toBe(hashUsername('AlexPro'));
    expect(hashUsername('RiverVoid123')).toBe(hashUsername('RiverVoid123'));
  });

  it('produces different values for different usernames', () => {
    expect(hashUsername('alice')).not.toBe(hashUsername('bob'));
  });

  it('always returns a non-negative integer', () => {
    const h = hashUsername('SomePlayer');
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
  });

  it('handles an empty string without throwing', () => {
    expect(() => hashUsername('')).not.toThrow();
    expect(typeof hashUsername('')).toBe('number');
  });

  it('handles unicode characters without throwing', () => {
    expect(() => hashUsername('玩家123')).not.toThrow();
  });
});

// ─── getAvatarColor ───────────────────────────────────────────────────────────

describe('getAvatarColor', () => {
  it('returns the same color for the same username across calls', () => {
    const name = 'BlakeNexus42';
    expect(getAvatarColor(name)).toBe(getAvatarColor(name));
  });

  it('always returns one of the defined palette colors', () => {
    ['alice', 'bob', 'carol', 'dave', 'eve'].forEach((name) => {
      expect(AVATAR_COLORS as readonly string[]).toContain(getAvatarColor(name));
    });
  });

  it('produces more than one distinct color across several usernames', () => {
    const names = ['alice', 'bob', 'carol', 'dave', 'eve', 'frank', 'grace', 'heidi'];
    const unique = new Set(names.map(getAvatarColor));
    expect(unique.size).toBeGreaterThan(1);
  });

  it('is stable across 20 repeated calls (no hidden randomness)', () => {
    const username = 'TaylorDragon';
    const results = Array.from({ length: 20 }, () => getAvatarColor(username));
    expect(new Set(results).size).toBe(1);
  });
});

// ─── ParticipantAvatar — valid image ─────────────────────────────────────────

describe('ParticipantAvatar — valid avatarUrl', () => {
  const URL = 'https://example.com/avatar.png';

  it('renders an <img> element when avatarUrl is a non-empty string', () => {
    render(<ParticipantAvatar username="alice" avatarUrl={URL} />);
    expect(screen.getByRole('img', { name: 'alice' }).tagName).toBe('IMG');
  });

  it('sets the src attribute to the provided URL', () => {
    render(<ParticipantAvatar username="alice" avatarUrl={URL} />);
    expect((screen.getByRole('img', { name: 'alice' }) as HTMLImageElement).src).toBe(URL);
  });

  it('sets alt to the username for accessibility', () => {
    render(<ParticipantAvatar username="BobElite" avatarUrl={URL} />);
    expect(screen.getByAltText('BobElite')).toBeInTheDocument();
  });

  it('does not show the initials text when the image is present', () => {
    render(<ParticipantAvatar username="alice" avatarUrl={URL} />);
    expect(screen.queryByText('A')).not.toBeInTheDocument();
  });

  it('does not render the placeholder div when image is present', () => {
    const { container } = render(<ParticipantAvatar username="alice" avatarUrl={URL} />);
    // The placeholder carries role="img" + aria-label; a real <img> uses alt instead.
    // When the image loads, there must be no placeholder div in the DOM.
    expect(container.querySelector('div[role="img"]')).toBeNull();
  });
});

// ─── ParticipantAvatar — missing / empty avatarUrl ───────────────────────────

describe('ParticipantAvatar — missing avatarUrl', () => {
  it('renders the initials placeholder when avatarUrl is null', () => {
    render(<ParticipantAvatar username="carol" avatarUrl={null} />);
    const el = screen.getByRole('img', { name: 'carol' });
    expect(el.tagName).not.toBe('IMG');
    expect(screen.getByText('C')).toBeInTheDocument();
  });

  it('renders the initials placeholder when avatarUrl is undefined', () => {
    render(<ParticipantAvatar username="dave" avatarUrl={undefined} />);
    expect(screen.getByText('D')).toBeInTheDocument();
  });

  it('renders the initials placeholder when avatarUrl is an empty string', () => {
    render(<ParticipantAvatar username="eve" avatarUrl="" />);
    expect(screen.getByText('E')).toBeInTheDocument();
  });

  it('never renders an <img> element when avatarUrl is falsy', () => {
    const { container } = render(<ParticipantAvatar username="frank" avatarUrl={null} />);
    expect(container.querySelector('img')).toBeNull();
  });

  it('placeholder has aria-label equal to the username', () => {
    render(<ParticipantAvatar username="grace" avatarUrl={null} />);
    expect(screen.getByRole('img', { name: 'grace' })).toHaveAttribute('aria-label', 'grace');
  });
});

// ─── ParticipantAvatar — initials ────────────────────────────────────────────

describe('ParticipantAvatar — initials rendering', () => {
  it('shows the uppercased first character of the username', () => {
    render(<ParticipantAvatar username="alice" avatarUrl={null} />);
    expect(screen.getByText('A')).toBeInTheDocument();
  });

  it('uppercases a lowercase leading character', () => {
    render(<ParticipantAvatar username="zara" avatarUrl={null} />);
    expect(screen.getByText('Z')).toBeInTheDocument();
  });

  it('shows only the first character, not later ones', () => {
    render(<ParticipantAvatar username="Quinn" avatarUrl={null} />);
    expect(screen.getByText('Q')).toBeInTheDocument();
    expect(screen.queryByText('u')).not.toBeInTheDocument();
    expect(screen.queryByText('i')).not.toBeInTheDocument();
  });
});

// ─── ParticipantAvatar — image load failure ───────────────────────────────────

describe('ParticipantAvatar — image load failure', () => {
  it('switches to the initials placeholder after the image fires an error event', () => {
    render(
      <ParticipantAvatar username="heidi" avatarUrl="https://broken.example.com/heidi.png" />,
    );

    const img = screen.getByRole('img', { name: 'heidi' });
    expect(img.tagName).toBe('IMG');

    fireEvent.error(img);

    // img is gone; placeholder is shown
    expect(screen.queryByRole('img', { name: 'heidi' })?.tagName).not.toBe('IMG');
    expect(screen.getByText('H')).toBeInTheDocument();
  });

  it('removes the <img> element from the DOM so error events cannot repeat', () => {
    const { container } = render(
      <ParticipantAvatar username="ivan" avatarUrl="https://broken.example.com/ivan.png" />,
    );

    fireEvent.error(container.querySelector('img')!);

    expect(container.querySelector('img')).toBeNull();
  });

  it('shows the correct initial after image failure', () => {
    render(
      <ParticipantAvatar username="Judy" avatarUrl="https://broken.example.com/judy.png" />,
    );
    fireEvent.error(screen.getByRole('img', { name: 'Judy' }));
    expect(screen.getByText('J')).toBeInTheDocument();
  });

  it('placeholder retains role="img" and aria-label after failure', () => {
    render(
      <ParticipantAvatar username="karl" avatarUrl="https://broken.example.com/karl.png" />,
    );
    fireEvent.error(screen.getByRole('img', { name: 'karl' }));
    const placeholder = screen.getByRole('img', { name: 'karl' });
    expect(placeholder.tagName).not.toBe('IMG');
    expect(placeholder).toHaveAttribute('aria-label', 'karl');
  });

  it('calling fireEvent.error twice does not cause additional re-renders', () => {
    const { container } = render(
      <ParticipantAvatar username="lena" avatarUrl="https://broken.example.com/lena.png" />,
    );

    const img = container.querySelector('img')!;
    fireEvent.error(img); // img unmounted after this
    // A second error call on the detached node should not throw or revert state
    expect(() => fireEvent.error(img)).not.toThrow();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('L')).toBeInTheDocument();
  });
});

// ─── ParticipantAvatar — deterministic placeholder color ─────────────────────

describe('ParticipantAvatar — deterministic placeholder color', () => {
  it('applies a color class from the palette to the placeholder', () => {
    const { container } = render(<ParticipantAvatar username="nina" avatarUrl={null} />);
    const el = container.firstChild as HTMLElement;
    const appliedPaletteColor = AVATAR_COLORS.some((c) => el.className.includes(c));
    expect(appliedPaletteColor).toBe(true);
  });

  it('renders the exact class returned by getAvatarColor', () => {
    const username = 'otto';
    const expected = getAvatarColor(username);
    const { container } = render(<ParticipantAvatar username={username} avatarUrl={null} />);
    expect((container.firstChild as HTMLElement).className).toContain(expected);
  });

  it('applies the same class on every render for the same username', () => {
    const getClass = () => {
      const { container } = render(<ParticipantAvatar username="peggy" avatarUrl={null} />);
      return (container.firstChild as HTMLElement).className;
    };
    expect(getClass()).toBe(getClass());
  });

  it('after image failure the placeholder carries the correct color class', () => {
    const username = 'quincy';
    const expected = getAvatarColor(username);
    render(
      <ParticipantAvatar username={username} avatarUrl="https://broken.example.com/q.png" />,
    );
    fireEvent.error(screen.getByRole('img', { name: username }));
    const placeholder = screen.getByRole('img', { name: username });
    expect(placeholder.className).toContain(expected);
  });
});

// ─── TournamentParticipants integration ──────────────────────────────────────

const baseTournament: Tournament = {
  id: 't-1',
  name: 'Arena Cup',
  gameType: 'chess',
  tournamentType: 'single_elimination',
  entryFee: 0,
  prizePool: 500,
  maxParticipants: 8,
  currentParticipants: 3,
  status: 'registration_open',
  visibility: 'public',
  startTime: new Date().toISOString(),
  createdBy: 'user-1',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe('TournamentParticipants integration', () => {
  it('renders without crashing', () => {
    expect(() => render(<TournamentParticipants tournament={baseTournament} />)).not.toThrow();
  });

  it('shows the Participants heading', () => {
    render(<TournamentParticipants tournament={baseTournament} />);
    expect(screen.getByRole('heading', { name: /participants/i })).toBeInTheDocument();
  });

  it('renders at least one avatar element per participant', () => {
    render(<TournamentParticipants tournament={baseTournament} />);
    // Every row has a ParticipantAvatar — each resolves to role="img"
    const avatars = screen.getAllByRole('img');
    expect(avatars.length).toBeGreaterThanOrEqual(baseTournament.currentParticipants);
  });

  it('displays the correct filled/total slot text', () => {
    render(<TournamentParticipants tournament={baseTournament} />);
    expect(
      screen.getByText(
        `${baseTournament.currentParticipants} of ${baseTournament.maxParticipants} slots filled`,
      ),
    ).toBeInTheDocument();
  });

  it('shows "Tournament is full" messaging when at capacity', () => {
    const full = { ...baseTournament, currentParticipants: 8, maxParticipants: 8 };
    render(<TournamentParticipants tournament={full} />);
    expect(screen.getAllByText(/tournament is full/i).length).toBeGreaterThanOrEqual(1);
  });

  it('shows available slots count when not full', () => {
    render(<TournamentParticipants tournament={baseTournament} />);
    const available = baseTournament.maxParticipants - baseTournament.currentParticipants;
    expect(screen.getAllByText(new RegExp(`${available} spot`)).length).toBeGreaterThanOrEqual(1);
  });
});
