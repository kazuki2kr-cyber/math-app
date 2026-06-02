export const MAX_LEVEL = 100;
export const LEVEL_XP_CAP_LEVEL = 40;

export function getXpForNextLevel(level: number): number {
  const cappedLevel = Math.min(level, LEVEL_XP_CAP_LEVEL);
  return Math.floor(2.2 * Math.pow(cappedLevel, 2)) + 50;
}

// Calculate Level based on total XP.
export function calculateLevelAndProgress(totalXp: number): {
  level: number;
  currentLevelXp: number;
  nextLevelXp: number;
  progressPercent: number;
} {
  let level = 1;
  let accumulatedXp = 0;

  while (level < MAX_LEVEL) {
    // Level-up XP follows the quadratic curve until level 40, then stays flat.
    const xpForNext = getXpForNextLevel(level);

    if (totalXp >= accumulatedXp + xpForNext) {
      accumulatedXp += xpForNext;
      level++;
    } else {
      const xpIntoCurrentLevel = totalXp - accumulatedXp;
      const progressPercent = Math.min(100, Math.max(0, (xpIntoCurrentLevel / xpForNext) * 100));
      return { level, currentLevelXp: xpIntoCurrentLevel, nextLevelXp: xpForNext, progressPercent };
    }
  }

  return { level: MAX_LEVEL, currentLevelXp: 0, nextLevelXp: 0, progressPercent: 100 };
}

export function getTitleForLevel(level: number): string {
  if (level >= 100) return 'Grandmaster';
  if (level >= 90) return '次世代のオイラー';
  if (level >= 80) return '数学の覇者';
  if (level >= 70) return '数学マスター';
  if (level >= 60) return '数学の賢者';
  if (level >= 50) return '芝浦の数理ハンター';
  if (level >= 40) return '数学のひらめき';
  if (level >= 30) return '論理の探求者';
  if (level >= 20) return '計算の達人';
  if (level >= 10) return '数学ビギナー';
  return '算数卒業生';
}

export const LEVEL_ICONS: string[] = [
  /* 1-10 */   '📐', '✏️', '📏', '📗', '📘', '🎒', '🧮', '🖋️', '🔍', '📖',
  /* 11-20 */  '🕰️', '🧭', '⚙️', '🔧', '💡', '🔋', '🖥️', '💻', '⌨️', '🖱️',
  /* 21-30 */  '📡', '🔭', '🔬', '🧪', '🧫', '🧬', '📊', '📉', '📈', '📅',
  /* 31-40 */  '🌱', '🌿', '🍀', '🍎', '🍏', '🌍', '🌎', '🌏', '🌑', '🌒',
  /* 41-50 */  '🌓', '🌔', '🌕', '🌖', '🌗', '🌘', '☀️', '🌤️', '⛅', '🌥️',
  /* 51-60 */  '🌩️', '⚡', '❄️', '🔥', '💧', '🌊', '🌬️', '🌀', '🌈', '☄️',
  /* 61-70 */  '⭐', '🌟', '✨', '💫', '🔮', '🪄', '🧿', '🪬', '🪙', '🧿',
  /* 71-80 */  '🛡️', '⚔️', '🗡️', '🏹', '👑', '🤴', '👸', '⚜️', '🔱', '💎',
  /* 81-90 */  '💍', '🔮', '🪨', '🏆', '🏅', '🥇', '🎖️', '🚀', '🛸', '🛰️',
  /* 91-100 */ '🐉', '🐲', '🦅', '🦁', '🦄', '🌋', '🌌', '🌠', '🎇', '🎆',
];

export function getAvailableIcons(level: number): string[] {
  const maxIdx = Math.min(level, LEVEL_ICONS.length);
  return LEVEL_ICONS.slice(0, maxIdx);
}
