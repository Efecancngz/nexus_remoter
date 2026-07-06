import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executor } from './automation';
import { ActionType, AutomationStep } from '../types';

function step(overrides: Partial<AutomationStep>): AutomationStep {
  return { id: '1', type: ActionType.WAIT, value: '', description: '', ...overrides };
}

function jsonResponse(status: number, body: unknown) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as Response;
}

describe('ActionExecutor.run', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('fails fast when no IP is configured', async () => {
    const result = await executor.run([step({ type: ActionType.LAUNCH_APP, value: 'calc' })], '');

    expect(result).toEqual({ success: false, error: 'Lütfen ayarlardan PC IP adresini girin.' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('handles WAIT steps locally without calling the agent', async () => {
    const runPromise = executor.run([step({ type: ActionType.WAIT, value: '500' })], '1.2.3.4');
    await vi.advanceTimersByTimeAsync(500);

    const result = await runPromise;

    expect(result).toEqual({ success: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends non-WAIT steps to the agent /execute route with the token header', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse(200, { success: true }));

    const runPromise = executor.run(
      [step({ type: ActionType.KEYPRESS, value: 'a', description: 'press a' })],
      'http://192.168.1.5/',
      'tok-123'
    );
    await vi.advanceTimersByTimeAsync(1000);
    const result = await runPromise;

    expect(result).toEqual({ success: true });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('http://192.168.1.5:8080/execute');
    expect(options.headers['X-Nexus-Token']).toBe('tok-123');
    expect(JSON.parse(options.body)).toMatchObject({ type: ActionType.KEYPRESS, value: 'a' });
  });

  it('waits an extra grace period after LAUNCH_APP steps', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse(200, { success: true }));

    const order: string[] = [];
    const runPromise = executor
      .run([step({ type: ActionType.LAUNCH_APP, value: 'calc' })], '1.2.3.4')
      .then((r) => order.push('done') && r);

    await vi.advanceTimersByTimeAsync(200);
    expect(order).toEqual([]); // still waiting on the 4s grace period

    await vi.advanceTimersByTimeAsync(3800);
    const result = await runPromise;

    expect(result).toEqual({ success: true });
  });

  it('stops and reports AUTH_REQUIRED on a 401 from the agent', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) } as Response);

    const runPromise = executor.run([step({ type: ActionType.KEYPRESS, value: 'a' })], '1.2.3.4');
    const result = await runPromise;

    expect(result).toEqual({ success: false, error: 'AUTH_REQUIRED' });
  });

  it('reports a connection error and stops when the agent is unreachable', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    const result = await executor.run(
      [step({ type: ActionType.KEYPRESS, value: 'a', description: 'press a' })],
      '1.2.3.4'
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('press a');
  });

  it('stops executing remaining steps after a failure', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) } as Response);

    await executor.run(
      [step({ type: ActionType.KEYPRESS, value: 'a' }), step({ type: ActionType.KEYPRESS, value: 'b' })],
      '1.2.3.4'
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('ActionExecutor.ping', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns false when no IP is configured', async () => {
    expect(await executor.ping('')).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns true when the agent responds ok', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({ ok: true } as Response);

    expect(await executor.ping('1.2.3.4')).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe('http://1.2.3.4:8080/ping');
  });

  it('returns false when the agent is unreachable', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    expect(await executor.ping('1.2.3.4')).toBe(false);
  });
});
