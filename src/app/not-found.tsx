'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';

export default function NotFound() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/');
  }, [router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F8FAEB] px-4">
      <div className="w-full max-w-md rounded-lg border border-primary/10 bg-white p-8 text-center shadow-lg">
        <RefreshCw className="mx-auto h-8 w-8 animate-spin text-primary" aria-hidden="true" />
        <h1 className="mt-5 text-xl font-bold text-gray-900">ホームへ戻っています</h1>
        <p className="mt-2 text-sm leading-relaxed text-gray-600">
          開いていたページが見つからないため、Formixのホームへ移動します。
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex h-11 items-center justify-center rounded-md bg-primary px-5 text-sm font-bold text-primary-foreground hover:bg-primary/90"
        >
          ホームへ戻る
        </Link>
      </div>
    </main>
  );
}
