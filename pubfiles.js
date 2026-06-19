/* Aloud — per-publication file store (window.PRPubFiles).
 * Files a researcher attaches to one of their publications (PDF, data, supplementary). Blobs live in
 * IndexedDB (this browser), keyed by pubKey = "<email>:<mtid>"; metadata is returned for listing. */
window.PRPubFiles = (function () {
  'use strict';
  var DB = 'pr_pubfiles', STORE = 'files', _dbp = null;
  function openDB() {
    if (_dbp) return _dbp;
    _dbp = new Promise(function (res) {
      try {
        if (!window.indexedDB) return res(null);
        var rq = indexedDB.open(DB, 1);
        rq.onupgradeneeded = function () {
          var db = rq.result;
          if (!db.objectStoreNames.contains(STORE)) {
            var os = db.createObjectStore(STORE, { keyPath: 'id' });
            os.createIndex('pubKey', 'pubKey', { unique: false });
          }
        };
        rq.onsuccess = function () { res(rq.result); };
        rq.onerror = function () { res(null); };
        rq.onblocked = function () { res(null); }; // another tab holds an older version open — don't hang forever
      } catch (e) { res(null); }
    });
    return _dbp;
  }
  function uid() { return 'f_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8); }
  function meta(r) { return { id: r.id, pubKey: r.pubKey, name: r.name, type: r.type, size: r.size, at: r.at }; }

  // add a File/Blob to a publication; resolves the stored metadata (without the blob)
  function add(pubKey, file) {
    if (!file) return Promise.reject(new Error('No file'));
    return openDB().then(function (db) {
      if (!db) throw new Error('Storage unavailable in this browser.');
      var rec = { id: uid(), pubKey: pubKey, name: file.name || 'file', type: file.type || '', size: file.size || 0, at: Date.now(), blob: file };
      return new Promise(function (res, rej) {
        try { var tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(rec); tx.oncomplete = function () { res(meta(rec)); }; tx.onerror = tx.onabort = function () { rej(tx.error || new Error('Write failed (storage full?)')); }; }
        catch (e) { rej(e); }
      });
    });
  }
  // list metadata for a publication, newest first
  function list(pubKey) {
    return openDB().then(function (db) {
      if (!db) return [];
      return new Promise(function (res) {
        try {
          var idx = db.transaction(STORE, 'readonly').objectStore(STORE).index('pubKey');
          var rq = idx.getAll(pubKey);
          rq.onsuccess = function () { res((rq.result || []).map(meta).sort(function (a, b) { return b.at - a.at; })); };
          rq.onerror = function () { res([]); };
        } catch (e) { res([]); }
      });
    }).catch(function () { return []; });
  }
  // count per pubKey for badges — returns a map { pubKey: n }. Uses a key-cursor over the pubKey index so
  // it tallies keys without loading the file blobs into memory.
  function counts(pubKeys) {
    var want = {}; (pubKeys || []).forEach(function (k) { want[k] = 0; });
    return openDB().then(function (db) {
      if (!db) return want;
      return new Promise(function (res) {
        try {
          var cur = db.transaction(STORE, 'readonly').objectStore(STORE).index('pubKey').openKeyCursor();
          cur.onsuccess = function () { var c = cur.result; if (c) { if (c.key in want) want[c.key]++; c.continue(); } else res(want); };
          cur.onerror = function () { res(want); };
        } catch (e) { res(want); }
      });
    }).catch(function () { return want; });
  }
  function getBlob(id) {
    return openDB().then(function (db) {
      if (!db) return null;
      return new Promise(function (res) {
        try { var rq = db.transaction(STORE, 'readonly').objectStore(STORE).get(id); rq.onsuccess = function () { res(rq.result ? rq.result.blob : null); }; rq.onerror = function () { res(null); }; }
        catch (e) { res(null); }
      });
    }).catch(function () { return null; });
  }
  function remove(id) {
    return openDB().then(function (db) {
      if (!db) return false;
      return new Promise(function (res) {
        try { var tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).delete(id); tx.oncomplete = function () { res(true); }; tx.onerror = tx.onabort = function () { res(false); }; }
        catch (e) { res(false); }
      });
    }).catch(function () { return false; });
  }
  return { add: add, list: list, counts: counts, getBlob: getBlob, remove: remove };
})();
