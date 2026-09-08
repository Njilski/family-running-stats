// Every number the app shows is derived here from the raw activities. Pure
// functions of (members, activities, now) so they are easy to test and the
// browser only renders.
//
// Ranking is on points = km × adjustmentAtLog (the snapshot on each activity),
// with raw km as the alternative "RÅ KM" mode. Periods are ISO week (Monday
// 00:00 → Sunday 23:59), calendar month, calendar year, and everything.

export const PERIODS = ['week', 'month', 'year', 'all'];

const TAUNTS = [
  'Fører tavlen lige nu. Det holder til nogen får løbesko på.',
  'Forrest og stadig ikke træt. Mistænkeligt.',
  'Har flest point og mindst travlt med at prale. Endnu.',
  'Fører med en afrundingsfejl. Læn dig ikke tilbage.',
  'Sidder på førstepladsen som om den var betalt.',
];

const RECAP_TAUNTS = {
  first: 'Første uge på toppen. Nyd den — de andre har lige fået noget at løbe efter.',
  streak: (n) => `${ordinal(n)} uge i træk. Efterhånden sørger resten af jer bare for stemningen.`,
  close: 'Vundet med en margen, man kan tabe på en enkelt søndagstur. Ingen sover.',
};

export function computeAll(members, activities, now = new Date()) {
  const today = isoDate(now);
  const ranges = periodRanges(now);
  const byMember = new Map(members.map((m) => [m.id, activities.filter((a) => a.memberId === m.id)]));

  const periods = {};
  for (const key of PERIODS) {
    const [from, to] = ranges[key];
    periods[key] = standings(members, byMember, from, to);
  }

  const weeksWon = computeWeeksWon(members, activities, now);

  return {
    today,
    isoWeek: isoWeekNumber(now),
    periodLabels: {
      week: 'DENNE UGE',
      month: MONTHS[now.getMonth()].toUpperCase(),
      year: String(now.getFullYear()),
      all: 'SIDEN STARTEN',
    },
    periods,
    members: members.map((m) => memberStats(m, byMember.get(m.id), now, ranges)),
    family: familyStats(members, activities, periods, ranges, now),
    medals: members
      .map((m) => ({ memberId: m.id, name: m.name, weeks: weeksWon.get(m.id) || 0 }))
      .sort((a, b) => b.weeks - a.weeks),
    recap: recap(members, byMember, activities, now, weeksWon),
    taunts: Object.fromEntries(
      PERIODS.map((key, pi) => {
        const leader = periods[key].rows[0];
        const mi = leader ? members.findIndex((m) => m.id === leader.memberId) : 0;
        return [key, TAUNTS[(mi + pi) % TAUNTS.length]];
      })
    ),
  };
}

// --- standings ----------------------------------------------------------------------

function standings(members, byMember, from, to) {
  const rows = members.map((m) => {
    const mine = byMember.get(m.id).filter((a) => a.date >= from && a.date <= to);
    const km = sum(mine, (a) => a.km);
    const points = sum(mine, (a) => a.points);
    return {
      memberId: m.id,
      name: m.name,
      tag: m.tag,
      adjustment: m.adjustment,
      km: round1(km),
      points: round1(points),
      runs: mine.length,
      avgKm: mine.length ? round1(km / mine.length) : 0,
    };
  });
  return {
    from,
    to,
    rows: [...rows].sort((a, b) => b.points - a.points || b.km - a.km),
    rowsRaw: [...rows].sort((a, b) => b.km - a.km || b.points - a.points),
    familyKm: round1(sum(rows, (r) => r.km)),
    familyRuns: sum(rows, (r) => r.runs),
  };
}

function memberStats(m, mine, now, ranges) {
  const longest = mine.reduce((best, a) => (!best || a.km > best.km ? a : best), null);
  const week7 = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDays(now, -i);
    const key = isoDate(d);
    week7.push({ date: key, day: 'MTOTFLS'[(d.getDay() + 6) % 7], km: round1(sum(mine.filter((a) => a.date === key), (a) => a.km)) });
  }
  return {
    memberId: m.id,
    longest: longest ? { km: longest.km, date: longest.date } : null,
    weekStreak: weekStreak(mine, now),
    week7,
    totalRuns: mine.length,
  };
}

function familyStats(members, activities, periods, ranges, now) {
  const weeks = new Map();
  for (const a of activities) {
    const wk = isoWeekKey(new Date(a.date + 'T12:00:00'));
    weeks.set(wk, (weeks.get(wk) || 0) + a.km);
  }
  let biggestWeek = null;
  for (const [wk, km] of weeks) if (!biggestWeek || km > biggestWeek.km) biggestWeek = { weekStart: wk, km: round1(km) };
  const longest = activities.reduce((best, a) => (!best || a.km > best.km ? a : best), null);
  return {
    biggestWeek: biggestWeek ? { ...biggestWeek, isoWeek: isoWeekNumber(new Date(biggestWeek.weekStart + 'T12:00:00')) } : null,
    longestRun: longest ? { km: longest.km, date: longest.date, memberId: longest.memberId } : null,
  };
}

