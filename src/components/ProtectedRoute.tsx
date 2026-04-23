'use client';

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter, usePathname } from 'next/navigation';
import { db } from '@/lib/firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import MaintenancePage from './MaintenancePage';

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, isAdmin } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const targetConfig = pathname.startsWith('/yamato') ? 'maintenance_kanji' : 'maintenance';
  const [maintenance, setMaintenance] = useState<{ enabled: boolean; message?: string; scheduledEnd?: string } | null>(null);
  const [maintenanceLoading, setMaintenanceLoading] = useState(true);

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
    if (!loading && !maintenanceLoading && !maintenance?.enabled && !user && pathname !== '/login') {
      router.push('/login');
    }
  }, [user, loading, maintenanceLoading, maintenance, router, pathname]);

  if (loading || maintenanceLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full font-bold"></div>
      </div>
    );
  }

  if (maintenance?.enabled && !isAdmin && pathname !== '/login') {
    return <MaintenancePage message={maintenance.message} scheduledEnd={maintenance.scheduledEnd} />;
  }

  if (!user && pathname !== '/login') {
    return null;
  }

  return <>{children}</>;
}
