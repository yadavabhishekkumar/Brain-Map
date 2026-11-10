// Local IndexedDB so the phone always has a copy of your data,
// even if the cloud backend becomes unreachable.
const DB_NAME = 'upsc_local';
const DB_VERSION = 2;
const MIRROR = 'mirror';
const CANVAS = 'canvasContent';

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(MIRROR)) db.createObjectStore(MIRROR);
      if (!db.objectStoreNames.contains(CANVAS)) db.createObjectStore(CANVAS);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function read(store, key) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).get(key);
        req.onsuccess = () => { db.close(); resolve(req.result || null); };
        req.onerror = () => { db.close(); reject(req.error); };
      })
  );
}

function write(store, key, obj) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(obj, key);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      })
  );
}

// Merge a partial update into the home mirror (best-effort; never throws).
export async function saveMirror(patch) {
  try {
    const existing = (await read(MIRROR, 'latest')) || {};
    await write(MIRROR, 'latest', { ...existing, ...patch, savedAt: new Date().toISOString() });
  } catch (e) {
    // Ignore — the mirror is a convenience, not the source of truth.
  }
}

export async function loadMirror() {
  try {
    return (await read(MIRROR, 'latest')) || null;
  } catch (e) {
    return null;
  }
}

// Save the full content of a canvas (canvas + nodes + edges + parents) so it
// can be opened read-only offline.
export async function saveCanvasContent(canvasId, data) {
  try {
    await write(CANVAS, canvasId, data);
  } catch (e) {
    // Ignore — best-effort.
  }
}

export async function loadCanvasContent(canvasId) {
  try {
    return (await read(CANVAS, canvasId)) || null;
  } catch (e) {
    return null;
  }
}

