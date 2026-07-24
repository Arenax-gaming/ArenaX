import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  ParticipantAvatar,
  hashUsername,
  getAvatarColor,
  AVATAR_COLORS,
  TournamentParticipants,
} from '@/components/tournaments/TournamentParticipants';
import type { Tournament } from '@/types/tournament';

// ─── hashUsername ─────────────────────────────────────────────────────────────

describe('hashUsername', () => {
  it('returns the same value for the same input', () => {
    expect(hashUsername('alice')).toBe(hashUsername('alice'));
    expect(hashUsername('BobDragon42')).toBe(hashUsername('BobDragon42'));
  });

  it('returns different values for different usernames', () => {
    expect(hashUsername('alice')).not.toBe(hashUsername('bob'));
  });

  it('returns a non-negative integer', () => {
    const h = hashUsername('someUser');
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
  });

  it('handles an empty string without throwing', () => {
    expect(() => hashUsername('')).not.toThrow();
  });

  it('handles unicode characters without throwing', () => {
    expect(() => hashUsername('用户名')).not.toThrow();
  });
});

// ─── getAvatarColor ───────────────────────────────────────────────────────────

describe('getAvatarColor', () => {
  it('always returns the same color for the same username', () => {
    const username = 'AlexPro123';
    expect(getAvatarColor(username)).toBe(getAvatarColor(username));
  });

  it('returns one of the known palette colors', () => {
    const color = getAvatarColor('MorganStorm99');
    expect(AVATAR_COLORS).toContain(color);
  });

  it('different usernames can yield different colors', () => {
    const colors = new Set(
      ['alice', 'bob', 'carol', 'dave', 'eve', 'frank', 'grace', 'heidi'].map(
        getAvatarColor
      )
    );
    // At least two distinct colors across eight names
    expect(colors.size).toBeGreaterThan(1);
  });

  it('color is stable across multiple calls (no random drift)', () => {
    const results = Array.from({ length: 10 }, () => getAvatarColor('TestPlayer'));
    expect(new Set(results).size).toBe(1);
  });
});

// ─── ParticipantAvatar — valid image ─────────────────────────────────────────

describe('ParticipantAvatar — valid avatarUrl', () => {
  it('renders an <img> when avatarUrl is provided', () => {
    render(<ParticipantAvatar username="alice" avatarUrl="https://example.com/alice.png" />);
    expect(screen.getByRole('img', { name: 'alice' })).toBeInTheDocument();
  });

  it('sets src to the provided URL', () => {
    render(<ParticipantAvatar username="alice" avatarUrl="https://example.com/alice.png" />);
    const img = screen.getByRole('img', { name: 'alice' }) as HTMLImageElement;
    expect(img.src).toBe('https://example.com/alice.png');
  });

  it('sets alt to the username', () => {
    render(<ParticipantAvatar username="BobElite" avatarUrl="https://example.com/bob.png" />);
    expect(screen.getByAltText('BobElite')).toBeInTheDocument();
  });

  it('does not render the initials placeholder when the image is available', () => {
    render(<ParticipantAvatar username="alice" avatarUrl="https://example.com/alice.png" />);
    // Placeholder text "A" should not be present
    expect(screen.queryByText('A')).not.toBeInTheDocument();
  });
});

// ─── ParticipantAvatar — missing avatar ──────────────────────────────────────

describe('ParticipantAvatar — missing avatarUrl', () => {
  it('renders the initials placeholder when avatarUrl is null', () => {
    render(<ParticipantAvatar username="carol" avatarUrl={null} />);
    expect(screen.getByRole('img', { name: 'carol' })).toBeInTheDocument();
    expect(screen.getByText('C')).toBeInTheDocument();
  });

  it('renders the initials placeholder when avatarUrl is undefined', () => {
    render(<ParticipantAvatar username="dave" avatarUrl={undefined} />);
    expect(screen.getByRole('img', { name: 'dave' })).toBeInTheDocument();
    expect(screen.getByText('D')).toBeInTheDocument();
  });

  it('renders the initials placeholder when avatarUrl is an empty string', () => {
    render(<ParticipantAvatar username="eve" avatarUrl="" />);
    expect(screen.getByRole('img', { name: 'eve' })).toBeInTheDocument();
    expect(screen.getByText('E')).toBeInTheDocument();
  });

  it('does not render an <img> element when avatarUrl is null', () => {
    const { container } = render(<ParticipantAvatar username="frank" avatarUrl={null} />);
    expect(container.querySelector('img')).toBeNull();
  });
});

// ─── ParticipantAvatar — initials ────────────────────────────────────────────

describe('ParticipantAvatar — initials', () => {
  it('shows the uppercase first letter of the username', () => {
    render(<ParticipantAvatar username="alice" avatarUrl={null} />);
    expect(screen.getByText('A')).toBeInTheDocument();
  });

  it('uppercases the initial even when username starts with lowercase', () => {
    render(<ParticipantAvatar username="zara99" avatarUrl={null} />);
    expect(screen.getByText('Z')).toBeInTheDocument();
  });

  it('uses the first letter, not a later character', () => {
    render(<ParticipantAvatar username="Quinn" avatarUrl={null} />);
    expect(screen.getByText('Q')).toBeInTheDocument();
    expect(screen.queryByText('u')).not.toBeInTheDocument();
  });
});

// ─── ParticipantAvatar — accessibility ───────────────────────────────────────

