export interface QuestionAvailability {
  active?: boolean;
}

export function isQuestionActive(question: QuestionAvailability): boolean {
  return question.active !== false;
}

export function filterActiveQuestions<T extends QuestionAvailability>(questions: T[]): T[] {
  return questions.filter(isQuestionActive);
}
