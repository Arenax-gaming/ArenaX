import {
  CertificatePinningError,
  getActivePins,
  PIN_SETS,
  pinnedFetch,
  verifyPinnedConnection,
} from "@/api/certificatePinning";

describe("getActivePins", () => {
  it("returns configured pins that haven't expired", () => {
    const host = PIN_SETS[0].host;
    const pins = getActivePins(host, new Date("2026-01-01T00:00:00Z"));
    expect(pins).toHaveLength(2);
  });

  it("filters out pins past their expiresAt", () => {
    const host = PIN_SETS[0].host;
    const pins = getActivePins(host, new Date("2028-01-01T00:00:00Z"));
    expect(pins).toHaveLength(0);
  });

  it("returns nothing for an unknown host", () => {
    expect(getActivePins("unknown.example.com")).toHaveLength(0);
  });
});

describe("verifyPinnedConnection", () => {
  const win = window as unknown as { __ARENAX_NATIVE__?: unknown };

  afterEach(() => {
    delete win.__ARENAX_NATIVE__;
  });

  it("falls back to system trust when no native bridge is present", async () => {
    const result = await verifyPinnedConnection(PIN_SETS[0].host);
    expect(result).toEqual({
      enforced: false,
      allowed: true,
      reason: "no-native-bridge-fallback-to-system-trust",
    });
  });

  it("allows the connection when the native bridge verifies the pin", async () => {
    win.__ARENAX_NATIVE__ = {
      verifyCertificate: jest.fn().mockResolvedValue(true),
    };
    const result = await verifyPinnedConnection(PIN_SETS[0].host);
    expect(result).toEqual({ enforced: true, allowed: true, reason: "native-verified" });
  });

  it("rejects the connection when the native bridge fails verification", async () => {
    win.__ARENAX_NATIVE__ = {
      verifyCertificate: jest.fn().mockResolvedValue(false),
    };
    const result = await verifyPinnedConnection(PIN_SETS[0].host);
    expect(result).toEqual({ enforced: true, allowed: false, reason: "native-rejected" });
  });

  it("does not fail closed for a host with no configured pins, even with a bridge present", async () => {
    win.__ARENAX_NATIVE__ = {
      verifyCertificate: jest.fn().mockResolvedValue(false),
    };
    const result = await verifyPinnedConnection("unknown.example.com");
    expect(result).toEqual({
      enforced: false,
      allowed: true,
      reason: "no-pins-configured-for-host",
    });
  });
});

describe("pinnedFetch", () => {
  const win = window as unknown as { __ARENAX_NATIVE__?: unknown };
  const originalFetch = global.fetch;

  afterEach(() => {
    delete win.__ARENAX_NATIVE__;
    global.fetch = originalFetch;
  });

  it("passes the request through to fetch when allowed", async () => {
    const mockFetch = jest.fn().mockResolvedValue({ ok: true } as Response);
    global.fetch = mockFetch as unknown as typeof fetch;

    const response = await pinnedFetch("https://unpinned.example.com/api/ping");
    expect(mockFetch).toHaveBeenCalledWith("https://unpinned.example.com/api/ping", undefined);
    expect(response.ok).toBe(true);
  });

  it("throws CertificatePinningError and never calls fetch when the bridge rejects the pin", async () => {
    win.__ARENAX_NATIVE__ = {
      verifyCertificate: jest.fn().mockResolvedValue(false),
    };
    const mockFetch = jest.fn();
    global.fetch = mockFetch as unknown as typeof fetch;

    await expect(pinnedFetch(`https://${PIN_SETS[0].host}/api/ping`)).rejects.toThrow(
      CertificatePinningError,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
