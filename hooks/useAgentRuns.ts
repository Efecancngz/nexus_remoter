import { useCallback, useState } from 'react';

export type RunOutcome = 'completed' | 'failed' | 'stopped' | 'capped';

export interface AgentRunStep {
  thought: string;
  label: string;
  status: 'done' | 'failed' | 'skipped';
}

export interface AgentRun {
  id: string;
  goal: string;
  startedAt: number;
  outcome: RunOutcome;
  detail?: string;
  steps: AgentRunStep[];
}

export const AGENT_RUNS_KEY = 'nexus_agent_runs';
export const MAX_RUNS = 20;

function load(): AgentRun[] {
  try {
    const raw = localStorage.getItem(AGENT_RUNS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist(runs: AgentRun[]) {
  try {
    localStorage.setItem(AGENT_RUNS_KEY, JSON.stringify(runs));
  } catch {
    // Quota or unavailable storage: keep in-memory state, drop persistence.
  }
}

export function useAgentRuns() {
  const [runs, setRuns] = useState<AgentRun[]>(() => load());

  const addRun = useCallback((run: AgentRun) => {
    setRuns(prev => {
      const next = [run, ...prev].slice(0, MAX_RUNS);
      persist(next);
      return next;
    });
  }, []);

  const clearRuns = useCallback(() => {
    setRuns([]);
    persist([]);
  }, []);

  return { runs, addRun, clearRuns };
}
