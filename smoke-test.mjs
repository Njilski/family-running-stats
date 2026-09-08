// Headless smoke test — the safety net. Run it before every commit:
//
//   rm -rf data && node server.js &          (local family code is 1234)
//   CHROMIUM=/opt/pw-browsers/chromium node smoke-test.mjs
//
// Part 0 checks the maths directly (points snapshot, periods, medals, recap,
// nudges). Part 1 drives a real phone-sized browser through every screen:
// login with the family code, log a run through the steppers, the toast and
// the leader change, Mig + en-mod-en, Justering (and that old runs keep their
// snapshot), Familien, Ugens resultat, Beskeder, lock/switch member.

import { chromium } from 'playwright';
import { computeAll, weekStreak } from './src/stats.js';
import { validateActivity, newMember, SEED_MEMBERS } from './src/model.js';
import { nudgesForSave, nudgesFor } from './src/nudges.js';

const BASE = process.env.BASE || 'http://localhost:3000';
const PIN = process.env.FAMILY_PIN || '1234';
const ok = (cond, msg) => { if (!cond) throw new Error('FAILED: ' + msg); console.log('ok  ', msg); };

// --- 0. Pure logic ----------------------------------------------------------------------
{
  const now = new Date('2026-09-08T12:00:00'); // Tuesday, ISO week 37
  const members = SEED_MEMBERS.map((m, i) => newMember(m, i));
  const byId = Object.fromEntries(members.map((m) => [m.id, m]));
  let t = 0;
  const act = (id, date, km, minutes) => {
    const { activity, error } = validateActivity({ date, km, minutes, feel: 'ok' }, byId[id], '2026-09-08');
    if (error) throw new Error(error);
    activity.createdAt = `2026-09-08T00:00:${String(t++).padStart(2, '0')}Z`;
    return activity;
  };
  const acts = [
    act('maja', '2026-09-07', 5.0, 30), act('andreas', '2026-09-08', 6.2, 32), act('aksel', '2026-09-08', 1.6, 15),
    // last week (36): Maja wins on points
    act('maja', '2026-09-01', 6.0, 34), act('andreas', '2026-09-02', 6.0, 30), act('asger', '2026-09-03', 3.5, 22),
    // week 35: Aksel wins on adjusted points (2.0 × 2.4 = 4.8 > 4.0)
    act('aksel', '2026-08-26', 2.0, 18), act('andreas', '2026-08-25', 4.0, 20),
    act('johan', '2025-12-30', 2.0, 15), // last year
  ];
  ok(acts[2].points === 3.84 && acts[2].adjustmentAtLog === 2.4, 'points = km × adjustment snapshot');
  const s = computeAll(members, acts, now);
  const week = s.periods.week.rows;
  ok(week[0].memberId === 'andreas' && week[0].points === 6.2 && week[1].memberId === 'maja' && week[1].points === 5.3, 'week standings ranked on points');
  ok(s.periods.week.rowsRaw[0].memberId === 'andreas', 'raw km ordering available');
  ok(s.periods.month.rows.find((r) => r.memberId === 'andreas').km === 12.2, 'month is a running total');
  ok(s.periods.year.rows.find((r) => r.memberId === 'johan').runs === 0 && s.periods.all.rows.find((r) => r.memberId === 'johan').runs === 1, 'year excludes last year, all-time includes it');
  ok(s.periods.week.familyKm === 12.8, 'family km this week');
  const medals = Object.fromEntries(s.medals.map((m) => [m.memberId, m.weeks]));
  ok(medals.maja === 1 && medals.aksel === 1 && medals.andreas === 0, `medals count closed weeks only, on adjusted points (${JSON.stringify(medals)})`);
  ok(s.recap.isoWeek === 36 && s.recap.closed && s.recap.winnerId === 'maja' && s.recap.margin === 0.3, 'recap is last week, with margin');
  ok(s.recap.taunt.includes('margen'), 'close-margin taunt');
  ok(weekStreak(acts.filter((a) => a.memberId === 'andreas'), now) === 3, 'week streak counts back from this week');
  ok(s.members.find((m) => m.memberId === 'andreas').week7.length === 7 && s.members.find((m) => m.memberId === 'andreas').week7[6].km === 6.2, '7-day bars end today');
  ok(s.family.biggestWeek.isoWeek === 36 && s.family.longestRun.memberId === 'andreas', 'family records');

  // Changing an adjustment must not rewrite history.
  byId.aksel.adjustment = 3.0;
  const s2 = computeAll(members, acts, now);
  ok(s2.periods.week.rows.find((r) => r.memberId === 'aksel').points === 3.8, 'old runs keep their logged adjustment');
  byId.aksel.adjustment = 2.4;

  // Nudges: Andreas takes the lead from Maja → she is told; Aksel closes in → nothing (gap 2.4 but leader unchanged... check crossing rule).
  const before = computeAll(members, acts.slice(0, 1).concat(acts.slice(3)), now).periods.week;
  const afterActs = acts.slice(0, 2).concat(acts.slice(3));
  const after = computeAll(members, afterActs, now).periods.week;
  const nudges = nudgesForSave({ members, actor: byId.andreas, activity: acts[1], now, before, after: { ...after, activities: afterActs } });
  ok(nudges.some((n) => n.kind === 'OVERHALET' && n.to === 'maja' && n.text.includes('førstepladsen')), 'overtaken nudge goes to the old leader');
  ok(nudges.some((n) => n.kind === 'STIME' && n.to === null), 'streak nudge for everyone');
  const seen = nudgesFor(byId.maja, nudges, now);
  ok(seen.some((n) => n.kind === 'OVERHALET') && !seen.some((n) => n.kind === 'NY TUR'), 'Maja sees the overtake, not every-run (pref off)');
  ok(nudgesFor(byId.andreas, nudges, now).every((n) => n.kind !== 'STIME'), 'you do not get nudged about yourself');
  const empty = computeAll(members, [], now);
  ok(empty.recap.empty && empty.periods.week.rows.length === 5, 'empty data does not crash');
}

