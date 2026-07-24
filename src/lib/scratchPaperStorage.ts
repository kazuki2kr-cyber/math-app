import type { HandwritingStroke } from '@/components/HandwritingCanvas';

const DATABASE_NAME = 'formix-local-learning-data';
const DATABASE_VERSION = 1;
const STORE_NAME = 'scratch-attempts';
const SCRATCH_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS_PER_USER = 3;
const MAX_STORAGE_BYTES_PER_USER = 20 * 1024 * 1024;

export type ScratchPagesByQuestion = Record<string, HandwritingStroke[][]>;

export interface ScratchAttemptRecord {
  key: string;
  uid: string;
  attemptId: string;
  unitId: string;
  pagesByQuestion: ScratchPagesByQuestion;
  updatedAt: number;
  expiresAt: number;
}

const memoryFallback = new Map<string, ScratchAttemptRecord>();

function estimateRecordBytes(record: ScratchAttemptRecord) {
  const serialized = JSON.stringify(record);
  return typeof Blob === 'undefined'
    ? serialized.length * 2
    : new Blob([serialized]).size;
}

function keysOutsideRetentionLimits(records: ScratchAttemptRecord[], now: number) {
  const currentRecords = records
    .filter((record) => record.expiresAt > now)
    .sort((left, right) => right.updatedAt - left.updatedAt);
  const keysToDelete = records
    .filter((record) => record.expiresAt <= now)
    .map((record) => record.key);
  let retainedBytes = 0;

  currentRecords.forEach((record, index) => {
    const recordBytes = estimateRecordBytes(record);
    if (
      index >= MAX_ATTEMPTS_PER_USER
      || retainedBytes + recordBytes > MAX_STORAGE_BYTES_PER_USER
    ) {
      keysToDelete.push(record.key);
      return;
    }
    retainedBytes += recordBytes;
  });

  return keysToDelete;
}

function cleanupMemoryFallback(uid: string, now: number) {
  const userRecords = [...memoryFallback.values()].filter((record) => record.uid === uid);
  keysOutsideRetentionLimits(userRecords, now).forEach((key) => memoryFallback.delete(key));
}

function buildKey(uid: string, attemptId: string) {
  return `${uid}:${attemptId}`;
}

function supportsIndexedDb() {
  return typeof window !== 'undefined' && 'indexedDB' in window;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'key' });
        store.createIndex('uid', 'uid', { unique: false });
        store.createIndex('expiresAt', 'expiresAt', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, mode);
    const completion = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    });
    const result = await operation(transaction.objectStore(STORE_NAME));
    await completion;
    return result;
  } finally {
    database.close();
  }
}

export async function saveScratchAttempt(input: {
  uid: string;
  attemptId: string;
  unitId: string;
  pagesByQuestion: ScratchPagesByQuestion;
}): Promise<'indexeddb' | 'memory'> {
  const now = Date.now();
  const record: ScratchAttemptRecord = {
    key: buildKey(input.uid, input.attemptId),
    uid: input.uid,
    attemptId: input.attemptId,
    unitId: input.unitId,
    pagesByQuestion: input.pagesByQuestion,
    updatedAt: now,
    expiresAt: now + SCRATCH_TTL_MS,
  };

  memoryFallback.set(record.key, record);
  if (estimateRecordBytes(record) > MAX_STORAGE_BYTES_PER_USER) return 'memory';
  cleanupMemoryFallback(input.uid, now);
  if (!supportsIndexedDb()) return 'memory';

  try {
    await withStore('readwrite', async (store) => {
      await requestToPromise(store.put(record));
    });
    await cleanupScratchAttempts(input.uid);
    return 'indexeddb';
  } catch (error) {
    console.warn('Failed to persist scratch paper in IndexedDB; using memory fallback.', error);
    return 'memory';
  }
}

export async function loadScratchAttempt(
  uid: string,
  attemptId: string,
): Promise<ScratchAttemptRecord | null> {
  const key = buildKey(uid, attemptId);
  const memoryRecord = memoryFallback.get(key);
  if (memoryRecord && memoryRecord.expiresAt > Date.now()) return memoryRecord;
  if (!supportsIndexedDb()) return null;

  try {
    const record = await withStore('readonly', async (store) => (
      requestToPromise(store.get(key) as IDBRequest<ScratchAttemptRecord | undefined>)
    ));
    if (!record) return null;
    if (record.expiresAt <= Date.now()) {
      await deleteScratchAttempt(uid, attemptId);
      return null;
    }
    memoryFallback.set(key, record);
    return record;
  } catch (error) {
    console.warn('Failed to load scratch paper from IndexedDB.', error);
    return null;
  }
}

export async function deleteScratchAttempt(uid: string, attemptId: string): Promise<void> {
  const key = buildKey(uid, attemptId);
  memoryFallback.delete(key);
  if (!supportsIndexedDb()) return;

  try {
    await withStore('readwrite', async (store) => {
      await requestToPromise(store.delete(key));
    });
  } catch (error) {
    console.warn('Failed to delete scratch paper from IndexedDB.', error);
  }
}

export async function cleanupScratchAttempts(uid: string): Promise<void> {
  const now = Date.now();
  cleanupMemoryFallback(uid, now);
  if (!supportsIndexedDb()) return;

  try {
    await withStore('readwrite', async (store) => {
      const records = await requestToPromise(
        store.index('uid').getAll(uid) as IDBRequest<ScratchAttemptRecord[]>,
      );
      const keysToDelete = keysOutsideRetentionLimits(records, now);
      await Promise.all(keysToDelete.map((key) => requestToPromise(store.delete(key))));
    });
  } catch (error) {
    console.warn('Failed to clean up scratch paper storage.', error);
  }
}

export async function clearScratchAttemptsForUser(uid: string): Promise<void> {
  for (const [key, record] of memoryFallback.entries()) {
    if (record.uid === uid) memoryFallback.delete(key);
  }
  if (!supportsIndexedDb()) return;

  try {
    await withStore('readwrite', async (store) => {
      const keys = await requestToPromise(store.index('uid').getAllKeys(uid));
      await Promise.all(keys.map((key) => requestToPromise(store.delete(key))));
    });
  } catch (error) {
    console.warn('Failed to clear scratch paper storage for signed-out user.', error);
  }
}
