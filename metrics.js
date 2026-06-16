/* Aloud — manuscript KPI engine (window.PRMetrics).
 *
 * Computes Tier-A, auto-trackable format/quality metrics directly from the LaTeX
 * source (plus the compiled PDF page count when available) and grades them against
 * the selected template's `limits`. Pure, dependency-free, synchronous.
 *
 * Counts are LaTeX-aware approximations (a browser stand-in for TeXcount): good
 * enough for a live compliance gauge, labelled "≈" in the UI. */
window.PRMetrics = (function () {
  'use strict';

  function stripComments(s) { return s.replace(/(^|[^\\])%.*$/gm, '$1'); }

  // balanced-brace argument of \macro{...}; returns inner text or null
  function braceArg(src, macro) {
    var i = src.indexOf(macro);
    while (i >= 0) {
      var j = i + macro.length;
      while (j < src.length && /\s/.test(src[j])) j++;
      if (src[j] === '{') {
        var depth = 0, out = '';
        for (var k = j; k < src.length; k++) {
          var c = src[k];
          if (c === '{') { depth++; if (depth === 1) continue; }
          else if (c === '}') { depth--; if (depth === 0) return out; }
          out += c;
        }
        return out;
      }
      i = src.indexOf(macro, i + macro.length);
    }
    return null;
  }

  // [start,end) span of \macro{...} (whitespace-tolerant, brace-balanced), or null
  function spanOf(src, macro) {
    var i = src.indexOf(macro);
    while (i >= 0) {
      var j = i + macro.length;
      while (j < src.length && /\s/.test(src[j])) j++;
      if (src[j] === '{') {
        var depth = 0;
        for (var k = j; k < src.length; k++) {
          if (src[k] === '{') depth++;
          else if (src[k] === '}') { depth--; if (depth === 0) return [i, k + 1]; }
        }
      }
      i = src.indexOf(macro, i + macro.length);
    }
    return null;
  }
  function dropMacro(s, macro) { var sp; while ((sp = spanOf(s, macro))) s = s.slice(0, sp[0]) + ' ' + s.slice(sp[1]); return s; }

  function countWordsPlain(s) {
    if (s == null) return 0;
    s = s.replace(/\$\$[\s\S]*?\$\$/g, ' ').replace(/\\\[[\s\S]*?\\\]/g, ' ').replace(/\$[^$]*\$/g, ' ');
    s = s.replace(/\\[a-zA-Z@]+\*?(\[[^\]]*\])?/g, ' ');
    s = s.replace(/[{}~\\&]/g, ' ');
    s = s.replace(/[^A-Za-z0-9'’\-\s]/g, ' ');
    return s.split(/\s+/).filter(function (w) { return /[A-Za-z0-9]/.test(w); }).length;
  }

  function bodyWordCount(src) {
    var s = stripComments(src);
    var m = s.indexOf('\\begin{document}'); if (m >= 0) s = s.slice(m);
    // drop abstract, keywords, title and bibliography so the body count is comparable to journal word limits
    s = s.replace(/\\begin\{abstract\}[\s\S]*?\\end\{abstract\}/g, ' ');
    s = dropMacro(s, '\\abstract');
    s = s.replace(/\\begin\{IEEEkeywords\}[\s\S]*?\\end\{IEEEkeywords\}/g, ' ');
    s = s.replace(/\\begin\{keyword\}[\s\S]*?\\end\{keyword\}/g, ' ');
    s = dropMacro(s, '\\keywords'); s = dropMacro(s, '\\keyword');
    s = dropMacro(s, '\\title'); s = dropMacro(s, '\\Title');
    s = s.replace(/\\begin\{thebibliography\}[\s\S]*?\\end\{thebibliography\}/g, ' ');
    s = s.replace(/\\bibliography\{[^}]*\}/g, ' ');
    s = s.replace(/\\begin\{(equation|align|gather|multline|eqnarray)\*?\}[\s\S]*?\\end\{\1\*?\}/g, ' ');
    return countWordsPlain(s);
  }

  function abstractWords(src) {
    var m = /\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/.exec(src);
    var txt = m ? m[1] : braceArg(src, '\\abstract');
    if (txt == null) return null;
    txt = txt.replace(/\\keywords?\s*\{[\s\S]*?\}/g, ' '); // LLNCS nests \keywords inside the abstract env
    return countWordsPlain(txt);
  }

  function keywordCount(src) {
    var block = null, m;
    if ((m = /\\begin\{IEEEkeywords\}([\s\S]*?)\\end\{IEEEkeywords\}/.exec(src))) block = m[1];
    else if ((m = /\\begin\{keyword\}([\s\S]*?)\\end\{keyword\}/.exec(src))) block = m[1];
    else { block = braceArg(src, '\\keywords'); if (block == null) block = braceArg(src, '\\keyword'); }
    if (block == null) {
      m = /\\textbf\{Keywords?:?\}\s*([^\\\n]+)/i.exec(src) || /\bKeywords?:\s*([^\\\n]+)/.exec(src);
      block = m ? m[1] : null;
    }
    if (block == null) return null;
    var parts = block.replace(/\\sep/g, ',').replace(/\\and/g, ',').replace(/\\\\/g, ',')
      .replace(/\\[a-zA-Z]+/g, ' ').split(/[;,]/).map(function (x) { return x.trim(); }).filter(Boolean);
    return parts.length;
  }

  function titleWords(src) {
    var t = braceArg(src, '\\title'); if (t == null) t = braceArg(src, '\\Title');
    if (t == null) return null;
    return countWordsPlain(t);
  }

  function countMatches(src, re) { var n = 0; while (re.exec(src)) n++; return n; }

  function sectionTitles(src) {
    var out = [], idx = 0;
    while (true) {
      var m = /\\section\*?\s*\{/.exec(src.slice(idx));
      if (!m) break;
      var open = idx + m.index + m[0].length - 1; // index of the '{'
      var depth = 0, end = open, t = '';
      for (var k = open; k < src.length; k++) {
        var c = src[k];
        if (c === '{') { depth++; if (depth === 1) continue; }
        else if (c === '}') { depth--; if (depth === 0) { end = k; break; } }
        t += c;
      }
      t = t.replace(/\\[a-zA-Z]+\*?/g, '').replace(/[{}]/g, '').trim();
      if (t) out.push(t);
      idx = end > open ? end + 1 : open + 1;
    }
    return out;
  }

  var SYN = {
    'introduction': ['introduction', 'background'],
    'method': ['method', 'methods', 'methodology', 'approach', 'materials and methods', 'model', 'proposed'],
    'materials and methods': ['materials and methods', 'method', 'methods', 'methodology', 'approach'],
    'experiments': ['experiment', 'experiments', 'evaluation', 'results', 'experimental'],
    'results': ['results', 'experiment', 'experiments', 'evaluation', 'findings'],
    'discussion': ['discussion', 'analysis', 'ablation'],
    'conclusion': ['conclusion', 'conclusions', 'concluding', 'summary'],
    'conclusions': ['conclusion', 'conclusions', 'concluding', 'summary']
  };
  function structure(src, required) {
    var titles = sectionTitles(src).map(function (t) { return t.toLowerCase(); });
    var req = (required && required.length ? required : ['introduction', 'method', 'experiments', 'conclusion']);
    var rows = req.map(function (name) {
      var syns = SYN[name] || [name];
      var present = titles.some(function (t) { return syns.some(function (s) { return t.indexOf(s) >= 0; }); });
      return { name: name, present: present };
    });
    var have = rows.filter(function (r) { return r.present; }).length;
    return { rows: rows, pct: req.length ? Math.round(have / req.length * 100) : 100, titles: sectionTitles(src) };
  }

  function citedCount(src) {
    var keys = {}, re = /\\(?:cite|citep|citet|autocite|parencite|textcite)\*?(?:\[[^\]]*\])*\{([^}]*)\}/g, m;
    while ((m = re.exec(src))) m[1].split(',').forEach(function (k) { k = k.trim(); if (k) keys[k] = 1; });
    return Object.keys(keys).length;
  }
  function bibEntryCount(files) {
    var n = 0;
    Object.keys(files || {}).forEach(function (k) {
      var f = files[k]; if (f && f.type === 'bib' && f.content) n += countMatches(f.content, /@\w+\s*\{/g);
    });
    return n;
  }

  function grade(value, limit, kind) {
    // kind 'max' = value should be <= limit; returns ok/warn/over
    if (value == null || limit == null) return 'na';
    if (kind === 'max') {
      if (value > limit) return 'over';
      if (value > limit * 0.9) return 'warn';
      return 'ok';
    }
    return 'na';
  }

  // src: active .tex string; files: project files map; opts: { pages, limits }
  function compute(src, files, opts) {
    src = src || ''; opts = opts || {};
    var limits = opts.limits || {};
    var pages = (opts.pages != null && opts.pages > 0) ? opts.pages : null;

    // strip comments before scanning so commented-out macros never inflate counts / structure
    var clean = stripComments(src);
    var words = bodyWordCount(src); // strips comments itself
    var absW = abstractWords(clean);
    var kw = keywordCount(clean);
    var titleW = titleWords(clean);
    var figures = countMatches(clean, /\\begin\{figure\*?\}/g);
    var tables = countMatches(clean, /\\begin\{table\*?\}/g);
    var equations = countMatches(clean, /\\begin\{(equation|align|gather|multline|eqnarray)\*?\}/g) + countMatches(clean, /\\\[[\s\S]*?\\\]/g);
    var cited = citedCount(clean);
    var bibN = bibEntryCount(files);
    var refs = cited || bibN;
    var struct = structure(clean, limits.requiredSections);
    var readingMin = Math.max(1, Math.round(words / 200));

    var checks = [];
    checks.push({ key: 'pages', label: 'Page count', value: pages, limit: limits.pageLimit || null, unit: 'pages',
      status: limits.pageLimit ? (pages == null ? 'na' : grade(pages, limits.pageLimit, 'max')) : (pages == null ? 'na' : 'info'),
      note: limits.pageLimit ? ('limit ' + limits.pageLimit) : (pages == null ? 'compile to measure' : 'no hard cap') });
    if (limits.wordLimit) checks.push({ key: 'words', label: 'Body word count', value: words, limit: limits.wordLimit, unit: 'words', status: grade(words, limits.wordLimit, 'max'), note: '≈ limit ' + limits.wordLimit });
    else checks.push({ key: 'words', label: 'Body word count', value: words, limit: null, unit: 'words', status: 'info', note: '≈ approximate' });
    checks.push({ key: 'abstract', label: 'Abstract length', value: absW, limit: limits.abstractWords || null, unit: 'words',
      status: limits.abstractWords ? (absW == null ? 'missing' : grade(absW, limits.abstractWords, 'max')) : (absW == null ? 'missing' : 'info'),
      note: limits.abstractWords ? ('limit ' + limits.abstractWords) : '' });
    checks.push({ key: 'keywords', label: 'Keywords', value: kw, limit: limits.keywordsMax || null, unit: '',
      status: kw == null ? 'missing' : (limits.keywordsMax ? grade(kw, limits.keywordsMax, 'max') : 'info'),
      note: limits.keywordsMax ? ('max ' + limits.keywordsMax) : '' });
    checks.push({ key: 'structure', label: 'Required sections', value: struct.pct, limit: 100, unit: '%',
      status: struct.pct >= 100 ? 'ok' : (struct.pct >= 60 ? 'warn' : 'over'), note: struct.rows.filter(function (r) { return !r.present; }).map(function (r) { return r.name; }).join(', ') || 'all present' });

    return {
      words: words, abstractWords: absW, keywords: kw, titleWords: titleW,
      figures: figures, tables: tables, equations: equations, references: refs, bibEntries: bibN, cited: cited,
      pages: pages, readingMin: readingMin, sections: struct.titles, structure: struct, checks: checks
    };
  }

  return { compute: compute, sectionTitles: sectionTitles };
})();
