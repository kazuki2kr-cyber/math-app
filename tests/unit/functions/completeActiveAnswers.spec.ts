import { completeActiveAnswers } from '../../../functions/src/questionAvailability';

const questions = [{ id: 1 }, { id: '2' }, { id: '3', active: false }];
const first = { questionId: '1' };
const second = { questionId: '2' };

describe('all-question submissions', () => {
  it('grades every active question in submission order', () => {
    expect(completeActiveAnswers(questions, [second, first])).toEqual([second, first]);
  });

  it('omits a question retired during the exercise', () => {
    expect(completeActiveAnswers(questions, [second, { questionId: '3' }, first])).toEqual([second, first]);
  });

  it('requires the complete active set without duplicates', () => {
    expect(completeActiveAnswers(questions, [first])).toBeNull();
    expect(completeActiveAnswers(questions, [first, first, second])).toBeNull();
    expect(completeActiveAnswers([], [])).toBeNull();
  });
});
