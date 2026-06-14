/* ProofReader LaTeX engine
 * process(source, files) -> { html, sentences:[{id,text,start,end}], title, meta }
 *  - html: typeset-like HTML for the preview; spoken sentences wrapped in
 *          <span class="sent" data-sid="N">...</span>
 *  - sentences: ordered spoken units, each mapped to a char range [start,end]
 *               in the ORIGINAL source (for the editor highlight)
 * Math is rendered with KaTeX when available, and is NOT spoken.
 */
(function () {
  'use strict';

  var DIAG = null; // current diagnostics sink (set per process() call)

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escapeAttr(s) { return escapeHtml(s).replace(/"/g, '&quot;'); }
  function collapse(s) { return s.replace(/[ \t\n]+/g, ' ').trim(); }

  function katexRender(tex, display) {
    if (typeof katex !== 'undefined') {
      try { return katex.renderToString(tex, { displayMode: !!display, throwOnError: true, strict: false }); }
      catch (e) {
        if (DIAG) DIAG.push({ kind: 'math', severity: 'error', message: 'Math error: ' + String(e.message || e).replace(/^KaTeX parse error:\s*/, ''), detail: tex });
        try { return katex.renderToString(tex, { displayMode: !!display, throwOnError: false, strict: false }); }
        catch (e2) { /* fall through */ }
      }
    }
    return '<span class="math-raw">' + escapeHtml(tex) + '</span>';
  }

  // read a balanced {...} group; text[i] must be '{'. returns {inner, end}
  function readGroup(text, i) {
    var depth = 0, start = i;
    for (; i < text.length; i++) {
      var ch = text[i];
      if (ch === '\\') { i++; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) return { inner: text.slice(start + 1, i), end: i + 1 }; }
    }
    return { inner: text.slice(start + 1), end: text.length };
  }
  // optional [..] arg
  function readOpt(text, i) {
    if (text[i] !== '[') return null;
    var depth = 0;
    for (var j = i; j < text.length; j++) {
      if (text[j] === '[') depth++;
      else if (text[j] === ']') { depth--; if (depth === 0) return { inner: text.slice(i + 1, j), end: j + 1 }; }
    }
    return null;
  }

  var FORMAT = {
    textbf: ['<strong>', '</strong>'], textit: ['<em>', '</em>'], emph: ['<em>', '</em>'],
    textsl: ['<em>', '</em>'], textsc: ['<span class="sc">', '</span>'], underline: ['<u>', '</u>'],
    texttt: ['<code>', '</code>'], textrm: ['', ''], textnormal: ['', ''], mbox: ['', ''],
    textsuperscript: ['<sup>', '</sup>'], textsubscript: ['<sub>', '</sub>'],
    mathbf: ['<strong>', '</strong>'], uline: ['<u>', '</u>']
  };

  // Inline renderer -> {html, spoken}
  function inline(str) {
    var html = '', spoken = '';
    var i = 0, n = str.length;
    while (i < n) {
      var ch = str[i];
      if (ch === '%') { while (i < n && str[i] !== '\n') i++; continue; }
      if (ch === '$') {
        var j = i + 1; while (j < n && !(str[j] === '$' && str[j - 1] !== '\\')) j++;
        var mtex = str.slice(i + 1, j);
        html += '<span class="imath" data-tex="' + escapeAttr(mtex) + '">' + katexRender(mtex, false) + '</span>'; i = j + 1; continue;
      }
      if (ch === '~') { html += '&nbsp;'; spoken += ' '; i++; continue; }
      if (ch === '\\') {
        var c2 = str[i + 1];
        if (c2 === '\\') { html += '<br>'; spoken += ' '; i += 2; continue; }
        if ('%&_#${}'.indexOf(c2) >= 0) { html += escapeHtml(c2); spoken += c2; i += 2; continue; }
        if (c2 === '(') { var k = str.indexOf('\\)', i); if (k < 0) k = n; var ptex = str.slice(i + 2, k); html += '<span class="imath" data-tex="' + escapeAttr(ptex) + '">' + katexRender(ptex, false) + '</span>'; i = k + 2; continue; }
        if (c2 === ',' || c2 === ';' || c2 === ':' || c2 === '!' || c2 === ' ') { html += ' '; spoken += ' '; i += 2; continue; }
        // command name
        var m = /^[a-zA-Z]+\*?/.exec(str.slice(i + 1));
        if (!m) { i += 2; continue; }
        var cmd = m[0]; i += 1 + cmd.length;
        // skip a single optional arg
        if (str[i] === '[') { var o = readOpt(str, i); if (o) i = o.end; }
        var arg = null;
        if (str[i] === '{') { var g = readGroup(str, i); arg = g.inner; i = g.end; }
        var key = cmd.replace(/\*$/, '');
        if (key === 'LaTeX') { html += 'L<span class="latex-a">a</span>T<span class="latex-e">e</span>X'; spoken += 'LaTeX'; continue; }
        if (key === 'TeX') { html += 'T<span class="latex-e">e</span>X'; spoken += 'TeX'; continue; }
        if (key === 'today') { html += 'June 2026'; spoken += 'June 2026'; continue; }
        if (key === 'ldots' || key === 'dots') { html += '&hellip;'; spoken += '…'; continue; }
        if (key === 'cite' || key === 'citep' || key === 'citet' || key === 'citeauthor') { html += '<span class="cite">[?]</span>'; continue; }
        if (key === 'ref' || key === 'eqref' || key === 'pageref' || key === 'autoref' || key === 'cref') { html += '<span class="cite">??</span>'; continue; }
        if (key === 'label' || key === 'index' || key === 'vspace' || key === 'hspace' || key === 'noindent' || key === 'centering' || key === 'small' || key === 'normalsize' || key === 'large' || key === 'Large' || key === 'huge' || key === 'bfseries' || key === 'itshape') { continue; }
        if (key === 'footnote') { html += '<sup class="fn">*</sup>'; continue; }
        if (key === 'url') { var u = arg || ''; html += '<a class="url" href="#" data-href="' + escapeAttr(u) + '">' + escapeHtml(u) + '</a>'; spoken += u; continue; }
        if (key === 'href') {
          var txt = null; if (str[i] === '{') { var g2 = readGroup(str, i); txt = g2.inner; i = g2.end; }
          var inn = inline(txt || arg || ''); html += '<a class="url" href="#" data-href="' + escapeAttr(arg || '') + '">' + inn.html + '</a>'; spoken += inn.spoken; continue;
        }
        if (FORMAT[key]) { var r = inline(arg || ''); html += FORMAT[key][0] + r.html + FORMAT[key][1]; spoken += r.spoken; continue; }
        // unknown command: keep its argument content if any
        if (arg !== null) { var ra = inline(arg); html += ra.html; spoken += ra.spoken; }
        continue;
      }
      if (ch === '{') { var gg = readGroup(str, i); var rg = inline(gg.inner); html += rg.html; spoken += rg.spoken; i = gg.end; continue; }
      if (ch === '}') { i++; continue; }
      // ligatures / quotes / dashes
      if (str.startsWith('---', i)) { html += '&mdash;'; spoken += '—'; i += 3; continue; }
      if (str.startsWith('--', i)) { html += '&ndash;'; spoken += '–'; i += 2; continue; }
      if (str.startsWith('``', i)) { html += '&ldquo;'; spoken += '“'; i += 2; continue; }
      if (str.startsWith("''", i)) { html += '&rdquo;'; spoken += '”'; i += 2; continue; }
      if (ch === '`') { html += '&lsquo;'; spoken += '‘'; i++; continue; }
      if (ch === "'") { html += '&rsquo;'; spoken += "'"; i++; continue; }
      if (ch === '&') { html += '&amp;'; spoken += '&'; i++; continue; }
      if (ch === '<') { html += '&lt;'; spoken += '<'; i++; continue; }
      if (ch === '>') { html += '&gt;'; spoken += '>'; i++; continue; }
      html += ch; spoken += ch; i++;
    }
    return { html: html, spoken: spoken };
  }

  // Split raw text into sentence ranges (offsets relative to text).
  function splitSentences(text) {
    var out = [], depth = 0, math = false, sentStart = 0, i = 0, n = text.length;
    function pushTo(end) {
      var raw = text.slice(sentStart, end);
      if (raw.trim().length) out.push({ start: sentStart, end: end });
      sentStart = end;
    }
    while (i < n) {
      var ch = text[i];
      if (ch === '\\') { i += 2; continue; }
      if (ch === '$') { math = !math; i++; continue; }
      if (math) { i++; continue; }
      if (ch === '{') { depth++; i++; continue; }
      if (ch === '}') { depth = Math.max(0, depth - 1); i++; continue; }
      if (depth === 0 && (ch === '.' || ch === '!' || ch === '?')) {
        // not a decimal like 3.14
        if (ch === '.' && /[0-9]/.test(text[i - 1] || '') && /[0-9]/.test(text[i + 1] || '')) { i++; continue; }
        // gobble trailing punctuation/quotes/brackets
        var j = i + 1;
        while (j < n && '.!?)]}\'"`'.indexOf(text[j]) >= 0) j++;
        // skip if followed by lowercase (likely abbreviation e.g. "e.g. word")
        var after = text.slice(j);
        var mm = /^\s*(\S)/.exec(after);
        var nextCh = mm ? mm[1] : '';
        var abbr = /(\b[A-Za-z]\.|\b(?:e\.g|i\.e|cf|vs|etc|Dr|Mr|Mrs|Fig|Eq|Sec|al|Prof|St|Ref|No|vol)\.?)$/i.test(text.slice(sentStart, i + 1).trim().slice(-6));
        if (nextCh && /[a-z]/.test(nextCh) && abbr) { i = j; continue; }
        pushTo(j); i = j; continue;
      }
      i++;
    }
    if (sentStart < n && text.slice(sentStart).trim().length) out.push({ start: sentStart, end: n });
    return out;
  }

  function newSent(ctx, spoken, start, end) {
    var t = collapse(spoken);
    if (!t) return null;
    var id = ++ctx.sid;
    ctx.sentences.push({ id: id, text: t, start: start, end: end });
    return id;
  }
  function wrap(id, html) { return id ? '<span class="sent" data-sid="' + id + '">' + html + '</span>' : html; }

  // find \end{env} matching the \begin{env} whose inner starts at innerStart.
  function findEnvEnd(text, innerStart, env) {
    var re = new RegExp('\\\\(begin|end)\\{' + env.replace(/[*]/g, '\\*') + '\\}', 'g');
    re.lastIndex = innerStart; var depth = 1, m;
    while ((m = re.exec(text))) {
      if (m[1] === 'begin') depth++;
      else { depth--; if (depth === 0) return { innerEnd: m.index, after: re.lastIndex, closed: true }; }
    }
    return { innerEnd: text.length, after: text.length, closed: false };
  }

  // Parse a block of body text. offset = position of text[0] in original source.
  function parseBlocks(text, offset, ctx) {
    var html = '', i = 0, n = text.length;
    while (i < n) {
      // skip whitespace
      while (i < n && /\s/.test(text[i])) i++;
      if (i >= n) break;
      if (text[i] === '%') { while (i < n && text[i] !== '\n') i++; continue; }

      var rest = text.slice(i);

      // display math \[ ... \]
      if (rest.startsWith('\\[')) {
        var e = text.indexOf('\\]', i); if (e < 0) e = n;
        html += '<div class="dmath">' + katexRender(text.slice(i + 2, e), true) + '</div>';
        i = e + 2; continue;
      }
      // headings
      var hm = /^\\(chapter|section|subsection|subsubsection|paragraph)\*?\s*\{/.exec(rest);
      if (hm) {
        var braceAt = i + hm[0].length - 1;
        var g = readGroup(text, braceAt);
        var r = inline(g.inner);
        var lvl = hm[1];
        var num = '';
        if (lvl === 'section') { ctx.c.section++; ctx.c.subsection = 0; ctx.c.subsubsection = 0; num = ctx.c.section + '  '; }
        else if (lvl === 'subsection') { ctx.c.subsection++; ctx.c.subsubsection = 0; num = ctx.c.section + '.' + ctx.c.subsection + '  '; }
        else if (lvl === 'subsubsection') { ctx.c.subsubsection++; num = ctx.c.section + '.' + ctx.c.subsection + '.' + ctx.c.subsubsection + '  '; }
        var tag = lvl === 'section' ? 'h2' : lvl === 'subsection' ? 'h3' : 'h4';
        var sid = newSent(ctx, r.spoken, offset + braceAt + 1, offset + g.end - 1);
        html += '<' + tag + ' class="hd ' + lvl + '">' + (num ? '<span class="secnum">' + num + '</span>' : '') + wrap(sid, r.html) + '</' + tag + '>';
        i = g.end; continue;
      }
      // \maketitle
      if (rest.startsWith('\\maketitle')) { html += renderTitle(ctx); i += '\\maketitle'.length; continue; }
      if (/^\\(tableofcontents|newpage|clearpage|bigskip|medskip|smallskip|noindent|centering|hline|par)\b/.test(rest)) {
        i += /^\\[a-zA-Z]+/.exec(rest)[0].length; continue;
      }
      if (/^\\(bibliographystyle|bibliography|usepackage|input|include)\s*\{/.test(rest)) {
        var bg = readGroup(text, i + /^\\[a-zA-Z]+\s*/.exec(rest)[0].length - 0);
        // jump past command + group
        var cmdLen = /^\\[a-zA-Z]+/.exec(rest)[0].length; var bs = i + cmdLen; while (text[bs] !== '{' && bs < n) bs++;
        var bgg = readGroup(text, bs); i = bgg.end; continue;
      }
      // environments
      var em = /^\\begin\{([^}]+)\}/.exec(rest);
      if (em) {
        var env = em[1].trim();
        var innerStart = i + em[0].length;
        // skip an optional [..] right after \begin{env}
        if (text[innerStart] === '[') { var oo = readOpt(text, innerStart); if (oo) innerStart = oo.end; }
        var found = findEnvEnd(text, innerStart, env);
        if (!found.closed && DIAG) DIAG.push({ kind: 'env', severity: 'error', message: 'Unclosed environment: \\begin{' + env + '} has no matching \\end{' + env + '}', at: offset + i });
        var innerText = text.slice(innerStart, found.innerEnd);
        html += renderEnv(env, innerText, offset + innerStart, ctx);
        i = found.after; continue;
      }
      // paragraph: read until blank line or next structural command
      var stop = n;
      var blank = text.slice(i).search(/\n[ \t]*\n/); if (blank >= 0) stop = Math.min(stop, i + blank);
      var struct = text.slice(i).search(/\\(section|subsection|subsubsection|paragraph|chapter|begin|end)\b|\\\[/);
      if (struct > 0) stop = Math.min(stop, i + struct);
      var paraStart = i, paraText = text.slice(i, stop);
      html += renderParagraph(paraText, offset + paraStart, ctx);
      i = stop;
    }
    return html;
  }

  function renderParagraph(text, offset, ctx) {
    var sents = splitSentences(text);
    if (!sents.length) { var r0 = inline(text); return r0.html.trim() ? '<p>' + r0.html + '</p>' : ''; }
    var out = '';
    for (var k = 0; k < sents.length; k++) {
      var s = sents[k];
      var raw = text.slice(s.start, s.end);
      var r = inline(raw);
      // trim leading whitespace from rendered html for tidiness but keep mapping
      var sid = newSent(ctx, r.spoken, offset + s.start, offset + s.end);
      out += wrap(sid, r.html.replace(/^\s+/, '')) + ' ';
    }
    return '<p>' + out.trim() + '</p>';
  }

  function renderEnv(env, inner, offset, ctx) {
    var base = env.replace(/\*$/, '');
    if (base === 'abstract') {
      return '<div class="abstract"><div class="abstract-title">Abstract</div>' + parseBlocks(inner, offset, ctx) + '</div>';
    }
    if (base === 'itemize' || base === 'enumerate') {
      var tag = base === 'enumerate' ? 'ol' : 'ul';
      return '<' + tag + ' class="list">' + renderItems(inner, offset, ctx) + '</' + tag + '>';
    }
    if (base === 'figure' || base === 'figure') return renderFigure(inner, offset, ctx, 'figure');
    if (base === 'table') return renderTableFloat(inner, offset, ctx);
    if (base === 'tabular') return renderTabular(inner, ctx);
    if (base === 'center') return '<div class="center">' + parseBlocks(inner, offset, ctx) + '</div>';
    if (base === 'quote' || base === 'quotation') return '<blockquote>' + parseBlocks(inner, offset, ctx) + '</blockquote>';
    if (base === 'verbatim' || base === 'lstlisting' || base === 'minted') return '<pre class="verb">' + escapeHtml(inner.replace(/^\n/, '')) + '</pre>';
    if (base === 'equation' || base === 'align' || base === 'displaymath' || base === 'gather' || base === 'eqnarray' || base === 'multline') {
      ctx.c.equation++;
      var body = inner.replace(/\\label\{[^}]*\}/g, '');
      return '<div class="dmath numbered" data-eqn="(' + ctx.c.equation + ')">' + katexRender(body, true) + '</div>';
    }
    if (/^(theorem|lemma|proof|definition|proposition|corollary|remark|example)$/.test(base)) {
      var label = base.charAt(0).toUpperCase() + base.slice(1);
      return '<div class="thm ' + base + '"><span class="thm-h">' + label + '.</span> ' + parseBlocks(inner, offset, ctx) + '</div>';
    }
    // unknown: render content transparently
    return parseBlocks(inner, offset, ctx);
  }

  function renderItems(inner, offset, ctx) {
    // split on top-level \item
    var parts = [], re = /\\item\b/g, m, idx = [];
    while ((m = re.exec(inner))) idx.push(m.index);
    var out = '';
    for (var k = 0; k < idx.length; k++) {
      var s = idx[k] + 5;
      // skip optional [..]
      var so = s; if (inner[so] === '[') { var oo = readOpt(inner, so); if (oo) so = oo.end; }
      var e = (k + 1 < idx.length) ? idx[k + 1] : inner.length;
      var itemText = inner.slice(so, e);
      out += '<li>' + parseBlocks(itemText, offset + so, ctx).replace(/^<p>|<\/p>$/g, '') + '</li>';
    }
    return out;
  }

  function findCommandArg(text, cmd) {
    var re = new RegExp('\\\\' + cmd + '\\s*(\\[[^\\]]*\\])?\\s*\\{');
    var m = re.exec(text); if (!m) return null;
    var braceAt = m.index + m[0].length - 1;
    var g = readGroup(text, braceAt);
    return { inner: g.inner, start: braceAt + 1, end: g.end - 1 };
  }

  function renderFigure(inner, offset, ctx, kind) {
    ctx.c.figure++;
    var img = '';
    var ig = findCommandArg(inner, 'includegraphics');
    if (ig) {
      var name = ig.inner.trim();
      var src = resolveImage(name, ctx);
      if (src) { img = '<img src="' + src + '" alt="' + escapeHtml(name) + '">'; }
      else {
        img = '<div class="img-missing">Missing image: ' + escapeHtml(name) + '</div>';
        if (ctx.diagnostics) ctx.diagnostics.push({ kind: 'image', severity: 'warn', message: 'Image not found: “' + name + '”', at: offset + ig.start });
      }
    }
    var capHtml = '', capR = null;
    var cap = findCommandArg(inner, 'caption');
    var html = '<figure class="figure">' + (img ? '<div class="fig-img">' + img + '</div>' : '');
    if (cap) {
      capR = inline(cap.inner);
      var sid = newSent(ctx, 'Figure ' + ctx.c.figure + '. ' + capR.spoken, offset + cap.start, offset + cap.end);
      html += '<figcaption>' + wrap(sid, '<span class="cap-label">Figure ' + ctx.c.figure + ':</span> ' + capR.html) + '</figcaption>';
    }
    html += '</figure>';
    return html;
  }

  function renderTableFloat(inner, offset, ctx) {
    ctx.c.table++;
    var html = '<div class="table-float">';
    var tg = inner.match(/\\begin\{tabular\}[\s\S]*?\\end\{tabular\}/);
    if (tg) html += renderTabular(tg[0].replace(/^\\begin\{tabular\}(\[[^\]]*\])?\{[^}]*\}/, '').replace(/\\end\{tabular\}$/, ''), ctx);
    var cap = findCommandArg(inner, 'caption');
    if (cap) {
      var capR = inline(cap.inner);
      var sid = newSent(ctx, 'Table ' + ctx.c.table + '. ' + capR.spoken, offset + cap.start, offset + cap.end);
      html += '<div class="table-cap">' + wrap(sid, '<span class="cap-label">Table ' + ctx.c.table + ':</span> ' + capR.html) + '</div>';
    }
    html += '</div>';
    return html;
  }

  function renderTabular(body, ctx) {
    if (ctx.c.tabularN == null) ctx.c.tabularN = 0;
    var ti = ctx.c.tabularN++;
    var rows = body.split(/\\\\/).map(function (r) { return r.trim(); }).filter(function (r) { return r && !/^\\hline$/.test(r); });
    var out = '<table class="tabular" data-tab="' + ti + '">';
    rows.forEach(function (row, ri) {
      row = row.replace(/\\hline/g, '').trim(); if (!row) return;
      var cells = splitTopLevel(row, '&');
      out += '<tr>';
      cells.forEach(function (c) {
        var r = inline(c.trim());
        out += (ri === 0 ? '<th>' : '<td>') + r.html + (ri === 0 ? '</th>' : '</td>');
      });
      out += '</tr>';
    });
    return out + '</table>';
  }
  function splitTopLevel(s, sep) {
    var out = [], depth = 0, cur = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (ch === '\\') { cur += ch + (s[i + 1] || ''); i++; continue; }
      if (ch === '{') depth++; if (ch === '}') depth--;
      if (ch === sep && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur); return out;
  }

  function resolveImage(name, ctx) {
    if (!ctx.files) return null;
    var keys = Object.keys(ctx.files);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (k === name || k.replace(/\.[^.]+$/, '') === name.replace(/\.[^.]+$/, '') || k.split('/').pop() === name.split('/').pop()) {
        if (ctx.files[k].type === 'image') return ctx.files[k].dataURL || ctx.files[k].src;
      }
    }
    return null;
  }

  function renderTitle(ctx) {
    var t = ctx.meta;
    var html = '<div class="titleblock">';
    if (t.titleId) html += '<h1 class="paper-title">' + wrap(t.titleId, t.titleHtml) + '</h1>';
    if (t.authorId) html += '<div class="paper-author">' + wrap(t.authorId, t.authorHtml) + '</div>';
    if (t.dateHtml) html += '<div class="paper-date">' + t.dateHtml + '</div>';
    html += '</div>';
    return html;
  }

  function process(source, files) {
    var ctx = { sid: 0, sentences: [], c: { section: 0, subsection: 0, subsubsection: 0, figure: 0, table: 0, equation: 0 }, files: files || {}, meta: {}, diagnostics: [] };
    DIAG = ctx.diagnostics;
    var bodyStart = 0, body = source, bodyOffset = 0, preamble = '';
    var bm = /\\begin\{document\}/.exec(source);
    if (bm) {
      preamble = source.slice(0, bm.index);
      var endm = /\\end\{document\}/.exec(source);
      if (!endm) ctx.diagnostics.push({ kind: 'env', severity: 'warn', message: 'No \\end{document} found — rendering to end of file', at: source.length });
      var bodyEnd = endm ? endm.index : source.length;
      bodyOffset = bm.index + bm[0].length;
      body = source.slice(bodyOffset, bodyEnd);
    }
    // parse title/author/date from preamble with original ranges
    function meta(cmd) {
      var re = new RegExp('\\\\' + cmd + '\\s*\\{');
      var m = re.exec(preamble); if (!m) return null;
      var braceAt = m.index + m[0].length - 1;
      var g = readGroup(preamble, braceAt);
      return { inner: g.inner, start: braceAt + 1, end: g.end - 1 };
    }
    var mt = meta('title'), ma = meta('author'), md = meta('date');
    if (mt) { var r = inline(mt.inner); ctx.meta.titleHtml = r.html; ctx.meta.titleId = newSent(ctx, r.spoken, mt.start, mt.end); }
    if (ma) { var ra = inline(ma.inner); ctx.meta.authorHtml = ra.html; ctx.meta.authorId = newSent(ctx, ra.spoken, ma.start, ma.end); }
    if (md) { ctx.meta.dateHtml = inline(md.inner).html; }

    var bodyHtml = parseBlocks(body, bodyOffset, ctx);
    // sort sentences by start so editor caret mapping is monotonic
    ctx.sentences.sort(function (a, b) { return a.start - b.start; });
    var diags = ctx.diagnostics; DIAG = null;
    return { html: '<div class="paper">' + bodyHtml + '</div>', sentences: ctx.sentences, meta: ctx.meta, diagnostics: diags };
  }

  window.LatexEngine = { process: process, inline: inline };
})();
