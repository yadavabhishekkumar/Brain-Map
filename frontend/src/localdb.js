// Local IndexedDB mirror so the phone always has a copy of your data,
// even if the cloud backend becomes unreachable.
const DB_NAME = 'upsc_local';
const DB_VERSION = 1;
const STORE = 'mirror';

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readLatest() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get('latest');
    req.onsuccess = () => { db.close(); resolve(req.result || null); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

async function writeLatest(obj) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(obj, 'latest');
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

// Merge a partial update into the local mirror (best-effort; never throws).
export async function saveMirror(patch) {
  try {
    const existing = (await readLatest()) || {};
    await writeLatest({ ...existing, ...patch, savedAt: new Date().toISOString() });
  } catch (e) {
    // Ignore — the mirror is a convenience, not the source of truth.
  }
}

// Read the current local mirror (or null).
export async function loadMirror() {
  try {
    return (await readLatest()) || null;
  } catch (e) {
    return null;
  }
}
