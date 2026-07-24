import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProfileBio } from '@/components/profile/ProfileBio';
import { MAX_BIO_LENGTH, profileBioSchema } from '@/lib/validations/profile';
import type { User } from '@/types/user';

const baseUser: User = {
  id: 'user-1',
  username: 'TestPlayer',
  email: 'test@example.com',
  isVerified: true,
  elo: 1500,
  createdAt: '2024-01-01T00:00:00Z',
  bio: '',
  socialLinks: {},
};

function renderBio(user: Partial<User> = {}) {
  const onSave = jest.fn();
  render(<ProfileBio user={{ ...baseUser, ...user }} onSave={onSave} />);

  // Enter edit mode
  fireEvent.click(screen.getByRole('button', { name: /edit profile/i }));

  return { onSave };
}

describe('ProfileBio — character counter', () => {
  it('shows 0 / MAX_BIO_LENGTH initially when bio is empty', () => {
    renderBio();
    expect(screen.getByText(`0 / ${MAX_BIO_LENGTH}`)).toBeInTheDocument();
  });

  it('updates counter immediately as the user types', () => {
    renderBio();
    const textarea = screen.getByRole('textbox', { name: /bio/i });

    fireEvent.change(textarea, { target: { value: 'Hello!' } });
    expect(screen.getByText(`6 / ${MAX_BIO_LENGTH}`)).toBeInTheDocument();

    fireEvent.change(textarea, { target: { value: 'Hello, world!' } });
    expect(screen.getByText(`13 / ${MAX_BIO_LENGTH}`)).toBeInTheDocument();
  });

  it('reflects the existing bio length on first render', () => {
    const existingBio = 'A'.repeat(50);
    renderBio({ bio: existingBio });
    expect(screen.getByText(`50 / ${MAX_BIO_LENGTH}`)).toBeInTheDocument();
  });
});

describe('ProfileBio — warning state at 90% capacity', () => {
  const warningThreshold = Math.floor(MAX_BIO_LENGTH * 0.9);

  it('counter has no warning style below 90%', () => {
    renderBio();
    const textarea = screen.getByRole('textbox', { name: /bio/i });

    fireEvent.change(textarea, { target: { value: 'A'.repeat(warningThreshold - 1) } });

    const counter = screen.getByText(`${warningThreshold - 1} / ${MAX_BIO_LENGTH}`);
    expect(counter).not.toHaveClass('text-destructive');
  });

  it('counter switches to warning style at exactly 90% of MAX_BIO_LENGTH', () => {
    renderBio();
    const textarea = screen.getByRole('textbox', { name: /bio/i });

    fireEvent.change(textarea, { target: { value: 'A'.repeat(warningThreshold) } });

    const counter = screen.getByText(`${warningThreshold} / ${MAX_BIO_LENGTH}`);
    expect(counter).toHaveClass('text-destructive');
  });

  it('counter keeps warning style when bio exceeds the limit', () => {
    renderBio();
    const textarea = screen.getByRole('textbox', { name: /bio/i });

    fireEvent.change(textarea, { target: { value: 'A'.repeat(MAX_BIO_LENGTH + 1) } });

    const counter = screen.getByText(`${MAX_BIO_LENGTH + 1} / ${MAX_BIO_LENGTH}`);
    expect(counter).toHaveClass('text-destructive');
  });
});

describe('ProfileBio — submission blocking', () => {
  it('Save button is enabled within the limit', () => {
    renderBio();
    const textarea = screen.getByRole('textbox', { name: /bio/i });

    fireEvent.change(textarea, { target: { value: 'A'.repeat(MAX_BIO_LENGTH) } });

    expect(screen.getByRole('button', { name: /save changes/i })).not.toBeDisabled();
  });

  it('Save button is disabled when bio exceeds MAX_BIO_LENGTH', () => {
    renderBio();
    const textarea = screen.getByRole('textbox', { name: /bio/i });

    fireEvent.change(textarea, { target: { value: 'A'.repeat(MAX_BIO_LENGTH + 1) } });

    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled();
  });

  it('shows inline error message when bio exceeds MAX_BIO_LENGTH', () => {
    renderBio();
    const textarea = screen.getByRole('textbox', { name: /bio/i });

    fireEvent.change(textarea, { target: { value: 'A'.repeat(MAX_BIO_LENGTH + 1) } });

    expect(
      screen.getByText(`Bio must be ${MAX_BIO_LENGTH} characters or less`)
    ).toBeInTheDocument();
  });

  it('clears the error once bio is back within the limit', () => {
    renderBio();
    const textarea = screen.getByRole('textbox', { name: /bio/i });

    fireEvent.change(textarea, { target: { value: 'A'.repeat(MAX_BIO_LENGTH + 1) } });
    expect(
      screen.getByText(`Bio must be ${MAX_BIO_LENGTH} characters or less`)
    ).toBeInTheDocument();

    fireEvent.change(textarea, { target: { value: 'A'.repeat(MAX_BIO_LENGTH) } });
    expect(
      screen.queryByText(`Bio must be ${MAX_BIO_LENGTH} characters or less`)
    ).not.toBeInTheDocument();
  });

  it('does not call onSave when bio exceeds the limit', () => {
    const { onSave } = renderBio();
    const textarea = screen.getByRole('textbox', { name: /bio/i });

    fireEvent.change(textarea, { target: { value: 'A'.repeat(MAX_BIO_LENGTH + 1) } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    expect(onSave).not.toHaveBeenCalled();
  });
});

describe('ProfileBio — successful submission', () => {
  it('calls onSave with the correct bio when within the limit', () => {
    const { onSave } = renderBio();
    const textarea = screen.getByRole('textbox', { name: /bio/i });
    const validBio = 'Hello, I am a gamer!';

    fireEvent.change(textarea, { target: { value: validBio } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ bio: validBio })
    );
  });

  it('exits edit mode after a successful save', () => {
    renderBio();
    const textarea = screen.getByRole('textbox', { name: /bio/i });

    fireEvent.change(textarea, { target: { value: 'Short bio' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    expect(screen.queryByRole('textbox', { name: /bio/i })).not.toBeInTheDocument();
  });
});

describe('ProfileBio — constant / schema consistency', () => {
  it('profileBioSchema rejects bio longer than MAX_BIO_LENGTH', () => {
    const result = profileBioSchema.safeParse({ bio: 'A'.repeat(MAX_BIO_LENGTH + 1) });
    expect(result.success).toBe(false);
  });

  it('profileBioSchema accepts bio exactly at MAX_BIO_LENGTH', () => {
    const result = profileBioSchema.safeParse({ bio: 'A'.repeat(MAX_BIO_LENGTH) });
    expect(result.success).toBe(true);
  });

  it('profileBioSchema accepts an undefined bio', () => {
    const result = profileBioSchema.safeParse({ bio: undefined });
    expect(result.success).toBe(true);
  });

  it('MAX_BIO_LENGTH matches the schema max constraint', () => {
    const tooLong = profileBioSchema.safeParse({ bio: 'A'.repeat(MAX_BIO_LENGTH + 1) });
    const exactLimit = profileBioSchema.safeParse({ bio: 'A'.repeat(MAX_BIO_LENGTH) });
    expect(tooLong.success).toBe(false);
    expect(exactLimit.success).toBe(true);
  });
});
