// Headless smoke test — the safety net. Run it before every commit:
//
//   rm -rf data && node server.js &          (local password is "run")
//   CHROMIUM=/opt/pw-browsers/chromium node smoke-test.mjs
//
// Covers: anonymous read works and anonymous writes are refused; wrong password
// refused; unlock; add runners; log runs through the real form; stats, charts,
// records and the run log reflect them; edit and delete a run; remove a runner
// takes their runs with them; lock hides editing again. Also checks the stats
// module directly for the cases a browser walk-through would not notice.

import { chromium } from 'playwright';
import { computeStats } from './src/stats.js';

const BASE = process.env.BASE || 'http://localhost:3000';
const PASSWORD = process.env.EDIT_PASSWORD || 'run';
const ok = (cond, msg) => { if (!cond) throw new Error('FAILED: ' + msg); console.log('ok  ', msg); };

// --- 0. Stats module, pure ---------------------------------------------------------
{
  const today = new Date('2026-09-08T12:00:00');
  const members = [{ id: 'a', name: 'A', colorSlot: 0 }, { id: 'b', name: 'B', colorSlot: 1 }];
  const run = (memberId, date, distanceKm, durationSec = null) => ({ id: date + memberId, memberId, date, distanceKm, durationSec, createdAt: date });
  const runs = [
    run('a', '2026-09-07', 10.5, 3000),   // 10k candidate, pace 285.7
    run('a', '2026-08-31', 10.0, 2900),   // 10k candidate, pace 290 → slower pace, longer distance loses
    run('a', '2026-08-24', 5.0, 1500),
    run('a', '2026-08-10', 12.5, 3900),   // 12.5 ≤ 10×1.2 → also 10k-eligible
    run('a', '2026-07-01', 3.0),          // untimed: excluded from pace
    run('b', '2026-09-01', 21.2, 7200),
    run('b', '2025-12-31', 8.0, 2400),    // last year: not in year totals
  ];
  const s = computeStats(members, runs, today);
  ok(s.family.year.km === 62.2 && s.family.total.km === 70.2, 'year vs all-time totals separate last year');
  const a = s.perMember[0];
  ok(a.total.paceSecPerKm === Math.round((3000 + 2900 + 1500 + 3900) / (10.5 + 10 + 5 + 12.5)), 'pace ignores untimed runs');
  ok(a.bests.find((b) => b.key === '10k').run.id === '2026-09-07a', 'best 10k picks the fastest pace, not the shortest time');
  ok(a.bests.find((b) => b.key === '5k').run.id === '2026-08-24a', 'best 5k found');
  ok(a.bests.find((b) => b.key === 'half').run === null && s.perMember[1].bests.find((b) => b.key === 'half').run.id === '2026-09-01b', 'half marathon only for B');
  // A ran in ISO weeks of Sep 7, Aug 31, Aug 24, (gap Aug 17), Aug 10. Today Sep 8 is in the Sep 7 week → streak 3.
  ok(a.weekStreak === 3, `week streak counts back from this week (got ${a.weekStreak})`);
  // B's last run was Sep 1 (week of Aug 31); this week has none yet, so the streak is still alive at 1.
  ok(s.perMember[1].weekStreak === 1, 'a streak is not broken by the current week having no run yet');
  ok(s.monthly.months.length === 12 && s.monthly.months.at(-1) === '2026-09', 'twelve months ending now');
  ok(s.monthly.series[0].km.at(-1) === 10.5 && s.monthly.series[0].km.at(-2) === 27.5, 'monthly km per member');
  ok(s.cumulativeYear.days.length === 251 && s.cumulativeYear.series[0].km.at(-1) === 41, 'cumulative reaches the year total on today');
  ok(s.records.longestRun.name === 'B' && s.records.mostKmYear.name === 'A', 'family records pick the right holder');
  const empty = computeStats([], [], today);
  ok(empty.family.total.runs === 0 && empty.records.longestRun === null, 'empty data does not crash');
}

// --- 1. Browser --------------------------------------------------------------------
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
// The test deliberately provokes 401/409/400 replies; Chromium logs each as a console error.
page.on('console', (m) => { if (m.type() === 'error' && !/status of 4\d\d/.test(m.text())) errors.push(`console: ${m.text()}`); });
page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'Andreas G.' : undefined));

