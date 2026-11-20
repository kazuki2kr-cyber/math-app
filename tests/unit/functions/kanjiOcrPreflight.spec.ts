import * as path from 'node:path';
import {
  buildCorrectedTextFromAnswer,
  OcrQuestionLayout,
  RecognizedCharacter,
} from '../../../functions/src/kanjiOcrCore';

it('skips image recognition and leaves no processing record when an exercise was removed', async () => {
  const functionsRoot = path.resolve(__dirname, '../../../functions');
  const adminModule = require.resolve('firebase-admin', { paths: [functionsRoot] });
  const visionModule = require.resolve('@google-cloud/vision', { paths: [functionsRoot] });
  const recognize = jest.fn();
  const set = jest.fn();
  const transaction = { get: jest.fn().mockResolvedValue({ exists: false }), set };
  const db = {
    doc: () => ({ get: async () => ({ exists: true, data: () => ({ kanjiAccessGranted: true }) }) }),
    runTransaction: (work: (tx: typeof transaction) => Promise<unknown>) => work(transaction),
  };
  jest.doMock(adminModule, () => ({ firestore: () => db }));
  jest.doMock(visionModule, () => ({ ImageAnnotatorClient: jest.fn(() => ({ documentTextDetection: recognize })) }));
  try {
    const { recognizeKanjiBatch } = require('../../../functions/src/kanji');
    await expect(recognizeKanjiBatch.run({
      attemptId: 'testattempt00000001', unitId: 'retired', composedImageBase64: 'unused',
    }, { auth: { uid: 'test', token: { appAccess: true } } })).rejects.toMatchObject({ code: 'not-found' });
    expect(recognize).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  } finally {
    jest.dontMock(adminModule);
    jest.dontMock(visionModule);
    jest.resetModules();
  }
});

it('rejects accounts without appAccess or school domain before reading Firestore or calling Vision', async () => {
  const functionsRoot = path.resolve(__dirname, '../../../functions');
  const adminModule = require.resolve('firebase-admin', { paths: [functionsRoot] });
  const visionModule = require.resolve('@google-cloud/vision', { paths: [functionsRoot] });
  const recognize = jest.fn();
  const docGet = jest.fn();
  const db = {
    doc: () => ({ get: docGet }),
  };
  jest.doMock(adminModule, () => ({ firestore: () => db }));
  jest.doMock(visionModule, () => ({ ImageAnnotatorClient: jest.fn(() => ({ documentTextDetection: recognize })) }));
  try {
    const { recognizeKanjiBatch } = require('../../../functions/src/kanji');
    await expect(recognizeKanjiBatch.run({
      attemptId: 'testattempt00000001', unitId: 'unit-1', composedImageBase64: 'ZmFrZQ==',
    }, { auth: { uid: 'outsider', token: { email: 'outsider@gmail.com' } } })).rejects.toMatchObject({ code: 'permission-denied' });
    expect(docGet).not.toHaveBeenCalled();
    expect(recognize).not.toHaveBeenCalled();
  } finally {
    jest.dontMock(adminModule);
    jest.dontMock(visionModule);
    jest.resetModules();
  }
});

describe('buildCorrectedTextFromAnswer (multi-kanji ordering and multiplicity)', () => {
  const twoSlotLayout: OcrQuestionLayout = {
    questionId: 'q1',
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    expectedCharCount: 2,
    slots: [
      { index: 0, x: 0, y: 0, width: 0.5, height: 1 },
      { index: 1, x: 0.5, y: 0, width: 0.5, height: 1 },
    ],
  };

  function makeChar(text: string, x: number): RecognizedCharacter {
    return {
      text,
      x,
      y: 0.5,
      left: Math.max(0, x - 0.1),
      right: Math.min(1, x + 0.1),
      top: 0.2,
      bottom: 0.8,
      width: 0.2,
      height: 0.6,
    };
  }

  test('1. 語順の逆転: 正解「山川」に対して「川山」と書いた場合は不正解になる', () => {
    const chars = [makeChar('川', 0.25), makeChar('山', 0.75)];
    expect(buildCorrectedTextFromAnswer(chars, twoSlotLayout, '山川')).toBe('川山');
  });

  test('2. 同一文字の不足: 正解「正正」に対して「正」を1文字だけ書いた場合は不正解になる', () => {
    const chars = [makeChar('正', 0.25)];
    expect(buildCorrectedTextFromAnswer(chars, twoSlotLayout, '正正')).toBe('正');
  });

  test('3. 余分な文字: 正解「山川」に対して「山木川」と余分な文字を書いた場合は不正解になる', () => {
    const chars = [makeChar('山', 0.2), makeChar('木', 0.5), makeChar('川', 0.8)];
    expect(buildCorrectedTextFromAnswer(chars, twoSlotLayout, '山川')).toBe('山木川');
  });

  test('4. 正しく書いた答案: 正解「山川」を左から右の順で正しく書いた場合（枠境界付近を含む）は正解になる', () => {
    const normalChars = [makeChar('山', 0.25), makeChar('川', 0.75)];
    expect(buildCorrectedTextFromAnswer(normalChars, twoSlotLayout, '山川')).toBe('山川');

    const shiftedChars = [makeChar('山', 0.45), makeChar('川', 0.85)];
    expect(buildCorrectedTextFromAnswer(shiftedChars, twoSlotLayout, '山川')).toBe('山川');
  });
});

