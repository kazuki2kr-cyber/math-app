export function filterActiveQuestionsServer<T>(questions: T[]): T[] {
  return questions.filter((question) => (question as { active?: boolean }).active !== false);
}

export function completeActiveAnswers<T extends { questionId: string }>(
  questions: Array<{ id: string | number; active?: boolean }>,
  answers: T[],
): T[] | null {
  const activeIds = new Set(filterActiveQuestionsServer(questions).map(question => String(question.id)));
  const activeAnswers = answers.filter(answer => activeIds.has(answer.questionId));
  const submittedIds = new Set(activeAnswers.map(answer => answer.questionId));
  if (!activeIds.size || submittedIds.size !== activeIds.size || submittedIds.size !== activeAnswers.length) return null;
  return activeAnswers;
}
