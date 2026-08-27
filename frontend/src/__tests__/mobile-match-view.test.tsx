/**
 * Tests for <MobileMatchView /> mobile gesture support (#928).
 *
 * Covers swipe (touch + accessible buttons), pinch-to-zoom, long-press context
 * menu, haptic feedback, and persisted gesture customization.
 */
import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import {
  MobileMatchView,
  type ContextMenuItem,
} from "@/components/match/MobileMatchView";

// ── environment shims ──
beforeAll(() => {
  window.matchMedia =
    window.matchMedia ||
    (jest.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      addListener: jest.fn(),
      removeListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })) as unknown as typeof window.matchMedia);
});

let vibrateMock: jest.Mock;
beforeEach(() => {
  vibrateMock = jest.fn();
  Object.defineProperty(navigator, "vibrate", {
    configurable: true,
    writable: true,
    value: vibrateMock,
  });
  window.localStorage.clear();
});

const STORAGE_KEY = "arenax:match-gestures";
const t = (x: number, y: number) => ({ clientX: x, clientY: y });

function renderView(props: Partial<React.ComponentProps<typeof MobileMatchView>> = {}) {
  return render(
    <MobileMatchView {...props}>
      <div data-testid="board">Game board</div>
    </MobileMatchView>
  );
}

describe("MobileMatchView (#928)", () => {
  it("renders the board inside a zoomable, gesture surface", () => {
    renderView();
    expect(screen.getByTestId("board")).toHaveTextContent("Game board");
    expect(screen.getByTestId("gesture-surface")).toBeInTheDocument();
    expect(screen.getByTestId("zoom-layer")).toHaveStyle({ transform: "scale(1)" });
  });

  it("fires swipe actions from the accessible fallback buttons", () => {
    const onSwipeLeft = jest.fn();
    const onSwipeRight = jest.fn();
    renderView({ onSwipeLeft, onSwipeRight });
    fireEvent.click(screen.getByLabelText("Next match"));
    fireEvent.click(screen.getByLabelText("Previous match"));
    expect(onSwipeLeft).toHaveBeenCalledTimes(1);
    expect(onSwipeRight).toHaveBeenCalledTimes(1);
    // Haptics fired on activation.
    expect(vibrateMock).toHaveBeenCalled();
  });

  it("recognizes a left swipe from touch events", () => {
    const onSwipeLeft = jest.fn();
    renderView({ onSwipeLeft });
    const surface = screen.getByTestId("gesture-surface");
    fireEvent.touchStart(surface, { touches: [t(220, 100)] });
    fireEvent.touchMove(surface, { touches: [t(20, 105)] });
    fireEvent.touchEnd(surface, { touches: [] });
    expect(onSwipeLeft).toHaveBeenCalledTimes(1);
  });

  it("pinches to zoom the board in", () => {
    const onZoomChange = jest.fn();
    renderView({ onZoomChange });
    const surface = screen.getByTestId("gesture-surface");
    // Two fingers 100px apart → 200px apart == 2x zoom.
    fireEvent.touchStart(surface, { touches: [t(100, 100), t(200, 100)] });
    fireEvent.touchMove(surface, { touches: [t(50, 100), t(250, 100)] });
    fireEvent.touchEnd(surface, { touches: [] });
    expect(screen.getByTestId("zoom-layer")).toHaveStyle({ transform: "scale(2)" });
    expect(onZoomChange).toHaveBeenLastCalledWith(2);
  });

  it("zooms with buttons and resets", () => {
    renderView();
    fireEvent.click(screen.getByLabelText("Zoom in"));
    expect(screen.getByTestId("zoom-layer")).toHaveStyle({ transform: "scale(1.25)" });
    fireEvent.click(screen.getByLabelText("Reset zoom"));
    expect(screen.getByTestId("zoom-layer")).toHaveStyle({ transform: "scale(1)" });
  });

  it("clamps zoom to maxZoom", () => {
    renderView({ config: { maxZoom: 1.5 } });
    fireEvent.click(screen.getByLabelText("Zoom in")); // 1.25
    fireEvent.click(screen.getByLabelText("Zoom in")); // 1.5 (clamped)
    fireEvent.click(screen.getByLabelText("Zoom in")); // stays 1.5
    expect(screen.getByTestId("zoom-layer")).toHaveStyle({ transform: "scale(1.5)" });
  });

  it("opens a context menu on long-press and runs the selected action", () => {
    jest.useFakeTimers();
    try {
      const onSelect = jest.fn();
      const items: ContextMenuItem[] = [
        { id: "report", label: "Report score", onSelect },
      ];
      renderView({ contextMenuItems: items });
      const surface = screen.getByTestId("gesture-surface");
      fireEvent.touchStart(surface, { touches: [t(30, 40)] });
      act(() => {
        jest.advanceTimersByTime(600);
      });
      const menu = screen.getByRole("menu", { name: "Match actions" });
      expect(menu).toBeInTheDocument();
      // Long-press haptic pattern.
      expect(vibrateMock).toHaveBeenCalledWith([10, 30, 10]);
      fireEvent.click(screen.getByRole("menuitem", { name: "Report score" }));
      expect(onSelect).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it("persists gesture customization and disables the swipe gesture", () => {
    const onSwipeLeft = jest.fn();
    renderView({ onSwipeLeft });
    // Open settings and turn off swipe navigation.
    fireEvent.click(screen.getByLabelText("Gesture settings"));
    fireEvent.click(screen.getByLabelText("Swipe navigation"));

    // Persisted.
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}");
    expect(saved.swipeEnabled).toBe(false);

    // Button now disabled and touch swipe is inert.
    expect(screen.getByLabelText("Next match")).toBeDisabled();
    const surface = screen.getByTestId("gesture-surface");
    fireEvent.touchStart(surface, { touches: [t(220, 100)] });
    fireEvent.touchMove(surface, { touches: [t(20, 105)] });
    fireEvent.touchEnd(surface, { touches: [] });
    expect(onSwipeLeft).not.toHaveBeenCalled();
  });

  it("hydrates configuration from localStorage", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ pinchEnabled: false })
    );
    renderView();
    // Pinch disabled → zoom controls are not rendered.
    expect(screen.queryByLabelText("Zoom in")).not.toBeInTheDocument();
  });
});
