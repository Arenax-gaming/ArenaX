import { useQuery, useMutation } from '@tanstack/react-query'
import {
  FriendRequest,
  Message,
  Conversation,
  Party,
  PartyInvite,
  OnlineStatus,
  FriendsListResponse,
  SocialUser,
} from '@/types/social'
import { API_BASE } from '@/lib/constants'
import { api } from '@/lib/api'

export const useFriendsList = () => {
  return useQuery({
    queryKey: ['friends'],
    queryFn: () => api.getFriendsList(),
  })
}

/**
 * Friends sorted online-first, for use as the drag source panel in the
 * tournament team-roster builder (issue #1565). Keeps the raw query state
 * (isLoading / isError) so callers can render loading/empty states.
 */
export const useFriendsForRoster = () => {
  const query = useFriendsList()
  const friends = query.data?.friends ?? []
  const sorted = [...friends].sort((a, b) => {
    const aOnline = a.status === 'online' || a.status === 'in-game' ? 0 : 1
    const bOnline = b.status === 'online' || b.status === 'in-game' ? 0 : 1
    if (aOnline !== bOnline) return aOnline - bOnline
    return a.username.localeCompare(b.username)
  })
  return { ...query, friends: sorted }
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

// ─── Party (issue #1102) ─────────────────────────────────────────────────────

export const useMyParty = () => {
  return useQuery<Party | null>({
    queryKey: ['myParty'],
    queryFn: () => api.getMyParty(),
  })
}

export const usePartyInvites = () => {
  return useQuery<PartyInvite[]>({
    queryKey: ['partyInvites'],
    queryFn: () => api.getPartyInvites(),
  })
}

export const useInviteToParty = () => {
  return useMutation({
    mutationFn: ({ partyId, userId }: { partyId: string; userId: string }) =>
      api.inviteToParty(partyId, userId),
  })
}

export const useKickFromParty = () => {
  return useMutation({
    mutationFn: ({ partyId, userId }: { partyId: string; userId: string }) =>
      api.kickFromParty(partyId, userId),
  })
}

export const useLeaveParty = () => {
  return useMutation({
    mutationFn: (partyId: string) => api.leaveParty(partyId),
  })
}

export const useDisbandParty = () => {
  return useMutation({
    mutationFn: (partyId: string) => api.disbandParty(partyId),
  })
}

export const useSetPartyReady = () => {
  return useMutation({
    mutationFn: ({ partyId, isReady }: { partyId: string; isReady: boolean }) =>
      api.setPartyReady(partyId, isReady),
  })
}

export const useTogglePartyVoiceChat = () => {
  return useMutation({
    mutationFn: (partyId: string) => api.togglePartyVoiceChat(partyId),
  })
}

export const useAcceptPartyInvite = () => {
  return useMutation({
    mutationFn: (inviteId: string) => api.acceptPartyInvite(inviteId),
  })
}

export const useDeclinePartyInvite = () => {
  return useMutation({
    mutationFn: (inviteId: string) => api.declinePartyInvite(inviteId),
  })
}
