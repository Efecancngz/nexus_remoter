import React, { useState, useEffect, useRef } from 'react';
import { Mic, Loader2 } from 'lucide-react';

interface VoiceButtonProps {
  onAudioReady: (base64Data: string, mimeType: string) => void;
  onToast: (message: string, type: 'success' | 'error' | 'info' | 'warning') => void;
  hapticEnabled?: boolean;
}

type VoiceState = 'idle' | 'recording' | 'processing';

export default function VoiceButton({ onAudioReady, onToast, hapticEnabled = true }: VoiceButtonProps) {
  const [state, setState] = useState<VoiceState>('idle');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timeoutRef = useRef<any>(null);

  const triggerVibrate = (pattern: number | number[]) => {
    if (hapticEnabled && navigator.vibrate) {
      navigator.vibrate(pattern);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

      // Determine mime type support
      let mimeType = 'audio/webm';
      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        mimeType = 'audio/webm;codecs=opus';
      } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
        mimeType = 'audio/mp4'; // iOS Safari fallback
      } else if (MediaRecorder.isTypeSupported('audio/ogg')) {
        mimeType = 'audio/ogg';
      }

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        setState('processing');
        try {
          const audioBlob = new Blob(chunksRef.current, { type: mimeType });
          
          // Convert Blob to Base64
          const reader = new FileReader();
          reader.readAsDataURL(audioBlob);
          reader.onloadend = () => {
            const base64String = reader.result as string;
            // base64String looks like: "data:audio/webm;codecs=opus;base64,GkXfo..."
            const base64Data = base64String.split(',')[1];
            onAudioReady(base64Data, mimeType.split(';')[0]);
            setState('idle');
          };
        } catch (err) {
          console.error("Audio processing error", err);
          onToast("Ses verisi işlenirken hata oluştu.", "error");
          setState('idle');
        }
      };

      mediaRecorder.start(250); // Get chunks every 250ms
      setState('recording');

      // Vibrate on start: 1 short pulse
      triggerVibrate(80);

      // Automatically stop recording after 6 seconds to prevent huge payloads
      timeoutRef.current = setTimeout(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          stopRecording();
          onToast("Maksimum konuşma süresine ulaşıldı.", "info");
        }
      }, 6000);

    } catch (err: any) {
      console.error("Microphone access error", err);
      let msg = "Mikrofona erişilemedi.";
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        msg = "Mikrofon izni reddedildi. Lütfen tarayıcı ayarlarından mikrofon izni verin.";
      }
      onToast(msg, "error");
      setState('idle');
      // Vibrate on error: 1 heavy pulse
      triggerVibrate(200);
    }
  };

  const stopRecording = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
      // Vibrate on stop: 1 very short pulse
      triggerVibrate(40);
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const handleClick = () => {
    if (state === 'recording') {
      stopRecording();
    } else if (state === 'idle') {
      startRecording();
    }
  };

  return (
    <>
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes voiceBounce1 {
          0%, 100% { transform: scaleY(0.4); }
          50% { transform: scaleY(1.2); }
        }
        @keyframes voiceBounce2 {
          0%, 100% { transform: scaleY(0.3); }
          50% { transform: scaleY(1.6); }
        }
        @keyframes voiceBounce3 {
          0%, 100% { transform: scaleY(0.6); }
          50% { transform: scaleY(1.1); }
        }
        @keyframes voiceBounce4 {
          0%, 100% { transform: scaleY(0.4); }
          50% { transform: scaleY(1.4); }
        }
        .animate-voice-bar-1 { animation: voiceBounce1 0.6s ease-in-out infinite; }
        .animate-voice-bar-2 { animation: voiceBounce2 0.75s ease-in-out infinite; }
        .animate-voice-bar-3 { animation: voiceBounce3 0.5s ease-in-out infinite; }
        .animate-voice-bar-4 { animation: voiceBounce4 0.85s ease-in-out infinite; }
      `}} />

      <button
        onClick={handleClick}
        disabled={state === 'processing'}
        className={`w-12 h-12 rounded-full flex items-center justify-center transition-all active:scale-95 relative shrink-0 ${
          state === 'recording'
            ? 'bg-red-600 text-white shadow-[0_0_15px_rgba(220,38,38,0.5)]'
            : state === 'processing'
            ? 'bg-cyan-500 text-slate-950 shadow-[0_0_15px_rgba(6,182,212,0.5)] animate-pulse'
            : 'bg-gradient-to-tr from-cyan-500 to-indigo-500 text-slate-950 shadow-[0_4px_10px_rgba(6,182,212,0.3)] hover:brightness-110'
        }`}
      >
        {state === 'recording' && (
          <>
            <span className="absolute inset-0 rounded-full bg-red-600/40 animate-ping pointer-events-none" />
            <span className="absolute -inset-1.5 rounded-full border border-red-500/30 animate-pulse pointer-events-none" />
          </>
        )}

        {state === 'processing' ? (
          <Loader2 className="animate-spin" size={18} />
        ) : state === 'recording' ? (
          <div className="flex items-center gap-0.5 justify-center h-4 w-6">
            <span className="w-[2.5px] h-3 bg-white rounded-full animate-voice-bar-1 origin-center" />
            <span className="w-[2.5px] h-5 bg-white rounded-full animate-voice-bar-2 origin-center" />
            <span className="w-[2.5px] h-2 bg-white rounded-full animate-voice-bar-3 origin-center" />
            <span className="w-[2.5px] h-4 bg-white rounded-full animate-voice-bar-4 origin-center" />
          </div>
        ) : (
          <Mic size={18} strokeWidth={2.5} />
        )}
      </button>
    </>
  );
}
