export const WRITTEN_INCLUDE_IN_TOTAL_SCORE = false;

export function preserveTotalScoreForWrittenAttempt(currentTotalScore: unknown): number {
  return Math.max(0, Number(currentTotalScore) || 0);
}
