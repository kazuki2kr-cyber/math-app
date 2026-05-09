'use client';

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter, usePathname } from 'next/navigation';
import { db, functions as firebaseFunctions } from '@/lib/firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import MaintenancePage from './MaintenancePage';

type KanjiAccessStatus = {
  granted: boolean;
  blocked: boolean;
  failedCount: number;
};

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, isAdmin } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const isKanjiMode = pathname.startsWith('/yamato') || pathname.startsWith('/kanji');
  const targetConfig = isKanjiMode ? 'maintenance_kanji' : 'maintenance';
  const [maintenance, setMaintenance] = useState<{ enabled: boolean; message?: string; scheduledEnd?: string } | null>(null);
  const [maintenanceLoading, setMaintenanceLoading] = useState(true);
  const [kanjiAccess, setKanjiAccess] = useState<KanjiAccessStatus | null>(null);
  const [kanjiAccessLoading, setKanjiAccessLoading] = useState(false);
  const [kanjiPassword, setKanjiPassword] = useState('');
  const [kanjiPasswordSubmitting, setKanjiPasswordSubmitting] = useState(false);
  const [kanjiPasswordError, setKanjiPasswordError] = useState('');

  useEffect(() => {
    setMaintenanceLoading(true);
    const unsubscribe = onSnapshot(doc(db, 'config', targetConfig), (snapshot) => {
      if (snapshot.exists()) {
        setMaintenance(snapshot.data() as any);
      } else {
        setMaintenance({ enabled: false });
      }
      setMaintenanceLoading(false);
    }, (error) => {
      console.error(`Maintenance check failed for ${targetConfig}:`, error);
      setMaintenance({ enabled: false });
      setMaintenanceLoading(false);
    });

    return () => unsubscribe();
  }, [targetConfig]);

  useEffect(() => {
    if (!isKanjiMode || !user) {
      setKanjiAccess(null);
      setKanjiAccessLoading(false);
      return;
    }

    setKanjiAccessLoading(true);
    const unsubscribe = onSnapshot(doc(db, 'users', user.uid), (snapshot) => {
      const data = snapshot.exists() ? snapshot.data() : {};
      setKanjiAccess({
        granted: data.kanjiAccessGranted === true,
        blocked: data.kanjiAccessBlocked === true,
        failedCount: Number(data.kanjiAccessFailedCount || 0),
      });
      setKanjiAccessLoading(false);
    }, (error) => {
      console.error('Kanji access check failed:', error);
      setKanjiAccess({ granted: false, blocked: false, failedCount: 0 });
      setKanjiAccessLoading(false);
    });

    return () => unsubscribe();
  }, [isKanjiMode, user]);

  useEffect(() => {
    if (!loading && !maintenanceLoading && !maintenance?.enabled && !user && pathname !== '/login') {
      router.push('/login');
    }
  }, [user, loading, maintenanceLoading, maintenance, router, pathname]);

  const submitKanjiPassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!kanjiPassword || kanjiPasswordSubmitting) return;

    setKanjiPasswordSubmitting(true);
    setKanjiPasswordError('');
    try {
      const verifyPassword = httpsCallable<
        { password: string },
        { granted: boolean; blocked: boolean; remainingAttempts: number }
      >(firebaseFunctions, 'verifyKanjiAccessPassword');
      const result = await verifyPassword({ password: kanjiPassword });
      setKanjiPassword('');

      if (result.data.blocked) {
        setKanjiPasswordError('パスワードを3回間違えたため、このユーザーは漢字モードを利用できません。');
        return;
      }

      if (!result.data.granted) {
        setKanjiPasswordError(`パスワードが違います。残り${result.data.remainingAttempts}回です。`);
      }
    } catch (error) {
      console.error('Kanji password verification failed:', error);
      setKanjiPasswordError('パスワードの確認に失敗しました。時間をおいて再度お試しください。');
    } finally {
      setKanjiPasswordSubmitting(false);
    }
  };

  if (loading || maintenanceLoading || (isKanjiMode && user && kanjiAccessLoading)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full font-bold"></div>
      </div>
    );
  }

  if (maintenance?.enabled && !isAdmin && pathname !== '/login') {
    return <MaintenancePage message={maintenance.message} scheduledEnd={maintenance.scheduledEnd} />;
  }

  if (!user && pathname !== '/login') {
    return null;
  }

  if (isKanjiMode && user && kanjiAccess?.blocked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FDF6E3] px-4">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl border border-orange-900/10 text-center">
          <h1 className="text-2xl font-black text-orange-950 mb-3">漢字モードは利用できません</h1>
          <p className="text-sm text-orange-900/70 leading-relaxed">
            パスワードを3回間違えたため、このユーザーは漢字モードを利用できません。
          </p>
          <button
            type="button"
            onClick={() => router.push('/')}
            className="mt-6 w-full rounded-xl bg-orange-900 px-4 py-3 text-sm font-bold text-white hover:bg-orange-950 transition-colors"
          >
            ホームへ戻る
          </button>
        </div>
      </div>
    );
  }

  if (isKanjiMode && user && !kanjiAccess?.granted) {
    const remainingAttempts = Math.max(0, 3 - (kanjiAccess?.failedCount || 0));

    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FDF6E3] px-4">
        <form
          onSubmit={submitKanjiPassword}
          className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl border border-orange-900/10"
        >
          <h1 className="text-2xl font-black text-orange-950 mb-2">漢字モード</h1>
          <p className="text-sm text-orange-900/70 mb-6">
            利用するにはパスワードを入力してください。3回間違えると、このユーザーでは利用できなくなります。
          </p>
          <label className="block text-sm font-bold text-orange-950 mb-2" htmlFor="kanji-password">
            パスワード
          </label>
          <input
            id="kanji-password"
            type="password"
            value={kanjiPassword}
            onChange={(event) => setKanjiPassword(event.target.value)}
            autoComplete="off"
            className="w-full rounded-xl border border-orange-900/20 px-4 py-3 text-base outline-none focus:border-orange-700 focus:ring-4 focus:ring-orange-100"
          />
          <div className="mt-3 min-h-5 text-sm font-semibold text-red-600">
            {kanjiPasswordError}
          </div>
          <div className="mt-1 text-xs text-orange-900/50">
            残り{remainingAttempts}回
          </div>
          <button
            type="submit"
            disabled={!kanjiPassword || kanjiPasswordSubmitting}
            className="mt-6 w-full rounded-xl bg-orange-900 px-4 py-3 text-sm font-bold text-white hover:bg-orange-950 disabled:cursor-not-allowed disabled:bg-orange-900/40 transition-colors"
          >
            {kanjiPasswordSubmitting ? '確認中...' : '入る'}
          </button>
        </form>
      </div>
    );
  }

  return <>{children}</>;
}
