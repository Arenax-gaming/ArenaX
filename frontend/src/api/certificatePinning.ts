/**
 * SSL/TLS certificate pinning for the ArenaX API client.
 *
 * Full certificate/public-key pinning (rejecting a connection whose server
 * certificate doesn't match a known-good key, even if it's issued by a
 * publicly trusted CA) cannot be enforced from JavaScript in a standard web
 * browser: the TLS handshake completes before any page JS runs, and
 * fetch/XHR expose no hook into the certificate that was presented. Real
 * enforcement has to happen natively:
 *   - iOS: `NSURLSession` server-trust evaluation (App Transport Security
 *     pinning dictionary) or TrustKit, configured via Info.plist / a
 *     `URLSessionDelegate`.
 *   - Android: Network Security Config `<pin-set>`
 *     (res/xml/network_security_config.xml) or OkHttp's `CertificatePinner`.
 *   - React Native / Capacitor wrappers around ArenaX web: a native module
 *     bridging to the platform APIs above.
 *
 * This module is the pinning *policy* (the pin set, with rotation support)
 * plus the client-side integration point. When a native pinning bridge is
 * present — the mobile app shell — every request is checked against it
 * before being allowed to proceed. On plain web, where no such bridge
 * exists, it explicitly falls back to the browser's system trust store
 * (still full HTTPS, just without the additional key pin) rather than
 * silently no-op'ing. See `docs/security/certificate-pinning.md` for the
 * update/rotation runbook.
 */

export interface CertificatePin {
  /** Base64-encoded SHA-256 hash of the certificate's SubjectPublicKeyInfo (the `pin-sha256` value from HPKP-style pinning). */
  sha256: string;
  /** ISO-8601 timestamp after which this pin is no longer offered to the native bridge. */
  expiresAt: string;
}

export interface HostPinSet {
  host: string;
  /** Pin for the certificate currently served in production. */
  primary: CertificatePin;
  /**
   * Pin for the certificate/key ArenaX will rotate to next. Publishing this
   * ahead of the actual rotation means clients on an older app build (which
   * only knows the primary pin) keep working right up to rotation, and
   * clients on a newer build (which already knows the backup pin) work
   * immediately after — there is no window where a fully-updated client is
   * locked out.
   */
  backup: CertificatePin;
}

/**
 * Pin set for ArenaX's API hosts.
 *
 * The hashes below are placeholders and MUST be replaced with the real
 * production SPKI pins before this is relied on for enforcement — see
 * `docs/security/certificate-pinning.md#computing-a-pin` for how to compute
 * them from the live certificate.
 */
export const PIN_SETS: HostPinSet[] = [
  {
    host: "api.arenax.gg",
    primary: {
      sha256: "REPLACE_WITH_PRODUCTION_SPKI_PIN_BASE64",
      expiresAt: "2027-01-01T00:00:00Z",
    },
    backup: {
      sha256: "REPLACE_WITH_PRODUCTION_BACKUP_SPKI_PIN_BASE64",
      expiresAt: "2027-07-01T00:00:00Z",
    },
  },
];

/** Returns the pins for `host` that haven't passed their `expiresAt`. */
export function getActivePins(host: string, now: Date = new Date()): CertificatePin[] {
  const set = PIN_SETS.find((s) => s.host === host);
  if (!set) return [];
  return [set.primary, set.backup].filter((pin) => new Date(pin.expiresAt) > now);
}

/**
 * Contract a native shell (React Native / Capacitor) implements and exposes
 * on `window.__ARENAX_NATIVE__` to let web code ask "does this host's
 * certificate match one of these pins?" using the platform's real TLS
 * inspection.
 */
export interface NativePinningBridge {
  verifyCertificate(host: string, pinsSha256: string[]): Promise<boolean>;
}

function getNativeBridge(): NativePinningBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { __ARENAX_NATIVE__?: NativePinningBridge }).__ARENAX_NATIVE__;
}

export type PinningResult =
  | { enforced: true; allowed: boolean; reason: "native-verified" | "native-rejected" }
  | {
      enforced: false;
      allowed: true;
      reason: "no-native-bridge-fallback-to-system-trust" | "no-pins-configured-for-host";
    };

/**
 * Checks pinning status for `host` without making a request. `pinnedFetch`
 * calls this before every request; exported separately so it can be
 * inspected/tested directly and reused for diagnostics.
 */
export async function verifyPinnedConnection(host: string): Promise<PinningResult> {
  const bridge = getNativeBridge();

  if (!bridge) {
    // Fallback to system trust: no native TLS-inspection hook exists (we're
    // running as a plain web page), so we rely on the browser's own trust
    // store. The connection is still HTTPS-only; it just isn't additionally
    // key-pinned from here.
    return { enforced: false, allowed: true, reason: "no-native-bridge-fallback-to-system-trust" };
  }

  const pins = getActivePins(host);
  if (pins.length === 0) {
    // Don't fail closed on a configuration gap (a host with no/expired
    // pins), but this is worth alerting on — it means pinning silently
    // isn't happening for this host despite a native bridge being present.
    // eslint-disable-next-line no-console
    console.warn(`[certificate-pinning] no active pins configured for host "${host}"`);
    return { enforced: false, allowed: true, reason: "no-pins-configured-for-host" };
  }

  const allowed = await bridge.verifyCertificate(
    host,
    pins.map((pin) => pin.sha256),
  );
  return { enforced: true, allowed, reason: allowed ? "native-verified" : "native-rejected" };
}

export class CertificatePinningError extends Error {
  constructor(host: string) {
    super(`Connection to "${host}" was rejected: certificate did not match any pinned key.`);
    this.name = "CertificatePinningError";
  }
}

function resolveHost(input: RequestInfo | URL): string | undefined {
  try {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const base = typeof window !== "undefined" ? window.location.origin : undefined;
    return new URL(raw, base).host;
  } catch {
    return undefined;
  }
}

/**
 * Drop-in replacement for the global `fetch()` that enforces certificate
 * pinning (when a native bridge is present) before the request is made.
 * Every API client call site should go through this instead of calling
 * `fetch` directly.
 */
export async function pinnedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const host = resolveHost(input);

  if (host) {
    const result = await verifyPinnedConnection(host);
    if (!result.allowed) {
      throw new CertificatePinningError(host);
    }
  }

  return fetch(input, init);
}
