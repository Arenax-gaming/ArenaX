/**
 * Tests for the progressive <ProgressiveImage /> component (#927).
 */
import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import {
  ProgressiveImage,
  LQIP_WIDTH,
  LQIP_QUALITY,
} from "@/components/common/Image";

// ─── IntersectionObserver mock ────────────────────────────────────────────────
type IOEntryish = { isIntersecting: boolean };
let ioInstances: MockIO[] = [];

class MockIO {
  callback: IntersectionObserverCallback;
  element: Element | null = null;
  constructor(cb: IntersectionObserverCallback) {
    this.callback = cb;
    ioInstances.push(this);
  }
  observe = (el: Element) => {
    this.element = el;
  };
  unobserve = jest.fn();
  disconnect = jest.fn();
  trigger(isIntersecting: boolean) {
    this.callback(
      [{ isIntersecting } as unknown as IntersectionObserverEntry],
      this as unknown as IntersectionObserver
    );
  }
}

beforeEach(() => {
  ioInstances = [];
  (global as unknown as { IntersectionObserver: unknown }).IntersectionObserver =
    jest.fn((cb: IntersectionObserverCallback) => new MockIO(cb));
});

const REMOTE = "https://cdn.example.com/hero.jpg";

describe("ProgressiveImage", () => {
  it("loads immediately when priority is set (no lazy wait)", () => {
    render(<ProgressiveImage src={REMOTE} alt="Hero banner" priority />);
    const img = screen.getByAltText("Hero banner") as HTMLImageElement;
    expect(img).toBeInTheDocument();
    expect(img.getAttribute("loading")).toBe("eager");
  });

  it("defers loading until the element scrolls into view", () => {
    render(<ProgressiveImage src={REMOTE} alt="Lazy image" />);
    // Nothing loaded yet.
    expect(screen.queryByAltText("Lazy image")).not.toBeInTheDocument();
    // Scroll into view.
    act(() => ioInstances[0].trigger(true));
    const img = screen.getByAltText("Lazy image") as HTMLImageElement;
    expect(img).toBeInTheDocument();
    expect(img.getAttribute("loading")).toBe("lazy");
  });

  it("emits a WebP <source> with a fallback for remote images", () => {
    const { container } = render(
      <ProgressiveImage src={REMOTE} alt="Pic" priority />
    );
    const sources = container.querySelectorAll("picture source");
    expect(sources.length).toBeGreaterThanOrEqual(2);
    const webp = container.querySelector('source[type="image/webp"]');
    expect(webp).not.toBeNull();
    expect(webp?.getAttribute("srcSet")).toContain("f=webp");
    // Responsive srcset carries width descriptors.
    expect(webp?.getAttribute("srcSet")).toMatch(/\d+w/);
  });

  it("derives a small, cheap LQIP within the size budget", () => {
    const { container } = render(
      <ProgressiveImage src={REMOTE} alt="Pic" priority />
    );
    const lqip = container.querySelector('img[aria-hidden="true"]') as HTMLImageElement;
    expect(lqip).not.toBeNull();
    expect(lqip.src).toContain(`w=${LQIP_WIDTH}`);
    expect(lqip.src).toContain(`q=${LQIP_QUALITY}`);
  });

  it("respects an explicit lqip override", () => {
    const tiny = "data:image/webp;base64,AAAA";
    const { container } = render(
      <ProgressiveImage src={REMOTE} alt="Pic" lqip={tiny} priority />
    );
    const lqip = container.querySelector('img[aria-hidden="true"]') as HTMLImageElement;
    expect(lqip.getAttribute("src")).toBe(tiny);
  });

  it("blurs-up: full image is transparent until it fires onLoad", () => {
    const onLoad = jest.fn();
    render(<ProgressiveImage src={REMOTE} alt="Fade" priority onLoad={onLoad} />);
    const img = screen.getByAltText("Fade");
    expect(img.className).toContain("opacity-0");
    fireEvent.load(img);
    expect(img.className).toContain("opacity-100");
    expect(onLoad).toHaveBeenCalledTimes(1);
  });

  it("falls back to fallbackSrc on error, then shows a broken state", () => {
    render(
      <ProgressiveImage
        src={REMOTE}
        alt="Broken"
        fallbackSrc="https://cdn.example.com/fallback.jpg"
        priority
      />
    );
    const img = screen.getByAltText("Broken");
    // First error → switch to fallback.
    fireEvent.error(img);
    const fallback = screen.getByAltText("Broken") as HTMLImageElement;
    expect(fallback.src).toContain("fallback.jpg");
    // Second error on the fallback → broken placeholder.
    fireEvent.error(fallback);
    expect(screen.getByRole("img", { name: "Broken" })).toBeInTheDocument();
  });

  it("marks the wrapper busy until the image loads", () => {
    render(<ProgressiveImage src={REMOTE} alt="Busy" priority />);
    const img = screen.getByAltText("Busy");
    const wrapper = img.closest("[aria-busy]");
    expect(wrapper?.getAttribute("aria-busy")).toBe("true");
    fireEvent.load(img);
    expect(wrapper?.getAttribute("aria-busy")).toBe("false");
  });
});
