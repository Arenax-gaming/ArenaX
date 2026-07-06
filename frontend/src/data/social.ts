import type {
  Friend,
  FriendRequest,
  Message,
  Conversation,
  Party,
  PartyInvite,
  PartyMember,
  CommunityPost,
  CommunityComment,
  SocialNotification,
  SocialUser,
  SocialStats,
} from "@/types/social";
import { currentUser } from "./user";

// Mock Social Users
export const mockSocialUsers: SocialUser[] = [
  {
    id: "user-124",
    username: "ShadowNinja",
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=ShadowNinja",
    elo: 1380,
    status: "online",
    currentActivity: "Browsing community",
  },
  {
    id: "user-125",
    username: "EliteSniper",
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=EliteSniper",
    elo: 1420,
    status: "in-game",
    currentActivity: "Playing Match",
  },
  {
    id: "user-126",
    username: "DragonSlayer",
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=DragonSlayer",
    elo: 1190,
    status: "online",
    currentActivity: "In party lobby",
  },
  {
    id: "user-127",
    username: "NightWalker",
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=NightWalker",
    elo: 1510,
    status: "offline",
    lastSeen: "2 hours ago",
  },
  {
    id: "user-128",
    username: "SpeedRunner",
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=SpeedRunner",
    elo: 1100,
    status: "offline",
    lastSeen: "1 day ago",
  },
  {
    id: "user-129",
    username: "CyberPunk",
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=CyberPunk",
    elo: 1350,
    status: "away",
    currentActivity: "AFK - Be right back",
  },
  {
    id: "user-130",
    username: "PhoenixRising",
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=PhoenixRising",
    elo: 1480,
    status: "busy",
    currentActivity: "In ranked match",
  },
  {
    id: "user-131",
    username: "StormBreaker",
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=StormBreaker",
    elo: 1290,
    status: "online",
    currentActivity: "Looking for party",
  },
];

// Mock Friends
export const mockFriends: Friend[] = [
  { ...mockSocialUsers[0], friendSince: "2026-01-15T10:00:00Z", isFavorite: true, mutualFriends: 5 },
  { ...mockSocialUsers[1], friendSince: "2026-01-20T14:30:00Z", mutualFriends: 3 },
  { ...mockSocialUsers[2], friendSince: "2026-02-01T09:15:00Z", isFavorite: true, mutualFriends: 8 },
  { ...mockSocialUsers[3], friendSince: "2026-02-10T16:45:00Z", mutualFriends: 2 },
  { ...mockSocialUsers[4], friendSince: "2026-02-15T11:20:00Z", mutualFriends: 1 },
  { ...mockSocialUsers[5], friendSince: "2026-02-20T08:00:00Z", mutualFriends: 4 },
  { ...mockSocialUsers[6], friendSince: "2026-03-01T13:30:00Z", isFavorite: false, mutualFriends: 6 },
  { ...mockSocialUsers[7], friendSince: "2026-03-05T17:00:00Z", mutualFriends: 2 },
];

// Helper to lift a SocialUser into FriendRequest's denormalized fields.
const denormFromUser = (user: SocialUser) => ({
  fromUserId: user.id,
  fromUsername: user.username,
  fromAvatar: user.avatar,
});

// Mock Friend Requests
export const mockFriendRequests: FriendRequest[] = [
  {
    id: "req-1",
    ...denormFromUser({
      id: "user-200",
      username: "GhostReaper",
      avatar:
        "https://api.dicebear.com/7.x/avataaars/svg?seed=GhostReaper",
      elo: 1320,
      status: "online",
    }),
    fromUser: {
      id: "user-200",
      username: "GhostReaper",
      avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=GhostReaper",
      elo: 1320,
      status: "online",
    },
    toUserId: currentUser.id,
    message: "Hey! I saw you in the leaderboard, would love to play together!",
    createdAt: "2026-03-10T10:30:00Z",
    status: "pending",
  },
  {
    id: "req-2",
    ...denormFromUser({
      id: "user-201",
      username: "PixelWarrior",
      avatar:
        "https://api.dicebear.com/7.x/avataaars/svg?seed=PixelWarrior",
      elo: 1150,
      status: "offline",
      lastSeen: "5 hours ago",
    }),
    fromUser: {
      id: "user-201",
      username: "PixelWarrior",
      avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=PixelWarrior",
      elo: 1150,
      status: "offline",
      lastSeen: "5 hours ago",
    },
    toUserId: currentUser.id,
    createdAt: "2026-03-09T15:45:00Z",
    status: "pending",
  },
];

