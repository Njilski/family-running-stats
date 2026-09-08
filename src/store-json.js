// Local JSON-file backend — development only. Same async API as the Firestore
// backend so server code is identical.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEED_MEMBERS, newMember } from './model.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, '..', 'data', 'store.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return { members: [], activities: [], nudges: [] };
  }
}

function save() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

const db = load();
db.nudges ||= [];

export async function listMembers() {
  if (db.members.length === 0) {
    db.members = SEED_MEMBERS.map(newMember);
    save();
  }
  return [...db.members].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getMember(id) {
  return (await listMembers()).find((m) => m.id === id) || null;
}

export async function saveMember(member) {
  await listMembers();
  const i = db.members.findIndex((m) => m.id === member.id);
  if (i >= 0) db.members[i] = member;
  else db.members.push(member);
  save();
  return member;
}

export async function deleteMember(id) {
  db.members = db.members.filter((m) => m.id !== id);
  db.activities = db.activities.filter((a) => a.memberId !== id);
  save();
}

export async function listActivities() {
  return [...db.activities].sort(byDateDesc);
}

export async function getActivity(id) {
  return db.activities.find((a) => a.id === id) || null;
}

export async function saveActivity(activity) {
  const i = db.activities.findIndex((a) => a.id === activity.id);
  if (i >= 0) db.activities[i] = activity;
  else db.activities.push(activity);
  save();
  return activity;
}

export async function deleteActivity(id) {
  db.activities = db.activities.filter((a) => a.id !== id);
  save();
}

export async function listNudges() {
  return [...db.nudges].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function saveNudges(list) {
  for (const n of list) {
    const i = db.nudges.findIndex((x) => x.id === n.id);
    if (i >= 0) db.nudges[i] = n;
    else db.nudges.push(n);
  }
  if (list.length) save();
}

function byDateDesc(a, b) {
  return a.date === b.date ? b.createdAt.localeCompare(a.createdAt) : b.date.localeCompare(a.date);
}
