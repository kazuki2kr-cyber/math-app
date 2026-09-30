export type MathSubject = '数学甲' | '数学乙';
type ImportSubjectMetadata = { subject: MathSubject; baseSubject: MathSubject; mode: 'solo' };

export function normalizeMathSubject(value?: string): MathSubject | null {
  // mojibake-ok: legacy imported math subject values are kept for compatibility.
  if (!value || value === 'math' || value === '数学' || value === '謨ｰ蟄ｦ' || value === '数学甲') return '数学甲';
  if (value === '数学乙') return '数学乙';
  return null;
}

export function getImportSubjectMetadata(importSubject: string): ImportSubjectMetadata {
  switch (importSubject) {
    case 'math':
      return { subject: '数学甲', baseSubject: '数学甲', mode: 'solo' };
    case 'math_b':
      return { subject: '数学乙', baseSubject: '数学乙', mode: 'solo' };
    default:
      throw new Error('対象教科が不正です。');
  }
}

export function getImportedUnitId(subject: MathSubject, csvUnitId: string): string {
  return subject === '数学乙' ? `数学乙__${csvUnitId}` : csvUnitId;
}
