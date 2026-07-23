/**
 * Accessibility test suite
 *
 * Covers:
 * - lib/accessibility utilities (IDs, focus helpers, keyboard helpers, ARIA builders, contrast)
 * - AriaLiveRegion component
 * - SkipLink component
 * - Button component (ARIA / loading state)
 * - useFocusTrap hook
 * - AccessibilityProvider context
 * - useAriaLive hook
 */

import React, { useRef } from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import "@testing-library/jest-dom";
import { renderHook } from "@testing-library/react";

// ─── lib/accessibility ────────────────────────────────────────────────────────

import {
  generateAriaId,
  getFocusableElements,
  focusFirstElement,
  restoreFocus,
  handleFocusTrap,
  Keys,
  isActivationKey,
  createKeyboardActivationHandler,
  ariaBusy,
  ariaDisabled,
  ariaExpanded,
  ariaSelected,
  relativeLuminance,
  contrastRatio,
  meetsWcagContrast,
} from "@/lib/accessibility";

// ─────────────────────────────────────────────────────────────────────────────
// lib/accessibility utilities
// ─────────────────────────────────────────────────────────────────────────────

describe("generateAriaId", () => {
  it("returns a string starting with 'arenax-'", () => {
    expect(generateAriaId("foo")).toMatch(/^arenax-foo-/);
  });

  it("generates unique IDs on successive calls", () => {
    const a = generateAriaId("btn");
    const b = generateAriaId("btn");
    expect(a).not.toBe(b);
  });
});

describe("getFocusableElements", () => {
  it("returns buttons and links inside a container", () => {
    const div = document.createElement("div");
    div.innerHTML = `
      <button>B1</button>
      <a href="#">L1</a>
      <input type="text" />
      <span>not focusable</span>
    `;
    document.body.appendChild(div);
    const els = getFocusableElements(div);
    expect(els.length).toBe(3);
    document.body.removeChild(div);
  });

  it("excludes disabled inputs", () => {
    const div = document.createElement("div");
    div.innerHTML = `<input type="text" disabled /><button>OK</button>`;
    document.body.appendChild(div);
    const els = getFocusableElements(div);
    expect(els.length).toBe(1);
    expect(els[0]!.tagName).toBe("BUTTON");
    document.body.removeChild(div);
  });
});

describe("focusFirstElement", () => {
  it("moves focus to the first focusable element", () => {
    const div = document.createElement("div");
    div.innerHTML = `<button id="b1">First</button><button id="b2">Second</button>`;
    document.body.appendChild(div);
    focusFirstElement(div);
    expect(document.activeElement?.id).toBe("b1");
    document.body.removeChild(div);
  });

  it("focuses the container when no focusable children exist", () => {
    const div = document.createElement("div");
    div.setAttribute("tabindex", "-1");
    div.textContent = "No children";
    document.body.appendChild(div);
    focusFirstElement(div);
    expect(document.activeElement).toBe(div);
    document.body.removeChild(div);
  });
});

describe("restoreFocus", () => {
  it("moves focus back to the provided element", () => {
    const btn = document.createElement("button");
    btn.textContent = "Restore target";
    document.body.appendChild(btn);
    restoreFocus(btn);
    expect(document.activeElement).toBe(btn);
    document.body.removeChild(btn);
  });

  it("does nothing when passed null", () => {
    expect(() => restoreFocus(null)).not.toThrow();
  });

  it("does nothing when element is not in the DOM", () => {
    const detached = document.createElement("button");
    expect(() => restoreFocus(detached)).not.toThrow();
  });
});

describe("handleFocusTrap — Tab wrapping", () => {
  function setup() {
    const container = document.createElement("div");
    container.innerHTML = `
      <button id="first">First</button>
      <button id="second">Second</button>
      <button id="last">Last</button>
    `;
    document.body.appendChild(container);
    return container;
  }

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("wraps forward Tab from last element to first", () => {
    const container = setup();
    const last = container.querySelector<HTMLElement>("#last")!;
    last.focus();

    const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true });
    Object.defineProperty(event, "shiftKey", { value: false });
    handleFocusTrap(event, container);

    expect(document.activeElement?.id).toBe("first");
  });

  it("wraps backward Shift+Tab from first element to last", () => {
    const container = setup();
    const first = container.querySelector<HTMLElement>("#first")!;
    first.focus();

    const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true });
    Object.defineProperty(event, "shiftKey", { value: true });
    handleFocusTrap(event, container);

    expect(document.activeElement?.id).toBe("last");
  });

  it("does nothing for non-Tab keys", () => {
    const container = setup();
    const first = container.querySelector<HTMLElement>("#first")!;
    first.focus();

    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
    expect(() => handleFocusTrap(event, container)).not.toThrow();
    expect(document.activeElement?.id).toBe("first");
  });
});

