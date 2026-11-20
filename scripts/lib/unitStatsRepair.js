/**
 * Helpers for safely repairing contaminated top-level dotted fields
 * (e.g. literal "unitStats.1.正負の数の加減") without deleting nested
 * entries inside the legitimate `unitStats` map, and for normalizing
 * legacy 3-level nested `unitStats` maps without corrupting `maxScore: 0`.
 */

const UNIT_STAT_MARKER_KEYS = [
  'maxScore',
  'drillCount',
  'bestTime',
  'wrongQuestionIds',
  'totalCorrect',
  'reviewV1',
  'updatedAt',
];

function isUnitStatRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  return UNIT_STAT_MARKER_KEYS.some((key) => Object.prototype.hasOwnProperty.call(value, key));
}

/**
 * Extracts literal-keyed `unitStats` from a raw `unitStats` object that may
 * contain either:
 *   - literal keys with dots: `unitStats['1.正負の数の加減'] = { maxScore: 0, ... }`
 *   - literal keys without dots: `unitStats['kanji_1'] = { maxScore: 0, ... }`
 *   - legacy 3-level nested maps: `unitStats['1']['正負の数の加減'] = { maxScore: 0, ... }`
 */
function extractNestedAsLiteralKeys(unitStats) {
  const result = {};
  if (!unitStats || typeof unitStats !== 'object') {
    return result;
  }

  for (const [topKey, topVal] of Object.entries(unitStats)) {
    if (topKey.includes('.')) {
      result[topKey] = topVal;
    } else if (
      typeof topVal === 'object' &&
      topVal !== null &&
      !Array.isArray(topVal) &&
      !isUnitStatRecord(topVal)
    ) {
      for (const [subKey, subVal] of Object.entries(topVal)) {
        const literalKey = `${topKey}.${subKey}`;
        result[literalKey] = subVal;
      }
    } else {
      result[topKey] = topVal;
    }
  }
  return result;
}

function mergeUnitData(a, b) {
  if (!a) return b;
  if (!b) return a;
  const aCount = Number(a.drillCount || 0);
  const bCount = Number(b.drillCount || 0);
  if (aCount >= bCount) {
    return { ...b, ...a };
  }
  return { ...a, ...b };
}

/**
 * Builds variadic arguments `[fieldPathOrName, value, ...]` for Firestore's
 * `DocumentReference.update(...)` so that literal top-level fields containing
 * dots (such as `"unitStats.1.正負の数の加減"`) are deleted via `new FieldPath(key)`
 * instead of being parsed by Firestore as nested paths inside `unitStats`.
 */
function buildLiteralDottedFieldDeleteUpdateArgs(data, FieldPath, FieldValue, extraFields = {}, prefixFilter = null) {
  const fieldsToDelete = [];
  const updateArgs = [];

  for (const key of Object.keys(data || {})) {
    if (!key.includes('.')) continue;
    if (prefixFilter && !prefixFilter(key)) continue;
    fieldsToDelete.push(key);
    updateArgs.push(new FieldPath(key), FieldValue.delete());
  }

  for (const [key, value] of Object.entries(extraFields)) {
    updateArgs.push(new FieldPath(key), value);
  }

  return {
    fieldsToDelete,
    updateArgs,
  };
}

function sanitizeRankingName(rawName) {
  const trimmed = typeof rawName === 'string' ? rawName.trim() : '';
  if (!trimmed || trimmed.includes('@')) {
    return '名無し';
  }
  return trimmed.slice(0, 40);
}

module.exports = {
  isUnitStatRecord,
  extractNestedAsLiteralKeys,
  mergeUnitData,
  buildLiteralDottedFieldDeleteUpdateArgs,
  sanitizeRankingName,
};
