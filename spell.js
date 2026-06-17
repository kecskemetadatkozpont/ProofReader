/* Aloud — spell checker (window.PRSpell).
 *
 * Real Hunspell (compiled to WASM, vendored at vendor/hunspell-bundle.js) running in a Web Worker so a
 * 400 KB thesis can be checked without janking the editor. Hungarian + English dictionaries are fetched
 * on demand from jsdelivr and cached in IndexedDB (≈4 MB for HU — one-time). The check is LaTeX-aware:
 * commands, math, comments, verbatim and the non-prose arguments of \label/\cite/\ref/\input/… are
 * skipped so only real prose words are flagged. Heuristic + navigable — it flags candidates and offers
 * suggestions, it never auto-edits. Pure JS spell libs (Typo.js, nspell) cannot handle the agglutinative
 * Hungarian dictionary (parse error / multi-GB OOM); the WASM Hunspell does it in ~100 ms / ~7 MB.
 */
window.PRSpell = (function () {
  'use strict';

  var DICT = {
    en: { aff: 'https://cdn.jsdelivr.net/npm/dictionary-en/index.aff', dic: 'https://cdn.jsdelivr.net/npm/dictionary-en/index.dic' },
    hu: { aff: 'https://cdn.jsdelivr.net/npm/dictionary-hu/index.aff', dic: 'https://cdn.jsdelivr.net/npm/dictionary-hu/index.dic' }
  };
  var LANGS = { en: 'English', hu: 'Magyar' };

  /* ---------------- IndexedDB cache for dictionary buffers ---------------- */
  function openDB() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open('pr_spell', 1);
      r.onupgradeneeded = function () { var db = r.result; if (!db.objectStoreNames.contains('dict')) db.createObjectStore('dict'); };
      r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); };
    });
  }
  function idbGet(key) {
    return openDB().then(function (db) {
      return new Promise(function (res) { var tx = db.transaction('dict', 'readonly'); var rq = tx.objectStore('dict').get(key); rq.onsuccess = function () { res(rq.result || null); }; rq.onerror = function () { res(null); }; });
    }).catch(function () { return null; });
  }
  function idbPut(key, val) {
    return openDB().then(function (db) {
      return new Promise(function (res) { var tx = db.transaction('dict', 'readwrite'); tx.objectStore('dict').put(val, key); tx.oncomplete = function () { res(true); }; tx.onerror = function () { res(false); }; });
    }).catch(function () { return false; });
  }

  // fetch+cache the {aff,dic} byte buffers for a language
  function loadDict(lang) {
    var d = DICT[lang]; if (!d) return Promise.reject(new Error('No dictionary for "' + lang + '"'));
    return idbGet('dict:' + lang).then(function (cached) {
      if (cached && cached.aff && cached.dic) return cached;
      return Promise.all([fetch(d.aff), fetch(d.dic)]).then(function (rs) {
        if (!rs[0].ok || !rs[1].ok) throw new Error('Dictionary download failed (' + rs[0].status + '/' + rs[1].status + ')');
        return Promise.all([rs[0].arrayBuffer(), rs[1].arrayBuffer()]);
      }).then(function (bufs) {
        var rec = { aff: new Uint8Array(bufs[0]), dic: new Uint8Array(bufs[1]) };
        idbPut('dict:' + lang, rec); return rec;
      });
    });
  }

  /* ---------------- Web Worker (Hunspell host) ---------------- */
  // built from a blob so there is no separate worker file to path/serve; it importScripts the vendored bundle.
  var worker = null, seq = 0, pending = {}, loaded = {};
  function bundleUrl() { return new URL('vendor/hunspell-bundle.js', document.baseURI).href; }
  function workerSource() {
    return [
      'var BUNDLE=' + JSON.stringify(bundleUrl()) + ';',
      'importScripts(BUNDLE);',
      'var hf=null, inst={};',
      'function reply(id,ok,data){ postMessage(Object.assign({id:id,ok:ok},data||{})); }',
      'onmessage=function(e){',
      '  var m=e.data, id=m.id;',
      '  (async function(){',
      '    try{',
      '      if(!hf){ hf=await self.HunspellAsm.loadModule(); }',
      '      if(m.type==="load"){',
      '        if(!inst[m.lang]){ var ap=hf.mountBuffer(m.aff,m.lang+".aff"), dp=hf.mountBuffer(m.dic,m.lang+".dic"); inst[m.lang]=hf.create(ap,dp); }',
      '        return reply(id,true,{lang:m.lang});',
      '      }',
      '      var h=inst[m.lang]; if(!h){ return reply(id,false,{err:"lang not loaded"}); }',
      '      if(m.type==="check"){ var bad=[]; for(var i=0;i<m.words.length;i++){ if(!h.spell(m.words[i])) bad.push(m.words[i]); } return reply(id,true,{bad:bad}); }',
      '      if(m.type==="suggest"){ return reply(id,true,{suggestions:(h.suggest(m.word)||[]).slice(0,8)}); }',
      '      reply(id,false,{err:"unknown type"});',
      '    }catch(err){ reply(id,false,{err:String(err&&err.message||err)}); }',
      '  })();',
      '};'
    ].join('\n');
  }
  function ensureWorker() {
    if (worker) return worker;
    var blob = new Blob([workerSource()], { type: 'text/javascript' });
    worker = new Worker(URL.createObjectURL(blob));
    worker.onmessage = function (e) { var m = e.data, p = pending[m.id]; if (!p) return; delete pending[m.id]; if (m.ok) p.res(m); else p.rej(new Error(m.err || 'spell worker error')); };
    worker.onerror = function (e) {
      Object.keys(pending).forEach(function (k) { pending[k].rej(new Error('spell worker crashed: ' + (e.message || ''))); delete pending[k]; });
      try { worker.terminate(); } catch (_) { }
      worker = null; loaded = {};                                                          // rebuild on the next call (a stuck dead worker would otherwise hang every scan forever)
    };
    return worker;
  }
  function call(msg, transfer) {
    return new Promise(function (res, rej) { var id = ++seq; pending[id] = { res: res, rej: rej }; try { ensureWorker().postMessage(Object.assign({ id: id }, msg), transfer || []); } catch (e) { delete pending[id]; rej(e); } });
  }

  // ensure a language's dictionary is downloaded + loaded into the worker (once)
  function ensureLang(lang) {
    if (loaded[lang]) return loaded[lang];
    loaded[lang] = loadDict(lang).then(function (rec) {
      // copy buffers (they may be transferred / detached); transfer copies to the worker
      var aff = rec.aff.slice(), dic = rec.dic.slice();
      return call({ type: 'load', lang: lang, aff: aff, dic: dic }, [aff.buffer, dic.buffer]);
    });
    loaded[lang].catch(function () { delete loaded[lang]; }); // allow retry on failure
    return loaded[lang];
  }

  /* ---------------- LaTeX-aware tokenizer ---------------- */
  // commands whose brace/bracket argument is an identifier/path/URL, NOT prose to spell-check
  var SKIP_ARG = /^(label|ref|eqref|autoref|cref|Cref|pageref|nameref|vref|cite|citep|citet|citeauthor|citeyear|citenum|citealp|citealt|nocite|autocite|textcite|parencite|footcite|input|include|includeonly|includegraphics|usepackage|RequirePackage|documentclass|bibliography|bibliographystyle|addbibresource|url|href|hyperref|hypersetup|newcommand|renewcommand|providecommand|def|newenvironment|definecolor|color|textcolor|colorbox|pagecolor|geometry|setlength|addtolength|setcounter|usetikzlibrary|tikzset|pgfplotsset|graphicspath|DeclareMathOperator|si|SI|num|ang|lstinputlisting|verbatiminput|labelformat|crefname|Crefname|bibitem|cline|multicolumn|email)$/;
  // environments whose body is not prose (math / code)
  var SKIP_ENV = /^(equation|equation\*|align|align\*|alignat|alignat\*|gather|gather\*|multline|multline\*|flalign|flalign\*|math|displaymath|eqnarray|eqnarray\*|verbatim|lstlisting|minted|Verbatim|tikzpicture|tabular|tabularx|array|matrix|bmatrix|pmatrix|vmatrix)$/;
  // \p{L} (any Unicode letter) keeps the source encoding-independent — embedding raw accented chars in a
  // regex character class breaks if the script is ever decoded as Latin-1. Edge chars: ASCII '/-' + curly ’.
  var WORD = /[\p{L}][\p{L}'’\-]*/gu;
  var EDGE = /^['’\-]+|['’\-]+$/g, EDGE_L = /^['’\-]+/;
  // academic abbreviations (HU + EN) that no general dictionary contains — always noise, never real misspellings
  var ABBR = { pl: 1, ill: 1, stb: 1, vö: 1, ún: 1, kb: 1, ti: 1, vmint: 1, vs: 1, etc: 1, cf: 1, eg: 1, ie: 1, ca: 1, viz: 1, ibid: 1, et: 1, al: 1, pp: 1, eds: 1, resp: 1, approx: 1 };

  // returns prose words with absolute source offsets; LaTeX markup excluded
  function tokenize(src) {
    var prose = stripLatex(src);                    // same length as src (markup → spaces), so offsets line up
    var out = [], m;
    WORD.lastIndex = 0;
    while ((m = WORD.exec(prose)) !== null) {
      var w = m[0].replace(EDGE, '');
      if (w.length < 2) continue;                    // single letters
      if (/\d/.test(w)) continue;                    // anything with a digit (defensive)
      if (/^\p{Lu}+$/u.test(w)) continue;            // ALL-CAPS acronym (OOD, AUROC, ID) — not a spelling error
      if (/\p{Lu}/u.test(w.slice(1))) continue;      // internal capital (LiDAR, CamelCase) — proper noun / tech term
      if (m.index >= 2 && prose[m.index - 1] === '-' && /[0-9]/.test(prose[m.index - 2])) continue; // suffix on a number/acronym ("2000-es", "50-es")
      var start = m.index + (m[0].length - m[0].replace(EDGE_L, '').length);
      out.push({ word: w, start: start, end: start + w.length });
    }
    return out;
  }

  // replace every non-prose region with same-length spaces so word offsets remain valid against the original
  function stripLatex(src) {
    var n = src.length, a = src.split(''), i = 0;
    function blank(s, e) { for (var k = s; k < e && k < n; k++) if (a[k] !== '\n') a[k] = ' '; }
    while (i < n) {
      var c = src[i];
      if (c === '%' && (i === 0 || src[i - 1] !== '\\')) { var j = i; while (j < n && src[j] !== '\n') j++; blank(i, j); i = j; continue; }
      if (c === '$') { var dd = src[i + 1] === '$'; var k = i + (dd ? 2 : 1); while (k < n) { if (src[k] === '\\') { k += 2; continue; } if (src[k] === '$') { break; } k++; } k += dd ? 2 : 1; blank(i, Math.min(k, n)); i = Math.min(k, n); continue; }
      if (c === '\\') {
        // \[ \] \( \) math
        if (src[i + 1] === '[' || src[i + 1] === '(') { var close = src[i + 1] === '[' ? '\\]' : '\\)'; var e = src.indexOf(close, i + 2); e = e < 0 ? n : e + 2; blank(i, e); i = e; continue; }
        // control word
        if (/[a-zA-Z]/.test(src[i + 1] || '')) {
          var p = i + 1; while (p < n && /[a-zA-Z]/.test(src[p])) p++; if (src[p] === '*') p++;
          var name = src.slice(i + 1, p).replace(/\*$/, '');
          // \verb / \lstinline — delimiter-bounded verbatim. Must consume the body so an unescaped $ inside
          // (e.g. \verb|$|) does not flip the document's math parity for everything that follows.
          if (name === 'verb' || name === 'lstinline') {
            var dp = p; if (name === 'lstinline') { while (dp < n && /\s/.test(src[dp])) dp++; if (src[dp] === '[') { var lb = src.indexOf(']', dp); if (lb >= 0) dp = lb + 1; } }
            var delim = src[dp], ve;
            if (delim === '{') { var d2 = 0, r2 = dp; for (; r2 < n; r2++) { if (src[r2] === '{') d2++; else if (src[r2] === '}') { d2--; if (!d2) { r2++; break; } } } ve = r2; } // brace-delimited body → balance
            else { ve = delim ? src.indexOf(delim, dp + 1) : -1; ve = ve < 0 ? n : ve + 1; }                                                          // same-char delimiter (\verb|…|)
            blank(i, ve); i = ve; continue;
          }
          // \begin{env} / \end{env}
          if (name === 'begin' || name === 'end') {
            var bm = /^\s*\{([a-zA-Z*]+)\}/.exec(src.slice(p));
            var env = bm ? bm[1] : '';
            var headEnd = p + (bm ? bm[0].length : 0);
            if (name === 'begin' && SKIP_ENV.test(env)) {
              var endTok = '\\end{' + env + '}'; var ee = src.indexOf(endTok, headEnd); ee = ee < 0 ? n : ee + endTok.length; blank(i, ee); i = ee; continue;
            }
            // also consume a following [htbp]-style float/option spec so it isn't read as prose
            var oh = headEnd; while (oh < n && /\s/.test(src[oh])) oh++;
            if (src[oh] === '[') { var ob = src.indexOf(']', oh); if (ob >= 0) { blank(headEnd, ob + 1); headEnd = ob + 1; } }
            blank(i, headEnd); i = headEnd; continue;       // blank the \begin{env}[opt] / \end{env} marker
          }
          var afterCmd = p;
          blank(i, p);                                       // blank the command token itself
          // skip optional [..] then, for identifier/path commands, the {..} argument(s)
          var q = p; while (q < n && /\s/.test(src[q])) q++;
          while (src[q] === '[') { var rb = src.indexOf(']', q); if (rb < 0) { rb = n - 1; } blank(q, rb + 1); q = rb + 1; while (q < n && /\s/.test(src[q])) q++; }
          if (SKIP_ARG.test(name)) {
            // blank balanced {..} groups (most such commands take 1, a few take 2)
            var groups = (name === 'href' || name === 'newcommand' || name === 'renewcommand' || name === 'providecommand' || name === 'definecolor' || name === 'textcolor' || name === 'colorbox') ? 2 : 1;
            while (groups-- > 0) { while (q < n && /\s/.test(src[q])) q++; if (src[q] !== '{') break; var depth = 0, r = q; for (; r < n; r++) { if (src[r] === '{') depth++; else if (src[r] === '}') { depth--; if (!depth) { r++; break; } } } blank(q, r); q = r; }
            i = q; continue;
          }
          i = afterCmd; continue;                            // keep brace contents (e.g. \textbf{prose}) as checkable text
        }
        if (src[i + 1] === '\\') { var e2 = i + 2; while (e2 < n && /\s/.test(src[e2])) e2++; if (src[e2] === '[') { var cb = src.indexOf(']', e2); if (cb >= 0) e2 = cb + 1; } blank(i, e2); i = e2; continue; } // \\[2mm] row break + spacing
        blank(i, i + 2); i += 2; continue;                   // \{ \% \& etc.
      }
      i++;
    }
    return a.join('');
  }

  /* ---------------- language detection ---------------- */
  // \documentclass/babel hints first, else Hungarian-accent ratio
  function detectLang(src) {
    var s = (src || '').slice(0, 200000);
    if (/\\usepackage\[[^\]]*magyar[^\]]*\]\{babel\}|\\usepackage\{magyar|\bmagyar\b.*babel|hungarian/i.test(s)) return 'hu';
    if (/\\usepackage\[[^\]]*english[^\]]*\]\{babel\}|\\selectlanguage\{english\}/i.test(s)) return 'en';
    var hu = (s.match(/[áéíóöõúüûőűÁÉÍÓÖÕÚÜÛŐŰ]/g) || []).length;
    var latin = (s.match(/[A-Za-z]/g) || []).length || 1;
    return (hu / latin) > 0.012 ? 'hu' : 'en';
  }

  /* ---------------- public scan ---------------- */
  // scan(src, lang, opts) → { lang, total, distinct, misspelled:[{word,count,offsets:[{start,end}],first}] }
  // opts.personal (lowercased Set/array) + opts.ignore are excluded from the result.
  function scan(src, lang, opts) {
    opts = opts || {};
    lang = lang || detectLang(src);
    var toks = tokenize(src || '');
    var byWord = {}, order = [];
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i], key = t.word;
      var g = byWord[key]; if (!g) { g = byWord[key] = { word: key, count: 0, offsets: [] }; order.push(key); }
      g.count++; if (g.offsets.length < 200) g.offsets.push({ start: t.start, end: t.end });
    }
    var skip = norm(opts.personal), ign = norm(opts.ignore);
    var candidates = order.filter(function (w) { var lw = w.toLowerCase(); return !skip[lw] && !ign[lw] && !ABBR[lw]; });
    if (!candidates.length) return Promise.resolve({ lang: lang, total: toks.length, distinct: order.length, misspelled: [] });
    return ensureLang(lang).then(function () {
      return call({ type: 'check', lang: lang, words: candidates });
    }).then(function (r) {
      var bad = {}; (r.bad || []).forEach(function (w) { bad[w] = true; });
      var miss = candidates.filter(function (w) { return bad[w]; }).map(function (w) { var g = byWord[w]; return { word: w, count: g.count, offsets: g.offsets, first: g.offsets[0] }; });
      miss.sort(function (x, y) { return (y.count - x.count) || x.word.toLowerCase().localeCompare(y.word.toLowerCase()); });
      return { lang: lang, total: toks.length, distinct: order.length, misspelled: miss };
    });
  }
  function suggest(lang, word) { return ensureLang(lang).then(function () { return call({ type: 'suggest', lang: lang, word: word }); }).then(function (r) { return r.suggestions || []; }); }
  function norm(list) { var o = {}; (list || []).forEach(function (w) { if (w) o[String(w).toLowerCase()] = true; }); return o; }

  return { scan: scan, suggest: suggest, tokenize: tokenize, stripLatex: stripLatex, detectLang: detectLang, langs: LANGS };
})();
