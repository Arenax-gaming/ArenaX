'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  RemoteCursor,
  PresenceUser,
  CollaborativeAction,
  CollaborationState,
  ConflictResolution,
  CursorPosition,
} from '@/types/collaboration';

const USER_COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
  '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F',
];

function getRandomColor(): string {
  return USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)];
}

interface UseCollaborationOptions {
  documentId: string;
  userId: string;
  username: string;
  wsUrl?: string;
}

export function useCollaboration({ documentId, userId, username, wsUrl }: UseCollaborationOptions) {
  const [cursors, setCursors] = useState<Map<string, RemoteCursor>>(new Map());
  const [presence, setPresence] = useState<Map<string, PresenceUser>>(new Map());
  const [state, setState] = useState<CollaborationState>({
    document: null,
    version: 0,
    lastModified: Date.now(),
    modifiedBy: userId,
    pendingChanges: [],
    conflicts: [],
  });
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permissions, setPermissions] = useState({ canEdit: true, canComment: true, canShare: true, canInvite: false });

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userColor = useRef(getRandomColor());
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const connect = useCallback(() => {
    if (!wsUrl) return;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        setError(null);
        sendPresence(ws, userId, username, userColor.current);

        heartbeatRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 30000);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          handleMessage(data);
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        if (heartbeatRef.current) clearInterval(heartbeatRef.current);
        reconnectTimeoutRef.current = setTimeout(() => connect(), 3000);
      };

      ws.onerror = () => {
        setError('WebSocket connection error');
      };
    } catch {
      setError('Failed to create WebSocket connection');
    }
  }, [wsUrl, userId, username]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
    setCursors(new Map());
    setPresence(new Map());
  }, []);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  const handleMessage = useCallback((data: Record<string, any>) => {
    switch (data.type) {
      case 'cursor:update': {
        setCursors(prev => {
          const next = new Map(prev);
          next.set(data.userId, {
            userId: data.userId,
            username: data.username,
            color: data.color,
            position: data.position,
            lastUpdated: Date.now(),
          });
          return next;
        });
        break;
      }
      case 'presence:update': {
        setPresence(prev => {
          const next = new Map(prev);
          next.set(data.userId, {
            userId: data.userId,
            username: data.username,
            avatar: data.avatar,
            color: data.color,
            status: data.status,
            lastSeen: Date.now(),
            currentView: data.currentView,
          });
          return next;
        });
        break;
      }
      case 'presence:leave': {
        setPresence(prev => {
          const next = new Map(prev);
          next.delete(data.userId);
          return next;
        });
        setCursors(prev => {
          const next = new Map(prev);
          next.delete(data.userId);
          return next;
        });
        break;
      }
      case 'state:update': {
        setState(prev => ({
          ...prev,
          document: data.document,
          version: data.version,
          lastModified: data.timestamp,
          modifiedBy: data.modifiedBy,
        }));
        break;
      }
      case 'collaborative:action': {
        setState(prev => ({
          ...prev,
          pendingChanges: [...prev.pendingChanges, {
            type: data.action,
            userId: data.userId,
            payload: data.payload,
            timestamp: data.timestamp,
            version: data.version,
          }],
        }));
        break;
      }
      case 'conflict:resolved': {
        setState(prev => ({
          ...prev,
          conflicts: [...prev.conflicts, {
            actionId: data.actionId,
            strategy: data.strategy,
            resolved: true,
            timestamp: Date.now(),
          }],
        }));
        break;
      }
      case 'permissions:update': {
        setPermissions(data.permissions);
        break;
      }
    }
  }, []);

  const sendCursorUpdate = useCallback((position: CursorPosition | null) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    wsRef.current.send(JSON.stringify({
      type: 'cursor:update',
      userId,
      username,
      color: userColor.current,
      position,
      timestamp: Date.now(),
    }));
  }, [userId, username]);

  const sendPresence = useCallback((ws: WebSocket, uid: string, uname: string, color: string) => {
    ws.send(JSON.stringify({
      type: 'presence:update',
      userId: uid,
      username: uname,
      color,
      status: 'online',
      timestamp: Date.now(),
    }));
  }, []);

  const updatePresence = useCallback((status: PresenceUser['status']) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    wsRef.current.send(JSON.stringify({
      type: 'presence:update',
      userId,
      username,
      color: userColor.current,
      status,
      timestamp: Date.now(),
    }));
  }, [userId, username]);

  const sendCollaborativeAction = useCallback((action: string, payload: unknown) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    wsRef.current.send(JSON.stringify({
      type: 'collaborative:action',
      userId,
      action,
      payload,
      timestamp: Date.now(),
      version: state.version + 1,
    }));

    setState(prev => ({
      ...prev,
      version: prev.version + 1,
      lastModified: Date.now(),
      modifiedBy: userId,
    }));
  }, [userId, state.version]);

  return {
    cursors: Array.from(cursors.values()),
    presence: Array.from(presence.values()),
    state,
    permissions,
    isConnected,
    error,
    userColor: userColor.current,
    sendCursorUpdate,
    updatePresence,
    sendCollaborativeAction,
    connect,
    disconnect,
  };
}
