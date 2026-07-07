import React, { useState, useEffect, useRef } from 'react';
import { SkipBack, SkipForward, Play, Pause, Speaker, VolumeX, Volume2 } from 'lucide-react';
import { ActionType, SystemStats } from '../types';
import HudPanel from './hud/HudPanel';

interface MediaControlsProps {
  systemStats?: SystemStats;
  onMediaAction: (action: ActionType, value?: string) => void;
  onVolumeChange: (volume: number) => void;
}

export default function MediaControls({ systemStats, onMediaAction, onVolumeChange }: MediaControlsProps) {
  const serverVol = systemStats?.volume ?? 50;
  const [volume, setVolume] = useState(serverVol);
  const [isMuted, setIsMuted] = useState(false);

  // Refs for throttling and user interaction tracking
  const lastSentVolumeRef = useRef<number>(serverVol);
  const lastSentTimeRef = useRef<number>(0);
  const throttleTimeoutRef = useRef<any>(null);
  const isDraggingRef = useRef<boolean>(false);
  const lastInteractionTimeRef = useRef<number>(0);

  // Sync with server volume changes unless the user has local changes/interaction recently
  useEffect(() => {
    const now = Date.now();
    if (!isDraggingRef.current && (now - lastInteractionTimeRef.current > 3000)) {
      setVolume(serverVol);
      lastSentVolumeRef.current = serverVol;
    }
  }, [serverVol]);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      if (throttleTimeoutRef.current) clearTimeout(throttleTimeoutRef.current);
    };
  }, []);

  const sendVolumeChange = (val: number) => {
    if (val === lastSentVolumeRef.current) return;
    
    const now = Date.now();
    const timeSinceLastSent = now - lastSentTimeRef.current;
    
    // Clear any scheduled delayed send
    if (throttleTimeoutRef.current) {
      clearTimeout(throttleTimeoutRef.current);
      throttleTimeoutRef.current = null;
    }

    if (timeSinceLastSent > 150) {
      // Send immediately if throttle period has passed
      onMediaAction(ActionType.VOLUME_SET, String(val));
      lastSentTimeRef.current = now;
      lastSentVolumeRef.current = val;
    } else {
      // Otherwise schedule it for the end of the throttle window
      const delay = 150 - timeSinceLastSent;
      throttleTimeoutRef.current = setTimeout(() => {
        onMediaAction(ActionType.VOLUME_SET, String(val));
        lastSentTimeRef.current = Date.now();
        lastSentVolumeRef.current = val;
      }, delay);
    }
  };

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    isDraggingRef.current = true;
    lastInteractionTimeRef.current = Date.now();
    
    setVolume(val);
    onVolumeChange(val); // Update local state for immediate sync
    
    sendVolumeChange(val);
  };

  const handleDragEnd = () => {
    isDraggingRef.current = false;
    lastInteractionTimeRef.current = Date.now();
    
    // Ensure the final selected value is sent
    if (volume !== lastSentVolumeRef.current) {
      if (throttleTimeoutRef.current) {
        clearTimeout(throttleTimeoutRef.current);
        throttleTimeoutRef.current = null;
      }
      onMediaAction(ActionType.VOLUME_SET, String(volume));
      lastSentVolumeRef.current = volume;
    }
  };

  const handleMuteToggle = () => {
    setIsMuted(!isMuted);
    onMediaAction(ActionType.VOLUME_MUTE);
  };

  return (
    <div className="px-6 py-4">
      <HudPanel className="p-5 flex flex-col gap-4 shadow-xl">

        {/* Playback Controls */}
        <div className="flex items-center justify-between px-4">
          <button
            onClick={() => onMediaAction(ActionType.MEDIA_PREV)}
            className="p-3 hud-chip rounded-sm active:scale-90 transition-all text-hud-cyan/80 hover:text-hud-cyan"
          >
            <SkipBack size={20} />
          </button>

          <button
            onClick={() => onMediaAction(ActionType.MEDIA_PLAY_PAUSE)}
            className="p-5 bg-hud-cyan text-slate-950 rounded-sm shadow-lg shadow-hud-cyan/20 active:scale-95 transition-all hover:scale-105"
          >
            <Play size={24} fill="currentColor" className="translate-x-[2px]" />
          </button>

          <button
            onClick={() => onMediaAction(ActionType.MEDIA_NEXT)}
            className="p-3 hud-chip rounded-sm active:scale-90 transition-all text-hud-cyan/80 hover:text-hud-cyan"
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
            className="p-2 hud-chip rounded-sm transition-all text-hud-cyan/80 hover:text-hud-cyan"
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
              className="appearance-none w-full h-[3px] rounded-full bg-hud-dim [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-hud-cyan [&::-webkit-slider-thumb]:shadow-[0_0_8px_rgb(34_211_238_/_0.8)] [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-hud-cyan cursor-pointer"
            />
            <span className="text-[10px] font-data font-black text-slate-400 w-8 text-right">
              {volume}%
            </span>
          </div>
        </div>

      </HudPanel>
    </div>
  );
}
