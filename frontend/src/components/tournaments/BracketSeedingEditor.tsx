"use client";

/**
 * BracketSeedingEditor (#1092)
 *
 * Drag-and-drop bracket seeding for tournament admins. Built on the
 * `DragAndDropProvider` already mounted in the providers tree (react-dnd +
 * MultiBackend, so both mouse and touch work — see that provider's own
 * comment for why a single backend isn't enough).
 *
 * Every slot is also keyboard-operable: Tab to focus a slot, Enter/Space to
 * "pick up" or "drop" it, then Arrow Up/Down to move it while picked up.
 */

import { useCallback, useMemo, useState } from "react";
import { useDrag, useDrop } from "react-dnd";
import { AlertCircle, GripVertical, Save } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import type { BracketPlayer } from "@/types/bracket";
import type { TournamentStatus } from "@/types/tournament";

const SEED_ITEM_TYPE = "bracket-seed";

interface DragItem {
  seed: number;
}

export interface BracketSeedingEditorProps {
  tournamentId: string;
  tournamentStatus: TournamentStatus;
  /** Players ordered by current seed (index 0 = seed 1). */
  players: BracketPlayer[];
  onSaved?: (order: BracketPlayer[]) => void;
}

/** Seeding can only change while the tournament is still accepting/reviewing entrants. */
export function isSeedingLocked(status: TournamentStatus): boolean {
  return status !== "draft" && status !== "registration_open" && status !== "registration_closed";
}

export function BracketSeedingEditor({
  tournamentId,
  tournamentStatus,
  players: initialPlayers,
  onSaved,
}: BracketSeedingEditorProps) {
  const locked = isSeedingLocked(tournamentStatus);
  const originalOrder = useMemo(() => initialPlayers.map((p) => p.id), [initialPlayers]);
  const [order, setOrder] = useState<BracketPlayer[]>(initialPlayers);
  const [pickedUpSeed, setPickedUpSeed] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const isDirty = order.some((p, i) => p.id !== originalOrder[i]);

  const movePlayer = useCallback((fromSeed: number, toSeed: number) => {
    if (fromSeed === toSeed) return;
    setOrder((prev) => {
      const fromIndex = fromSeed - 1;
      const toIndex = toSeed - 1;
      if (fromIndex < 0 || fromIndex >= prev.length || toIndex < 0 || toIndex >= prev.length) {
        return prev;
      }
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
    setSaved(false);
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await api.saveTournamentSeeding(
        tournamentId,
        order.map((p, i) => ({ playerId: p.id, seed: i + 1 })),
      );
      setSaved(true);
      onSaved?.(order);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save seeding.");
    } finally {
      setSaving(false);
    }
  }, [tournamentId, order, onSaved]);

  if (locked) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
        <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
        Seeding is locked — this tournament has moved out of registration.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <ul role="listbox" aria-label="Bracket seed order" className="space-y-2">
        {order.map((player, index) => {
          const seed = index + 1;
          const changed = originalOrder.indexOf(player.id) !== index;
          return (
            <SeedSlot
              key={player.id}
              seed={seed}
              player={player}
              changed={changed}
              isPickedUp={pickedUpSeed === seed}
              onDrop={(fromSeed) => movePlayer(fromSeed, seed)}
              onKeyboardPickupToggle={() =>
                setPickedUpSeed((current) => (current === seed ? null : seed))
              }
              onKeyboardMove={(direction) => {
                if (pickedUpSeed === null) return;
                const target = pickedUpSeed + direction;
                if (target < 1 || target > order.length) return;
                movePlayer(pickedUpSeed, target);
                setPickedUpSeed(target);
              }}
            />
          );
        })}
      </ul>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {saved && !isDirty && <p className="text-sm text-success">Seeding saved.</p>}

      <Button onClick={handleSave} disabled={!isDirty || saving} className="gap-2">
        <Save className="h-4 w-4" aria-hidden="true" />
        {saving ? "Saving…" : "Save Seeding"}
      </Button>
    </div>
  );
}

interface SeedSlotProps {
  seed: number;
  player: BracketPlayer;
  changed: boolean;
  isPickedUp: boolean;
  onDrop: (fromSeed: number) => void;
  onKeyboardPickupToggle: () => void;
  onKeyboardMove: (direction: 1 | -1) => void;
}

function SeedSlot({
  seed,
  player,
  changed,
  isPickedUp,
  onDrop,
  onKeyboardPickupToggle,
  onKeyboardMove,
}: SeedSlotProps) {
  const [{ isDragging }, dragRef] = useDrag<DragItem, void, { isDragging: boolean }>(
    () => ({
      type: SEED_ITEM_TYPE,
      item: { seed },
      collect: (monitor) => ({ isDragging: monitor.isDragging() }),
    }),
    [seed],
  );

  const [{ isOver }, dropRef] = useDrop<DragItem, void, { isOver: boolean }>(
    () => ({
      accept: SEED_ITEM_TYPE,
      drop: (item) => onDrop(item.seed),
      collect: (monitor) => ({ isOver: monitor.isOver() }),
    }),
    [onDrop],
  );

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onKeyboardPickupToggle();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      onKeyboardMove(-1);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      onKeyboardMove(1);
    }
  }

  return (
    <li
      ref={(node) => {
        dragRef(node);
        dropRef(node);
      }}
      tabIndex={0}
      role="option"
      aria-selected={isPickedUp}
      aria-grabbed={isPickedUp}
      aria-label={`Seed ${seed}: ${player.username}${changed ? " (unsaved change)" : ""}`}
      onKeyDown={handleKeyDown}
      className={cn(
        "flex items-center gap-3 rounded-lg border p-3 outline-none transition-colors",
        "focus-visible:ring-2 focus-visible:ring-primary",
        isDragging && "opacity-40",
        isOver && "border-primary bg-primary/5",
        isPickedUp && "border-primary bg-primary/10",
        changed && !isPickedUp && "border-amber-400 bg-amber-50 dark:bg-amber-950/20",
      )}
    >
      <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-muted-foreground" aria-hidden="true" />
      <span className="w-8 shrink-0 text-sm font-semibold text-muted-foreground">#{seed}</span>
      <span className="flex-1 text-sm font-medium text-foreground">{player.username}</span>
      <span className="text-xs text-muted-foreground">{player.elo} ELO</span>
      {changed && (
        <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
          Unsaved
        </span>
      )}
    </li>
  );
}
