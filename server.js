// Familiens Løbeklub — family running scoreboard
//
// One family, one 4-digit code. A member picks their name tile and types the
// family code once; that sets a long-lived signed cookie naming the member.
// Everything after that is scoped to that member: they log runs only for
// themselves, adjust only their own age adjustment unless they are admin.
//
// Points = km × the member's adjustment *at the time of logging*. That snapshot
// lives on the activity and is never recomputed.

// The family lives in Copenhagen; weeks and "today" must roll over there, not in UTC.
process.env.TZ ||= 'Europe/Copenhagen';

import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';
import * as store from './src/store.js';
import { computeAll, PERIODS, periodRanges } from './src/stats.js';
import { validateActivity, clampAdjustment, newMember, newId, deriveMember, initialsFor } from './src/model.js';
import { nudgesForSave, nudgesFor } from './src/nudges.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set('trust proxy', 1); // Cloud Run terminates TLS in front of the app
const IS_PROD = process.env.NODE_ENV === 'production' || Boolean(process.env.K_SERVICE);
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
// Archivo, vendored from node_modules — no runtime dependency on Google Fonts.
app.use('/vendor/archivo', express.static(path.join(__dirname, 'node_modules/@fontsource/archivo')));

const SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';
// Locally the family code defaults so the app works straight after npm start.
// In production a missing code means nobody can log in — never an open door.
const FAMILY_PIN = process.env.FAMILY_PIN || (IS_PROD ? null : '1234');
const FAMILY_NAME = process.env.FAMILY_NAME || 'FAMILIENS LØBEKLUB';

// --- Signed-cookie member session ----------------------------------------------------

function sign(value) {
  const mac = crypto.createHmac('sha256', SECRET).update(value).digest('base64url');
  return `${value}.${mac}`;
}
function unsign(signed) {
  if (!signed) return null;
  const i = signed.lastIndexOf('.');
  if (i < 0) return null;
  const value = signed.slice(0, i);
  return sign(value) === signed ? value : null;
}
const cookieOpts = {
  httpOnly: true,
  secure: IS_PROD,
  sameSite: 'lax',
  maxAge: 365 * 24 * 3600 * 1000, // "tast koden én gang" — a shared family iPad stays signed in
};

async function requireMember(req, res, next) {
  const id = unsign(req.cookies.lk_member);
  const member = id ? await store.getMember(id) : null;
  if (!member) return res.status(401).json({ error: 'Log ind først.' });
  req.member = member;
  next();
}

