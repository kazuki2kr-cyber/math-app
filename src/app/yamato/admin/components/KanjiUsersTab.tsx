'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, UserMinus } from 'lucide-react';
import { db } from '@/lib/firebase';
import { doc, getDoc, updateDoc, deleteField } from 'firebase/firestore';

interface KanjiUsersTabProps {
  users: any[];
  loading: boolean;
  refreshUsers: () => void;
  setMessage: (v: string) => void;
}

export default function KanjiUsersTab({ users, loading, refreshUsers, setMessage }: KanjiUsersTabProps) {

  const handleResetKanjiData = async (uid: string, name: string) => {
    if (!window.confirm(`${name} の【漢字関連データ】をすべて初期化しますか？\n（※数学のXPやレベル・試行履歴には一切影響しません）`)) {
      return;
    }

    try {
      // ユーザーの漢字データフィールドをすべて削除（または初期化）
      const userRef = doc(db, 'users', uid);
      await updateDoc(userRef, {
        kanjiXp: deleteField(),
        kanjiLevel: deleteField(),
        kanjiTitle: deleteField(),
        kanjiProgressPercent: deleteField(),
        kanjiCurrentLevelXp: deleteField(),
        kanjiNextLevelXp: deleteField(),
        kanjiTotalScore: deleteField(),
        kanjiUnitStats: deleteField(),
        kanjiUpdatedAt: deleteField(),
        kanjiIcon: deleteField()
      });

      // leaderboards/kanji から該当ユーザーを削除
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
  const handleResetAllKanjiData = async () => {
    if (!window.confirm('【警告】全員の漢字関連データをすべて初期化しますか？\n\n・数学のXPやレベルには影響しません。\n・この操作は取り消せません。')) {
      return;
    }
    
    try {
      const batchedUids = users.filter(u => u.kanjiXp !== undefined || u.kanjiUnitStats !== undefined).map(u => u.docId);
      
      // 更新対象のユーザーごとに個別にアップデート（数が多いとバッチ制限にかかる可能性があるのでループで行う。今回は数が少ない想定でも安全のため）
      for (const uid of batchedUids) {
        const userRef = doc(db, 'users', uid);
        await updateDoc(userRef, {
          kanjiXp: deleteField(),
          kanjiLevel: deleteField(),
          kanjiTitle: deleteField(),
          kanjiProgressPercent: deleteField(),
          kanjiCurrentLevelXp: deleteField(),
          kanjiNextLevelXp: deleteField(),
          kanjiTotalScore: deleteField(),
          kanjiUnitStats: deleteField(),
          kanjiUpdatedAt: deleteField(),
          kanjiIcon: deleteField()
        });
      }

      // ランキングを完全に空にする
      const lbRef = doc(db, 'leaderboards', 'kanji');
      await updateDoc(lbRef, { rankings: [] });

      setMessage(`✅ 全員（${batchedUids.length}名）の漢字データを初期化しました。`);
      refreshUsers();
    } catch (e: any) {
      console.error(e);
      setMessage(`エラー: ${e.message}`);
    }
  };

  return (
    <Card className="border-t-4 border-t-orange-500 shadow-sm mt-4 font-serif">
      <CardHeader>
        <div className="flex justify-between items-start">
          <div>
            <CardTitle className="text-orange-950">ユーザー管理（漢字データのリセット）</CardTitle>
            <CardDescription className="mr-4">各ユーザーの数学データを保持したまま、漢字に関するスコアや記録のみを初期化できます。</CardDescription>
          </div>
          <Button
            variant="destructive"
            onClick={handleResetAllKanjiData}
            disabled={loading || users.length === 0}
            className="flex-shrink-0 bg-red-600 hover:bg-red-700 text-white shadow-sm font-bold"
          >
            <UserMinus className="w-4 h-4 mr-2" /> 全員のデータを一括リセット
          </Button>
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
            {users.map(u => {
              const kanjiXp = u.kanjiXp || 0;
              const kanjiLevel = u.kanjiLevel || 1;
              const hasKanjiData = u.kanjiXp !== undefined || u.kanjiUnitStats !== undefined;

              return (
                <div key={u.docId} className="border border-orange-100 p-4 rounded-xl flex items-center justify-between hover:bg-orange-50/50 transition-colors">
                  <div>
                    <h3 className="font-bold text-orange-950 flex items-center gap-2">
                      {u.displayName || u.name || '名称未設定'}
                      <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded font-mono">UID: {u.docId}</span>
                    </h3>
                    <p className="text-sm mt-1 text-orange-900/70 font-medium">
                      {hasKanjiData ? (
                        <>漢字Lv: <span className="font-bold text-orange-700">{kanjiLevel}</span> ({kanjiXp} XP)</>
                      ) : (
                        <span className="text-gray-400">漢字プレイ履歴なし</span>
                      )}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => handleResetKanjiData(u.docId, u.displayName || u.name || '名称未設定')}
                    disabled={!hasKanjiData}
                    className="border-red-200 text-red-600 hover:bg-red-50"
                  >
                    <UserMinus className="w-4 h-4 mr-2" /> データリセット
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
