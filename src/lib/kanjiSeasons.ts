export interface KanjiSeasonBadge {
  seasonId: string;
  seasonNumber: number;
  label: string;
  title: string;
  awardedAt?: string;
  level: number;
  xp: number;
  badgeImageUrl: string;
}

export interface KanjiSeasonArchive {
  seasonId: string;
  seasonNumber: number;
  title: string;
  archivedAt: string;
  badgeImageUrl: string;
  certificationLevel: number;
  topXpRankings: any[];
  topBattleRankings: any[];
  certifiedUsers?: {
    uid: string;
    name: string;
    xp: number;
    level: number;
    totalScore: number;
    badgeImageUrl: string;
  }[];
  resetCompletedAt?: string;
}

export const KANJI_SEASONS = [
  {
    id: 'season3',
    number: 3,
    title: '漢字 Season 3',
    certificationLevel: 300,
    badgeImageUrl: '/images/kanji-season3-badge.png',
    archiveDocumentId: 'kanjiSeason3',
  },
  {
    id: 'season2',
    number: 2,
    title: '漢字 Season 2',
    certificationLevel: 200,
    badgeImageUrl: '/images/kanji-season2-badge.png',
    archiveDocumentId: 'kanjiSeason2',
  },
  {
    id: 'season1',
    number: 1,
    title: '漢字 Season 1',
    certificationLevel: 100,
    badgeImageUrl: '/images/kanji-season1-badge.png',
    archiveDocumentId: 'kanjiSeason1',
  },
] as const;

// Season 3 is the season to close. Season 4 begins after its archive and reset complete.
export const CLOSING_KANJI_SEASON = KANJI_SEASONS[0];
export const NEXT_KANJI_SEASON_NUMBER = 4;

export function getClosingSeasonBadgeFields(user: { kanjiLevel?: number; level?: number; kanjiXp?: number; xp?: number }, archivedAt: string): Record<string, KanjiSeasonBadge> {
  const level = Number(user.kanjiLevel ?? user.level ?? 1);
  if (level < CLOSING_KANJI_SEASON.certificationLevel) return {};

  const badge: KanjiSeasonBadge = {
    seasonId: CLOSING_KANJI_SEASON.id,
    seasonNumber: CLOSING_KANJI_SEASON.number,
    label: `Season ${CLOSING_KANJI_SEASON.number} 認証`,
    title: '万葉の匠',
    awardedAt: archivedAt,
    level,
    xp: Number(user.kanjiXp ?? user.xp ?? 0),
    badgeImageUrl: CLOSING_KANJI_SEASON.badgeImageUrl,
  };

  return { [`kanjiSeasonBadges.${CLOSING_KANJI_SEASON.id}`]: badge };
}

export function getKanjiSeasonBadges(data: any): KanjiSeasonBadge[] {
  const storedBadges = Array.isArray(data?.badges)
    ? data.badges as KanjiSeasonBadge[]
    : data?.kanjiSeasonBadges && typeof data.kanjiSeasonBadges === 'object'
      ? Object.values(data.kanjiSeasonBadges) as KanjiSeasonBadge[]
      : [];

  const badges = [...storedBadges];
  if (!badges.some((badge) => badge?.seasonId === 'season1') && (data?.kanjiSeason1Badge || data?.kanjiSeason1Certified === true || data?.certified === true)) {
    badges.push(data?.kanjiSeason1Badge || {
      seasonId: 'season1',
      seasonNumber: 1,
      label: 'Season 1 認証',
      title: '万葉の匠',
      level: 100,
      xp: 0,
      badgeImageUrl: '/images/kanji-season1-badge.png',
    });
  }

  return badges
    .filter((badge) => badge?.seasonId && badge?.badgeImageUrl)
    .map((badge) => ({
      ...badge,
      seasonNumber: Number(badge.seasonNumber || String(badge.seasonId).replace(/\D/g, '') || 0),
    }))
    .sort((a, b) => b.seasonNumber - a.seasonNumber);
}
