import { useCallback, useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { MatchWithPlayers, MatchDetail, MatchFilters, ReportScoreRequest } from '@/types/match'
import type { MatchHubDetails } from '@/types/match'

// Fetch a single match
export const useMatch = (matchId: string) => {
  return useQuery({
    queryKey: ['match', matchId],
    queryFn: async () => {
      const data = await api.getMatch(matchId)
      return data as (MatchWithPlayers & Partial<MatchDetail> & Partial<MatchHubDetails>)
    },
    enabled: !!matchId,
  })
}

// Fetch all matches with filters
export const useMatches = (filters?: MatchFilters) => {
  return useQuery({
    queryKey: ['matches', filters],
    queryFn: async () => {
      const data = await api.getMatches(filters)
      return data as MatchWithPlayers[]
    },
  })
}

// Report match score
export const useReportMatchScore = () => {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async ({ id, result }: { id: string; result: ReportScoreRequest }) => {
      return await api.reportMatchScore(id, result)
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['match', id] })
    },
  })
}

// ─── Voice chat microphone permission (#1564) ──────────────────────────────
//
// The match lobby needs to know, before the player joins voice chat, whether
// microphone access is granted, denied, or not yet decided — and it needs
// that without triggering a surprise browser permission dialog just to find
// out. The Permissions API answers that question passively; only an
// explicit `requestPermission()` call (wired to a button the player clicks)
// actually prompts.

export type VoiceChatPermissionStatus = 'granted' | 'denied' | 'prompt'

export interface UseVoiceChatPermissionResult {
  /** Current microphone permission state, kept in sync via the Permissions API. */
  status: VoiceChatPermissionStatus
  /** False when this browser exposes neither the Permissions nor the media APIs. */
  isSupported: boolean
  /** Prompts the browser's native microphone permission dialog. Resolves with the outcome. */
  requestPermission: () => Promise<VoiceChatPermissionStatus>
}

const toVoiceChatStatus = (state: PermissionState): VoiceChatPermissionStatus =>
  state === 'granted' ? 'granted' : state === 'denied' ? 'denied' : 'prompt'

export const useVoiceChatPermission = (): UseVoiceChatPermissionResult => {
  const [status, setStatus] = useState<VoiceChatPermissionStatus>('prompt')
  const [isSupported, setIsSupported] = useState(true)

  // Passive read via the Permissions API: reflects a grant/denial from a
  // previous session without ever opening the browser's prompt, and keeps
  // `status` live if the user changes the permission from browser chrome.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setIsSupported(false)
      return
    }

    if (!navigator.permissions?.query) {
      // Permissions API not available (e.g. Safari) — fall back to
      // "prompt" and let an explicit requestPermission() call resolve it.
      return
    }

    let permissionStatus: PermissionStatus | null = null
    const handleChange = () => {
      if (permissionStatus) setStatus(toVoiceChatStatus(permissionStatus.state))
    }

    navigator.permissions
      .query({ name: 'microphone' })
      .then((result) => {
        permissionStatus = result
        setStatus(toVoiceChatStatus(result.state))
        result.addEventListener('change', handleChange)
      })
      .catch(() => {
        // Some browsers support the Permissions API but not the
        // "microphone" descriptor; same fallback as above.
      })

    return () => {
      permissionStatus?.removeEventListener('change', handleChange)
    }
  }, [])

  const requestPermission = useCallback(async (): Promise<VoiceChatPermissionStatus> => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setIsSupported(false)
      setStatus('denied')
      return 'denied'
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      // Only probing for permission here — release the mic immediately
      // rather than holding it open until voice chat actually starts.
      stream.getTracks().forEach((track) => track.stop())
      setStatus('granted')
      return 'granted'
    } catch {
      setStatus('denied')
      return 'denied'
    }
  }, [])

  return { status, isSupported, requestPermission }
}
