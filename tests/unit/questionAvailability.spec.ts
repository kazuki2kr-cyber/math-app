import { filterActiveQuestions, isQuestionActive } from '@/lib/questionAvailability';
import { filterActiveQuestionsServer } from '../../functions/src/questionAvailability';

describe('question availability', () => {
  test('active が未設定の既存問題は公開中として扱う', () => {
    expect(isQuestionActive({})).toBe(true);
    expect(isQuestionActive({ active: true })).toBe(true);
  });

  test('active が false の問題だけを出題対象から除外する', () => {
    const questions = [
      { id: 'legacy' },
      { id: 'active', active: true },
      { id: 'inactive', active: false },
    ];

    expect(filterActiveQuestions(questions).map(question => question.id)).toEqual(['legacy', 'active']);
    expect(filterActiveQuestionsServer(questions).map(question => question.id)).toEqual(['legacy', 'active']);
  });
});
