# Changelog

## 1.0.2 (2026-10-12)

### Fixed
- Latency test now probes via query marker (`__neo_probe=N`) carrying the real request path through the PAC — fixes fake-low readings where the proxy only ever saw `/` (path-only marker).
- Auth manager: 407 challenge loop detection now tracks per `requestId` — parallel connections no longer trigger false 60s lockouts.
- Auth manager: IPv6 proxy hosts normalized (bracket-stripped, lowercased) when building/querying credential cache.
- Challenge tracker resets when credentials or profile cache are rebuilt.
- Type errors in background batch test and options speed-test result (`testUrl` field, indexed access).

### Changed
- Default latency test target is now `https://www.google.com/generate_204` (first in dropdown); background fallback and popup tests aligned.
- Batch latency test logs `[NeoOmega] Latency test results` (proxy, latency, status) to the service worker console for diagnostics.

## 1.0.1

- Failure host mute, proxy queueing, parser hardening.
- Page failure toast, 5s hang detection, options polish.
