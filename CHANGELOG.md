# Changelog

## 1.0.3 (2026-10-16)

### Fixed
- Latency test and speed recommendation probe were broken for HTTPS targets: Chrome strips path+query of HTTPS URLs before PAC evaluation (`PacHttpsUrlStrippingEnabled`), so the `__neo_probe=N` query marker never matched and every probe fell through to base routing (false timeouts on unreachable-direct hosts). Probing now writes a host-only PAC per candidate sequentially; `generateBatchProbePacScript` removed.
- Failure notification toast no longer fires for hosts already routed through a proxy by the active profile (`resolveRouting` check in `notifyTabOfError`).

### Changed
- Hang detection threshold raised 5s → 20s, just under Chrome's native TCP timeout (~21s); per-host dedup already prevents double-reporting when Chrome's native error arrives first.

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