function pinMatches(given) {
  if (!FAMILY_PIN) return false;
  const a = Buffer.from(String(given));
  const b = Buffer.from(FAMILY_PIN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// --- Login ------------------------------------------------------------------------------------

// The login screen needs the tiles before anyone is signed in.
app.get('/api/family', async (req, res) => {
  const members = await store.listMembers();
  res.json({
    name: FAMILY_NAME,
    founded: members.reduce((y, m) => Math.min(y, Number(m.createdAt.slice(0, 4))), new Date().getFullYear()),
    loginEnabled: Boolean(FAMILY_PIN),
    members: members.map(loginTile),
  });
});

app.post('/api/login', async (req, res) => {
  if (!FAMILY_PIN) return res.status(503).json({ error: 'Familiekoden er ikke sat op på serveren.' });
  const member = await store.getMember(String(req.body?.memberId || ''));
  if (!member) return res.status(404).json({ error: 'Vælg hvem der løber.' });
  if (!pinMatches(req.body?.pin || '')) return res.status(401).json({ error: 'Det er ikke familiens kode.' });
  res.cookie('lk_member', sign(member.id), cookieOpts);
  res.json({ ok: true, memberId: member.id });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('lk_member');
  res.json({ ok: true });
});

// --- Everything the app shows, in one call -----------------------------------------------------

app.get('/api/state', requireMember, async (req, res) => {
  res.json(await buildState(req.member));
});

async function buildState(member) {
  const now = new Date();
  const [members, activities, allNudges] = await Promise.all([store.listMembers(), store.listActivities(), store.listNudges()]);
  const stats = computeAll(members, activities, now);
  return {
    family: FAMILY_NAME,
    me: publicMember(member),
    members: members.map(publicMember),
    stats,
    activities: activities.slice(0, 200),
    nudges: nudgesFor(member, allNudges, now),
    prefs: member.prefs,
  };
}

// --- Log a run (the only write path for activities) -------------------------------------------

app.post('/api/activities', requireMember, async (req, res) => {
  const now = new Date();
  const members = await store.listMembers();
  const actor = members.find((m) => m.id === req.member.id);
  const { activity, error } = validateActivity(req.body, actor, localDate(now));
  if (error) return res.status(400).json({ error });

  const before = await store.listActivities();
  const [wFrom, wTo] = periodRanges(now).week;
  const weekBefore = computeAll(members, before, now).periods.week;
  await store.saveActivity(activity);
  const after = [activity, ...before];
  const weekAfter = computeAll(members, after, now).periods.week;

  // Beskeder are born here — the moment a run lands on the board.
  const nudges = nudgesForSave({
    members, actor, activity, now,
    before: weekBefore,
    after: { ...weekAfter, activities: after.filter((a) => a.date >= wFrom && a.date <= wTo) },
  });
  await store.saveNudges(nudges);

  res.json({ ok: true, activity, state: await buildState(actor) });
});

// Fixing a typo on your own run within the day it was logged. Adults (admins)
// can fix anyone's. Points are recomputed from the *stored* snapshot.
app.delete('/api/activities/:id', requireMember, async (req, res) => {
  const a = await store.getActivity(req.params.id);
  if (!a) return res.status(404).json({ error: 'Turen findes ikke.' });
  if (a.memberId !== req.member.id && !req.member.isAdmin) {
    return res.status(403).json({ error: 'Du kan kun slette dine egne ture.' });
  }
  await store.deleteActivity(a.id);
  res.json({ ok: true, state: await buildState(req.member) });
});

// --- Adjustments --------------------------------------------------------------------------------

app.put('/api/members/:id/adjustment', requireMember, async (req, res) => {
  const target = await store.getMember(req.params.id);
  if (!target) return res.status(404).json({ error: 'Not found' });
  if (target.id !== req.member.id && !req.member.isAdmin) {
    return res.status(403).json({ error: 'Kun din egen — spørg en admin.' });
  }
  const value = clampAdjustment(req.body?.adjustment);
  if (value === null) return res.status(400).json({ error: 'Justeringen skal være et tal mellem 1,00 og 3,00.' });
  target.adjustment = value;
  await store.saveMember(target);
  res.json({ ok: true, member: publicMember(target) });
});

// --- Preferences and nudges ----------------------------------------------------------------------

app.put('/api/me/prefs', requireMember, async (req, res) => {
  const p = req.body || {};
  req.member.prefs = {
    overtaken: p.overtaken !== undefined ? Boolean(p.overtaken) : req.member.prefs.overtaken,
    sunday: p.sunday !== undefined ? Boolean(p.sunday) : req.member.prefs.sunday,
    everyRun: p.everyRun !== undefined ? Boolean(p.everyRun) : req.member.prefs.everyRun,
  };
  await store.saveMember(req.member);
  res.json({ ok: true, prefs: req.member.prefs });
});

app.post('/api/nudges/:id/dismiss', requireMember, async (req, res) => {
  const list = new Set(req.member.dismissedNudges || []);
  list.add(String(req.params.id));
  // Keep the list bounded; nudges older than two weeks are never shown anyway.
  req.member.dismissedNudges = [...list].slice(-200);
  await store.saveMember(req.member);
  res.json({ ok: true });
});

// --- Admin: members ---------------------------------------------------------------------------------
//
// Admins add, edit and remove family members from the Justering screen. Age
// drives the suggested adjustment; the actual adjustment is set separately and
// only ever applies to runs logged after the change.

function requireAdmin(req, res, next) {
  if (!req.member.isAdmin) return res.status(403).json({ error: 'Kun for admin.' });
  next();
}

function parseMemberFields(body, existing) {
  const b = body || {};
  const name = b.name !== undefined ? String(b.name).trim().slice(0, 40) : existing?.name;
  if (!name) return { error: 'Navn mangler.' };
  let age = b.age !== undefined ? b.age : existing?.age ?? null;
  if (age === '' || age === null) age = null;
  else {
    age = Number(age);
    if (!Number.isInteger(age) || age < 1 || age > 110) return { error: 'Alder skal være et helt tal.' };
  }
  const role = b.role !== undefined ? String(b.role).trim().slice(0, 20) || null : existing?.role ?? null;
  let initials = b.initials !== undefined ? String(b.initials).trim().slice(0, 2).toUpperCase() : existing?.initials;
  if (!initials || (b.name !== undefined && b.initials === undefined && existing && existing.initials === initialsFor(existing.name))) {
    initials = initialsFor(name);
  }
  return { fields: { name, age, role, initials } };
}

app.post('/api/members', requireMember, requireAdmin, async (req, res) => {
  const { fields, error } = parseMemberFields(req.body);
  if (error) return res.status(400).json({ error });
  const members = await store.listMembers();
  if (members.some((m) => m.name.toLowerCase() === fields.name.toLowerCase())) {
    return res.status(409).json({ error: `${fields.name} er allerede med.` });
  }
  let id = fields.name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '') || newId();
  if (members.some((m) => m.id === id)) id = `${id}-${newId()}`;
  const member = newMember({ id, ...fields, isAdmin: false }, Math.max(0, ...members.map((m) => m.sortOrder ?? 0)) + 1);
  await store.saveMember(member);
  res.json(publicMember(member));
});

app.put('/api/members/:id', requireMember, requireAdmin, async (req, res) => {
  const target = await store.getMember(req.params.id);
  if (!target) return res.status(404).json({ error: 'Not found' });
  const { fields, error } = parseMemberFields(req.body, target);
  if (error) return res.status(400).json({ error });
  const others = (await store.listMembers()).filter((m) => m.id !== target.id);
  if (others.some((m) => m.name.toLowerCase() === fields.name.toLowerCase())) {
    return res.status(409).json({ error: `${fields.name} er allerede med.` });
  }
  Object.assign(target, fields);
  deriveMember(target);
  await store.saveMember(target);
  res.json(publicMember(target));
});

app.delete('/api/members/:id', requireMember, requireAdmin, async (req, res) => {
  if (req.params.id === req.member.id) return res.status(400).json({ error: 'Du kan ikke fjerne dig selv.' });
  const target = await store.getMember(req.params.id);
  if (!target) return res.status(404).json({ error: 'Not found' });
  await store.deleteMember(target.id);
  res.json({ ok: true, state: await buildState(req.member) });
});

// --- helpers ---------------------------------------------------------------------------------------

// Integration tokens never leave the server; the browser only learns whether
// something is connected.
function publicMember(m) {
  return {
    id: m.id,
    name: m.name,
    age: m.age ?? null,
    role: m.role ?? null,
    tag: m.tag,
    initials: m.initials,
    ageHint: m.ageHint,
    suggestion: m.suggestion,
    adjustment: m.adjustment,
    isAdmin: Boolean(m.isAdmin),
    connected: { strava: Boolean(m.integrations?.strava), appleHealth: Boolean(m.integrations?.appleHealth) },
  };
}
function loginTile(m) {
  return { id: m.id, name: m.name, tag: m.tag, initials: m.initials };
}
function localDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (!req.path.startsWith('/api/')) return next(err);
  console.error(`${req.method} ${req.path} failed:`, err.message);
  res.status(err.status || 500).json({ error: 'Noget gik galt. Prøv igen.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  Familiens Løbeklub → http://localhost:${PORT}`);
  console.log(
    `  storage: ${store.storageBackend} · login: ${FAMILY_PIN ? 'enabled' : 'DISABLED (no FAMILY_PIN)'}` +
      `${!IS_PROD && !process.env.FAMILY_PIN ? ' · local family code is 1234' : ''}\n`
  );
});
