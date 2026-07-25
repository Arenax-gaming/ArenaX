import React from "react";
import { render, screen, act } from "@testing-library/react";
import MatchmakingQueue from "@/components/game/MatchmakingQueue";

describe("MatchmakingQueue estimated time", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it("shows the remaining estimate before it elapses", () => {
    render(
      <MatchmakingQueue gameMode="ranked" onCancel={jest.fn()} onMatchFound={jest.fn()} />
    );

    act(() => {
      jest.advanceTimersByTime(10_000);
    });

    expect(screen.getByText("~20s")).toBeInTheDocument();
  });

  it("clamps the estimate at zero and never shows a negative number once wait exceeds it", () => {
    render(
      <MatchmakingQueue gameMode="ranked" onCancel={jest.fn()} onMatchFound={jest.fn()} />
    );

    act(() => {
      jest.advanceTimersByTime(45_000);
    });

    expect(screen.queryByText(/~-\d+s/)).not.toBeInTheDocument();
    expect(screen.getByText("Almost there...")).toBeInTheDocument();
  });
});
