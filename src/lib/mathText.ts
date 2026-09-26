export type MathSymbolGuide = {
  symbol: string;
  label: string;
};

const DELIMITED_MATH_PATTERN = /(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$[^$\n]+?\$)/g;

const SYMBOL_GUIDES: Array<MathSymbolGuide & { pattern: RegExp }> = [
  { symbol: '×', label: 'かける（かけ算）', pattern: /\\times(?![A-Za-z])|×/ },
  { symbol: '÷', label: 'わる（わり算）', pattern: /\\div(?![A-Za-z])|÷/ },
  { symbol: '・', label: 'かけ算を表す点', pattern: /\\cdot(?![A-Za-z])|·/ },
  { symbol: '≤', label: '以下', pattern: /\\leq?(?![A-Za-z])|≤/ },
  { symbol: '≥', label: '以上', pattern: /\\geq?(?![A-Za-z])|≥/ },
  { symbol: '≠', label: '等しくない', pattern: /\\ne(?:q)?(?![A-Za-z])|≠/ },
  { symbol: '√', label: '平方根', pattern: /\\sqrt(?![A-Za-z])|√/ },
  { symbol: 'π', label: '円周率', pattern: /\\pi(?![A-Za-z])|π/ },
];

function normalizeOutsideMath(text: string) {
  return text
    .replace(/```(?:latex|tex|math)?\s*/gi, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*|__/g, '')
    .replace(/\\frac\{[^{}]+\}\{[^{}]+\}/g, (match) => `\\(${match}\\)`)
    .replace(/\\sqrt\{[^{}]+\}/g, (match) => `\\(${match}\\)`)
    .replace(/\\times(?![A-Za-z])/g, '×')
    .replace(/\\div(?![A-Za-z])/g, '÷')
    .replace(/\\cdot(?![A-Za-z])/g, '・')
    .replace(/\\leq?(?![A-Za-z])/g, '≤')
    .replace(/\\geq?(?![A-Za-z])/g, '≥')
    .replace(/\\ne(?:q)?(?![A-Za-z])/g, '≠')
    .replace(/\\pi(?![A-Za-z])/g, 'π')
    .replace(/\\left(?![A-Za-z])|\\right(?![A-Za-z])/g, '')
    .replace(/\\text\{([^{}]*)\}/g, '$1');
}

export function normalizeMathTextForDisplay(text: string) {
  if (!text) return text;

  const normalized = text
    .replace(/\r\n?/g, '\n')
    .replace(/\u000crac/g, '\\frac')
    .replace(/\u000crt/g, '\\sqrt')
    .replace(/\u000c/g, '\\f')
    .replace(/\\{2,}(?=(?:\(|\)|\[|\]|frac\b|sqrt\b|times\b|div\b|cdot\b|pi\b|leq?\b|geq?\b|ne(?:q)?\b|left\b|right\b|text\b))/g, '\\');

  const parts = normalized.split(DELIMITED_MATH_PATTERN);
  const formatted = parts.map((part, index) => (
    index % 2 === 1 ? part : normalizeOutsideMath(part)
  )).join('');

  return formatted.replace(
    /((?:[0-9a-zA-Zπ]+|[+\-−×÷=*/^().,]|\s){3,}(?:=|×|÷|\+|\-|\^)(?:[0-9a-zA-Zπ]+|[+\-−×÷=*/^().,]|\s){2,})/g,
    (match) => {
      const trimmed = match.trim();
      if (!trimmed || !/[0-9a-zA-Zπ]/.test(trimmed)) return match;
      const leading = match.match(/^\s*/)?.[0] || '';
      const trailing = match.match(/\s*$/)?.[0] || '';
      const latex = trimmed
        .replace(/π/g, '\\pi')
        .replace(/×/g, '\\times')
        .replace(/÷/g, '\\div')
        .replace(/−/g, '-');
      return `${leading}\\(${latex}\\)${trailing}`;
    },
  );
}

export function getMathSymbolGuides(text: string): MathSymbolGuide[] {
  if (!text) return [];
  return SYMBOL_GUIDES
    .filter(({ pattern }) => pattern.test(text))
    .map(({ symbol, label }) => ({ symbol, label }));
}
