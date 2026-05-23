/**
 * kanjiOcrCore.ts
 * サーバー側の漢字OCR処理ロジックを集約した共有モジュール。
 * recognizeKanjiBatch (通常演習) と submitKanjiBattleOcr (対戦) の両方から利用する。
 * ここの実装を変更した場合は必ず両方の挙動に影響することを意識すること。
 */

export interface RecognizedCharacter {
  text: string;
  x: number;
  y: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

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

export interface KanjiOcrQuestionResult {
  questionId: string;
  recognizedText: string;
  correctText: string;
  isCorrect: boolean;
}

const KANJI_CONFUSION_GROUPS = [
  ["一", "ー", "丨"],
  ["口", "日", "目"],
  ["土", "士"],
  ["木", "本", "未", "末"],
  ["人", "入"],
  ["大", "犬", "太"],
  ["傍", "防", "坊", "旁"],
  ["観", "視", "見"],
  ["俗", "浴", "谷"],
  ["絶", "紹"],
  ["叫", "叶"],
  ["業", "寒"],
  ["偉", "緯", "違"],
];

export function normalizeKanjiText(text: string): string {
  return (text || "").normalize("NFKC").replace(/\s+/g, "");
}

function isWithinBox(
  point: { x: number; y: number },
  box: { x: number; y: number; width: number; height: number },
  marginX = 0,
  marginY = 0
): boolean {
  return (
    point.x >= box.x - marginX &&
    point.x <= box.x + box.width + marginX &&
    point.y >= box.y - marginY &&
    point.y <= box.y + box.height + marginY
  );
}

function getOverlapRatio(
  char: Pick<RecognizedCharacter, "left" | "right" | "top" | "bottom">,
  box: { x: number; y: number; width: number; height: number }
): number {
  const overlapWidth = Math.max(0, Math.min(char.right, box.x + box.width) - Math.max(char.left, box.x));
  const overlapHeight = Math.max(0, Math.min(char.bottom, box.y + box.height) - Math.max(char.top, box.y));
  const overlapArea = overlapWidth * overlapHeight;
  const charArea = Math.max((char.right - char.left) * (char.bottom - char.top), 0.000001);
  return overlapArea / charArea;
}

function getCharMatchBonus(recognized: string, expected: string): number {
  if (!recognized || !expected) return 0;
  if (normalizeKanjiText(recognized) === normalizeKanjiText(expected)) {
    return 8;
  }
  for (const group of KANJI_CONFUSION_GROUPS) {
    if (group.includes(recognized) && group.includes(expected)) {
      return 3.5;
    }
  }
  return 0;
}

function distanceSquared(point: { x: number; y: number }, targetX: number, targetY: number): number {
  const dx = point.x - targetX;
  const dy = point.y - targetY;
  return dx * dx + dy * dy;
}

function distanceToBox(
  point: { x: number; y: number },
  box: { x: number; y: number; width: number; height: number }
): number {
  const dx = Math.max(box.x - point.x, 0, point.x - (box.x + box.width));
  const dy = Math.max(box.y - point.y, 0, point.y - (box.y + box.height));
  return Math.sqrt(dx * dx + dy * dy);
}

function scoreCharForSlot(
  char: RecognizedCharacter,
  slot: { x: number; y: number; width: number; height: number },
  expectedChar = ""
): number {
  const slotCenterX = slot.x + slot.width / 2;
  const slotCenterY = slot.y + slot.height / 2;
  const distance = Math.sqrt(distanceSquared(char, slotCenterX, slotCenterY));
  const normalizedDistance = distance / Math.max(Math.max(slot.width, slot.height), 0.000001);
  const overlapRatio = getOverlapRatio(char, slot);
  const withinSlot = isWithinBox(char, slot, slot.width * 0.18, slot.height * 0.15);
  const areaRatio = Math.min((char.width * char.height) / Math.max(slot.width * slot.height, 0.000001), 1);

  return (
    getCharMatchBonus(char.text, expectedChar) +
    overlapRatio * 3 +
    (withinSlot ? 1.5 : 0) +
    areaRatio * 0.6 -
    normalizedDistance * 1.8
  );
}

function scoreCharForQuestion(
  char: RecognizedCharacter,
  questionLayout: OcrQuestionLayout
): number {
  const questionCenterX = questionLayout.x + questionLayout.width / 2;
  const questionCenterY = questionLayout.y + questionLayout.height / 2;
  const distance = Math.sqrt(distanceSquared(char, questionCenterX, questionCenterY));
  const normalizedDistance = distance / Math.max(questionLayout.width, questionLayout.height, 0.000001);
  const overlapRatio = getOverlapRatio(char, questionLayout);
  const withinQuestion = isWithinBox(char, questionLayout, questionLayout.width * 0.01, questionLayout.height * 0.005);

  return overlapRatio * 4 + (withinQuestion ? 1 : 0) - normalizedDistance * 0.75;
}

function buildFallbackSlots(questionLayout: OcrQuestionLayout, charCount: number): OcrSlotLayout[] {
  const slotCount = Math.max(1, charCount);
  const slotWidth = questionLayout.width / slotCount;
  return Array.from({ length: slotCount }, (_, index) => ({
    index,
    x: questionLayout.x + slotWidth * index,
    y: questionLayout.y,
    width: slotWidth,
    height: questionLayout.height,
  }));
}

export function assignRecognizedCharactersToQuestions(
  recognizedCharacters: RecognizedCharacter[],
  layouts: OcrQuestionLayout[]
): Map<string, RecognizedCharacter[]> {
  const charsByQuestionId = new Map<string, RecognizedCharacter[]>();

  layouts.forEach((layout) => {
    charsByQuestionId.set(layout.questionId, []);
  });

  recognizedCharacters.forEach((char) => {
    const candidates = layouts
      .map((layout) => ({
        layout,
        score: scoreCharForQuestion(char, layout),
        overlapRatio: getOverlapRatio(char, layout),
        withinQuestion: isWithinBox(char, layout, layout.width * 0.01, layout.height * 0.005),
        nearQuestion: isWithinBox(char, layout, layout.width * 0.08, layout.height * 0.08),
        distanceToQuestion: distanceToBox(char, layout),
      }))
      .filter(({ overlapRatio, withinQuestion, nearQuestion }) => overlapRatio > 0 || withinQuestion || nearQuestion)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.distanceToQuestion - b.distanceToQuestion;
      });

    const bestCandidate = candidates[0];
    if (!bestCandidate) return;
    if (
      !bestCandidate.withinQuestion &&
      bestCandidate.overlapRatio < 0.08 &&
      bestCandidate.distanceToQuestion > Math.max(bestCandidate.layout.width, bestCandidate.layout.height) * 0.08
    ) {
      return;
    }

    charsByQuestionId.get(bestCandidate.layout.questionId)?.push(char);
  });

  return charsByQuestionId;
}