// Anonymous: read yes, write no.
const anon = await ctx.request.get(`${BASE}/api/summary`);
ok(anon.ok(), 'anonymous read of /api/summary');
const w1 = await ctx.request.post(`${BASE}/api/members`, { data: { name: 'Intruder' } });
ok(w1.status() === 401, 'anonymous member create is refused');
const w2 = await ctx.request.post(`${BASE}/api/runs`, { data: { memberId: 'x', date: '2026-01-01', distanceKm: 5 } });
ok(w2.status() === 401, 'anonymous run create is refused');
const bad = await ctx.request.post(`${BASE}/api/unlock`, { data: { password: 'wrong' } });
ok(bad.status() === 401, 'wrong password refused');

await page.goto(BASE);
await page.waitForSelector('#emptyState:not(.d-none)');
ok(await page.isHidden('#addRunBtn'), 'edit controls hidden while locked');

// Unlock through the UI.
await page.click('#unlockBtn');
await page.fill('#password', 'nope');
await page.click('#unlockForm button[type=submit]');
await page.waitForSelector('#unlockError:not(.d-none)');
await page.fill('#password', PASSWORD);
await page.click('#unlockForm button[type=submit]');
await page.waitForSelector('#addRunBtn:not(.d-none)', { timeout: 5000 });
ok(true, 'unlock via the form shows edit controls');

// Add two runners.
await page.click('#membersBtn');
await page.waitForSelector('#membersModal.show');
for (const name of ['Andreas', 'Sofie']) {
  await page.fill('#memberName', name);
  await page.click('#memberForm button[type=submit]');
  await page.waitForFunction((n) => document.querySelector('#memberList').textContent.includes(n), name);
}
await page.fill('#memberName', 'andreas');
await page.click('#memberForm button[type=submit]');
await page.waitForSelector('#memberError:not(.d-none)');
ok((await page.textContent('#memberError')).includes('already'), 'duplicate runner name refused');
await page.click('#membersModal .btn-close');
await page.waitForSelector('#membersModal', { state: 'hidden' });

// Log runs through the real form.
const today = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => { const d = new Date(today); d.setDate(d.getDate() - n); return iso(d); };
async function logRun(member, date, km, h, m, s, notes = '') {
  await page.click('#addRunBtn');
  await page.waitForSelector('#runModal.show');
  await page.selectOption('#runMember', { label: member });
  await page.fill('#runDate', date);
  await page.fill('#runKm', String(km));
  await page.fill('#runH', String(h)); await page.fill('#runM', String(m)); await page.fill('#runS', String(s));
  await page.fill('#runNotes', notes);
  await page.click('#runForm button[type=submit]');
  // Wait for the modal to close, but surface a form error instead of timing out.
  await page.waitForFunction(() => !document.querySelector('#runModal.show') || !document.querySelector('#runError').classList.contains('d-none'));
  if (await page.isVisible('#runError')) throw new Error('run form error: ' + (await page.textContent('#runError')));
  await page.waitForSelector('#runModal', { state: 'hidden' });
}
await logRun('Andreas', daysAgo(1), 10.2, 0, 50, 0, 'Lakes loop');
await logRun('Andreas', daysAgo(8), 5, 0, 24, 30);
await logRun('Sofie', daysAgo(2), 21.1, 1, 55, 0, 'Half marathon!');
await page.waitForFunction(() => document.querySelectorAll('#runRows tr[data-id]').length === 3);
ok(true, 'three runs logged via the form');

// Validation surfaces in the form.
await page.click('#addRunBtn');
await page.waitForSelector('#runModal.show');
await page.fill('#runDate', daysAgo(0));
await page.fill('#runKm', '0');
await page.evaluate(() => document.getElementById('runKm').removeAttribute('min'));
await page.click('#runForm button[type=submit]');
await page.waitForSelector('#runError:not(.d-none)');
ok((await page.textContent('#runError')).includes('Distance'), 'zero distance rejected with a message');
await page.click('#runModal .btn-close');
await page.waitForSelector('#runModal', { state: 'hidden' });

