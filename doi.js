/* Aloud — DOI → BibTeX lookup (window.PRDoi).
 *
 * Resolves a DOI to a ready-to-paste BibTeX entry via the Crossref REST API (api.crossref.org is CORS-open
 * with Access-Control-Allow-Origin:*, unlike doi.org content-negotiation), synthesising the BibTeX
 * client-side so no server is needed. Results are cached in IndexedDB (DOIs are public + immutable) so repeat
 * lookups are free and offline-friendly. Mirrors the eleven.js cache pattern. No API key required; a ?mailto=
 * contact joins Crossref's faster "polite pool".
 */
window.PRDoi = (function () {
  'use strict';
  var IDB_NAME = 'pr_doi', IDB_STORE = 'bibtex', _dbp = null, mem = {}, inflight = {};
  var MAILTO = 'aloud@kecskemetadatkozpont.github.io';

  function openDB() {
    if (_dbp) return _dbp;
    _dbp = new Promise(function (resolve) {
      try {
        var rq = indexedDB.open(IDB_NAME, 1);
        rq.onupgradeneeded = function () { try { rq.result.createObjectStore(IDB_STORE); } catch (e) {} };
        rq.onsuccess = function () { resolve(rq.result); };
        rq.onerror = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
    return _dbp;
  }
  function idbGet(k) {
    return openDB().then(function (db) {
      if (!db) return null;
      return new Promise(function (resolve) {
        try { var tx = db.transaction(IDB_STORE, 'readonly'), rq = tx.objectStore(IDB_STORE).get(k); rq.onsuccess = function () { resolve(rq.result || null); }; rq.onerror = function () { resolve(null); }; }
        catch (e) { resolve(null); }
      });
    });
  }
  function idbPut(k, v) {
    return openDB().then(function (db) {
      if (!db) return; try { var tx = db.transaction(IDB_STORE, 'readwrite'); tx.objectStore(IDB_STORE).put(v, k); } catch (e) {}
    });
  }

  function normDoi(s) { return (s || '').trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '').replace(/\s+/g, '').replace(/[.,;]+$/, ''); }
  function looksLikeDoi(s) { return /^10\.\d+\/\S+$/.test(normDoi(s)); }

  function braceSafe(v) { return String(v == null ? '' : v).replace(/[{}]/g, '').replace(/\\/g, '').trim(); }
  function texEsc(v) { return braceSafe(v).replace(/([&%$#_])/g, '\\$1'); }                              // escape LaTeX specials in prose field values
  function slug(s) { return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ''); }
  var CR_TYPE = { 'journal-article': 'article', 'proceedings-article': 'inproceedings', 'book-chapter': 'incollection', 'book': 'book', 'monograph': 'book', 'report': 'techreport', 'dissertation': 'phdthesis', 'posted-content': 'misc', 'dataset': 'misc' };

  function crossrefToBibtex(m, doi) {
    if (!m) throw new Error('No metadata');
    var firstFam = (m.author && m.author[0] && (m.author[0].family || m.author[0].name)) || 'ref';
    var year = (m.issued && m.issued['date-parts'] && m.issued['date-parts'][0] && m.issued['date-parts'][0][0]) ||
               (m.published && m.published['date-parts'] && m.published['date-parts'][0] && m.published['date-parts'][0][0]) || '';
    var titleWord = ((m.title && m.title[0]) || '').split(/\s+/).filter(function (w) { return slug(w).length > 2; })[0] || '';
    var key = slug(firstFam) + (year || '') + slug(titleWord).slice(0, 8);
    if (!key) key = slug(doi) || 'ref';                                                  // non-Latin author + no year + no ASCII title word → fall back to the DOI so the entry is never @misc{,
    var type = CR_TYPE[m.type] || 'misc';
    var nm = function (a) { return a.family ? (braceSafe(a.family) + (a.given ? ', ' + braceSafe(a.given) : '')) : braceSafe(a.name); };
    var authors = (m.author || []).map(nm).filter(Boolean).join(' and ');
    var editors = (m.editor || []).map(nm).filter(Boolean).join(' and ');
    var f = [];
    function add(k, v) { v = braceSafe(v); if (v) f.push('  ' + k + ' = {' + v + '}'); }                 // literal fields (doi/url/pages/year/…) — do NOT LaTeX-escape
    function addT(k, v) { v = texEsc(v); if (v) f.push('  ' + k + ' = {' + v + '}'); }                    // prose fields — escape & % $ # _ so the entry compiles when cited
    addT('title', (m.title || [])[0]);
    addT('author', authors);
    if (editors) addT('editor', editors);
    if (type === 'inproceedings' || type === 'incollection') addT('booktitle', (m['container-title'] || [])[0]);
    else addT('journal', (m['container-title'] || [])[0]);
    add('year', year);
    add('volume', m.volume); add('number', m.issue); add('pages', braceSafe(m.page).replace(/[-–—]+/g, '--'));
    addT('publisher', m.publisher); add('doi', doi); add('url', m.URL);
    return { key: key, type: type, bibtex: '@' + type + '{' + key + ',\n' + f.join(',\n') + '\n}\n', title: (m.title || [])[0] || '', year: year };
  }

  function fetchDoi(doi) {
    var url = 'https://api.crossref.org/works/' + encodeURIComponent(doi) + '?mailto=' + encodeURIComponent(MAILTO);
    return fetch(url, { headers: { Accept: 'application/json' } }).then(function (r) {
      if (r.status === 404) throw new Error('DOI not found in Crossref: ' + doi);
      if (!r.ok) throw new Error('Crossref returned ' + r.status + ' for ' + doi);
      return r.json();
    }).then(function (j) { return crossrefToBibtex(j && j.message, doi); });
  }

  // cache chain: in-memory → IndexedDB → network (mirrors eleven.js getAudio). Returns {key,type,bibtex,title,year}.
  function get(rawDoi) {
    var doi = normDoi(rawDoi);
    if (!looksLikeDoi(doi)) return Promise.reject(new Error('"' + rawDoi + '" is not a valid DOI (expected 10.xxxx/…).'));
    if (mem[doi]) return Promise.resolve(mem[doi]);
    if (inflight[doi]) return inflight[doi];
    var p = idbGet(doi).then(function (hit) {
      if (hit) return hit;
      return fetchDoi(doi).then(function (res) { idbPut(doi, res); return res; });
    }).then(function (res) { mem[doi] = res; delete inflight[doi]; return res; }, function (e) { delete inflight[doi]; throw e; });
    inflight[doi] = p; return p;
  }

  return { get: get, normalize: normDoi, looksLikeDoi: looksLikeDoi, _toBibtex: crossrefToBibtex };
})();