function buildRecognizedTextFromLayout(
  questionChars: RecognizedCharacter[],
  questionLayout: OcrQuestionLayout
): string {
  const sortedSlots = [...(questionLayout.slots || [])].sort((a, b) => a.index - b.index);
  if (sortedSlots.length <= 1) {
    if (questionChars.length === 0) return "";
    const centerX = questionLayout.x + questionLayout.width / 2;
    const centerY = questionLayout.y + questionLayout.height / 2;
    const bestChar = [...questionChars].sort(
      (a, b) => distanceSquared(a, centerX, centerY) - distanceSquared(b, centerX, centerY)
    )[0];
    return bestChar?.text || "";
  }

  const usedIndices = new Set<number>();

  return sortedSlots.map((slot) => {
    const slotCandidates = questionChars
      .map((char, index) => ({ char, index }))
      .filter(({ char, index }) => !usedIndices.has(index) && isWithinBox(char, slot, 0.015, 0.02));

    if (slotCandidates.length === 0) return "";

    const slotCenterX = slot.x + slot.width / 2;
    const slotCenterY = slot.y + slot.height / 2;
    const bestCandidate = slotCandidates.sort(
      (a, b) => distanceSquared(a.char, slotCenterX, slotCenterY) - distanceSquared(b.char, slotCenterX, slotCenterY)
    )[0];

    usedIndices.add(bestCandidate.index);
    return bestCandidate.char.text;
  }).join("");
}