// Week winners for the medal cabinet: rank 1 on points in each *closed* ISO
// week that had at least one run. The running week is not a medal yet. Ties
// share the medal.
function computeWeeksWon(members, activities, now) {
  const thisWeek = isoWeekKey(now);
  const perWeek = new Map();
  for (const a of activities) {
    const wk = isoWeekKey(new Date(a.date + 'T12:00:00'));
    if (wk >= thisWeek) continue;
    if (!perWeek.has(wk)) perWeek.set(wk, new Map());
    const m = perWeek.get(wk);
    m.set(a.memberId, (m.get(a.memberId) || 0) + a.points);
  }
  const won = new Map();
  for (const m of perWeek.values()) {
    const top = Math.max(...m.values());
    for (const [id, pts] of m) if (pts === top) won.set(id, (won.get(id) || 0) + 1);
  }
  return won;
}

// The recap is the most recently closed week (last week), or this week if
// nothing was logged last week — the poster should never be empty.
function recap(members, byMember, activities, now, weeksWon) {
  const thisMonday = startOfIsoWeek(now);
  let start = addDays(thisMonday, -7);
  let closed = true;
  const inWeek = (s) => activities.filter((a) => a.date >= isoDate(s) && a.date <= isoDate(addDays(s, 6)));
  if (inWeek(start).length === 0) {
    start = thisMonday;
    closed = false;
  }
  const from = isoDate(start), to = isoDate(addDays(start, 6));
  const table = standings(members, byMember, from, to);
  const winner = table.rows[0];
  const runnerUp = table.rows[1];
  const margin = winner && runnerUp ? round1(winner.points - runnerUp.points) : winner ? winner.points : 0;

  // Consecutive weeks (ending with this one) that the winner has won.
  let streak = 0;
  if (winner && winner.points > 0) {
    for (let s = start; ; s = addDays(s, -7)) {
      const rows = standings(members, byMember, isoDate(s), isoDate(addDays(s, 6))).rows;
      if (!rows[0] || rows[0].points === 0 || rows[0].memberId !== winner.memberId) break;
      streak += 1;
      if (streak > 52) break;
    }
  }
  let taunt = RECAP_TAUNTS.first;
  if (streak >= 2) taunt = RECAP_TAUNTS.streak(streak);
  else if (winner && runnerUp && margin < 3) taunt = RECAP_TAUNTS.close;

  return {
    isoWeek: isoWeekNumber(start),
    closed,
    from,
    to,
    rows: table.rows,
    winnerId: winner?.memberId || null,
    margin,
    streak,
    taunt,
    empty: !winner || winner.points === 0,
  };
}

// Consecutive ISO weeks, counting back from this week, with at least one run.
// The current week counts as alive even without a run yet — a streak should
// not "break" on a Monday morning.
export function weekStreak(activities, now) {
  const weeks = new Set(activities.map((a) => isoWeekKey(new Date(a.date + 'T12:00:00'))));
  let cursor = startOfIsoWeek(now);
  let streak = 0;
  if (!weeks.has(isoWeekKey(cursor))) cursor = addDays(cursor, -7);
  while (weeks.has(isoWeekKey(cursor))) {
    streak += 1;
    cursor = addDays(cursor, -7);
  }
  return streak;
}

// --- dates ------------------------------------------------------------------------------

const MONTHS = ['januar', 'februar', 'marts', 'april', 'maj', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'december'];

export function periodRanges(now) {
  const today = isoDate(now);
  const monday = startOfIsoWeek(now);
  const y = now.getFullYear(), m = String(now.getMonth() + 1).padStart(2, '0');
  return {
    week: [isoDate(monday), isoDate(addDays(monday, 6))],
    month: [`${y}-${m}-01`, `${y}-${m}-31`],
    year: [`${y}-01-01`, `${y}-12-31`],
    all: ['1970-01-01', today],
  };
}

export function isoDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
export function startOfIsoWeek(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
  return addDays(x, -((x.getDay() + 6) % 7));
}
export function isoWeekKey(d) {
  return isoDate(startOfIsoWeek(d));
}
export function isoWeekNumber(d) {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = x.getUTCDay() || 7;
  x.setUTCDate(x.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
  return Math.ceil(((x - yearStart) / 86400000 + 1) / 7);
}
export function formatDateDa(iso) {
  const d = new Date(iso + 'T12:00:00');
  return `${d.getDate()}. ${MONTHS[d.getMonth()].slice(0, 3)}`;
}

function ordinal(n) {
  return ['', 'Første', 'Anden', 'Tredje', 'Fjerde', 'Femte', 'Sjette', 'Syvende', 'Ottende', 'Niende', 'Tiende'][n] || `${n}.`;
}
function sum(list, f) {
  return list.reduce((s, x) => s + f(x), 0);
}
function round1(n) {
  return Math.round(n * 10) / 10;
}
