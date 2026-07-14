import React, { useState, useRef } from 'react';
import { Bot, Play, Square, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { nextAction } from '../services/gemini';
import { executor } from '../services/automation';
import HudPanel from './hud/HudPanel';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface AgentLoopPanelProps {
  ip: string;
  token: string;
  onToast: (message: string, type?: ToastType) => void;
}

type StepStatus = 'running' | 'done' | 'failed';

interface LogRow {
  thought: string;
  label: string;
  status: StepStatus;
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
  const stopRef = useRef(false);
  const runIdRef = useRef(0);

  const handleStart = async () => {
    const value = goal.trim();
    if (!value || running) return;
    stopRef.current = false;
    const myRunId = ++runIdRef.current;
    setRunning(true);
    setLog([]);
    const history: { type: string; description: string }[] = [];
    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        if (stopRef.current || runIdRef.current !== myRunId) break;
        const res = await nextAction(ip, token, value, history);
        if (res.done) {
          onToast(res.summary || 'Görev tamamlandı', 'success');
          break;
        }
        if (stopRef.current || runIdRef.current !== myRunId) break;
        const action = res.action!;
        const label = `${action.type}: ${action.value}`;
        setLog(prev => [...prev, { thought: res.thought || '', label, status: 'running' }]);
        const exec = await executor.run([action], ip, token);
        if (runIdRef.current !== myRunId) break;
        if (!exec.success) {
          setLog(prev => markLast(prev, 'failed'));
          onToast(exec.error || 'Adım başarısız', 'error');
          break;
        }
        setLog(prev => markLast(prev, 'done'));
        history.push({ type: action.type, description: action.description });
        if (step === MAX_STEPS - 1) {
          onToast('Adım sınırına ulaşıldı', 'warning');
        }
      }
    } catch (e: any) {
      onToast(e?.message || 'Döngü hatası oluştu.', 'error');
    } finally {
      setRunning(false);
    }
  };

  const handleStop = () => {
    stopRef.current = true;
    setRunning(false);
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
        {running ? (
          <button
            onClick={handleStop}
            className="px-5 bg-red-500 text-slate-950 font-black rounded-sm flex items-center gap-2 active:scale-95 transition-all"
          >
            <Square size={16} />
            Durdur
          </button>
        ) : (
          <button
            onClick={handleStart}
            disabled={!goal.trim()}
            className="px-5 bg-hud-cyan text-slate-950 font-black rounded-sm flex items-center gap-2 disabled:opacity-40 active:scale-95 transition-all"
          >
            <Play size={16} />
            Başlat
          </button>
        )}
      </div>

      {log.length > 0 && (
        <ol className="space-y-1.5">
          {log.map((row, i) => (
            <li key={i} className="flex items-start gap-2 text-[11px] font-data text-slate-300">
              <span className="text-slate-600 w-8 shrink-0">{i + 1}/{MAX_STEPS}</span>
              {row.status === 'running' && <Loader2 size={13} className="animate-spin text-hud-cyan shrink-0 mt-0.5" />}
              {row.status === 'done' && <CheckCircle2 size={13} className="text-hud-cyan shrink-0 mt-0.5" />}
              {row.status === 'failed' && <XCircle size={13} className="text-red-500 shrink-0 mt-0.5" />}
              <span className="flex-1">
                <span className="text-slate-400">{row.thought}</span>
                <span className="block text-slate-600">{row.label}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </HudPanel>
  );
}
