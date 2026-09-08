// Everything the dashboard shows is derived here, server-side, from the raw
// runs. Pure functions of (members, runs, today) so they are easy to test and
// the browser only renders.

const RACE_DISTANCES = [
  { key: '5k', label: '5 km', km: 5 },
  { key: '10k', label: '10 km', km: 10 },
  { key: 'half', label: 'Half marathon', km: 21.0975 },
  { key: 'marathon', label: 'Marathon', km: 42.195 },
];
// A run counts towards a race distance when it is at least that long and not so
// much longer that the time stops meaning anything (a 12 km run is a "10k").
const RACE_TOLERANCE = 1.2;

export function computeStats(members, runs, today = new Date()) {
  const todayStr = isoDate(today);
  const year = todayStr.slice(0, 4);
  const month = todayStr.slice(0, 7);

  const perMember = members.map((m) => {
    const mine = runs.filter((r) => r.memberId === m.id);
    return {
      memberId: m.id,
      name: m.name,
      colorSlot: m.colorSlot,
      total: totals(mine),
      year: totals(mine.filter((r) => r.date.startsWith(year))),
      month: totals(mine.filter((r) => r.date.startsWith(month))),
      longest: longest(mine),
      bests: RACE_DISTANCES.map((d) => ({ ...d, run: bestAt(mine, d.km) })),
      weekStreak: weekStreak(mine, today),
      lastRun: mine[0]?.date || null,
    };
  });

  return {
    today: todayStr,
    family: {
      total: totals(runs),
      year: totals(runs.filter((r) => r.date.startsWith(year))),
      month: totals(runs.filter((r) => r.date.startsWith(month))),
    },
    perMember,
    monthly: monthlyByMember(members, runs, today, 12),
    cumulativeYear: cumulativeByMember(members, runs, year, todayStr),
    records: familyRecords(perMember),
  };
}

function totals(runs) {
  const km = runs.reduce((s, r) => s + r.distanceKm, 0);
  const timed = runs.filter((r) => r.durationSec);
  const timedKm = timed.reduce((s, r) => s + r.distanceKm, 0);
  const sec = timed.reduce((s, r) => s + r.durationSec, 0);
  return {
    runs: runs.length,
    km: round1(km),
    durationSec: sec,
    // Pace only over the runs that have a time, otherwise it would be skewed.
    paceSecPerKm: timedKm > 0 ? Math.round(sec / timedKm) : null,
  };
}

function longest(runs) {
  return runs.reduce((best, r) => (!best || r.distanceKm > best.distanceKm ? r : best), null);
}

function bestAt(runs, km) {
  const eligible = runs.filter(
    (r) => r.durationSec && r.distanceKm >= km - 0.05 && r.distanceKm <= km * RACE_TOLERANCE
  );
  // Compare by pace, not raw time: a 10.5 km run at a faster pace beats a
  // 10.0 km run at a slower pace even though it took longer.
  return eligible.reduce((best, r) => {
    const pace = r.durationSec / r.distanceKm;
    return !best || pace < best.durationSec / best.distanceKm ? r : best;
  }, null);
}

// Consecutive ISO weeks, counting back from this week, with at least one run.
// The current week counts as alive even without a run yet — a streak should
// not "break" on a Monday morning.
function weekStreak(runs, today) {
  const weeks = new Set(runs.map((r) => isoWeekKey(new Date(r.date + 'T12:00:00'))));
  let cursor = startOfIsoWeek(today);
  let streak = 0;
  if (!weeks.has(isoWeekKey(cursor))) cursor = addDays(cursor, -7);
  while (weeks.has(isoWeekKey(cursor))) {
    streak += 1;
    cursor = addDays(cursor, -7);
  }
  return streak;
}

function monthlyByMember(members, runs, today, count) {
  const months = [];
  const d = new Date(today.getFullYear(), today.getMonth(), 1);
  for (let i = count - 1; i >= 0; i--) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    months.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`);
  }
  return {
    months,
    series: members.map((m) => ({
      memberId: m.id,
      name: m.name,
      colorSlot: m.colorSlot,
      km: months.map((mo) =>
        round1(runs.filter((r) => r.memberId === m.id && r.date.startsWith(mo)).reduce((s, r) => s + r.distanceKm, 0))
      ),
    })),
  };
}

// One point per day of the year up to today, per member. Flat lines where
// nobody ran; the chart draws the whole family on the same axis.
function cumulativeByMember(members, runs, year, todayStr) {
  const start = new Date(`${year}-01-01T12:00:00`);
  const end = new Date(`${todayStr}T12:00:00`);
  const days = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(isoDate(d));
  return {
    days,
    series: members.map((m) => {
      const byDay = new Map();
      runs.filter((r) => r.memberId === m.id && r.date.startsWith(year))
        .forEach((r) => byDay.set(r.date, (byDay.get(r.date) || 0) + r.distanceKm));
      let acc = 0;
      return {
        memberId: m.id,
        name: m.name,
        colorSlot: m.colorSlot,
        km: days.map((day) => round1((acc += byDay.get(day) || 0))),
      };
    }),
  };
}

function familyRecords(perMember) {
  const pick = (getter, better) =>
    perMember.reduce((best, p) => {
      const v = getter(p);
      if (v == null) return best;
      return !best || better(v, best.value) ? { memberId: p.memberId, name: p.name, value: v } : best;
    }, null);
  return {
    mostKmYear: pick((p) => (p.year.km > 0 ? p.year.km : null), (a, b) => a > b),
    mostRunsYear: pick((p) => (p.year.runs > 0 ? p.year.runs : null), (a, b) => a > b),
    longestRun: pick((p) => p.longest, (a, b) => a.distanceKm > b.distanceKm),
    longestStreak: pick((p) => (p.weekStreak > 0 ? p.weekStreak : null), (a, b) => a > b),
    bests: RACE_DISTANCES.map((d) => ({
      ...d,
      holder: pick(
        (p) => p.bests.find((b) => b.key === d.key)?.run || null,
        (a, b) => a.durationSec / a.distanceKm < b.durationSec / b.distanceKm
      ),
    })),
  };
}

// --- date helpers -------------------------------------------------------------

export function isoDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function startOfIsoWeek(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
  const day = (x.getDay() + 6) % 7; // Monday = 0
  return addDays(x, -day);
}
function isoWeekKey(d) {
  return isoDate(startOfIsoWeek(d));
}
function round1(n) {
  return Math.round(n * 10) / 10;
}
