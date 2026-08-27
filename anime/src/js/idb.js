'use strict';

const IDB = (() => {
  const DB = 'kaze-db', STORE = 'handles';
  let dbp = null;

  function db() {
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbp;
  }

  async function get(key) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const t = d.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      t.onsuccess = () => resolve(t.result);
      t.onerror = () => reject(t.error);
    });
  }

  async function set(key, val) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const t = d.transaction(STORE, 'readwrite').objectStore(STORE).put(val, key);
      t.onsuccess = () => resolve();
      t.onerror = () => reject(t.error);
    });
  }

  return { get, set };
})();
