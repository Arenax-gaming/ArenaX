// Social-related types for ArenaX social features

// User status types
export type UserStatus = "online" | "in-game" | "away" | "busy" | "offline";

export interface SocialUser {
  id: string;
  username: string;
  avatar?: string;
  elo: number;
  status: UserStatus;
  lastSeen?: string;
  currentActivity?: string;
}

// Friend types
export interface Friend extends SocialUser {
  friendSince: string;
  isFavorite?: boolean;
  mutualFriends?: number;
}

export interface FriendRequest {
  id: string;
  fromUser: SocialUser;
  message?: string;
  createdAt: string;
  status: "pending" | "accepted" | "declined" | "blocked";
}

// Messaging types
export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  timestamp: string;
  status: "sent" | "delivered" | "read";
  type: "text" | "image" | "system" | "invite";
  metadata?: {
    imageUrl?: string;
    matchId?: string;
    partyId?: string;
  };
}

export interface Conversation {
  id: string;
  type: "direct" | "party" | "community";
  participants: SocialUser[];
  lastMessage?: Message;
  unreadCount: number;
  updatedAt: string;
  // For party conversations
  partyId?: string;
  // For community conversations
  communityId?: string;
}

// Party types
export interface Party {
  id: string;
  name: string;
  leaderId: string;
  members: PartyMember[];
  maxMembers: number;
  isPrivate: boolean;
  createdAt: string;
  voiceChatEnabled: boolean;
  region?: string;
}

export interface PartyMember {
  user: SocialUser;
  role: "leader" | "member";
  joinedAt: string;
  isReady: boolean;
  isSpeaking?: boolean;
}

export interface PartyInvite {
  id: string;
  partyId: string;
  partyName: string;
  inviter: SocialUser;
  invitedUser: SocialUser;
  createdAt: string;
  status: "pending" | "accepted" | "declined" | "expired";
}

// Community types
export interface CommunityPost {
  id: string;
  author: SocialUser;
  content: string;
  media?: {
    type: "image" | "video";
    url: string;
    thumbnail?: string;
  }[];
  tags: string[];
  likes: number;
  comments: number;
  shares: number;
  createdAt: string;
  isLiked?: boolean;
  isPinned?: boolean;
}

export interface CommunityComment {
  id: string;
  postId: string;
  author: SocialUser;
  content: string;
  likes: number;
  createdAt: string;
  isLiked?: boolean;
}

export interface Community {
  id: string;
  name: string;
  description: string;
  avatar?: string;
  banner?: string;
  memberCount: number;
  isPrivate: boolean;
  tags: string[];
  createdAt: string;
  rules?: string[];
}

// Notification types
export interface SocialNotification {
  id: string;
  type: "friend_request" | "message" | "party_invite" | "party_update" | "mention" | "like" | "comment";
  title: string;
  message: string;
  fromUser?: SocialUser;
  relatedId?: string; // conversationId, partyId, postId, etc.
  read: boolean;
  createdAt: string;
}

// Privacy settings
export interface SocialPrivacySettings {
  allowFriendRequests: boolean;
  showOnlineStatus: boolean;
  showGameActivity: boolean;
  allowPartyInvites: boolean;
  allowMessages: "everyone" | "friends" | "none";
  showProfile: boolean;
  blockList: string[];
}

// Social analytics
export interface SocialStats {
  totalFriends: number;
  onlineFriends: number;
  totalMessages: number;
  partiesJoined: number;
  communityPosts: number;
  totalLikes: number;
  weeklyActivity: {
    messagesSent: number;
    gamesPlayed: number;
    timeOnline: number; // in minutes
  };
}