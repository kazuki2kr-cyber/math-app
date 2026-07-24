'use client';

import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';

export interface HandwritingPoint {
  /** Canvas幅・高さに対する0〜1の正規化座標。 */
  x: number;
  y: number;
}

export interface HandwritingStroke {
  points: HandwritingPoint[];
  color: string;
  width: number;
  tool?: 'pen' | 'eraser';
}

interface PreviewPoint {
  x: number;
  y: number;
}

export interface HandwritingCanvasRef {
  undo: () => void;
  clear: () => void;
  toDataURL: () => string | null;
  hasStrokes: () => boolean;
  getStrokes: () => HandwritingStroke[];
  setStrokes: (strokes: HandwritingStroke[]) => void;
}

interface HandwritingCanvasProps {
  width?: number | string;
  height?: number | string;
  strokeColor?: string;
  strokeWidth?: number;
  tool?: 'pen' | 'eraser';
  eraserWidth?: number;
  className?: string;
  onChange?: (hasStrokes: boolean) => void;
  initialStrokes?: HandwritingStroke[];
  onStrokesChange?: (strokes: HandwritingStroke[]) => void;
  readOnly?: boolean;
}

export const HandwritingCanvas = forwardRef<HandwritingCanvasRef, HandwritingCanvasProps>(
  ({
    width = '100%',
    height = 300,
    strokeColor = '#000000',
    strokeWidth = 5,
    tool = 'pen',
    eraserWidth = 24,
    className = '',
    onChange,
    initialStrokes = [],
    onStrokesChange,
    readOnly = false,
  }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [strokes, setStrokes] = useState<HandwritingStroke[]>(() => initialStrokes);
    const [currentStroke, setCurrentStroke] = useState<HandwritingStroke | null>(null);
    const [eraserPreviewPoint, setEraserPreviewPoint] = useState<PreviewPoint | null>(null);
    const strokesRef = useRef(strokes);
    const currentStrokeRef = useRef(currentStroke);
    const onChangeRef = useRef(onChange);
    const onStrokesChangeRef = useRef(onStrokesChange);

    const redrawCanvas = () => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !container || !ctx) return;

      const rect = container.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const dpr = window.devicePixelRatio || 1;
      const pixelWidth = Math.max(1, Math.round(rect.width * dpr));
      const pixelHeight = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, rect.width, rect.height);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      const activeStroke = currentStrokeRef.current;
      const allStrokes = activeStroke
        ? [...strokesRef.current, activeStroke]
        : strokesRef.current;

      allStrokes.forEach((stroke) => {
        if (stroke.points.length === 0) return;

        ctx.beginPath();
        ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.width;
        ctx.moveTo(stroke.points[0].x * rect.width, stroke.points[0].y * rect.height);
        for (let index = 1; index < stroke.points.length; index += 1) {
          ctx.lineTo(stroke.points[index].x * rect.width, stroke.points[index].y * rect.height);
        }
        ctx.stroke();
      });
      ctx.globalCompositeOperation = 'source-over';
    };

    useEffect(() => {
      onChangeRef.current = onChange;
      onStrokesChangeRef.current = onStrokesChange;
    }, [onChange, onStrokesChange]);

    useEffect(() => {
      onChangeRef.current?.(strokes.length > 0 || currentStroke !== null);
    }, [currentStroke, strokes.length]);

    useEffect(() => {
      onStrokesChangeRef.current?.(strokes);
    }, [strokes]);

    useEffect(() => {
      strokesRef.current = strokes;
      currentStrokeRef.current = currentStroke;
      redrawCanvas();
    }, [strokes, currentStroke]);

    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const resizeObserver = new ResizeObserver(() => redrawCanvas());
      resizeObserver.observe(container);
      redrawCanvas();
      return () => resizeObserver.disconnect();
      // redrawCanvasは常にrefの最新値を読むため、購読はマウント時だけでよい。
    }, []);

    const getPointerPosition = (
      event: React.PointerEvent<HTMLCanvasElement>,
    ): HandwritingPoint => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      return {
        x: Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width))),
        y: Math.min(1, Math.max(0, (event.clientY - rect.top) / Math.max(1, rect.height))),
      };
    };

    const getPreviewPosition = (
      event: React.PointerEvent<HTMLCanvasElement>,
    ): PreviewPoint => {
      const rect = event.currentTarget.getBoundingClientRect();
      return {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
    };

    const startDrawing = (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (readOnly || (event.button !== 0 && event.pointerType === 'mouse')) return;

      setIsDrawing(true);
      setCurrentStroke({
        points: [getPointerPosition(event)],
        color: tool === 'eraser' ? '#000000' : strokeColor,
        width: tool === 'eraser' ? eraserWidth : strokeWidth,
        tool,
      });
      canvasRef.current?.setPointerCapture(event.pointerId);
    };

    const draw = (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (readOnly || !isDrawing || !currentStroke) return;

      const position = getPointerPosition(event);
      if (tool === 'eraser') setEraserPreviewPoint(getPreviewPosition(event));
      setCurrentStroke((previous) => (
        previous ? { ...previous, points: [...previous.points, position] } : previous
      ));
    };

    const stopDrawing = (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (readOnly || !isDrawing || !currentStroke) return;

      setStrokes((previous) => [...previous, currentStroke]);
      setCurrentStroke(null);
      setIsDrawing(false);
      if (canvasRef.current?.hasPointerCapture(event.pointerId)) {
        canvasRef.current.releasePointerCapture(event.pointerId);
      }
    };

    useImperativeHandle(ref, () => ({
      undo: () => setStrokes((previous) => previous.slice(0, -1)),
      clear: () => {
        setStrokes([]);
        setCurrentStroke(null);
      },
      hasStrokes: () => strokes.length > 0 || currentStroke !== null,
      toDataURL: () => canvasRef.current?.toDataURL('image/png') ?? null,
      getStrokes: () => strokes,
      setStrokes: (nextStrokes) => {
        setCurrentStroke(null);
        setStrokes(nextStrokes);
      },
    }), [currentStroke, strokes]);

    const previewStyle = eraserPreviewPoint
      ? {
          left: eraserPreviewPoint.x - eraserWidth / 2,
          top: eraserPreviewPoint.y - eraserWidth / 2,
        }
      : null;

    return (
      <div
        ref={containerRef}
        style={{ width, height, position: 'relative' }}
        className={`bg-white border rounded-xl overflow-hidden shadow-sm ${readOnly ? '' : 'touch-none'} ${className}`}
      >
        <canvas
          ref={canvasRef}
          aria-label={readOnly ? '保存された計算用紙' : '手書き入力欄'}
          style={{
            width: '100%',
            height: '100%',
            display: 'block',
            touchAction: readOnly ? 'auto' : 'none',
            cursor: readOnly ? 'default' : tool === 'eraser' ? 'cell' : 'crosshair',
          }}
          onPointerDown={readOnly ? undefined : startDrawing}
          onPointerMove={readOnly ? undefined : (event) => {
            if (tool === 'eraser') setEraserPreviewPoint(getPreviewPosition(event));
            draw(event);
          }}
          onPointerUp={readOnly ? undefined : stopDrawing}
          onPointerCancel={readOnly ? undefined : stopDrawing}
          onPointerEnter={readOnly ? undefined : (event) => {
            if (tool === 'eraser') setEraserPreviewPoint(getPreviewPosition(event));
          }}
          onPointerLeave={readOnly ? undefined : () => setEraserPreviewPoint(null)}
        />
        {!readOnly && tool === 'eraser' && previewStyle && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute rounded-full border-2 border-primary/80 bg-primary/10 shadow-[0_0_0_1px_rgba(255,255,255,0.9)]"
            style={{
              width: eraserWidth,
              height: eraserWidth,
              ...previewStyle,
            }}
          />
        )}
      </div>
    );
  },
);

HandwritingCanvas.displayName = 'HandwritingCanvas';
