import { getMathDashboardUnits, isMathSubjectValue } from '@/lib/dashboardUnits';
import { getImportSubjectMetadata, getImportedUnitId, normalizeMathSubject } from '@/lib/mathSubjects';

describe('math dashboard unit filtering', () => {
  test('公開中の問題が0問になった単元を非表示にする', () => {
    expect(getMathDashboardUnits([
      { id: 'empty', subject: '数学', activeQuestionCount: 0 },
      { id: 'legacy', subject: '数学' },
    ])).toEqual([{ id: 'legacy', subject: '数学' }]);
  });

  test('数学の互換 subject 値だけを数学として扱う', () => {
    expect(isMathSubjectValue(undefined)).toBe(true);
    expect(isMathSubjectValue('math')).toBe(true);
    expect(isMathSubjectValue('数学')).toBe(true);
    expect(isMathSubjectValue('数学甲')).toBe(true);
    expect(isMathSubjectValue('数学乙')).toBe(true);
    expect(isMathSubjectValue('謨ｰ蟄ｦ')).toBe(true);
    expect(isMathSubjectValue('kanji')).toBe(false);
    expect(isMathSubjectValue('漢字')).toBe(false);
  });

  test('数学甲の旧データと数学乙を別教科として表示し、単元IDを分離する', () => {
    const units = getMathDashboardUnits([
      { id: '4.証明', subject: '数学', category: '3.図形の性質と合同' },
      { id: '数学乙__4.証明', subject: '数学乙', category: '3.図形の性質と合同' },
      { id: 'kanji', subject: '漢字' },
    ]);
    expect(units.filter(unit => normalizeMathSubject(unit.subject) === '数学甲').map(unit => unit.id)).toEqual(['4.証明']);
    expect(units.filter(unit => normalizeMathSubject(unit.subject) === '数学乙').map(unit => unit.id)).toEqual(['数学乙__4.証明']);
    expect(getImportedUnitId('数学甲', '4.証明')).toBe('4.証明');
    expect(getImportedUnitId('数学乙', '4.証明')).toBe('数学乙__4.証明');
    expect(getImportSubjectMetadata('math_b')).toMatchObject({ subject: '数学乙' });
    expect(() => getImportSubjectMetadata('math_b_written')).toThrow();
  });

  test('漢字単元を通常版の単元・分野候補から除外する', () => {
    const units = [
      { id: 'math-1', subject: '数学', category: '1.正の数と負の数' },
      { id: 'legacy-math', category: '2.文字式' },
      { id: 'kanji-1', subject: 'kanji' },
      { id: 'kanji-2', subject: '漢字', category: 'その他' },
    ];

    const mathUnits = getMathDashboardUnits(units);
    const categories = mathUnits.map(unit => unit.category || 'その他');

    expect(mathUnits.map(unit => unit.id)).toEqual(['math-1', 'legacy-math']);
    expect(categories).toEqual(['1.正の数と負の数', '2.文字式']);
    expect(categories).not.toContain('その他');
  });

  test('対戦単元と非公開の記述式イベントも通常版から除外する', () => {
    const units = [
      { id: 'solo', subject: '数学' },
      { id: 'battle-mode', subject: '数学', mode: 'battle' },
      { id: 'battle-subject', subject: '数学対戦' },
      {
        id: 'inactive-written',
        subject: '数学',
        drillType: 'written' as const,
        eventStatus: 'inactive',
      },
    ];

    expect(getMathDashboardUnits(units).map(unit => unit.id)).toEqual(['solo']);
  });
});
