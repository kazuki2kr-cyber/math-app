import {
  getMathSymbolGuides,
  normalizeMathTextForDisplay,
} from '@/lib/mathText';

describe('math text display normalization', () => {
  it('replaces bare LaTeX commands in Japanese prose instead of exposing command text', () => {
    expect(normalizeMathTextForDisplay('この \\times はかけ算です。')).toBe('この × はかけ算です。');
    expect(normalizeMathTextForDisplay('6 \\div 2 は3です。')).not.toContain('\\div');
  });

  it('keeps delimited LaTeX intact so KaTeX can render it', () => {
    expect(normalizeMathTextForDisplay('式は \\(3\\times n\\) です。'))
      .toBe('式は \\(3\\times n\\) です。');
  });

  it('repairs common escaped-control-character damage and removes markdown noise', () => {
    expect(normalizeMathTextForDisplay('**分数** `\\frac{1}{2}`'))
      .toBe('分数 \\(\\frac{1}{2}\\)');
    expect(normalizeMathTextForDisplay(`値は ${String.fromCharCode(12)}rac{1}{2} です。`))
      .toContain('\\frac{1}{2}');
  });

  it('returns short Japanese guides only for symbols that appear', () => {
    expect(getMathSymbolGuides('式は \\(3\\times n\\)、x\\neq0\\) です。')).toEqual([
      { symbol: '×', label: 'かける（かけ算）' },
      { symbol: '≠', label: '等しくない' },
    ]);
  });
});
