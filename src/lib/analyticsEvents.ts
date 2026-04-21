import { serverTimestamp } from 'firebase/firestore';

export const ANALYTICS_EVENT_VERSION = 1;

export type AnalyticsEventType =
  | 'ATTEMPT_DELETED'
  | 'ALL_DATA_RESET';

function buildLogicalDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function buildAttemptDeletedEvent(params: {
  attemptId: string;
  uid: string;
  unitId: string;
  deletedByUid: string;
  reason: 'admin_delete';
}) {
  const now = new Date();
  return {
    eventType: 'ATTEMPT_DELETED' as const,
    eventVersion: ANALYTICS_EVENT_VERSION,
    occurredAt: serverTimestamp(),
    logicalDate: buildLogicalDate(now),
    attemptId: params.attemptId,
    uid: params.uid,
    unitId: params.unitId,
    deletedByUid: params.deletedByUid,
    reason: params.reason,
  };
}

export function buildAllDataResetEvent(params: {
  executedByUid: string;
  reason: 'admin_reset_all';
}) {
  const now = new Date();
  return {
    eventType: 'ALL_DATA_RESET' as const,
    eventVersion: ANALYTICS_EVENT_VERSION,
    occurredAt: serverTimestamp(),
    logicalDate: buildLogicalDate(now),
    executedByUid: params.executedByUid,
    reason: params.reason,
  };
}

export function attemptDeletedEventId(attemptId: string): string {
  return `delete_${attemptId}`;
}

export function allDataResetEventId(now: Date = new Date()): string {
  return `reset_${now.toISOString().replace(/[:.]/g, '-')}`;
}
