'use client';

import React from 'react';
import { AlertTriangle, Clock, RefreshCw } from 'lucide-react';

interface MaintenancePageProps {
  message?: string;
  scheduledEnd?: string;
}

export default function MaintenancePage({
  message = "現在、メンテナンスを行っております。しばらくお待ちください。",
  scheduledEnd
}: MaintenancePageProps) {

  const handleRetry = () => {
    window.location.reload();
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 selection:bg-primary/20">
      <div className="max-w-md w-full animate-in fade-in zoom-in duration-500">
        <div className="bg-white rounded-[2rem] shadow-2xl shadow-primary/10 overflow-hidden border border-slate-100">
          <div className="bg-amber-50 p-8 flex justify-center border-b border-amber-100/50">
            <div className="relative">
              <div className="absolute inset-0 bg-amber-200 blur-2xl opacity-30 animate-pulse"></div>
              <div className="relative bg-white p-5 rounded-2xl shadow-sm border border-amber-100">
                <AlertTriangle className="w-10 h-10 text-amber-500" />
              </div>
            </div>
          </div>

          <div className="p-8 md:p-10 text-center space-y-6">
            <div className="space-y-2">
              <h1 className="text-2xl font-black text-slate-800 tracking-tight">
                メンテナンス中です
              </h1>
              <p className="text-slate-500 text-sm leading-relaxed font-medium">
                {message}
              </p>
            </div>

            {scheduledEnd && (
              <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 flex items-center justify-center gap-3">
                <Clock className="w-4 h-4 text-primary" />
                <div className="text-left">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">終了予定時刻</p>
                  <p className="text-sm font-black text-slate-700">
                    {new Date(scheduledEnd).toLocaleString('ja-JP', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })} 頃
                  </p>
                </div>
              </div>
            )}

            <div className="pt-4">
              <button
                onClick={handleRetry}
                className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-4 px-6 rounded-2xl shadow-xl shadow-slate-200 transition-all active:scale-95 flex items-center justify-center gap-2 group"
              >
                <RefreshCw className="w-4 h-4 group-hover:rotate-180 transition-transform duration-500" />
                再読み込みして確認
              </button>
            </div>

            <p className="text-[10px] text-slate-400 font-medium">
              Copyright &copy; {new Date().getFullYear()} Formix. All rights reserved.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
