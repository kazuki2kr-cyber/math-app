import {
  calculateMathLevelData,
  chunkArray,
  syncOverallLeaderboardEntry,
} from '../../../functions/src/adminActions';

describe('adminActions pure helpers', () => {
  test('calculateMathLevelData computes level 1, mid levels, and level cap correctly', () => {
    expect(calculateMathLevelData(0)).toEqual({
      level: 1,
      title: '算数卒業生',
      currentLevelXp: 0,
      nextLevelXp: 52,
      progressPercent: 0,
    });

    const lv2 = calculateMathLevelData(52);
    expect(lv2.level).toBe(2);
    expect(lv2.title).toBe('算数卒業生');
    expect(lv2.currentLevelXp).toBe(0);

    const negative = calculateMathLevelData(-100);
    expect(negative.level).toBe(1);
    expect(negative.currentLevelXp).toBe(0);

    const capped = calculateMathLevelData(10_000_000);
    expect(capped.level).toBe(100);
    expect(capped.title).toBe('Grandmaster');
    expect(capped.progressPercent).toBe(100);
  });

  test('syncOverallLeaderboardEntry updates existing user, masks emails, and sorts top 40 by score then xp', () => {
    const existing = Array.from({ length: 42 }, (_, idx) => ({
      uid: `u${idx}`,
      name: idx === 0 ? 'secret@shibaurafzk.com' : `User ${idx}`,
      totalScore: 500 - idx,
      xp: 1000,
      icon: '📐',
      level: 5,
    }));

    const updated = syncOverallLeaderboardEntry(existing, {
      uid: 'u5',
      name: 'alice@shibaurafzk.com',
      totalScore: 600,
      xp: 1200,
      icon: '🚀',
      level: 12,
    });

    expect(updated).toHaveLength(40);
    expect(updated[0]).toEqual({
      uid: 'u5',
      name: '利用者',
      totalScore: 600,
      xp: 1200,
      icon: '🚀',
      level: 12,
    });
    expect(updated.find((entry) => entry.uid === 'u0')?.name).toBe('利用者');
  });

  test('chunkArray splits arrays larger than 500 items into safe Firestore batch chunks of 400', () => {
    const items = Array.from({ length: 1050 }, (_, idx) => idx);
    const chunks = chunkArray(items, 400);

    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(400);
    expect(chunks[1]).toHaveLength(400);
    expect(chunks[2]).toHaveLength(250);
  });
});
