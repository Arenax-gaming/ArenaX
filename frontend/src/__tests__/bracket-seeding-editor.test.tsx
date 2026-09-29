/**
 * Unit tests for BracketSeedingEditor (#1092).
 *
 * react-dnd's useDrag/useDrop require a DndProvider ancestor to mount at
 * all, so every render below is wrapped in one (HTML5Backend — jsdom
 * doesn't fire real drag events, but the keyboard path below exercises the
 * exact same `movePlayer` reducer a drop does, without needing a DnD test
 * backend).
 *
 * Covers:
 *  - moving a player from seed 1 to seed 3 via keyboard swaps positions in
 *    state (equivalent to "drag player from seed 1 to seed 3")
 *  - the "Save Seeding" button is disabled until the order changes, and
 *    calls the seeding API with the new order
 *  - seeding is locked (no drag/keyboard controls) once the tournament is
 *    in_progress
 */

import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { BracketSeedingEditor, isSeedingLocked } from "@/components/tournaments/BracketSeedingEditor";
import type { BracketPlayer } from "@/types/bracket";

const mockSaveSeeding = jest.fn();
jest.mock("@/lib/api", () => ({
  api: {
    saveTournamentSeeding: (...args: unknown[]) => mockSaveSeeding(...args),
  },
}));

const players: BracketPlayer[] = [
  { id: "p1", username: "Alpha", elo: 2000, seed: 1 },
  { id: "p2", username: "Bravo", elo: 1900, seed: 2 },
  { id: "p3", username: "Charlie", elo: 1800, seed: 3 },
  { id: "p4", username: "Delta", elo: 1700, seed: 4 },
];

function renderEditor(status: "draft" | "registration_open" | "registration_closed" | "in_progress" = "registration_open") {
  return render(
    <DndProvider backend={HTML5Backend}>
      <BracketSeedingEditor tournamentId="t1" tournamentStatus={status} players={players} />
    </DndProvider>,
  );
}

function pickUpAndMoveDown(slot: HTMLElement, times: number) {
  fireEvent.keyDown(slot, { key: "Enter" });
  for (let i = 0; i < times; i++) {
    fireEvent.keyDown(slot, { key: "ArrowDown" });
  }
}

describe("BracketSeedingEditor", () => {
  beforeEach(() => {
    mockSaveSeeding.mockClear();
    mockSaveSeeding.mockResolvedValue({ message: "ok" });
  });

  it("moves a player from seed 1 to seed 3 (keyboard equivalent of drag) and swaps positions in state", () => {
    renderEditor();

    const alphaSlot = screen.getByRole("option", { name: /seed 1: alpha/i });
    pickUpAndMoveDown(alphaSlot, 2); // seed 1 -> 2 -> 3

    expect(screen.getByRole("option", { name: /seed 3: alpha/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /seed 1: bravo/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /seed 2: charlie/i })).toBeInTheDocument();
  });

  it("disables Save Seeding until the order actually changes, then saves the new order", async () => {
    renderEditor();

    const saveButton = screen.getByRole("button", { name: /save seeding/i });
    expect(saveButton).toBeDisabled();

    const alphaSlot = screen.getByRole("option", { name: /seed 1: alpha/i });
    pickUpAndMoveDown(alphaSlot, 2);

    expect(saveButton).not.toBeDisabled();
    fireEvent.click(saveButton);

    await waitFor(() => expect(mockSaveSeeding).toHaveBeenCalledTimes(1));
    expect(mockSaveSeeding).toHaveBeenCalledWith(
      "t1",
      expect.arrayContaining([
        expect.objectContaining({ playerId: "p1", seed: 3 }),
        expect.objectContaining({ playerId: "p2", seed: 1 }),
      ]),
    );
  });

  it("locks seeding once the tournament is in_progress", () => {
    renderEditor("in_progress");

    expect(screen.getByText(/seeding is locked/i)).toBeInTheDocument();
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
  });
});

describe("isSeedingLocked", () => {
  it("is unlocked during draft and registration", () => {
    expect(isSeedingLocked("draft")).toBe(false);
    expect(isSeedingLocked("registration_open")).toBe(false);
    expect(isSeedingLocked("registration_closed")).toBe(false);
  });

  it("is locked once the tournament is in progress or later", () => {
    expect(isSeedingLocked("in_progress")).toBe(true);
    expect(isSeedingLocked("completed")).toBe(true);
    expect(isSeedingLocked("cancelled")).toBe(true);
  });
});
