export type UserStatus = 'online' | 'offline' | 'in-game' | 'away' | 'busy'

export interface SocialUser {
  id: string
  username: string
  avatar?: string
  elo: number
  status: UserStatus
  currentActivity?: string
  lastSeen?: string
}

export interface Friend extends SocialUser {
  friendSince: string
  isFavorite?: boolean
  mutualFriends?: number
}

export interface FriendRequest {
  id: string
  fromUserId: string
  fromUsername: string
  fromAvatar?: string
  toUserId: string
  status: 'pending' | 'accepted' | 'rejected'
  createdAt: string
}

export interface Message {
  id: string
  fromUserId: string
  fromUsername: string
  toUserId: string
  content: string
  isRead: boolean
  createdAt: string
}

export interface Conversation {
  id: string
  participantId: string
  participantUsername: string
  participantAvatar?: string
  lastMessage?: string
  lastMessageAt?: string
  unreadCount: number
}

export interface Party {
  id: string
  leaderId: string
  leaderUsername: string
  name: string
  description?: string
  maxMembers: number
  currentMembers: number
  members: PartyMember[]
  createdAt: string
}

export interface PartyMember {
  userId: string
  username: string
  avatarUrl?: string
  role: 'leader' | 'member'
  joinedAt: string
}

export interface CommunityPost {
  id: string
  authorId: string
  authorUsername: string
  authorAvatar?: string
  title: string
  content: string
  category: string
  likes: number
  comments: number
  isLiked: boolean
  createdAt: string
}

export interface OnlineStatus {
  userId: string
  username: string
  isOnline: boolean
  lastSeen?: string
  statusMessage?: string
}

export interface SocialNotification {
  id: string
  userId: string
  notificationType: 'friend_request' | 'message' | 'party_invite' | 'post_like' | 'post_comment'
  fromUserId?: string
  fromUsername?: string
  content: string
  isRead: boolean
  createdAt: string
}

export interface FriendsListResponse {
  friends: Friend[]
  totalCount: number
  onlineCount: number
}
