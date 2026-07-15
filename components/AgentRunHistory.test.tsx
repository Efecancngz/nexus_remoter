// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import AgentRunHistory from './AgentRunHistory';
import { AgentRun } from '../hooks/useAgentRuns';

afterEach(cleanup);

function run(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: 'r1',
    goal: 'kedi ara',
    startedAt: Date.now(),
    outcome: 'completed',
    detail: 'bitti',
    steps: [{ thought: 'tarayiciyi ac', label: 'MOUSE_CLICK: 10%,10%', status: 'done' }],
    ...overrides,
  };
}

describe('AgentRunHistory', () => {
  it('renders nothing when there are no runs', () => {
    const { container } = render(
      <AgentRunHistory runs={[]} running={false} onReplay={vi.fn()} onClear={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders a row per run with the goal', () => {
    render(
      <AgentRunHistory
        runs={[run({ id: 'a', goal: 'kedi ara' }), run({ id: 'b', goal: 'kopek ara' })]}
        running={false}
        onReplay={vi.fn()}
        onClear={vi.fn()}
      />
    );
    expect(screen.getAllByTestId('run-row')).toHaveLength(2);
    expect(screen.getByText('kedi ara')).toBeTruthy();
    expect(screen.getByText('kopek ara')).toBeTruthy();
  });

  it('expands a run to show its step list when the row is tapped', () => {
    render(
      <AgentRunHistory runs={[run()]} running={false} onReplay={vi.fn()} onClear={vi.fn()} />
    );
    // Step label hidden until expanded.
    expect(screen.queryByText('MOUSE_CLICK: 10%,10%')).toBeNull();
    fireEvent.click(screen.getByTestId('run-row'));
    expect(screen.getByText('MOUSE_CLICK: 10%,10%')).toBeTruthy();
  });

  it('fires onReplay with the run goal when Tekrar Calistir is tapped', () => {
    const onReplay = vi.fn();
    render(
      <AgentRunHistory
        runs={[run({ goal: 'kedi ara' })]}
        running={false}
        onReplay={onReplay}
        onClear={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Tekrar Çalıştır/i }));
    expect(onReplay).toHaveBeenCalledWith('kedi ara');
  });

  it('disables replay while a loop is running', () => {
    const onReplay = vi.fn();
    render(
      <AgentRunHistory runs={[run()]} running={true} onReplay={onReplay} onClear={vi.fn()} />
    );
    const btn = screen.getByRole('button', { name: /Tekrar Çalıştır/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(onReplay).not.toHaveBeenCalled();
  });

  it('fires onClear when Gecmisi Temizle is tapped', () => {
    const onClear = vi.fn();
    render(
      <AgentRunHistory runs={[run()]} running={false} onReplay={vi.fn()} onClear={onClear} />
    );
    fireEvent.click(screen.getByRole('button', { name: /Geçmişi Temizle/i }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('renders a skipped marker for a skipped step when expanded', () => {
    render(
      <AgentRunHistory
        runs={[run({ steps: [{ thought: 'atla', label: 'MOUSE_CLICK: 10%,10%', status: 'skipped' }] })]}
        running={false}
        onReplay={vi.fn()}
        onClear={vi.fn()}
      />
    );
    fireEvent.click(screen.getByTestId('run-row'));
    expect(screen.getByTestId('step-skipped')).toBeTruthy();
  });

  it('loads and renders a thumbnail for a step image when expanded', async () => {
    const loadImages = vi.fn().mockResolvedValue(['data:image/jpeg;base64,SHOT', null]);
    render(
      <AgentRunHistory
        runs={[run({
          steps: [
            { thought: 'a', label: 'MOUSE_CLICK: 1%,1%', status: 'done' },
            { thought: 'b', label: 'MOUSE_CLICK: 2%,2%', status: 'done' },
          ],
        })]}
        running={false}
        onReplay={vi.fn()}
        onClear={vi.fn()}
        loadImages={loadImages}
      />
    );
    fireEvent.click(screen.getByTestId('run-row'));
    const thumbs = await screen.findAllByTestId('history-thumbnail');
    expect(thumbs).toHaveLength(1); // only the first step had an image
    expect(loadImages).toHaveBeenCalledTimes(1);
  });

  it('opens ScreenshotModal when a history thumbnail is tapped', async () => {
    const loadImages = vi.fn().mockResolvedValue(['data:image/jpeg;base64,SHOT']);
    render(
      <AgentRunHistory
        runs={[run()]}
        running={false}
        onReplay={vi.fn()}
        onClear={vi.fn()}
        loadImages={loadImages}
      />
    );
    fireEvent.click(screen.getByTestId('run-row'));
    fireEvent.click(await screen.findByTestId('history-thumbnail'));
    expect(await screen.findByRole('button', { name: 'Kapat' })).toBeTruthy();
    expect(screen.getByAltText('Ekran görüntüsü').getAttribute('src')).toBe('data:image/jpeg;base64,SHOT');
  });

  it('renders text steps with no thumbnails when no loader is provided', () => {
    render(<AgentRunHistory runs={[run()]} running={false} onReplay={vi.fn()} onClear={vi.fn()} />);
    fireEvent.click(screen.getByTestId('run-row'));
    expect(screen.queryByTestId('history-thumbnail')).toBeNull();
  });
});
