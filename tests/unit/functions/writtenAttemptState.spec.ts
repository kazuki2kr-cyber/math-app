import {
  decideWrittenAttemptFinalization,
  decideWrittenAttemptReservation,
} from '../../../functions/src/writtenAttemptState';

const groupId = 'user-1:written-unit:q1';

describe('decideWrittenAttemptReservation', () => {
  test('reserves the first attempt and leaves one remaining attempt', () => {
    expect(decideWrittenAttemptReservation({
      usedAttempts: 0,
      limit: 2,
      fallbackGroupId: groupId,
      previousAttemptId: null,
    })).toEqual({
      kind: 'new',
      metadata: {
        attemptOrdinal: 1,
        attemptLimit: 2,
        attemptGroupId: groupId,
        previousAttemptId: null,
        isFinalAllowedAttempt: false,
        remainingAttempts: 1,
      },
    });
  });

  test('marks the final allowed attempt and links it to the previous attempt', () => {
    expect(decideWrittenAttemptReservation({
      usedAttempts: 1,
      limit: 2,
      fallbackGroupId: groupId,
      previousAttemptId: 'attempt-1',
    })).toEqual({
      kind: 'new',
      metadata: {
        attemptOrdinal: 2,
        attemptLimit: 2,
        attemptGroupId: groupId,
        previousAttemptId: 'attempt-1',
        isFinalAllowedAttempt: true,
        remainingAttempts: 0,
      },
    });
  });

  test('rejects a new attempt after the limit is exhausted', () => {
    expect(decideWrittenAttemptReservation({
      usedAttempts: 2,
      limit: 2,
      fallbackGroupId: groupId,
    })).toEqual({ kind: 'exhausted' });
  });

  test('returns a graded attempt without consuming another attempt', () => {
    const existing = {
      status: 'graded',
      score: 80,
      attemptOrdinal: 1,
      attemptLimit: 2,
      attemptGroupId: groupId,
    };

    expect(decideWrittenAttemptReservation({
      existingAttempt: existing,
      usedAttempts: 1,
      limit: 2,
      fallbackGroupId: groupId,
    })).toEqual({
      kind: 'already_processed',
      existing,
      metadata: {
        attemptOrdinal: 1,
        attemptLimit: 2,
        attemptGroupId: groupId,
        previousAttemptId: null,
        isFinalAllowedAttempt: false,
        remainingAttempts: 1,
      },
    });
  });

  test('retries a failed grading with the original attempt metadata', () => {
    expect(decideWrittenAttemptReservation({
      existingAttempt: {
        status: 'grading_failed',
        attemptOrdinal: 2,
        attemptLimit: 2,
        attemptGroupId: groupId,
        previousAttemptId: 'attempt-1',
        isFinalAllowedAttempt: true,
      },
      usedAttempts: 2,
      limit: 2,
      fallbackGroupId: 'fallback',
    })).toEqual({
      kind: 'retry',
      metadata: {
        attemptOrdinal: 2,
        attemptLimit: 2,
        attemptGroupId: groupId,
        previousAttemptId: 'attempt-1',
        isFinalAllowedAttempt: true,
        remainingAttempts: 0,
      },
    });
  });

  test('blocks a duplicate request while grading is in progress', () => {
    expect(decideWrittenAttemptReservation({
      existingAttempt: { status: 'grading', reservedAt: 1_000_000 },
      usedAttempts: 1,
      limit: 2,
      fallbackGroupId: groupId,
      nowMs: 1_060_000,
    })).toEqual({ kind: 'in_progress' });
  });

  test('allows retrying the same attemptId when a grading lease has expired', () => {
    expect(decideWrittenAttemptReservation({
      existingAttempt: {
        status: 'grading',
        reservedAt: 1_000_000,
        attemptOrdinal: 1,
        attemptLimit: 2,
        attemptGroupId: groupId,
      },
      usedAttempts: 1,
      limit: 2,
      fallbackGroupId: groupId,
      nowMs: 1_000_000 + 150_000,
    })).toEqual({
      kind: 'retry',
      metadata: {
        attemptOrdinal: 1,
        attemptLimit: 2,
        attemptGroupId: groupId,
        previousAttemptId: null,
        isFinalAllowedAttempt: false,
        remainingAttempts: 1,
      },
    });
  });

  test('reclaims the failed slot instead of consuming a new attempt when a new attemptId follows grading_failed', () => {
    expect(decideWrittenAttemptReservation({
      existingAttempt: null,
      lastAttemptId: 'attempt-1-failed',
      lastAttempt: {
        status: 'grading_failed',
        attemptOrdinal: 1,
        attemptLimit: 2,
        attemptGroupId: groupId,
        previousAttemptId: null,
      },
      usedAttempts: 1,
      limit: 2,
      fallbackGroupId: groupId,
      previousAttemptId: 'attempt-1-failed',
      nowMs: 2_000_000,
    })).toEqual({
      kind: 'reclaim_failed_slot',
      supersedeAttemptId: 'attempt-1-failed',
      metadata: {
        attemptOrdinal: 1,
        attemptLimit: 2,
        attemptGroupId: groupId,
        previousAttemptId: null,
        isFinalAllowedAttempt: false,
        remainingAttempts: 1,
      },
    });
  });
});

describe('decideWrittenAttemptFinalization', () => {
  const reservation = {
    attemptOrdinal: 2,
    attemptLimit: 2,
    attemptGroupId: groupId,
    previousAttemptId: 'attempt-1',
    isFinalAllowedAttempt: true,
    remainingAttempts: 0,
  };

  test('finalizes a reserved grading attempt with stable metadata', () => {
    expect(decideWrittenAttemptFinalization({
      attempt: { status: 'grading', gradingClaimId: 'claim-current', ...reservation },
      reservation,
      limit: 2,
      expectedClaimId: 'claim-current',
    })).toEqual({
      kind: 'ready',
      metadata: reservation,
    });
  });

  test('rejects a late finalization from a superseded claim holder', () => {
    expect(decideWrittenAttemptFinalization({
      attempt: { status: 'grading', gradingClaimId: 'claim-newer', ...reservation },
      reservation,
      limit: 2,
      expectedClaimId: 'claim-stale',
    })).toEqual({
      kind: 'stale_claim',
    });
  });

  test('treats an already graded attempt as idempotently processed', () => {
    const attempt = { status: 'graded', score: 95, grading: { feedback: 'ok' } };
    expect(decideWrittenAttemptFinalization({
      attempt,
      reservation,
      limit: 2,
    })).toEqual({ kind: 'already_processed', existing: attempt });
  });

  test('rejects an unexpected attempt state', () => {
    expect(decideWrittenAttemptFinalization({
      attempt: { status: 'cancelled' },
      reservation,
      limit: 2,
    })).toEqual({ kind: 'invalid_status' });
  });

  test('rejects corrupted metadata beyond the configured limit', () => {
    expect(decideWrittenAttemptFinalization({
      attempt: { status: 'grading', attemptOrdinal: 3 },
      reservation,
      limit: 2,
    })).toEqual({ kind: 'exhausted' });
  });
});