// Helper to build a chat-style Message object carrying both the new
// (conversationId/senderId/timestamp) and legacy (fromUserId/toUserId/isRead)
// fields so Message's tightened contract accepts the mock data.
const chatMessage = (m: {
  id: string;
  conversationId: string;
  senderId: string;
  senderUsername: string;
  content: string;
  timestamp: string;
  status: Message["status"];
  type?: Message["type"];
  isRead?: boolean;
}): Message => ({
  id: m.id,
  conversationId: m.conversationId,
  senderId: m.senderId,
  fromUserId: m.senderId,
  fromUsername: m.senderUsername,
  content: m.content,
  timestamp: m.timestamp,
  createdAt: m.timestamp,
  status: m.status,
  type: m.type ?? "text",
  toUserId: m.senderId === currentUser.id ? "user-124" : currentUser.id,
  isRead: m.isRead ?? m.status === "read",
});

// Mock Conversations
export const mockConversations: Conversation[] = [
  {
    id: "conv-1",
    participantId: mockSocialUsers[0].id,
    participantUsername: mockSocialUsers[0].username,
    participantAvatar: mockSocialUsers[0].avatar,
    type: "direct",
    participants: [mockSocialUsers[0]],
    unreadCount: 2,
    updatedAt: "2026-03-10T11:30:00Z",
    lastMessage: chatMessage({
      id: "msg-10",
      conversationId: "conv-1",
      senderId: mockSocialUsers[0].id,
      senderUsername: mockSocialUsers[0].username,
      content: "Hey! Are you ready for the tournament tonight?",
      timestamp: "2026-03-10T11:30:00Z",
      status: "delivered",
    }),
  },
  {
    id: "conv-2",
    participantId: mockSocialUsers[2].id,
    participantUsername: mockSocialUsers[2].username,
    participantAvatar: mockSocialUsers[2].avatar,
    type: "direct",
    participants: [mockSocialUsers[2]],
    unreadCount: 0,
    updatedAt: "2026-03-10T09:15:00Z",
    lastMessage: chatMessage({
      id: "msg-20",
      conversationId: "conv-2",
      senderId: currentUser.id,
      senderUsername: currentUser.username,
      content: "GG! That was an amazing match!",
      timestamp: "2026-03-10T09:15:00Z",
      status: "read",
    }),
  },
  {
    id: "conv-3",
    participantId: "party-1",
    participantUsername: "Elite Squad",
    type: "party",
    participants: [
      mockSocialUsers[0],
      mockSocialUsers[1],
      mockSocialUsers[2],
    ],
    unreadCount: 5,
    updatedAt: "2026-03-10T12:00:00Z",
    partyId: "party-1",
    lastMessage: chatMessage({
      id: "msg-30",
      conversationId: "conv-3",
      senderId: mockSocialUsers[1].id,
      senderUsername: mockSocialUsers[1].username,
      content: "Let's queue up in 10 minutes!",
      timestamp: "2026-03-10T12:00:00Z",
      status: "delivered",
    }),
  },
];

