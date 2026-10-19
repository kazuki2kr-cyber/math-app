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

export type HandwritingTool = 'pen' | 'eraser' | 'strokeEraser';

export interface HandwritingHistoryState {
  canUndo: boolean;
  canRedo: boolean;
}

interface PreviewPoint {
  x: number;
  y: number;
}

const PAPER_COLOR = '#FFFFFF';
const MAX_HISTORY_STEPS = 50;
const STROKE_ERASER_HIT_RADIUS = 14;

export interface HandwritingCanvasRef {
  undo: () => void;
  redo: () => void;
  clear: () => void;
  clearWithHistory: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
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
  tool?: HandwritingTool;
  eraserWidth?: number;
  className?: string;
  onChange?: (hasStrokes: boolean) => void;
  initialStrokes?: HandwritingStroke[];
  onStrokesChange?: (strokes: HandwritingStroke[]) => void;
  onHistoryChange?: (state: HandwritingHistoryState) => void;
  readOnly?: boolean;
}

function distanceToSegment(
  point: PreviewPoint,
  start: PreviewPoint,
  end: PreviewPoint,
) {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const squaredLength = deltaX * deltaX + deltaY * deltaY;
  if (squaredLength === 0) return Math.hypot(point.x - start.x, point.y - start.y);

  const projection = Math.min(1, Math.max(0, (
    (point.x - start.x) * deltaX + (point.y - start.y) * deltaY
  ) / squaredLength));
  const nearestX = start.x + projection * deltaX;
  const nearestY = start.y + projection * deltaY;
  return Math.hypot(point.x - nearestX, point.y - nearestY);
}