// Stats reflect the data.
const kmYear = await page.textContent('#statKmYear');
ok(kmYear.replace(',', '.') === '36.3' || kmYear === '36,3', `family km this year = ${kmYear}`);
ok((await page.textContent('#statRunsYear')) === '3', 'runs this year = 3');
ok((await page.$$('#monthlyChart .bar')).length >= 2, 'monthly bars drawn');
ok((await page.$$('#cumChart polyline.line')).length === 2, 'one cumulative line per runner');
ok((await page.$$('#monthlyLegend .dot')).length === 2, 'legend present for two runners');
const records = await page.textContent('#records');
ok(records.includes('Half marathon') && records.includes('Sofie') && records.includes('1:55:00'), 'half-marathon record credited to Sofie');
ok(records.includes('Longest run') && records.includes('21.1'), 'longest run record');
await page.click('#monthlyTableToggle');
await page.waitForSelector('#monthlyTable:not(.d-none)');
ok((await page.textContent('#monthlyTable')).includes('Andreas'), 'monthly table view available');
await page.click('#monthlyTableToggle');

// Tooltip on hover.
const bar = (await page.$$('#monthlyChart .hit'))[0];
await bar.hover();
await page.waitForSelector('#monthlyChart .chart-tip:not(.d-none)');
ok((await page.textContent('#monthlyChart .chart-tip')).includes('km'), 'bar tooltip shows km');

// Edit a run: change Andreas' 5 km to 6 km.
await page.click('#runRows tr:nth-child(3) .edit-run');
await page.waitForSelector('#runModal.show');
ok((await page.inputValue('#runKm')) === '5', 'edit form prefilled');
await page.fill('#runKm', '6');
await page.click('#runForm button[type=submit]');
await page.waitForSelector('#runModal', { state: 'hidden' });
await page.waitForFunction(() => document.querySelector('#statKmYear').textContent.replace(',', '.') === '37.3');
ok(true, 'editing a run updates the stats');

// Filter the log.
await page.selectOption('#logFilter', { label: 'Sofie' });
ok((await page.$$('#runRows tr[data-id]')).length === 1, 'log filter narrows to one runner');
await page.selectOption('#logFilter', '');

// Delete a run via the edit form (confirm dialog auto-accepted).
await page.click('#runRows tr:nth-child(1) .edit-run');
await page.waitForSelector('#runModal.show');
await page.click('#runDeleteBtn');
await page.waitForSelector('#runModal', { state: 'hidden' });
await page.waitForFunction(() => document.querySelectorAll('#runRows tr[data-id]').length === 2);
ok(true, 'delete run');

// Rename and remove a runner (prompt/confirm auto-answered).
await page.click('#membersBtn');
await page.waitForSelector('#membersModal.show');
await page.click('#memberList li:nth-child(1) .rename-member');
await page.waitForFunction(() => document.querySelector('#memberList').textContent.includes('Andreas G.'));
ok(true, 'rename runner');
await page.click('#memberList li:nth-child(2) .remove-member');
await page.waitForFunction(() => document.querySelectorAll('#memberList li[data-id]').length === 1);
await page.click('#membersModal .btn-close');
await page.waitForSelector('#membersModal', { state: 'hidden' });
await page.waitForFunction(() => document.querySelectorAll('#runRows tr[data-id]').length === 1);
ok(true, 'removing a runner removes their runs');

// CSV export.
const csv = await (await ctx.request.get(`${BASE}/api/export.csv`)).text();
ok(csv.startsWith('date,runner,distance_km') && csv.split('\n').length === 2, 'CSV export has header + 1 run');

// Lock.
await page.click('#lockBtn');
await page.waitForSelector('#unlockBtn:not(.d-none)');
ok(await page.isHidden('#addRunBtn'), 'lock hides edit controls');
const w3 = await ctx.request.post(`${BASE}/api/runs`, { data: {} });
ok(w3.status() === 401, 'writes refused again after lock');

await page.screenshot({ path: 'smoke-dashboard.png', fullPage: true });
await browser.close();

if (errors.length) throw new Error('Browser errors:\n' + errors.join('\n'));
console.log('\nALL GREEN');
