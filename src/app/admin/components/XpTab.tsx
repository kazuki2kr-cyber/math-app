'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Trash2, RefreshCw, Save, X } from 'lucide-react';
import { calculateLevelAndProgress, getTitleForLevel } from '@/lib/xp';

interface XpTabProps {
  users: any[];
  loading: boolean;
  displayUsersCount: number;
  setDisplayUsersCount: (fn: (prev: number) => number) => void;
  editingXp: Record<string, string>;
  setEditingXp: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onUpdateXp: (uid: string, xp: string) => void;
  onResetUserData: (uid: string, displayName: string) => void;
  onRefresh: () => void;
}

export default function XpTab({
  users, loading,
  displayUsersCount, setDisplayUsersCount,
  editingXp, setEditingXp,
  onUpdateXp, onResetUserData, onRefresh,
}: XpTabProps) {
  return (
    <div className="space-y-4 mt-4">
      <div className="flex justify-between items-center border-b pb-2">
        <p className="text-sm text-gray-500">登録ユーザー数: {users.length}</p>
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
          <RefreshCw className="w-4 h-4 mr-2" /> 再読み込み
        </Button>
      </div>

      <div className="bg-white rounded-md shadow overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="bg-gray-50 text-gray-600 border-b">
            <tr>
              <th className="px-4 py-3">#</th>
              <th className="px-4 py-3">ユーザー名</th>
              <th className="px-4 py-3">メール</th>
              <th className="px-4 py-3">レベル</th>
              <th className="px-4 py-3">称号</th>
              <th className="px-4 py-3">経験値</th>
              <th className="px-4 py-3">アイコン</th>
              <th className="px-4 py-3 text-center">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y text-gray-600">
            {users.slice(0, displayUsersCount).map((u, idx) => {
              const lvData = calculateLevelAndProgress(u.xp || 0);
              const title = getTitleForLevel(lvData.level);
              const isEditing = editingXp[u.docId] !== undefined;
              return (
                <tr key={u.docId} className="hover:bg-gray-50/50">
                  <td className="px-4 py-3 text-gray-400 font-mono">{idx + 1}</td>
                  <td className="px-4 py-3 font-medium">{u.displayName || '-'}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{u.email || '-'}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-800">
                      Lv.{lvData.level}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs font-medium text-amber-700">{title}</td>
                  <td className="px-4 py-3">
                    {isEditing ? (
                      <Input
                        type="number"
                        min="0"
                        value={editingXp[u.docId]}
                        onChange={(e) => setEditingXp(prev => ({ ...prev, [u.docId]: e.target.value }))}
                        className="w-24 h-8 text-sm"
                      />
                    ) : (
                      <span className="font-mono font-bold text-primary">{u.xp?.toLocaleString() || 0}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-2xl">{u.icon || '📐'}</td>
                  <td className="px-4 py-3">
                    {isEditing ? (
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" className="text-green-600 hover:text-green-800 hover:bg-green-50" onClick={() => onUpdateXp(u.docId, editingXp[u.docId])}>
                          <Save className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="sm" className="text-gray-500 hover:text-gray-700" onClick={() => setEditingXp(prev => { const n = { ...prev }; delete n[u.docId]; return n; })}>
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" className="text-blue-500 hover:text-blue-700 hover:bg-blue-50" onClick={() => setEditingXp(prev => ({ ...prev, [u.docId]: String(u.xp || 0) }))}>
                          編集
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-500 hover:text-white hover:bg-red-500 transition-colors"
                          onClick={() => onResetUserData(u.docId, u.displayName)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {users.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-500">ユーザーデータがありません</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {users.length > displayUsersCount && (
        <Button
          variant="outline"
          className="w-full text-xs h-9 text-muted-foreground border-dashed"
          onClick={() => setDisplayUsersCount(prev => prev + 100)}
        >
          もっと見る (+100)
        </Button>
      )}
    </div>
  );
}
