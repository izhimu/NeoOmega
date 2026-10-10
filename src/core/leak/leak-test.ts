/**
 * IP Leak Test
 * Client-side checks inspired by ipi6.com/ip-leak:
 * 1. Exit IP consistency across multiple echo services (split-tunnel detection)
 * 2. WebRTC ICE candidate exposure (srflx IPs beyond the proxy exit)
 * DNS leak testing is impossible without a cooperating authoritative DNS server.
 */

export interface EchoResult {
  name: string;
  url: string;
  ip?: string;
  error?: string;
}

export interface IceCandidateInfo {
  ip: string;
  type: string; // host | srflx | prflx | relay
  port?: number;
}

export type IpClass = 'private' | 'mdns' | 'public';

const ECHO_SERVICES = [
  { name: 'IPify', url: 'https://api.ipify.org' },
  { name: 'ICanHazIP', url: 'https://icanhazip.com' },
  { name: 'Ident.me', url: 'https://ident.me' },
  { name: 'ipapi.co', url: 'https://ipapi.co/ip/' },
  { name: 'ifconfig.me', url: 'https://ifconfig.me/ip' },
];

export interface DnsServerInfo {
  ip: string;
  country?: string;
  countryName?: string;
  asn?: string;
  org?: string;
}

const randomHex = (bytes: number): string =>
  [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');

/**
 * DNS leak test via bash.ws public API (open-source dnsleaktest backend).
 * Unique subdomains force the real resolver to query bash.ws authoritative
 * DNS, which logs which resolvers asked. No own server needed.
 */
export async function fetchDnsServers(rounds = 6, timeoutMs = 8000): Promise<DnsServerInfo[]> {
  const testId = randomHex(6);
  // Trigger DNS lookups; HTTP result irrelevant (NXDOMAIN / error expected)
  await Promise.allSettled(
    Array.from({ length: rounds }, () =>
      fetch(`https://${randomHex(4)}.${testId}.bash.ws/`, { cache: 'no-store' }).then((r) => r.text()).catch(() => {})
    )
  );
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`https://bash.ws/dnsleak/test/${testId}?json`, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as unknown;
    if (!Array.isArray(data)) return [];
    const seen = new Set<string>();
    const servers: DnsServerInfo[] = [];
    for (const e of data) {
      if (e.type !== 'dns' || !e.ip || seen.has(e.ip)) continue;
      seen.add(e.ip);
      servers.push({ ip: e.ip, country: e.country, countryName: e.country_name, asn: e.asn, org: e.org });
    }
    return servers;
  } finally {
    clearTimeout(timer);
  }
}

export interface ExitInfo {
  ip?: string;
  countryCode?: string;
  countryName?: string;
  region?: string;
  city?: string;
  org?: string;
}

/** Geo/ASN info of the current HTTP exit (also used for exit-vs-DNS comparison). */
export async function fetchExitInfo(timeoutMs = 5000): Promise<ExitInfo | undefined> {
  const tryFetch = async (url: string, parse: (data: Record<string, unknown>) => ExitInfo | undefined): Promise<ExitInfo | undefined> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
      if (!res.ok) return undefined;
      return parse(await res.json());
    } catch {
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  };
  // ipapi.co is Cloudflare-challenged on some networks; ipwho.is is the fallback
  const primary = await tryFetch('https://ipapi.co/json/', (d) =>
    typeof d.ip === 'string'
      ? {
          ip: d.ip,
          countryCode: typeof d.country_code === 'string' ? d.country_code.toLowerCase() : undefined,
          countryName: d.country_name as string | undefined,
          region: d.region as string | undefined,
          city: d.city as string | undefined,
          org: d.org as string | undefined,
        }
      : undefined
  );
  if (primary) return primary;
  return tryFetch('https://ipwho.is/', (d) => {
    if (d.success !== true || typeof d.ip !== 'string') return undefined;
    const conn = (d.connection ?? {}) as Record<string, unknown>;
    const org = [conn.asn ? `AS${conn.asn}` : '', (conn.org || conn.isp || '') as string].filter(Boolean).join(' ');
    return {
      ip: d.ip,
      countryCode: typeof d.country_code === 'string' ? d.country_code.toLowerCase() : undefined,
      countryName: d.country as string | undefined,
      region: d.region as string | undefined,
      city: d.city as string | undefined,
      org: org || undefined,
    };
  });
}

const IP_RE = /^[0-9a-fA-F:.]+$/;

/** Parse an ICE candidate string: candidate:<f> <comp> <proto> <prio> <addr> <port> typ <type> ... */
export function parseCandidate(raw: string): IceCandidateInfo | null {
  const t = raw.trim().replace(/^candidate:/, '').split(/\s+/);
  if (t.length < 8 || t[6] !== 'typ') return null;
  const port = Number(t[5]);
  return t[4] && t[7] ? { ip: t[4], type: t[7], port: Number.isFinite(port) ? port : undefined } : null;
}

