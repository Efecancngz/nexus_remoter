// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useConnection } from './useConnection';

function jsonResponse(status: number, body: unknown) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as Response;
}

/** Route the global fetch mock by URL suffix so /ping, /verify and /stats can respond differently. */
function routeFetch(routes: Record<string, () => Response | Promise<Response>>) {
  const fetchMock = vi.fn(async (url: string, _options?: RequestInit) => {
    for (const [suffix, handler] of Object.entries(routes)) {
      if (url.endsWith(suffix)) return handler();
    }
    throw new TypeError(`No route for ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('useConnection', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('pairDevice', () => {
    it('stores the sanitized IP and token on successful pairing', async () => {
      // Successful pairing stores the IP, which mounts the background
      // connection check — so /ping, /verify and /stats need routes too.
      const fetchMock = routeFetch({
        '/pair': () => jsonResponse(200, { success: true, token: 'tok-abc' }),
        '/ping': () => ({ ok: true } as Response),
        '/verify': () => jsonResponse(200, { success: true }),
        '/stats': () => jsonResponse(200, { cpu: 1, ram: 2, battery: 'N/A', volume: 3 }),
      });

      const { result, unmount } = renderHook(() => useConnection());

      let outcome: { success: boolean; error?: string } | undefined;
      await act(async () => {
        outcome = await result.current.pairDevice('http://192.168.1.5/', '1234');
      });

      expect(outcome).toEqual({ success: true });
      expect(localStorage.getItem('nexus_pc_ip')).toBe('192.168.1.5');
      expect(localStorage.getItem('nexus_access_token')).toBe('tok-abc');
      expect(result.current.pcIpAddress).toBe('192.168.1.5');
      expect(result.current.accessToken).toBe('tok-abc');
      expect(result.current.connectionStatus).toBe('connected');

      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe('https://192.168.1.5:8080/pair');
      const body = JSON.parse(String(options?.body));
      expect(body.pin).toBe('1234');
      expect(typeof body.device_name).toBe('string');
      expect(body.device_name.length).toBeGreaterThan(0);

      unmount();
    });

    it('reports a wrong PIN on a 401 without storing anything', async () => {
      routeFetch({ '/pair': () => jsonResponse(401, {}) });

      const { result } = renderHook(() => useConnection());

      let outcome: { success: boolean; error?: string } | undefined;
      await act(async () => {
        outcome = await result.current.pairDevice('192.168.1.5', '0000');
      });

      expect(outcome).toEqual({ success: false, error: 'Hatalı PIN Kodu!' });
      expect(localStorage.getItem('nexus_access_token')).toBeNull();
      expect(result.current.connectionStatus).toBe('disconnected');
    });

    it('reports a connection failure when the agent is unreachable', async () => {
      const fetchMock = vi.fn(async () => {
        throw new TypeError('fetch failed');
      });
      vi.stubGlobal('fetch', fetchMock);

      const { result } = renderHook(() => useConnection());

      let outcome: { success: boolean; error?: string } | undefined;
      await act(async () => {
        outcome = await result.current.pairDevice('192.168.1.5', '1234');
      });

      expect(outcome?.success).toBe(false);
      expect(outcome?.error).toContain('bağlanılamadı');
    });
  });

  describe('session verification on mount', () => {
    it('clears an invalidated token when /verify returns 401', async () => {
      localStorage.setItem('nexus_pc_ip', '192.168.1.5');
      localStorage.setItem('nexus_access_token', 'stale-token');

      routeFetch({
        '/ping': () => ({ ok: true } as Response),
        '/verify': () => jsonResponse(401, {}),
        '/stats': () => jsonResponse(401, {}),
      });

      const { result, unmount } = renderHook(() => useConnection());

      await waitFor(() => {
        expect(result.current.accessToken).toBe('');
      });
      // The critical contract: the stale token is fully purged so the UI
      // can prompt for re-pairing. (Status may settle back to 'connected'
      // afterwards since the agent itself is still reachable via /ping.)
      expect(localStorage.getItem('nexus_access_token')).toBeNull();

      unmount();
    });

    it('stays connected when the token verifies successfully', async () => {
      localStorage.setItem('nexus_pc_ip', '192.168.1.5');
      localStorage.setItem('nexus_access_token', 'good-token');

      routeFetch({
        '/ping': () => ({ ok: true } as Response),
        '/verify': () => jsonResponse(200, { success: true }),
        '/stats': () => jsonResponse(200, { cpu: 10, ram: 20, battery: 'N/A', volume: 30 }),
      });

      const { result, unmount } = renderHook(() => useConnection());

      await waitFor(() => {
        expect(result.current.connectionStatus).toBe('connected');
      });
      expect(result.current.accessToken).toBe('good-token');

      await waitFor(() => {
        expect(result.current.systemStats).toMatchObject({ cpu: 10, ram: 20 });
      });

      unmount();
    });

    it('reports disconnected when the agent does not respond to ping', async () => {
      localStorage.setItem('nexus_pc_ip', '192.168.1.5');
      localStorage.setItem('nexus_access_token', 'good-token');

      const fetchMock = vi.fn(async () => {
        throw new TypeError('fetch failed');
      });
      vi.stubGlobal('fetch', fetchMock);

      const { result, unmount } = renderHook(() => useConnection());

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalled();
      });
      expect(result.current.connectionStatus).toBe('disconnected');
      // A network failure alone must NOT log the user out.
      expect(result.current.accessToken).toBe('good-token');

      unmount();
    });
  });

  describe('updateToken', () => {
    it('persists a new token and removes a cleared one', () => {
      const { result } = renderHook(() => useConnection());

      act(() => result.current.updateToken('fresh-token'));
      expect(localStorage.getItem('nexus_access_token')).toBe('fresh-token');

      act(() => result.current.updateToken(''));
      expect(localStorage.getItem('nexus_access_token')).toBeNull();
    });
  });
});
