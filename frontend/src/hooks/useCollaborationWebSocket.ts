"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  CollaborationChannel,
  CollaborationEvent,
  CollaborationUser,
} from "@/types/collaboration";
import {
  CollaborationChannelType,
  CollaborationEventType,
} from "@/types/collaboration";
import { mockSocialUsers } from "@/data/social";
import { currentUser } from "@/data/user";

interface UseCollaborationWebSocketOptions {
  channelId?: string;
  channelType?: CollaborationChannelType;
  enabled?: boolean;
}

interface UseCollaborationWebSocketReturn {
  isConnected: boolean;
  channel: CollaborationChannel | null;
  events: CollaborationEvent[];
  sendEvent: (event: Omit<CollaborationEvent, "timestamp" | "userId">) => void;
  connectionError: string | null;
  reconnect: () => void;
  disconnect: () => void;
}

// Mock data for demonstration
const mockChannelBase: CollaborationChannel = {
  id: "collab-channel-1",
  type: CollaborationChannelType.TOURNAMENT_COVIEW,
  name: "Tournament #1 Viewing Party",
  users: [],
  createdAt: Date.now(),
  createdBy: currentUser.id,
  tournamentId: "tournament-1",
};

export function useCollaborationWebSocket({
  channelId,
  channelType,
  enabled = true,
}: UseCollaborationWebSocketOptions): UseCollaborationWebSocketReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [channel, setChannel] = useState<CollaborationChannel | null>(null);
  const [events, setEvents] = useState<CollaborationEvent[]>([]);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const closedRef = useRef(false);

  // Mock initial channel and users
  const initialChannel = useMemo(() => {
    if (!channelId || !channelType) return null;

    const users: CollaborationUser[] = [
      {
        id: currentUser.id,
        username: currentUser.username,
        avatar: currentUser.avatar,
        status: "online",
        isReady: true,
      },
    ];

    // Add some mock users
    const mockUsersToAdd = [mockSocialUsers[0], mockSocialUsers[2]];
    mockUsersToAdd.forEach((user) => {
      users.push({
        id: user.id,
        username: user.username,
        avatar: user.avatar,
        status: user.status,
        isReady: Math.random() > 0.5,
      });
    });

    return {
      ...mockChannelBase,
      id: channelId,
      type: channelType,
      users,
    } as CollaborationChannel;
  }, [channelId, channelType]);

  // Helper to send mock events (for demo purposes)
  const sendMockEvent = useCallback(() => {
    if (!initialChannel) return;

    const eventTypes = [
      CollaborationEventType.USER_JOINED,
      CollaborationEventType.MESSAGE,
      CollaborationEventType.COVIEW_POSITION,
    ];
    const randomType = eventTypes[Math.floor(Math.random() * eventTypes.length)];
    const randomUser = mockSocialUsers[Math.floor(Math.random() * mockSocialUsers.length)];

    let newEvent: CollaborationEvent;

    switch (randomType) {
      case CollaborationEventType.USER_JOINED:
        newEvent = {
          type: CollaborationEventType.USER_JOINED,
          channelId: initialChannel.id,
          timestamp: Date.now(),
          userId: randomUser.id,
          user: {
            id: randomUser.id,
            username: randomUser.username,
            avatar: randomUser.avatar,
            status: randomUser.status,
          },
        };
        break;
      case CollaborationEventType.MESSAGE:
        newEvent = {
          type: CollaborationEventType.MESSAGE,
          channelId: initialChannel.id,
          timestamp: Date.now(),
          userId: randomUser.id,
          content: ["Let's go!", "GG!", "Nice shot!", "Wow!"][Math.floor(Math.random() * 4)],
          messageId: `msg-${Date.now()}`,
        };
        break;
      case CollaborationEventType.COVIEW_POSITION:
        newEvent = {
          type: CollaborationEventType.COVIEW_POSITION,
          channelId: initialChannel.id,
          timestamp: Date.now(),
          userId: randomUser.id,
          tournamentId: initialChannel.tournamentId || "",
          matchId: Math.random() > 0.5 ? "match-1" : undefined,
        };
        break;
      default:
        return;
    }

    setEvents((prev) => [newEvent, ...prev].slice(0, 50));
  }, [initialChannel]);

  const connect = useCallback(() => {
    if (!enabled || !initialChannel) {
      return;
    }

    closedRef.current = false;

    // Mock WebSocket connection (for demo)
    setTimeout(() => {
      if (closedRef.current) return;

      setIsConnected(true);
      setChannel(initialChannel);
      setConnectionError(null);
    }, 800);

    return () => {
      // Cleanup
    };
  }, [enabled, initialChannel]);

  const disconnect = useCallback(() => {
    closedRef.current = true;
    setIsConnected(false);
    setChannel(null);
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const reconnect = useCallback(() => {
    disconnect();
    connect();
  }, [connect, disconnect]);

  const sendEvent = useCallback(
    (event: Omit<CollaborationEvent, "timestamp" | "userId">) => {
      if (!initialChannel) return;

      const fullEvent: CollaborationEvent = {
        ...event,
        timestamp: Date.now(),
        userId: currentUser.id,
      } as CollaborationEvent;

      setEvents((prev) => [fullEvent, ...prev].slice(0, 50));
    },
    [initialChannel]
  );

  useEffect(() => {
    if (enabled && initialChannel) {
      const cleanup = connect();
      return () => {
        cleanup?.();
        disconnect();
      };
    }
    disconnect();
  }, [connect, disconnect, enabled, initialChannel]);

  // Simulate random events for demo purposes
  useEffect(() => {
    if (!isConnected) return;

    const interval = setInterval(() => {
      if (Math.random() > 0.7) {
        sendMockEvent();
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [isConnected, sendMockEvent]);

  return {
    isConnected,
    channel,
    events,
    sendEvent,
    connectionError,
    reconnect,
    disconnect,
  };
}