function findTopmostStrokeIndex(
  strokes: HandwritingStroke[],
  point: PreviewPoint,
  width: number,
  height: number,
) {
  for (let strokeIndex = strokes.length - 1; strokeIndex >= 0; strokeIndex -= 1) {
    const stroke = strokes[strokeIndex];
    if (stroke.tool === 'eraser' || stroke.points.length === 0) continue;

    const hitRadius = Math.max(STROKE_ERASER_HIT_RADIUS, stroke.width / 2 + 8);
    const scaledPoints = stroke.points.map((strokePoint) => ({
      x: strokePoint.x * width,
      y: strokePoint.y * height,
    }));
    if (scaledPoints.length === 1) {
      if (Math.hypot(point.x - scaledPoints[0].x, point.y - scaledPoints[0].y) <= hitRadius) {
        return strokeIndex;
      }
      continue;
    }

    for (let pointIndex = 1; pointIndex < scaledPoints.length; pointIndex += 1) {
      if (distanceToSegment(point, scaledPoints[pointIndex - 1], scaledPoints[pointIndex]) <= hitRadius) {
        return strokeIndex;
      }
    }
  }
  return -1;
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
    onHistoryChange,
    readOnly = false,
  }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [strokes, setStrokes] = useState<HandwritingStroke[]>(() => initialStrokes);
    const [currentStroke, setCurrentStroke] = useState<HandwritingStroke | null>(null);
    const [eraserPreviewPoint, setEraserPreviewPoint] = useState<PreviewPoint | null>(null);
    const [historyRevision, setHistoryRevision] = useState(0);
    const strokesRef = useRef(strokes);
    const currentStrokeRef = useRef(currentStroke);
    const isDrawingRef = useRef(false);
    const undoStackRef = useRef<HandwritingStroke[][]>([]);
    const redoStackRef = useRef<HandwritingStroke[][]>([]);
    const strokeEraseStartRef = useRef<HandwritingStroke[] | null>(null);
    const strokeEraseChangedRef = useRef(false);
    const onChangeRef = useRef(onChange);
    const onStrokesChangeRef = useRef(onStrokesChange);
    const onHistoryChangeRef = useRef(onHistoryChange);

    const applyStrokes = (nextStrokes: HandwritingStroke[]) => {
      strokesRef.current = nextStrokes;
      setStrokes(nextStrokes);
    };

    const notifyHistoryChanged = () => setHistoryRevision((revision) => revision + 1);

    const recordUndoSnapshot = (snapshot: HandwritingStroke[]) => {
      undoStackRef.current = [...undoStackRef.current, snapshot].slice(-MAX_HISTORY_STEPS);
      redoStackRef.current = [];
      notifyHistoryChanged();
    };

    const resetHistory = () => {
      undoStackRef.current = [];
      redoStackRef.current = [];
      notifyHistoryChanged();
    };

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
      ctx.fillStyle = PAPER_COLOR;
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
        // 消しゴムで透明化すると、ダークテーマの親背景が透けて黒く見える。
        // 計算用紙は常に白い紙面として書き出すため、白で上書きする。
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = stroke.tool === 'eraser' ? PAPER_COLOR : stroke.color;
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
      onHistoryChangeRef.current = onHistoryChange;
    }, [onChange, onHistoryChange, onStrokesChange]);

    useEffect(() => {
      onChangeRef.current?.(strokes.length > 0 || currentStroke !== null);
    }, [currentStroke, strokes.length]);

    useEffect(() => {
      onStrokesChangeRef.current?.(strokes);
    }, [strokes]);

    useEffect(() => {
      onHistoryChangeRef.current?.({
        canUndo: undoStackRef.current.length > 0 || strokes.length > 0,
        canRedo: redoStackRef.current.length > 0,
      });
    }, [historyRevision, strokes.length]);

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

      isDrawingRef.current = true;
      if (tool === 'strokeEraser') {
        setEraserPreviewPoint(getPreviewPosition(event));
        strokeEraseStartRef.current = strokesRef.current;
        strokeEraseChangedRef.current = false;
        const rect = event.currentTarget.getBoundingClientRect();
        const strokeIndex = findTopmostStrokeIndex(
          strokesRef.current,
          getPreviewPosition(event),
          rect.width,
          rect.height,
        );
        if (strokeIndex >= 0) {
          applyStrokes(strokesRef.current.filter((_, index) => index !== strokeIndex));
          strokeEraseChangedRef.current = true;
        }
        canvasRef.current?.setPointerCapture(event.pointerId);
        return;
      }

      setCurrentStroke({
        points: [getPointerPosition(event)],
        color: tool === 'eraser' ? PAPER_COLOR : strokeColor,
        width: tool === 'eraser' ? eraserWidth : strokeWidth,
        tool,
      });
      currentStrokeRef.current = {
        points: [getPointerPosition(event)],
        color: tool === 'eraser' ? PAPER_COLOR : strokeColor,
        width: tool === 'eraser' ? eraserWidth : strokeWidth,
        tool,
      };
      canvasRef.current?.setPointerCapture(event.pointerId);
    };

    const draw = (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (readOnly || !isDrawingRef.current) return;

      if (tool === 'strokeEraser') {
        const previewPoint = getPreviewPosition(event);
        setEraserPreviewPoint(previewPoint);
        const rect = event.currentTarget.getBoundingClientRect();
        const strokeIndex = findTopmostStrokeIndex(
          strokesRef.current,
          previewPoint,
          rect.width,
          rect.height,
        );
        if (strokeIndex >= 0) {
          applyStrokes(strokesRef.current.filter((_, index) => index !== strokeIndex));
          strokeEraseChangedRef.current = true;
        }
        return;
      }

      if (!currentStroke) return;

      const position = getPointerPosition(event);
      if (tool === 'eraser') setEraserPreviewPoint(getPreviewPosition(event));
      setCurrentStroke((previous) => (
        previous ? { ...previous, points: [...previous.points, position] } : previous
      ));
    };

    const stopDrawing = (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (readOnly || !isDrawingRef.current) return;

      if (tool === 'strokeEraser') {
        if (strokeEraseChangedRef.current && strokeEraseStartRef.current) {
          recordUndoSnapshot(strokeEraseStartRef.current);
        }
        strokeEraseStartRef.current = null;
        strokeEraseChangedRef.current = false;
        isDrawingRef.current = false;
        if (canvasRef.current?.hasPointerCapture(event.pointerId)) {
          canvasRef.current.releasePointerCapture(event.pointerId);
        }
        return;
      }

      if (!currentStroke) return;

      const previousStrokes = strokesRef.current;
      recordUndoSnapshot(previousStrokes);
      applyStrokes([...previousStrokes, currentStroke]);
      setCurrentStroke(null);
      currentStrokeRef.current = null;
      isDrawingRef.current = false;
      if (canvasRef.current?.hasPointerCapture(event.pointerId)) {
        canvasRef.current.releasePointerCapture(event.pointerId);
      }
    };

    useImperativeHandle(ref, () => ({
      undo: () => {
        const currentStrokes = strokesRef.current;
        if (undoStackRef.current.length === 0 && currentStrokes.length === 0) return;
        const previousStrokes = undoStackRef.current.pop() ?? currentStrokes.slice(0, -1);
        redoStackRef.current = [...redoStackRef.current, currentStrokes].slice(-MAX_HISTORY_STEPS);
        applyStrokes(previousStrokes);
        notifyHistoryChanged();
      },
      redo: () => {
        const nextStrokes = redoStackRef.current.pop();
        if (!nextStrokes) return;
        undoStackRef.current = [...undoStackRef.current, strokesRef.current].slice(-MAX_HISTORY_STEPS);
        applyStrokes(nextStrokes);
        notifyHistoryChanged();
      },
      clear: () => {
        applyStrokes([]);
        setCurrentStroke(null);
        currentStrokeRef.current = null;
        resetHistory();
      },
      clearWithHistory: () => {
        if (strokesRef.current.length === 0) return;
        recordUndoSnapshot(strokesRef.current);
        applyStrokes([]);
        setCurrentStroke(null);
        currentStrokeRef.current = null;
      },
      canUndo: () => undoStackRef.current.length > 0 || strokesRef.current.length > 0,
      canRedo: () => redoStackRef.current.length > 0,
      hasStrokes: () => strokesRef.current.length > 0 || currentStrokeRef.current !== null,
      toDataURL: () => canvasRef.current?.toDataURL('image/png') ?? null,
      getStrokes: () => strokesRef.current,
      setStrokes: (nextStrokes) => {
        setCurrentStroke(null);
        currentStrokeRef.current = null;
        applyStrokes(nextStrokes);
        resetHistory();
      },
    }));

    const previewDiameter = tool === 'strokeEraser' ? 28 : eraserWidth;
    const previewStyle = eraserPreviewPoint
      ? {
          left: eraserPreviewPoint.x - previewDiameter / 2,
          top: eraserPreviewPoint.y - previewDiameter / 2,
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
            cursor: readOnly ? 'default' : tool === 'pen' ? 'crosshair' : 'cell',
          }}
          onPointerDown={readOnly ? undefined : startDrawing}
          onPointerMove={readOnly ? undefined : (event) => {
            if (tool !== 'pen') setEraserPreviewPoint(getPreviewPosition(event));
            draw(event);
          }}
          onPointerUp={readOnly ? undefined : stopDrawing}
          onPointerCancel={readOnly ? undefined : stopDrawing}
          onPointerEnter={readOnly ? undefined : (event) => {
            if (tool !== 'pen') setEraserPreviewPoint(getPreviewPosition(event));
          }}
          onPointerLeave={readOnly ? undefined : () => setEraserPreviewPoint(null)}
        />
        {!readOnly && tool !== 'pen' && previewStyle && (
          <div
            aria-hidden="true"
            className={`pointer-events-none absolute rounded-full border-2 shadow-[0_0_0_1px_rgba(255,255,255,0.9)] ${
              tool === 'strokeEraser'
                ? 'border-fuchsia-700/80 bg-fuchsia-500/10'
                : 'border-primary/80 bg-primary/10'
            }`}
            style={{
              width: previewDiameter,
              height: previewDiameter,
              ...previewStyle,
            }}
          />
        )}
      </div>
    );
  },
);

HandwritingCanvas.displayName = 'HandwritingCanvas';
