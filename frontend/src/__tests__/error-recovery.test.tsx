/**
 * useErrorRecovery hook tests
 *
 * Uses @testing-library/react's renderHook to exercise the retry/back-off
 * logic.  Timers are faked so tests run without real delays.
 */

import { renderHook, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { useErrorRecovery } from "@/hooks/useErrorRecovery";
import { NetworkError, AuthenticationError, ValidationError } from "@/lib/errors";

// ─── Setup: fake timers ───────────────────────────────────────────────────────

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.runAllTimers();
  jest.useRealTimers();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Creates an action that fails `failTimes` then succeeds.
 */
function makeFlaky<T>(failTimes: number, successValue: T): () => Promise<T> {
  let callCount = 0;
  return async () => {
    callCount++;
    if (callCount <= failTimes) {
      throw new NetworkError(`Attempt ${callCount} failed`);
    }
    return successValue;
  };
}

/**
 * Creates an action that always rejects with the given error.
 */
function makeAlwaysFail(error: Error): () => Promise<never> {
  return async () => { throw error; };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useErrorRecovery", () => {
  it("starts in idle state", () => {
    const { result } = renderHook(() => useErrorRecovery());
    expect(result.current.status).toBe("idle");
    expect(result.current.attempts).toBe(0);
    expect(result.current.error).toBeNull();
  });

  it("returns the result on immediate success", async () => {
    const { result } = renderHook(() => useErrorRecovery<string>());

    let returnValue: string | undefined;
    await act(async () => {
      returnValue = await result.current.execute(async () => "hello");
    });

    expect(returnValue).toBe("hello");
    expect(result.current.status).toBe("succeeded");
    expect(result.current.attempts).toBe(0);
    expect(result.current.error).toBeNull();
  });

  it("retries a flaky action and eventually succeeds", async () => {
    const action = makeFlaky(2, "done");
    const { result } = renderHook(() => useErrorRecovery<string>());

    let returnValue: string | undefined;
    await act(async () => {
      const promise = result.current.execute(action);
      // Advance through retry delays
      jest.runAllTimers();
      returnValue = await promise;
    });

    expect(returnValue).toBe("done");
    expect(result.current.status).toBe("succeeded");
  });

  it("transitions to failed after exhausting all retries", async () => {
    const onExhausted = jest.fn();
    const { result } = renderHook(() =>
      useErrorRecovery({ onExhausted, strategy: { maxAttempts: 2 } }),
    );

    await act(async () => {
      const promise = result.current.execute(makeAlwaysFail(new NetworkError("down")));
      jest.runAllTimers();
      await promise;
    });

    expect(result.current.status).toBe("failed");
    expect(onExhausted).toHaveBeenCalledTimes(1);
  });

  it("does not retry non-retryable (auth) errors", async () => {
    const onExhausted = jest.fn();
    const { result } = renderHook(() => useErrorRecovery({ onExhausted }));

    await act(async () => {
      await result.current.execute(makeAlwaysFail(new AuthenticationError("401")));
    });

    expect(result.current.status).toBe("failed");
    expect(result.current.attempts).toBe(0);
    expect(onExhausted).toHaveBeenCalledTimes(1);
  });

  it("does not retry non-retryable (validation) errors", async () => {
    const { result } = renderHook(() => useErrorRecovery());

    await act(async () => {
      await result.current.execute(makeAlwaysFail(new ValidationError("bad email")));
    });

    expect(result.current.status).toBe("failed");
    expect(result.current.isRetryable).toBe(false);
  });

  it("calls onRecovered when a retry succeeds", async () => {
    const onRecovered = jest.fn();
    const action = makeFlaky(1, "ok");
    const { result } = renderHook(() => useErrorRecovery<string>({ onRecovered }));

    await act(async () => {
      const promise = result.current.execute(action);
      jest.runAllTimers();
      await promise;
    });

    expect(onRecovered).toHaveBeenCalledWith(1);
  });

  it("reset() returns hook to idle", async () => {
    const { result } = renderHook(() => useErrorRecovery());

    await act(async () => {
      await result.current.execute(makeAlwaysFail(new NetworkError("x")));
    });

    expect(result.current.status).toBe("failed");

    act(() => {
      result.current.reset();
    });

    expect(result.current.status).toBe("idle");
    expect(result.current.error).toBeNull();
    expect(result.current.attempts).toBe(0);
  });

  it("captures the error object on failure", async () => {
    const err = new NetworkError("captured");
    const { result } = renderHook(() => useErrorRecovery({ strategy: { maxAttempts: 0 } }));

    await act(async () => {
      await result.current.execute(makeAlwaysFail(err));
    });

    expect(result.current.error).toBe(err);
  });

  it("creates a loggedError entry on first failure", async () => {
    const { result } = renderHook(() =>
      useErrorRecovery({ strategy: { maxAttempts: 0 } }),
    );

    await act(async () => {
      await result.current.execute(makeAlwaysFail(new NetworkError("log me")));
    });

    expect(result.current.loggedError).not.toBeNull();
    expect(result.current.loggedError?.message).toBe("log me");
  });
});
