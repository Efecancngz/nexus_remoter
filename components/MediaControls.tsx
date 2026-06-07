import React, { useState, useEffect } from 'react';
import { SkipBack, SkipForward, Play, Pause, Speaker, VolumeX, Volume2 } from 'lucide-react';
import { ActionType, SystemStats } from '../types';

interface MediaControlsProps {
  systemStats?: SystemStats;
  onMediaAction: (action: ActionType, value?: string) => void;
  onVolumeChange: (volume: number) => void;
}

export default function MediaControls({ systemStats, onMediaAction, onVolumeChange }: MediaControlsProps) {
  const serverVol = systemStats?.volume ?? 50;
  const [volume, setVolume] = useState(serverVol);
  const [isMuted, setIsMuted] = useState(false);

  // Sync with server volume changes unless the user has local changes
  useEffect(() => {
    setVolume(serverVol);
  }, [serverVol]);

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    setVolume(val);
    onVolumeChange(val); // Update local app state for immediate indicator sync
  };

  const handleDragEnd = () => {
    onMediaAction(ActionType.VOLUME_SET, String(volume));
  };

  const handleMuteToggle = () => {
    setIsMuted(!isMuted);
    onMediaAction(ActionType.VOLUME_MUTE);
  };

  return (
    <div className="px-6 py-4">
      <div className="bg-slate-900/60 backdrop-blur-xl border border-white/5 rounded-[2rem] p-5 flex flex-col gap-4 shadow-xl">
        
        {/* Playback Controls */}
        <div className="flex items-center justify-between px-4">
          <button 
            onClick={() => onMediaAction(ActionType.MEDIA_PREV)} 
            className="p-3 bg-slate-800/40 hover:bg-slate-800 rounded-full active:scale-90 transition-all text-slate-300"
          >
            <SkipBack size={20} />
          </button>
          
          <button 
            onClick={() => onMediaAction(ActionType.MEDIA_PLAY_PAUSE)} 
            className="p-5 bg-gradient-to-tr from-cyan-500 to-indigo-500 text-slate-950 rounded-full shadow-lg shadow-cyan-500/20 active:scale-95 transition-all hover:scale-105"
          >
            <Play size={24} fill="currentColor" className="translate-x-[2px]" />
          </button>
          
          <button 
            onClick={() => onMediaAction(ActionType.MEDIA_NEXT)} 
            className="p-3 bg-slate-800/40 hover:bg-slate-800 rounded-full active:scale-90 transition-all text-slate-300"
          >
            <SkipForward size={20} />
          </button>
        </div>

        {/* Separator */}
        <div className="h-[1px] bg-white/5 w-full"></div>

        {/* Volume Slider Section */}
        <div className="flex items-center gap-3 px-2">
          <button 
            onClick={handleMuteToggle}
            className="p-2 bg-slate-800/30 hover:bg-slate-800/80 rounded-xl transition-all text-slate-400 hover:text-white"
          >
            {isMuted ? <VolumeX size={18} className="text-red-400" /> : <Volume2 size={18} />}
          </button>

          <div className="flex-1 flex items-center gap-3">
            <input
              type="range" 
              min="0" 
              max="100"
              value={volume}
              onChange={handleSliderChange}
              onMouseUp={handleDragEnd}
              onTouchEnd={handleDragEnd}
              className="w-full accent-cyan-500 h-1.5 bg-slate-800 rounded-full appearance-none cursor-pointer"
            />
            <span className="text-[10px] font-mono font-black text-slate-400 w-8 text-right">
              {volume}%
            </span>
          </div>
        </div>

      </div>
    </div>
  );
}
