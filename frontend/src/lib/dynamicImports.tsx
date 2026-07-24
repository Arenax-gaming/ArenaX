/**
 * Dynamic imports for code splitting and lazy loading
 * This file centralizes all dynamic imports to enable better code splitting
 */

import dynamic from 'next/dynamic';
import React from 'react';

// Loading component for dynamic imports
const LoadingSkeleton: React.FC<{ height?: string }> = ({ height = 'h-64' }) => (
  <div className={`animate-pulse bg-gray-200 rounded ${height}`} />
);

// Tournament components
export const DynamicTournamentBracket = dynamic(
  () => import('@/components/tournaments/TournamentBracket'),
  { 
    loading: () => <LoadingSkeleton height="h-96" />,
    ssr: false 
  }
);

export const DynamicTournamentParticipants = dynamic(
  () => import('@/components/tournaments/TournamentParticipants'),
  { 
    loading: () => <LoadingSkeleton height="h-64" />,
    ssr: false 
  }
);

export const DynamicTournamentFilter = dynamic(
  () => import('@/components/tournaments/TournamentFilter'),
  { 
    loading: () => <LoadingSkeleton height="h-48" />,
    ssr: false 
  }
);

// Chart components
export const DynamicAnalyticsDashboard = dynamic(
  () => import('@/components/charts/AnalyticsDashboard'),
  { 
    loading: () => <LoadingSkeleton height="h-96" />,
    ssr: false 
  }
);

export const DynamicPlayerStatsCharts = dynamic(
  () => import('@/components/charts/PlayerStatsCharts'),
  { 
    loading: () => <LoadingSkeleton height="h-64" />,
    ssr: false 
  }
);

export const DynamicTournamentResultsCharts = dynamic(
  () => import('@/components/charts/TournamentResultsCharts'),
  { 
    loading: () => <LoadingSkeleton height="h-64" />,
    ssr: false 
  }
);

// Match components
export const DynamicMatchDetailView = dynamic(
  () => import('@/components/match/MatchDetailView'),
  { 
    loading: () => <LoadingSkeleton height="h-96" />,
    ssr: false 
  }
);

// Tournament registration
export const DynamicJoinTournamentButton = dynamic(
  () => import('@/components/tournaments/JoinTournamentButton'),
  { 
    loading: () => <LoadingSkeleton height="h-12" />,
    ssr: false 
  }
);

export const DynamicQuickJoinModal = dynamic(
  () => import('@/components/tournaments/QuickJoinModal'),
  { 
    loading: () => null,
    ssr: false 
  }
);
