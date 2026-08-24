import {
  COMPACT_ADVISOR_RESPONSE_SCHEMA,
  COMPACT_PRACTICE_RESPONSE_SCHEMA,
  buildAdvisorPrompt,
  buildCompactAdvisorPrompt,
  buildCompactPracticePrompt,
  buildFollowUpPrompt,
  buildPracticePrompt,
  getOnDeviceAiErrorMessage,
  normalizeOnDeviceAiMathText,
  parseAdvisorResult,
  parseFollowUpResult,
  parsePracticeResult,
  toPlainOnDeviceAiMathText,
} from '@/lib/onDeviceAiAdvisor';

const wrongQuestion = {
  id: 'q-1',
  questionText: '2x + 3 = 9 を解きなさい。',
  selectedAnswer: 'x = 6',
  correctAnswer: 'x = 3',
  explanation: '両辺から3を引き、2で割ります。',
};

describe('on-device AI advisor', () => {
  it('builds a compact evidence-based advisor prompt without asking for practice problems', () => {
    const prompt = buildAdvisorPrompt({
      unitTitle: '方程式',
      score: 50,
      totalQuestions: 2,
      correctQuestions: [{ id: 'q-2', questionText: 'x + 1 = 3' }],
      wrongQuestions: [wrongQuestion],
    });

    expect(prompt).toContain('方程式');
    expect(prompt).toContain('2x + 3 = 9');
    expect(prompt).toContain('"正解数":1');
    expect(prompt).toContain('"不正解数":1');
    expect(prompt).toContain('"正答率":50');
    expect(prompt).toContain('根拠となる問題文');
    expect(prompt).toContain('類題は作らないでください');
    expect(prompt).not.toContain('"id"');
    expect(prompt).not.toContain('learnerAnswer');
    expect(prompt).not.toContain('APIキー');
  });

  it('limits advisor findings and keeps their evidence', () => {
    const result = parseAdvisorResult(JSON.stringify({
      summary: '移項の意味を確認しましょう。',
      strengths: [
        { point: '式の形を読み取れています。', evidence: 'x + 1 = 3に正解しました。' },
        { point: '計算に取り組めています。', evidence: '2問とも回答しました。' },
        { point: '余分な強み', evidence: '上限確認用' },
      ],
      weaknesses: [
        { point: '移項の操作を確認しましょう。', evidence: '2x + 3 = 9でx = 6を選びました。' },
      ],
      reviewSteps: ['両辺から3を引く。', '両辺を2で割る。', '答えを元の式に代入する。', '余分な手順'],
    }));

    expect(result.summary).toBe('移項の意味を確認しましょう。');
    expect(result.strengths).toHaveLength(2);
    expect(result.strengths[0].evidence).toContain('x + 1 = 3');
    expect(result.reviewSteps).toHaveLength(3);
  });

  it('removes model-generated list markers without changing decimal values', () => {
    const result = parseAdvisorResult(JSON.stringify({
      summary: '復習しましょう。',
      strengths: [{ point: '確認できました。', evidence: '1問に正解しました。' }],
      weaknesses: [{ point: '計算を確認しましょう。', evidence: '1問を間違えました。' }],
      reviewSteps: ['1. 計算ルールを確認する。', '2. 1.5倍の例を解く。'],
    }));

    expect(result.reviewSteps).toEqual(['計算ルールを確認する。', '1.5倍の例を解く。']);
  });

  it('normalizes AI math for KaTeX and native select labels', () => {
    expect(normalizeOnDeviceAiMathText('値は \\frac{1}{4} です。')).toBe(
      '値は \\(\\frac{1}{4}\\) です。',
    );
    expect(normalizeOnDeviceAiMathText('式は \\(2a-b\\) です。')).toBe(
      '式は \\(2a-b\\) です。',
    );
    expect(normalizeOnDeviceAiMathText('式は \\\\(2a-b\\\\) です。')).toBe(
      '式は \\(2a-b\\) です。',
    );
    expect(toPlainOnDeviceAiMathText('計算 \\((5z+12)\\times\\frac{1}{4}\\)')).toBe(
      '計算 (5z+12)×(1)/(4)',
    );
    expect(toPlainOnDeviceAiMathText('次の式を簡潔にせよ。 2x^2-x+3-x^{2}+4x-1')).toBe(
      '次の式を簡潔にせよ。 2x²-x+3-x²+4x-1',
    );
    expect(toPlainOnDeviceAiMathText('1行目<br>2行目')).toBe('1行目 2行目');
    expect(toPlainOnDeviceAiMathText('x&lt;3、y&gt;2')).toBe('x<3、y>2');
    expect(toPlainOnDeviceAiMathText('x<3、y>2')).toBe('x<3、y>2');
  });

  it('removes HTML and replaces leaked internal field labels in generated advice', () => {
    const result = parseAdvisorResult(JSON.stringify({
      summary: '式を確認しましょう。',
      strengths: [{ point: '1問に正解しました。', evidence: '正答数は1問です。' }],
      weaknesses: [{
        point: '同類項を確認しましょう。',
        evidence: '問題文です。learnerAnswerが間違っています。<br>providedExplanationを確認します。',
      }],
      reviewSteps: ['<b>同類項</b>をまとめる。', '答えを確認する。'],
    }));

    expect(result.weaknesses[0].evidence).toBe(
      '問題文です。生徒の回答が間違っています。\n元の解説を確認します。',
    );
    expect(result.reviewSteps[0]).toBe('同類項をまとめる。');
    expect(JSON.stringify(result)).not.toMatch(/learnerAnswer|providedExplanation|<br>|<b>/i);
  });

  it('uses a shorter advisor structure for the automatic retry', () => {
    const prompt = buildCompactAdvisorPrompt({
      unitTitle: '方程式',
      score: 50,
      totalQuestions: 2,
      correctQuestions: [{ id: 'q-2', questionText: 'x + 1 = 3' }],
      wrongQuestions: [wrongQuestion],
    });

    expect(prompt).toContain('strengthsは1件');
    expect(prompt).toContain('reviewStepsは2件');
    expect(COMPACT_ADVISOR_RESPONSE_SCHEMA).toMatchObject({
      properties: {
        strengths: { maxItems: 1 },
        weaknesses: { maxItems: 1 },
        reviewSteps: { maxItems: 2 },
      },
    });
  });

  it('hides raw JSON parser errors when the model response is truncated', () => {
    let thrown: unknown;
    try {
      parseAdvisorResult('{"summary":"途中で終了');
    } catch (error) {
      thrown = error;
    }

    expect(getOnDeviceAiErrorMessage(thrown)).toBe(
      '端末内AIの回答が途中で終了しました。もう一度お試しください。',
    );
    expect(getOnDeviceAiErrorMessage(thrown)).not.toContain('Unterminated string');
  });

  it('builds and parses a focused practice-problem prompt', () => {
    const prompt = buildPracticePrompt({
      unitTitle: '方程式',
      score: 50,
      totalQuestions: 2,
      correctQuestions: [{ id: 'q-2', questionText: 'x + 1 = 3' }],
      wrongQuestions: [wrongQuestion],
    });
    const result = parsePracticeResult(JSON.stringify({
      practiceProblems: [
        {
          question: 'x+2=5',
          hint: '両辺から2を引く。',
          answer: 'x=3',
          explanation: '5-2=3です。',
          verification: '3+2=5なので正しいです。',
        },
      ],
    }));

    expect(prompt).toContain('類題作成だけ');
    expect(prompt).toContain('"回答状況":"誤答"');
    expect(prompt).not.toContain('learnerAnswer');
    expect(prompt).toContain('verification');
    expect(result.practiceProblems[0].verification).toContain('3+2=5');
  });

  it('removes source HTML before including question data in prompts', () => {
    const prompt = buildAdvisorPrompt({
      unitTitle: '式の計算',
      score: 0,
      totalQuestions: 1,
      correctQuestions: [],
      wrongQuestions: [{
        ...wrongQuestion,
        questionText: '1行目<br>2行目',
        explanation: '<p>同類項をまとめます。</p>',
      }],
    });

    expect(prompt).toContain('1行目\\n2行目');
    expect(prompt).toContain('同類項をまとめます。');
    expect(prompt).not.toMatch(/<br|<p>|<\/p>/i);
  });

  it('uses one short practice problem for the automatic retry', () => {
    const prompt = buildCompactPracticePrompt({
      unitTitle: '方程式',
      score: 50,
      totalQuestions: 2,
      correctQuestions: [{ id: 'q-2', questionText: 'x + 1 = 3' }],
      wrongQuestions: [wrongQuestion],
    });

    expect(prompt).toContain('類題を1問だけ');
    expect(COMPACT_PRACTICE_RESPONSE_SCHEMA).toMatchObject({
      properties: { practiceProblems: { maxItems: 1 } },
    });
  });

  it('treats an unanswered problem as unknown rather than a misconception', () => {
    const prompt = buildFollowUpPrompt({
      ...wrongQuestion,
      selectedAnswer: 'わからない',
    }, '最初に何をすればよいですか？');

    expect(prompt).toContain('誤解があると決めつけず');
    expect(prompt).toContain('最初の一歩');
  });

  it('builds and parses a question-specific follow-up', () => {
    const prompt = buildFollowUpPrompt(wrongQuestion, 'なぜ両辺から3を引くの？');
    const result = parseFollowUpResult(JSON.stringify({
      answer: 'xだけを残すためです。',
      nextStep: '両辺に同じ数を足し引きする意味を確認しましょう。',
    }));

    expect(prompt).toContain('なぜ両辺から3を引くの？');
    expect(prompt).toContain('x = 3');
    expect(result.answer).toBe('xだけを残すためです。');
  });
});
