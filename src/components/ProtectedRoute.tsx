'use client';

import React, { useEffect, useState, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter, usePathname } from 'next/navigation';
import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import MaintenancePage from './MaintenancePage';

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, isAdmin } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [maintenance, setMaintenance] = useState<{ enabled: boolean; message?: string; scheduledEnd?: string } | null>(null);
  const [maintenanceLoading, setMaintenanceLoading] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const checkMaintenance = async () => {
      try {
        const snapshot = await getDoc(doc(db, 'config', 'maintenance'));
        if (snapshot.exists()) {
          setMaintenance(snapshot.data() as any);
        } else {
          setMaintenance({ enabled: false });
        }
      } catch (error) {
        console.error("Maintenance check failed:", error);
        setMaintenance({ enabled: false });
      } finally {
        setMaintenanceLoading(false);
      }
    };

    checkMaintenance();

    const scheduleNext = () => {
      timerRef.current = setTimeout(() => {
        checkMaintenance();
        scheduleNext();
      }, POLL_INTERVAL_MS);
    };
    scheduleNext();

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!loading && !user && pathname !== '/login') {
      router.push('/login');
    }
  }, [user, loading, router, pathname]);

  if (loading || maintenanceLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full font-bold"></div>
      </div>
    );
  }

  // メンテナンスモード有効時 (管理者はバイパス)
  if (maintenance?.enabled && !isAdmin && pathname !== '/login') {
    return <MaintenancePage message={maintenance.message} scheduledEnd={maintenance.scheduledEnd} />;
  }

  if (!user && pathname !== '/login') {
    return null;
  }

  return <>{children}</>;
}
