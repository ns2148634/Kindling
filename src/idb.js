const DB_NAME = 'kindling';
const DB_VERSION = 1;
let _db;

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('kingdom'))
        d.createObjectStore('kingdom', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('daily'))
        d.createObjectStore('daily', { keyPath: 'date' });
      if (!d.objectStoreNames.contains('codex'))
        d.createObjectStore('codex', { keyPath: 'id' });
    };
    req.onsuccess = e => { _db = e.target.result; resolve(_db); };
    req.onerror   = e => reject(e.target.error);
  });
}

function tx(store, mode, fn) {
  return openDB().then(d => new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    const req = fn(s);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  }));
}

export const idb = {
  get: (store, key)   => tx(store, 'readonly',  s => s.get(key)),
  put: (store, value) => tx(store, 'readwrite', s => s.put(value)),
};
