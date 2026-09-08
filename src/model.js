// Shape of the two record types, and the validation both storage backends and
// the API share. Runs carry `source` and `externalId` from day one so a Strava
// or Apple Health import can land in the same collection without a migration:
// an imported run is just a run whose source isn't 'manual'.

import crypto from 'node:crypto';

export const SOURCES = ['manual', 'strava', 'apple_health'];

export function newId() {
  return crypto.randomBytes(6).toString('base64url');
}

export function slugify(name) {
  return String(name).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'member';
}

export function newMember(fields, colorSlot) {
  return {
    id: fields.id,
    name: fields.name,
    colorSlot,
    createdAt: new Date().toISOString(),
    // Filled in later by an integration: { athleteId, connectedAt, ... }
    integrations: { strava: null, appleHealth: null },
  };
}

// Returns { run } or { error }. `existing` is the run being edited, if any.
export function validateRun(body, members, existing) {
  const b = body || {};
  const memberId = String(b.memberId ?? existing?.memberId ?? '');
  if (!members.some((m) => m.id === memberId)) return { error: 'Pick who ran.' };

  const date = String(b.date ?? existing?.date ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
    return { error: 'Enter the date as YYYY-MM-DD.' };
  }
  if (date > localDate(new Date(Date.now() + 86400000))) return { error: 'That date is in the future.' };

  const distanceKm = Number(b.distanceKm ?? existing?.distanceKm);
  if (!Number.isFinite(distanceKm) || distanceKm <= 0 || distanceKm > 500) {
    return { error: 'Distance must be a number of kilometres greater than 0.' };
  }

  let durationSec = b.durationSec ?? existing?.durationSec ?? null;
  if (durationSec !== null && durationSec !== '') {
    durationSec = Number(durationSec);
    if (!Number.isInteger(durationSec) || durationSec <= 0 || durationSec > 48 * 3600) {
      return { error: 'Time must be a whole number of seconds (leave it empty if unknown).' };
    }
  } else {
    durationSec = null;
  }

  const notes = String(b.notes ?? existing?.notes ?? '').trim().slice(0, 500);
  const source = SOURCES.includes(b.source) ? b.source : existing?.source || 'manual';

  return {
    run: {
      id: existing?.id || newId(),
      memberId,
      date,
      distanceKm: Math.round(distanceKm * 100) / 100,
      durationSec,
      notes,
      source,
      externalId: b.externalId ?? existing?.externalId ?? null,
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  };
}

export function localDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
