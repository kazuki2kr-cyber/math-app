'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { AlertTriangle, RefreshCw, Save, Shield, Users, X } from 'lucide-react';
import { getFunctions, httpsCallable } from 'firebase/functions';

interface RolesTabProps {
  // Maintenance
  maintenanceEnabled: boolean;
  setMaintenanceEnabled: (v: boolean) => void;
  maintenanceMessage: string;
  setMaintenanceMessage: (v: string) => void;
  maintenanceEnd: string;
  setMaintenanceEnd: (v: string) => void;
  maintenanceUpdateLoading: boolean;
  onUpdateMaintenance: () => void;
  // Roles
  roleEmail: string;
  setRoleEmail: (v: string) => void;
  adminList: Array<{ uid: string; email: string; displayName: string }>;
  adminListLoading: boolean;
  onFetchAdminList: () => void;
  onSetMessage: (v: string) => void;
}

export default function RolesTab({
  maintenanceEnabled, setMaintenanceEnabled,
  maintenanceMessage, setMaintenanceMessage,
  maintenanceEnd, setMaintenanceEnd,
  maintenanceUpdateLoading, onUpdateMaintenance,
  roleEmail, setRoleEmail,
  adminList, adminListLoading,
  onFetchAdminList, onSetMessage,
}: RolesTabProps) {
  const [localRoleLoading, setLocalRoleLoading] = React.useState(false);

  const handleRoleAction = async (isAdmin: boolean) => {
    if (!roleEmail || localRoleLoading) return;
    setLocalRoleLoading(true);
    try {
      const functions = getFunctions(undefined, 'us-central1');
      const setAdminClaim = httpsCallable(functions, 'setAdminClaim');
      const result: any = await setAdminClaim({ email: roleEmail, isAdmin });
      onSetMessage(`✅ ${result.data.message}`);
      setRoleEmail('');
      onFetchAdminList();
    } catch (err: any) {
      onSetMessage(`エラー: ${err.message}`);
    } finally {
      setLocalRoleLoading(false);
    }
  };

  return (
    <div className="space-y-6 mt-4 animate-in fade-in duration-500">
      {/* メンテナンスモード設定 */}
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

      {/* 管理者権限付与・剥奪 */}
      <Card className="shadow-sm">
        <CardHeader className="bg-gray-50 border-b">
          <CardTitle className="text-lg text-primary flex items-center gap-2">
            <Shield className="w-5 h-5" /> 管理者権限の管理
          </CardTitle>
          <CardDescription>Custom Claims を使用して管理者権限を付与・剥奪します。</CardDescription>
        </CardHeader>
        <CardContent className="p-6 space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
            <AlertTriangle className="inline w-4 h-4 mr-1" />
            管理者権限を付与されたユーザーは、全生徒のデータ閲覧・編集・削除が可能になります。慎重に操作してください。
          </div>
          <div className="flex gap-3">
            <Input
              type="email"
              placeholder="管理者に追加するメールアドレス"
              value={roleEmail}
              onChange={(e) => setRoleEmail(e.target.value)}
              className="flex-1"
            />
            <Button onClick={() => handleRoleAction(true)} disabled={localRoleLoading || !roleEmail} className="bg-primary">
              <Shield className="w-4 h-4 mr-2" /> 権限付与
            </Button>
            <Button variant="destructive" onClick={() => handleRoleAction(false)} disabled={localRoleLoading || !roleEmail}>
              <X className="w-4 h-4 mr-2" /> 権限剥奪
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">※ 権限変更後、対象ユーザーが次回ログインした際に反映されます。</p>
        </CardContent>
      </Card>

      {/* 管理者一覧 */}
      <Card className="shadow-sm">
        <CardHeader className="bg-gray-50 border-b flex flex-row items-center justify-between py-4">
          <div>
            <CardTitle className="text-lg text-primary flex items-center gap-2">
              <Users className="w-5 h-5" /> 登録済み管理者一覧
            </CardTitle>
            <CardDescription>admin Custom Claim が付与されているユーザー</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={onFetchAdminList} disabled={adminListLoading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${adminListLoading ? 'animate-spin' : ''}`} /> 更新
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {adminListLoading ? (
            <div className="flex justify-center p-8">
              <div className="animate-spin h-6 w-6 border-4 border-primary border-t-transparent rounded-full"></div>
            </div>
          ) : adminList.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">管理者が見つかりません。</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50/50">
                  <th className="text-left p-3 font-semibold text-gray-600">名前</th>
                  <th className="text-left p-3 font-semibold text-gray-600">メールアドレス</th>
                  <th className="text-left p-3 font-semibold text-gray-600">UID</th>
                </tr>
              </thead>
              <tbody>
                {adminList.map((a) => (
                  <tr key={a.uid} className="border-b hover:bg-gray-50 transition-colors">
                    <td className="p-3 font-medium">{a.displayName}</td>
                    <td className="p-3 text-muted-foreground">{a.email}</td>
                    <td className="p-3 font-mono text-xs text-muted-foreground">{a.uid.slice(0, 12)}...</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
