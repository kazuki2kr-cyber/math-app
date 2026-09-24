export type IntegritySignalCode =
  | "very_fast_answers"
  | "fast_perfect_run"
  | "rapid_repeat_submission";

export type IntegritySeverity = "low" | "medium" | "high";

export type IntegritySignal = {
  code: IntegritySignalCode;
  points: number;
  reason: string;
};

export type IntegrityAssessment = {
  flagged: boolean;
  riskScore: number;
  severity: IntegritySeverity;
  averageSecondsPerQuestion: number;
  accuracy: number;
  signals: IntegritySignal[];
  reasons: string[];
};

type AssessDrillIntegrityInput = {
  timeSec: number;
  answeredCount: number;
  correctCount: number;
  rapidSubmissionSec: number | null;
};

const FLAG_THRESHOLD = 40;

export function assessDrillIntegrity({
  timeSec,
  answeredCount,
  correctCount,
  rapidSubmissionSec,
}: AssessDrillIntegrityInput): IntegrityAssessment {
  const safeAnsweredCount = Math.max(1, answeredCount);
  const averageSecondsPerQuestion = timeSec / safeAnsweredCount;
  const accuracy = Math.max(0, Math.min(1, correctCount / safeAnsweredCount));
  const signals: IntegritySignal[] = [];

  if (answeredCount >= 5 && averageSecondsPerQuestion <= 3) {
    signals.push({
      code: "very_fast_answers",
      points: 60,
      reason: `平均解答時間が${averageSecondsPerQuestion.toFixed(1)}秒/問`,
    });
  }

  if (answeredCount >= 10 && averageSecondsPerQuestion <= 5 && accuracy === 1) {
    signals.push({
      code: "fast_perfect_run",
      points: 40,
      reason: `短時間で全問正解（${answeredCount}問）`,
    });
  }

  if (rapidSubmissionSec !== null && rapidSubmissionSec < 30 && answeredCount >= 10) {
    signals.push({
      code: "rapid_repeat_submission",
      points: 50,
      reason: `前回演習から${rapidSubmissionSec}秒で再提出`,
    });
  }

  const riskScore = Math.min(100, signals.reduce((sum, signal) => sum + signal.points, 0));
  const severity: IntegritySeverity = riskScore >= 80
    ? "high"
    : riskScore >= 60
      ? "medium"
      : "low";

  return {
    flagged: riskScore >= FLAG_THRESHOLD,
    riskScore,
    severity,
    averageSecondsPerQuestion,
    accuracy,
    signals,
    reasons: signals.map((signal) => signal.reason),
  };
}
