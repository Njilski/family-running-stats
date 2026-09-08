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
  { id: 'andreas', name: 'Andreas', age: 44, role: 'Far', adjustment: 1.0, isAdmin: true },
  { id: 'maja', name: 'Maja', age: 42, role: 'Mor', adjustment: 1.05, isAdmin: false },
  { id: 'asger', name: 'Asger', age: 11, isAdmin: false },
  { id: 'johan', name: 'Johan', age: 9, isAdmin: false },
  { id: 'aksel', name: 'Aksel', age: 6, isAdmin: false },
];

export function newId() {
  return crypto.randomBytes(6).toString('base64url');
}

// The age suggestion from the handoff (adult 1.00, 11 → 1.60, 9 → 1.85, 6 → 2.40),
// filled in for the ages in between. Adults are the 1.00 baseline.
const SUGGESTION_BY_AGE = { 4: 3.0, 5: 2.7, 6: 2.4, 7: 2.2, 8: 2.0, 9: 1.85, 10: 1.7, 11: 1.6, 12: 1.5, 13: 1.4, 14: 1.3, 15: 1.2, 16: 1.1, 17: 1.05 };
export function suggestionForAge(age) {
  if (age == null || age >= 18) return 1.0;
  return SUGGESTION_BY_AGE[Math.max(4, Math.round(age))] ?? 1.0;
}

// What the UI prints under a name: "Far · 44" or "11 år".
export function tagFor(m) {
  if (m.role) return m.age != null ? `${m.role} · ${m.age}` : m.role;
  return m.age != null ? `${m.age} år` : '';
}
export function ageHintFor(m) {
  if (m.age == null) return 'voksen';
  if (m.age >= 18) return m.isAdmin ? 'voksen · basis' : 'voksen';
  return `${m.age} år`;
}
export function initialsFor(name) {
  return String(name).replace(/[^\p{L}]/gu, '').slice(0, 2).toUpperCase() || '??';
}

// Recomputes the derived fields after name/age/role change.
export function deriveMember(m) {
  m.tag = tagFor(m);
  m.ageHint = ageHintFor(m);
  m.suggestion = suggestionForAge(m.age);
  m.initials = m.initials || initialsFor(m.name);
  return m;
}

export function newMember(seed, index) {
  const age = seed.age ?? null;
  return deriveMember({
    id: seed.id,
    name: seed.name,
    age,
    role: seed.role || null,
    initials: seed.initials || initialsFor(seed.name),
    adjustment: seed.adjustment ?? suggestionForAge(age),
    isAdmin: Boolean(seed.isAdmin),
    // Display order on the login tiles and chips; new members go last.
    sortOrder: seed.sortOrder ?? index ?? 0,
    prefs: { overtaken: true, sunday: true, everyRun: false },
    dismissedNudges: [],
    integrations: { strava: null, appleHealth: null },
    createdAt: new Date().toISOString(),
  });
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

  // Minutes may carry seconds as a fraction (34:20 → 34.33); stored to two decimals.
  let minutes = b.minutes == null || b.minutes === '' ? null : Number(b.minutes);
  if (minutes !== null && (!Number.isFinite(minutes) || minutes <= 0 || minutes > 24 * 60)) {
    return { error: 'Tiden skal være over 0 minutter.' };
  }
  if (minutes !== null) minutes = round2(minutes);

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
