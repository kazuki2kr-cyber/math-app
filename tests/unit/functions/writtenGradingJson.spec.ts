import { extractJsonObject } from '../../../functions/src/writtenGradingJson';

describe('extractJsonObject', () => {
  test('preserves already escaped LaTeX commands without turning \\times into a tab escape', () => {
    const raw = JSON.stringify({
      feedback: '文字式は \\(3\\times n\\) と書くのが一般的です。',
    });

    const parsed = extractJsonObject(raw);

    expect(parsed.feedback).toBe('文字式は \\(3\\times n\\) と書くのが一般的です。');
    expect(parsed.feedback).toContain('\\times');
    expect(parsed.feedback).not.toContain('\t');
  });

  test('repairs Gemini JSON that contains unescaped inline LaTeX delimiters and commands', () => {
    const raw = '{"feedback":"文字式は \\(3\\times n\\) と書くのが一般的です。"}';

    const parsed = extractJsonObject(raw);

    expect(parsed.feedback).toBe('文字式は \\(3\\times n\\) と書くのが一般的です。');
  });

  test('repairs unescaped \\frac and \\sqrt commands', () => {
    const raw = '{"feedback":"\\(\\frac{1}{2}+\\sqrt{4}=3\\)"}';

    const parsed = extractJsonObject(raw);

    expect(parsed.feedback).toBe('\\(\\frac{1}{2}+\\sqrt{4}=3\\)');
  });

  test('extracts a JSON object from surrounding model text', () => {
    const raw = 'Here is the result:\n{"feedback":"\\(a\\div b\\)"}\nThanks';

    const parsed = extractJsonObject(raw);

    expect(parsed.feedback).toBe('\\(a\\div b\\)');
  });
});
