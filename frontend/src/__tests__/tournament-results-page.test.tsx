/**
 * Tests for the new /tournaments/[id]/results page (#324).
 *
 * We mock the Next.js navigation hooks and the auth hook so the
 * page can render in isolation; the rest of the dependencies are
 * the real components / data the production page consumes.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';

const mockParams = { id: 'unknown' };
let mockUseParams = jest.fn(() => mockParams);
const mockPush = jest.fn();
const mockBack = jest.fn();

jest.mock('next/navigation', () => ({
  useParams: () => mockUseParams(),
  useRouter: () => ({ push: mockPush, back: mockBack }),
}));

jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-123' } }),
}));

// Import after mocks so the page picks them up.
import TournamentResultsPage from '@/app/tournaments/[id]/results/page';

describe('TournamentResultsPage (#324)', () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockBack.mockReset();
  });

  it('renders the "Tournament Not Found" state for an unknown id', () => {
    mockUseParams = jest.fn(() => ({ id: 'definitely-not-real' }));
    render(<TournamentResultsPage />);
    expect(
      screen.getByText('Tournament Not Found')
    ).toBeInTheDocument();
  });

  it('renders the "Results pending" state for an in-progress tournament', () => {
    // id '1' is in_progress in the mock dataset.
    mockUseParams = jest.fn(() => ({ id: '1' }));
    render(<TournamentResultsPage />);
    expect(screen.getByTestId('results-pending')).toBeInTheDocument();
    expect(screen.getByText('Results pending')).toBeInTheDocument();
  });

  it('surfaces a link back to the live detail page even in the pending state', () => {
    // Acceptance: "Page handles the case where results are not yet
    // available". The detail-page link should be reachable from the
    // pending state so users have a clear next step.
    mockUseParams = jest.fn(() => ({ id: '1' }));
    render(<TournamentResultsPage />);
    expect(
      screen.getByRole('link', { name: 'Tournament details' })
    ).toBeInTheDocument();
  });
});
