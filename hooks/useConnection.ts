import { useState, useEffect, useCallback } from 'react';
import { executor } from '../services/automation';
import { SystemStats } from '../types';

interface ConnectionState {
  pcIpAddress: string;
  connectionStatus: 'connected' | 'disconnected' | 'connecting';
  systemStats?: SystemStats;
  accessPin: string;
}

export function useConnection() {
  const [pcIpAddress, setPcIpAddress] = useState(() => localStorage.getItem('nexus_pc_ip') || '');
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'connecting'>('disconnected');
  const [systemStats, setSystemStats] = useState<SystemStats | undefined>();
  const [accessPin, setAccessPin] = useState(() => localStorage.getItem('nexus_access_pin') || '');

  const updateIp = useCallback((ip: string) => {
    const cleaned = ip.trim();
    setPcIpAddress(cleaned);
    localStorage.setItem('nexus_pc_ip', cleaned);
  }, []);

  const updatePin = useCallback((pin: string) => {
    const cleaned = pin.replace(/[^0-9]/g, '');
    setAccessPin(cleaned);
    localStorage.setItem('nexus_access_pin', cleaned);
  }, []);

  const pairDevice = async (ip: string, pin: string): Promise<{ success: boolean; error?: string }> => {
    const cleanIp = ip.replace(/^https?:\/\//, '').replace(/\/$/, '').trim();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(`http://${cleanIp}:8080/pair`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ pin })
      });
      clearTimeout(timeoutId);
      if (res.status === 200) {
        const data = await res.json();
        if (data.success) {
          updateIp(cleanIp);
          updatePin(pin);
          setConnectionStatus('connected');
          return { success: true };
        }
      }
      if (res.status === 401) {
        return { success: false, error: 'Hatalı PIN Kodu!' };
      }
      return { success: false, error: 'Bağlantı başarısız oldu.' };
    } catch (e) {
      return { success: false, error: 'PC Ajanına bağlanılamadı. IP adresini ve ajanın açık olduğunu kontrol edin.' };
    }
  };

  useEffect(() => {
    if (!pcIpAddress) return;

    // 1. Connection and pairing verification (runs every 8s)
    const checkConn = async () => {
      const ok = await executor.ping(pcIpAddress);

      if (!ok) {
        setConnectionStatus('disconnected');
        return;
      }

      if (accessPin) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 2000);
          const pairRes = await fetch(`http://${pcIpAddress}:8080/pair`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pin: accessPin }),
            signal: controller.signal
          });
          clearTimeout(timeoutId);

          if (pairRes.status === 401) {
            setAccessPin('');
            localStorage.removeItem('nexus_access_pin');
            setConnectionStatus('disconnected');
            return;
          }
        } catch {
          // Ignore network glitch during pair check
        }
      }

      setConnectionStatus('connected');
    };

    // 2. Stats/Volume polling (runs every 1.5s for real-time synchronization)
    const fetchStats = async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1200);
        const res = await fetch(`http://${pcIpAddress}:8080/stats`, {
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (res.ok) {
          const stats = await res.json();
          setSystemStats(stats);
          setConnectionStatus('connected');
        }
      } catch {
        // Prevent instant disconnect on single request failure to avoid flickering
      }
    };

    // Initial check and immediate stats load
    checkConn().then(() => {
      fetchStats();
    });

    const connInterval = setInterval(checkConn, 8000);
    const statsInterval = setInterval(fetchStats, 1500);

    return () => {
      clearInterval(connInterval);
      clearInterval(statsInterval);
    };
  }, [pcIpAddress, accessPin]);

  return {
    pcIpAddress,
    connectionStatus,
    systemStats,
    setSystemStats,
    accessPin,
    updateIp,
    updatePin,
    pairDevice,
  };
}
