'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight, NotebookPen } from 'lucide-react';
import { HandwritingCanvas, type HandwritingStroke } from '@/components/HandwritingCanvas';
import { Button } from '@/components/ui/button';

interface ScratchPaperReviewProps {
  pages: HandwritingStroke[][];
}

export function ScratchPaperReview({ pages }: ScratchPaperReviewProps) {
  const visiblePages = pages.filter((page) => page.length > 0);
  const [activePage, setActivePage] = useState(0);

  if (visiblePages.length === 0) return null;

  const safeActivePage = Math.min(activePage, visiblePages.length - 1);

  return (
    <details className="mt-5 overflow-hidden rounded-xl border border-sky-200 bg-sky-50/60">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-bold text-sky-900 marker:hidden">
        <span className="flex items-center gap-2">
          <NotebookPen className="h-5 w-5" />
          この問題で書いた計算用紙
        </span>
        <span className="rounded-full bg-sky-100 px-2 py-1 text-xs text-sky-800">
          {visiblePages.length}枚
        </span>
      </summary>
      <div className="border-t border-sky-200 bg-white p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={safeActivePage === 0}
            onClick={() => setActivePage((current) => Math.max(0, current - 1))}
          >
            <ChevronLeft className="mr-1 h-4 w-4" />
            前へ
          </Button>
          <span className="text-xs font-bold text-muted-foreground">
            {safeActivePage + 1} / {visiblePages.length}ページ
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={safeActivePage >= visiblePages.length - 1}
            onClick={() => setActivePage((current) => Math.min(visiblePages.length - 1, current + 1))}
          >
            次へ
            <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
        <HandwritingCanvas
          key={safeActivePage}
          readOnly
          initialStrokes={visiblePages[safeActivePage]}
          width="100%"
          height={320}
          className="!rounded-lg !border-sky-100 !shadow-inner"
        />
        <p className="mt-2 text-center text-[11px] text-muted-foreground">
          計算用紙はこの端末に一時保存された内容です。
        </p>
      </div>
    </details>
  );
}
