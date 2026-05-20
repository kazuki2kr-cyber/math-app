'use client';

import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Eraser, PenLine, RotateCcw, Trash2, X } from 'lucide-react';
import { HandwritingCanvas, HandwritingCanvasRef } from '@/components/HandwritingCanvas';
import { MathDisplay } from '@/components/MathDisplay';
import { Button } from '@/components/ui/button';

const STROKE_WIDTH_STORAGE_KEY = 'formix:scratch-paper-stroke-width';
const STROKE_WIDTH_OPTIONS = [
  { id: 'standard', label: '標準', width: 4 },
  { id: 'thin', label: '細い', width: 2.5 },
  { id: 'extraThin', label: 'かなり細い', width: 1.5 },
] as const;
const ERASER_SIZE_OPTIONS = [
  { id: 'small', label: '小', width: 18 },
  { id: 'medium', label: '中', width: 28 },
  { id: 'large', label: '大', width: 42 },
] as const;

type StrokeWidthId = (typeof STROKE_WIDTH_OPTIONS)[number]['id'];
type EraserSizeId = (typeof ERASER_SIZE_OPTIONS)[number]['id'];
type ScratchTool = 'pen' | 'eraser';

function isStrokeWidthId(value: string | null): value is StrokeWidthId {
  return STROKE_WIDTH_OPTIONS.some((option) => option.id === value);
}

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
    const [activeTool, setActiveTool] = useState<ScratchTool>('pen');
    const [eraserSizeId, setEraserSizeId] = useState<EraserSizeId>('medium');
    const [strokeWidthId, setStrokeWidthId] = useState<StrokeWidthId>(() => {
      if (typeof window === 'undefined') return 'standard';

      const savedStrokeWidth = window.localStorage.getItem(STROKE_WIDTH_STORAGE_KEY);
      return isStrokeWidthId(savedStrokeWidth) ? savedStrokeWidth : 'standard';
    });
    const canvasRef = useRef<HandwritingCanvasRef>(null);
    const selectedStrokeWidth = STROKE_WIDTH_OPTIONS.find((option) => option.id === strokeWidthId)?.width ?? 4;
    const selectedEraserWidth = ERASER_SIZE_OPTIONS.find((option) => option.id === eraserSizeId)?.width ?? 28;

    const handleChange = (nextHasStrokes: boolean) => {
      setHasStrokes(nextHasStrokes);
      onChange?.(nextHasStrokes);
    };

    useImperativeHandle(ref, () => ({
      undo: () => canvasRef.current?.undo(),
      clear: () => {
        canvasRef.current?.clear();
        handleChange(false);
        setActiveTool('pen');
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

    useEffect(() => {
      window.localStorage.setItem(STROKE_WIDTH_STORAGE_KEY, strokeWidthId);
    }, [strokeWidthId]);

    useEffect(() => {
      if (!hasStrokes && activeTool === 'eraser') {
        setActiveTool('pen');
      }
    }, [activeTool, hasStrokes]);

    const handleClear = () => {
      canvasRef.current?.clear();
      handleChange(false);
      setActiveTool('pen');
    };

    return (
      <section
        aria-hidden={!open}
        className={`fixed inset-0 z-[80] bg-white transition-opacity duration-200 ${
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="flex h-full flex-col bg-[#fbfbf7]">
          <div className="flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-gray-200 bg-white/95 px-3 py-2 shadow-sm backdrop-blur md:px-5">
            <div>
              <p className="text-sm font-bold text-gray-900">計算用紙</p>
              <p className="text-xs text-gray-500">次の問題へ進むと消えます</p>
            </div>

            <div className="flex max-w-full flex-wrap items-center justify-end gap-2">
              <div
                className="flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1"
                aria-label="ペンの太さ"
              >
                {STROKE_WIDTH_OPTIONS.map((option) => {
                  const isSelected = strokeWidthId === option.id;

                  return (
                    <button
                      key={option.id}
                      type="button"
                      tabIndex={open ? 0 : -1}
                      aria-label={`ペンの太さ: ${option.label}`}
                      aria-pressed={isSelected}
                      onClick={() => setStrokeWidthId(option.id)}
                      className={`h-8 rounded-md px-2 text-xs font-bold transition-colors ${
                        isSelected
                          ? 'bg-primary text-white shadow-sm'
                          : 'text-gray-600 hover:bg-white hover:text-gray-950'
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
              <div
                className="flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1"
                aria-label="計算用紙の道具"
              >
                <button
                  type="button"
                  tabIndex={open ? 0 : -1}
                  aria-label="ペンで書く"
                  aria-pressed={activeTool === 'pen'}
                  onClick={() => setActiveTool('pen')}
                  className={`flex h-8 w-9 items-center justify-center rounded-md transition-colors ${
                    activeTool === 'pen'
                      ? 'bg-primary text-white shadow-sm'
                      : 'text-gray-600 hover:bg-white hover:text-gray-950'
                  }`}
                >
                  <PenLine className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  tabIndex={open ? 0 : -1}
                  disabled={!hasStrokes}
                  aria-label="消しゴムで消す"
                  aria-pressed={activeTool === 'eraser'}
                  onClick={() => setActiveTool('eraser')}
                  className={`flex h-8 w-9 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                    activeTool === 'eraser'
                      ? 'bg-primary text-white shadow-sm'
                      : 'text-gray-600 hover:bg-white hover:text-gray-950'
                  }`}
                >
                  <Eraser className="h-4 w-4" />
                </button>
              </div>
              <div
                className="flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1"
                aria-label="消しゴムのサイズ"
              >
                {ERASER_SIZE_OPTIONS.map((option) => {
                  const isSelected = eraserSizeId === option.id;

                  return (
                    <button
                      key={option.id}
                      type="button"
                      tabIndex={open ? 0 : -1}
                      disabled={!hasStrokes}
                      aria-label={`消しゴムのサイズ: ${option.label}`}
                      aria-pressed={isSelected}
                      onClick={() => {
                        setEraserSizeId(option.id);
                        setActiveTool('eraser');
                      }}
                      className={`h-8 min-w-8 rounded-md px-2 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                        isSelected
                          ? 'bg-primary text-white shadow-sm'
                          : 'text-gray-600 hover:bg-white hover:text-gray-950'
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                tabIndex={open ? 0 : -1}
                disabled={!hasStrokes}
                aria-label="計算用紙を戻す"
                onClick={() => {
                  canvasRef.current?.undo();
                  if (canvasRef.current && !canvasRef.current.hasStrokes()) {
                    setActiveTool('pen');
                  }
                }}
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
                aria-label="計算用紙を全部消す"
                onClick={handleClear}
                className="h-10 px-3"
              >
                <Trash2 className="h-4 w-4 md:mr-2" />
                <span className="hidden md:inline">全部消す</span>
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
              strokeWidth={selectedStrokeWidth}
              strokeColor="#111827"
              tool={activeTool}
              eraserWidth={selectedEraserWidth}
              className="h-full w-full !rounded-none !border-gray-200 !shadow-none"
            />
          </div>
        </div>
      </section>
    );
  }
);

ScratchPaperOverlay.displayName = 'ScratchPaperOverlay';
