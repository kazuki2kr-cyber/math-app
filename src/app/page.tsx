'use client';

import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { LogOut } from 'lucide-react';

export default function Home() {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white shadow-sm px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-primary">数学学習演習</h1>
        <div className="flex items-center gap-4">
          <span className="text-sm text-muted-foreground">{user?.displayName} さん</span>
          <Button variant="outline" size="sm" onClick={logout}>
            <LogOut className="w-4 h-4 mr-2" />
            ログアウト
          </Button>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-5xl mx-auto w-full">
        <h2 className="text-2xl font-bold mb-6">ダッシュボード</h2>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {/* 単元カードは後ほど実装 */}
          <div className="bg-white rounded-lg shadow p-6 flex items-center justify-center text-muted-foreground min-h-[150px]">
            単元データがありません
          </div>
        </div>
      </main>
    </div>
  );
}
