import { useQuery, useMutation } from '@tanstack/react-query'
import {
  FriendRequest,
  Message,
  Conversation,
  Party,
  OnlineStatus,
  FriendsListResponse,
  SocialUser,
} from '@/types/social'
import { API_BASE } from '@/lib/constants'

export const useFriendsList = () => {
  return useQuery({
    queryKey: ['friends'],
    queryFn: () => api.getFriendsList(),
  })
}

export const usePendingFriendRequests = () => {
  return useQuery({
    queryKey: ['friendRequests'],
    queryFn: () => api.getPendingFriendRequests(),
  })
}

export const useSuggestedUsers = () => {
  return useQuery({
    queryKey: ['suggestedUsers'],
    queryFn: () => api.getSuggestedUsers(),
  })
}

export const useAddFriend = () => {
  return useMutation({
    mutationFn: (friendId: string) => api.addFriend(friendId),
  })
}

export const useAcceptFriendRequest = () => {
  return useMutation({
    mutationFn: (requestId: string) => api.acceptFriendRequest(requestId),
  })
}

export const useSendMessage = () => {
  return useMutation({
    mutationFn: ({ toUserId, content }: { toUserId: string; content: string }) =>
      api.sendMessage(toUserId, content),
  })
}

export const useConversations = () => {
  return useQuery({
    queryKey: ['conversations'],
    queryFn: () => api.getConversations(),
  })
}

export const useCreateParty = () => {
  return useMutation({
    mutationFn: ({
      name,
      description,
      maxMembers,
    }: {
      name: string
      description?: string
      maxMembers?: number
    }) => api.createParty({ name, description, maxMembers }),
  })
}

export const useOnlineStatus = (userId: string) => {
  return useQuery({
    queryKey: ['onlineStatus', userId],
    queryFn: () => api.getOnlineStatus(userId),
  })
}
