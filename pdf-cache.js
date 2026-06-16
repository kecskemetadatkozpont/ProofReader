/* Aloud — compiled-PDF cache (window.PRPdfCache).
 *
 * The in-browser TeX compile is the slow step. We key a compile by a content hash of the
 * assembled input (main file + every text file's content + each binary's path+size). If the
 * hash is unchanged we reuse the existing PDF (no recompile); a persistent IndexedDB copy
 * lets a re-opened project load the last PDF instantly instead of compiling from scratch.
 */
window.PRPdfCache = (function () {
  'use strict';
  var DB = 'pr_pdf', STORE = 'pdf', _dbp = null;
  function openDB() {
    if (_dbp) return _dbp;
    _dbp = new Promise(function (res) {
      try {
        if (!window.indexedDB) return res(null);
        var q = indexedDB.open(DB, 1);
        q.onupgradeneeded = function () { try { q.result.createObjectStore(STORE); } catch (e) { } };
        q.onsuccess = function () { res(q.result); };
        q.onerror = function () { res(null); };
      } catch (e) { res(null); }
    });
    return _dbp;
  }
  // fast FNV-1a string hash → base36
  function h32(s) { var h = 0x811c9dc5; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
  // content signature of a binary: FNV-1a over a sampled subset + length, so a same-LENGTH content
  // swap (e.g. a re-exported figure) still invalidates the key.
  function byteSig(b) {
    var n = (b && (b.length != null ? b.length : b.byteLength)) || 0;
    if (!n) return '0:0';
    var h = 0x811c9dc5, step = Math.max(1, Math.floor(n / 4096));
    for (var i = 0; i < n; i += step) { h ^= b[i]; h = Math.imul(h, 16777619); }
    h ^= n; h = Math.imul(h, 16777619);
    return (h >>> 0).toString(36) + ':' + n;
  }

  // content hash of the assembled compile input ({ mainFile, files:[{path, text|bytes}] })
  function hashOf(input, mode) {
    if (!input) return '0';
    var parts = [(mode || 'browser') + '|m:' + (input.mainFile || '')];
    (input.files || []).forEach(function (f) {
      if (f.text != null) parts.push('t:' + f.path + ':' + f.text);
      else if (f.bytes) parts.push('b:' + f.path + ':' + byteSig(f.bytes));
      else parts.push('e:' + f.path);
    });
    return h32(parts.join(''));
  }
  function get(k) {
    return openDB().then(function (db) {
      if (!db) return null;
      return new Promise(function (res) {
        try { var r = db.transaction(STORE, 'readonly').objectStore(STORE).get(k); r.onsuccess = function () { res(r.result || null); }; r.onerror = function () { res(null); }; }
        catch (e) { res(null); }
      });
    }).catch(function () { return null; });
  }
  var MAX = 16; // bound the cache: keep the most recent N compiled PDFs
  function put(k, v) {
    if (k === '__idx') return Promise.resolve(false);
    v = v || {}; if (v.ts == null) v.ts = 0;
    return openDB().then(function (db) {
      if (!db) return false;
      return new Promise(function (res) {
        try {
          var tx = db.transaction(STORE, 'readwrite'), os = tx.objectStore(STORE);
          os.put(v, k);
          var ir = os.get('__idx');
          ir.onsuccess = function () {
            var idx = (ir.result && ir.result.list) || [];
            idx = idx.filter(function (e) { return e.k !== k; });
            idx.push({ k: k, ts: v.ts || 0 });
            idx.sort(function (a, b) { return a.ts - b.ts; });
            while (idx.length > MAX) { var ev = idx.shift(); try { os.delete(ev.k); } catch (e) { } }
            try { os.put({ list: idx }, '__idx'); } catch (e) { }
          };
          tx.oncomplete = function () { res(true); }; tx.onerror = tx.onabort = function () { res(false); };
        } catch (e) { res(false); }
      });
    }).catch(function () { return false; });
  }
  return { hashOf: hashOf, get: get, put: put };
})();
