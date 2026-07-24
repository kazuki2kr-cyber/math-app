import { getMathDashboardUnits, isMathSubjectValue } from '@/lib/dashboardUnits';

describe('math dashboard unit filtering', () => {
  test('数学の互換 subject 値だけを数学として扱う', () => {
    expect(isMathSubjectValue(undefined)).toBe(true);
    expect(isMathSubjectValue('math')).toBe(true);
    expect(isMathSubjectValue('数学')).toBe(true);
    expect(isMathSubjectValue('謨ｰ蟄ｦ')).toBe(true);
    expect(isMathSubjectValue('kanji')).toBe(false);
    expect(isMathSubjectValue('漢字')).toBe(false);
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
