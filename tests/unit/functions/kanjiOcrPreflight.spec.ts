import * as path from 'node:path';

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
    }, { auth: { uid: 'test', token: {} } })).rejects.toMatchObject({ code: 'not-found' });
    expect(recognize).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  } finally {
    jest.dontMock(adminModule);
    jest.dontMock(visionModule);
    jest.resetModules();
  }
});
