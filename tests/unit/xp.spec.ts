import {
  calculateLevelAndProgress,
  getTitleForLevel,
  getAvailableIcons,
  MAX_LEVEL,
  LEVEL_ICONS,
} from '../../src/lib/xp';

// xpForNext at level N = floor(2.2 * N^2) + 50
// Level 1 → 2 requires floor(2.2 * 1) + 50 = 52 XP
// Level 2 → 3 requires floor(2.2 * 4) + 50 = 58 XP

describe('calculateLevelAndProgress', () => {
  test('xp=0 → level 1, currentLevelXp=0, progressPercent=0', () => {
    const result = calculateLevelAndProgress(0);
    expect(result.level).toBe(1);
    expect(result.currentLevelXp).toBe(0);
    expect(result.progressPercent).toBe(0);
  });

  test('xp=0 → nextLevelXp=52 (floor(2.2*1)+50)', () => {
    const result = calculateLevelAndProgress(0);
    expect(result.nextLevelXp).toBe(52);
  });

  test('xp が閾値未満ではレベル1のまま', () => {
    const result = calculateLevelAndProgress(51);
    expect(result.level).toBe(1);
  });

  test('xp=52 でレベル2に上がる', () => {
    const result = calculateLevelAndProgress(52);
    expect(result.level).toBe(2);
    expect(result.currentLevelXp).toBe(0);
  });

  test('xp=52+58=110 でレベル3に上がる', () => {
    const result = calculateLevelAndProgress(110);
    expect(result.level).toBe(3);
  });

  test('progressPercent はレベル内の進捗率を正しく返す', () => {
    // レベル1→2 は 52XP 必要。26XP だと約50%
    const result = calculateLevelAndProgress(26);
    expect(result.level).toBe(1);
    expect(result.progressPercent).toBeCloseTo(50, 0);
  });

  test('progressPercent は 0〜100 の範囲内に収まる', () => {
    const result = calculateLevelAndProgress(25);
    expect(result.progressPercent).toBeGreaterThanOrEqual(0);
    expect(result.progressPercent).toBeLessThanOrEqual(100);
  });

  test('xp が非常に大きい場合は MAX_LEVEL (100) を返す', () => {
    const result = calculateLevelAndProgress(10_000_000);
    expect(result.level).toBe(MAX_LEVEL);
    expect(result.progressPercent).toBe(100);
    expect(result.nextLevelXp).toBe(0);
  });

  test('MAX_LEVEL 到達時は currentLevelXp=0', () => {
    const result = calculateLevelAndProgress(10_000_000);
    expect(result.currentLevelXp).toBe(0);
  });
});

describe('getTitleForLevel', () => {
  test.each([
    [1, '算数卒業生'],
    [5, '算数卒業生'],
    [9, '算数卒業生'],
    [10, '数学ビギナー'],
    [15, '数学ビギナー'],
    [19, '数学ビギナー'],
    [20, '計算の達人'],
    [29, '計算の達人'],
    [30, '論理の探求者'],
    [39, '論理の探求者'],
    [40, '数学のひらめき'],
    [49, '数学のひらめき'],
    [50, '芝浦の数理ハンター'],
    [59, '芝浦の数理ハンター'],
    [60, '数学の賢者'],
    [69, '数学の賢者'],
    [70, '数学マスター'],
    [79, '数学マスター'],
    [80, '数学の覇者'],
    [89, '数学の覇者'],
    [90, '次世代のオイラー'],
    [99, '次世代のオイラー'],
    [100, 'Grandmaster'],
  ] as const)('level %i → "%s"', (level, expected) => {
    expect(getTitleForLevel(level)).toBe(expected);
  });
});

describe('getAvailableIcons', () => {
  test('level 1 はアイコンを1つだけ返す', () => {
    const icons = getAvailableIcons(1);
    expect(icons).toHaveLength(1);
    expect(icons[0]).toBe('📐');
  });

  test('level 5 はアイコンを5つ返す', () => {
    const icons = getAvailableIcons(5);
    expect(icons).toHaveLength(5);
  });

  test('level 10 は10個のアイコンを返す', () => {
    const icons = getAvailableIcons(10);
    expect(icons).toHaveLength(10);
  });

  test('level が LEVEL_ICONS の長さを超えても全アイコンを返す（クランプ）', () => {
    const icons = getAvailableIcons(200);
    expect(icons).toHaveLength(LEVEL_ICONS.length);
  });

  test('LEVEL_ICONS は100個定義されている', () => {
    expect(LEVEL_ICONS).toHaveLength(100);
  });

  test('返されるアイコンは LEVEL_ICONS の先頭 N 件', () => {
    const icons = getAvailableIcons(3);
    expect(icons).toEqual(LEVEL_ICONS.slice(0, 3));
  });
});
