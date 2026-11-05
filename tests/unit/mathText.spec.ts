import {
  getMathSymbolGuides,
  normalizeMathTextForDisplay,
  splitMathText,
} from '@/lib/mathText';
import katex from 'katex';

describe('math text display normalization', () => {
  const cases = String.raw`\begin{cases}8x+3y=2000 \\ \frac{7}{10}x \times 10 + \frac{1}{2}y \times 4=1700\end{cases}`;

  it.each([
    ['brackets with spaces', `\\[ ${cases} \\]`, 'block'],
    ['brackets with newlines', `\\[\n${cases}\n\\]`, 'block'],
    ['dollars with newlines', `$$\n${cases}\n$$`, 'block'],
    ['inline parentheses', `\\(${cases}\\)`, 'inline'],
    ['inline dollars', `$${cases}$`, 'inline'],
    ['bare environment', cases, 'block'],
    ['equation before environment', `\\[ f(x) = ${cases} \\]`, 'block'],
  ])('renders %s without introducing nested delimiters', (_name, input, type) => {
    const normalized = normalizeMathTextForDisplay(`答案：${input}\n以上。`);
    expect(normalizeMathTextForDisplay(normalized)).toBe(normalized);
    const parts = splitMathText(normalized);
    expect(parts).toHaveLength(3);
    expect(parts[0]).toEqual({ type: 'text', content: '答案：' });
    expect(parts[1].type).toBe(type);
    expect(parts[1].content).toContain(cases);
    expect(parts[2]).toEqual({ type: 'text', content: '\n以上。' });
    expect(() => katex.renderToString(parts[1].content, {
      displayMode: type === 'block', throwOnError: true,
    })).not.toThrow();
  });

  it('preserves separate environments, prose, and an intentionally wrong equation', () => {
    const input = `\\[\n${cases}\n\\]\n途中式：$3y=250$\n$$\nx=220\n$$`;
    const normalized = normalizeMathTextForDisplay(input);
    expect(normalized).toBe(input);
    expect(splitMathText(normalized).filter(part => part.type !== 'text').map(part => part.type))
      .toEqual(['block', 'inline', 'block']);
  });

  it('cleans nested inline markers in a bare aligned environment before splitting', () => {
    const input = String.raw`\begin{aligned}\(3x\)&=9\\x&=3\end{aligned}`;
    const normalized = normalizeMathTextForDisplay(input);
    expect(normalizeMathTextForDisplay(normalized)).toBe(normalized);
    const parts = splitMathText(normalized);
    expect(parts).toHaveLength(1);
    expect(() => katex.renderToString(parts[0].content, { throwOnError: true })).not.toThrow();
  });

  it('leaves incomplete math untouched instead of guessing missing symbols', () => {
    const input = String.raw`答案：\[\begin{cases}x`;
    expect(normalizeMathTextForDisplay(input)).toBe(input);
    expect(splitMathText(input)).toEqual([{ type: 'text', content: input }]);
  });

  it('replaces bare LaTeX commands in Japanese prose instead of exposing command text', () => {
    expect(normalizeMathTextForDisplay('この \\times はかけ算です。')).toBe('この × はかけ算です。');
    expect(normalizeMathTextForDisplay('6 \\div 2 は3です。')).not.toContain('\\div');
  });

  it('keeps delimited LaTeX intact so KaTeX can render it', () => {
    expect(normalizeMathTextForDisplay('式は \\(3\\times n\\) です。'))
      .toBe('式は \\(3\\times n\\) です。');
    expect(normalizeMathTextForDisplay('次の方程式を解きなさい。 \\(3(x+3)=8x+19\\)'))
      .toBe('次の方程式を解きなさい。 \\(3(x+3)=8x+19\\)');
  });

  it('repairs common escaped-control-character damage and removes markdown noise', () => {
    expect(normalizeMathTextForDisplay('**分数** `\\frac{1}{2}`'))
      .toBe('分数 \\(\\frac{1}{2}\\)');
    expect(normalizeMathTextForDisplay(`値は ${String.fromCharCode(12)}rac{1}{2} です。`))
      .toContain('\\frac{1}{2}');
  });

  it('renders an aligned model answer as one block without nested inline delimiters', () => {
    const aligned = '\\begin{aligned} \\(3(x+3)\\) &\\(=8x+19\\)\\\\ x &=-2 \\end{aligned}';
    const normalized = normalizeMathTextForDisplay(aligned);

    expect(normalized).toBe('\\[\\begin{aligned} 3(x+3) &=8x+19\\\\ x &=-2 \\end{aligned}\\]');
    expect(normalized).not.toContain('\\(');
    expect(normalizeMathTextForDisplay('\\[\\begin{aligned}x&=1\\end{aligned}\\]'))
      .toBe('\\[\\begin{aligned}x&=1\\end{aligned}\\]');
  });

  it('returns short Japanese guides only for symbols that appear', () => {
    expect(getMathSymbolGuides('式は \\(3\\times n\\)、x\\neq0\\) です。')).toEqual([
      { symbol: '×', label: 'かける（かけ算）' },
      { symbol: '≠', label: '等しくない' },
    ]);
  });
});
