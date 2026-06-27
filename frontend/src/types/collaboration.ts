<<<<<<< HEAD
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
=======
import type { Party, PartyMember, SocialUser } from "./social";

export enum CollaborationChannelType {
  PARTY = "party",
  TOURNAMENT_COVIEW = "tournament_coview",
  SHARED_DASHBOARD = "shared_dashboard",
}

export enum CollaborationEventType {
  USER_JOINED = "user_joined",
  USER_LEFT = "user_left",
  STATE_UPDATE = "state_update",
  MESSAGE = "message",
  READY_CHANGED = "ready_changed",
  LEADER_CHANGED = "leader_changed",
  COVIEW_POSITION = "coview_position",
  DASHBOARD_UPDATE = "dashboard_update",
}

export interface CollaborationUser {
  id: string;
  username: string;
  avatar?: string;
  status: string;
  isReady?: boolean;
}

export interface CollaborationEventBase {
  type: CollaborationEventType;
  channelId: string;
  timestamp: number;
  userId: string;
}

export interface UserJoinedEvent extends CollaborationEventBase {
  type: CollaborationEventType.USER_JOINED;
  user: CollaborationUser;
}

export interface UserLeftEvent extends CollaborationEventBase {
  type: CollaborationEventType.USER_LEFT;
  userId: string;
}

export interface CoviewPositionEvent extends CollaborationEventBase {
  type: CollaborationEventType.COVIEW_POSITION;
  tournamentId: string;
  matchId?: string;
  scrollPosition?: number;
}

export interface StateUpdateEvent extends CollaborationEventBase {
  type: CollaborationEventType.STATE_UPDATE;
  state: Record<string, any>;
}

export interface MessageEvent extends CollaborationEventBase {
  type: CollaborationEventType.MESSAGE;
  content: string;
  messageId: string;
}

export interface ReadyChangedEvent extends CollaborationEventBase {
  type: CollaborationEventType.READY_CHANGED;
  userId: string;
  isReady: boolean;
}

export interface LeaderChangedEvent extends CollaborationEventBase {
  type: CollaborationEventType.LEADER_CHANGED;
  newLeaderId: string;
}

export interface DashboardUpdateEvent extends CollaborationEventBase {
  type: CollaborationEventType.DASHBOARD_UPDATE;
  widgetId: string;
  widgetData: any;
}

export type CollaborationEvent =
  | UserJoinedEvent
  | UserLeftEvent
  | CoviewPositionEvent
  | StateUpdateEvent
  | MessageEvent
  | ReadyChangedEvent
  | LeaderChangedEvent
  | DashboardUpdateEvent;

export interface CollaborationChannel {
  id: string;
  type: CollaborationChannelType;
  name?: string;
  users: CollaborationUser[];
  createdAt: number;
  createdBy: string;
  tournamentId?: string;
  partyId?: string;
>>>>>>> upstream/main
}
