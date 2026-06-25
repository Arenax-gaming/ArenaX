export interface CursorPosition {
  x: number;
  y: number;
}

export interface RemoteCursor {
  userId: string;
  username: string;
  color: string;
  position: CursorPosition;
  lastUpdated: number;
}

export interface PresenceUser {
  userId: string;
  username: string;
  avatar?: string;
  color: string;
  status: 'online' | 'away' | 'busy' | 'offline';
  lastSeen: number;
  currentView?: string;
}

export interface CollaborativeAction {
  type: string;
  userId: string;
  payload: unknown;
  timestamp: number;
  version: number;
}

export interface ConflictResolution {
  actionId: string;
  strategy: 'lastWriteWins' | 'merge' | 'reject';
  resolved: boolean;
  timestamp: number;
}

export interface CollaborationPermissions {
  canEdit: boolean;
  canComment: boolean;
  canShare: boolean;
  canInvite: boolean;
}

export interface CollaborationState<T = unknown> {
  document: T;
  version: number;
  lastModified: number;
  modifiedBy: string;
  pendingChanges: CollaborativeAction[];
  conflicts: ConflictResolution[];
}

export interface CursorUpdate {
  userId: string;
  username: string;
  color: string;
  position: CursorPosition;
  timestamp: number;
}

export interface PresenceUpdate {
  userId: string;
  username: string;
  avatar?: string;
  color: string;
  status: 'online' | 'away' | 'busy' | 'offline';
  timestamp: number;
}
