/**
 * Unit tests for the dynamic OG image routes (#1097).
 *
 * `next/og`'s `ImageResponse` does real satori/WASM rendering, which isn't
 * worth exercising in a unit test — it's mocked here to a simple stub that
 * captures its constructor args (JSX tree + options) so we can assert on
 * *what* would be rendered and the response headers, without needing a full
 * Edge runtime.
 */

const mockImageResponse = jest.fn();
jest.mock("next/og", () => ({
  ImageResponse: class {
    headers = new Headers();
    constructor(jsx: unknown, options: unknown) {
      mockImageResponse(jsx, options);
    }
  },
}));

function fakeRequest(searchParams: Record<string, string> = {}) {
  return {
    nextUrl: { searchParams: new URLSearchParams(searchParams) },
  } as unknown as import("next/server").NextRequest;
}

describe("GET /api/og/achievement/[id]", () => {
  it("returns 404 for an unknown achievement id", async () => {
    const { GET } = await import("@/app/api/og/achievement/[id]/route");
    const res = await GET(fakeRequest(), { params: { id: "not-a-real-id" } });
    expect(res.status).toBe(404);
  });

  it("renders a 1200x630 image with a day-long cache header for a known achievement", async () => {
    const { GET } = await import("@/app/api/og/achievement/[id]/route");
    const res = await GET(fakeRequest(), { params: { id: "a1" } });

    expect(mockImageResponse).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ width: 1200, height: 630 }),
    );
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=86400, immutable");
  });

  it("includes the player name in the rendered tree when ?player= is set", async () => {
    const { GET } = await import("@/app/api/og/achievement/[id]/route");
    await GET(fakeRequest({ player: "Alpha" }), { params: { id: "a1" } });

    const [jsx] = mockImageResponse.mock.calls.at(-1)!;
    expect(JSON.stringify(jsx)).toContain("Unlocked by Alpha");
  });
});

describe("GET /api/og/tournament/[id]/result", () => {
  it("returns 404 for an unknown tournament id", async () => {
    const { GET } = await import("@/app/api/og/tournament/[id]/result/route");
    const res = await GET(fakeRequest(), { params: { id: "not-a-real-id" } });
    expect(res.status).toBe(404);
  });

  it("renders top standings and the prize pool for a known tournament", async () => {
    const { GET } = await import("@/app/api/og/tournament/[id]/result/route");
    const res = await GET(
      fakeRequest({ first: "Alpha", second: "Bravo" }),
      { params: { id: "1" } },
    );

    expect(mockImageResponse).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ width: 1200, height: 630 }),
    );
    const [jsx] = mockImageResponse.mock.calls.at(-1)!;
    const serialized = JSON.stringify(jsx);
    expect(serialized).toContain("Alpha");
    expect(serialized).toContain("Bravo");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=86400, immutable");
  });
});