describe("Keys constants", () => {
  it("exports all expected key names", () => {
    expect(Keys.Enter).toBe("Enter");
    expect(Keys.Space).toBe(" ");
    expect(Keys.Escape).toBe("Escape");
    expect(Keys.Tab).toBe("Tab");
    expect(Keys.ArrowDown).toBe("ArrowDown");
  });
});

describe("isActivationKey", () => {
  it("returns true for Enter", () => {
    expect(isActivationKey({ key: "Enter" } as React.KeyboardEvent)).toBe(true);
  });

  it("returns true for Space", () => {
    expect(isActivationKey({ key: " " } as React.KeyboardEvent)).toBe(true);
  });

  it("returns false for other keys", () => {
    expect(isActivationKey({ key: "Escape" } as React.KeyboardEvent)).toBe(false);
    expect(isActivationKey({ key: "Tab" } as React.KeyboardEvent)).toBe(false);
  });
});

describe("createKeyboardActivationHandler", () => {
  it("calls the handler when Enter is pressed", () => {
    const fn = jest.fn();
    const handler = createKeyboardActivationHandler(fn);
    handler({ key: "Enter", preventDefault: jest.fn() } as unknown as React.KeyboardEvent);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("calls the handler when Space is pressed", () => {
    const fn = jest.fn();
    const handler = createKeyboardActivationHandler(fn);
    handler({ key: " ", preventDefault: jest.fn() } as unknown as React.KeyboardEvent);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does NOT call the handler for other keys", () => {
    const fn = jest.fn();
    const handler = createKeyboardActivationHandler(fn);
    handler({ key: "Escape", preventDefault: jest.fn() } as unknown as React.KeyboardEvent);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("ARIA attribute builders", () => {
  it("ariaBusy returns correct prop", () => {
    expect(ariaBusy(true)).toEqual({ "aria-busy": true });
    expect(ariaBusy(false)).toEqual({ "aria-busy": false });
  });

  it("ariaDisabled returns correct prop", () => {
    expect(ariaDisabled(true)).toEqual({ "aria-disabled": true });
  });

  it("ariaExpanded returns correct props", () => {
    expect(ariaExpanded(true, "panel-1")).toEqual({
      "aria-expanded": true,
      "aria-controls": "panel-1",
    });
  });

  it("ariaSelected returns correct prop", () => {
    expect(ariaSelected(false)).toEqual({ "aria-selected": false });
  });
});

// ─── Colour contrast ──────────────────────────────────────────────────────────

describe("WCAG colour contrast", () => {
  it("relativeLuminance: white = 1", () => {
    expect(relativeLuminance(255, 255, 255)).toBeCloseTo(1, 2);
  });

  it("relativeLuminance: black = 0", () => {
    expect(relativeLuminance(0, 0, 0)).toBeCloseTo(0, 5);
  });

  it("contrastRatio: black on white = 21:1", () => {
    const white = relativeLuminance(255, 255, 255);
    const black = relativeLuminance(0, 0, 0);
    expect(contrastRatio(white, black)).toBeCloseTo(21, 0);
  });

  it("meetsWcagContrast AA: 4.5:1 passes", () => {
    expect(meetsWcagContrast(4.5, "AA")).toBe(true);
  });

  it("meetsWcagContrast AA: 4.49:1 fails", () => {
    expect(meetsWcagContrast(4.49, "AA")).toBe(false);
  });

  it("meetsWcagContrast AAA: 7:1 passes", () => {
    expect(meetsWcagContrast(7, "AAA")).toBe(true);
  });

  it("meetsWcagContrast AA-large: 3:1 passes", () => {
    expect(meetsWcagContrast(3, "AA-large")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AriaLiveRegion component
// ─────────────────────────────────────────────────────────────────────────────

import { AriaLiveRegion, StatusAnnouncer, AlertAnnouncer } from "@/components/common/AriaLiveRegion";

describe("AriaLiveRegion", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => { jest.runAllTimers(); jest.useRealTimers(); });

  it("renders a visually-hidden container", () => {
    const { container } = render(<AriaLiveRegion message="" />);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain("sr-only");
  });

  it("applies aria-live='polite' by default", () => {
    const { container } = render(<AriaLiveRegion message="hello" />);
    expect(container.firstChild).toHaveAttribute("aria-live", "polite");
  });

  it("applies aria-live='assertive' when specified", () => {
    const { container } = render(<AriaLiveRegion message="urgent" ariaLive="assertive" />);
    expect(container.firstChild).toHaveAttribute("aria-live", "assertive");
  });

  it("announces the message after a short delay (clears then sets)", async () => {
    render(<AriaLiveRegion message="Saved successfully" />);
    act(() => jest.advanceTimersByTime(100));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved successfully"));
  });

  it("clears and re-announces when the same message is set again", async () => {
    const { rerender } = render(<AriaLiveRegion message="Loading" />);
    act(() => jest.advanceTimersByTime(100));
    rerender(<AriaLiveRegion message="" />);
    rerender(<AriaLiveRegion message="Loading" />);
    act(() => jest.advanceTimersByTime(100));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Loading"));
  });

  it("StatusAnnouncer renders with polite live region", () => {
    const { container } = render(<StatusAnnouncer message="3 results" />);
    expect(container.firstChild).toHaveAttribute("aria-live", "polite");
  });

  it("AlertAnnouncer renders with assertive live region", () => {
    const { container } = render(<AlertAnnouncer message="Error!" />);
    expect(container.firstChild).toHaveAttribute("aria-live", "assertive");
    expect(container.firstChild).toHaveAttribute("role", "alert");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SkipLink component
// ─────────────────────────────────────────────────────────────────────────────

import { SkipLink } from "@/components/ui/SkipLink";

describe("SkipLink", () => {
  it("renders a link with the correct href", () => {
    render(<SkipLink targetId="main-content" />);
    expect(screen.getByRole("link", { name: "Skip to main content" })).toHaveAttribute(
      "href",
      "#main-content",
    );
  });

  it("uses a custom label when provided", () => {
    render(<SkipLink targetId="nav" label="Skip navigation" />);
    expect(screen.getByRole("link", { name: "Skip navigation" })).toBeInTheDocument();
  });

  it("moves focus to the target on click", () => {
    const main = document.createElement("main");
    main.id = "main-content";
    main.setAttribute("tabindex", "-1");
    document.body.appendChild(main);

    render(<SkipLink targetId="main-content" />);
    fireEvent.click(screen.getByRole("link", { name: "Skip to main content" }));
    expect(document.activeElement).toBe(main);

    document.body.removeChild(main);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Button component — ARIA / loading
// ─────────────────────────────────────────────────────────────────────────────

import { Button } from "@/components/ui/Button";

describe("Button — accessibility", () => {
  it("renders a native <button> element", () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole("button", { name: "Click me" })).toBeInTheDocument();
  });

  it("accepts and applies aria-label", () => {
    render(<Button aria-label="Submit form">→</Button>);
    expect(screen.getByRole("button", { name: "Submit form" })).toBeInTheDocument();
  });

  it("is disabled and aria-disabled when disabled prop is true", () => {
    render(<Button disabled>Disabled</Button>);
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-disabled", "true");
  });

  it("sets aria-busy and aria-disabled during loading", () => {
    render(<Button loading>Save</Button>);
    const btn = screen.getByRole("button");
    expect(btn).toHaveAttribute("aria-busy", "true");
    expect(btn).toHaveAttribute("aria-disabled", "true");
    expect(btn).toBeDisabled();
  });

  it("renders a sr-only loading label when loading", () => {
    render(<Button loading loadingLabel="Saving…">Save</Button>);
    expect(screen.getByText("Saving…")).toHaveClass("sr-only");
  });

  it("spinner SVG has aria-hidden when loading", () => {
    const { container } = render(<Button loading>Save</Button>);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });

  it("has visible focus ring classes", () => {
    render(<Button>Focus me</Button>);
    const btn = screen.getByRole("button");
    expect(btn.className).toContain("focus-visible:ring-2");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AccessibilityProvider context
// ─────────────────────────────────────────────────────────────────────────────

import { AccessibilityProvider, useAccessibility } from "@/components/providers/AccessibilityProvider";

// Minimal consumer component for hook testing
function PrefsConsumer() {
  const { preferences, updatePreferences } = useAccessibility();
  return (
    <div>
      <span data-testid="sr">{String(preferences.screenReaderEnabled)}</span>
      <button
        onClick={() => updatePreferences({ screenReaderEnabled: true })}
      >
        Enable SR
      </button>
    </div>
  );
}

function AnnounceConsumer() {
  const { announce } = useAccessibility();
  return (
    <button onClick={() => announce("Test message", "polite")}>
      Announce
    </button>
  );
}

describe("AccessibilityProvider", () => {
  it("provides preferences with defaults", () => {
    render(
      <AccessibilityProvider>
        <PrefsConsumer />
      </AccessibilityProvider>,
    );
    expect(screen.getByTestId("sr")).toHaveTextContent("false");
  });

  it("updatePreferences updates the context state", () => {
    render(
      <AccessibilityProvider>
        <PrefsConsumer />
      </AccessibilityProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Enable SR" }));
    expect(screen.getByTestId("sr")).toHaveTextContent("true");
  });

  it("throws when useAccessibility is used outside provider", () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<PrefsConsumer />)).toThrow(
      "useAccessibility must be used within an AccessibilityProvider",
    );
    spy.mockRestore();
  });

  it("announce function does not throw", () => {
    render(
      <AccessibilityProvider>
        <AnnounceConsumer />
      </AccessibilityProvider>,
    );
    expect(() => fireEvent.click(screen.getByRole("button", { name: "Announce" }))).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// useFocusTrap hook
// ─────────────────────────────────────────────────────────────────────────────

import { useFocusTrap } from "@/hooks/useFocusTrap";

function TrapConsumer({
  enabled,
  onEscape,
}: {
  enabled: boolean;
  onEscape?: () => void;
}) {
  const { containerRef } = useFocusTrap({ enabled, onEscape });
  return (
    <div ref={containerRef as React.Ref<HTMLDivElement>} data-testid="trap">
      <button>First</button>
      <button>Second</button>
      <button>Last</button>
    </div>
  );
}

describe("useFocusTrap", () => {
  it("returns a containerRef that can be attached to a div", () => {
    render(<TrapConsumer enabled={false} />);
    expect(screen.getByTestId("trap")).toBeInTheDocument();
  });

  it("calls onEscape when Escape is pressed while enabled", () => {
    const onEscape = jest.fn();
    render(<TrapConsumer enabled={true} onEscape={onEscape} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it("does not call onEscape when disabled", () => {
    const onEscape = jest.fn();
    render(<TrapConsumer enabled={false} onEscape={onEscape} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onEscape).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// useAriaLive hook
// ─────────────────────────────────────────────────────────────────────────────

import { useAriaLive } from "@/hooks/useAriaLive";

function AriaLiveConsumer() {
  const { announcePolite, announceAssertive } = useAriaLive();
  return (
    <>
      <button onClick={() => announcePolite("Polite message")}>Polite</button>
      <button onClick={() => announceAssertive("Assertive message")}>Assertive</button>
    </>
  );
}

describe("useAriaLive", () => {
  it("renders without throwing inside AccessibilityProvider", () => {
    render(
      <AccessibilityProvider>
        <AriaLiveConsumer />
      </AccessibilityProvider>,
    );
    expect(screen.getByRole("button", { name: "Polite" })).toBeInTheDocument();
  });

  it("announcePolite does not throw when called", () => {
    render(
      <AccessibilityProvider>
        <AriaLiveConsumer />
      </AccessibilityProvider>,
    );
    expect(() =>
      fireEvent.click(screen.getByRole("button", { name: "Polite" })),
    ).not.toThrow();
  });

  it("announceAssertive does not throw when called", () => {
    render(
      <AccessibilityProvider>
        <AriaLiveConsumer />
      </AccessibilityProvider>,
    );
    expect(() =>
      fireEvent.click(screen.getByRole("button", { name: "Assertive" })),
    ).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Keyboard navigation — ARIA landmark roles
// ─────────────────────────────────────────────────────────────────────────────

describe("ARIA landmark roles", () => {
  it("recognises role=main", () => {
    render(<main role="main" id="content">Content</main>);
    expect(screen.getByRole("main")).toBeInTheDocument();
  });

  it("recognises role=navigation", () => {
    render(<nav aria-label="Primary navigation">Nav</nav>);
    expect(screen.getByRole("navigation", { name: "Primary navigation" })).toBeInTheDocument();
  });

  it("recognises role=contentinfo (footer)", () => {
    render(<footer role="contentinfo">Footer</footer>);
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
  });

  it("recognises role=banner (header)", () => {
    render(<header role="banner">Header</header>);
    expect(screen.getByRole("banner")).toBeInTheDocument();
  });

  it("recognises role=dialog with aria-modal", () => {
    render(
      <div role="dialog" aria-modal="true" aria-label="Settings">
        Dialog content
      </div>,
    );
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Screen reader — sr-only utility class usage
// ─────────────────────────────────────────────────────────────────────────────

describe("sr-only text", () => {
  it("sr-only elements are in the DOM but visually hidden via CSS class", () => {
    render(
      <span className="sr-only">Visually hidden description</span>,
    );
    const el = screen.getByText("Visually hidden description");
    expect(el).toBeInTheDocument();
    expect(el.className).toContain("sr-only");
  });
});
