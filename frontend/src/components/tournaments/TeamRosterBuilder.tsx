"use client";

/**
 * TeamRosterBuilder — issue #1565.
 *
 * Drag-and-drop team roster step for the tournament registration flow.
 * Built on the `DragAndDropProvider` already mounted at the app root
 * (react-dnd + MultiBackend — see that provider for why a single backend
 * isn't enough for touch devices), following the same pick-up/drop pattern
 * as `BracketSeedingEditor` (#1092) for keyboard parity:
 *
 *   - Drag a friend from the friend-list panel onto a team slot.
 *   - Or: Enter/Space on a friend "picks it up", then Enter/Space on a slot
 *     drops it there. Arrow Up/Down move focus within either panel.
 *
 * Duplicate players are structurally impossible once assigned (an assigned
 * friend is removed from the source list), and `validateRoster` is run
 * defensively before `onContinue` fires.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { useDrag, useDrop } from "react-dnd";
import { AlertCircle, Loader2, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import { useFriendsForRoster } from "@/hooks/useSocial";
import { getTournamentTeamSize, validateRoster } from "@/hooks/useTournaments";
import type { Tournament } from "@/types/tournament";
import type { Friend } from "@/types/social";

const ROSTER_ITEM_TYPE = "roster-friend";

interface DragItem {
  friendId: string;
}

export interface TeamRosterBuilderProps {
  tournament: Pick<Tournament, "teamSize">;
  /** Slot assignments, index-aligned; `null` means the slot is empty. */
  value: Array<string | null>;
  onChange: (next: Array<string | null>) => void;
  onContinue: () => void;
  onCancel?: () => void;
}

export function TeamRosterBuilder({
  tournament,
  value,
  onChange,
  onContinue,
  onCancel,
}: TeamRosterBuilderProps) {
  const teamSize = useMemo(() => getTournamentTeamSize(tournament), [tournament]);
  const { friends, isLoading, isError } = useFriendsForRoster();
  const [pickedFriendId, setPickedFriendId] = useState<string | null>(null);

  const friendById = useMemo(() => {
    const map = new Map<string, Friend>();
    for (const f of friends) map.set(f.id, f);
    return map;
  }, [friends]);

  const assignedIds = useMemo(() => new Set(value.filter((v): v is string => !!v)), [value]);
  const availableFriends = useMemo(
    () => friends.filter((f) => !assignedIds.has(f.id)),
    [friends, assignedIds],
  );

  const assignToSlot = useCallback(
    (friendId: string, slotIndex: number) => {
      // Remove the friend from any slot it currently occupies — this is
      // what structurally rejects duplicates: a friend can only ever sit
      // in one slot at a time.
      const next = value.map((v) => (v === friendId ? null : v));
      next[slotIndex] = friendId;
      onChange(next);
    },
    [value, onChange],
  );

  const clearSlot = useCallback(
    (slotIndex: number) => {
      const next = [...value];
      next[slotIndex] = null;
      onChange(next);
    },
    [value, onChange],
  );

  const { valid, errors } = validateRoster(value, teamSize);
  const filledCount = value.filter(Boolean).length;

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-semibold text-foreground">Build Your Team</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Drag friends into the team slots, or select a friend and press
          Enter, then press Enter on a slot. Requires{" "}
          {teamSize.min === teamSize.max
            ? `exactly ${teamSize.max}`
            : `${teamSize.min}–${teamSize.max}`}{" "}
          players.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* Friend list — drag source */}
        <div>
          <h4 className="mb-2 text-sm font-medium text-muted-foreground">
            Friends ({availableFriends.length})
          </h4>
          {isLoading && (
            <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading friends…
            </div>
          )}
          {isError && (
            <p role="alert" className="p-3 text-sm text-destructive">
              Unable to load your friends list.
            </p>
          )}
          {!isLoading && !isError && availableFriends.length === 0 && (
            <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
              No friends available to add.
            </p>
          )}
          <ul role="listbox" aria-label="Friends available to add" className="space-y-2">
            {availableFriends.map((friend) => (
              <FriendChip
                key={friend.id}
                friend={friend}
                isPicked={pickedFriendId === friend.id}
                onPick={() =>
                  setPickedFriendId((cur) => (cur === friend.id ? null : friend.id))
                }
              />
            ))}
          </ul>
        </div>

        {/* Team slots — drop target */}
        <div>
          <h4 className="mb-2 text-sm font-medium text-muted-foreground">
            Team Slots ({filledCount}/{teamSize.max})
          </h4>
          <ul role="listbox" aria-label="Team roster slots" className="space-y-2">
            {Array.from({ length: teamSize.max }).map((_, slotIndex) => (
              <RosterSlot
                key={slotIndex}
                slotIndex={slotIndex}
                friend={value[slotIndex] ? friendById.get(value[slotIndex] as string) : undefined}
                required={slotIndex < teamSize.min}
                pickedFriendId={pickedFriendId}
                onDropFriend={(friendId) => assignToSlot(friendId, slotIndex)}
                onClear={() => clearSlot(slotIndex)}
                onKeyboardAssign={() => {
                  if (pickedFriendId) {
                    assignToSlot(pickedFriendId, slotIndex);
                    setPickedFriendId(null);
                  }
                }}
              />
            ))}
          </ul>
        </div>
      </div>

      {errors.length > 0 && (
        <div role="alert" className="space-y-1 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {errors.map((err) => (
            <p key={err} className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
              {err}
            </p>
          ))}
        </div>
      )}

      <div className="flex gap-3 pt-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} className="flex-1">
            Cancel
          </Button>
        )}
        <Button type="button" disabled={!valid} onClick={onContinue} className="flex-1">
          Continue
        </Button>
      </div>
    </div>
  );
}