export function buildCorrectedTextFromAnswer(
  questionChars: RecognizedCharacter[],
  questionLayout: OcrQuestionLayout,
  correctAnswer: string
): string {
  const normalizedAnswer = normalizeKanjiText(correctAnswer);
  if (!normalizedAnswer) {
    return buildRecognizedTextFromLayout(questionChars, questionLayout);
  }

  const answerChars = Array.from(normalizedAnswer);
  const slots = (questionLayout.slots && questionLayout.slots.length > 0)
    ? [...questionLayout.slots].sort((a, b) => a.index - b.index)
    : buildFallbackSlots(questionLayout, answerChars.length);

  const rawText = buildRecognizedTextFromLayout(questionChars, questionLayout);
  const rawNormalized = normalizeKanjiText(rawText);
  if (rawNormalized === normalizedAnswer) {
    return normalizedAnswer;
  }

  const usedIndices = new Set<number>();
  const correctedChars = answerChars.map((expectedChar, index) => {
    const slot = slots[Math.min(index, slots.length - 1)] || {
      x: questionLayout.x,
      y: questionLayout.y,
      width: questionLayout.width,
      height: questionLayout.height,
    };

    const candidates = questionChars
      .map((char, charIndex) => ({
        char,
        charIndex,
        score: scoreCharForSlot(char, slot, expectedChar),
      }))
      .filter(({ score }) => score > -1.25)
      .sort((a, b) => b.score - a.score);

    const exactCandidate = candidates.find(({ char, charIndex }) =>
      !usedIndices.has(charIndex) && normalizeKanjiText(char.text) === expectedChar
    );
    if (exactCandidate) {
      usedIndices.add(exactCandidate.charIndex);
      return exactCandidate.char.text;
    }

    const bestCandidate = candidates.find(({ charIndex }) => !usedIndices.has(charIndex));
    if (!bestCandidate) return "";

    const fallbackThreshold = getCharMatchBonus(bestCandidate.char.text, expectedChar) > 0 ? -3 : 2.1;
    if (bestCandidate.score < fallbackThreshold) return "";

    usedIndices.add(bestCandidate.charIndex);
    return bestCandidate.char.text;
  }).join("");

  const correctedNormalized = normalizeKanjiText(correctedChars);
  if (correctedNormalized === normalizedAnswer) return normalizedAnswer;

  const exactCoverage = answerChars.every((expectedChar) =>
    questionChars.some((char) => normalizeKanjiText(char.text) === expectedChar)
  );
  if (exactCoverage) return normalizedAnswer;

  return correctedChars || rawText;
}

/**
 * Vision API のレスポンスから認識文字リストを抽出する。
 * recognizeKanjiBatch と同一のフィルタリング・座標正規化ロジックを使用する。
 */