/** Classify a candidate address: private LAN, mDNS placeholder, or public. */
export function classifyIp(ip: string): IpClass {
  // IPv4-mapped IPv6 (::ffff:192.168.1.1) → classify by embedded IPv4
  const mapped = ip.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return classifyIp(mapped[1]!);
  if (ip.endsWith('.local')) return 'mdns';
  const v4 = ip.match(/^(\d+)\.(\d+)\./);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (
      a === 10 || a === 127 || a === 0 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127) // CGNAT
    ) {
      return 'private';
    }
    return 'public';
  }
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower.startsWith('fe80') || lower.startsWith('fc') || lower.startsWith('fd')) {
    return 'private';
  }
  return 'public';
}

/** Query all echo services in parallel; each result independent, failures isolated. */
export async function fetchExitIps(timeoutMs = 5000): Promise<EchoResult[]> {
  return Promise.all(
    ECHO_SERVICES.map(async ({ name, url }): Promise<EchoResult> => {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);
        const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
        clearTimeout(timer);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const ip = (await res.text()).trim();
        if (!IP_RE.test(ip) || ip.length > 45) throw new Error('Invalid response');
        return { name, url, ip };
      } catch (e) {
        return { name, url, error: e instanceof Error ? e.message : String(e) };
      }
    })
  );
}

/**
 * Gather ICE candidates via a throwaway RTCPeerConnection.
 * Resolves when gathering completes or times out.
 */
export async function gatherIceCandidates(
  stunServers: string[] = ['stun:stun.l.google.com:19302'],
  timeoutMs = 4000
): Promise<IceCandidateInfo[]> {
  if (typeof RTCPeerConnection === 'undefined') return [];
  const { promise, resolve } = Promise.withResolvers<IceCandidateInfo[]>();
  const found = new Map<string, IceCandidateInfo>();
  const pc = new RTCPeerConnection({ iceServers: [{ urls: stunServers }] });
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    try { pc.close(); } catch { /* noop */ }
    resolve([...found.values()]);
  };
  const timer = setTimeout(finish, timeoutMs);
  pc.onicecandidate = (ev) => {
    if (!ev.candidate) {
      clearTimeout(timer);
      finish();
      return;
    }
    const parsed = parseCandidate(ev.candidate.candidate);
    if (parsed) found.set(`${parsed.type}:${parsed.ip}`, parsed);
  };
  pc.onicegatheringstatechange = () => {
    if (pc.iceGatheringState === 'complete') {
      clearTimeout(timer);
      finish();
    }
  };
  pc.createDataChannel('leak-test');
  pc.createOffer()
    .then((offer) => pc.setLocalDescription(offer))
    .catch(() => { clearTimeout(timer); finish(); });
  return promise;
}

/**
 * Injected into a real web tab via chrome.scripting. MUST be self-contained:
 * executeScript serializes the function without its closure.
 */
function gatherIceCandidatesPage(timeoutMs = 4000): IceCandidateInfo[] | Promise<IceCandidateInfo[]> {
  if (typeof RTCPeerConnection === 'undefined') return [];
  const { promise, resolve } = Promise.withResolvers<IceCandidateInfo[]>();
  const found = new Map<string, IceCandidateInfo>();
  const pc = new RTCPeerConnection({ iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }] });
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    try { pc.close(); } catch { /* noop */ }
    resolve([...found.values()]);
  };
  const timer = setTimeout(finish, timeoutMs);
  pc.onicecandidate = (ev) => {
    if (!ev.candidate) {
      clearTimeout(timer);
      finish();
      return;
    }
    const t = ev.candidate.candidate.trim().replace(/^candidate:/, '').split(/\s+/);
    if (t.length < 8 || t[6] !== 'typ' || !t[4] || !t[7]) return;
    const port = Number(t[5]);
    found.set(`${t[7]}:${t[4]}`, { ip: t[4], type: t[7], port: Number.isFinite(port) ? port : undefined });
  };
  pc.onicegatheringstatechange = () => {
    if (pc.iceGatheringState === 'complete') {
      clearTimeout(timer);
      finish();
    }
  };
  pc.createDataChannel('leak-test');
  pc.createOffer()
    .then((offer) => pc.setLocalDescription(offer))
    .catch(() => { clearTimeout(timer); finish(); });
  return promise;
}

/**
 * WebRTC IP handling policies apply to web pages, NOT chrome-extension://
 * origins (extension pages keep full interface access). Gathering candidates
 * in the options page would show exposure no website can see. Run inside a
 * temporary tab that is closed afterwards.
 */
export async function gatherIceCandidatesFromWebPage(timeoutMs = 15000): Promise<IceCandidateInfo[]> {
  if (typeof chrome === 'undefined' || !chrome.scripting?.executeScript || !chrome.tabs?.create) {
    return gatherIceCandidates();
  }
  let tabId: number | undefined;
  try {
    const created = await chrome.tabs.create({ url: 'https://example.com', active: false });
    if (created.id === undefined) return [];
    tabId = created.id;
    // Wait for load (deadline shared with executeScript timeout below)
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const t = (await chrome.tabs.get(tabId)) as chrome.tabs.Tab;
      if (t.status === 'complete') break;
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 200);
      await promise;
    }
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: gatherIceCandidatesPage,
      args: [4000],
    });
    return (results[0]?.result as IceCandidateInfo[] | undefined) ?? [];
  } catch {
    return []; // restricted pages reject; don't abort the whole run
  } finally {
    if (tabId !== undefined) {
      chrome.tabs.remove(tabId).catch(() => {});
    }
  }
}
