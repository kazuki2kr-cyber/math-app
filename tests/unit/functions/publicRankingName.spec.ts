import { publicRankingName } from '../../../functions/src/publicRankingName';

it('keeps display names and replaces missing names or email addresses in rankings', () => {
  expect(publicRankingName(' 市川 ')).toBe('市川');
  expect(publicRankingName('')).toBe('利用者');
  expect(publicRankingName(undefined)).toBe('利用者');
  expect(publicRankingName('student@example.org')).toBe('利用者');
});
