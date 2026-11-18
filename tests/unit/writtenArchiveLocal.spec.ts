import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
const { segment, localMetadata, saveRecord, rebuildCatalog } = require('../../scripts/pull-written-answers');

describe('written answer local archive', () => {
  const record = {
    uid: 'student-uid', attemptPath: 'users/student-uid/attempts/a1', attemptId: 'a1',
    attemptGroupId: 'student-uid:unit:q1', subject: '数学', field: '方程式',
    image: { path: 'written-archive/v1/images/x.png', contentType: 'image/png', bytes: 12, sha256: 'a'.repeat(64) },
  };

  it('keeps directory components inside a single safe segment', () => {
    const result = segment('../方程式\\答案:*?');
    expect(result).not.toMatch(/[\\/:*?<>|]/);
    expect(result).not.toBe('');
    expect(segment('方程式')).not.toBe(segment('方程式2'));
  });

  it('removes direct identifiers while keeping stable analysis keys and image integrity', () => {
    const local = localMetadata(record);
    expect(local.uid).toBeUndefined();
    expect(local.attemptPath).toBeUndefined();
    expect(local.attemptGroupId).toBeUndefined();
    expect(local.learnerKey).toMatch(/^[a-f0-9]{20}$/);
    expect(local.attemptGroupKey).toMatch(/^[a-f0-9]{20}$/);
    expect(local.image).toEqual({ filename: 'answer.png', contentType: 'image/png', bytes: 12, sha256: 'a'.repeat(64) });
    expect(localMetadata(record).learnerKey).toBe(local.learnerKey);
  });

  it('preserves the previous catalog when a previously indexed answer is missing', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'written-catalog-'));
    try {
      const directory = path.join(root, 'attempt');
      await fs.mkdir(directory);
      await fs.writeFile(path.join(directory, 'record.json'), JSON.stringify(record));
      await expect(rebuildCatalog(root)).resolves.toBe(1);
      const catalog = path.join(root, 'catalog.jsonl');
      const previous = await fs.readFile(catalog);
      await fs.rename(path.join(directory, 'record.json'), path.join(directory, 'unavailable'));
      await expect(rebuildCatalog(root)).rejects.toThrow('欠落');
      expect(await fs.readFile(catalog)).toEqual(previous);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('acknowledges the cloud copy only after a matching image is saved locally', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'written-archive-test-'));
    const bytes = Buffer.from('answer-image');
    const validRecord = {
      ...record,
      image: { ...record.image, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') },
    };
    const calls: string[] = [];
    const request = async (name: string) => {
      calls.push(name);
      if (name === 'getWrittenArchiveImage') return { base64: bytes.toString('base64'), sha256: validRecord.image.sha256 };
      return { acknowledged: true };
    };
    try {
      await expect(saveRecord(validRecord, 'token', request, root)).resolves.toBe('downloaded');
      expect(calls).toEqual(['getWrittenArchiveImage', 'acknowledgeWrittenArchive']);
      await expect(saveRecord(validRecord, 'token', request, root)).resolves.toBe('verified');
      expect(calls.at(-1)).toBe('acknowledgeWrittenArchive');
      const badCalls: string[] = [];
      const bad = async (name: string) => {
        badCalls.push(name);
        return { base64: Buffer.from('wrong').toString('base64'), sha256: validRecord.image.sha256 };
      };
      await expect(saveRecord({ ...validRecord, attemptId: 'a2' }, 'token', bad, root)).rejects.toThrow('ハッシュ');
      expect(badCalls).toEqual(['getWrittenArchiveImage']);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
