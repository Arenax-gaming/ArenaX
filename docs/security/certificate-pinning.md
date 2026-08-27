# SSL/TLS Certificate Pinning

## What this protects against

Without pinning, the frontend trusts any certificate chaining to a
CA in the platform's trust store. If that trust store is compromised
— a rogue enterprise/government CA, a malicious root installed on a
device, a compromised CA — an attacker can MITM API traffic even
though the connection is "valid HTTPS". Pinning adds a second check:
the server's key must match one we've explicitly published, not just
chain to *any* trusted CA.

## Where this lives

- `frontend/src/api/certificatePinning.ts` — the pin set, the pinning
  policy, and `pinnedFetch()`, a drop-in replacement for `fetch()`.
- `frontend/src/lib/api.ts` and `frontend/src/data/apiClient.ts` — the
  two API client modules; every `fetch()` call site in both now goes
  through `pinnedFetch()`.
- `frontend/src/api/__tests__/certificatePinning.test.ts` — pinning
  validation tests (fallback behavior, native-verified, native-rejected,
  unconfigured host).

## Why the web app alone can't fully enforce this

A browser's TLS handshake completes before any page JavaScript runs, and
`fetch`/`XMLHttpRequest` give no API to inspect the certificate that was
presented. So a pure web page cannot itself reject a connection based on
the server's public key — only a native TLS stack can. This is a
platform limitation, not a gap in this implementation.

`certificatePinning.ts` is designed around that constraint:

- It **enforces** pinning when a native bridge is present — i.e. from
  inside a future mobile app shell (React Native / Capacitor) that
  exposes `window.__ARENAX_NATIVE__.verifyCertificate(host, pins)` backed
  by real platform TLS inspection.
- It **falls back to system trust** when no such bridge exists — i.e.
  running as a plain web page today. `pinnedFetch()` still makes the
  request over HTTPS; it just can't add the extra key-pin check. Every
  fallback path is explicit and typed (`PinningResult.reason ===
  "no-native-bridge-fallback-to-system-trust"`), never a silent no-op.

## Native (mobile) implementation

When ArenaX ships a native app shell, `window.__ARENAX_NATIVE__` should be
implemented on top of the platform's real pinning mechanism:

- **iOS:** App Transport Security pinning dictionary in `Info.plist`, or a
  `URLSessionDelegate` performing manual server-trust evaluation (e.g. via
  TrustKit) — compare the presented certificate's SPKI SHA-256 hash
  against the pins passed in from `certificatePinning.ts`.
- **Android:** Network Security Config `<pin-set>` in
  `res/xml/network_security_config.xml`, or OkHttp's `CertificatePinner`
  configured with the same SPKI hashes.
- **React Native / Capacitor:** a small native module bridging
  `verifyCertificate(host, pinsSha256)` to the platform API above, then
  registering it as `window.__ARENAX_NATIVE__` before the JS bundle loads.

The web and native pin sets must stay in sync — `certificatePinning.ts` is
the single source of truth for *which* pins are valid; only the mechanism
that checks them differs by platform.

## Certificate rotation

Each host in `PIN_SETS` carries two pins:

- `primary` — the key currently served in production.
- `backup` — the key ArenaX will rotate to next, published ahead of time.

Publishing the backup pin before the actual rotation means:

- A client on an older build (knows only the primary pin) keeps working
  right up until the rotation happens.
- A client on a newer build (already knows the backup pin) keeps working
  immediately after the rotation, with no lockout window.

**Rotation runbook:**

1. Generate the new certificate/key ahead of the planned rotation date.
2. Compute its SPKI pin (see below) and add it as the new `backup` entry
   in `PIN_SETS`, with an `expiresAt` comfortably after the planned
   rotation date. Ship this as a normal release — it changes nothing
   about which certificate is currently served.
3. Wait until the new pin has propagated to effectively all active
   clients (i.e. your app's minimum-supported-version window).
4. Deploy the new certificate to production infrastructure.
5. In the next release, promote the former `backup` pin to `primary` and
   set a fresh `backup` pin for the *next* rotation.
6. Retire old pins only after their `expiresAt` has passed and no
   meaningful client population still needs them.

## Computing a pin

The pin is the base64-encoded SHA-256 hash of the certificate's
SubjectPublicKeyInfo (the same value used for HPKP `pin-sha256`):

```sh
openssl x509 -in certificate.pem -pubkey -noout \
  | openssl pkey -pubin -outform der \
  | openssl dgst -sha256 -binary \
  | openssl enc -base64
```

Or directly against a live host:

```sh
openssl s_client -connect api.arenax.gg:443 -servername api.arenax.gg </dev/null 2>/dev/null \
  | openssl x509 -pubkey -noout \
  | openssl pkey -pubin -outform der \
  | openssl dgst -sha256 -binary \
  | openssl enc -base64
```

## Validation

Run the pinning unit tests:

```sh
cd frontend && npx jest src/api/__tests__/certificatePinning.test.ts
```

They cover: active-pin filtering by expiry, fallback-to-system-trust with
no native bridge, native-verified/native-rejected outcomes, not failing
closed for a host with no configured pins, and that `pinnedFetch` never
calls the network when the bridge rejects a pin.
