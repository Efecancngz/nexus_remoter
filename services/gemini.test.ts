import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateMacro, generateMacroFromAudio, parseSchedulerPrompt } from './gemini';

function jsonResponse(status: number, body: unknown) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as Response;
}

describe('gemini service (agent /ai/* proxy client)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('generateMacro', () => {
    it('posts to the agent /ai/macro route with the token header and prompt body', async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValue(
        jsonResponse(200, { success: true, steps: [{ type: 'WAIT', value: '1', description: 'ok' }] })
      );

      await generateMacro('spotify ac', '192.168.1.5', 'tok-123');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe('https://192.168.1.5:8080/ai/macro');
      expect(options.method).toBe('POST');
      expect(options.headers['X-Nexus-Token']).toBe('tok-123');
      expect(JSON.parse(options.body)).toEqual({ prompt: 'spotify ac' });
    });

    it('strips protocol and trailing slash from the IP before building the URL', async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValue(jsonResponse(200, { success: true, steps: [] }));

      await generateMacro('x', 'http://192.168.1.5/', 'tok');

      const [url] = fetchMock.mock.calls[0];
      expect(url).toBe('https://192.168.1.5:8080/ai/macro');
    });

    it('assigns a unique id to every returned step', async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValue(
        jsonResponse(200, {
          success: true,
          steps: [
            { type: 'WAIT', value: '1', description: 'a' },
            { type: 'WAIT', value: '2', description: 'b' },
          ],
        })
      );

      const steps = await generateMacro('x', '1.2.3.4', 'tok');

      expect(steps).toHaveLength(2);
      expect(steps[0].id).toBeTruthy();
      expect(steps[1].id).toBeTruthy();
      expect(steps[0].id).not.toBe(steps[1].id);
    });

    it('returns an empty array when steps is not an array', async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValue(jsonResponse(200, { success: true, steps: null }));

      const steps = await generateMacro('x', '1.2.3.4', 'tok');

      expect(steps).toEqual([]);
    });

    it('throws AUTH_REQUIRED on a 401 response', async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValue(jsonResponse(401, {}));

      await expect(generateMacro('x', '1.2.3.4', 'bad-tok')).rejects.toThrow('AUTH_REQUIRED');
    });

    it('throws a configuration error on a 503 response', async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValue(jsonResponse(503, {}));

      await expect(generateMacro('x', '1.2.3.4', 'tok')).rejects.toThrow(/GEMINI_API_KEY/);
    });

    it('throws the server-provided error message on a generic failure', async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValue(jsonResponse(502, { success: false, error: 'upstream boom' }));

      await expect(generateMacro('x', '1.2.3.4', 'tok')).rejects.toThrow('upstream boom');
    });

    it('throws a generic error when the failing response has no error message', async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValue(jsonResponse(500, {}));

      await expect(generateMacro('x', '1.2.3.4', 'tok')).rejects.toThrow('AI yanıt veremedi.');
    });

    it('throws when the IP is empty', async () => {
      await expect(generateMacro('x', '', 'tok')).rejects.toThrow('PC IP adresi ayarlı değil.');
    });

    it('treats a non-JSON response body as an empty object rather than throwing', async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => {
          throw new SyntaxError('not json');
        },
      } as unknown as Response);

      await expect(generateMacro('x', '1.2.3.4', 'tok')).rejects.toThrow('AI yanıt veremedi.');
    });
  });

  describe('generateMacroFromAudio', () => {
    it('posts audio and mimeType to /ai/audio', async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValue(jsonResponse(200, { success: true, steps: [] }));

      await generateMacroFromAudio('base64data', 'audio/wav', '1.2.3.4', 'tok');

      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe('https://1.2.3.4:8080/ai/audio');
      expect(JSON.parse(options.body)).toEqual({ audio: 'base64data', mimeType: 'audio/wav' });
    });
  });

  describe('parseSchedulerPrompt', () => {
    it('posts the prompt to /ai/schedule and returns the plan', async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      const plan = { seconds: 600, action: { type: 'SYSTEM_POWER', value: 'shutdown', description: 'x' } };
      fetchMock.mockResolvedValue(jsonResponse(200, { success: true, plan }));

      const result = await parseSchedulerPrompt('10 dakika sonra kapat', '1.2.3.4', 'tok');

      expect(result).toEqual(plan);
    });

    it('returns null when the plan is missing', async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValue(jsonResponse(200, { success: true }));

      const result = await parseSchedulerPrompt('x', '1.2.3.4', 'tok');

      expect(result).toBeNull();
    });

    it('propagates AUTH_REQUIRED on a 401 so the UI can trigger re-pairing', async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValue(jsonResponse(401, {}));

      await expect(parseSchedulerPrompt('x', '1.2.3.4', 'bad-tok')).rejects.toThrow('AUTH_REQUIRED');
    });

    it('swallows non-auth errors and returns null instead of throwing', async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValue(jsonResponse(502, { success: false, error: 'upstream boom' }));

      const result = await parseSchedulerPrompt('x', '1.2.3.4', 'tok');

      expect(result).toBeNull();
    });
  });
});
