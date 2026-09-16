import { canManageUnitQuestionAvailability } from '../../../functions/src/unitQuestionAvailability';

describe('unit question availability authorization', () => {
  test('管理者カスタムクレームだけを許可する', () => {
    expect(canManageUnitQuestionAvailability({ admin: true })).toBe(true);
    expect(canManageUnitQuestionAvailability({ admin: false })).toBe(false);
    expect(canManageUnitQuestionAvailability({ appAccess: true })).toBe(false);
    expect(canManageUnitQuestionAvailability(undefined)).toBe(false);
  });
});
