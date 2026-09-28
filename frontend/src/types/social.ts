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
  fromUser: SocialUser
  message?: string
  toUserId?: string
  status: 'pending' | 'accepted' | 'rejected'
  createdAt: string
}

export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'read'
export type MessageType = 'text' | 'image' | 'system'

export interface Message {
  id: string
  conversationId: string
  senderId: string
  content: string
  timestamp: string
  status: MessageStatus
  type: MessageType
}

export type ConversationType = 'direct' | 'party'

export interface Conversation {
  id: string
  type: ConversationType
  participants: SocialUser[]
  unreadCount: number
  updatedAt: string
  lastMessage?: Message
  partyId?: string
}

export interface PartyMember {
  user: SocialUser
  role: 'leader' | 'member'
  joinedAt: string
  isReady?: boolean
  isSpeaking?: boolean
}

export interface Party {
  id: string
  leaderId: string
  name: string
  description?: string
  maxMembers: number
  currentMembers?: number
  members: PartyMember[]
  isPrivate?: boolean
  voiceChatEnabled?: boolean
  region?: string
  createdAt: string
}

export interface PartyInvite {
  id: string
  partyId: string
  partyName: string
  inviter: SocialUser
  invitedUser: SocialUser
  createdAt: string
  status: 'pending' | 'accepted' | 'rejected'
}

export interface CommunityPost {
  id: string
  author: SocialUser
  authorId?: string
  authorUsername?: string
  authorAvatar?: string
  title?: string
  content: string
  category?: string
  likes: number
  comments: number
  shares?: number
  isLiked: boolean
  isPinned?: boolean
  createdAt: string
  tags?: string[]
  media?: PostMedia[]
}

export interface PostMedia {
  id?: string
  url: string
  type: 'image' | 'video'
  thumbnail?: string
}

export interface CommunityComment {
  id: string
  postId: string
  author: SocialUser
  authorId?: string
  authorUsername?: string
  authorAvatar?: string
  content: string
  likes: number
  isLiked: boolean
  createdAt: string
}

export type SocialNotificationType = 'friend_request' | 'message' | 'party_invite' | 'like' | 'post_like' | 'post_comment'

export interface SocialNotification {
  id: string
  type: SocialNotificationType
  title: string
  message: string
  fromUser: SocialUser
  relatedId?: string
  read: boolean
  createdAt: string
}

export interface SocialStats {
  totalFriends: number
  onlineFriends: number
  totalMessages: number
  partiesJoined: number
  communityPosts: number
  totalLikes: number
  weeklyActivity: {
    messagesSent: number
    gamesPlayed: number
    timeOnline: number
  }
}

export interface OnlineStatus {
  userId: string
  username: string
  isOnline: boolean
  lastSeen?: string
  statusMessage?: string
}

export interface FriendsListResponse {
  friends: Friend[]
  totalCount: number
  onlineCount: number
}
