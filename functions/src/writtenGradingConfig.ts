export type ResolvedWrittenGradingConfig = {
  modelAnswer: string;
  gradingRubric: unknown;
  iconReward: unknown;
};

/**
 * Resolves written-grading secrets (`modelAnswer`, `gradingRubric`, `iconReward`)
 * from the admin/server-only `units/{unitId}/grading_configs/{questionId}` document,
 * falling back to legacy fields on the question/unit documents when not yet migrated.
 */
export function resolveWrittenGradingConfig(
  question: Record<string, unknown>,
  gradingConfig: Record<string, unknown> | null | undefined,
  unitData: Record<string, unknown> = {},
): ResolvedWrittenGradingConfig {
  const cfg = gradingConfig || {};

  const modelAnswer = String(
    cfg.modelAnswer ??
      cfg.model_answer ??
      question.modelAnswer ??
      question.model_answer ??
      cfg.explanation ??
      question.explanation ??
      ""
  );

  const gradingRubric =
    cfg.gradingRubric ??
    cfg.grading_rubric ??
    question.gradingRubric ??
    question.grading_rubric ??
    unitData.gradingRubric ??
    [];

  const iconReward = cfg.iconReward ?? question.iconReward ?? null;

  return {
    modelAnswer,
    gradingRubric,
    iconReward,
  };
}
