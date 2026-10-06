import { CLOSING_KANJI_SEASON, getClosingSeasonBadgeFields, getKanjiSeasonBadges, KANJI_SEASONS } from '../../src/lib/kanjiSeasons';

describe('Season 3 archive and certification', () => {
  const archivedAt = '2026-10-06T00:00:00.000Z';

  test('archives Season 3 separately from Seasons 1 and 2', () => {
    expect(KANJI_SEASONS.map((season) => season.archiveDocumentId)).toEqual([
      'kanjiSeason3', 'kanjiSeason2', 'kanjiSeason1',
    ]);
    expect(CLOSING_KANJI_SEASON.certificationLevel).toBe(300);
  });

  test('awards Lv.300 but not Lv.299, including archived user snapshots', () => {
    expect(getClosingSeasonBadgeFields({ kanjiLevel: 299, kanjiXp: 99999 }, archivedAt)).toEqual({});

    const fields = getClosingSeasonBadgeFields({ level: 300, xp: 59800 }, archivedAt);
    expect(fields['kanjiSeasonBadges.season3']).toMatchObject({
      seasonId: 'season3', seasonNumber: 3, level: 300, xp: 59800,
      badgeImageUrl: '/images/kanji-season3-badge.png', awardedAt: archivedAt,
    });
  });

  test('keeps older badges visible when Season 3 is awarded', () => {
    const season3 = getClosingSeasonBadgeFields({ level: 300, xp: 59800 }, archivedAt)['kanjiSeasonBadges.season3'];
    const badges = getKanjiSeasonBadges({ kanjiSeasonBadges: {
      season1: { seasonId: 'season1', badgeImageUrl: '/images/kanji-season1-badge.png' },
      season2: { seasonId: 'season2', badgeImageUrl: '/images/kanji-season2-badge.png' },
      season3,
    } });
    expect(badges.map((badge) => badge.seasonId)).toEqual(['season3', 'season2', 'season1']);
  });
});
