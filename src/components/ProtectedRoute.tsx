'use client';

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter, usePathname } from 'next/navigation';
import { db, functions as firebaseFunctions } from '@/lib/firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import MaintenancePage from './MaintenancePage';
import { hasAcceptedCurrentLegalDocs, LEGAL_EFFECTIVE_DATE_LABEL } from '@/lib/legal';

type KanjiAccessStatus = {
  granted: boolean;
  blocked: boolean;
  failedCount: number;
};

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, isAdmin, agreeToTerms, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const isKanjiMode = pathname.startsWith('/yamato') || pathname.startsWith('/kanji');
  const targetConfig = isKanjiMode ? 'maintenance_kanji' : 'maintenance';
  const isLegalPublicPage = pathname === '/login' || pathname === '/terms' || pathname === '/privacy';
  const needsLegalAgreement = Boolean(
    user &&
    !isLegalPublicPage &&
    !hasAcceptedCurrentLegalDocs(user) &&
    process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR !== 'true'
  );
  const [maintenance, setMaintenance] = useState<{ enabled: boolean; message?: string; scheduledEnd?: string } | null>(null);
  const [maintenanceLoading, setMaintenanceLoading] = useState(true);
  const [kanjiAccess, setKanjiAccess] = useState<KanjiAccessStatus | null>(null);
  const [kanjiAccessLoading, setKanjiAccessLoading] = useState(false);
  const [kanjiPassword, setKanjiPassword] = useState('');
  const [kanjiPasswordSubmitting, setKanjiPasswordSubmitting] = useState(false);
  const [kanjiPasswordError, setKanjiPasswordError] = useState('');
  const [termsChecked, setTermsChecked] = useState(false);
  const [savingTerms, setSavingTerms] = useState(false);

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
    if (!isKanjiMode || !user || needsLegalAgreement) {
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
  }, [isKanjiMode, needsLegalAgreement, user]);

  useEffect(() => {
    if (!loading && !maintenanceLoading && !maintenance?.enabled && !user && !isLegalPublicPage) {
      router.push('/login');
    }
  }, [user, loading, maintenanceLoading, maintenance, router, isLegalPublicPage]);

  const handleAgreeToTerms = async () => {
    if (!termsChecked || savingTerms) return;
    setSavingTerms(true);
    try {
      await agreeToTerms();
    } finally {
      setSavingTerms(false);
    }
  };

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

  if (loading || maintenanceLoading || (isKanjiMode && user && !needsLegalAgreement && kanjiAccessLoading)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full font-bold"></div>
      </div>
    );
  }

  if (maintenance?.enabled && !isAdmin && pathname !== '/login') {
    return <MaintenancePage message={maintenance.message} scheduledEnd={maintenance.scheduledEnd} />;
  }

  if (!user && !isLegalPublicPage) {
    return null;
  }

  if (needsLegalAgreement) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8FAEB] px-4 py-8">
        <div className="w-full max-w-lg rounded-2xl border border-primary/10 bg-white p-8 shadow-xl">
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-black text-gray-900">利用規約の確認</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {LEGAL_EFFECTIVE_DATE_LABEL} 改正版の利用規約とプライバシーポリシーへの同意が必要です。
            </p>
          </div>

          <div className="mb-5 rounded-xl border bg-gray-50 p-4 text-sm leading-relaxed text-gray-700">
            <p>
              Formix を利用する前に、利用規約とプライバシーポリシーを確認してください。
              同意後、直前に開こうとしていたページをそのまま利用できます。
            </p>
            <div className="mt-4 flex flex-col gap-2 text-center font-bold sm:flex-row sm:justify-center">
              <a href="/terms" target="_blank" rel="noreferrer" className="text-blue-600 hover:text-blue-800 hover:underline">
                利用規約を読む
              </a>
              <a href="/privacy" target="_blank" rel="noreferrer" className="text-blue-600 hover:text-blue-800 hover:underline">
                プライバシーポリシーを読む
              </a>
            </div>
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-transparent p-3 transition-colors hover:border-gray-200 hover:bg-gray-50">
            <input
              type="checkbox"
              checked={termsChecked}
              onChange={(event) => setTermsChecked(event.target.checked)}
              className="mt-1 h-5 w-5 flex-shrink-0 rounded border-gray-300 text-primary focus:ring-primary"
            />
            <span className="text-sm font-medium leading-relaxed text-gray-800">
              利用規約およびプライバシーポリシーの内容を確認し、すべての条項に同意します。
            </span>
          </label>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={logout}
              disabled={savingTerms}
              className="h-12 rounded-xl border border-gray-200 px-4 text-sm font-bold text-gray-600 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 sm:w-40"
            >
              ログアウト
            </button>
            <button
              type="button"
              onClick={handleAgreeToTerms}
              disabled={!termsChecked || savingTerms}
              className="h-12 flex-1 rounded-xl bg-primary px-4 text-base font-bold text-primary-foreground shadow-md transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-primary/40"
            >
              {savingTerms ? '処理中...' : '同意して続ける'}
            </button>
          </div>
        </div>
      </div>
    );
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
