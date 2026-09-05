'use client';
import { useEffect, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { getRealtimeDb } from '@/lib/firebase';

export function useBattleClock() {
  const [clock, setClock] = useState({ nowMs: 0, synchronized: false, connected: false });
  useEffect(() => {
    let connected = false;
    let anchor: { server: number; monotonic: number } | null = null;
    const tick = () => setClock({
      nowMs: anchor ? anchor.server + performance.now() - anchor.monotonic : 0,
      synchronized: connected && anchor !== null, connected,
    });
    const database = getRealtimeDb();
    const stopOffset = onValue(ref(database, '.info/serverTimeOffset'), snap => {
      if (typeof snap.val() === 'number') anchor = { server: Date.now() + snap.val(), monotonic: performance.now() };
      tick();
    });
    const stopConnection = onValue(ref(database, '.info/connected'), snap => { connected = snap.val() === true; tick(); });
    const timer = window.setInterval(tick, 100);
    return () => { stopOffset(); stopConnection(); window.clearInterval(timer); };
  }, []);
  return clock;
}
