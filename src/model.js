// Record shapes and validation shared by the API and both stores.
//
// The one rule that matters: an activity stores `adjustmentAtLog`, a snapshot
// of the member's adjustment when it was saved, and `points` is derived from
// that snapshot. Changing an adjustment later never rewrites history — the
// UI promises this ("Ændringer gælder fra næste tur").

import crypto from 'node:crypto';

export const FEELS = ['let', 'ok', 'haard'];
export const SOURCES = ['manual', 'strava', 'apple_health'];
export const ADJUSTMENT_MIN = 1;
export const ADJUSTMENT_MAX = 3;

// The family from the design, with the age-based suggestions from the handoff.
export const SEED_MEMBERS = [
  { id: 'andreas', name: 'Andreas', tag: 'Far · 44', initials: 'AN', ageHint: 'voksen · basis', suggestion: 1.0, isAdmin: true },
  { id: 'maja', name: 'Maja', tag: 'Mor · 42', initials: 'MA', ageHint: 'voksen', suggestion: 1.05, isAdmin: false },
  { id: 'asger', name: 'Asger', tag: '11 år', initials: 'AS', ageHint: '11 år', suggestion: 1.6, isAdmin: false },
  { id: 'johan', name: 'Johan', tag: '9 år', initials: 'JO', ageHint: '9 år', suggestion: 1.85, isAdmin: false },
  { id: 'aksel', name: 'Aksel', tag: '6 år', initials: 'AK', ageHint: '6 år', suggestion: 2.4, isAdmin: false },
];

export function newId() {
  return crypto.randomBytes(6).toString('base64url');
}

export function newMember(seed, index) {
  return {
    id: seed.id,
    name: seed.name,
    tag: seed.tag,
    initials: seed.initials,
    ageHint: seed.ageHint,
    suggestion: seed.suggestion,
    adjustment: seed.adjustment ?? seed.suggestion,
    isAdmin: Boolean(seed.isAdmin),
    // Display order on the login tiles and chips; new members go last.
    sortOrder: seed.sortOrder ?? index ?? 0,
    prefs: { overtaken: true, sunday: true, everyRun: false },
    dismissedNudges: [],
    integrations: { strava: null, appleHealth: null },
    createdAt: new Date().toISOString(),
  };
}

export function round2(n) {
  return Math.round(n * 100) / 100;
}

// Validates a new activity for `member`. Returns { activity } or { error }.
export function validateActivity(body, member, today) {
  const b = body || {};
  const date = String(b.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
    return { error: 'Vælg en dato.' };
  }
  if (date > today) return { error: 'Turen kan ikke ligge i fremtiden.' };

  const km = Number(b.km);
  if (!Number.isFinite(km) || km <= 0 || km > 300) return { error: 'Afstanden skal være over 0 km.' };

  let minutes = b.minutes == null || b.minutes === '' ? null : Number(b.minutes);
  if (minutes !== null && (!Number.isInteger(minutes) || minutes <= 0 || minutes > 24 * 60)) {
    return { error: 'Tiden skal være et helt antal minutter.' };
  }

  const feel = FEELS.includes(b.feel) ? b.feel : null;
  const source = SOURCES.includes(b.source) ? b.source : 'manual';
  const adjustmentAtLog = round2(member.adjustment);

  return {
    activity: {
      id: newId(),
      memberId: member.id,
      date,
      km: round2(km),
      minutes,
      feel,
      adjustmentAtLog,
      points: round2(km * adjustmentAtLog),
      source,
      externalId: b.externalId ?? null,
      createdAt: new Date().toISOString(),
    },
  };
}

export function clampAdjustment(v) {
  const n = Math.round(Number(v) * 100) / 100;
  if (!Number.isFinite(n)) return null;
  return Math.min(ADJUSTMENT_MAX, Math.max(ADJUSTMENT_MIN, n));
}
