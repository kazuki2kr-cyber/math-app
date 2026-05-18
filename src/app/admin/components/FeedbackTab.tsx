'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { MessageSquare, RefreshCw } from 'lucide-react';

interface FeedbackTabProps {
  feedbackItems: any[];
  loading: boolean;
  onRefresh: () => void;
}

function formatDate(value: any) {
  if (!value) return '-';
  const date = value.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('ja-JP');
}

export default function FeedbackTab({ feedbackItems, loading, onRefresh }: FeedbackTabProps) {
  return (
    <div className="space-y-4 mt-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-primary" />
            ユーザーフィードバック
          </h3>
          <p className="text-xs text-muted-foreground mt-1">Formix本体から送信された声を新しい順に表示します。</p>
        </div>
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading} className="shadow-sm">
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          更新
        </Button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <table className="w-full text-sm text-left">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-4 font-bold uppercase text-[10px] tracking-wider">日時</th>
              <th className="px-4 py-4 font-bold uppercase text-[10px] tracking-wider">ユーザー</th>
              <th className="px-4 py-4 font-bold uppercase text-[10px] tracking-wider">内容</th>
              <th className="px-4 py-4 font-bold uppercase text-[10px] tracking-wider">ページ</th>
              <th className="px-4 py-4 font-bold uppercase text-[10px] tracking-wider">状態</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {feedbackItems.map((item) => (
              <tr key={item.id} className="hover:bg-gray-50/50 align-top">
                <td className="px-4 py-4 text-[10px] text-gray-500 font-mono whitespace-nowrap">
                  {formatDate(item.createdAt)}
                </td>
                <td className="px-4 py-4">
                  <p className="font-bold text-gray-900">{item.userName || '名前なし'}</p>
                  <p className="text-[10px] text-gray-500">{item.userEmail || item.uid || '-'}</p>
                  {item.uid && item.userEmail && (
                    <p className="text-[10px] text-gray-400 font-mono mt-1 break-all">{item.uid}</p>
                  )}
                </td>
                <td className="px-4 py-4 max-w-md">
                  <p className="whitespace-pre-wrap leading-relaxed text-gray-800">{item.message}</p>
                </td>
                <td className="px-4 py-4 text-[10px] text-primary font-bold break-all">
                  {item.pagePath || '-'}
                </td>
                <td className="px-4 py-4">
                  <span className="inline-flex rounded-full bg-primary/10 px-2 py-1 text-[10px] font-bold text-primary">
                    {item.status || 'new'}
                  </span>
                </td>
              </tr>
            ))}
            {feedbackItems.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-gray-400 italic">
                  まだフィードバックはありません。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
