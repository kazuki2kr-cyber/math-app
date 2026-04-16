'use client';

import React, { useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { LogIn } from 'lucide-react';
import Image from 'next/image';

export default function LoginPage() {
  const { user, loginWithGoogle, loginForEmulator, loginForAdminEmulator, loading, error } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) {
      router.push('/');
    }
  }, [user, loading, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50/50 p-4 relative overflow-hidden">
      {/* Decorative background elements */}
      <div className="absolute top-0 right-0 w-96 h-96 bg-primary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3"></div>
      <div className="absolute bottom-0 left-0 w-72 h-72 bg-secondary rounded-full blur-3xl translate-y-1/3 -translate-x-1/4"></div>

      <Card className="w-full max-w-lg shadow-xl border-t-4 border-t-primary bg-white/90 backdrop-blur z-10">
        <CardHeader className="text-center space-y-4 pt-10 pb-6">
          <div className="space-y-1">
            <p className="text-sm font-semibold tracking-widest text-primary uppercase">Forming the Essence of Knowledge.</p>
            <p className="text-xs text-muted-foreground">芝浦工業大学附属中学高等学校</p>
          </div>
          
          <div className="mx-auto w-24 h-24 sm:w-28 sm:h-28 overflow-hidden rounded-[2rem] shadow-xl flex items-center justify-center my-6">
            <Image src="/images/icon.webp" alt="Formix Icon" width={160} height={160} className="object-cover w-full h-full" priority />
          </div>
          
          <CardTitle className="text-4xl font-extrabold tracking-tight text-gray-900">Formix</CardTitle>
          <CardDescription className="text-base pt-2">
            学校アカウント（@shibaurafzk.com）でログインしてください
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5 px-10 pb-10">
          {error && (
            <div className="bg-destructive/10 border-l-4 border-destructive text-destructive text-sm p-4 rounded-md">
              {error}
            </div>
          )}
          <Button 
            onClick={loginWithGoogle} 
            disabled={loading}
            className="w-full h-14 text-lg font-bold shadow-lg hover:shadow-xl transition-all hover:-translate-y-0.5"
            size="lg"
          >
            {loading ? '読み込み中...' : 'Googleでログイン'}
          </Button>

          {process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === 'true' && (
            <>
              <Button
                onClick={loginForEmulator}
                disabled={loading}
                variant="outline"
                className="w-full h-12 text-md font-bold text-amber-600 border-amber-300 bg-amber-50"
                data-testid="emulator-login-button"
              >
                エミュレータ専用ログイン
              </Button>
              <Button
                onClick={loginForAdminEmulator}
                disabled={loading}
                variant="outline"
                className="w-full h-12 text-md font-bold text-red-600 border-red-300 bg-red-50"
                data-testid="emulator-admin-login-button"
              >
                エミュレータ管理者ログイン
              </Button>
            </>
          )}
        </CardContent>
        <CardFooter className="text-xs text-center text-muted-foreground pb-6 flex flex-col justify-center bg-gray-50/80 border-t py-4 gap-2">
          <div className="flex items-center justify-center">
            <a href="/terms" className="hover:underline hover:text-primary transition-colors mx-2">利用規約</a>
            |
            <a href="/privacy" className="hover:underline hover:text-primary transition-colors mx-2">プライバシーポリシー</a>
          </div>
          <div>&copy; {new Date().getFullYear()} Shibaura Institute of Technology Junior and Senior High School K.Ichikawa</div>
        </CardFooter>
      </Card>
    </div>
  );
}
