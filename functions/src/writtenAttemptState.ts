export type WrittenAttemptDocument = Record<string, unknown>;

export type WrittenAttemptMetadata = {
  attemptOrdinal: number;
  attemptLimit: number;
  attemptGroupId: string;
  previousAttemptId: string | null;
  isFinalAllowedAttempt: boolean;
  remainingAttempts: number;
};

export type WrittenAttemptReservationDecision =
  | {
      kind: "already_processed";
      existing: WrittenAttemptDocument;
      metadata: WrittenAttemptMetadata;
    }
  | {
      kind: "retry";
      metadata: WrittenAttemptMetadata;
    }
  | {
      kind: "in_progress";
    }
  | {
      kind: "exhausted";
    }
  | {
      kind: "new";
      metadata: WrittenAttemptMetadata;
    };

export type WrittenAttemptFinalizationDecision =
  | {
      kind: "already_processed";
      existing: WrittenAttemptDocument;
    }
  | {
      kind: "invalid_status";
    }
  | {
      kind: "exhausted";
    }
  | {
      kind: "ready";
      metadata: WrittenAttemptMetadata;
    };

function nonNegativeInteger(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

function positiveInteger(value: unknown): number | null {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1) return null;
  return Math.trunc(number);
}

function normalizedLimit(value: unknown): number {
  return Math.max(1, positiveInteger(value) || 1);
}

function optionalId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function metadataFromExisting(
  existing: WrittenAttemptDocument,
  usedAttempts: number,
  limit: number,
  fallbackGroupId: string
): WrittenAttemptMetadata {
  const attemptOrdinal = positiveInteger(existing.attemptOrdinal) || Math.max(1, usedAttempts);
  return {
    attemptOrdinal,
    attemptLimit: positiveInteger(existing.attemptLimit ?? existing.limit) || limit,
    attemptGroupId: optionalId(existing.attemptGroupId) || fallbackGroupId,
    previousAttemptId: optionalId(existing.previousAttemptId),
    isFinalAllowedAttempt: Boolean(existing.isFinalAllowedAttempt),
    remainingAttempts: Math.max(0, limit - usedAttempts),
  };
}

export function decideWrittenAttemptReservation(params: {
  existingAttempt?: WrittenAttemptDocument | null;
  usedAttempts: unknown;
  limit: unknown;
  fallbackGroupId: string;
  previousAttemptId?: string | null;
}): WrittenAttemptReservationDecision {
  const limit = normalizedLimit(params.limit);
  const usedAttempts = nonNegativeInteger(params.usedAttempts);
  const existing = params.existingAttempt || null;

  if (existing) {
    const status = existing.status || (existing.grading ? "graded" : null);
    if (status === "graded" || existing.grading) {
      return {
        kind: "already_processed",
        existing,
        metadata: metadataFromExisting(existing, usedAttempts, limit, params.fallbackGroupId),
      };
    }
    if (status === "grading_failed") {
      return {
        kind: "retry",
        metadata: metadataFromExisting(existing, usedAttempts, limit, params.fallbackGroupId),
      };
    }
    return { kind: "in_progress" };
  }

  if (usedAttempts >= limit) {
    return { kind: "exhausted" };
  }

  const attemptOrdinal = usedAttempts + 1;
  return {
    kind: "new",
    metadata: {
      attemptOrdinal,
      attemptLimit: limit,
      attemptGroupId: params.fallbackGroupId,
      previousAttemptId: optionalId(params.previousAttemptId),
      isFinalAllowedAttempt: attemptOrdinal >= limit,
      remainingAttempts: Math.max(0, limit - attemptOrdinal),
    },
  };
}

export function decideWrittenAttemptFinalization(params: {
  attempt: WrittenAttemptDocument;
  reservation: WrittenAttemptMetadata;
  limit: unknown;
}): WrittenAttemptFinalizationDecision {
  const { attempt, reservation } = params;
  const limit = normalizedLimit(params.limit);

  if (attempt.status === "graded" || attempt.grading) {
    return { kind: "already_processed", existing: attempt };
  }
  if (attempt.status !== "grading" && attempt.status !== "grading_failed") {
    return { kind: "invalid_status" };
  }

  const attemptOrdinal = positiveInteger(attempt.attemptOrdinal) || reservation.attemptOrdinal;
  if (attemptOrdinal > limit) {
    return { kind: "exhausted" };
  }

  return {
    kind: "ready",
    metadata: {
      attemptOrdinal,
      attemptLimit: positiveInteger(attempt.attemptLimit ?? attempt.limit) || reservation.attemptLimit || limit,
      attemptGroupId: optionalId(attempt.attemptGroupId) || reservation.attemptGroupId,
      previousAttemptId: optionalId(attempt.previousAttemptId) || reservation.previousAttemptId,
      isFinalAllowedAttempt:
        typeof attempt.isFinalAllowedAttempt === "boolean"
          ? attempt.isFinalAllowedAttempt
          : reservation.isFinalAllowedAttempt ?? attemptOrdinal >= limit,
      remainingAttempts:
        nonNegativeInteger(attempt.remainingAttempts ?? reservation.remainingAttempts),
    },
  };
}
