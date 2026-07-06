import { describe, it, expect } from 'vitest';
import { sanitizeIp, buildAgentUrl } from './agentUrl';

describe('sanitizeIp', () => {
  it('strips a leading http:// scheme', () => {
    expect(sanitizeIp('http://192.168.1.5')).toBe('192.168.1.5');
  });

  it('strips a leading https:// scheme', () => {
    expect(sanitizeIp('https://192.168.1.5')).toBe('192.168.1.5');
  });

  it('strips a trailing slash', () => {
    expect(sanitizeIp('192.168.1.5/')).toBe('192.168.1.5');
  });

  it('trims surrounding whitespace', () => {
    expect(sanitizeIp('  192.168.1.5  ')).toBe('192.168.1.5');
  });

  it('leaves a bare IP untouched', () => {
    expect(sanitizeIp('192.168.1.5')).toBe('192.168.1.5');
  });
});

describe('buildAgentUrl', () => {
  it('builds an https URL with port 8080 and the given path', () => {
    expect(buildAgentUrl('192.168.1.5', '/execute')).toBe('https://192.168.1.5:8080/execute');
  });

  it('sanitizes the IP before building the URL', () => {
    expect(buildAgentUrl('http://192.168.1.5/', '/ai/macro')).toBe('https://192.168.1.5:8080/ai/macro');
  });

  it('throws when the IP is empty', () => {
    expect(() => buildAgentUrl('', '/ping')).toThrow('PC IP adresi ayarlı değil.');
  });

  it('throws when the IP is only whitespace', () => {
    expect(() => buildAgentUrl('   ', '/ping')).toThrow('PC IP adresi ayarlı değil.');
  });
});
