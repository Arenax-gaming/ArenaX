/**
 * Error Boundary component tests
 *
 * Covers:
 *  - ErrorBoundary (full-page)
 *  - SectionErrorBoundary (inline)
 *  - ErrorBoundaryWithRetry (configurable max-retries)
 *  - PageErrorBoundary
 *
 * We intentionally suppress React's console.error output for expected render
 * errors to keep the test output clean.
 */

import React, { ReactNode } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { SectionErrorBoundary } from "@/components/common/SectionErrorBoundary";
import { ErrorBoundaryWithRetry } from "@/components/common/ErrorBoundaryWithRetry";
import { PageErrorBoundary } from "@/components/common/PageErrorBoundary";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** A component that throws when `shouldThrow` is true. */
function Bomb({
  shouldThrow = true,
  message = "Test render error",
}: {
  shouldThrow?: boolean;
  message?: string;
}) {
  if (shouldThrow) throw new Error(message);
  return <div>All good</div>;
}

/** Suppress expected React error output during boundary tests. */
function suppressConsoleError() {
  const spy = jest.spyOn(console, "error").mockImplementation(() => {});
  return spy;
}

// ─── ErrorBoundary (full-page) ────────────────────────────────────────────────

describe("ErrorBoundary", () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = suppressConsoleError();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("renders children when there is no error", () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("All good")).toBeInTheDocument();
  });

  it("renders fallback UI when a child throws", () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    // The error message should appear in technical details
    expect(screen.getByText(/Test render error/i)).toBeInTheDocument();
  });

  it("renders a custom fallback when provided", () => {
    render(
      <ErrorBoundary fallback={<div>Custom fallback</div>}>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Custom fallback")).toBeInTheDocument();
  });

  it("shows authentication UI for auth errors", () => {
    render(
      <ErrorBoundary>
        <Bomb message="Unauthorized access denied" />
      </ErrorBoundary>,
    );
    expect(screen.getByText(/Go to Login/i)).toBeInTheDocument();
  });

  it("calls onError callback when an error is caught", () => {
    const onError = jest.fn();
    render(
      <ErrorBoundary onError={onError}>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  it("resets and re-renders children after retry", () => {
    let shouldThrow = true;

    function Toggle() {
      if (shouldThrow) throw new Error("toggle error");
      return <div>Recovered</div>;
    }

    render(
      <ErrorBoundary>
        <Toggle />
      </ErrorBoundary>,
    );

    // Fallback is shown
    expect(screen.queryByText("Recovered")).not.toBeInTheDocument();

    // Fix the source of error then click Retry
    shouldThrow = false;
    fireEvent.click(screen.getByRole("button", { name: /refresh|retry/i }));
    expect(screen.getByText("Recovered")).toBeInTheDocument();
  });
});

// ─── SectionErrorBoundary ─────────────────────────────────────────────────────

describe("SectionErrorBoundary", () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = suppressConsoleError();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("renders children normally", () => {
    render(
      <SectionErrorBoundary label="Widget">
        <Bomb shouldThrow={false} />
      </SectionErrorBoundary>,
    );
    expect(screen.getByText("All good")).toBeInTheDocument();
  });

  it("shows inline error fallback with section label", () => {
    render(
      <SectionErrorBoundary label="Match Feed">
        <Bomb />
      </SectionErrorBoundary>,
    );
    expect(screen.getByText(/Match Feed failed to load/i)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("shows Retry button by default (not yet exhausted)", () => {
    render(
      <SectionErrorBoundary>
        <Bomb />
      </SectionErrorBoundary>,
    );
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("shows Sign in again for auth errors", () => {
    render(
      <SectionErrorBoundary>
        <Bomb message="Unauthorized — please authenticate" />
      </SectionErrorBoundary>,
    );
    expect(screen.getByRole("button", { name: /sign in again/i })).toBeInTheDocument();
  });

  it("calls onError callback", () => {
    const onError = jest.fn();
    render(
      <SectionErrorBoundary onError={onError}>
        <Bomb />
      </SectionErrorBoundary>,
    );
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("renders custom fallback when provided", () => {
    render(
      <SectionErrorBoundary fallback={<span>Section fallback</span>}>
        <Bomb />
      </SectionErrorBoundary>,
    );
    expect(screen.getByText("Section fallback")).toBeInTheDocument();
  });
});

// ─── ErrorBoundaryWithRetry ───────────────────────────────────────────────────

describe("ErrorBoundaryWithRetry", () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = suppressConsoleError();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("renders children normally", () => {
    render(
      <ErrorBoundaryWithRetry>
        <Bomb shouldThrow={false} />
      </ErrorBoundaryWithRetry>,
    );
    expect(screen.getByText("All good")).toBeInTheDocument();
  });

  it("shows error fallback when child throws", () => {
    render(
      <ErrorBoundaryWithRetry>
        <Bomb />
      </ErrorBoundaryWithRetry>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
  });

  it("shows Retry button within maxRetries", () => {
    render(
      <ErrorBoundaryWithRetry maxRetries={3}>
        <Bomb />
      </ErrorBoundaryWithRetry>,
    );
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("shows exhausted message when maxRetries is 0", () => {
    render(
      <ErrorBoundaryWithRetry maxRetries={0}>
        <Bomb />
      </ErrorBoundaryWithRetry>,
    );
    expect(screen.getByText(/Maximum retries/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });

  it("shows custom fallback after retries exhausted", () => {
    render(
      <ErrorBoundaryWithRetry maxRetries={0} fallback={<div>Custom exhausted</div>}>
        <Bomb />
      </ErrorBoundaryWithRetry>,
    );
    expect(screen.getByText("Custom exhausted")).toBeInTheDocument();
  });
});

// ─── PageErrorBoundary ────────────────────────────────────────────────────────

// PageErrorBoundary uses next-intl's useTranslations via PageError.
// We mock it to avoid setting up an intl provider in every test.

jest.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

describe("PageErrorBoundary", () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = suppressConsoleError();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("renders children when there is no error", () => {
    render(
      <PageErrorBoundary>
        <Bomb shouldThrow={false} />
      </PageErrorBoundary>,
    );
    expect(screen.getByText("All good")).toBeInTheDocument();
  });

  it("renders PageError fallback when child throws", () => {
    render(
      <PageErrorBoundary title="Page failed">
        <Bomb />
      </PageErrorBoundary>,
    );
    expect(screen.getByText("Page failed")).toBeInTheDocument();
  });

  it("shows the retry button and resets on click", () => {
    let shouldThrow = true;

    function Toggle() {
      if (shouldThrow) throw new Error("page error");
      return <div>Page OK</div>;
    }

    render(
      <PageErrorBoundary>
        <Toggle />
      </PageErrorBoundary>,
    );

    shouldThrow = false;
    fireEvent.click(screen.getByRole("button", { name: /retry|common\.retry/i }));
    expect(screen.getByText("Page OK")).toBeInTheDocument();
  });
});
