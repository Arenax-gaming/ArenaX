"use client";

/**
 * Optimistic friend request send / unsend (Issue #1323).
 *
 * The per-user request status lives in the React Query cache under
 * `friendRequestStatusKey(userId)`, so it:
 *  - flips to "requested" in `onMutate`, before the server answers;
 *  - survives re-renders (and is shared by every button for that user)
 *    until the mutation settles;
 *  - rolls back to the snapshot in `onError`, with an error toast.
 *
 * Duplicate rapid clicks are dropped: while a request for a user is in
 * flight (`useIsMutating`) or within `DEBOUNCE_MS` of the last click, `send`
 * and `unsend` are no-ops, so only one mutation is ever dispatched.
 */

import { useCallback, useEffect, useRef } from "react";
import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useToast } from "@/contexts/ToastContext";

export type FriendRequestStatus = "none" | "requested";

/** Rapid clicks within this window after a click are ignored. */
export const DEBOUNCE_MS = 400;

export const friendRequestStatusKey = (userId: string) =>
  ["friendRequestStatus", userId] as const;

export const friendRequestMutationKey = (userId: string) =>
  ["friendRequest", userId] as const;

interface MutationContext {
  previous: FriendRequestStatus;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export interface UseFriendRequestOptions {
  /** Status known from the server when the button first renders. */
  initialStatus?: FriendRequestStatus;
  /** Display name used in toasts. */
  username?: string;
}

export function useFriendRequest(
  userId: string,
  { initialStatus = "none", username }: UseFriendRequestOptions = {},
) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const statusKey = friendRequestStatusKey(userId);
  const who = username ?? "this player";

  // Cache-only query: seeded from `initialStatus`, then driven by the
  // mutations below. `staleTime: Infinity` keeps refetches from clobbering an
  // optimistic value mid-flight.
  const { data: status = initialStatus } = useQuery<FriendRequestStatus>({
    queryKey: statusKey,
    queryFn: () =>
      queryClient.getQueryData<FriendRequestStatus>(statusKey) ?? initialStatus,
    initialData: initialStatus,
    staleTime: Infinity,
  });

  const optimistic = (next: FriendRequestStatus) => async (): Promise<MutationContext> => {
    await queryClient.cancelQueries({ queryKey: statusKey });
    const previous =
      queryClient.getQueryData<FriendRequestStatus>(statusKey) ?? initialStatus;
    queryClient.setQueryData<FriendRequestStatus>(statusKey, next);
    return { previous };
  };

  const rollback = (_error: unknown, _vars: void, context?: MutationContext) => {
    queryClient.setQueryData<FriendRequestStatus>(
      statusKey,
      context?.previous ?? initialStatus,
    );
  };

  const settle = () => {
    // Pending/suggested lists may now include or exclude this user.
    queryClient.invalidateQueries({ queryKey: ["friendRequests"] });
    queryClient.invalidateQueries({ queryKey: ["suggestedUsers"] });
  };

  const sendMutation = useMutation<{ message: string }, Error, void, MutationContext>({
    mutationKey: friendRequestMutationKey(userId),
    mutationFn: () => api.addFriend(userId),
    onMutate: optimistic("requested"),
    onError: (error, vars, context) => {
      rollback(error, vars, context);
      toast.error(
        errorMessage(error, `We couldn't send your friend request to ${who}. Please try again.`),
        { title: "Friend request not sent" },
      );
    },
    onSettled: settle,
  });

  const unsendMutation = useMutation<{ message: string }, Error, void, MutationContext>({
    mutationKey: friendRequestMutationKey(userId),
    mutationFn: () => api.cancelFriendRequest(userId),
    onMutate: optimistic("none"),
    onError: (error, vars, context) => {
      rollback(error, vars, context);
      toast.error(
        errorMessage(error, `We couldn't cancel your friend request to ${who}. Please try again.`),
        { title: "Request not cancelled" },
      );
    },
    onSettled: settle,
  });

  // Shared across every component mutating this user, not just this one.
  const inFlight = useIsMutating({ mutationKey: friendRequestMutationKey(userId) }) > 0;
  const lastClickRef = useRef(0);
  const lockRef = useRef(false);

  // Adopt fresh server-provided status, but never over an optimistic value
  // that is still awaiting its response.
  useEffect(() => {
    if (!inFlight && !lockRef.current) {
      queryClient.setQueryData<FriendRequestStatus>(statusKey, initialStatus);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialStatus, userId]);

  const guard = useCallback(
    (run: () => void) => {
      const now = Date.now();
      if (lockRef.current || inFlight || now - lastClickRef.current < DEBOUNCE_MS) {
        return false;
      }
      lastClickRef.current = now;
      // `inFlight` only updates on the next render; the ref closes the gap
      // for clicks fired in the same tick.
      lockRef.current = true;
      run();
      return true;
    },
    [inFlight],
  );

  const send = useCallback(
    () =>
      guard(() =>
        sendMutation.mutate(undefined, {
          onSettled: () => {
            lockRef.current = false;
          },
        }),
      ),
    [guard, sendMutation],
  );

  const unsend = useCallback(
    () =>
      guard(() =>
        unsendMutation.mutate(undefined, {
          onSettled: () => {
            lockRef.current = false;
          },
        }),
      ),
    [guard, unsendMutation],
  );

  return {
    status,
    isRequested: status === "requested",
    isPending: inFlight || sendMutation.isPending || unsendMutation.isPending,
    send,
    unsend,
    toggle: status === "requested" ? unsend : send,
  };
}
