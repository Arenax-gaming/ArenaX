/**
 * Match queue leave guard (Issue #1320).
 */

import { act, renderHook } from "@testing-library/react";
import { useNavigationGuard } from "@/hooks/useNavigationGuard";

const push = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

function fireBeforeUnload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

function clickLink(href: string) {
  const anchor = document.createElement("a");
  anchor.href = href;
  document.body.appendChild(anchor);
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
  anchor.dispatchEvent(event);
  anchor.remove();
  return event.defaultPrevented;
}

describe("useNavigationGuard", () => {
  beforeEach(() => push.mockClear());

  it("warns on tab close only while active, and cleans up on unmount", () => {
    const { rerender, unmount } = renderHook(({ when }) => useNavigationGuard(when), {
      initialProps: { when: true },
    });
    expect(fireBeforeUnload()).toBe(true);

    // Match ended naturally → no more warning.
    rerender({ when: false });
    expect(fireBeforeUnload()).toBe(false);

    rerender({ when: true });
    unmount();
    expect(fireBeforeUnload()).toBe(false);
  });

  it("holds in-app link navigation until confirmed", () => {
    const { result } = renderHook(() => useNavigationGuard(true));

    let prevented = false;
    act(() => {
      prevented = clickLink("/tournaments");
    });
    expect(prevented).toBe(true);
    expect(result.current.isBlocked).toBe(true);
    expect(push).not.toHaveBeenCalled();

    act(() => result.current.confirm());
    expect(push).toHaveBeenCalledWith("/tournaments");
    expect(result.current.isBlocked).toBe(false);
  });

  it("cancel keeps the user on the page", () => {
    const { result } = renderHook(() => useNavigationGuard(true));
    act(() => {
      clickLink("/leaderboard");
    });
    act(() => result.current.cancel());
    expect(result.current.isBlocked).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });

  it("does not intercept links while inactive", () => {
    renderHook(() => useNavigationGuard(false));
    expect(clickLink("/tournaments")).toBe(false);
  });
});
