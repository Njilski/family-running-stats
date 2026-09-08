// Local JSON-file backend — development only. Same async API as the Firestore
// backend so server code is identical.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, '..', 'data', 'store.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return { members: [], runs: [] };
  }
}

function save() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

const db = load();

export async function listMembers() {
  return [...db.members].sort((a, b) => a.colorSlot - b.colorSlot);
}

export async function getMember(id) {
  return db.members.find((m) => m.id === id) || null;
}

export async function saveMember(member) {
  const i = db.members.findIndex((m) => m.id === member.id);
  if (i >= 0) db.members[i] = member;
  else db.members.push(member);
  save();
  return member;
}

export async function deleteMember(id) {
  db.members = db.members.filter((m) => m.id !== id);
  db.runs = db.runs.filter((r) => r.memberId !== id);
  save();
}

export async function listRuns() {
  return [...db.runs].sort(byDateDesc);
}

export async function getRun(id) {
  return db.runs.find((r) => r.id === id) || null;
}

export async function saveRun(run) {
  const i = db.runs.findIndex((r) => r.id === run.id);
  if (i >= 0) db.runs[i] = run;
  else db.runs.push(run);
  save();
  return run;
}

export async function deleteRun(id) {
  db.runs = db.runs.filter((r) => r.id !== id);
  save();
}

function byDateDesc(a, b) {
  return a.date === b.date ? b.createdAt.localeCompare(a.createdAt) : b.date.localeCompare(a.date);
}
