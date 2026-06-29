'use client';

import React, { createContext, useContext, useCallback, ReactNode } from 'react';
import { useCollaboration } from '@/hooks/useCollaboration';
import { useAuth } from '@/hooks/useAuth';
import { RemoteCursor, PresenceUser, CollaborationState, CursorPosition, PresenceUser as PresenceUserType } from '@/types/collaboration';

interface CollaborationContextValue {
  cursors: RemoteCursor[];
  presence: PresenceUser[];
  state: CollaborationState;
  isConnected: boolean;
  error: string | null;
  userColor: string;
  sendCursorUpdate: (position: CursorPosition | null) => void;
  updatePresence: (status: PresenceUserType['status']) => void;
  sendCollaborativeAction: (action: string, payload: unknown) => void;
}

const CollaborationContext = createContext<CollaborationContextValue | null>(null);

interface CollaborationProviderProps {
  documentId: string;
  wsUrl?: string;
  children: ReactNode;
}

export function CollaborationProvider({ documentId, wsUrl, children }: CollaborationProviderProps) {
  const { user } = useAuth();

  const collaboration = useCollaboration({
    documentId,
    userId: user?.id ?? 'anonymous',
    username: user?.username ?? 'Anonymous',
    wsUrl,
  });

  return (
    <CollaborationContext.Provider value={collaboration}>
      {children}
    </CollaborationContext.Provider>
  );
}

export function useCollaborationContext(): CollaborationContextValue {
  const ctx = useContext(CollaborationContext);
  if (!ctx) {
    throw new Error('useCollaborationContext must be used within a CollaborationProvider');
  }
  return ctx;
}
