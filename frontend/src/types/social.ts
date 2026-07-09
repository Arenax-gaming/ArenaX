export type UserStatus = 'online' | 'offline' | 'in-game' | 'away' | 'busy';

export interface SocialUser {
  id: string;
  username: string;
  avatar?: string;
  elo: number;
  status: UserStatus;
  currentActivity?: string;
  lastSeen?: string;
}

export interface Friend extends SocialUser {
  friendSince: string;
  isFavorite?: boolean;
  mutualFriends?: number;
}

export interface FriendRequest {
  id: string;
  fromUserId: string;
  fromUsername: string;
  fromUser: SocialUser;
  fromAvatar?: string;
  toUserId: string;
  status: 'pending' | 'accepted' | 'rejected';
  message?: string;
  createdAt: string;
}

export interface Message {
  id: string;
  fromUserId: string;
  fromUsername: string;
  toUserId: string;
  content: string;
  isRead: boolean;
  createdAt: string;
  // Chat-style fields — the data layer always provides these, so they're
  // required (no `?`). Keeps `Message.timestamp` / `.content` dereferences in
  // ChatInterface clean (no `?.` everywhere).
  conversationId: string;
  senderId: string;
  timestamp: string;
  status: 'sent' | 'delivered' | 'read';
  type: 'text' | 'image' | 'video' | 'system';
}

export interface Conversation {
  id: string;
  participantId: string;
  participantUsername: string;
  participantAvatar?: string;
  lastMessage?: Message;
  lastMessageAt?: string;
  unreadCount: number;
  // Chat-style fields — required because the data layer / UI both treat
  // these as always-present.
  type: 'direct' | 'group' | 'party';
  participants: SocialUser[];
  updatedAt: string;
  partyId?: string;
}

export interface Party {
  id: string;
  leaderId: string;
  leaderUsername: string;
  name: string;
  description?: string;
  maxMembers: number;
  currentMembers: number;
  members: PartyMember[];
  createdAt: string;
  // Party UX fields — data layer always supplies these.
  region: string;
  isPrivate: boolean;
  voiceChatEnabled: boolean;
}

export interface PartyMember {
  userId: string;
  username: string;
  avatarUrl?: string;
  role: 'leader' | 'member';
  joinedAt: string;
  // Party UX fields — data layer always supplies these.
  user: SocialUser;
  isReady: boolean;
  isSpeaking: boolean;
}

export interface CommunityPost {
  id: string;
  authorId: string;
  authorUsername: string;
  authorAvatar?: string;
  title?: string;
  content: string;
  category: string;
  likes: number;
  comments: number;
  shares?: number;
  isLiked: boolean;
  isPinned?: boolean;
  createdAt: string;
  tags?: string[];
  media?: PostMedia[];
  author?: {
    id: string;
    username: string;
    avatar?: string;
    elo?: number;
    status?: string;
  };
}

export interface PostMedia {
  id: string;
  url: string;
  type: 'image' | 'video';
  thumbnail?: string;
}

export interface CommunityComment {
  id: string;
  postId: string;
  author: SocialUser;
  content: string;
  likes: number;
  isLiked: boolean;
  createdAt: string;
}

export interface OnlineStatus {
  userId: string;
  username: string;
  isOnline: boolean;
  lastSeen?: string;
  statusMessage?: string;
}

export interface SocialNotification {
  id: string;
  type: 'friend_request' | 'message' | 'party_invite' | 'post_like' | 'post_comment' | 'like';
  title: string;
  message: string;
  fromUser?: SocialUser;
  userId?: string;
  fromUserId?: string;
  fromUsername?: string;
  notificationType?: string;
  content?: string;
  isRead?: boolean;
  read?: boolean;
  relatedId?: string;
  createdAt: string;
}

export interface FriendsListResponse {
  friends: Friend[];
  totalCount: number;
  onlineCount: number;
}

export interface PartyInvite {
  id: string;
  partyId: string;
  partyName: string;
  inviter: SocialUser;
  invitedUser: SocialUser;
  createdAt: string;
  status: 'pending' | 'accepted' | 'declined';
}

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
    timeOnline: number;
  };
}
