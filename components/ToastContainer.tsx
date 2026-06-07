import React from 'react';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import { Toast } from '../hooks/useToast';

interface ToastContainerProps {
  toasts: Toast[];
  onRemove: (id: string) => void;
}

const TOAST_STYLES: Record<Toast['type'], { bg: string; border: string; icon: React.ReactNode }> = {
  success: {
    bg: 'bg-emerald-600/90',
    border: 'border-emerald-400/30',
    icon: <CheckCircle size={18} />
  },
  error: {
    bg: 'bg-red-600/90',
    border: 'border-red-400/30',
    icon: <AlertCircle size={18} />
  },
  warning: {
    bg: 'bg-amber-600/90',
    border: 'border-amber-400/30',
    icon: <AlertTriangle size={18} />
  },
  info: {
    bg: 'bg-cyan-600/90',
    border: 'border-cyan-400/30',
    icon: <Info size={18} />
  }
};

export default function ToastContainer({ toasts, onRemove }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 left-6 right-6 z-[70] flex flex-col gap-2 pointer-events-none">
      {toasts.map(toast => {
        const style = TOAST_STYLES[toast.type];
        return (
          <div
            key={toast.id}
            className={`${style.bg} ${style.border} border text-white p-4 rounded-2xl flex items-center justify-between shadow-2xl backdrop-blur-sm pointer-events-auto animate-in slide-in-from-bottom duration-300`}
          >
            <div className="flex items-center gap-3">
              {style.icon}
              <span className="text-[11px] font-bold leading-tight">{toast.message}</span>
            </div>
            <button 
              onClick={() => onRemove(toast.id)} 
              className="p-1 hover:bg-white/10 rounded-lg transition-colors shrink-0 ml-2"
            >
              <X size={16} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