// --- 1. Browser ------------------------------------------------------------------------------
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const ctx = await browser.newContext({ viewport: { width: 402, height: 874 }, locale: 'da-DK', timezoneId: 'Europe/Copenhagen' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
// The test deliberately provokes 401s; Chromium logs each as a console error.
page.on('console', (m) => { if (m.type() === 'error' && !/status of 4\d\d/.test(m.text())) errors.push(`console: ${m.text()}`); });

const anon = await ctx.request.get(`${BASE}/api/state`);
ok(anon.status() === 401, 'state requires login');
const fam = await (await ctx.request.get(`${BASE}/api/family`)).json();
ok(fam.members.length === 5 && !('adjustment' in fam.members[0]) && fam.members[0].id === 'andreas' && fam.members[4].id === 'aksel', 'family tiles are public, minimal and in seed order');
const bad = await ctx.request.post(`${BASE}/api/login`, { data: { memberId: 'maja', pin: '0000' } });
ok(bad.status() === 401, 'wrong family code refused');

// Login screen → Aksel with the code.
await page.goto(BASE);
await page.waitForSelector('.login');
ok(await page.isDisabled('#pinInput'), 'code entry waits for a name');
await page.click('[data-pick="aksel"]');
await page.fill('#pinInput', '9999');
await page.waitForSelector('.err');
ok((await page.textContent('.err')).includes('kode'), 'wrong code shows a message');
// Type key by key, like a person: a re-render per keystroke once reversed the digits.
await page.keyboard.type(PIN, { delay: 60 });
await page.waitForSelector('.hero');
ok((await page.textContent('.hero .name')).includes('Ingen'), 'empty board says so');
ok((await page.textContent('.tabs .on')) === 'TAVLEN', 'lands on Tavlen');

// Log a run with the steppers: 6,0 → 2,0 km, 34 → 19 min.
await page.click('[data-go="log"]');
await page.waitForSelector('.stepper');
ok((await page.textContent('.runner')) === 'Aksel', 'log screen is for the signed-in member only');
for (let i = 0; i < 8; i++) await page.click('.stepper:not(.small) button:not(.plus)');
ok((await page.textContent('#distVal')) === '2,0', 'distance stepper, min 0,5 respected');
for (let i = 0; i < 3; i++) await page.click('.stepper.small button:not(.plus)');
ok((await page.textContent('.pace-note')).includes('TEMPO 9:30'), 'pace computed live');
ok((await page.textContent('.pts-note')).includes('4,8 POINT'), 'points preview uses the adjustment');
await page.click('[data-feel="haard"]');
await page.click('[data-act="save"]');
await page.waitForSelector('.toast');
ok((await page.textContent('.toast')).includes('GEMT · +2,0 KM (4,8 POINT)'), 'toast after save');
ok((await page.textContent('.hero .name')) === 'AKSEL', 'Aksel leads on adjusted points');
await page.click('[data-act="toggleMode"]');
ok((await page.textContent('.hero .top span:last-child')) === 'RÅ KM', 'mode toggles to raw km');
await page.click('[data-act="toggleMode"]');

// Log yesterday too, picking the date.
await page.click('[data-go="log"]');
await page.click('[data-day="yest"]');
await page.click('[data-act="save"]');
await page.waitForSelector('.toast');
ok((await page.$$('.row')).length === 5, 'five rows on the board');
ok((await page.locator('.row').first().locator('.m').textContent()).includes('2 ture'), 'two runs counted');

// Andreas logs 6,2 km via the API and takes the lead → Aksel gets a nudge.
const a = await browser.newContext({ timezoneId: 'Europe/Copenhagen' });
await a.request.post(`${BASE}/api/login`, { data: { memberId: 'andreas', pin: PIN } });
const posted = await a.request.post(`${BASE}/api/activities`, { data: { date: new Date().toISOString().slice(0, 10), km: 20, minutes: 100, feel: 'let' } });
ok(posted.ok(), 'Andreas logs via API');
await page.click('[data-go="board"]');
await page.waitForFunction(() => document.querySelector('.hero .name')?.textContent === 'ANDREAS');
ok(true, 'leader changes after another member logs');
ok((await page.textContent('.btn-msgs')).trim() === 'BESKEDER 1', 'Aksel has one message');
await page.click('[data-go="nudges"]');
await page.waitForSelector('.nudge');
ok((await page.textContent('.nudge .txt')).includes('Andreas har lige logget 20,0 km'), 'overtaken message text');
await page.click('.nudge .rm');
await page.waitForFunction(() => document.querySelectorAll('.nudge').length === 0);
ok(true, 'dismiss removes the message');
await page.click('[data-pref="everyRun"]');
await page.waitForSelector('[data-pref="everyRun"] .switch.on');
const prefs = await (await a.request.get(`${BASE}/api/state`)).json();
ok(prefs.prefs.everyRun === false, 'prefs are per member');
await page.click('[data-pref="everyRun"]');

// Mig: rank, stats, en mod en.
await page.click('[data-go="me"]');
await page.waitForSelector('.me-head');
ok((await page.textContent('.me-head .n')) === 'Aksel' && (await page.textContent('.badge .v')) === '2', 'Mig shows rank 2');
ok((await page.$$('.bars7 > div')).length === 7, 'seven day bars');
await page.click('[data-rival="andreas"]');
ok((await page.textContent('.verdict')).includes('TABER'), 'head to head verdict');
await page.click('[data-view="maja"]');
ok((await page.textContent('.me-head .n')) === 'Maja', 'viewing another member');

// Justering: Aksel is not admin → only his own row is editable; history keeps its snapshot.
await page.click('[data-go="setup"]');
await page.waitForSelector('.frow');
ok((await page.textContent('.adm')).includes('KUN DIN EGEN'), 'non-admin sees the restriction');
ok(await page.isDisabled('[data-adj="andreas"][data-d="0.05"]'), 'other rows disabled for non-admin');
for (let i = 0; i < 4; i++) await page.click('[data-adj="aksel"][data-d="0.05"]');
ok((await page.textContent('.frow.me .v')) === '×2,60', 'stepper in steps of 0,05');
await page.click('[data-act="saveAdjust"]');
await page.waitForSelector('.hero');
ok((await page.locator('.row').nth(1).locator('.m').textContent()).includes('×2,60') && (await page.locator('.row').nth(1).locator('.sc b').textContent()) === '19,2', 'adjustment saved; old runs keep 2,0×2,40 + 6,0×2,40 = 19,2 points');
const forbidden = await ctx.request.put(`${BASE}/api/members/andreas/adjustment`, { data: { adjustment: 1.5 } });
ok(forbidden.status() === 403, 'non-admin cannot change others via API either');

// Familien.
await page.click('[data-go="family"]');
await page.waitForSelector('.share');
ok((await page.textContent('.family-total b')) === '28,0', 'family km sums everyone');
ok((await page.$$('.medal')).length === 5, 'medal cabinet lists everyone');

// Recap poster and share (clipboard fallback).
await page.click('[data-go="board"]');
await page.click('[data-go="recap"]');
await page.waitForSelector('.poster');
ok((await page.textContent('.poster .kick')).startsWith('UGE '), 'poster shows the week');
ok(await page.isHidden('.tabs'), 'poster has no chrome');
await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
await page.click('[data-act="share"]');
await page.waitForSelector('.toast');
ok((await page.textContent('.toast')).includes('KOPIERET'), 'share falls back to clipboard');

// Switch member = logout to the login screen.
await page.click('[data-go="me"]');
await page.click('[data-act="logout"]');
await page.waitForSelector('.login');
ok((await ctx.request.get(`${BASE}/api/state`)).status() === 401, 'logout clears the session');

await page.screenshot({ path: 'smoke-board.png', fullPage: true });
await browser.close();
if (errors.length) throw new Error('Browser errors:\n' + errors.join('\n'));
console.log('\nALL GREEN');