it('updates maxScore only on full standard sessions and preserves existing maxScore on partial wrong-question reviews', async () => {
  const functionsRoot = path.resolve(__dirname, '../../../functions');
  const adminModule = require.resolve('firebase-admin', { paths: [functionsRoot] });
  const visionModule = require.resolve('@google-cloud/vision', { paths: [functionsRoot] });

  const tenQuestions = Array.from({ length: 10 }, (_, idx) => ({
    id: `q${idx + 1}`,
    question_text: `問題${idx + 1}`,
    answer: '山',
  }));
  const userState: Record<string, any> = {
    kanjiAccessGranted: true,
    kanjiXp: 0,
    kanjiUnitStats: {
      'unit-1': {
        maxScore: 40,
        drillCount: 1,
        wrongQuestionIds: ['q1'],
      },
    },
  };
  let savedUserUpdate: Record<string, any> | null = null;
  let markerState: Record<string, any> | null = null;

  const recognize = jest.fn().mockResolvedValue([
    {
      fullTextAnnotation: {
        pages: [
          {
            width: 100,
            height: 100,
            blocks: [
              {
                paragraphs: [
                  {
                    words: [
                      {
                        symbols: [
                          {
                            text: '山',
                            boundingBox: {
                              vertices: [
                                { x: 40, y: 40 },
                                { x: 60, y: 40 },
                                { x: 60, y: 60 },
                                { x: 40, y: 60 },
                              ],
                            },
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  ]);

  const makeDocRef = (docPath: string) => ({
    path: docPath,
    get: async () => {
      if (docPath.startsWith('users/')) return { exists: true, data: () => userState };
      if (docPath === 'units/unit-1') return { exists: true, data: () => ({ subject: 'kanji', questions: tenQuestions }) };
      if (docPath.startsWith('kanji_ocr_attempts/')) return { exists: Boolean(markerState), data: () => markerState };
      if (docPath === 'leaderboards/kanji') return { exists: true, data: () => ({ rankings: [] }) };
      return { exists: false, data: () => ({}) };
    },
  });

  const transaction = {
    get: jest.fn(async (ref: { get: () => Promise<any> }) => ref.get()),
    set: jest.fn((ref: { path: string }, data: Record<string, any>) => {
      if (ref.path.startsWith('kanji_ocr_attempts/')) {
        markerState = data;
      } else if (ref.path.startsWith('users/')) {
        savedUserUpdate = data;
      }
    }),
    delete: jest.fn(),
  };

  const db = {
    doc: (docPath: string) => makeDocRef(docPath),
    collection: () => ({
      where: () => ({
        get: async () => ({ docs: [{ id: 'unit-1' }] }),
      }),
    }),
    runTransaction: (work: (tx: typeof transaction) => Promise<unknown>) => work(transaction),
  };

  jest.doMock(adminModule, () => ({ firestore: () => db }));
  jest.doMock(visionModule, () => ({ ImageAnnotatorClient: jest.fn(() => ({ documentTextDetection: recognize })) }));

  try {
    const { recognizeKanjiBatch } = require('../../../functions/src/kanji');

    // 1. Wrong-list review of 1 question ('q1'): session score is 100, but unit maxScore stays 40
    const res = await recognizeKanjiBatch.run(
      {
        attemptId: 'review_attempt_000001',
        unitId: 'unit-1',
        composedImageBase64: 'ZmFrZQ==',
        questionIds: ['q1'],
      },
      { auth: { uid: 'test', token: { appAccess: true, name: 'Test User' } } }
    );
    expect(res.score).toBe(100);
    expect(res.isHighScore).toBe(false);
    expect(savedUserUpdate?.kanjiUnitStats?.['unit-1']?.maxScore).toBe(40);
    expect(savedUserUpdate?.kanjiUnitStats?.['unit-1']?.wrongQuestionIds).toEqual([]);

    // 2. Partial submission with a question NOT in wrongQuestionIds ('q2') is rejected
    markerState = null;
    await expect(
      recognizeKanjiBatch.run(
        {
          attemptId: 'partial_abuse_0000001',
          unitId: 'unit-1',
          composedImageBase64: 'ZmFrZQ==',
          questionIds: ['q2'],
        },
        { auth: { uid: 'test', token: { appAccess: true, name: 'Test User' } } }
      )
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  } finally {
    jest.dontMock(adminModule);
    jest.dontMock(visionModule);
    jest.resetModules();
  }
});
