// Family Running Stats
//
// Anyone with the link can read everything. Editing (members, runs) needs the
// family password, which sets a signed cookie — the same tiny session scheme as
// the speaker portal, minus per-user accounts. There is one password because
// there is one family; per-person identity is a field on the run, not a login.

import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';
import * as store from './src/store.js';
import { computeStats } from './src/stats.js';
import { newId, newMember, slugify, validateRun } from './src/model.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set('trust proxy', 1); // Cloud Run terminates TLS in front of the app
const IS_PROD = process.env.NODE_ENV === 'production' || Boolean(process.env.K_SERVICE);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Vendored frontend assets (served from node_modules — no CDN dependency)
app.use('/vendor/bootstrap', express.static(path.join(__dirname, 'node_modules/bootstrap/dist')));

const SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';
// Locally the password defaults so the app is usable straight after npm start.
// In production a missing password disables editing rather than opening it up.
const EDIT_PASSWORD = process.env.EDIT_PASSWORD || (IS_PROD ? null : 'run');

// --- Signed-cookie edit session ---------------------------------------------------

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
  maxAge: 30 * 24 * 3600 * 1000, // a family app on a phone: stay unlocked for a month
};
function canEdit(req) {
  return unsign(req.cookies.running_edit) === 'edit';
}
function requireEdit(req, res, next) {
  if (!canEdit(req)) return res.status(401).json({ error: 'Unlock editing with the family password first.' });
  next();
}

// Constant-time compare so the password can't be guessed a character at a time.
function passwordMatches(given) {
  if (!EDIT_PASSWORD) return false;
  const a = Buffer.from(String(given));
  const b = Buffer.from(EDIT_PASSWORD);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// --- Public read -------------------------------------------------------------------

app.get('/api/summary', async (req, res) => {
  const [members, runs] = await Promise.all([store.listMembers(), store.listRuns()]);
  res.json({
    members: members.map(publicMember),
    runs,
    stats: computeStats(members, runs),
    canEdit: canEdit(req),
    editingEnabled: Boolean(EDIT_PASSWORD),
  });
});

app.get('/api/export.csv', async (req, res) => {
  const [members, runs] = await Promise.all([store.listMembers(), store.listRuns()]);
  const name = new Map(members.map((m) => [m.id, m.name]));
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [
    'date,runner,distance_km,duration_sec,notes,source',
    ...runs.map((r) => [r.date, name.get(r.memberId), r.distanceKm, r.durationSec, r.notes, r.source].map(esc).join(',')),
  ];
  res.type('text/csv').attachment('family-runs.csv').send(lines.join('\n'));
});

// --- Unlock / lock -------------------------------------------------------------------

app.post('/api/unlock', (req, res) => {
  if (!EDIT_PASSWORD) return res.status(503).json({ error: 'Editing is not configured on this server.' });
  if (!passwordMatches(req.body?.password || '')) {
    return res.status(401).json({ error: 'That is not the family password.' });
  }
  res.cookie('running_edit', sign('edit'), cookieOpts);
  res.json({ ok: true });
});

app.post('/api/lock', (req, res) => {
  res.clearCookie('running_edit');
  res.json({ ok: true });
});

// --- Members -----------------------------------------------------------------------------

app.post('/api/members', requireEdit, async (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 60);
  if (!name) return res.status(400).json({ error: 'Give the runner a name.' });
  const members = await store.listMembers();
  if (members.some((m) => m.name.toLowerCase() === name.toLowerCase())) {
    return res.status(409).json({ error: `${name} is already on the list.` });
  }
  let id = slugify(name);
  if (members.some((m) => m.id === id)) id = `${id}-${newId()}`;
  // The colour slot is assigned once and never reused while the member exists,
  // so a person keeps their colour when someone else is added or removed.
  const used = new Set(members.map((m) => m.colorSlot));
  let slot = 0;
  while (used.has(slot)) slot += 1;
  const member = await store.saveMember(newMember({ id, name }, slot));
  res.json(publicMember(member));
});

app.put('/api/members/:id', requireEdit, async (req, res) => {
  const member = await store.getMember(req.params.id);
  if (!member) return res.status(404).json({ error: 'Not found' });
  const name = String(req.body?.name || '').trim().slice(0, 60);
  if (!name) return res.status(400).json({ error: 'Give the runner a name.' });
  member.name = name;
  await store.saveMember(member);
  res.json(publicMember(member));
});

app.delete('/api/members/:id', requireEdit, async (req, res) => {
  const member = await store.getMember(req.params.id);
  if (!member) return res.status(404).json({ error: 'Not found' });
  await store.deleteMember(member.id);
  res.json({ ok: true });
});

// Integration tokens never leave the server; the browser only learns whether
// something is connected.
function publicMember(m) {
  return {
    id: m.id,
    name: m.name,
    colorSlot: m.colorSlot,
    createdAt: m.createdAt,
    connected: {
      strava: Boolean(m.integrations?.strava),
      appleHealth: Boolean(m.integrations?.appleHealth),
    },
  };
}

// --- Runs ----------------------------------------------------------------------------------

app.post('/api/runs', requireEdit, async (req, res) => {
  const { run, error } = validateRun(req.body, await store.listMembers());
  if (error) return res.status(400).json({ error });
  res.json(await store.saveRun(run));
});

app.put('/api/runs/:id', requireEdit, async (req, res) => {
  const existing = await store.getRun(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const { run, error } = validateRun(req.body, await store.listMembers(), existing);
  if (error) return res.status(400).json({ error });
  res.json(await store.saveRun(run));
});

app.delete('/api/runs/:id', requireEdit, async (req, res) => {
  const existing = await store.getRun(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  await store.deleteRun(existing.id);
  res.json({ ok: true });
});

// API errors stay JSON so the page can show them.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (!req.path.startsWith('/api/')) return next(err);
  console.error(`${req.method} ${req.path} failed:`, err.message);
  res.status(err.status || 500).json({ error: 'Something went wrong. Please try again.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  Family Running Stats → http://localhost:${PORT}`);
  console.log(
    `  storage: ${store.storageBackend} · editing: ${EDIT_PASSWORD ? 'enabled' : 'DISABLED (no EDIT_PASSWORD)'}` +
      `${!IS_PROD && !process.env.EDIT_PASSWORD ? ' · local password is "run"' : ''}\n`
  );
});
