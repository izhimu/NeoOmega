# Changelog

## 1.0.4 (2026-10-22)

### Performance
- Settings reads cached in-memory with `chrome.storage.onChanged` invalidation — background message handlers and popup/options/sidepanel open no longer deserialize the full settings blob (incl. GFWList rule cache) per call; duplicate reads on UI open eliminated.
- PAC rule matching: compiled-regex cache (2000-entry cap), zero-allocation hostname suffix lookup in generated PAC, single-pass whitelist+proxy routing.
- webRequest listeners now filtered to `main_frame`/`sub_frame` (error listener stays unfiltered) — subresource requests no longer wake the service worker.
- Hang detection uses one shared 1s sweep timer instead of a timeout per request; latency-test candidates sorted by cached latency; base PAC generated once per batch and spliced per candidate.
- Auth manager challenge sweep throttled; i18n lookups memoized per locale (incl. missing keys); content-script observer disconnects after final scan.

### Fixed
- Latency test and speed probe validate HTTP status (proxy 502/504 error pages no longer pass as "1ms"); sub-10ms readings rejected in recommendations; PAC settle verified via `proxy.settings.get` with one retry.
- Failure toast: ad-blocker noise (`ERR_BLOCKED_BY_CLIENT/RESPONSE`, `ERR_ABORTED`) and tracker-type subresources (image/font/ping/beacon) no longer trigger toasts or enter tab error records; same-host toasts throttled to 10 min; hang tracking limited to main/sub frames.
- Speed recommendations now require 2 distinct slow resources per host (was 1) and probe the original request path instead of `/`.
- Options rule-list update interval input was untypeable (debounced write fought UiInput force-resync).
- Sidepanel "rule added" toast showed a `*.host` pattern while the actual rule was bare `host`.
- Latency badges older than 5 min no longer render as fresh; green threshold unified to 250ms across popup/options.
- Storage: `getSettings` returns a private clone (unsaved mutations can no longer leak into the cache); concurrent first-read no longer overwrites newer cached settings.

### Changed
- Failure notifications and speed recommendations are now **opt-in** (default off for new installs and previously-unset keys).

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
