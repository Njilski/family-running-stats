// Storage facade. Firestore on Cloud Run (K_SERVICE is set there) or when
// USE_FIRESTORE=1; a local JSON file otherwise. Both backends share the same
// async API, so server.js doesn't care which one is active.

const useFirestore = Boolean(process.env.K_SERVICE || process.env.USE_FIRESTORE);

const impl = useFirestore
  ? await import('./store-firestore.js')
  : await import('./store-json.js');

export const storageBackend = useFirestore ? 'firestore' : 'json-file';
export const {
  listMembers,
  getMember,
  saveMember,
  deleteMember,
  listRuns,
  getRun,
  saveRun,
  deleteRun,
} = impl;
