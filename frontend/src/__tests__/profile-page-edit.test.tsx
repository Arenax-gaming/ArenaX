/**
 * Tests for the profile page's inline edit mode (#323).
 *
 * Verifies that the Edit Profile button actually swaps the username
 * heading for an input, Save commits the change, and Cancel reverts.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  usePathname: () => '/profile',
}));

jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-123' } }),
}));

jest.mock('@/data/user', () => ({
  __esModule: true,
  currentUser: {
    id: 'user-123',
    username: 'ProGamer99',
    email: 'pro@example.test',
    avatar: null,
    elo: 1800,
    createdAt: '2026-01-01T00:00:00Z',
  },
  mockEloHistory: [],
}));

jest.mock('@/data/matches', () => ({
  __esModule: true,
  mockMatchHistory: [],
}));

// Render the page after the mocks are in place.
import ProfilePage from '@/app/profile/page';

describe('ProfilePage edit mode (#323)', () => {
  it('shows a static heading by default and reveals the edit input on click', () => {
    render(<ProfilePage />);
    expect(screen.getByRole('heading', { name: 'ProGamer99' })).toBeInTheDocument();
    // Edit affordance visible.
    const editBtn = screen.getByTestId('profile-edit');
    fireEvent.click(editBtn);
    // Heading replaced with an input pre-populated with the current name.
    const input = screen.getByTestId('profile-username-input') as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.value).toBe('ProGamer99');
    // Save + Cancel surfaces appear.
    expect(screen.getByTestId('profile-save')).toBeInTheDocument();
    expect(screen.getByTestId('profile-cancel')).toBeInTheDocument();
  });

  it('Save persists the new username and exits edit mode', () => {
    render(<ProfilePage />);
    fireEvent.click(screen.getByTestId('profile-edit'));
    const input = screen.getByTestId('profile-username-input');
    fireEvent.change(input, { target: { value: 'NewName' } });
    fireEvent.click(screen.getByTestId('profile-save'));
    // Heading reflects the new name, no input remains.
    expect(screen.getByRole('heading', { name: 'NewName' })).toBeInTheDocument();
    expect(screen.queryByTestId('profile-username-input')).toBeNull();
  });

  it('Cancel reverts the draft and exits edit mode', () => {
    render(<ProfilePage />);
    fireEvent.click(screen.getByTestId('profile-edit'));
    const input = screen.getByTestId('profile-username-input');
    fireEvent.change(input, { target: { value: 'TempName' } });
    fireEvent.click(screen.getByTestId('profile-cancel'));
    // Original name is preserved.
    expect(screen.getByRole('heading', { name: 'ProGamer99' })).toBeInTheDocument();
    expect(screen.queryByTestId('profile-username-input')).toBeNull();
  });

  it('Save is disabled for an empty username', () => {
    render(<ProfilePage />);
    fireEvent.click(screen.getByTestId('profile-edit'));
    const input = screen.getByTestId('profile-username-input');
    fireEvent.change(input, { target: { value: '   ' } });
    expect(screen.getByTestId('profile-save')).toBeDisabled();
  });
});
