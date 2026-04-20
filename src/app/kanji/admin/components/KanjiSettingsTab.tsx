'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { AlertTriangle, RefreshCw, Save, Settings } from 'lucide-react';

interface KanjiSettingsTabProps {
  maintenanceEnabled: boolean;
  setMaintenanceEnabled: (v: boolean) => void;
  maintenanceMessage: string;
  setMaintenanceMessage: (v: string) => void;
  maintenanceEnd: string;
  setMaintenanceEnd: (v: string) => void;
  maintenanceUpdateLoading: boolean;
  onUpdateMaintenance: () => void;
}

export default function KanjiSettingsTab({
  maintenanceEnabled, setMaintenanceEnabled,
  maintenanceMessage, setMaintenanceMessage,
  maintenanceEnd, setMaintenanceEnd,
  maintenanceUpdateLoading, onUpdateMaintenance
}: KanjiSettingsTabProps) {
  return (
    <div className="space-y-6 mt-4 animate-in fade-in duration-500">
      <Card className={`border-t-4 ${maintenanceEnabled ? 'border-t-amber-500 shadow-amber-100' : 'border-t-slate-200'} shadow-md overflow-hidden transition-all duration-300`}>
        <CardHeader className={`${maintenanceEnabled ? 'bg-amber-50/50' : 'bg-slate-50/50'} py-4`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-xl ${maintenanceEnabled ? 'bg-amber-100 text-amber-600' : 'bg-slate-200 text-slate-500'}`}>
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <CardTitle className="text-lg">メンテナンスモード設定</CardTitle>
                <CardDescription>
                  {maintenanceEnabled
                    ? '現在メンテナンスモードが有効です。一般ユーザーはアクセスできません。'
                    : '現在通常稼働中です。'}
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-4 bg-white p-1.5 rounded-2xl border shadow-sm">
              <span className={`text-xs font-black px-3 ${maintenanceEnabled ? 'text-amber-600' : 'text-slate-400'}`}>
                {maintenanceEnabled ? '有効' : '無効'}
              </span>
              <button
                onClick={() => setMaintenanceEnabled(!maintenanceEnabled)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${maintenanceEnabled ? 'bg-amber-500' : 'bg-slate-200'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${maintenanceEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700">表示メッセージ</label>
              <Input
                placeholder="現在メンテナンス中です..."
                value={maintenanceMessage}
                onChange={(e) => setMaintenanceMessage(e.target.value)}
                className="focus-visible:ring-amber-500"
              />
              <p className="text-[10px] text-slate-400 font-medium">ユーザーに表示される説明文です。</p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700">終了予定時刻</label>
              <Input
                type="datetime-local"
                value={maintenanceEnd}
                onChange={(e) => setMaintenanceEnd(e.target.value)}
                className="focus-visible:ring-amber-500"
              />
              <p className="text-[10px] text-slate-400 font-medium">任意設定。ユーザーに目安を表示します。</p>
            </div>
          </div>
          <div className="flex justify-end pt-2 border-t border-slate-100">
            <Button
              onClick={onUpdateMaintenance}
              disabled={maintenanceUpdateLoading}
              className={`rounded-xl px-8 font-black ${maintenanceEnabled ? 'bg-amber-600 hover:bg-amber-700 text-white' : 'bg-slate-900 hover:bg-slate-800 text-white'}`}
            >
              {maintenanceUpdateLoading ? (
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Save className="w-4 h-4 mr-2" />
              )}
              設定を保存して反映
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
