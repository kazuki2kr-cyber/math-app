/**
 * kanjiOcr.ts
 * クライアント側のOCRペイロード生成ロジック。
 * 漢字通常演習と漢字対戦の両方から使用する共有モジュール。
 */

export interface OcrSlotLayout {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OcrQuestionLayout {
  questionId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  expectedCharCount: number;
  slots: OcrSlotLayout[];
}

export interface SynthesizedImageResult {
  composedImageBase64: string;
  layout: OcrQuestionLayout[];
}

export function getExpectedCharCount(answer?: string): number {
  const normalized = (answer || '').normalize('NFKC').replace(/\s+/g, '');
  return Math.max(1, Array.from(normalized).length || 1);
}

function getOcrGridSize(questionCount: number): { columns: number; rows: number } {
  if (questionCount <= 1) {
    return { columns: 1, rows: Math.max(1, questionCount) };
  }

  const columns = 2;
  const rows = questionCount <= 10 ? 5 : Math.ceil(questionCount / columns);
  return { columns, rows };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * 複数問の手書き画像を一枚に合成し、各問のレイアウト情報を返す。
 *
 * @param questions - 問題リスト。answer または expectedCharCount のいずれかでスロット数を決定する。
 * @param answers   - questionId -> dataURL のマップ。未解答の問題はレイアウトのみ生成（OCRは無回答扱い）。
 */
export async function buildOcrPayload(
  questions: Array<{ id: string; answer?: string; expectedCharCount?: number }>,
  answers: Record<string, string>
): Promise<SynthesizedImageResult> {
  const { columns, rows } = getOcrGridSize(questions.length);
  const cellWidth = 640;
  const cellHeight = 320;
  const gridGapX = 48;
  const gridGapY = 56;
  const pagePadding = 40;
  const slotGap = 36;
  const slotHeight = 220;
  const slotPaddingX = 44;
  const slotPaddingY = 50;

  const canvas = document.createElement('canvas');
  canvas.width = pagePadding * 2 + columns * cellWidth + Math.max(0, columns - 1) * gridGapX;
  canvas.height = pagePadding * 2 + rows * cellHeight + Math.max(0, rows - 1) * gridGapY;
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    return { composedImageBase64: '', layout: [] };
  }

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;

  const loadImage = (src: string): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load handwriting image'));
      img.src = src;
    });
  };

  const getInkBounds = (img: HTMLImageElement) => {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = img.width;
    tempCanvas.height = img.height;
    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) {
      return { x: 0, y: 0, width: img.width, height: img.height };
    }

    tempCtx.drawImage(img, 0, 0);
    const imageData = tempCtx.getImageData(0, 0, img.width, img.height);
    const { data, width, height } = imageData;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const alpha = data[idx + 3];
        const isInk = alpha > 0 && (data[idx] < 245 || data[idx + 1] < 245 || data[idx + 2] < 245);
        if (!isInk) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }

    if (maxX < 0 || maxY < 0) {
      return { x: 0, y: 0, width: img.width, height: img.height };
    }

    const pad = 12;
    return {
      x: clamp(minX - pad, 0, width - 1),
      y: clamp(minY - pad, 0, height - 1),
      width: clamp(maxX - minX + 1 + pad * 2, 1, width),
      height: clamp(maxY - minY + 1 + pad * 2, 1, height),
    };
  };

  const layout: OcrQuestionLayout[] = [];

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const dataURL = answers[q.id];

    const gridColumn = i % columns;
    const gridRow = Math.floor(i / columns);
    const cellX = pagePadding + gridColumn * (cellWidth + gridGapX);
    const cellY = pagePadding + gridRow * (cellHeight + gridGapY);
    const expectedCharCount = q.expectedCharCount ?? getExpectedCharCount(q.answer);
    const slotCount = Math.max(1, expectedCharCount);
    const slotAreaWidth = cellWidth - slotPaddingX * 2;
    const slotWidth = slotCount === 1
      ? Math.min(260, slotAreaWidth)
      : (slotAreaWidth - slotGap * (slotCount - 1)) / slotCount;
    const slotStartX = cellX + (cellWidth - (slotWidth * slotCount + slotGap * (slotCount - 1))) / 2;
    const slotY = cellY + slotPaddingY;
    const slots: OcrSlotLayout[] = [];

    for (let slotIndex = 0; slotIndex < slotCount; slotIndex++) {
      const slotX = slotStartX + slotIndex * (slotWidth + slotGap);
      slots.push({
        index: slotIndex,
        x: slotX / canvas.width,
        y: slotY / canvas.height,
        width: slotWidth / canvas.width,
        height: slotHeight / canvas.height,
      });
    }

    layout.push({
      questionId: q.id,
      x: cellX / canvas.width,
      y: cellY / canvas.height,
      width: cellWidth / canvas.width,
      height: cellHeight / canvas.height,
      expectedCharCount,
      slots,
    });

    // 回答がない問題はレイアウトのみ登録し、描画はスキップ（OCR は無回答と判定される）
    if (!dataURL) continue;

    const img = await loadImage(dataURL);
    const inkBounds = getInkBounds(img);
    const inkWidth = Math.max(1, inkBounds.width);
    const inkHeight = Math.max(1, inkBounds.height);
    const answerAreaX = slotStartX;
    const answerAreaY = slotY;
    const answerAreaWidth = slotWidth * slotCount + slotGap * (slotCount - 1);
    const answerAreaHeight = slotHeight;
    const scale = Math.min(answerAreaWidth / inkWidth, answerAreaHeight / inkHeight) * 0.9;
    const drawWidth = inkWidth * scale;
    const drawHeight = inkHeight * scale;
    const drawX = answerAreaX + (answerAreaWidth - drawWidth) / 2;
    const centeredDrawY = answerAreaY + (answerAreaHeight - drawHeight) / 2;
    const upwardBias = Math.min(answerAreaHeight * 0.08, 16);
    const drawY = Math.max(answerAreaY, centeredDrawY - upwardBias);

    ctx.drawImage(
      img,
      inkBounds.x,
      inkBounds.y,
      inkWidth,
      inkHeight,
      drawX,
      drawY,
      drawWidth,
      drawHeight
    );
  }

  return {
    composedImageBase64: canvas.toDataURL('image/png'),
    layout,
  };
}
