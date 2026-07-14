// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import AgentLoopPanel from './AgentLoopPanel';
import * as gemini from '../services/gemini';
import { executor } from '../services/automation';

describe('AgentLoopPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
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
});