// Mock Messages for a conversation
export const mockMessages: Message[] = [
  chatMessage({
    id: "msg-1",
    conversationId: "conv-1",
    senderId: mockSocialUsers[0].id,
    senderUsername: mockSocialUsers[0].username,
    content: "Hey! How's it going?",
    timestamp: "2026-03-10T10:00:00Z",
    status: "read",
    isRead: true,
  }),
  chatMessage({
    id: "msg-2",
    conversationId: "conv-1",
    senderId: currentUser.id,
    senderUsername: currentUser.username,
    content: "Pretty good! Just finished a ranked match. You?",
    timestamp: "2026-03-10T10:02:00Z",
    status: "read",
    isRead: true,
  }),
  chatMessage({
    id: "msg-3",
    conversationId: "conv-1",
    senderId: mockSocialUsers[0].id,
    senderUsername: mockSocialUsers[0].username,
    content: "Same here! Won my last two games. Want to duo queue?",
    timestamp: "2026-03-10T10:05:00Z",
    status: "read",
    isRead: true,
  }),
  chatMessage({
    id: "msg-4",
    conversationId: "conv-1",
    senderId: currentUser.id,
    senderUsername: currentUser.username,
    content: "Sure! Give me a few minutes to finish up here.",
    timestamp: "2026-03-10T10:07:00Z",
    status: "read",
    isRead: true,
  }),
  chatMessage({
    id: "msg-5",
    conversationId: "conv-1",
    senderId: mockSocialUsers[0].id,
    senderUsername: mockSocialUsers[0].username,
    content: "No rush! I'll be waiting.",
    timestamp: "2026-03-10T10:08:00Z",
    status: "read",
    isRead: true,
  }),
  chatMessage({
    id: "msg-10",
    conversationId: "conv-1",
    senderId: mockSocialUsers[0].id,
    senderUsername: mockSocialUsers[0].username,
    content: "Hey! Are you ready for the tournament tonight?",
    timestamp: "2026-03-10T11:30:00Z",
    status: "delivered",
    isRead: false,
  }),
];

// Helper to build a PartyMember that satisfies both the new user/isReady/
// isSpeaking fields and the legacy userId/username fields.
const partyMember = (
  user: SocialUser,
  role: "leader" | "member",
  joinedAt: string,
  isReady: boolean,
): PartyMember["userId"] extends string
  ? {
      userId: string;
      username: string;
      avatarUrl?: string;
      role: "leader" | "member";
      joinedAt: string;
      user: SocialUser;
      isReady: boolean;
      isSpeaking: boolean;
    }
  : never => ({
  userId: user.id,
  username: user.username,
  avatarUrl: user.avatar,
  role,
  joinedAt,
  user,
  isReady,
  isSpeaking: false,
});

// Mock Party
export const mockParty: Party = {
  id: "party-1",
  name: "Elite Squad",
  leaderId: currentUser.id,
  leaderUsername: currentUser.username,
  members: [
    partyMember({ ...currentUser, status: "online" }, "leader", "2026-03-10T08:00:00Z", true),
    partyMember(mockSocialUsers[0], "member", "2026-03-10T08:15:00Z", true),
    partyMember(mockSocialUsers[2], "member", "2026-03-10T08:30:00Z", false),
  ],
  maxMembers: 5,
  currentMembers: 3,
  isPrivate: false,
  createdAt: "2026-03-10T08:00:00Z",
  voiceChatEnabled: true,
  region: "NA-East",
};

// Mock Party Invites
export const mockPartyInvites: PartyInvite[] = [
  {
    id: "pinv-1",
    partyId: "party-2",
    partyName: "Night Owls",
    inviter: mockSocialUsers[3],
    invitedUser: { ...currentUser, status: "online" },
    createdAt: "2026-03-10T10:00:00Z",
    status: "pending",
  },
];

// Helper to build a CommunityPost with both `author` object and
// `authorId`/`authorUsername`/`category` required fields.
const communityPost = (
  p: {
    id: string;
    author: SocialUser;
    content: string;
    tags?: string[];
    likes: number;
    comments: number;
    shares?: number;
    createdAt: string;
    isLiked: boolean;
    isPinned: boolean;
    category: string;
    media?: CommunityPost["media"];
  },
): CommunityPost => ({
  id: p.id,
  authorId: p.author.id,
  authorUsername: p.author.username,
  authorAvatar: p.author.avatar,
  author: p.author,
  content: p.content,
  category: p.category,
  tags: p.tags,
  likes: p.likes,
  comments: p.comments,
  shares: p.shares,
  isLiked: p.isLiked,
  isPinned: p.isPinned,
  createdAt: p.createdAt,
  media: p.media,
});

