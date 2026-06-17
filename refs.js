/* Aloud — reference / citation manager scan (window.PRRefs).
 *
 * Cross-checks the project's \cite usage against its BibTeX sources and the compiled .bbl, surfacing the
 * citation-integrity defects that bibtex/biber report only as easily-missed log warnings:
 *   • undefined cites  — \cite{key} with no @entry{key} in any .bib            (compile error → "?" in PDF)
 *   • uncited entries  — @entry{key} never \cite'd                            (silently dropped from the .bbl)
 *   • duplicate keys   — the same @key defined in 2+ entries                  (last-wins, the rest are lost)
 *   • duplicate DOIs   — 2+ entries pointing at the same DOI                  (the same paper entered twice)
 *   • .bbl staleness   — compiled bibliography out of sync with the .bib/\cite (recompile needed)
 *
 * Multi-file aware: takes the whole `files` map (chapters that are not the active doc still count), and each
 * hit records which file + char offset it lives in so the panel can jump to it. Heuristic + navigable; it
 * flags candidates for the author to check and never auto-edits. Mirror of consistency.js's design.
 */
window.PRRefs = (function () {
  'use strict';
  function stripComments(s) { return s.replace(/(^|[^\\])%.*$/gm, '$1'); }
  function lineAt(s, off) { var n = 1; for (var i = 0; i < off && i < s.length; i++) if (s.charCodeAt(i) === 10) n++; return n; }
  // monotonic line counter: caller feeds strictly non-decreasing offsets (regex matches in order), so the
  // total work is O(len) instead of O(matches × len). Resets the scan cursor lazily if an offset goes back.
  function lineCounter(s) { var n = 1, i = 0; return function (off) { if (off < i) { n = 1; i = 0; } for (; i < off && i < s.length; i++) if (s.charCodeAt(i) === 10) n++; return n; }; }
  function snippet(s, off) { var a = Math.max(0, off - 6), b = Math.min(s.length, off + 60); return s.slice(a, b).replace(/\s+/g, ' ').trim(); }
  function normDoi(d) { return (d || '').trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '').replace(/^doi:\s*/, '').replace(/[#?].*$/, '').replace(/[).,;\]}\/]+$/, ''); }

  // read a BibTeX field value starting at `from` (index just after "name ="): handles {brace-balanced},
  // "quoted", and bare-token forms, returning the de-braced text and the index after the value.
  function readField(body, from) {
    var i = from; while (i < body.length && /\s/.test(body[i])) i++;
    if (body[i] === '{') {
      var depth = 0, out = '';
      for (; i < body.length; i++) { var c = body[i]; if (c === '{') { depth++; if (depth === 1) continue; } else if (c === '}') { depth--; if (depth === 0) { i++; break; } } out += c; }
      return { value: out.replace(/\s+/g, ' ').trim(), end: i };
    }
    if (body[i] === '"') {
      i++; var s = '';
      for (; i < body.length; i++) { if (body[i] === '"' && body[i - 1] !== '\\') { i++; break; } s += body[i]; }
      return { value: s.replace(/\s+/g, ' ').trim(), end: i };
    }
    var t = '';
    for (; i < body.length; i++) { if (body[i] === ',' || body[i] === '}' || body[i] === '\n') break; t += body[i]; }
    return { value: t.trim(), end: i };
  }
  // structural single-pass parse of an entry body "field = value, field = value, …" into a lowercased map.
  // Because each value is consumed via readField (brace/quote-aware), a "name =" appearing INSIDE a value
  // (e.g. "doi = 10.x" inside a note/abstract) can never be mistaken for a real field. `from` = index just
  // after the entry head's first comma.
  function parseFields(body, from) {
    var fields = {}, i = from, n = body.length, guard = 0;
    while (i < n && guard++ < 4000) {
      while (i < n && (body[i] === ',' || /\s/.test(body[i]))) i++;                       // skip separators
      if (i >= n || body[i] === '}') break;
      var name = '';
      while (i < n && /[A-Za-z0-9_-]/.test(body[i])) { name += body[i]; i++; }
      if (!name) { i++; continue; }                                                       // stray char — resync
      while (i < n && /\s/.test(body[i])) i++;
      if (body[i] !== '=') continue;                                                      // not "name = …"; resync at next sep
      var r = readField(body, i + 1), key = name.toLowerCase();
      if (!(key in fields)) fields[key] = r.value;
      i = r.end > i ? r.end : i + 1;
    }
    return fields;
  }
  function firstAuthor(a) {
    if (!a) return '';
    var first = a.split(/\s+and\s+/i)[0] || '';
    if (first.indexOf(',') >= 0) return first.split(',')[0].trim();       // "Family, Given"
    var parts = first.trim().split(/\s+/); return parts[parts.length - 1] || first.trim(); // "Given Family"
  }

  // enumerate every @entry across all .bib files, capturing key/type/doi/title/author/year + file offset.
  // Depth-aware head scan: an entry head is only accepted at brace-depth 0, so a literal "@type{…}" written
  // inside a field value (e.g. quoting raw BibTeX in a title/abstract) is not mistaken for a real entry.
  function parseBib(files) {
    var entries = [];
    Object.keys(files || {}).forEach(function (path) {
      var f = files[path]; if (!f || f.type !== 'bib' || !f.content) return;
      var b = f.content, re = /[{}]|@(\w+)\s*\{\s*([^,\s}]+)/g, m, heads = [], lc = lineCounter(b), depth = 0;
      while ((m = re.exec(b)) !== null) {
        if (m[0] === '{') { depth++; continue; }
        if (m[0] === '}') { if (depth > 0) depth--; continue; }
        if (depth !== 0) continue;                                                        // @type{ nested inside a value — ignore
        depth = 1;                                                                        // just consumed this entry's opening brace
        heads.push({ type: m[1].toLowerCase(), key: m[2], off: m.index, headEnd: re.lastIndex });
      }
      for (var i = 0; i < heads.length; i++) {
        var h = heads[i];
        if (h.type === 'comment' || h.type === 'preamble' || h.type === 'string') continue;
        var end = i + 1 < heads.length ? heads[i + 1].off : b.length;                    // body = [thisOff, nextOff] — no tail copy
        var body = b.slice(h.off, end);
        var comma = body.indexOf(',', h.headEnd - h.off);                                 // fields start after the key's comma
        var fields = comma >= 0 ? parseFields(body, comma + 1) : {};
        var doi = fields.doi ? normDoi(fields.doi) : '';
        if (!doi && fields.url) { var um = /(?:dx\.)?doi\.org\/(\S+)/i.exec(fields.url); if (um) doi = normDoi(um[1]); }
        entries.push({ key: h.key, type: h.type, file: path, off: h.off, line: lc(h.off),
          doi: doi, title: fields.title || '', author: fields.author || '', year: fields.year || ((fields.date || '').match(/\d{4}/) || [''])[0] });
      }
    });
    return entries;
  }

  // enumerate every \cite-family key across all .tex files (comments stripped), with file offset.
  function parseCites(files) {
    var cites = [];
    Object.keys(files || {}).forEach(function (path) {
      var f = files[path]; if (!f || f.type !== 'tex' || !f.content) return;
      var s = stripComments(f.content), lc = lineCounter(s);
      // case-insensitive (sentence-start \Citet/\Citep are normal natbib); negative lookahead drops the
      // non-key cite-family commands (\citestyle/\citetext/\citedash/\citepunct/\citereset/\citealias/…)
      // while keeping the key-bearing ones (\citeauthor/\citeyear/\citenum/\citealp/\citealt/…).
      var re = /\\(?:cite(?!style|text|dash|punct|reset|alias|color)[a-z]*|autocite[a-z]*|textcite|parencite|footcite|smartcite|fullcite|nocite)\*?(?:\[[^\]]*\])*\s*\{([^}]*)\}/gi, m;
      while ((m = re.exec(s)) !== null) {
        var ln = lc(m.index), gStart = m.index + m[0].lastIndexOf('{') + 1, cur = 0;       // first char inside the key group
        m[1].split(',').forEach(function (seg) {
          var k = seg.trim();
          if (k && k !== '*') { var keyOff = gStart + cur + (seg.length - seg.replace(/^\s+/, '').length); cites.push({ key: k, file: path, off: keyOff, line: ln, snippet: snippet(s, keyOff) }); }
          cur += seg.length + 1;                                                          // +1 for the consumed comma
        });
      }
    });
    return cites;
  }

  // enumerate \bibitem keys in compiled .bbl files (natbib & biblatex forms).
  function parseBbl(files) {
    var out = {}, present = false;
    Object.keys(files || {}).forEach(function (path) {
      var f = files[path]; if (!f || f.type !== 'bbl' || !f.content) return;
      present = true;
      var b = f.content, re = /\\bibitem(?:\[[^\]]*\])?\s*\{([^}]*)\}/g, m, lc = lineCounter(b);
      while ((m = re.exec(b)) !== null) { var k = m[1].trim(); if (k && !out[k]) out[k] = { file: path, off: m.index, line: lc(m.index) }; }
      var re2 = /\\entry\{([^}]*)\}/g;                                                    // biblatex .bbl
      while ((m = re2.exec(b)) !== null) { var k2 = m[1].trim(); if (k2 && !out[k2]) out[k2] = { file: path, off: m.index, line: lineAt(b, m.index) }; }
    });
    return { keys: out, present: present };
  }

  function scan(files) {
    files = files || {};
    var entries = parseBib(files), cites = parseCites(files), bbl = parseBbl(files);
    var byKey = {}, byKeyDup = {}, byDoi = {}, dupKeys = [], dupDois = [];
    entries.forEach(function (e) {
      if (byKey[e.key]) { if (!byKeyDup[e.key]) { byKeyDup[e.key] = true; dupKeys.push({ key: e.key, entries: [byKey[e.key], e] }); } else { dupKeys.forEach(function (d) { if (d.key === e.key) d.entries.push(e); }); } }
      else byKey[e.key] = e;
      if (e.doi) { if (byDoi[e.doi]) { var grp = null; dupDois.forEach(function (d) { if (d.doi === e.doi) grp = d; }); if (grp) grp.entries.push(e); else dupDois.push({ doi: e.doi, entries: [byDoi[e.doi], e] }); } else byDoi[e.doi] = e; }
    });
    var citedSet = {}; cites.forEach(function (c) { citedSet[c.key] = (citedSet[c.key] || 0) + 1; });

    // undefined cites: a key that is \cite'd but has no @entry (collapse multiple occurrences per key)
    var undefSeen = {}, undefinedCites = [];
    cites.forEach(function (c) {
      if (byKey[c.key] || bbl.keys[c.key]) return;                                        // defined in .bib or present in .bbl
      var u = undefSeen[c.key]; if (u) { u.count++; if (u.occ.length < 12) u.occ.push({ off: c.off, line: c.line, file: c.file, snippet: c.snippet }); }
      else { u = undefSeen[c.key] = { key: c.key, count: 1, occ: [{ off: c.off, line: c.line, file: c.file, snippet: c.snippet }] }; undefinedCites.push(u); }
    });
    // uncited entries: an @entry never \cite'd anywhere
    var uncited = entries.filter(function (e) { return !citedSet[e.key]; })
      .map(function (e) { return { key: e.key, file: e.file, off: e.off, line: e.line, title: e.title, author: firstAuthor(e.author), year: e.year }; });
    // .bbl staleness keyed off the CITED set (the honest "recompile bibtex" signal): a cited key that resolves
    // to a .bib entry but is missing from the .bbl, or a .bbl entry that is no longer cited. Uncited entries
    // are NOT counted here (bibtex correctly omits them — that is the "uncited" bucket, not staleness).
    var bblKeyList = Object.keys(bbl.keys);
    var citedNotInBbl = bbl.present ? Object.keys(citedSet).filter(function (k) { return byKey[k] && !bbl.keys[k]; }) : [];
    var bblNotInBib = bbl.present ? bblKeyList.filter(function (k) { return !byKey[k]; }) : [];
    var bblNotCited = bbl.present ? bblKeyList.filter(function (k) { return !citedSet[k] && byKey[k]; }) : []; // has a .bib source but no longer cited (orphans go in bblNotInBib only — no double-count)

    var report = {
      stats: { cites: cites.length, citedDistinct: Object.keys(citedSet).length, entries: entries.length, bibFiles: countType(files, 'bib'), bblItems: bblKeyList.length, bblPresent: bbl.present },
      entries: entries, cites: cites,
      undefinedCites: undefinedCites,
      uncited: uncited,
      dupKeys: dupKeys.map(function (d) { return { key: d.key, count: d.entries.length, occ: d.entries.map(function (e) { return { off: e.off, line: e.line, file: e.file, snippet: e.type }; }) }; }),
      dupDois: dupDois.map(function (d) { return { doi: d.doi, keys: d.entries.map(function (e) { return e.key; }), occ: d.entries.map(function (e) { return { off: e.off, line: e.line, file: e.file, snippet: e.key }; }) }; }),
      bblStale: { present: bbl.present, keys: bbl.keys, citedNotInBbl: citedNotInBbl, bblNotCited: bblNotCited, bblNotInBib: bblNotInBib, stale: bbl.present && (citedNotInBbl.length > 0 || bblNotInBib.length > 0) }
    };
    return report;
  }
  function countType(files, t) { var n = 0; Object.keys(files || {}).forEach(function (k) { if (files[k] && files[k].type === t && files[k].content) n++; }); return n; }

  // badge count = every actionable issue (errors + warnings). Mirror PRConsistency.conflicts.
  function issueCount(r) {
    if (!r) return 0;
    var bbl = r.bblStale ? (r.bblStale.citedNotInBbl.length + r.bblStale.bblNotCited.length + r.bblStale.bblNotInBib.length) : 0;
    return r.undefinedCites.length + r.uncited.length + r.dupKeys.length + r.dupDois.length + bbl;
  }
  // hard errors only (undefined cites + duplicate keys/DOIs + orphan .bbl items) — these break the build/PDF.
  function errorCount(r) { if (!r) return 0; return r.undefinedCites.length + r.dupKeys.length + r.dupDois.length + (r.bblStale ? r.bblStale.bblNotInBib.length : 0); }

  return { scan: scan, issueCount: issueCount, errorCount: errorCount, normDoi: normDoi, entries: parseBib };
})();
