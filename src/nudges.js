// Beskeder — "the whole engine". Generated server-side the moment a run is
// saved, by comparing this week's standings before and after. Stored per
// event, addressed to one member or to everyone; each member dismisses their
// own copy (member.dismissedNudges). Tone: teasing but fair.

import { newId } from './model.js';
import { weekStreak, addDays, isoDate, isoWeekNumber, startOfIsoWeek } from './stats.js';

const CLOSE_GAP_POINTS = 5;

export function nudgesForSave({ members, before, after, activity, actor, now }) {
  const out = [];
  const createdAt = now.toISOString();
  const byId = new Map(members.map((m) => [m.id, m]));
  const posBefore = new Map(before.rows.map((r, i) => [r.memberId, i]));
  const kmText = fmt(activity.km);
  const isChild = /år/.test(actor.tag || '');

  // Overtaken: anyone who was ahead of the actor and is now behind.
  const actorAfter = after.rows.findIndex((r) => r.memberId === actor.id);
  after.rows.forEach((r, i) => {
    if (r.memberId === actor.id || i <= actorAfter) return;
    if ((posBefore.get(r.memberId) ?? 99) < (posBefore.get(actor.id) ?? 99)) {
      const tookLead = actorAfter === 0;
      out.push(nudge('OVERHALET', r.memberId, tookLead
        ? `${actor.name} har lige logget ${kmText} km og taget førstepladsen fra dig. Igen.`
        : `${actor.name} har lige logget ${kmText} km og overhalet dig på tavlen.`, createdAt, 'overtaken'));
    }
  });

  // Closing in: the actor has just come within a few points of the leader —
  // fired once, on the run that crosses the line, not on every run after.
  if (actorAfter > 0) {
    const leader = after.rows[0];
    const gapAfter = round1(leader.points - after.rows[actorAfter].points);
    const leaderBefore = before.rows.find((r) => r.memberId === leader.memberId);
    const actorBefore = before.rows.find((r) => r.memberId === actor.id);
    const gapBefore = leaderBefore && actorBefore ? round1(leaderBefore.points - actorBefore.points) : Infinity;
    const wasLeaderBefore = before.rows[0]?.memberId === leader.memberId;
    if (gapAfter <= CLOSE_GAP_POINTS && (!wasLeaderBefore || gapBefore > CLOSE_GAP_POINTS)) {
      const age = (actor.tag || '').match(/\d+/)?.[0];
      out.push(nudge('HALER IND', leader.memberId,
        `${actor.name} er ${fmt(gapAfter)} point bagud.` + (isChild && age ? ` ${pronoun(actor)} er ${numberWord(age)} og har hele eftermiddagen.` : ' Det er én tur.'),
        createdAt, 'overtaken'));
    }
  }

  // Streak: a member has now run at least once in two or more consecutive weeks.
  const streak = weekStreak(after.activities.filter((a) => a.memberId === actor.id), now);
  if (streak >= 2 && after.activities.filter((a) => a.memberId === actor.id && a.date >= isoDate(startOfIsoWeek(now))).length === 1) {
    out.push(nudge('STIME', null,
      `${actor.name} har løbet mindst én tur ${streak} uger i træk.` + (isChild ? ` ${pronoun(actor)} er ${numberWord((actor.tag.match(/\d+/) || [''])[0])}.` : ''),
      createdAt, 'streak', actor.id));
  }

  // Every run, for those who asked for it.
  out.push(nudge('NY TUR', null, `${actor.name} loggede ${kmText} km (${fmt(activity.points)} point).`, createdAt, 'everyRun', actor.id));

  return out.filter((n) => !n.to || byId.has(n.to));
}

// A synthetic reminder late in the week; computed at read time, never stored.
export function weekClosingNudge(now) {
  const dow = (now.getDay() + 6) % 7; // Monday = 0
  if (dow < 4) return null;
  const daysLeft = 6 - dow;
  const text = daysLeft === 0
    ? `Sidste dag af uge ${isoWeekNumber(now)}. Intet tæller efter midnat.`
    : `${daysLeft === 1 ? 'Én dag' : `${numberWord(String(daysLeft))[0].toUpperCase() + numberWord(String(daysLeft)).slice(1)} dage`} tilbage af uge ${isoWeekNumber(now)}. Intet tæller efter midnat.`;
  return { id: `close-${isoDate(startOfIsoWeek(now))}`, kind: 'UGEN LUKKER', to: null, text, createdAt: null, time: 'søndag 23:59', pref: null, style: 'time' };
}

// Filters the stored nudges down to what one member should see.
export function nudgesFor(member, all, now) {
  const cutoff = addDays(now, -14).toISOString();
  const dismissed = new Set(member.dismissedNudges || []);
  const prefs = member.prefs || {};
  const list = all.filter((n) =>
    n.createdAt >= cutoff &&
    !dismissed.has(n.id) &&
    (n.to === null || n.to === member.id) &&
    n.about !== member.id &&
    (n.pref === null || prefs[n.pref] !== false) &&
    (n.pref !== 'everyRun' || prefs.everyRun === true)
  );
  const closing = weekClosingNudge(now);
  if (closing && prefs.sunday !== false && !dismissed.has(closing.id)) list.push(closing);
  return list.map((n) => ({ ...n, time: n.time || relativeTime(n.createdAt, now) }));
}

function nudge(kind, to, text, createdAt, pref, about = null) {
  return { id: newId(), kind, to, text, createdAt, pref, about, style: kind === 'OVERHALET' ? 'accent' : kind === 'STIME' ? 'neutral' : kind === 'NY TUR' ? 'neutral' : 'ink' };
}

function relativeTime(iso, now) {
  const mins = Math.round((now - new Date(iso)) / 60000);
  if (mins < 60) return `${Math.max(1, mins)} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} t`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'i går' : `${days} dage`;
}

function pronoun(member) {
  const female = ['Maja', 'Mor'].some((w) => (member.name + ' ' + member.tag).includes(w));
  return female ? 'Hun' : 'Han';
}
function numberWord(n) {
  const words = { 1: 'et', 2: 'to', 3: 'tre', 4: 'fire', 5: 'fem', 6: 'seks', 7: 'syv', 8: 'otte', 9: 'ni', 10: 'ti', 11: 'elleve', 12: 'tolv', 13: 'tretten', 14: 'fjorten', 15: 'femten', 16: 'seksten', 17: 'sytten', 18: 'atten' };
  return words[Number(n)] || String(n);
}
function round1(n) {
  return Math.round(n * 10) / 10;
}
function fmt(v) {
  return Number(v).toFixed(1).replace('.', ',');
}