// Mock Community Posts
export const mockCommunityPosts: CommunityPost[] = [
  communityPost({
    id: "post-1",
    author: mockSocialUsers[6],
    content:
      "Just hit 1500 ELO! Thanks to everyone who helped me improve. Special shoutout to my duo partner @ShadowNinja for all the practice sessions! 🎉",
    tags: ["milestone", "celebration", "ranked"],
    likes: 42,
    comments: 12,
    shares: 3,
    createdAt: "2026-03-10T09:00:00Z",
    isLiked: false,
    isPinned: false,
    category: "milestone",
  }),
  communityPost({
    id: "post-2",
    author: mockSocialUsers[1],
    content:
      "Looking for serious players to form a competitive team. Must have 1400+ ELO and be available for practice 3x per week. DM me if interested!",
    tags: ["recruitment", "competitive", "team"],
    likes: 28,
    comments: 15,
    shares: 8,
    createdAt: "2026-03-09T16:30:00Z",
    isLiked: true,
    isPinned: true,
    category: "recruitment",
  }),
  communityPost({
    id: "post-3",
    author: mockSocialUsers[2],
    content:
      "New strategy guide just dropped! Check out my latest video on advanced positioning techniques. Link in bio!",
    media: [
      {
        id: "media-3-1",
        type: "image",
        url: "https://placehold.co/800x400/1a1a2e/00d4ff?text=Strategy+Guide+Thumbnail",
        thumbnail:
          "https://placehold.co/400x200/1a1a2e/00d4ff?text=Thumbnail",
      },
    ],
    tags: ["guide", "strategy", "video"],
    likes: 67,
    comments: 23,
    shares: 15,
    createdAt: "2026-03-08T14:00:00Z",
    isLiked: false,
    isPinned: false,
    category: "guide",
  }),
  communityPost({
    id: "post-4",
    author: mockSocialUsers[7],
    content:
      "Tournament tonight at 8PM EST! Prize pool is 5000 AX tokens. Register now through the tournaments page. Good luck to all participants! 🏆",
    tags: ["tournament", "announcement", "esports"],
    likes: 156,
    comments: 45,
    shares: 32,
    createdAt: "2026-03-10T08:00:00Z",
    isLiked: true,
    isPinned: true,
    category: "tournament",
  }),
];

// Mock Comments
export const mockComments: CommunityComment[] = [
  {
    id: "comment-1",
    postId: "post-1",
    author: mockSocialUsers[0],
    content: "Congratulations! Well deserved! 🎊",
    likes: 8,
    createdAt: "2026-03-10T09:15:00Z",
    isLiked: true,
  },
  {
    id: "comment-2",
    postId: "post-1",
    author: mockSocialUsers[2],
    content: "Let's gooo! Next stop 2000 ELO! 💪",
    likes: 5,
    createdAt: "2026-03-10T09:30:00Z",
    isLiked: false,
  },
];

// Mock Social Notifications
export const mockNotifications: SocialNotification[] = [
  {
    id: "notif-1",
    type: "friend_request",
    title: "New Friend Request",
    message: "GhostReaper wants to add you as a friend",
    fromUser: {
      id: "user-200",
      username: "GhostReaper",
      avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=GhostReaper",
      elo: 1320,
      status: "online",
    },
    relatedId: "req-1",
    read: false,
    createdAt: "2026-03-10T10:30:00Z",
  },
  {
    id: "notif-2",
    type: "message",
    title: "New Message",
    message: "ShadowNinja: Hey! Are you ready for the tournament tonight?",
    fromUser: mockSocialUsers[0],
    relatedId: "conv-1",
    read: false,
    createdAt: "2026-03-10T11:30:00Z",
  },
  {
    id: "notif-3",
    type: "party_invite",
    title: "Party Invitation",
    message: "NightWalker invited you to join 'Night Owls'",
    fromUser: mockSocialUsers[3],
    relatedId: "pinv-1",
    read: false,
    createdAt: "2026-03-10T10:00:00Z",
  },
  {
    id: "notif-4",
    type: "like",
    title: "New Like",
    message: "EliteSniper liked your post",
    fromUser: mockSocialUsers[1],
    relatedId: "post-1",
    read: true,
    createdAt: "2026-03-09T18:00:00Z",
  },
];

// Mock Social Stats
export const mockSocialStats: SocialStats = {
  totalFriends: mockFriends.length,
  onlineFriends: mockFriends.filter((f) => f.status !== "offline").length,
  totalMessages: 156,
  partiesJoined: 12,
  communityPosts: 8,
  totalLikes: 45,
  weeklyActivity: {
    messagesSent: 42,
    gamesPlayed: 15,
    timeOnline: 1280,
  },
};
