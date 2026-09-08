// Firestore backend — used on Cloud Run (or with USE_FIRESTORE=1), with the
// environment's default credentials. The project is shared with other Opus
// tools, hence the running_ prefix on every collection.

import { Firestore } from '@google-cloud/firestore';
import { SEED_MEMBERS, newMember } from './model.js';

const db = new Firestore();
const members = db.collection('running_members');
const activities = db.collection('running_activities');
const nudges = db.collection('running_nudges');

export async function listMembers() {
  const snap = await members.get();
  if (snap.empty) {
    const seeded = SEED_MEMBERS.map(newMember);
    await Promise.all(seeded.map((m) => members.doc(m.id).set(m)));
    return seeded;
  }
  return snap.docs.map((d) => d.data()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getMember(id) {
  const doc = await members.doc(id).get();
  return doc.exists ? doc.data() : null;
}

export async function saveMember(member) {
  await members.doc(member.id).set(member);
  return member;
}

// A member's activities go with them; orphaned rows would break every stat.
export async function deleteMember(id) {
  const snap = await activities.where('memberId', '==', id).get();
  const batch = db.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  batch.delete(members.doc(id));
  await batch.commit();
}

export async function listActivities() {
  const snap = await activities.get();
  return snap.docs.map((d) => d.data()).sort(byDateDesc);
}

export async function getActivity(id) {
  const doc = await activities.doc(id).get();
  return doc.exists ? doc.data() : null;
}

export async function saveActivity(activity) {
  await activities.doc(activity.id).set(activity);
  return activity;
}

export async function deleteActivity(id) {
  await activities.doc(id).delete();
}

export async function listNudges() {
  const snap = await nudges.get();
  return snap.docs.map((d) => d.data()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function saveNudges(list) {
  if (!list.length) return;
  const batch = db.batch();
  list.forEach((n) => batch.set(nudges.doc(n.id), n));
  await batch.commit();
}

function byDateDesc(a, b) {
  return a.date === b.date ? b.createdAt.localeCompare(a.createdAt) : b.date.localeCompare(a.date);
}
