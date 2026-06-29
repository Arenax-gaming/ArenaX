import { useQuery, useMutation } from '@tanstack/react-query'
import {
  Friend,
  FriendRequest,
  Message,
  Conversation,
  Party,
  OnlineStatus,
  FriendsListResponse,
  SocialUser,
} from '@/types/social'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api/v1'

export const useFriendsList = () => {
  return useQuery({
    queryKey: ['friends'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/friends`)
      if (!res.ok) throw new Error('Failed to fetch friends list')
      const data = await res.json()
      return data.data as FriendsListResponse
    },
  })
}

export const usePendingFriendRequests = () => {
  return useQuery({
    queryKey: ['friendRequests'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/friends/requests`)
      if (!res.ok) throw new Error('Failed to fetch friend requests')
      const data = await res.json()
      return data.data as FriendRequest[]
    },
  })
}

export const useSuggestedUsers = () => {
  return useQuery({
    queryKey: ['suggestedUsers'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/friends/suggestions`)
      if (!res.ok) throw new Error('Failed to fetch suggested users')
      const data = await res.json()
      return data.data as SocialUser[]
    },
  })
}

export const useAddFriend = () => {
  return useMutation({
    mutationFn: async (friendId: string) => {
      const res = await fetch(`${API_BASE}/friends/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ friend_id: friendId }),
      })
      if (!res.ok) throw new Error('Failed to send friend request')
      const data = await res.json()
      return data.data as FriendRequest
    },
  })
}

export const useAcceptFriendRequest = () => {
  return useMutation({
    mutationFn: async (requestId: string) => {
      const res = await fetch(`${API_BASE}/friends/requests/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: requestId }),
      })
      if (!res.ok) throw new Error('Failed to accept friend request')
      return res.json()
    },
  })
}

export const useSendMessage = () => {
  return useMutation({
    mutationFn: async ({ toUserId, content }: { toUserId: string; content: string }) => {
      const res = await fetch(`${API_BASE}/messages/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to_user_id: toUserId, content }),
      })
      if (!res.ok) throw new Error('Failed to send message')
      const data = await res.json()
      return data.data as Message
    },
  })
}

export const useConversations = () => {
  return useQuery({
    queryKey: ['conversations'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/messages/conversations`)
      if (!res.ok) throw new Error('Failed to fetch conversations')
      const data = await res.json()
      return data.data as Conversation[]
    },
  })
}

export const useCreateParty = () => {
  return useMutation({
    mutationFn: async ({
      name,
      description,
      maxMembers,
    }: {
      name: string
      description?: string
      maxMembers?: number
    }) => {
      const res = await fetch(`${API_BASE}/party/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, max_members: maxMembers }),
      })
      if (!res.ok) throw new Error('Failed to create party')
      const data = await res.json()
      return data.data as Party
    },
  })
}

export const useOnlineStatus = (userId: string) => {
  return useQuery({
    queryKey: ['onlineStatus', userId],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/status/${userId}`)
      if (!res.ok) throw new Error('Failed to fetch online status')
      const data = await res.json()
      return data.data as OnlineStatus
    },
  })
}