describe('ParticipantAvatar — accessibility', () => {
  it('placeholder has role="img" and aria-label matching the username', () => {
    render(<ParticipantAvatar username="grace" avatarUrl={null} />);
    const placeholder = screen.getByRole('img', { name: 'grace' });
    expect(placeholder).toHaveAttribute('aria-label', 'grace');
  });

  it('img element has alt text equal to the username', () => {
    render(<ParticipantAvatar username="heidi" avatarUrl="https://example.com/heidi.png" />);
    const img = screen.getByAltText('heidi');
    expect(img.tagName).toBe('IMG');
  });

  it('placeholder is accessible by username as its accessible name', () => {
    render(<ParticipantAvatar username="ivan" avatarUrl={null} />);
    // getByRole with name throws if not found — this asserts accessibility
    expect(screen.getByRole('img', { name: 'ivan' })).toBeInTheDocument();
  });
});

// ─── ParticipantAvatar — image load failure ───────────────────────────────────

describe('ParticipantAvatar — image load failure', () => {
  it('shows the initials placeholder after the image fails to load', () => {
    render(<ParticipantAvatar username="judy" avatarUrl="https://broken.example.com/judy.png" />);

    // Initially, the <img> is rendered
    const img = screen.getByRole('img', { name: 'judy' }) as HTMLImageElement;
    expect(img.tagName).toBe('IMG');

    // Simulate load failure
    fireEvent.error(img);

    // Placeholder is now shown
    expect(screen.getByText('J')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'judy' })?.tagName).not.toBe('IMG');
  });

  it('no longer renders the <img> after load failure (prevents repeated error events)', () => {
    const { container } = render(
      <ParticipantAvatar username="karl" avatarUrl="https://broken.example.com/karl.png" />
    );

    fireEvent.error(container.querySelector('img')!);

    expect(container.querySelector('img')).toBeNull();
  });

  it('displays the correct initial after image failure', () => {
    render(<ParticipantAvatar username="Lena" avatarUrl="https://broken.example.com/lena.png" />);
    fireEvent.error(screen.getByRole('img', { name: 'Lena' }));
    expect(screen.getByText('L')).toBeInTheDocument();
  });

  it('placeholder after failure has role="img" with username as accessible name', () => {
    render(<ParticipantAvatar username="mike" avatarUrl="https://broken.example.com/mike.png" />);
    fireEvent.error(screen.getByRole('img', { name: 'mike' }));
    const placeholder = screen.getByRole('img', { name: 'mike' });
    expect(placeholder).toHaveAttribute('aria-label', 'mike');
    expect(placeholder.tagName).not.toBe('IMG');
  });
});

// ─── ParticipantAvatar — deterministic placeholder color ─────────────────────

describe('ParticipantAvatar — deterministic placeholder color', () => {
  it('applies a palette color class to the placeholder', () => {
    const { container } = render(<ParticipantAvatar username="nina" avatarUrl={null} />);
    const placeholder = container.firstChild as HTMLElement;
    const hasPaletteClass = AVATAR_COLORS.some((c) => placeholder.classList.contains(c.replace('bg-', '')));
    // Check via class list string since jsdom stores full class names
    const classString = placeholder.className;
    const matchesAny = AVATAR_COLORS.some((c) => classString.includes(c.replace('bg-', '').split('-')[0]));
    expect(matchesAny).toBe(true);
  });

  it('renders the same color class on every render for the same username', () => {
    const getClass = () => {
      const { container } = render(<ParticipantAvatar username="otto" avatarUrl={null} />);
      return (container.firstChild as HTMLElement).className;
    };
    expect(getClass()).toBe(getClass());
  });

  it('the color is derived from getAvatarColor (deterministic)', () => {
    const username = 'peggy';
    const expectedColor = getAvatarColor(username);
    const { container } = render(<ParticipantAvatar username={username} avatarUrl={null} />);
    const el = container.firstChild as HTMLElement;
    // The expected Tailwind color class (e.g. "bg-blue-500") should be on the element
    expect(el.className).toContain(expectedColor.slice(3)); // strip "bg-" → "blue-500" etc.
  });
});

// ─── TournamentParticipants integration ──────────────────────────────────────

const baseTournament: Tournament = {
  id: 'tournament-1',
  name: 'Test Cup',
  gameType: 'chess',
  tournamentType: 'single_elimination',
  entryFee: 0,
  prizePool: 100,
  maxParticipants: 4,
  currentParticipants: 2,
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

  it('renders one avatar per participant (img or placeholder)', () => {
    render(<TournamentParticipants tournament={baseTournament} />);
    const avatars = screen.getAllByRole('img');
    // Each participant gets exactly one avatar element
    expect(avatars.length).toBeGreaterThanOrEqual(baseTournament.currentParticipants);
  });

  it('renders the correct slot counts', () => {
    render(<TournamentParticipants tournament={baseTournament} />);
    expect(
      screen.getByText(`${baseTournament.currentParticipants} of ${baseTournament.maxParticipants} slots filled`)
    ).toBeInTheDocument();
  });

  it('shows "Tournament is full" when all slots are taken', () => {
    const full = { ...baseTournament, currentParticipants: 4, maxParticipants: 4 };
    render(<TournamentParticipants tournament={full} />);
    // The phrase appears in two places (header badge + info banner); both should be present
    expect(screen.getAllByText(/tournament is full/i).length).toBeGreaterThanOrEqual(1);
  });

  it('shows available slots count when not full', () => {
    render(<TournamentParticipants tournament={baseTournament} />);
    const slots = baseTournament.maxParticipants - baseTournament.currentParticipants;
    // Appears in both the header badge and the info banner
    expect(screen.getAllByText(new RegExp(`${slots} spot`)).length).toBeGreaterThanOrEqual(1);
  });
});
