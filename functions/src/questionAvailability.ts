export function filterActiveQuestionsServer<T>(questions: T[]): T[] {
  return questions.filter((question) => (question as { active?: boolean }).active !== false);
}
