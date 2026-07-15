// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import AgentLoopPanel from './AgentLoopPanel';
import * as gemini from '../services/gemini';
import { executor } from '../services/automation';
import { AGENT_RUNS_KEY, AgentRun } from '../hooks/useAgentRuns';

vi.mock('../services/runImages', () => ({
  saveRunImages: vi.fn(() => Promise.resolve()),
  loadRunImages: vi.fn(() => Promise.resolve(null)),
  reconcileRunImages: vi.fn(() => Promise.resolve()),
}));
import { saveRunImages, reconcileRunImages } from '../services/runImages';

describe('AgentLoopPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    cleanup();
  });

  function startWithGoal(goal: string) {
    const input = screen.getByPlaceholderText(/Hedef/i);
    fireEvent.change(input, { target: { value: goal } });
    fireEvent.click(screen.getByRole('button', { name: /Başlat/i }));
  }

  const clickAction = {
    id: '1',
    type: 'MOUSE_CLICK',
    value: '10%,10%',
    description: 'Bir yere tıkla',
  };

  const typeAction = {
    id: '1',
    type: 'TYPE_TEXT',
    value: 'merhaba',
    description: 'Metin yaz',
  };

  it('runs the loop until done and toasts the summary', async () => {
    vi.spyOn(gemini, 'nextAction')
      .mockResolvedValueOnce({ done: false, thought: 'tıkla', action: clickAction })
      .mockResolvedValueOnce({ done: true, summary: 'Görev bitti' });
    const runSpy = vi.spyOn(executor, 'run').mockResolvedValue({ success: true });
    const onToast = vi.fn();

    render(<AgentLoopPanel ip="1.2.3.4" token="tok" onToast={onToast} />);
    startWithGoal('kedi ara');

    await waitFor(() => expect(onToast).toHaveBeenCalledWith('Görev bitti', 'success'));
    expect(runSpy).toHaveBeenCalledTimes(1);
    const [steps] = runSpy.mock.calls[0];
    expect(steps[0].type).toBe('MOUSE_CLICK');
  });

  it('stops between iterations when STOP is pressed', async () => {
    let resolveExec: (v: { success: boolean }) => void = () => {};
    vi.spyOn(gemini, 'nextAction').mockResolvedValue({
      done: false,
      thought: 'tıkla',
      action: clickAction,
    });
    vi.spyOn(executor, 'run').mockReturnValue(
      new Promise(r => {
        resolveExec = r;
      })
    );

    render(<AgentLoopPanel ip="1.2.3.4" token="tok" onToast={vi.fn()} />);
    startWithGoal('sonsuz');

    // First iteration reached execution and is now pending.
    await screen.findByText(/MOUSE_CLICK/);
    fireEvent.click(screen.getByRole('button', { name: /Durdur/i }));
    resolveExec({ success: true });

    // The loop must not request a second action after STOP.
    await waitFor(() => expect(gemini.nextAction).toHaveBeenCalledTimes(1));
  });

  it('enforces the 15-step cap and warns', async () => {
    vi.spyOn(gemini, 'nextAction').mockResolvedValue({
      done: false,
      thought: 'tıkla',
      action: clickAction,
    });
    vi.spyOn(executor, 'run').mockResolvedValue({ success: true });
    const onToast = vi.fn();

    render(<AgentLoopPanel ip="1.2.3.4" token="tok" onToast={onToast} />);
    startWithGoal('bitmeyen');

    await waitFor(() => expect(onToast).toHaveBeenCalledWith('Adım sınırına ulaşıldı', 'warning'));
    expect(gemini.nextAction).toHaveBeenCalledTimes(15);
  });

  it('halts and toasts when a step fails', async () => {
    vi.spyOn(gemini, 'nextAction').mockResolvedValue({
      done: false,
      thought: 'tıkla',
      action: clickAction,
    });
    vi.spyOn(executor, 'run').mockResolvedValue({ success: false, error: 'PC hatası' });
    const onToast = vi.fn();

    render(<AgentLoopPanel ip="1.2.3.4" token="tok" onToast={onToast} />);
    startWithGoal('hata');

    await waitFor(() => expect(onToast).toHaveBeenCalledWith('PC hatası', 'error'));
    expect(gemini.nextAction).toHaveBeenCalledTimes(1);
  });

  it('does not resume the stopped loop after a stop -> restart', async () => {
    // Run #1's executor call stays pending (we control it); run #2's executor
    // call also stays pending so run #2 simply suspends after one action.
    let resolveOldExec: (v: { success: boolean }) => void = () => {};
    let execCall = 0;
    vi.spyOn(executor, 'run').mockImplementation(() => {
      execCall += 1;
      if (execCall === 1) {
        return new Promise<{ success: boolean }>(r => {
          resolveOldExec = r;
        });
      }
      return new Promise<{ success: boolean }>(() => {});
    });
    vi.spyOn(gemini, 'nextAction').mockResolvedValue({
      done: false,
      thought: 'tıkla',
      action: clickAction,
    });

    render(<AgentLoopPanel ip="1.2.3.4" token="tok" onToast={vi.fn()} />);
    startWithGoal('döngü');

    // Run #1 reached execution and is now suspended awaiting the deferred exec.
    await screen.findByText(/MOUSE_CLICK/);
    expect(gemini.nextAction).toHaveBeenCalledTimes(1);

    // Stop run #1, then immediately restart -> run #2 begins and (buggy code)
    // would reset stopRef, tricking the suspended run #1 into continuing.
    fireEvent.click(screen.getByRole('button', { name: /Durdur/i }));
    startWithGoal('döngü');
    await waitFor(() => expect(gemini.nextAction).toHaveBeenCalledTimes(2));

    // Resolve the OLD run's pending executor. With the generation guard the old
    // loop must bail; without it, it would issue a 3rd nextAction call.
    resolveOldExec({ success: true });
    await new Promise(r => setTimeout(r, 0));
    await Promise.resolve();

    expect(gemini.nextAction).toHaveBeenCalledTimes(2);
  });

  it('ignores a stale failed executor result from a stopped run after restart', async () => {
    // Run #1's executor stays pending (we control it); run #2's executor also
    // stays pending so run #2 suspends after one action.
    let resolveOldExec: (v: { success: boolean; error?: string }) => void = () => {};
    let execCall = 0;
    vi.spyOn(executor, 'run').mockImplementation(() => {
      execCall += 1;
      if (execCall === 1) {
        return new Promise<{ success: boolean; error?: string }>(r => {
          resolveOldExec = r;
        });
      }
      return new Promise<{ success: boolean; error?: string }>(() => {});
    });
    vi.spyOn(gemini, 'nextAction').mockResolvedValue({
      done: false,
      thought: 'tıkla',
      action: clickAction,
    });
    const onToast = vi.fn();

    render(<AgentLoopPanel ip="1.2.3.4" token="tok" onToast={onToast} />);
    startWithGoal('döngü');

    // Run #1 reached execution and is now suspended awaiting the deferred exec.
    await screen.findByText(/MOUSE_CLICK/);

    // Stop run #1, then restart -> run #2 begins (advancing the generation).
    fireEvent.click(screen.getByRole('button', { name: /Durdur/i }));
    startWithGoal('döngü');
    await waitFor(() => expect(gemini.nextAction).toHaveBeenCalledTimes(2));

    // The OLD run's executor now resolves with a FAILURE. The superseded run
    // must bail at the hoisted generation guard BEFORE toasting the error, so
    // it cannot corrupt run #2's log/toast state.
    resolveOldExec({ success: false, error: 'PC hatası' });
    await new Promise(r => setTimeout(r, 0));
    await Promise.resolve();

    expect(onToast).not.toHaveBeenCalledWith('PC hatası', 'error');
  });

  it('keeps STOP control after a stop -> restart when the old run resolves late', async () => {
    // Run #1's executor stays pending (we control it); run #2's executor also
    // stays pending so run #2 keeps running (running=true) after one action.
    let resolveOldExec: (v: { success: boolean }) => void = () => {};
    let execCall = 0;
    vi.spyOn(executor, 'run').mockImplementation(() => {
      execCall += 1;
      if (execCall === 1) {
        return new Promise<{ success: boolean }>(r => {
          resolveOldExec = r;
        });
      }
      return new Promise<{ success: boolean }>(() => {});
    });
    vi.spyOn(gemini, 'nextAction').mockResolvedValue({
      done: false,
      thought: 'tıkla',
      action: clickAction,
    });

    render(<AgentLoopPanel ip="1.2.3.4" token="tok" onToast={vi.fn()} />);
    startWithGoal('döngü');

    // Run #1 reached execution and is now suspended awaiting the deferred exec.
    await screen.findByText(/MOUSE_CLICK/);

    // Stop run #1, then restart -> run #2 begins and is actively looping.
    fireEvent.click(screen.getByRole('button', { name: /Durdur/i }));
    startWithGoal('döngü');
    await waitFor(() => expect(gemini.nextAction).toHaveBeenCalledTimes(2));

    // The OLD run's executor resolves late. Its finally { setRunning(false) }
    // must NOT fire for the superseded run, or it would strip run #2's STOP.
    await act(async () => {
      resolveOldExec({ success: true });
      await Promise.resolve();
    });

    // Run #2 is still active: the Durdur (STOP) button must remain present.
    expect(screen.getByRole('button', { name: /Durdur/i })).toBeTruthy();
  });

  it('renders a thumbnail for a step that has a screenshot', async () => {
    vi.spyOn(gemini, 'nextAction')
      .mockResolvedValueOnce({
        done: false,
        thought: 'tıkla',
        action: { id: '1', type: 'MOUSE_CLICK', value: '10%,10%', description: 'tıkla' },
        image: 'data:image/jpeg;base64,STEPSHOT',
      })
      .mockResolvedValueOnce({ done: true, summary: 'bitti' });
    vi.spyOn(executor, 'run').mockResolvedValue({ success: true });

    render(<AgentLoopPanel ip="1.2.3.4" token="tok" onToast={vi.fn()} />);
    const input = screen.getByPlaceholderText(/Hedef/i);
    fireEvent.change(input, { target: { value: 'kedi ara' } });
    fireEvent.click(screen.getByRole('button', { name: /Başlat/i }));

    const thumb = await screen.findByTestId('step-thumbnail');
    const img = thumb.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('data:image/jpeg;base64,STEPSHOT');
  });

  it('opens the full-screen ScreenshotModal when the thumbnail is tapped', async () => {
    vi.spyOn(gemini, 'nextAction')
      .mockResolvedValueOnce({
        done: false,
        thought: 'tıkla',
        action: { id: '1', type: 'MOUSE_CLICK', value: '10%,10%', description: 'tıkla' },
        image: 'data:image/jpeg;base64,STEPSHOT',
      })
      .mockResolvedValueOnce({ done: true, summary: 'bitti' });
    vi.spyOn(executor, 'run').mockResolvedValue({ success: true });

    render(<AgentLoopPanel ip="1.2.3.4" token="tok" onToast={vi.fn()} />);
    const input = screen.getByPlaceholderText(/Hedef/i);
    fireEvent.change(input, { target: { value: 'kedi ara' } });
    fireEvent.click(screen.getByRole('button', { name: /Başlat/i }));

    fireEvent.click(await screen.findByTestId('step-thumbnail'));

    // ScreenshotModal renders its own "Kapat" close button and an <img alt="Ekran görüntüsü">.
    expect(await screen.findByRole('button', { name: 'Kapat' })).toBeTruthy();
    expect(screen.getByAltText('Ekran görüntüsü').getAttribute('src')).toBe(
      'data:image/jpeg;base64,STEPSHOT'
    );
  });

  it('renders no thumbnail for a step without a screenshot', async () => {
    vi.spyOn(gemini, 'nextAction')
      .mockResolvedValueOnce({
        done: false,
        thought: 'tıkla',
        action: { id: '1', type: 'MOUSE_CLICK', value: '10%,10%', description: 'tıkla' },
      })
      .mockResolvedValueOnce({ done: true, summary: 'bitti' });
    vi.spyOn(executor, 'run').mockResolvedValue({ success: true });

    render(<AgentLoopPanel ip="1.2.3.4" token="tok" onToast={vi.fn()} />);
    const input = screen.getByPlaceholderText(/Hedef/i);
    fireEvent.change(input, { target: { value: 'kedi ara' } });
    fireEvent.click(screen.getByRole('button', { name: /Başlat/i }));

    await waitFor(() => expect(gemini.nextAction).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('step-thumbnail')).toBeNull();
  });

  it('closes the preview modal when starting a new run', async () => {
    const geminiSpy = vi.spyOn(gemini, 'nextAction')
      .mockResolvedValueOnce({
        done: false,
        thought: 'tıkla',
        action: { id: '1', type: 'MOUSE_CLICK', value: '10%,10%', description: 'tıkla' },
        image: 'data:image/jpeg;base64,SHOT1',
      })
      .mockResolvedValueOnce({ done: true, summary: 'bitti' });
    vi.spyOn(executor, 'run').mockResolvedValue({ success: true });

    const { rerender } = render(<AgentLoopPanel ip="1.2.3.4" token="tok" onToast={vi.fn()} />);
    const input = screen.getByPlaceholderText(/Hedef/i);

    // First run
    act(() => {
      fireEvent.change(input, { target: { value: 'kedi ara' } });
    });
    fireEvent.click(screen.getByRole('button', { name: /Başlat/i }));

    // Wait for the thumbnail to appear and open the modal
    const thumb = await screen.findByTestId('step-thumbnail');
    fireEvent.click(thumb);
    await screen.findByRole('button', { name: 'Kapat' });

    // Second run with new goal - modal should close
    geminiSpy.mockResolvedValueOnce({
      done: false,
      thought: 'tıkla',
      action: { id: '1', type: 'MOUSE_CLICK', value: '20%,20%', description: 'tıkla' },
      image: 'data:image/jpeg;base64,SHOT2',
    })
    .mockResolvedValueOnce({ done: true, summary: 'tamam' });

    act(() => {
      fireEvent.change(input, { target: { value: 'köpek ara' } });
    });
    fireEvent.click(screen.getByRole('button', { name: /Başlat/i }));

    // The Kapat button should no longer be visible after starting a new run
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Kapat' })).toBeNull());
  });

  function storedRuns(): AgentRun[] {
    const raw = localStorage.getItem(AGENT_RUNS_KEY);
    return raw ? JSON.parse(raw) : [];
  }

  it('records a completed run with its steps', async () => {
    vi.spyOn(gemini, 'nextAction')
      .mockResolvedValueOnce({ done: false, thought: 'tıkla', action: clickAction })
      .mockResolvedValueOnce({ done: true, summary: 'Görev bitti' });
    vi.spyOn(executor, 'run').mockResolvedValue({ success: true });

    render(<AgentLoopPanel ip="1.2.3.4" token="tok" onToast={vi.fn()} />);
    startWithGoal('kedi ara');

    await waitFor(() => expect(storedRuns()).toHaveLength(1));
    const run = storedRuns()[0];
    expect(run.goal).toBe('kedi ara');
    expect(run.outcome).toBe('completed');
    expect(run.detail).toBe('Görev bitti');
    expect(run.steps).toHaveLength(1);
    expect(run.steps[0].status).toBe('done');
    expect(run.steps[0].label).toBe('MOUSE_CLICK: 10%,10%');
  });

  it('records a failed run when a step fails', async () => {
    vi.spyOn(gemini, 'nextAction').mockResolvedValue({
      done: false,
      thought: 'tıkla',
      action: clickAction,
    });
    vi.spyOn(executor, 'run').mockResolvedValue({ success: false, error: 'PC hatası' });

    render(<AgentLoopPanel ip="1.2.3.4" token="tok" onToast={vi.fn()} />);
    startWithGoal('hata');

    await waitFor(() => expect(storedRuns()).toHaveLength(1));
    const run = storedRuns()[0];
    expect(run.outcome).toBe('failed');
    expect(run.detail).toBe('PC hatası');
    expect(run.steps[0].status).toBe('failed');
  });

  it('records a stopped run when STOP is pressed mid-step', async () => {
    let resolveExec: (v: { success: boolean }) => void = () => {};
    vi.spyOn(gemini, 'nextAction').mockResolvedValue({
      done: false,
      thought: 'tıkla',
      action: clickAction,
    });
    vi.spyOn(executor, 'run').mockReturnValue(new Promise(r => { resolveExec = r; }));

    render(<AgentLoopPanel ip="1.2.3.4" token="tok" onToast={vi.fn()} />);
    startWithGoal('sonsuz');

    await screen.findByText(/MOUSE_CLICK/);
    fireEvent.click(screen.getByRole('button', { name: /Durdur/i }));
    resolveExec({ success: true });

    await waitFor(() => expect(storedRuns()).toHaveLength(1));
    expect(storedRuns()[0].outcome).toBe('stopped');
  });

  it('does not record a superseded (stale) run', async () => {
    // Run #1 stays pending; stop+restart supersedes it; resolving it must not record.
    let resolveOldExec: (v: { success: boolean }) => void = () => {};
    let execCall = 0;
    vi.spyOn(executor, 'run').mockImplementation(() => {
      execCall += 1;
      if (execCall === 1) return new Promise<{ success: boolean }>(r => { resolveOldExec = r; });
      return new Promise<{ success: boolean }>(() => {});
    });
    vi.spyOn(gemini, 'nextAction').mockResolvedValue({
      done: false,
      thought: 'tıkla',
      action: clickAction,
    });

    render(<AgentLoopPanel ip="1.2.3.4" token="tok" onToast={vi.fn()} />);
    startWithGoal('döngü');
    await screen.findByText(/MOUSE_CLICK/);

    fireEvent.click(screen.getByRole('button', { name: /Durdur/i }));
    // STOP flips stopRef, but run #1 is still suspended mid-await on the pending
    // executor call, so nothing is recorded yet. Restart -> run #2 begins,
    // superseding run #1 (its generation token goes stale).
    startWithGoal('döngü');
    await waitFor(() => expect(gemini.nextAction).toHaveBeenCalledTimes(2));

    // Resolve the OLD (stale) run's executor: since run #1 is now stale, its
    // finally block must skip recording entirely (no record at all).
    resolveOldExec({ success: true });
    await new Promise(r => setTimeout(r, 0));
    await Promise.resolve();
    expect(storedRuns()).toHaveLength(0);
  });

  it('replays a saved run when Tekrar Calistir is tapped', async () => {
    vi.spyOn(gemini, 'nextAction')
      .mockResolvedValueOnce({ done: false, thought: 'tıkla', action: clickAction })
      .mockResolvedValueOnce({ done: true, summary: 'bitti' })
      // Replay run:
      .mockResolvedValueOnce({ done: false, thought: 'tıkla', action: clickAction })
      .mockResolvedValueOnce({ done: true, summary: 'bitti tekrar' });
    vi.spyOn(executor, 'run').mockResolvedValue({ success: true });
    const onToast = vi.fn();

    render(<AgentLoopPanel ip="1.2.3.4" token="tok" onToast={onToast} />);
    startWithGoal('kedi ara');
    await waitFor(() => expect(storedRuns()).toHaveLength(1));

    // Expand the history row, then replay.
    fireEvent.click(screen.getByTestId('run-row'));
    fireEvent.click(screen.getByRole('button', { name: /Tekrar Çalıştır/i }));

    await waitFor(() => expect(onToast).toHaveBeenCalledWith('bitti tekrar', 'success'));
    // A second run was recorded for the same goal.
    await waitFor(() => expect(storedRuns()).toHaveLength(2));
    expect(storedRuns()[0].goal).toBe('kedi ara');
  });

  it('holds the loop when Duraklat is pressed and shows Devam', async () => {
    // Each executor call is a fresh pending promise we resolve on demand.
    let resolveExec: (v: { success: boolean }) => void = () => {};
    vi.spyOn(executor, 'run').mockImplementation(
      () => new Promise<{ success: boolean }>(r => { resolveExec = r; })
    );
    vi.spyOn(gemini, 'nextAction').mockResolvedValue({
      done: false,
      thought: 'tıkla',
      action: clickAction,
    });

    render(<AgentLoopPanel ip="1.2.3.4" token="tok" onToast={vi.fn()} />);
    startWithGoal('döngü');

    // Step 0 reached execution; pause now so the loop parks at the next step top.
    await screen.findByText(/MOUSE_CLICK/);
    fireEvent.click(screen.getByRole('button', { name: /Duraklat/i }));
    // Devam (Resume) is shown immediately.
    expect(screen.getByRole('button', { name: /Devam/i })).toBeTruthy();
    // Finish step 0; the loop must then park at the barrier, not request step 1.
    resolveExec({ success: true });
    await new Promise(r => setTimeout(r, 0));
    await Promise.resolve();
    expect(gemini.nextAction).toHaveBeenCalledTimes(1);
  });

  it('continues the loop when Devam is pressed', async () => {
    let resolveExec: (v: { success: boolean }) => void = () => {};
    vi.spyOn(executor, 'run').mockImplementation(
      () => new Promise<{ success: boolean }>(r => { resolveExec = r; })
    );
    vi.spyOn(gemini, 'nextAction').mockResolvedValue({
      done: false,
      thought: 'tıkla',
      action: clickAction,
    });

    render(<AgentLoopPanel ip="1.2.3.4" token="tok" onToast={vi.fn()} />);
    startWithGoal('döngü');

    await screen.findByText(/MOUSE_CLICK/);
    fireEvent.click(screen.getByRole('button', { name: /Duraklat/i }));
    resolveExec({ success: true });
    await new Promise(r => setTimeout(r, 0));
    expect(gemini.nextAction).toHaveBeenCalledTimes(1);

    // Resume -> the loop leaves the barrier and requests the next action.
    fireEvent.click(screen.getByRole('button', { name: /Devam/i }));
    await waitFor(() => expect(gemini.nextAction).toHaveBeenCalledTimes(2));
    // Back to the running control set.
    expect(screen.getByRole('button', { name: /Duraklat/i })).toBeTruthy();
  });

  it('records a stopped run and returns to Başlat when STOP is pressed while paused', async () => {
    let resolveExec: (v: { success: boolean }) => void = () => {};
    vi.spyOn(executor, 'run').mockImplementation(
      () => new Promise<{ success: boolean }>(r => { resolveExec = r; })
    );
    vi.spyOn(gemini, 'nextAction').mockResolvedValue({
      done: false,
      thought: 'tıkla',
      action: clickAction,
    });

    render(<AgentLoopPanel ip="1.2.3.4" token="tok" onToast={vi.fn()} />);
    startWithGoal('döngü');

    await screen.findByText(/MOUSE_CLICK/);
    fireEvent.click(screen.getByRole('button', { name: /Duraklat/i }));
    resolveExec({ success: true }); // step 0 completes; loop parks
    await new Promise(r => setTimeout(r, 0));

    // STOP while paused: the parked loop must unblock and end as 'stopped'.
    fireEvent.click(screen.getByRole('button', { name: /Durdur/i }));
    await waitFor(() => expect(storedRuns()).toHaveLength(1));
    expect(storedRuns()[0].outcome).toBe('stopped');
    expect(screen.getByRole('button', { name: /Başlat/i })).toBeTruthy();
  });

  it('cleanly restarts after a run is stopped while paused', async () => {
    let resolveExec: (v: { success: boolean }) => void = () => {};
    vi.spyOn(executor, 'run').mockImplementation(
      () => new Promise<{ success: boolean }>(r => { resolveExec = r; })
    );
    vi.spyOn(gemini, 'nextAction').mockResolvedValue({
      done: false,
      thought: 'tıkla',
      action: clickAction,
    });

    render(<AgentLoopPanel ip="1.2.3.4" token="tok" onToast={vi.fn()} />);
    startWithGoal('döngü');

    await screen.findByText(/MOUSE_CLICK/);
    fireEvent.click(screen.getByRole('button', { name: /Duraklat/i }));
    resolveExec({ success: true });
    await new Promise(r => setTimeout(r, 0));
    fireEvent.click(screen.getByRole('button', { name: /Durdur/i }));
    await waitFor(() => expect(storedRuns()).toHaveLength(1));

    // A fresh run starts cleanly (not paused) and requests actions again.
    startWithGoal('döngü');
    await waitFor(() => expect(gemini.nextAction).toHaveBeenCalledTimes(2));
    // The new run shows the running (Duraklat) control, not Devam.
    expect(screen.getByRole('button', { name: /Duraklat/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Devam/i })).toBeNull();
  });

  function enableApproval() {
    fireEvent.click(screen.getByRole('checkbox', { name: /Onay modu/i }));
  }

  it('auto-executes when approval mode is off', async () => {
    vi.spyOn(gemini, 'nextAction')
      .mockResolvedValueOnce({ done: false, thought: 'tıkla', action: clickAction })
      .mockResolvedValueOnce({ done: true, summary: 'bitti' });
    const runSpy = vi.spyOn(executor, 'run').mockResolvedValue({ success: true });

    render(<AgentLoopPanel ip="1.2.3.4" token="tok" onToast={vi.fn()} />);
    startWithGoal('kedi ara');

    await waitFor(() => expect(runSpy).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button', { name: /Onayla/i })).toBeNull();
  });

  it('parks at the gate before executing when approval mode is on', async () => {
    vi.spyOn(gemini, 'nextAction').mockResolvedValue({ done: false, thought: 'yaz', action: typeAction });
    const runSpy = vi.spyOn(executor, 'run').mockResolvedValue({ success: true });

    render(<AgentLoopPanel ip="1.2.3.4" token="tok" onToast={vi.fn()} />);
    enableApproval();
    startWithGoal('kedi ara');

    await screen.findByRole('button', { name: /Onayla/i });
    expect(runSpy).not.toHaveBeenCalled();
  });

  it('executes the original value on Onayla', async () => {
    vi.spyOn(gemini, 'nextAction')
      .mockResolvedValueOnce({ done: false, thought: 'yaz', action: typeAction })
      .mockResolvedValueOnce({ done: true, summary: 'bitti' });
    const runSpy = vi.spyOn(executor, 'run').mockResolvedValue({ success: true });

    render(<AgentLoopPanel ip="1.2.3.4" token="tok" onToast={vi.fn()} />);
    enableApproval();
    startWithGoal('kedi ara');

    fireEvent.click(await screen.findByRole('button', { name: /Onayla/i }));
    await waitFor(() => expect(runSpy).toHaveBeenCalledTimes(1));
    expect(runSpy.mock.calls[0][0][0].value).toBe('merhaba');
  });

  it('executes and records the edited value on Onayla', async () => {
    vi.spyOn(gemini, 'nextAction')
      .mockResolvedValueOnce({ done: false, thought: 'yaz', action: typeAction })
      .mockResolvedValueOnce({ done: true, summary: 'bitti' });
    const runSpy = vi.spyOn(executor, 'run').mockResolvedValue({ success: true });

    render(<AgentLoopPanel ip="1.2.3.4" token="tok" onToast={vi.fn()} />);
    enableApproval();
    startWithGoal('kedi ara');

    await screen.findByRole('button', { name: /Onayla/i });
    fireEvent.change(screen.getByLabelText('Adım değeri'), { target: { value: '50%,50%' } });
    fireEvent.click(screen.getByRole('button', { name: /Onayla/i }));

    await waitFor(() => expect(runSpy).toHaveBeenCalledTimes(1));
    expect(runSpy.mock.calls[0][0][0].value).toBe('50%,50%');
    await waitFor(() => expect(storedRuns()).toHaveLength(1));
    expect(storedRuns()[0].steps[0].label).toBe('TYPE_TEXT: 50%,50%');
  });

  it('skips a step without executing and records it as skipped', async () => {
    vi.spyOn(gemini, 'nextAction')
      .mockResolvedValueOnce({ done: false, thought: 'yaz', action: typeAction })
      .mockResolvedValueOnce({ done: true, summary: 'bitti' });
    const runSpy = vi.spyOn(executor, 'run').mockResolvedValue({ success: true });

    render(<AgentLoopPanel ip="1.2.3.4" token="tok" onToast={vi.fn()} />);
    enableApproval();
    startWithGoal('kedi ara');

    fireEvent.click(await screen.findByRole('button', { name: /Atla/i }));

    await waitFor(() => expect(gemini.nextAction).toHaveBeenCalledTimes(2));
    expect(runSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(storedRuns()).toHaveLength(1));
    expect(storedRuns()[0].steps[0].status).toBe('skipped');
  });

  it('ends the run as stopped when STOP is pressed at the gate', async () => {
    vi.spyOn(gemini, 'nextAction').mockResolvedValue({ done: false, thought: 'yaz', action: typeAction });
    vi.spyOn(executor, 'run').mockResolvedValue({ success: true });

    render(<AgentLoopPanel ip="1.2.3.4" token="tok" onToast={vi.fn()} />);
    enableApproval();
    startWithGoal('kedi ara');

    await screen.findByRole('button', { name: /Onayla/i });
    fireEvent.click(screen.getByRole('button', { name: /Durdur/i }));

    await waitFor(() => expect(storedRuns()).toHaveLength(1));
    expect(storedRuns()[0].outcome).toBe('stopped');
    expect(screen.getByRole('button', { name: /Başlat/i })).toBeTruthy();
  });

  it('auto-runs a safe action even when approval mode is on', async () => {
    vi.spyOn(gemini, 'nextAction')
      .mockResolvedValueOnce({ done: false, thought: 'tıkla', action: clickAction })
      .mockResolvedValueOnce({ done: true, summary: 'bitti' });
    const runSpy = vi.spyOn(executor, 'run').mockResolvedValue({ success: true });

    render(<AgentLoopPanel ip="1.2.3.4" token="tok" onToast={vi.fn()} />);
    enableApproval();
    startWithGoal('kedi ara');

    await waitFor(() => expect(runSpy).toHaveBeenCalledTimes(1));
    expect(runSpy.mock.calls[0][0][0].value).toBe('10%,10%');
    expect(screen.queryByRole('button', { name: /Onayla/i })).toBeNull();
  });

  it('saves step screenshots to the image store for a completed run', async () => {
    vi.spyOn(gemini, 'nextAction')
      .mockResolvedValueOnce({ done: false, thought: 'tıkla', action: clickAction, image: 'data:image/jpeg;base64,SHOT' })
      .mockResolvedValueOnce({ done: true, summary: 'bitti' });
    vi.spyOn(executor, 'run').mockResolvedValue({ success: true });

    render(<AgentLoopPanel ip="1.2.3.4" token="tok" onToast={vi.fn()} />);
    startWithGoal('kedi ara');

    await waitFor(() => expect(storedRuns()).toHaveLength(1));
    const runId = storedRuns()[0].id;
    await waitFor(() =>
      expect(saveRunImages).toHaveBeenCalledWith(runId, expect.arrayContaining(['data:image/jpeg;base64,SHOT']))
    );
  });

  it('reconciles the image store with the current run ids', async () => {
    vi.spyOn(gemini, 'nextAction')
      .mockResolvedValueOnce({ done: false, thought: 'tıkla', action: clickAction, image: 'data:image/jpeg;base64,SHOT' })
      .mockResolvedValueOnce({ done: true, summary: 'bitti' });
    vi.spyOn(executor, 'run').mockResolvedValue({ success: true });

    render(<AgentLoopPanel ip="1.2.3.4" token="tok" onToast={vi.fn()} />);
    startWithGoal('kedi ara');

    await waitFor(() => expect(storedRuns()).toHaveLength(1));
    const runId = storedRuns()[0].id;
    await waitFor(() =>
      expect(reconcileRunImages).toHaveBeenCalledWith(expect.arrayContaining([runId]))
    );
  });
});
