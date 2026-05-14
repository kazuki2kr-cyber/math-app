'use client';

import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Eraser, RotateCcw, X } from 'lucide-react';
import { HandwritingCanvas, HandwritingCanvasRef } from '@/components/HandwritingCanvas';
import { MathDisplay } from '@/components/MathDisplay';
import { Button } from '@/components/ui/button';

interface ScratchPaperOverlayProps {
  open: boolean;
  questionText: string;
  questionNumber: number;
  totalQuestions: number;
  onClose: () => void;
  onChange?: (hasStrokes: boolean) => void;
}

export const ScratchPaperOverlay = forwardRef<HandwritingCanvasRef, ScratchPaperOverlayProps>(
  ({ open, questionText, questionNumber, totalQuestions, onClose, onChange }, ref) => {
    const [hasStrokes, setHasStrokes] = useState(false);
    const canvasRef = useRef<HandwritingCanvasRef>(null);

    const handleChange = (nextHasStrokes: boolean) => {
      setHasStrokes(nextHasStrokes);
      onChange?.(nextHasStrokes);
    };

    useImperativeHandle(ref, () => ({
      undo: () => canvasRef.current?.undo(),
      clear: () => {
        canvasRef.current?.clear();
        handleChange(false);
      },
      hasStrokes: () => canvasRef.current?.hasStrokes() ?? false,
      toDataURL: () => null,
    }));

    useEffect(() => {
      if (!open) return;

      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          onClose();
        }
      };

      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', handleKeyDown);

      return () => {
        document.body.style.overflow = '';
        window.removeEventListener('keydown', handleKeyDown);
      };
    }, [open, onClose]);

    const handleClear = () => {
      canvasRef.current?.clear();
      handleChange(false);
    };

    return (
      <section
        aria-hidden={!open}
        className={`fixed inset-0 z-[80] bg-white transition-opacity duration-200 ${
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="flex h-full flex-col bg-[#fbfbf7]">
          <div className="flex h-16 shrink-0 items-center justify-between border-b border-gray-200 bg-white/95 px-3 shadow-sm backdrop-blur md:px-5">
            <div>
              <p className="text-sm font-bold text-gray-900">計算用紙</p>
              <p className="text-xs text-gray-500">次の問題へ進むと消えます</p>
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                tabIndex={open ? 0 : -1}
                disabled={!hasStrokes}
                aria-label="計算用紙を戻す"
                onClick={() => canvasRef.current?.undo()}
                className="h-10 px-3"
              >
                <RotateCcw className="h-4 w-4 md:mr-2" />
                <span className="hidden md:inline">戻す</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                tabIndex={open ? 0 : -1}
                disabled={!hasStrokes}
                aria-label="計算用紙を消す"
                onClick={handleClear}
                className="h-10 px-3"
              >
                <Eraser className="h-4 w-4 md:mr-2" />
                <span className="hidden md:inline">消す</span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                tabIndex={open ? 0 : -1}
                onClick={onClose}
                aria-label="計算用紙を閉じる"
                className="h-10 w-10 text-gray-600 hover:text-gray-950"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
          </div>

          <div className="shrink-0 border-b border-gray-200 bg-white px-3 py-2 md:px-5">
            <div className="flex min-h-10 items-center gap-3 overflow-x-auto">
              <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-bold text-primary">
                Q{questionNumber}/{totalQuestions}
              </span>
              <div className="min-w-0 flex-1 text-sm leading-snug text-gray-950 [&_.katex-display]:my-0 [&_.katex]:text-[1em]">
                <MathDisplay math={questionText} />
              </div>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 p-2 md:p-4">
            <HandwritingCanvas
              ref={canvasRef}
              width="100%"
              height="100%"
              onChange={handleChange}
              strokeWidth={4}
              strokeColor="#111827"
              className="h-full w-full !rounded-none !border-gray-200 !shadow-none"
            />
          </div>
        </div>
      </section>
    );
  }
);

ScratchPaperOverlay.displayName = 'ScratchPaperOverlay';
