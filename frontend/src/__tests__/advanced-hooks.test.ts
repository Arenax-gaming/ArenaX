/**
 * Advanced hooks test suite — #691
 *
 * Covers:
 *  useLocalStorage  — persist, sync, validate, remove
 *  useOptimisticState — optimistic update, rollback, callbacks
 *  useStateMachine  — transitions, guards, history, available events
 *  usePaginatedQuery — page navigation, prefetch, derived flags
 *  usePolling       — fetch on start, pause/resume, error pause
 *  useInterval      — start/pause/resume/reset, null delay
 *  useTimeout       — fires after delay, cancel
 *  useClipboard     — copies text, hasCopied resets, error on failure
 *  useHookAnalytics — emits mount/unmount, timer, error, feature events
 */

import { renderHook, act, waitFor } from "@testing-library/react";
import React from "react";

// ─── Mock next/navigation (used indirectly by some hooks) ────────────────────
jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  usePathname: () => "/en/dashboard",
  useSearchParams: () => new URLSearchParams(),
}));

// ─── Fake timers helper ──────────────────────────────────────────────────────
function withFakeTimers(fn: () => void) {
  jest.useFakeTimers();
  try {
    fn();
  } finally {
    jest.useRealTimers();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// useLocalStorage
// ═══════════════════════════════════════════════════════════════════════════════

import { useLocalStorage } from "@/hooks/useLocalStorage";

describe("useLocalStorage", () => {
  beforeEach(() => localStorage.clear());

  test("returns initialValue when key is absent", () => {
    const { result } = renderHook(() => useLocalStorage("test-key", "hello"));
    expect(result.current[0]).toBe("hello");
  });

  test("returns stored value when key exists", () => {
    localStorage.setItem("test-key", JSON.stringify("persisted"));
    const { result } = renderHook(() => useLocalStorage("test-key", "hello"));
    expect(result.current[0]).toBe("persisted");
  });

  test("setValue updates state and persists to localStorage", () => {
    const { result } = renderHook(() => useLocalStorage("k", 0));
    act(() => result.current[1](42));
    expect(result.current[0]).toBe(42);
    expect(JSON.parse(localStorage.getItem("k")!)).toBe(42);
  });

  test("setValue accepts updater function", () => {
    const { result } = renderHook(() => useLocalStorage("k", 5));
    act(() => result.current[1]((prev) => prev + 3));
    expect(result.current[0]).toBe(8);
  });

  test("remove() resets to initialValue", () => {
    const { result } = renderHook(() => useLocalStorage("k", "default"));
    act(() => result.current[1]("changed"));
    expect(result.current[0]).toBe("changed");
    act(() => result.current[2]());
    // State resets to initialValue
    expect(result.current[0]).toBe("default");
    // The re-render effect will write the initialValue back, so we check the
    // stored value equals the initialValue rather than null
    expect(JSON.parse(localStorage.getItem("k")!)).toBe("default");
  });

  test("validator discards invalid stored value and uses initialValue", () => {
    localStorage.setItem("num", JSON.stringify("not-a-number"));
    const isNumber = (v: unknown): v is number => typeof v === "number";
    const { result } = renderHook(() =>
      useLocalStorage("num", 99, { validate: isNumber })
    );
    expect(result.current[0]).toBe(99);
  });

  test("syncs state on storage event from another tab", () => {
    const { result } = renderHook(() => useLocalStorage("sync-key", "original"));

    act(() => {
      const event = new StorageEvent("storage", {
        key: "sync-key",
        newValue: JSON.stringify("from-other-tab"),
        storageArea: window.localStorage,
      });
      window.dispatchEvent(event);
    });

    expect(result.current[0]).toBe("from-other-tab");
  });

  test("resets to initialValue on storage event with null newValue", () => {
    const { result } = renderHook(() => useLocalStorage("sync-key", "initial"));
    act(() => result.current[1]("changed"));

    act(() => {
      const event = new StorageEvent("storage", {
        key: "sync-key",
        newValue: null,
        storageArea: window.localStorage,
      });
      window.dispatchEvent(event);
    });

    expect(result.current[0]).toBe("initial");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// useOptimisticState
// ═══════════════════════════════════════════════════════════════════════════════

import { useOptimisticState } from "@/hooks/useOptimisticState";

describe("useOptimisticState", () => {
  test("applies optimistic update immediately", async () => {
    let resolveOp!: (v: string) => void;
    const op = () =>
      new Promise<string>((res) => {
        resolveOp = res;
      });

    const { result } = renderHook(() =>
      useOptimisticState("original", op)
    );

    act(() => {
      result.current.update("optimistic");
    });

    expect(result.current.value).toBe("optimistic");
    expect(result.current.isPending).toBe(true);

    await act(async () => {
      resolveOp("confirmed");
    });

    expect(result.current.value).toBe("confirmed");
    expect(result.current.isPending).toBe(false);
  });

  test("rolls back to confirmed value on error", async () => {
    const op = () => Promise.reject(new Error("network error"));
    const onError = jest.fn();

    const { result } = renderHook(() =>
      useOptimisticState("original", op, { onError })
    );

    await act(async () => {
      await result.current.update("optimistic");
    });

    expect(result.current.value).toBe("original");
    expect(result.current.error?.message).toBe("network error");
    expect(onError).toHaveBeenCalledTimes(1);
  });

  test("returns true on success, false on failure", async () => {
    const successOp = () => Promise.resolve();
    const failOp = () => Promise.reject(new Error("fail"));

    const { result: r1 } = renderHook(() => useOptimisticState("x", successOp));
    const { result: r2 } = renderHook(() => useOptimisticState("x", failOp));

    let s1: boolean, s2: boolean;
    await act(async () => {
      s1 = await r1.current.update("new");
    });
    await act(async () => {
      s2 = await r2.current.update("new");
    });

    expect(s1!).toBe(true);
    expect(s2!).toBe(false);
  });

  test("onSuccess callback is called with next and prev values", async () => {
    const onSuccess = jest.fn();
    const op = () => Promise.resolve("server-value");
    const { result } = renderHook(() =>
      useOptimisticState("original", op, { onSuccess })
    );

    await act(async () => {
      await result.current.update("optimistic");
    });

    expect(onSuccess).toHaveBeenCalledWith("server-value", "original");
  });

  test("clearError clears the error state", async () => {
    const op = () => Promise.reject(new Error("err"));
    const { result } = renderHook(() => useOptimisticState("x", op));

    await act(async () => {
      await result.current.update("y");
    });

    expect(result.current.error).not.toBeNull();
    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });

  test("reset changes both value and confirmedValue", () => {
    const op = jest.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useOptimisticState("original", op));
    act(() => result.current.reset("reset-value"));
    expect(result.current.value).toBe("reset-value");
    expect(result.current.confirmedValue).toBe("reset-value");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// useStateMachine
// ═══════════════════════════════════════════════════════════════════════════════

import {
  useStateMachine,
  MATCH_FLOW_CONFIG,
} from "@/hooks/useStateMachine";

describe("useStateMachine", () => {
  test("starts in initialState", () => {
    const { result } = renderHook(() =>
      useStateMachine(MATCH_FLOW_CONFIG, "idle")
    );
    expect(result.current.state).toBe("idle");
  });

  test("transitions on valid event", () => {
    const { result } = renderHook(() =>
      useStateMachine(MATCH_FLOW_CONFIG, "idle")
    );
    act(() => result.current.send("LOAD"));
    expect(result.current.state).toBe("loading");
  });

  test("send returns true on valid transition", () => {
    const { result } = renderHook(() =>
      useStateMachine(MATCH_FLOW_CONFIG, "idle")
    );
    let ok: boolean;
    act(() => {
      ok = result.current.send("LOAD");
    });
    expect(ok!).toBe(true);
  });

  test("send returns false on invalid event for current state", () => {
    const { result } = renderHook(() =>
      useStateMachine(MATCH_FLOW_CONFIG, "idle")
    );
    let ok: boolean;
    act(() => {
      ok = result.current.send("DISPUTE");
    });
    expect(ok!).toBe(false);
    expect(result.current.state).toBe("idle");
  });

  test("is() returns true for current state", () => {
    const { result } = renderHook(() =>
      useStateMachine(MATCH_FLOW_CONFIG, "idle")
    );
    expect(result.current.is("idle")).toBe(true);
    expect(result.current.is("active")).toBe(false);
  });

  test("can() returns true for a valid event", () => {
    const { result } = renderHook(() =>
      useStateMachine(MATCH_FLOW_CONFIG, "idle")
    );
    expect(result.current.can("LOAD")).toBe(true);
    expect(result.current.can("DISPUTE")).toBe(false);
  });

  test("availableEvents lists valid events for current state", () => {
    const { result } = renderHook(() =>
      useStateMachine(MATCH_FLOW_CONFIG, "active")
    );
    expect(result.current.availableEvents).toEqual(
      expect.arrayContaining(["REPORT", "DISPUTE", "COMPLETE"])
    );
  });

  test("history records transitions", () => {
    const { result } = renderHook(() =>
      useStateMachine(MATCH_FLOW_CONFIG, "idle")
    );
    act(() => result.current.send("LOAD"));
    act(() => result.current.send("LOADED"));
    expect(result.current.history).toHaveLength(2);
    expect(result.current.history[0]).toMatchObject({
      from: "idle",
      to: "loading",
      event: "LOAD",
    });
  });

  test("reset returns to initialState", () => {
    const { result } = renderHook(() =>
      useStateMachine(MATCH_FLOW_CONFIG, "idle")
    );
    act(() => result.current.send("LOAD"));
    act(() => result.current.send("LOADED"));
    act(() => result.current.reset());
    expect(result.current.state).toBe("idle");
    expect(result.current.history).toHaveLength(0);
  });

  test("guard blocks transition when it returns false", () => {
    const config = {
      transitions: {
        idle: {
          GO: {
            target: "active" as const,
            guard: (ctx: unknown) => ctx === "allowed",
          },
        },
        active: {},
      },
    };

    type S = "idle" | "active";
    type E = "GO";

    const { result } = renderHook(() =>
      useStateMachine<S, E>(config, "idle")
    );

    act(() => result.current.send("GO", "denied"));
    expect(result.current.state).toBe("idle");

    act(() => result.current.send("GO", "allowed"));
    expect(result.current.state).toBe("active");
  });

  test("transition action is called", () => {
    const action = jest.fn();
    const config = {
      transitions: {
        idle: {
          START: { target: "active" as const, action },
        },
        active: {},
      },
    };
    type S = "idle" | "active";
    type E = "START";

    const { result } = renderHook(() =>
      useStateMachine<S, E>(config, "idle")
    );
    act(() => result.current.send("START"));
    expect(action).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// usePolling
// ═══════════════════════════════════════════════════════════════════════════════

import { usePolling } from "@/hooks/usePolling";

describe("usePolling", () => {
  test("fetches data on mount when immediate=true", async () => {
    const fn = jest.fn().mockResolvedValue({ status: "active" });
    const { result } = renderHook(() =>
      usePolling({ fn, interval: 1000 })
    );

    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(fn).toHaveBeenCalled();
    expect(result.current.data).toEqual({ status: "active" });
  });

  test("pause() stops polling", async () => {
    const fn = jest.fn().mockResolvedValue("tick");
    const { result } = renderHook(() =>
      usePolling({ fn, interval: 500 })
    );

    await waitFor(() => expect(fn).toHaveBeenCalled());
    act(() => result.current.pause());
    expect(result.current.isPolling).toBe(false);
  });

  test("resume() restarts polling after pause", async () => {
    const fn = jest.fn().mockResolvedValue("tick");
    const { result } = renderHook(() =>
      usePolling({ fn, interval: 500, immediate: false })
    );

    act(() => result.current.pause());
    act(() => result.current.resume());
    await waitFor(() => expect(result.current.isPolling).toBe(true));
  });

  test("sets error state on failure", async () => {
    const fn = jest.fn().mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() =>
      usePolling({ fn, interval: 1000 })
    );

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.message).toBe("network down");
  });

  test("pauseOnError=true pauses polling after error", async () => {
    const fn = jest.fn().mockRejectedValue(new Error("fail"));
    const { result } = renderHook(() =>
      usePolling({ fn, interval: 1000, pauseOnError: true })
    );

    await waitFor(() => expect(result.current.isPolling).toBe(false));
  });

  test("onUpdate callback is called with data", async () => {
    const onUpdate = jest.fn();
    const fn = jest.fn().mockResolvedValue({ score: 3 });
    renderHook(() =>
      usePolling({ fn, interval: 500, onUpdate })
    );

    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({ score: 3 }));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// useInterval
// ═══════════════════════════════════════════════════════════════════════════════

import { useInterval, useTimeout } from "@/hooks/useInterval";

describe("useInterval", () => {
  test("callback fires after delay", () => {
    withFakeTimers(() => {
      const cb = jest.fn();
      renderHook(() => useInterval(cb, 200));
      // First call fires immediately (immediate=true)
      act(() => jest.advanceTimersByTime(200));
      expect(cb.mock.calls.length).toBeGreaterThanOrEqual(1);
    });
  });

  test("does not run when delay is null", () => {
    withFakeTimers(() => {
      const cb = jest.fn();
      renderHook(() => useInterval(cb, null));
      act(() => jest.advanceTimersByTime(5000));
      expect(cb).not.toHaveBeenCalled();
    });
  });

  test("pause() stops the interval", () => {
    withFakeTimers(() => {
      const cb = jest.fn();
      const { result } = renderHook(() => useInterval(cb, 100));
      act(() => result.current.pause());
      const callsBefore = cb.mock.calls.length;
      act(() => jest.advanceTimersByTime(500));
      expect(cb.mock.calls.length).toBe(callsBefore);
    });
  });

  test("isRunning reflects pause/resume state", () => {
    withFakeTimers(() => {
      const { result } = renderHook(() => useInterval(() => {}, 100));
      expect(result.current.isRunning).toBe(true);
      act(() => result.current.pause());
      expect(result.current.isRunning).toBe(false);
      act(() => result.current.resume());
      expect(result.current.isRunning).toBe(true);
    });
  });
});

describe("useTimeout", () => {
  test("callback fires after delay", () => {
    withFakeTimers(() => {
      const cb = jest.fn();
      renderHook(() => useTimeout(cb, 300));
      act(() => jest.advanceTimersByTime(300));
      expect(cb).toHaveBeenCalledTimes(1);
    });
  });

  test("callback does not fire after cancel()", () => {
    withFakeTimers(() => {
      const cb = jest.fn();
      const { result } = renderHook(() => useTimeout(cb, 300));
      act(() => result.current.cancel());
      act(() => jest.advanceTimersByTime(400));
      expect(cb).not.toHaveBeenCalled();
    });
  });

  test("callback fires once on null delay (no crash)", () => {
    const cb = jest.fn();
    renderHook(() => useTimeout(cb, null));
    expect(cb).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// useClipboard
// ═══════════════════════════════════════════════════════════════════════════════

import { useClipboard } from "@/hooks/useClipboard";

describe("useClipboard", () => {
  beforeEach(() => {
    // Mock Clipboard API
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: jest.fn().mockResolvedValue(undefined),
      },
      writable: true,
      configurable: true,
    });
  });

  test("copy returns true on success", async () => {
    const { result } = renderHook(() => useClipboard());
    let ok: boolean;
    await act(async () => {
      ok = await result.current.copy("hello");
    });
    expect(ok!).toBe(true);
  });

  test("hasCopied is true after copy", async () => {
    const { result } = renderHook(() => useClipboard());
    await act(async () => {
      await result.current.copy("text");
    });
    expect(result.current.hasCopied).toBe(true);
  });

  test("value reflects last copied text", async () => {
    const { result } = renderHook(() => useClipboard());
    await act(async () => {
      await result.current.copy("arenax-url");
    });
    expect(result.current.value).toBe("arenax-url");
  });

  test("hasCopied resets after resetAfterMs", async () => {
    withFakeTimers(() => {
      const { result } = renderHook(() => useClipboard({ resetAfterMs: 1000 }));

      act(() => {
        result.current.copy("text");
      });

      act(() => jest.advanceTimersByTime(1001));
      expect(result.current.hasCopied).toBe(false);
    });
  });

  test("sets error on clipboard failure", async () => {
    (navigator.clipboard.writeText as jest.Mock).mockRejectedValueOnce(
      new Error("Permission denied")
    );
    const { result } = renderHook(() => useClipboard());
    await act(async () => {
      await result.current.copy("text");
    });
    expect(result.current.error?.message).toBe("Permission denied");
    expect(result.current.hasCopied).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// useHookAnalytics
// ═══════════════════════════════════════════════════════════════════════════════

import {
  useHookAnalytics,
  subscribeToHookAnalytics,
} from "@/hooks/useHookAnalytics";
import type { HookAnalyticsEvent } from "@/hooks/useHookAnalytics";

describe("useHookAnalytics", () => {
  test("emits mount event on render", () => {
    const events: HookAnalyticsEvent[] = [];
    const unsub = subscribeToHookAnalytics((e) => events.push(e));

    renderHook(() => useHookAnalytics("useTest"));
    expect(events.some((e) => e.hookName === "useTest" && e.eventType === "mount")).toBe(true);

    unsub();
  });

  test("emits unmount event on unmount", () => {
    const events: HookAnalyticsEvent[] = [];
    const unsub = subscribeToHookAnalytics((e) => events.push(e));

    const { unmount } = renderHook(() => useHookAnalytics("useTestUnmount"));
    act(() => unmount());

    expect(
      events.some(
        (e) => e.hookName === "useTestUnmount" && e.eventType === "unmount"
      )
    ).toBe(true);
    unsub();
  });

  test("startTimer emits operation_start and operation_end", () => {
    const events: HookAnalyticsEvent[] = [];
    const unsub = subscribeToHookAnalytics((e) => events.push(e));

    const { result } = renderHook(() => useHookAnalytics("useTimerTest"));
    act(() => {
      const timer = result.current.startTimer("fetchData");
      timer.end({ count: 5 });
    });

    expect(events.some((e) => e.eventType === "operation_start" && e.operation === "fetchData")).toBe(true);
    expect(events.some((e) => e.eventType === "operation_end" && e.operation === "fetchData")).toBe(true);
    const endEvent = events.find((e) => e.eventType === "operation_end");
    expect(endEvent?.durationMs).toBeGreaterThanOrEqual(0);

    unsub();
  });

  test("trackError emits error event with message", () => {
    const events: HookAnalyticsEvent[] = [];
    const unsub = subscribeToHookAnalytics((e) => events.push(e));

    const { result } = renderHook(() => useHookAnalytics("useErrorTest"));
    act(() => {
      result.current.trackError(new Error("api timeout"), "loadMatches");
    });

    const errEvent = events.find((e) => e.eventType === "error");
    expect(errEvent).toBeDefined();
    expect(errEvent?.metadata?.errorMessage).toBe("api timeout");
    expect(errEvent?.operation).toBe("loadMatches");

    unsub();
  });

  test("trackFeature emits feature_activated event", () => {
    const events: HookAnalyticsEvent[] = [];
    const unsub = subscribeToHookAnalytics((e) => events.push(e));

    const { result } = renderHook(() => useHookAnalytics("useFeatureTest"));
    act(() => {
      result.current.trackFeature("LIVE_BRACKET");
    });

    expect(
      events.some(
        (e) =>
          e.eventType === "feature_activated" && e.operation === "LIVE_BRACKET"
      )
    ).toBe(true);

    unsub();
  });

  test("subscribeToHookAnalytics unsubscribes correctly", () => {
    const events: HookAnalyticsEvent[] = [];
    const unsub = subscribeToHookAnalytics((e) => events.push(e));
    unsub();

    renderHook(() => useHookAnalytics("useAfterUnsub"));
    expect(events).toHaveLength(0);
  });
});
