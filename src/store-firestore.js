// Firestore backend — used on Cloud Run (or with USE_FIRESTORE=1), with the
// environment's default credentials. The project is shared with other Opus
// tools, hence the running_ prefix on every collection.

import { Firestore } from '@google-cloud/firestore';

const db = new Firestore();
const members = db.collection('running_members');
const runs = db.collection('running_runs');

export async function listMembers() {
  const snap = await members.get();
  return snap.docs.map((d) => d.data()).sort((a, b) => a.colorSlot - b.colorSlot);
}

export async function getMember(id) {
  const doc = await members.doc(id).get();
  return doc.exists ? doc.data() : null;
}

export async function saveMember(member) {
  await members.doc(member.id).set(member);
  return member;
}

// A member's runs go with them; orphaned runs would break every per-member stat.
export async function deleteMember(id) {
  const snap = await runs.where('memberId', '==', id).get();
  const batch = db.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  batch.delete(members.doc(id));
  await batch.commit();
}

export async function listRuns() {
  const snap = await runs.get();
  return snap.docs.map((d) => d.data()).sort(byDateDesc);
}

export async function getRun(id) {
  const doc = await runs.doc(id).get();
  return doc.exists ? doc.data() : null;
}

export async function saveRun(run) {
  await runs.doc(run.id).set(run);
  return run;
}

export async function deleteRun(id) {
  await runs.doc(id).delete();
}

function byDateDesc(a, b) {
  return a.date === b.date ? b.createdAt.localeCompare(a.createdAt) : b.date.localeCompare(a.date);
}
