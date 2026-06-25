"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useState,
} from "react";
import type {
  CollaborationChannel,
  CollaborationChannelType,
  CollaborationEvent,
  CollaborationUser,
} from "@/types/collaboration";
import { useCollaborationWebSocket } from "@/hooks/useCollaborationWebSocket";

interface CollaborationContextType {
  activeChannelId: string | null;
  activeChannelType: CollaborationChannelType | null;
  setActiveChannel: (
    channelId: string | null,
    channelType: CollaborationChannelType | null
  ) => void;
  isConnected: boolean;
  channel: CollaborationChannel | null;
  events: CollaborationEvent[];
  sendEvent: (event: Omit<CollaborationEvent, "timestamp" | "userId">) => void;
  connectionError: string | null;
  reconnect: () => void;
  disconnect: () => void;
}

const CollaborationContext = createContext<CollaborationContextType | undefined>(
  undefined
);

interface CollaborationProviderProps {
  children: React.ReactNode;
}

export function CollaborationProvider({
  children,
}: CollaborationProviderProps) {
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [activeChannelType, setActiveChannelType] =
    useState<CollaborationChannelType | null>(null);

  const {
    isConnected,
    channel,
    events,
    sendEvent,
    connectionError,
    reconnect,
    disconnect,
  } = useCollaborationWebSocket({
    channelId: activeChannelId || undefined,
    channelType: activeChannelType || undefined,
    enabled: !!activeChannelId,
  });

  const setActiveChannel = useCallback(
    (channelId: string | null, channelType: CollaborationChannelType | null) => {
      setActiveChannelId(channelId);
      setActiveChannelType(channelType);
    },
    []
  );

  return (
    <CollaborationContext.Provider
      value={{
        activeChannelId,
        activeChannelType,
        setActiveChannel,
        isConnected,
        channel,
        events,
        sendEvent,
        connectionError,
        reconnect,
        disconnect,
      }}
    >
      {children}
    </CollaborationContext.Provider>
  );
}

export function useCollaboration() {
  const context = useContext(CollaborationContext);
  if (!context) {
    throw new Error("useCollaboration must be used within a CollaborationProvider");
  }
  return context;
}
