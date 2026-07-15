// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useAgentRuns, AGENT_RUNS_KEY, AgentRun } from './useAgentRuns';

function makeRun(id: string, goal = 'hedef'): AgentRun {
  return {
    id,
    goal,
    startedAt: 1000,
    outcome: 'completed',
    detail: 'ok',
    steps: [{ thought: 'dusun', label: 'MOUSE_CLICK: 10%,10%', status: 'done' }],
  };
}

describe('useAgentRuns', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    localStorage.clear();
    cleanup();
  });

  it('starts empty when nothing is stored', () => {
    const { result } = renderHook(() => useAgentRuns());
    expect(result.current.runs).toEqual([]);
  });

  it('starts empty when the stored value is corrupt JSON', () => {
    localStorage.setItem(AGENT_RUNS_KEY, '{not json');
    const { result } = renderHook(() => useAgentRuns());
    expect(result.current.runs).toEqual([]);
  });

  it('loads existing runs from localStorage', () => {
    localStorage.setItem(AGENT_RUNS_KEY, JSON.stringify([makeRun('a')]));
    const { result } = renderHook(() => useAgentRuns());
    expect(result.current.runs).toHaveLength(1);
    expect(result.current.runs[0].id).toBe('a');
  });

  it('addRun prepends (newest first) and persists', () => {
    const { result } = renderHook(() => useAgentRuns());
    act(() => result.current.addRun(makeRun('a')));
    act(() => result.current.addRun(makeRun('b')));
    expect(result.current.runs.map(r => r.id)).toEqual(['b', 'a']);
    const stored = JSON.parse(localStorage.getItem(AGENT_RUNS_KEY)!);
    expect(stored.map((r: AgentRun) => r.id)).toEqual(['b', 'a']);
  });

  it('caps at 20 runs, dropping the oldest', () => {
    const { result } = renderHook(() => useAgentRuns());
    act(() => {
      for (let i = 0; i < 21; i++) result.current.addRun(makeRun(String(i)));
    });
    expect(result.current.runs).toHaveLength(20);
    // Newest is '20'; oldest '0' was dropped.
    expect(result.current.runs[0].id).toBe('20');
    expect(result.current.runs.some(r => r.id === '0')).toBe(false);
  });

  it('clearRuns empties and persists', () => {
    const { result } = renderHook(() => useAgentRuns());
    act(() => result.current.addRun(makeRun('a')));
    act(() => result.current.clearRuns());
    expect(result.current.runs).toEqual([]);
    expect(JSON.parse(localStorage.getItem(AGENT_RUNS_KEY)!)).toEqual([]);
  });
});
