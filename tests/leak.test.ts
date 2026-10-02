import { describe, expect, it } from 'vitest';
import { classifyIp, parseCandidate } from '../src/core/leak/leak-test';

describe('parseCandidate', () => {
  it('parses srflx candidate', () => {
    const c = parseCandidate('candidate:842163049 1 udp 1677729535 203.0.113.7 61548 typ srflx raddr 10.0.0.1 rport 61548 generation 0');
    expect(c).toEqual({ ip: '203.0.113.7', type: 'srflx', port: 61548 });
  });

  it('parses host candidate without raddr', () => {
    const c = parseCandidate('candidate:1 1 udp 2113937151 192.168.1.5 9 typ host generation 0');
    expect(c?.type).toBe('host');
    expect(c?.ip).toBe('192.168.1.5');
  });

  it('parses mDNS candidate', () => {
    const c = parseCandidate('candidate:1 1 udp 2113937151 abc-def.local 5353 typ host generation 0');
    expect(c?.ip).toBe('abc-def.local');
  });

  it('rejects malformed strings', () => {
    expect(parseCandidate('')).toBeNull();
    expect(parseCandidate('candidate:1 1 udp')).toBeNull();
    expect(parseCandidate('a b c d e f g h')).toBeNull();
  });
});

describe('classifyIp', () => {
  it('classifies mDNS', () => {
    expect(classifyIp('x-y.local')).toBe('mdns');
  });

  it('classifies private IPv4 ranges', () => {
    for (const ip of ['10.0.0.1', '172.16.0.1', '172.31.255.1', '192.168.0.1', '169.254.1.1', '127.0.0.1', '100.64.0.1']) {
      expect(classifyIp(ip)).toBe('private');
    }
  });

  it('classifies public IPv4', () => {
    expect(classifyIp('172.15.0.1')).toBe('public');
    expect(classifyIp('172.32.0.1')).toBe('public');
    expect(classifyIp('203.0.113.7')).toBe('public');
    expect(classifyIp('100.128.0.1')).toBe('public');
  });

  it('classifies IPv6', () => {
    expect(classifyIp('fe80::1')).toBe('private');
    expect(classifyIp('fd00::1')).toBe('private');
    expect(classifyIp('::1')).toBe('private');
    expect(classifyIp('2001:db8::1')).toBe('public');
  });
});
