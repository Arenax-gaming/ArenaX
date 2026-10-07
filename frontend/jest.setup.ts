import "@testing-library/jest-dom";
import { TextDecoder, TextEncoder } from "util";

// jsdom doesn't provide the Fetch API's Response — route handlers under test
// (e.g. the OG image 404s) construct one directly.
if (typeof (globalThis as { Response?: unknown }).Response === "undefined") {
  class TestResponse {
    status: number;
    ok: boolean;
    headers: Headers;
    body: unknown;

    constructor(body?: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
      this.status = init.status ?? 200;
      this.ok = this.status >= 200 && this.status < 300;
      this.headers = new Headers(init.headers);
      this.body = body;
    }

    async text(): Promise<string> {
      return typeof this.body === "string" ? this.body : "";
    }

    async json(): Promise<unknown> {
      return JSON.parse(await this.text());
    }

    static json(data: unknown, init: { status?: number } = {}): TestResponse {
      return new Response(JSON.stringify(data), {
        status: init.status ?? 200,
        headers: { "content-type": "application/json" },
      });
    }
  }
  (globalThis as { Response?: unknown }).Response = TestResponse;
}

if (typeof global.TextEncoder === "undefined") {
  // Required by stellar-sdk in Jest runtime.
  global.TextEncoder = TextEncoder as unknown as typeof global.TextEncoder;
}

if (typeof global.TextDecoder === "undefined") {
  global.TextDecoder = TextDecoder as unknown as typeof global.TextDecoder;
}

// jsdom doesn't implement scrollIntoView — stub it so focus helpers don't crash.
if (typeof window !== "undefined" && typeof Element !== "undefined" &&
    !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// jsdom doesn't implement matchMedia — provide a minimal stub so components
// that probe prefers-reduced-motion / prefers-contrast don't crash in tests.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

// jsdom doesn't implement ResizeObserver — provide a no-op stub so hooks that
// observe layout (e.g. useResponsive) can mount in tests. Suites that need to
// assert on callback behavior override `global.ResizeObserver` themselves.
if (typeof global.ResizeObserver === "undefined") {
  global.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

// Global next/navigation mock so components using useRouter, useSearchParams,
// or usePathname (such as MatchHistory) mount cleanly in tests without requiring
// every single test suite to manually declare the same mock.
jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
    back: jest.fn(),
    forward: jest.fn(),
    refresh: jest.fn(),
  }),
  usePathname: () => "/en/profile",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ locale: "en" }),
}));
