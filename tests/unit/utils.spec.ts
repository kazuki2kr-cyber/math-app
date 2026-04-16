import { parseOptions } from '../../src/lib/utils';

describe('parseOptions', () => {
  // --- 配列入力 ---
  test('文字列配列をそのまま返す', () => {
    expect(parseOptions(['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  test('数値配列を文字列配列に変換する', () => {
    expect(parseOptions([1, 2, 3])).toEqual(['1', '2', '3']);
  });

  test('空配列は空配列を返す', () => {
    expect(parseOptions([])).toEqual([]);
  });

  test('混合配列（数値・文字列）も文字列化する', () => {
    expect(parseOptions([1, 'two', 3])).toEqual(['1', 'two', '3']);
  });

  // --- JSON 文字列入力 ---
  test('JSON 配列文字列をパースして返す', () => {
    expect(parseOptions('["a", "b", "c"]')).toEqual(['a', 'b', 'c']);
  });

  test('JSON 数値配列文字列を文字列配列として返す', () => {
    expect(parseOptions('[1, 2, 3]')).toEqual(['1', '2', '3']);
  });

  test('JSON は配列でない場合は空配列を返す', () => {
    expect(parseOptions('{"key": "value"}')).toEqual([]);
  });

  // --- カンマ区切り文字列入力 ---
  test('カンマ区切り文字列を分割してトリムする', () => {
    expect(parseOptions('a, b, c')).toEqual(['a', 'b', 'c']);
  });

  test('スペースなしのカンマ区切りも処理する', () => {
    expect(parseOptions('x,y,z')).toEqual(['x', 'y', 'z']);
  });

  test('前後スペースをトリムする', () => {
    expect(parseOptions('  hello ,  world  ')).toEqual(['hello', 'world']);
  });

  test('不正 JSON はカンマ区切りにフォールバックする', () => {
    expect(parseOptions('{invalid}, b')).toEqual(['{invalid}', 'b']);
  });

  // --- エッジケース ---
  test('空文字列は空配列を返す', () => {
    expect(parseOptions('')).toEqual([]);
  });

  test('空白のみの文字列は空配列を返す', () => {
    expect(parseOptions('   ')).toEqual([]);
  });

  test('null は空配列を返す', () => {
    expect(parseOptions(null)).toEqual([]);
  });

  test('undefined は空配列を返す', () => {
    expect(parseOptions(undefined)).toEqual([]);
  });

  test('数値を渡すと空配列を返す', () => {
    expect(parseOptions(42)).toEqual([]);
  });

  test('単一要素のカンマ区切り文字列', () => {
    expect(parseOptions('only')).toEqual(['only']);
  });
});
