"use client";

import { useState, useCallback } from "react";
import type {
  Friend,
  FriendRequest,
  Message,
  Conversation,
  Party,
  PartyInvite,
  CommunityPost,
  CommunityComment,
  SocialNotification,
  SocialUser,
  UserStatus,
  SocialPrivacySettings,
} from "@/types/social";
import {
  mockFriends,
  mockFriendRequests,
  mockConversations,
  mockMessages,
  mockParty,
  mockPartyInvites,
  mockCommunityPosts,
  mockNotifications,
  mockSocialUsers,
} from "@/data/social";

// Helper to format relative time
function formatRelativeTime(date: string): string {
  const now = new Date();
  const then = new Date(date);
  const diffMs = now.getTime() - then.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return then.toLocaleDateString();
}

export function useSocial() {
  // Friends state
  const [friends, setFriends] = useState<Friend[]>(mockFriends);
  const [friendRequests, setFriendRequests] = useState<FriendRequest[]>(mockFriendRequests);
  const [searchQuery, setSearchQuery] = useState("");

  // Conversations state
  const [conversations, setConversations] = useState<Conversation[]>(mockConversations);
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>(
    activeConversation ? mockMessages.filter(m => m.conversationId === activeConversation.id) : []
  );
  const [isTyping, setIsTyping] = useState(false);

  // Party state
  const [party, setParty] = useState<Party | null>(mockParty);
  const [partyInvites, setPartyInvites] = useState<PartyInvite[]>(mockPartyInvites);

  // Community state
  const [posts, setPosts] = useState<CommunityPost[]>(mockCommunityPosts);
  const [notifications, setNotifications] = useState<SocialNotification[]>(mockNotifications);

  // Privacy settings state
  const [privacySettings, setPrivacySettings] = useState<SocialPrivacySettings>({
    allowFriendRequests: true,
    showOnlineStatus: true,
    showGameActivity: true,
    allowPartyInvites: true,
    allowMessages: "friends",
    showProfile: true,
    blockList: [],
  });

  // User status
  const [userStatus, setUserStatus] = useState<UserStatus>("online");

  // Filtered friends based on search
  const filteredFriends = friends.filter(f =>
    f.username.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Online friends
  const onlineFriends = friends.filter(f => f.status !== "offline");

  // Unread notification count
  const unreadNotificationCount = notifications.filter(n => !n.read).length;

  // Friend management functions
  const acceptFriendRequest = useCallback((requestId: string) => {
    const request = friendRequests.find(r => r.id === requestId);
    if (!request) return;

    const newFriend: Friend = {
      ...request.fromUser,
      friendSince: new Date().toISOString(),
      mutualFriends: 0,
    };

    setFriends(prev => [...prev, newFriend]);
    setFriendRequests(prev => prev.filter(r => r.id !== requestId));
  }, [friendRequests]);

  const declineFriendRequest = useCallback((requestId: string) => {
    setFriendRequests(prev => prev.filter(r => r.id !== requestId));
  }, []);

  const removeFriend = useCallback((friendId: string) => {
    setFriends(prev => prev.filter(f => f.id !== friendId));
  }, []);

  const blockUser = useCallback((userId: string) => {
    setPrivacySettings(prev => ({
      ...prev,
      blockList: [...prev.blockList, userId],
    }));
    setFriends(prev => prev.filter(f => f.id !== userId));
  }, []);

  const sendFriendRequest = useCallback((user: SocialUser, message?: string) => {
    const newRequest: FriendRequest = {
      id: `req-${Date.now()}`,
      fromUser: user,
      message,
      createdAt: new Date().toISOString(),
      status: "pending",
    };
    // In real app, this would be sent to the server
    console.log("Friend request sent:", newRequest);
  }, []);

  // Messaging functions
  const sendMessage = useCallback((content: string) => {
    if (!activeConversation) return;

    const newMessage: Message = {
      id: `msg-${Date.now()}`,
      conversationId: activeConversation.id,
      senderId: "user-123", // Current user
      content,
      timestamp: new Date().toISOString(),
      status: "sent",
      type: "text",
    };

    setMessages(prev => [...prev, newMessage]);

    // Update conversation's last message
    setConversations(prev =>
      prev.map(conv =>
        conv.id === activeConversation.id
          ? { ...conv, lastMessage: newMessage, updatedAt: newMessage.timestamp }
          : conv
      )
    );

    // Simulate typing indicator and response
    setTimeout(() => setIsTyping(true), 1000);
    setTimeout(() => setIsTyping(false), 3000);
  }, [activeConversation]);

  const selectConversation = useCallback((conversation: Conversation) => {
    setActiveConversation(conversation);
    const convMessages = mockMessages.filter(m => m.conversationId === conversation.id);
    setMessages(convMessages);

    // Mark as read
    setConversations(prev =>
      prev.map(conv =>
        conv.id === conversation.id ? { ...conv, unreadCount: 0 } : conv
      )
    );
  }, []);

  // Party management functions
  const createParty = useCallback((name: string, isPrivate = false) => {
    const newParty: Party = {
      id: `party-${Date.now()}`,
      name,
      leaderId: "user-123",
      members: [
        {
          user: { id: "user-123", username: "ProGamer99", elo: 1250, status: "online" },
          role: "leader",
          joinedAt: new Date().toISOString(),
          isReady: true,
        },
      ],
      maxMembers: 5,
      isPrivate,
      createdAt: new Date().toISOString(),
      voiceChatEnabled: false,
      region: "NA-East",
    };
    setParty(newParty);
  }, []);

  const disbandParty = useCallback(() => {
    setParty(null);
  }, []);

  const inviteToParty = useCallback((userId: string) => {
    // In real app, send invite to server
    console.log("Inviting to party:", userId);
  }, []);

  const kickFromParty = useCallback((userId: string) => {
    if (!party) return;
    setParty(prev =>
      prev
        ? { ...prev, members: prev.members.filter(m => m.user.id !== userId) }
        : null
    );
  }, [party]);

  const setReady = useCallback((isReady: boolean) => {
    if (!party) return;
    setParty(prev =>
      prev
        ? {
            ...prev,
            members: prev.members.map(m =>
              m.user.id === "user-123" ? { ...m, isReady } : m
            ),
          }
        : null
    );
  }, [party]);

  const toggleVoiceChat = useCallback(() => {
    if (!party) return;
    setParty(prev =>
      prev ? { ...prev, voiceChatEnabled: !prev.voiceChatEnabled } : null
    );
  }, [party]);

  // Community functions
  const likePost = useCallback((postId: string) => {
    setPosts(prev =>
      prev.map(post =>
        post.id === postId
          ? { ...post, isLiked: !post.isLiked, likes: post.isLiked ? post.likes - 1 : post.likes + 1 }
          : post
      )
    );
  }, []);

  const createPost = useCallback((content: string, tags: string[]) => {
    const newPost: CommunityPost = {
      id: `post-${Date.now()}`,
      author: { id: "user-123", username: "ProGamer99", elo: 1250, status: "online" },
      content,
      tags,
      likes: 0,
      comments: 0,
      shares: 0,
      createdAt: new Date().toISOString(),
      isLiked: false,
      isPinned: false,
    };
    setPosts(prev => [newPost, ...prev]);
  }, []);

  const addComment = useCallback((postId: string, content: string) => {
    setPosts(prev =>
      prev.map(post =>
        post.id === postId ? { ...post, comments: post.comments + 1 } : post
      )
    );
    // In real app, would also add to comments state
  }, []);

  // Notification functions
  const markNotificationRead = useCallback((notificationId: string) => {
    setNotifications(prev =>
      prev.map(n => (n.id === notificationId ? { ...n, read: true } : n))
    );
  }, []);

  const markAllNotificationsRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  }, []);

  // Status management
  const setStatus = useCallback((status: UserStatus) => {
    setUserStatus(status);
  }, []);

  // Privacy settings
  const updatePrivacySettings = useCallback((settings: Partial<SocialPrivacySettings>) => {
    setPrivacySettings(prev => ({ ...prev, ...settings }));
  }, []);

  // Get all social users (for search, invites, etc.)
  const getAllUsers = useCallback((): SocialUser[] => {
    return mockSocialUsers;
  }, []);

  return {
    // State
    friends,
    friendRequests,
    filteredFriends,
    onlineFriends,
    searchQuery,
    setSearchQuery,
    conversations,
    activeConversation,
    messages,
    isTyping,
    party,
    partyInvites,
    posts,
    notifications,
    unreadNotificationCount,
    privacySettings,
    userStatus,

    // Friend actions
    acceptFriendRequest,
    declineFriendRequest,
    removeFriend,
    blockUser,
    sendFriendRequest,

    // Messaging actions
    sendMessage,
    selectConversation,

    // Party actions
    createParty,
    disbandParty,
    inviteToParty,
    kickFromParty,
    setReady,
    toggleVoiceChat,

    // Community actions
    likePost,
    createPost,
    addComment,

    // Notification actions
    markNotificationRead,
    markAllNotificationsRead,

    // Status & Privacy
    setStatus,
    updatePrivacySettings,

    // Utilities
    getAllUsers,
    formatRelativeTime,
  };
}