// ─── Friend chip (drag source + keyboard pick-up) ──────────────────────────

function FriendChip({
  friend,
  isPicked,
  onPick,
}: {
  friend: Friend;
  isPicked: boolean;
  onPick: () => void;
}) {
  const [{ isDragging }, dragRef] = useDrag<DragItem, void, { isDragging: boolean }>(
    () => ({
      type: ROSTER_ITEM_TYPE,
      item: { friendId: friend.id },
      collect: (monitor) => ({ isDragging: monitor.isDragging() }),
    }),
    [friend.id],
  );

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onPick();
    }
  }

  return (
    <li
      ref={(node) => {
        dragRef(node);
      }}
      tabIndex={0}
      role="option"
      aria-selected={isPicked}
      aria-grabbed={isPicked}
      aria-label={`${friend.username}, ${friend.elo} ELO`}
      onKeyDown={handleKeyDown}
      className={cn(
        "flex cursor-grab items-center gap-3 rounded-lg border p-3 outline-none transition-colors",
        "focus-visible:ring-2 focus-visible:ring-primary",
        isDragging && "opacity-40",
        isPicked && "border-primary bg-primary/10",
      )}
    >
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/20 text-xs font-semibold text-primary"
        aria-hidden="true"
      >
        {friend.username.charAt(0).toUpperCase()}
      </div>
      <div className="flex-1">
        <p className="text-sm font-medium text-foreground">{friend.username}</p>
        <p className="text-xs text-muted-foreground">{friend.elo} ELO</p>
      </div>
      <UserPlus className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
    </li>
  );
}

// ─── Roster slot (drop target + keyboard drop) ─────────────────────────────

function RosterSlot({
  slotIndex,
  friend,
  required,
  pickedFriendId,
  onDropFriend,
  onClear,
  onKeyboardAssign,
}: {
  slotIndex: number;
  friend: Friend | undefined;
  required: boolean;
  pickedFriendId: string | null;
  onDropFriend: (friendId: string) => void;
  onClear: () => void;
  onKeyboardAssign: () => void;
}) {
  const ref = useRef<HTMLLIElement>(null);

  const [{ isOver, canDrop }, dropRef] = useDrop<DragItem, void, { isOver: boolean; canDrop: boolean }>(
    () => ({
      accept: ROSTER_ITEM_TYPE,
      drop: (item) => onDropFriend(item.friendId),
      collect: (monitor) => ({ isOver: monitor.isOver(), canDrop: monitor.canDrop() }),
    }),
    [onDropFriend],
  );

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (friend) {
        onClear();
      } else {
        onKeyboardAssign();
      }
    } else if ((event.key === "Backspace" || event.key === "Delete") && friend) {
      event.preventDefault();
      onClear();
    }
  }

  return (
    <li
      ref={(node) => {
        ref.current = node;
        dropRef(node);
      }}
      tabIndex={0}
      role="option"
      aria-selected={!!friend}
      aria-label={
        friend
          ? `Slot ${slotIndex + 1}: ${friend.username}. Press Enter to remove.`
          : `Slot ${slotIndex + 1}: empty${required ? " (required)" : ""}. ${
              pickedFriendId ? "Press Enter to assign the selected friend." : ""
            }`
      }
      onKeyDown={handleKeyDown}
      className={cn(
        "flex min-h-[3.25rem] items-center gap-3 rounded-lg border p-3 outline-none transition-colors",
        "focus-visible:ring-2 focus-visible:ring-primary",
        isOver && canDrop && "border-primary bg-primary/5",
        !friend && required && "border-dashed border-amber-400/60",
        !friend && !required && "border-dashed",
      )}
    >
      {friend ? (
        <>
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/20 text-xs font-semibold text-primary"
            aria-hidden="true"
          >
            {friend.username.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground">{friend.username}</p>
            <p className="text-xs text-muted-foreground">{friend.elo} ELO</p>
          </div>
          <button
            type="button"
            onClick={onClear}
            aria-label={`Remove ${friend.username} from slot ${slotIndex + 1}`}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </>
      ) : (
        <span className="flex-1 text-sm text-muted-foreground">
          Slot {slotIndex + 1}
          {required ? " (required)" : " (optional)"}
        </span>
      )}
    </li>
  );
}
