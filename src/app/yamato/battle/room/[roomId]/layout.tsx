'use client';
import { useEffect } from 'react';
import { useParams } from 'next/navigation';
import { onDisconnect, onValue, push, ref, serverTimestamp, set } from 'firebase/database';
import { useAuth } from '@/contexts/AuthContext';
import { getRealtimeDb } from '@/lib/firebase';

// This layout survives navigation from waiting room to play to results.
export default function KanjiRoomLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { roomId } = useParams<{ roomId: string }>();
  useEffect(() => {
    if (!user || !/^\d{8}$/.test(roomId)) return;
    const database = getRealtimeDb();
    const connectionRef = push(ref(database, `kanjiBattleRooms/${roomId}/presence/${user.uid}`));
    const disconnect = onDisconnect(connectionRef);
    let disposed = false;
    let eligible = false;
    let connected = false;
    let registering = false;
    const register = async () => {
      if (disposed || !eligible || !connected || registering) return;
      registering = true;
      try {
        await disconnect.set({ connected: false, at: serverTimestamp() });
        if (disposed) { await disconnect.cancel(); return; }
        await set(connectionRef, { connected: true, at: serverTimestamp() });
        if (disposed) await set(connectionRef, { connected: false, at: serverTimestamp() });
      } catch (error) { console.error('Battle presence registration failed', error); }
      finally { registering = false; }
    };
    const stopMember = onValue(ref(database, `kanjiBattleRooms/${roomId}/participants/${user.uid}`), snap => {
      eligible = snap.exists() && !snap.val().abandoned;
      void register();
    }, () => { eligible = false; });
    const stopConnection = onValue(ref(database, '.info/connected'), snap => { connected = snap.val() === true; void register(); });
    return () => {
      disposed = true; stopMember(); stopConnection();
      void set(connectionRef, { connected: false, at: serverTimestamp() }).catch(() => undefined);
      void disconnect.cancel().catch(() => undefined);
    };
  }, [roomId, user]);
  return children;
}
