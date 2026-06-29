/**
 * Tests for params.id type-safe narrowing in the matches/[id] page.
 * Verifies correct behaviour when params.id is a string and when it
 * is a string array (Next.js App Router can provide either).
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

let mockUseParams = jest.fn(() => ({ id: 'unknown' }));
const mockPush = jest.fn();
const mockBack = jest.fn();

jest.mock('next/navigation', () => ({
  useParams: () => mockUseParams(),
  useRouter: () => ({ push: mockPush, back: mockBack }),
}));

jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-123', username: 'TestUser' } }),
}));

jest.mock('@/hooks/useMatchWebSocket', () => ({
  useMatchWebSocket: () => ({
    isConnected: false,
    lastUpdate: null,
    connectionError: null,
    reconnect: jest.fn(),
  }),
  useMatchScoreReporting: () => ({
    reportScore: jest.fn(),
    pendingReport: null,
    isReporting: false,
    conflictDetected: false,
    conflictingReport: null,
    clearConflict: jest.fn(),
  }),
}));

// Mock useMatch so tests are synchronous and don't need API calls
jest.mock('@/hooks/useMatches', () => ({
  useMatch: (matchId: string) => {
    // Import matchHubDetails synchronously via require
    const { matchHubDetails } = require('@/data/matchHub');
    const data = matchHubDetails[matchId] ?? null;
    return {
      data,
      isLoading: false,
      error: data ? null : new Error('Not found'),
      refetch: jest.fn(),
    };
  },
}));

import MatchHubPage from '@/app/matches/[id]/page';

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  );
}

describe('MatchHubPage — params.id narrowing', () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockBack.mockReset();
  });

  it('shows "Match Not Found" for an unknown string id', () => {
    mockUseParams = jest.fn(() => ({ id: 'definitely-not-real' }));
    renderWithQuery(<MatchHubPage />);
    expect(screen.getByText('Match Not Found')).toBeInTheDocument();
  });

  it('renders the match hub for a known string id', () => {
    mockUseParams = jest.fn(() => ({ id: '1-match-13' }));
    renderWithQuery(<MatchHubPage />);
    expect(screen.getByText('Match Hub')).toBeInTheDocument();
  });

  it('handles params.id as a string array by using the first element', () => {
    mockUseParams = jest.fn(() => ({ id: ['1-match-13', 'extra'] }));
    renderWithQuery(<MatchHubPage />);
    expect(screen.getByText('Match Hub')).toBeInTheDocument();
  });

  it('shows "Match Not Found" when params.id array contains an unknown id', () => {
    mockUseParams = jest.fn(() => ({ id: ['definitely-not-real'] }));
    renderWithQuery(<MatchHubPage />);
    expect(screen.getByText('Match Not Found')).toBeInTheDocument();
  });
});
