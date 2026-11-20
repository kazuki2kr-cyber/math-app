import { resolveWrittenGradingConfig } from '../../../functions/src/writtenGradingConfig';

describe('resolveWrittenGradingConfig', () => {
  test('prefers isolated grading_configs document when question document has secrets stripped', () => {
    const question = {
      id: 'q_0',
      question_text: '面積を求めよ。',
      questionType: 'written',
    };
    const gradingConfig = {
      modelAnswer: '24 cm^2',
      gradingRubric: [{ label: '式', maxScore: 60 }, { label: '答え', maxScore: 40 }],
      iconReward: { id: 'medal', name: '達人', imageUrl: '/images/reward-icons/medal.png' },
    };

    expect(resolveWrittenGradingConfig(question, gradingConfig, {})).toEqual({
      modelAnswer: '24 cm^2',
      gradingRubric: [{ label: '式', maxScore: 60 }, { label: '答え', maxScore: 40 }],
      iconReward: { id: 'medal', name: '達人', imageUrl: '/images/reward-icons/medal.png' },
    });
  });

  test('falls back to legacy fields on question and unit when grading_configs does not exist yet', () => {
    const question = {
      id: 'q_0',
      question_text: '証明せよ。',
      model_answer: '△ABC≡△DEF',
      grading_rubric: ['仮定 50点', '結論 50点'],
      iconReward: { id: 'proof', name: '証明王', imageUrl: '/images/reward-icons/proof.png' },
    };
    const unitData = {
      gradingRubric: ['fallback'],
    };

    expect(resolveWrittenGradingConfig(question, null, unitData)).toEqual({
      modelAnswer: '△ABC≡△DEF',
      gradingRubric: ['仮定 50点', '結論 50点'],
      iconReward: { id: 'proof', name: '証明王', imageUrl: '/images/reward-icons/proof.png' },
    });
  });

  test('falls back to unitData.gradingRubric and explanation when question rubric/modelAnswer are absent', () => {
    const question = {
      id: 'q_0',
      explanation: '解説が模範解答',
    };
    const unitData = {
      gradingRubric: [{ label: '過程', maxScore: 60 }],
    };

    expect(resolveWrittenGradingConfig(question, undefined, unitData)).toEqual({
      modelAnswer: '解説が模範解答',
      gradingRubric: [{ label: '過程', maxScore: 60 }],
      iconReward: null,
    });
  });
});