export function extractRecognizedCharacters(visionResult: any): RecognizedCharacter[] {
  const recognizedCharacters: RecognizedCharacter[] = [];
  const fullTextAnnotation = visionResult.fullTextAnnotation;
  const pages = fullTextAnnotation?.pages || [];
  const imgWidth = pages[0]?.width || 1;
  const imgHeight = pages[0]?.height || 1;

  for (const page of pages) {
    for (const block of page.blocks || []) {
      for (const paragraph of block.paragraphs || []) {
        for (const word of paragraph.words || []) {
          for (const symbol of word.symbols || []) {
            if (!symbol.text) continue;
            const char = symbol.text;
            if (!/[぀-ゟ゠-ヿ一-鿿]/.test(char)) continue;

            const vertices = symbol.boundingBox?.vertices || [];
            if (vertices.length > 0) {
              const xs = vertices.map((v: any) => v.x || 0);
              const ys = vertices.map((v: any) => v.y || 0);
              const minX = Math.min(...xs);
              const maxX = Math.max(...xs);
              const minY = Math.min(...ys);
              const maxY = Math.max(...ys);
              const avgX = xs.reduce((a: number, b: number) => a + b, 0) / xs.length;
              const avgY = ys.reduce((a: number, b: number) => a + b, 0) / ys.length;

              recognizedCharacters.push({
                text: char,
                x: avgX / imgWidth,
                y: avgY / imgHeight,
                left: minX / imgWidth,
                right: maxX / imgWidth,
                top: minY / imgHeight,
                bottom: maxY / imgHeight,
                width: Math.max((maxX - minX) / imgWidth, 0.000001),
                height: Math.max((maxY - minY) / imgHeight, 0.000001),
              });
            }
          }
        }
      }
    }
  }

  return recognizedCharacters;
}

/**
 * 認識文字と問題リスト・レイアウト情報から問題ごとの正誤を判定する。
 * recognizeKanjiBatch の採点ロジックと完全に同一の実装。
 */
export function processKanjiOcrResult(
  recognizedCharacters: RecognizedCharacter[],
  questions: Array<{ id: string; answer?: string; answer_index?: number | string; options?: unknown[] }>,
  layout: OcrQuestionLayout[]
): KanjiOcrQuestionResult[] {
  // グリッドフォールバック用定数（layout がない問題に使用）
  const COLUMNS = 1;
  const ROWS = questions.length;

  const layoutMap = new Map<string, OcrQuestionLayout>(
    layout.map((item) => [item.questionId, item])
  );
  const questionCharsMap = assignRecognizedCharactersToQuestions(
    recognizedCharacters,
    Array.from(layoutMap.values())
  );

  return questions.map((q, index) => {
    // 正解テキストの解決（recognizeKanjiBatch と同一ロジック）
    let resolvedCorrectOptionText = "";
    if (q.answer_index !== undefined && Array.isArray(q.options)) {
      resolvedCorrectOptionText = (q.options as string[])[Number(q.answer_index) - 1] || "";
    } else if (typeof q.answer === "string") {
      resolvedCorrectOptionText = q.answer;
    }

    const questionLayout = layoutMap.get(q.id);
    const hasStructuredLayout = Boolean(questionLayout);
    let recognizedText = "";

    if (questionLayout) {
      const questionChars = (questionCharsMap.get(q.id) || []).sort((a, b) => a.x - b.x);
      recognizedText = buildCorrectedTextFromAnswer(questionChars, questionLayout, resolvedCorrectOptionText);
    }

    if (!hasStructuredLayout) {
      // layout なし時のグリッドベースフォールバック（recognizeKanjiBatch と同一）
      const col = index % COLUMNS;
      const row = Math.floor(index / COLUMNS);
      const expectedRelCenterX = (col + 0.5) / COLUMNS;
      const expectedRelCenterY = (row + 0.5) / ROWS;
      const TOLERANCE_X = 0.55 / COLUMNS;
      const TOLERANCE_Y = 0.55 / ROWS;

      const matches = recognizedCharacters.filter((c) =>
        Math.abs(c.x - expectedRelCenterX) < TOLERANCE_X &&
        Math.abs(c.y - expectedRelCenterY) < TOLERANCE_Y
      );
      recognizedText = matches.length > 0
        ? matches.sort((a, b) => a.x - b.x).map((c) => c.text).join("")
        : "";
    }

    // recognizeKanjiBatch と同一の正誤判定条件
    const isCorrect =
      normalizeKanjiText(recognizedText) === normalizeKanjiText(resolvedCorrectOptionText) &&
      recognizedText !== "";

    return {
      questionId: q.id,
      recognizedText: recognizedText || "無回答",
      correctText: resolvedCorrectOptionText,
      isCorrect,
    };
  });
}
