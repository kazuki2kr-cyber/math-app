'use client';

import React, { useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { LogIn } from 'lucide-react';

export default function LoginPage() {
  const { user, loginWithGoogle, loading, error } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) {
      router.push('/');
    }
  }, [user, loading, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto bg-primary/10 p-3 rounded-full w-fit mb-2">
            <LogIn className="w-8 h-8 text-primary" />
          </div>
          <CardTitle className="text-2xl font-bold">数学学習演習</CardTitle>
          <CardDescription>
            学校アカウント（@shibaurafzk.com）でログインしてください
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {error && (
            <div className="bg-destructive/15 text-destructive text-sm p-3 rounded-md text-center">
              {error}
            </div>
          )}
          <Button 
            onClick={loginWithGoogle} 
            disabled={loading}
            className="w-full font-semibold"
            size="lg"
          >
            {loading ? '読み込み中...' : 'Googleでログイン'}
          </Button>
        </CardContent>
        <CardFooter className="text-xs text-center text-muted-foreground mt-4 flex justify-center">
          &copy; {new Date().getFullYear()} Math Learning App
        </CardFooter>
      </Card>
    </div>
  );
}
