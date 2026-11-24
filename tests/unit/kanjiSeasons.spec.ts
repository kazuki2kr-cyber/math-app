import {
  CLOSING_KANJI_SEASON,
  getClosingSeasonBadgeFields,
  getKanjiSeasonBadges,
  getPublicKanjiRankingName,
  hasActiveKanjiSeasonActivity,
  KANJI_SEASONS,
  NEXT_KANJI_SEASON_NUMBER,
} from '../../src/lib/kanjiSeasons';

describe('Season 4 archive and certification', () => {
  const archivedAt = '2026-11-24T00:00:00.000Z';

  test('archives Season 4 separately from Seasons 1, 2, and 3', () => {
    expect(KANJI_SEASONS.map((season) => season.archiveDocumentId)).toEqual([
      'kanjiSeason4', 'kanjiSeason3', 'kanjiSeason2', 'kanjiSeason1',
    ]);
    expect(CLOSING_KANJI_SEASON.certificationLevel).toBe(400);
    expect(NEXT_KANJI_SEASON_NUMBER).toBe(5);
  });

  test('awards Lv.400 but not Lv.399, including archived user snapshots', () => {
    expect(getClosingSeasonBadgeFields({ kanjiLevel: 399, kanjiXp: 99999 }, archivedAt)).toEqual({});

    const fields = getClosingSeasonBadgeFields({ level: 400, xp: 79800 }, archivedAt);
    expect(fields['kanjiSeasonBadges.season4']).toMatchObject({
      seasonId: 'season4',
      seasonNumber: 4,
      level: 400,
      xp: 79800,
      badgeImageUrl: '/images/kanji-season4-badge.png',
      awardedAt: archivedAt,
    });
  });

  test('keeps older badges visible when Season 4 is awarded', () => {
    const season4 = getClosingSeasonBadgeFields({ level: 400, xp: 79800 }, archivedAt)['kanjiSeasonBadges.season4'];
    const badges = getKanjiSeasonBadges({
      kanjiSeasonBadges: {
        season1: { seasonId: 'season1', badgeImageUrl: '/images/kanji-season1-badge.png' },
        season2: { seasonId: 'season2', badgeImageUrl: '/images/kanji-season2-badge.png' },
        season3: { seasonId: 'season3', badgeImageUrl: '/images/kanji-season3-badge.png' },
        season4,
      },
    });
    expect(badges.map((badge) => badge.seasonId)).toEqual(['season4', 'season3', 'season2', 'season1']);
  });

  test('treats post-reset zero baselines as inactive and detects real drill or battle activity', () => {
    expect(hasActiveKanjiSeasonActivity(null)).toBe(false);
    expect(hasActiveKanjiSeasonActivity({
      kanjiXp: 0,
      kanjiLevel: 1,
      kanjiTotalScore: 0,
      kanjiBattleStats: { wins: 0, xp: 0, totalBattles: 0 },
      kanjiBattleWins: 0,
      kanjiBattleXp: 0,
    })).toBe(false);

    expect(hasActiveKanjiSeasonActivity({ kanjiXp: 20, kanjiLevel: 1 })).toBe(true);
    expect(hasActiveKanjiSeasonActivity({ kanjiTotalScore: 100 })).toBe(true);
    expect(hasActiveKanjiSeasonActivity({ kanjiUnitStats: { '3級第6回': { maxScore: 80 } } })).toBe(true);
    expect(hasActiveKanjiSeasonActivity({ kanjiBattleStats: { wins: 0, xp: 35, totalBattles: 1 } })).toBe(true);
    expect(hasActiveKanjiSeasonActivity({ kanjiBattleStats: { wins: 0, xp: 0, totalBattles: 1 } })).toBe(true);
    expect(hasActiveKanjiSeasonActivity({ kanjiBattleXp: 50 })).toBe(true);
  });

  test('masks email-like names when publishing kanji archive rankings', () => {
    expect(getPublicKanjiRankingName({ displayName: '漢字太郎', name: '別名' })).toBe('漢字太郎');
    expect(getPublicKanjiRankingName({ displayName: '', name: '漢検花子' })).toBe('漢検花子');
    expect(getPublicKanjiRankingName({ displayName: 'student@shibaurafzk.com', name: '生徒A' })).toBe('生徒A');
    expect(getPublicKanjiRankingName({ displayName: 'student@shibaurafzk.com', email: 'student@shibaurafzk.com' })).toBe('利用者');
    expect(getPublicKanjiRankingName({})).toBe('利用者');
  });
});
