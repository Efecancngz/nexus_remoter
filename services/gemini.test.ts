import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateMacro, generateMacroFromAudio, parseSchedulerPrompt, locate, nextAction } from './gemini';

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

  describe('locate', () => {
    it('posts the description to /ai/locate and returns the mapped point', async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValue(
        jsonResponse(200, {
          success: true,
          found: true,
          x_pct: 42.3,
          y_pct: 71,
          image: 'data:image/jpeg;base64,abc',
        })
      );

      const result = await locate('192.168.1.5', 'tok-123', 'Kaydet butonu');

      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe('https://192.168.1.5:8080/ai/locate');
      expect(options.headers['X-Nexus-Token']).toBe('tok-123');
      expect(JSON.parse(options.body)).toEqual({ description: 'Kaydet butonu' });
      expect(result).toEqual({
        found: true,
        x_pct: 42.3,
        y_pct: 71,
        image: 'data:image/jpeg;base64,abc',
      });
    });

    it('returns found:false when the element is not located', async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValue(jsonResponse(200, { success: true, found: false }));

      const result = await locate('1.2.3.4', 'tok', 'yok');

      expect(result.found).toBe(false);
      expect(result.image).toBeUndefined();
    });

    it('throws AUTH_REQUIRED on a 401 response', async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValue(jsonResponse(401, {}));

      await expect(locate('1.2.3.4', 'bad-tok', 'x')).rejects.toThrow('AUTH_REQUIRED');
    });
  });

  describe('nextAction', () => {
    it('posts goal and history and returns an action with an id when not done', async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValue(
        jsonResponse(200, {
          success: true,
          done: false,
          thought: 'Adres çubuğuna tıkla',
          action: { type: 'MOUSE_CLICK', value: '50%,8%', description: 'Adres çubuğuna tıkla' },
        })
      );

      const history = [{ type: 'LAUNCH_APP', description: 'Chrome açıldı' }];
      const result = await nextAction('192.168.1.5', 'tok-123', 'kedi ara', history);

      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe('https://192.168.1.5:8080/ai/next-action');
      expect(options.headers['X-Nexus-Token']).toBe('tok-123');
      expect(JSON.parse(options.body)).toEqual({ goal: 'kedi ara', history });
      expect(result.done).toBe(false);
      expect(result.thought).toBe('Adres çubuğuna tıkla');
      expect(result.action?.type).toBe('MOUSE_CLICK');
      expect(result.action?.value).toBe('50%,8%');
      expect(result.action?.id).toBeTruthy();
    });

    it('returns done with the summary and no action when the goal is complete', async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValue(
        jsonResponse(200, { success: true, done: true, summary: 'Görev tamamlandı' })
      );

      const result = await nextAction('1.2.3.4', 'tok', 'x', []);

      expect(result.done).toBe(true);
      expect(result.summary).toBe('Görev tamamlandı');
      expect(result.action).toBeUndefined();
    });

    it('throws AUTH_REQUIRED on a 401 response', async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValue(jsonResponse(401, {}));

      await expect(nextAction('1.2.3.4', 'bad-tok', 'x', [])).rejects.toThrow('AUTH_REQUIRED');
    });

    it('surfaces the step screenshot on a not-done response', async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValue(
        jsonResponse(200, {
          success: true,
          done: false,
          thought: 'tıkla',
          action: { type: 'MOUSE_CLICK', value: '50%,8%', description: 'tıkla' },
          image: 'data:image/jpeg;base64,abc',
        })
      );

      const result = await nextAction('1.2.3.4', 'tok', 'x', []);

      expect(result.image).toBe('data:image/jpeg;base64,abc');
    });

    it('has no image on a done response', async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValue(
        jsonResponse(200, { success: true, done: true, summary: 'bitti' })
      );

      const result = await nextAction('1.2.3.4', 'tok', 'x', []);

      expect(result.image).toBeUndefined();
    });
  });
});
