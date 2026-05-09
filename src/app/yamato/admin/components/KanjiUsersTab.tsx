'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Archive, Loader2, RotateCcw, ShieldAlert, ShieldCheck, ShieldQuestion, UserMinus } from 'lucide-react';
import { db } from '@/lib/firebase';
import { deleteField, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

interface KanjiUsersTabProps {
  users: any[];
  loading: boolean;
  refreshUsers: () => void;
  setMessage: (v: string) => void;
}

const KANJI_DATA_FIELDS = {
  kanjiXp: deleteField(),
  kanjiLevel: deleteField(),
  kanjiTitle: deleteField(),
  kanjiProgressPercent: deleteField(),
  kanjiCurrentLevelXp: deleteField(),
  kanjiNextLevelXp: deleteField(),
  kanjiTotalScore: deleteField(),
  kanjiUnitStats: deleteField(),
  kanjiUpdatedAt: deleteField(),
  kanjiIcon: deleteField(),
};

const KANJI_ACCESS_FIELDS = {
  kanjiAccessGranted: deleteField(),
  kanjiAccessBlocked: deleteField(),
  kanjiAccessFailedCount: deleteField(),
  kanjiAccessGrantedAt: deleteField(),
  kanjiAccessLastFailedAt: deleteField(),
};

const KANJI_SEASON1_ID = 'season1';
const KANJI_SEASON1_BADGE_URL = '/images/kanji-season1-badge.png';

function getUserName(user: any) {
  return user.displayName || user.name || user.email || '名称未設定';
}

function getSeason1BadgeFields(user: any, archivedAt: string) {
  const level = Number(user.kanjiLevel || 1);
  if (level < 100) return {};

  const badge = {
    seasonId: KANJI_SEASON1_ID,
    label: 'Season 1 認証',
    title: '万葉の匠',
    awardedAt: archivedAt,
    level,
    xp: Number(user.kanjiXp || 0),
    badgeImageUrl: KANJI_SEASON1_BADGE_URL,
  };

  return {
    kanjiSeasonBadges: {
      [KANJI_SEASON1_ID]: badge,
    },
    kanjiSeason1Certified: true,
    kanjiSeason1Badge: badge,
  };
}

function buildSeason1Archive(users: any[], archivedAt: string) {
  const participants = users.filter((user) => user.kanjiXp !== undefined || user.kanjiUnitStats !== undefined);
  const topXpRankings = participants
    .map((user) => ({
      uid: user.docId,
      name: getUserName(user),
      xp: Number(user.kanjiXp || 0),
      level: Number(user.kanjiLevel || 1),
      totalScore: Number(user.kanjiTotalScore || 0),
      certified: Number(user.kanjiLevel || 1) >= 100,
      badgeImageUrl: Number(user.kanjiLevel || 1) >= 100 ? KANJI_SEASON1_BADGE_URL : null,
    }))
    .sort((a, b) => {
      if (b.xp !== a.xp) return b.xp - a.xp;
      return b.totalScore - a.totalScore;
    })
    .slice(0, 10);

  const certifiedUsers = participants
    .filter((user) => Number(user.kanjiLevel || 1) >= 100)
    .map((user) => ({
      uid: user.docId,
      name: getUserName(user),
      xp: Number(user.kanjiXp || 0),
      level: Number(user.kanjiLevel || 1),
      totalScore: Number(user.kanjiTotalScore || 0),
      badgeImageUrl: KANJI_SEASON1_BADGE_URL,
    }))
    .sort((a, b) => b.level - a.level || b.xp - a.xp);

  return {
    seasonId: KANJI_SEASON1_ID,
    title: '漢字 Season 1',
    archivedAt,
    badgeImageUrl: KANJI_SEASON1_BADGE_URL,
    participantCount: participants.length,
    certifiedCount: certifiedUsers.length,
    topXpRankings,
    certifiedUsers,
  };
}

export default function KanjiUsersTab({ users, loading, refreshUsers, setMessage }: KanjiUsersTabProps) {
  const getKanjiAccessStatus = (user: any) => {
    const failedCount = Number(user.kanjiAccessFailedCount || 0);

    if (user.kanjiAccessBlocked === true) {
      return {
        label: 'ブロック中',
        detail: `失敗 ${failedCount}/3 回`,
        className: 'bg-red-50 text-red-700 border-red-200',
        Icon: ShieldAlert,
      };
    }

    if (user.kanjiAccessGranted === true) {
      return {
        label: '認証済み',
        detail: '漢字モード利用可',
        className: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        Icon: ShieldCheck,
      };
    }

    if (failedCount > 0) {
      return {
        label: '未認証',
        detail: `失敗 ${failedCount}/3 回`,
        className: 'bg-amber-50 text-amber-700 border-amber-200',
        Icon: ShieldQuestion,
      };
    }

    return {
      label: '未認証',
      detail: '失敗 0/3 回',
      className: 'bg-slate-50 text-slate-600 border-slate-200',
      Icon: ShieldQuestion,
    };
  };

  const handleResetKanjiData = async (uid: string, name: string) => {
    if (!window.confirm(`${name} の漢字関連データをすべて初期化しますか？\n\nLv.100以上の場合はSeason 1認証バッジを残します。\n数学のXPやレベル、試行履歴には影響しません。`)) {
      return;
    }

    try {
      const archivedAt = new Date().toISOString();
      const targetUser = users.find((u) => u.docId === uid) || {};
      const userRef = doc(db, 'users', uid);
      await updateDoc(userRef, {
        ...KANJI_DATA_FIELDS,
        ...getSeason1BadgeFields(targetUser, archivedAt),
      });

      const lbRef = doc(db, 'leaderboards', 'kanji');
      const lbSnap = await getDoc(lbRef);
      if (lbSnap.exists()) {
        const rankings = lbSnap.data().rankings || [];
        const newRankings = rankings.filter((r: any) => r.uid !== uid);
        await updateDoc(lbRef, { rankings: newRankings });
      }

      setMessage(`✅ ${name} の漢字データを初期化しました。`);
      refreshUsers();
    } catch (e: any) {
      console.error(e);
      setMessage(`エラー: ${e.message}`);
    }
  };

  const handleResetKanjiAccess = async (uid: string, name: string) => {
    if (!window.confirm(`${name} の漢字モード認証状態をリセットしますか？\n\n・ブロック状態を解除します\n・失敗回数を0回に戻します\n・次回アクセス時にパスワード入力が必要になります\n・漢字XPやスコアには影響しません`)) {
      return;
    }

    try {
      const userRef = doc(db, 'users', uid);
      await updateDoc(userRef, KANJI_ACCESS_FIELDS);

      setMessage(`✅ ${name} の漢字モード認証状態をリセットしました。`);
      refreshUsers();
    } catch (e: any) {
      console.error(e);
      setMessage(`エラー: ${e.message}`);
    }
  };

  const handleArchiveSeason1 = async () => {
    if (!window.confirm('現在の漢字データを Season 1 として保存しますか？\n\n・獲得XP上位10名をダッシュボードに残します\n・Lv.100以上のユーザーにSeason 1認証バッジを付与します\n・この操作だけではデータは削除しません')) {
      return;
    }

    try {
      const archivedAt = new Date().toISOString();
      await setDoc(doc(db, 'leaderboards', 'kanjiSeason1'), buildSeason1Archive(users, archivedAt));

      const certifiedUsers = users.filter((user) => Number(user.kanjiLevel || 1) >= 100);
      for (const user of certifiedUsers) {
        await updateDoc(doc(db, 'users', user.docId), getSeason1BadgeFields(user, archivedAt));
      }

      setMessage(`✅ Season 1を保存しました。XP上位10名と認証バッジ対象${certifiedUsers.length}名を記録しました。`);
      refreshUsers();
    } catch (e: any) {
      console.error(e);
      setMessage(`エラー: ${e.message}`);
    }
  };

  const handleResetAllKanjiData = async () => {
    if (!window.confirm('【警告】全員の漢字関連データをすべて初期化しますか？\n\n実行前に現在のデータをSeason 1として保存し、Lv.100以上には認証バッジを付与します。\n・数学のXPやレベルには影響しません。\n・この操作は取り消せません。')) {
      return;
    }

    try {
      const archivedAt = new Date().toISOString();
      const archive = buildSeason1Archive(users, archivedAt);
      await setDoc(doc(db, 'leaderboards', 'kanjiSeason1'), archive);

      const batchedUids = users
        .filter((u) => u.kanjiXp !== undefined || u.kanjiUnitStats !== undefined)
        .map((u) => u.docId);

      for (const uid of batchedUids) {
        const targetUser = users.find((u) => u.docId === uid) || {};
        const userRef = doc(db, 'users', uid);
        await updateDoc(userRef, {
          ...KANJI_DATA_FIELDS,
          ...getSeason1BadgeFields(targetUser, archivedAt),
        });
      }

      const lbRef = doc(db, 'leaderboards', 'kanji');
      await setDoc(lbRef, { rankings: [], updatedAt: archivedAt }, { merge: true });

      setMessage(`✅ Season 1を保存し、全員（${batchedUids.length}名）の漢字データを初期化しました。認証バッジ対象: ${archive.certifiedCount}名。`);
      refreshUsers();
    } catch (e: any) {
      console.error(e);
      setMessage(`エラー: ${e.message}`);
    }
  };

  return (
    <Card className="border-t-4 border-t-orange-500 shadow-sm mt-4 font-serif">
      <CardHeader>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle className="text-orange-950">ユーザー管理（漢字データ・認証状態）</CardTitle>
            <CardDescription className="mr-4">
              Season 1の記録を残しつつ、数学データを保持したまま漢字スコアや認証状態を管理できます。
            </CardDescription>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row lg:flex-shrink-0">
            <Button
              variant="outline"
              onClick={handleArchiveSeason1}
              disabled={loading || users.length === 0}
              className="border-amber-300 text-amber-800 hover:bg-amber-50 bg-white shadow-sm font-bold"
            >
              <Archive className="w-4 h-4 mr-2" /> Season 1を保存
            </Button>
            <Button
              variant="destructive"
              onClick={handleResetAllKanjiData}
              disabled={loading || users.length === 0}
              className="bg-red-600 hover:bg-red-700 text-white shadow-sm font-bold"
            >
              <UserMinus className="w-4 h-4 mr-2" /> 保存して一括リセット
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center p-8">
            <Loader2 className="w-6 h-6 animate-spin text-orange-400" />
          </div>
        ) : users.length === 0 ? (
          <div className="text-center p-8 text-orange-900/40">
            登録ユーザーがいません。
          </div>
        ) : (
          <div className="space-y-4">
            {users.map((user) => {
              const kanjiXp = user.kanjiXp || 0;
              const kanjiLevel = user.kanjiLevel || 1;
              const hasKanjiData = user.kanjiXp !== undefined || user.kanjiUnitStats !== undefined;
              const accessStatus = getKanjiAccessStatus(user);
              const AccessIcon = accessStatus.Icon;
              const name = getUserName(user);
              const hasSeason1Badge = user.kanjiSeasonBadges?.season1 || user.kanjiSeason1Certified === true;

              return (
                <div
                  key={user.docId}
                  className="border border-orange-100 p-4 rounded-xl flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between hover:bg-orange-50/50 transition-colors"
                >
                  <div className="min-w-0">
                    <h3 className="font-bold text-orange-950 flex flex-wrap items-center gap-2">
                      {name}
                      {hasSeason1Badge && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-800">
                          Season 1 認証
                        </span>
                      )}
                      <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded font-mono">
                        UID: {user.docId}
                      </span>
                    </h3>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="text-sm text-orange-900/70 font-medium">
                        {hasKanjiData ? (
                          <>漢字Lv: <span className="font-bold text-orange-700">{kanjiLevel}</span> ({kanjiXp} XP)</>
                        ) : (
                          <span className="text-gray-400">漢字プレイ履歴なし</span>
                        )}
                      </span>
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold ${accessStatus.className}`}>
                        <AccessIcon className="h-3.5 w-3.5" />
                        {accessStatus.label}
                        <span className="font-medium opacity-80">{accessStatus.detail}</span>
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row lg:flex-shrink-0">
                    <Button
                      variant="outline"
                      onClick={() => handleResetKanjiAccess(user.docId, name)}
                      className="border-amber-200 text-amber-700 hover:bg-amber-50"
                    >
                      <RotateCcw className="w-4 h-4 mr-2" /> 認証状態リセット
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => handleResetKanjiData(user.docId, name)}
                      disabled={!hasKanjiData}
                      className="border-red-200 text-red-600 hover:bg-red-50"
                    >
                      <UserMinus className="w-4 h-4 mr-2" /> データリセット
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
