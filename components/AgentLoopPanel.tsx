import React, { useState, useRef } from 'react';
import { Bot, Play, Square, Pause, Check, SkipForward, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { nextAction } from '../services/gemini';
import { executor } from '../services/automation';
import HudPanel from './hud/HudPanel';
import { ScreenshotModal } from './ScreenshotModal';
import { useAgentRuns, RunOutcome, AgentRunStep } from '../hooks/useAgentRuns';
import AgentRunHistory from './AgentRunHistory';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface AgentLoopPanelProps {
  ip: string;
  token: string;
  onToast: (message: string, type?: ToastType) => void;
}

type StepStatus = 'running' | 'done' | 'failed' | 'skipped';
type Decision = { kind: 'confirm'; value: string } | { kind: 'skip' };

interface LogRow {
  thought: string;
  label: string;
  status: StepStatus;
  image?: string;
}

const MAX_STEPS = 15;

function markLast(rows: LogRow[], status: StepStatus): LogRow[] {
  if (rows.length === 0) return rows;
  return rows.map((r, i) => (i === rows.length - 1 ? { ...r, status } : r));
}

export default function AgentLoopPanel({ ip, token, onToast }: AgentLoopPanelProps) {
  const [goal, setGoal] = useState('');
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<LogRow[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const stopRef = useRef(false);
  const runIdRef = useRef(0);
  const [paused, setPaused] = useState(false);
  const pauseRef = useRef(false);
  const resumeRef = useRef<(() => void) | null>(null);
  const [approval, setApproval] = useState(false);
  const approvalRef = useRef(false);
  const [pendingAction, setPendingAction] = useState<{ type: string; value: string; description: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  const decisionRef = useRef<((d: Decision) => void) | null>(null);
  const { runs, addRun, clearRuns } = useAgentRuns();

  const handleStart = async (goalArg?: string) => {
    const value = (goalArg ?? goal).trim();
    if (!value || running) return;
    stopRef.current = false;
    pauseRef.current = false;
    setPaused(false);
    setPendingAction(null);
    decisionRef.current = null;
    const myRunId = ++runIdRef.current;
    const stale = () => runIdRef.current !== myRunId;
    const waitWhilePaused = async () => {
      while (pauseRef.current && !stopRef.current && !stale()) {
        await new Promise<void>(resolve => { resumeRef.current = resolve; });
      }
      resumeRef.current = null;
    };
    setRunning(true);
    setLog([]);
    setPreview(null);
    const startedAt = Date.now();
    const recorded: AgentRunStep[] = [];
    let outcome: RunOutcome = 'stopped';
    let detail: string | undefined;
    const history: { type: string; description: string }[] = [];
    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        if (stopRef.current || stale()) { outcome = 'stopped'; break; }
        await waitWhilePaused();
        if (stopRef.current || stale()) { outcome = 'stopped'; break; }
        const res = await nextAction(ip, token, value, history);
        if (res.done) {
          if (!stale()) onToast(res.summary || 'Görev tamamlandı', 'success');
          outcome = 'completed';
          detail = res.summary;
          break;
        }
        if (stopRef.current || stale()) { outcome = 'stopped'; break; }
        const action = res.action!;
        const label = `${action.type}: ${action.value}`;
        recorded.push({ thought: res.thought || '', label, status: 'failed' });
        setLog(prev => [...prev, { thought: res.thought || '', label, status: 'running', image: res.image }]);
        if (approvalRef.current) {
          setPendingAction({ type: action.type, value: action.value, description: action.description });
          setEditValue(action.value);
          const decision = await new Promise<Decision>(resolve => { decisionRef.current = resolve; });
          setPendingAction(null);
          decisionRef.current = null;
          if (stopRef.current || stale()) { outcome = 'stopped'; break; }
          if (decision.kind === 'skip') {
            setLog(prev => markLast(prev, 'skipped'));
            recorded[recorded.length - 1].status = 'skipped';
            history.push({ type: action.type, description: action.description });
            continue;
          }
          action.value = decision.value;
          const editedLabel = `${action.type}: ${action.value}`;
          recorded[recorded.length - 1].label = editedLabel;
          setLog(prev => prev.map((r, i) => (i === prev.length - 1 ? { ...r, label: editedLabel } : r)));
        }
        const exec = await executor.run([action], ip, token);
        if (stale()) break;
        if (!exec.success) {
          setLog(prev => markLast(prev, 'failed'));
          onToast(exec.error || 'Adım başarısız', 'error');
          outcome = 'failed';
          detail = exec.error;
          break;
        }
        setLog(prev => markLast(prev, 'done'));
        recorded[recorded.length - 1].status = 'done';
        history.push({ type: action.type, description: action.description });
        if (step === MAX_STEPS - 1) {
          onToast('Adım sınırına ulaşıldı', 'warning');
          outcome = 'capped';
        }
      }
    } catch (e: any) {
      if (!stale()) onToast(e?.message || 'Döngü hatası oluştu.', 'error');
      outcome = 'failed';
      detail = e?.message;
    } finally {
      if (!stale()) {
        setRunning(false);
        if (recorded.length > 0) {
          addRun({
            id: globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 11),
            goal: value,
            startedAt,
            outcome,
            detail,
            steps: recorded,
          });
        }
      }
    }
  };

  const handleStop = () => {
    stopRef.current = true;
    pauseRef.current = false;
    setPaused(false);
    resumeRef.current?.();
    resumeRef.current = null;
    decisionRef.current?.({ kind: 'skip' });
    decisionRef.current = null;
    setRunning(false);
  };

  const handlePause = () => {
    pauseRef.current = true;
    setPaused(true);
  };

  const handleResume = () => {
    pauseRef.current = false;
    setPaused(false);
    resumeRef.current?.();
    resumeRef.current = null;
  };

  const handleConfirm = (value: string) => {
    decisionRef.current?.({ kind: 'confirm', value });
    decisionRef.current = null;
  };

  const handleSkip = () => {
    decisionRef.current?.({ kind: 'skip' });
    decisionRef.current = null;
  };

  const toggleApproval = () => {
    const next = !approvalRef.current;
    approvalRef.current = next;
    setApproval(next);
  };

  const handleReplay = (savedGoal: string) => {
    if (running) return;
    setGoal(savedGoal);
    handleStart(savedGoal);
  };

  return (
    <HudPanel className="p-5 space-y-4">
      <div className="flex items-center gap-2 text-hud-cyan">
        <Bot size={18} />
        <h3 className="text-sm font-display font-bold uppercase tracking-[0.15em]">Ajan Döngüsü</h3>
      </div>
      <p className="text-[11px] text-slate-400 leading-relaxed">
        Bir hedef tarif edin; ajan ekranı görüp adım adım kendi kendine ilerlesin. İstediğiniz an durdurun.
      </p>

      <div className="flex gap-2">
        <input
          className="flex-1 bg-hud-bg/80 border border-hud-dim rounded-sm font-data p-3 text-sm outline-none placeholder:text-slate-600 focus:border-hud-cyan/60 focus:ring-1 focus:ring-hud-cyan/20 transition-colors disabled:opacity-50"
          placeholder="Hedef: Chrome'u aç ve kedi ara"
          value={goal}
          onChange={e => setGoal(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleStart(); }}
          disabled={running}
        />
        {!running ? (
          <button
            onClick={() => handleStart()}
            disabled={!goal.trim()}
            className="px-5 bg-hud-cyan text-slate-950 font-black rounded-sm flex items-center gap-2 disabled:opacity-40 active:scale-95 transition-all"
          >
            <Play size={16} />
            Başlat
          </button>
        ) : (
          <>
            {paused ? (
              <button
                onClick={handleResume}
                className="px-4 bg-hud-cyan text-slate-950 font-black rounded-sm flex items-center gap-2 active:scale-95 transition-all"
              >
                <Play size={16} />
                Devam
              </button>
            ) : (
              <button
                onClick={handlePause}
                className="px-4 bg-amber-400 text-slate-950 font-black rounded-sm flex items-center gap-2 active:scale-95 transition-all"
              >
                <Pause size={16} />
                Duraklat
              </button>
            )}
            <button
              onClick={handleStop}
              className="px-4 bg-red-500 text-slate-950 font-black rounded-sm flex items-center gap-2 active:scale-95 transition-all"
            >
              <Square size={16} />
              Durdur
            </button>
          </>
        )}
      </div>

      <label className="flex items-center gap-2 text-[11px] text-slate-400 select-none cursor-pointer">
        <input
          type="checkbox"
          checked={approval}
          onChange={toggleApproval}
          className="accent-hud-cyan"
        />
        Onay modu
      </label>

      {log.length > 0 && (
        <ol className="space-y-1.5">
          {log.map((row, i) => (
            <li key={i} className="flex items-start gap-2 text-[11px] font-data text-slate-300">
              <span className="text-slate-600 w-8 shrink-0">{i + 1}/{MAX_STEPS}</span>
              {row.image && (
                <button
                  type="button"
                  data-testid="step-thumbnail"
                  onClick={() => setPreview(row.image!)}
                  className="shrink-0 active:scale-95 transition-transform"
                >
                  <img
                    src={row.image}
                    alt="Adım görüntüsü"
                    className="w-16 h-10 object-cover rounded-sm border border-hud-dim"
                    loading="lazy"
                    decoding="async"
                  />
                </button>
              )}
              {row.status === 'running' && <Loader2 size={13} className="animate-spin text-hud-cyan shrink-0 mt-0.5" />}
              {row.status === 'done' && <CheckCircle2 size={13} className="text-hud-cyan shrink-0 mt-0.5" />}
              {row.status === 'failed' && <XCircle size={13} className="text-red-500 shrink-0 mt-0.5" />}
              {row.status === 'skipped' && <SkipForward size={13} className="text-slate-500 shrink-0 mt-0.5" />}
              <span className="flex-1">
                <span className="text-slate-400">{row.thought}</span>
                <span className="block text-slate-600">{row.label}</span>
              </span>
            </li>
          ))}
        </ol>
      )}

      {pendingAction && (
        <div className="space-y-2 border border-hud-cyan/40 rounded-sm p-3 bg-hud-bg/60">
          <div className="text-[11px] text-slate-400">{pendingAction.description}</div>
          <div className="text-[10px] text-slate-600 font-data">{pendingAction.type}</div>
          <input
            aria-label="Adım değeri"
            className="w-full bg-hud-bg/80 border border-hud-dim rounded-sm font-data p-2 text-sm outline-none focus:border-hud-cyan/60"
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              onClick={() => handleConfirm(editValue)}
              className="flex-1 px-3 py-2 bg-hud-cyan text-slate-950 font-black rounded-sm flex items-center justify-center gap-2 active:scale-95 transition-all"
            >
              <Check size={14} />
              Onayla
            </button>
            <button
              onClick={handleSkip}
              className="flex-1 px-3 py-2 bg-slate-600 text-slate-100 font-bold rounded-sm flex items-center justify-center gap-2 active:scale-95 transition-all"
            >
              <SkipForward size={14} />
              Atla
            </button>
          </div>
        </div>
      )}

      <AgentRunHistory runs={runs} running={running} onReplay={handleReplay} onClear={clearRuns} />

      {preview && <ScreenshotModal dataUrl={preview} onClose={() => setPreview(null)} />}
    </HudPanel>
  );
}
