'use client';

import React, { useRef, useState, useImperativeHandle, forwardRef, useEffect } from 'react';

export interface HandwritingCanvasRef {
  undo: () => void;
  clear: () => void;
  toDataURL: () => string | null;
  hasStrokes: () => boolean;
}

interface Point {
  x: number;
  y: number;
}

interface Stroke {
  points: Point[];
  color: string;
  width: number;
}

interface HandwritingCanvasProps {
  width?: number | string;
  height?: number | string;
  strokeColor?: string;
  strokeWidth?: number;
  className?: string;
  onChange?: (hasStrokes: boolean) => void;
}

export const HandwritingCanvas = forwardRef<HandwritingCanvasRef, HandwritingCanvasProps>(
  ({ width = '100%', height = 300, strokeColor = '#000000', strokeWidth = 5, className = '', onChange }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [strokes, setStrokes] = useState<Stroke[]>([]);
    const [currentStroke, setCurrentStroke] = useState<Stroke | null>(null);

    // 描画系の状態を最新に保つためにコールバックで通知
    useEffect(() => {
      if (onChange) {
        onChange(strokes.length > 0 || currentStroke !== null);
      }
    }, [strokes, currentStroke, onChange]);

    // リサイズ対応と初期化
    useEffect(() => {
      const resizeCanvas = () => {
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) return;

        // Containerの実際のサイズに合わせてCanvasの内部解像度を設定
        // Retinaディスプレイ等に対応するためdevicePixelRatioを考慮
        const rect = container.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.scale(dpr, dpr);
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
        }
        
        redrawCanvas();
      };

      window.addEventListener('resize', resizeCanvas);
      resizeCanvas(); // マウント時に一度実行

      return () => {
        window.removeEventListener('resize', resizeCanvas);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [strokes, currentStroke]); // strokesが変わるたびに再描画の必要があるため依存配列に含める

    const redrawCanvas = () => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;

      // 画面のクリアパラメータはdevicePixelRatioに依存しない表示上のサイズ
      const rect = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, rect.width, rect.height);
      
      // 背景を白く塗りつぶす（これがないと透過書き出しになる場合がある）
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, rect.width, rect.height);

      const allStrokes = currentStroke ? [...strokes, currentStroke] : strokes;

      allStrokes.forEach(stroke => {
        if (stroke.points.length === 0) return;
        
        ctx.beginPath();
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.width;
        
        ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
        for (let i = 1; i < stroke.points.length; i++) {
          ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
        }
        ctx.stroke();
      });
    };

    const getMousePos = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      };
    };

    const startDrawing = (e: React.PointerEvent<HTMLCanvasElement>) => {
      // 左クリック、またはタッチ/ペンのみ反応
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      
      const pos = getMousePos(e);
      setIsDrawing(true);
      setCurrentStroke({ points: [pos], color: strokeColor, width: strokeWidth });
      
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.setPointerCapture(e.pointerId);
      }
    };

    const draw = (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!isDrawing || !currentStroke) return;
      
      const pos = getMousePos(e);
      setCurrentStroke(prev => {
        if (!prev) return prev;
        return { ...prev, points: [...prev.points, pos] };
      });
    };

    const stopDrawing = (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!isDrawing || !currentStroke) return;
      
      setStrokes(prev => [...prev, currentStroke]);
      setCurrentStroke(null);
      setIsDrawing(false);
      
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.releasePointerCapture(e.pointerId);
      }
    };

    // 親コンポーネントから叩けるAPIを定義
    useImperativeHandle(ref, () => ({
      undo: () => {
        setStrokes(prev => prev.slice(0, -1));
      },
      clear: () => {
        setStrokes([]);
        setCurrentStroke(null);
      },
      hasStrokes: () => strokes.length > 0 || currentStroke !== null,
      toDataURL: () => {
        const canvas = canvasRef.current;
        if (!canvas) return null;
        // image/jpeg で出力してデータサイズを抑える
        return canvas.toDataURL('image/png');
      }
    }));

    return (
      <div 
        ref={containerRef} 
        style={{ width, height, position: 'relative' }} 
        className={`bg-white border rounded-xl overflow-hidden shadow-sm touch-none ${className}`}
      >
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none' }}
          onPointerDown={startDrawing}
          onPointerMove={draw}
          onPointerUp={stopDrawing}
          onPointerCancel={stopDrawing}
        />
      </div>
    );
  }
);

HandwritingCanvas.displayName = 'HandwritingCanvas';
