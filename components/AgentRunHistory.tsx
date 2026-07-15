import React, { useState } from 'react';
import { History, RotateCcw, Trash2, CheckCircle2, XCircle, Square, Timer } from 'lucide-react';
import { AgentRun, RunOutcome } from '../hooks/useAgentRuns';

interface AgentRunHistoryProps {
  runs: AgentRun[];
  running: boolean;
  onReplay: (goal: string) => void;
  onClear: () => void;
}

const OUTCOME_META: Record<RunOutcome, { label: string; className: string }> = {
  completed: { label: 'Tamamlandı', className: 'text-hud-cyan' },
  failed: { label: 'Başarısız', className: 'text-red-500' },
  stopped: { label: 'Durduruldu', className: 'text-slate-400' },
  capped: { label: 'Sınıra ulaştı', className: 'text-amber-400' },
};

function OutcomeIcon({ outcome }: { outcome: RunOutcome }) {
  const cls = OUTCOME_META[outcome].className + ' shrink-0';
  if (outcome === 'completed') return <CheckCircle2 size={13} className={cls} />;
  if (outcome === 'failed') return <XCircle size={13} className={cls} />;
  if (outcome === 'capped') return <Timer size={13} className={cls} />;
  return <Square size={13} className={cls} />;
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'az önce';
  if (min < 60) return `${min} dk önce`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} sa önce`;
  return `${Math.floor(hr / 24)} gün önce`;
}

export default function AgentRunHistory({ runs, running, onReplay, onClear }: AgentRunHistoryProps) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (runs.length === 0) return null;

  return (
    <div className="space-y-2 border-t border-hud-dim pt-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-slate-400">
          <History size={14} />
          <h4 className="text-[11px] font-display font-bold uppercase tracking-[0.15em]">Geçmiş</h4>
        </div>
        <button
          type="button"
          onClick={onClear}
          className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-red-500 transition-colors"
        >
          <Trash2 size={12} />
          Geçmişi Temizle
        </button>
      </div>

      <ol className="space-y-1.5">
        {runs.map(run => {
          const isOpen = expanded === run.id;
          const meta = OUTCOME_META[run.outcome];
          return (
            <li key={run.id} className="bg-hud-bg/60 border border-hud-dim rounded-sm">
              <button
                type="button"
                data-testid="run-row"
                onClick={() => setExpanded(isOpen ? null : run.id)}
                className="w-full flex items-center gap-2 p-2.5 text-left"
              >
                <OutcomeIcon outcome={run.outcome} />
                <span className="flex-1 min-w-0">
                  <span className="block text-[12px] font-data text-slate-200 truncate">{run.goal}</span>
                  <span className="block text-[10px] text-slate-500">
                    <span className={meta.className}>{meta.label}</span>
                    {' · '}{run.steps.length} adım{' · '}{formatRelative(run.startedAt)}
                  </span>
                </span>
              </button>

              <button
                type="button"
                onClick={() => onReplay(run.goal)}
                disabled={running}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-hud-cyan/15 text-hud-cyan border border-hud-cyan/30 rounded-sm text-[11px] font-bold disabled:opacity-40 active:scale-95 transition-all"
              >
                <RotateCcw size={13} />
                Tekrar Çalıştır
              </button>

              {isOpen && (
                <div className="px-2.5 pb-2.5 space-y-2">
                  <ol className="space-y-1">
                    {run.steps.map((s, i) => (
                      <li key={i} className="flex items-start gap-2 text-[11px] font-data text-slate-300">
                        {s.status === 'done'
                          ? <CheckCircle2 size={12} className="text-hud-cyan shrink-0 mt-0.5" />
                          : <XCircle size={12} className="text-red-500 shrink-0 mt-0.5" />}
                        <span className="flex-1">
                          <span className="text-slate-400">{s.thought}</span>
                          <span className="block text-slate-600">{s.label}</span>
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
