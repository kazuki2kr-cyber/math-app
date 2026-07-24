export interface DashboardUnit {
  subject?: string;
  mode?: string;
  drillType?: 'multiple_choice' | 'written';
  eventStatus?: string;
  eventStartsAt?: unknown;
  eventEndsAt?: unknown;
}

export function isMathSubjectValue(value?: string) {
  // mojibake-ok: legacy imported math subject values are kept for compatibility.
  return !value || value === 'math' || value === '数学' || value === '謨ｰ蟄ｦ';
}

function isBattleUnit(unit: DashboardUnit) {
  const subject = String(unit.subject || '');
  // mojibake-ok: legacy imported battle subject values are kept for compatibility.
  return unit.mode === 'battle' || subject.endsWith('対戦') || subject.endsWith('蟇ｾ謌ｦ');
}

function parseEventDate(value: unknown): number | null {
  if (!value) return null;
  if (typeof value === 'string') {
    const timestamp = Date.parse(value);
    return Number.isNaN(timestamp) ? null : timestamp;
  }
  if (
    typeof value === 'object'
    && value !== null
    && 'toDate' in value
    && typeof value.toDate === 'function'
  ) {
    return value.toDate().getTime();
  }
  return null;
}

function isVisibleUnit(unit: DashboardUnit) {
  if (unit.drillType !== 'written') return true;
  if ((unit.eventStatus || 'active') !== 'active') return false;

  const now = Date.now();
  const startsAt = parseEventDate(unit.eventStartsAt);
  const endsAt = parseEventDate(unit.eventEndsAt);
  if (startsAt && startsAt > now) return false;
  if (endsAt && endsAt < now) return false;
  return true;
}

export function getMathDashboardUnits<T extends DashboardUnit>(units: T[]): T[] {
  return units.filter(unit => (
    isMathSubjectValue(unit.subject)
    && !isBattleUnit(unit)
    && isVisibleUnit(unit)
  ));
}
