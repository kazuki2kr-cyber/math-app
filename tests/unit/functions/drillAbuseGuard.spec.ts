import {
  applyDailyXpCap,
  DRILL_GUARD_POLICY,
  evaluateDrillGuard,
  getRepeatedUnitXpRate,
  normalizeDrillGuardState,
  shouldSampleIntegrityEvent,
} from '../../../functions/src/drillAbuseGuard';

const emptyState = {
  logicalDate: '2026-09-24',
  acceptedAttempts: 0,
  earnedXp: 0,
  consecutiveBurstCount: 0,
  lastAcceptedAtMs: null,
  lastSampledAtMs: null,
};

describe('drillAbuseGuard', () => {
  test('通常の演習は許可する', () => {
    expect(evaluateDrillGuard({
      state: emptyState,
      nowMs: 1_000_000,
      timeSec: 90,
      answeredCount: 10,
    }).blocked).toBe(false);
  });

  test('人間には不可能な平均解答時間を拒否する', () => {
    const result = evaluateDrillGuard({
      state: emptyState,
      nowMs: 1_000_000,
      timeSec: 1,
      answeredCount: 10,
    });
    expect(result.blocked).toBe(true);
    expect(result.blockCode).toBe('impossible_speed');
  });

  test('5秒未満の連続提出を拒否する', () => {
    const result = evaluateDrillGuard({
      state: { ...emptyState, lastAcceptedAtMs: 998_000 },
      nowMs: 1_000_000,
      timeSec: 60,
      answeredCount: 10,
    });
    expect(result.blocked).toBe(true);
    expect(result.blockCode).toBe('submission_burst');
  });

  test('15秒未満の提出が3回続いたら拒否する', () => {
    const result = evaluateDrillGuard({
      state: { ...emptyState, lastAcceptedAtMs: 990_000, consecutiveBurstCount: 2 },
      nowMs: 1_000_000,
      timeSec: 60,
      answeredCount: 10,
    });
    expect(result.blocked).toBe(true);
    expect(result.blockCode).toBe('submission_burst');
  });

  test('日次演習上限を拒否する', () => {
    const result = evaluateDrillGuard({
      state: { ...emptyState, acceptedAttempts: DRILL_GUARD_POLICY.dailyAttemptLimit },
      nowMs: 1_000_000,
      timeSec: 60,
      answeredCount: 10,
    });
    expect(result.blockCode).toBe('daily_attempt_limit');
  });

  test('日次XP上限を超えないよう付与量を切り詰める', () => {
    expect(applyDailyXpCap(200, 4900, false)).toEqual({ awardedXp: 100, capped: true });
    expect(applyDailyXpCap(200, 100, true)).toEqual({ awardedXp: 0, capped: true });
  });

  test('21回目以降は同一単元からXPを付与しない', () => {
    expect(getRepeatedUnitXpRate(1)).toBe(1);
    expect(getRepeatedUnitXpRate(11)).toBe(0.1);
    expect(getRepeatedUnitXpRate(21)).toBe(0);
  });

  test('日付変更時は日次カウンタだけを初期化する', () => {
    const normalized = normalizeDrillGuardState({
      logicalDate: '2026-09-23',
      acceptedAttempts: 140,
      earnedXp: 4900,
      lastAcceptedAt: '2026-09-23T12:00:00.000Z',
    }, '2026-09-24', (value) => Date.parse(String(value)) || null);
    expect(normalized.acceptedAttempts).toBe(0);
    expect(normalized.earnedXp).toBe(0);
    expect(normalized.lastAcceptedAtMs).toBe(Date.parse('2026-09-23T12:00:00.000Z'));
  });

  test('インテグリティイベントは15分ごとにサンプリングする', () => {
    expect(shouldSampleIntegrityEvent(null, 1_000_000)).toBe(true);
    expect(shouldSampleIntegrityEvent(900_000, 1_000_000)).toBe(false);
    expect(shouldSampleIntegrityEvent(0, 15 * 60 * 1000)).toBe(true);
  });
});
