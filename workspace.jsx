/* Aloud dynamic window management — split-tree workspace + panes.
 * Exposes window.WS (pure tree ops) and window.Workspace (React components).
 * The Editor in app.jsx owns all state and passes a ctx object down. */
(function () {
  const { useState, useRef, useEffect } = React;
  const bn = (p) => { const i = (p || '').lastIndexOf('/'); return i < 0 ? p : p.slice(i + 1); };

  /* ---------------- pure tree operations ---------------- */
  let _id = 1;
  const nid = () => 'n' + (_id++) + Math.random().toString(36).slice(2, 5);
  function mkPane(kind, docId, file) { return { id: nid(), type: 'pane', kind: kind, docId: docId || null, file: file || null }; }
  function isPane(n) { return n && n.type === 'pane'; }

  function clone(n) { return JSON.parse(JSON.stringify(n)); }
  function allPanes(n, out) { out = out || []; if (!n) return out; if (isPane(n)) out.push(n); else { allPanes(n.a, out); allPanes(n.b, out); } return out; }
  function find(n, id) { if (!n) return null; if (n.id === id) return n; if (isPane(n)) return null; return find(n.a, id) || find(n.b, id); }
  function firstPane(n) { return isPane(n) ? n : (firstPane(n.a) || firstPane(n.b)); }
  function collectDocs(n) { const s = []; allPanes(n).forEach((p) => { if ((p.kind === 'source' || p.kind === 'preview' || p.kind === 'compiled') && p.docId) { if (s.indexOf(p.docId) < 0) s.push(p.docId); } }); return s; }

  function setRatio(n, id, ratio) {
    if (!n || isPane(n)) return n;
    if (n.id === id) return Object.assign({}, n, { ratio: Math.max(0.12, Math.min(0.88, ratio)) });
    return Object.assign({}, n, { a: setRatio(n.a, id, ratio), b: setRatio(n.b, id, ratio) });
  }
  function splitPane(n, paneId, dir, newPane, before) {
    if (!n) return n;
    if (isPane(n)) {
      if (n.id !== paneId) return n;
      const split = { id: nid(), type: 'split', dir: dir, ratio: 0.5, a: before ? newPane : n, b: before ? n : newPane };
      return split;
    }
    return Object.assign({}, n, { a: splitPane(n.a, paneId, dir, newPane, before), b: splitPane(n.b, paneId, dir, newPane, before) });
  }
  function closePane(n, paneId) {
    if (!n || isPane(n)) return n;
    if (isPane(n.a) && n.a.id === paneId) return n.b;
    if (isPane(n.b) && n.b.id === paneId) return n.a;
    return Object.assign({}, n, { a: closePane(n.a, paneId), b: closePane(n.b, paneId) });
  }
  function patchPane(n, paneId, patch) {
    if (!n) return n;
    if (isPane(n)) return n.id === paneId ? Object.assign({}, n, patch) : n;
    return Object.assign({}, n, { a: patchPane(n.a, paneId, patch), b: patchPane(n.b, paneId, patch) });
  }
  function movePane(root, srcId, destId, zone) {
    if (!root || srcId === destId) return root;
    const src = find(root, srcId), dest = find(root, destId);
    if (!isPane(src) || !isPane(dest)) return root;
    if (zone === 'center') {
      const sb = { kind: src.kind, docId: src.docId, file: src.file };
      const db = { kind: dest.kind, docId: dest.docId, file: dest.file };
      let r = patchPane(root, srcId, { kind: db.kind, docId: db.docId, file: db.file });
      r = patchPane(r, destId, { kind: sb.kind, docId: sb.docId, file: sb.file });
      return r;
    }
    const removed = closePane(root, srcId);
    if (!find(removed, destId)) return root;
    const dir = (zone === 'left' || zone === 'right') ? 'row' : 'col';
    const before = (zone === 'left' || zone === 'top');
    const moved = { id: nid(), type: 'pane', kind: src.kind, docId: src.docId, file: src.file };
    return splitPane(removed, destId, dir, moved, before);
  }

  window.WS = { mkPane, isPane, find, firstPane, allPanes, collectDocs, setRatio, splitPane, closePane, patchPane, movePane, clone, nid };

  /* ---------------- icons ---------------- */
  const IC = {
    source: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6 4L3 8l3 4M10 4l3 4-3 4" strokeLinecap="round" strokeLinejoin="round" /></svg>,
    preview: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M3 3h10v10H3z" /><path d="M5 6h6M5 8.5h6M5 11h4" strokeLinecap="round" /></svg>,
    pdf: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M4 2h6l3 3v9H4z" strokeLinejoin="round" /><path d="M5.5 9h1.2a1 1 0 000-2H5.5v4" strokeLinecap="round" strokeLinejoin="round" /></svg>,
    image: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="2.5" y="3" width="11" height="10" rx="1.5" /><circle cx="6" cy="6.5" r="1" /><path d="M3 11l3-2.5 2.5 2 3-3 2 2.5" strokeLinejoin="round" /></svg>,
    compiled: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M4 2h6l3 3v9H4z" strokeLinejoin="round" /><path d="M6.5 8.5l-1.2 1.2 1.2 1.2M9.5 8.5l1.2 1.2-1.2 1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
  };
  const KIND_LABEL = { source: 'Source', preview: 'Preview', pdf: 'PDF', image: 'Image', compiled: 'Compiled' };

  /* ---------------- pane body renderers ---------------- */
  function PaneBody({ pane, ctx }) {
    if (pane.kind === 'source') {
      const editable = ctx.isCurProj(pane.docId) && ctx.canEdit && !ctx.readOnlyDoc(pane.docId);
      const active = pane.docId === ctx.activeDocId;
      const src = ctx.getSource(pane.docId);
      if (!ctx.docExists(pane.docId)) return <Missing label="document" />;
      return <window.CodeEditor value={src}
        onChange={editable ? ((v) => ctx.onEditSource(pane.docId, v)) : (() => { })}
        readOnly={!editable}
        readStart={active && ctx.sentence && ctx.status !== 'idle' ? ctx.sentence.start : null}
        readEnd={active && ctx.sentence && ctx.status !== 'idle' ? ctx.sentence.end : null}
        readLine={active ? ctx.readLine : null}
        onCaret={(off) => ctx.onCaret(pane, off)}
        onJump={(off) => ctx.onJump(pane, off)}
        onSelectRange={(s, e) => ctx.onSourceSel(pane, s, e)}
        selectReq={active ? ctx.selectReq : null}
        bibKeys={ctx.bibKeys}
        annoMarks={ctx.annoMarks ? ctx.annoMarks(pane.docId) : null}
        fontSize={ctx.monoSize} lineHeight={Math.round(ctx.monoSize * 1.6)} />;
    }
    if (pane.kind === 'preview') {
      if (!ctx.docExists(pane.docId)) return <Missing label="document" />;
      return <PreviewBody pane={pane} ctx={ctx} />;
    }
    if (pane.kind === 'pdf') {
      if (pane.docId) { // rendered "export to PDF" view of a document
        const c = ctx.getCompiled(pane.docId);
        return <div className="pdf-render">
          <div className="pdf-render-bar"><span>Rendered PDF · {ctx.docLabel(pane.docId)}</span><button onClick={() => ctx.onPrint(pane.docId)}><svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M4 6V2.5h8V6M4 11H3a1 1 0 01-1-1V7a1 1 0 011-1h10a1 1 0 011 1v3a1 1 0 01-1 1h-1M4 9h8v4.5H4z" strokeLinejoin="round" /></svg>Print / Save PDF</button></div>
          <div className="pdf-render-scroll"><div className="pdf-paper" dangerouslySetInnerHTML={{ __html: c ? c.html : '' }} /></div>
        </div>;
      }
      const data = ctx.getFileData(pane.file);
      const url = ctx.getFileURL(pane.file);
      if (!data && !url) return <Missing label="PDF" />;
      return <PdfView data={data} url={url} />;
    }
    if (pane.kind === 'image') {
      const url = ctx.getFileURL(pane.file);
      if (!url) return <Missing label="image" />;
      return <div className="img-pane"><img src={url} alt={pane.file} /></div>;
    }
    if (pane.kind === 'compiled') {
      if (!ctx.docExists(pane.docId)) return <Missing label="document" />;
      return <CompiledView pane={pane} ctx={ctx} />;
    }
    return null;
  }
  function Missing({ label }) {
    return <div className="pane-missing"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 8v5M12 16.5v.01M3 20h18L12 4z" strokeLinecap="round" strokeLinejoin="round" /></svg><span>This {label} is no longer available.</span></div>;
  }

  /* ---- Write-mode DOM → LaTeX serialization ---- */
  function escTextNode(t) {
    return t.replace(/\u00a0/g, ' ')
      .replace(/\u2014/g, '---').replace(/\u2013/g, '--')
      .replace(/\u201c/g, '``').replace(/\u201d/g, "''").replace(/\u2018/g, '`').replace(/\u2019/g, "'")
      .replace(/\\/g, '\\textbackslash{}').replace(/([&%#_${}])/g, '\\$1')
      .replace(/~/g, '\\textasciitilde{}').replace(/\^/g, '\\textasciicircum{}');
  }
  function serializeNode(node) {
    let out = '';
    node.childNodes.forEach((n) => {
      if (n.nodeType === 3) { out += escTextNode(n.nodeValue); return; }
      if (n.nodeType !== 1) return;
      if (n.classList && n.classList.contains('anno-tag')) return;
      if (n.classList && n.classList.contains('imath')) { out += '$' + (n.getAttribute('data-tex') || n.textContent || '') + '$'; return; }
      const tag = n.tagName, inner = serializeNode(n);
      if (tag === 'A') { const href = n.getAttribute('data-href') || n.getAttribute('href') || ''; out += (inner.trim() && inner.trim() === href) ? '\\url{' + href + '}' : '\\href{' + href + '}{' + inner + '}'; }
      else if (tag === 'STRONG' || tag === 'B') out += '\\textbf{' + inner + '}';
      else if (tag === 'EM' || tag === 'I') out += '\\textit{' + inner + '}';
      else if (tag === 'U') out += '\\underline{' + inner + '}';
      else if (tag === 'CODE') out += '\\texttt{' + inner + '}';
      else if (tag === 'SUP') out += '\\textsuperscript{' + inner + '}';
      else if (tag === 'SUB') out += '\\textsubscript{' + inner + '}';
      else if (tag === 'BR') out += ' ';
      else if (tag === 'SPAN') {
        const st = n.style || {};
        if (/bold|[6789]00/.test(st.fontWeight || '')) out += '\\textbf{' + inner + '}';
        else if (st.fontStyle === 'italic') out += '\\textit{' + inner + '}';
        else if (/underline/.test(st.textDecoration || st.textDecorationLine || '')) out += '\\underline{' + inner + '}';
        else if (n.classList && n.classList.contains('sc')) out += '\\textsc{' + inner + '}';
        else out += inner;
      } else out += inner;
    });
    return out;
  }
  // A sentence is WYSIWYG-editable if, after stripping safe inline formatting, no LaTeX specials remain.
  function safeEditable(raw) {
    let t = raw.replace(/\$[^$]*\$/g, 'x'); // inline-math atoms are safe
    for (let k = 0; k < 6; k++) {
      const p = t;
      t = t.replace(/\\href\{[^{}]*\}\{([^{}]*)\}/g, '$1').replace(/\\url\{[^{}]*\}/g, 'x')
        .replace(/\\(?:textbf|textit|emph|textsl|underline|uline|texttt|textsc)\{([^{}]*)\}/g, '$1');
      if (t === p) break;
    }
    return !/[\\${}&#~^_%]/.test(t);
  }

  /* ---- formatted paste: HTML / TSV → LaTeX ---- */
  function inlineHtmlToLatex(node) {
    let s = '';
    [].forEach.call(node.childNodes, (n) => {
      if (n.nodeType === 3) { s += escTextNode(n.nodeValue); return; }
      if (n.nodeType !== 1) return;
      const t = n.tagName, st = n.style || {}, inner = inlineHtmlToLatex(n);
      if (t === 'STRONG' || t === 'B' || /bold|[6-9]00/.test(st.fontWeight || '')) s += '\\textbf{' + inner + '}';
      else if (t === 'EM' || t === 'I' || st.fontStyle === 'italic') s += '\\textit{' + inner + '}';
      else if (t === 'U') s += '\\underline{' + inner + '}';
      else if (t === 'CODE') s += '\\texttt{' + inner + '}';
      else if (t === 'A') { const href = n.getAttribute('href') || ''; s += href ? '\\href{' + href + '}{' + inner + '}' : inner; }
      else if (t === 'BR') s += ' ';
      else s += inner;
    });
    return s;
  }
  function tableElToLatex(tableEl) {
    const trs = [].slice.call(tableEl.querySelectorAll('tr')); if (!trs.length) return '';
    const ncol = Math.max.apply(null, trs.map((tr) => tr.children.length));
    const spec = 'l' + 'c'.repeat(Math.max(0, ncol - 1));
    const body = trs.map((tr, ri) => {
      const cells = [].slice.call(tr.children).map((td) => inlineHtmlToLatex(td).replace(/&/g, '\\&').replace(/\s+/g, ' ').trim());
      while (cells.length < ncol) cells.push('');
      return '  ' + cells.join(' & ') + ' \\\\' + (ri === 0 ? ' \\hline' : '');
    });
    return '\\begin{table}[h]\n\\centering\n\\begin{tabular}{' + spec + '}\n' + body.join('\n') + '\n\\end{tabular}\n\\end{table}';
  }
  function htmlToLatexBlocks(html) {
    const root = document.createElement('div'); root.innerHTML = html;
    const out = [];
    function walk(node) {
      [].forEach.call(node.childNodes, (n) => {
        if (n.nodeType === 3) { const t = n.nodeValue.replace(/\s+/g, ' ').trim(); if (t) out.push(escTextNode(t)); return; }
        if (n.nodeType !== 1) return;
        const tag = n.tagName;
        if (/^H[1-6]$/.test(tag)) { const lvl = tag === 'H1' ? 'section' : tag === 'H2' ? 'subsection' : 'subsubsection'; out.push('\\' + lvl + '{' + inlineHtmlToLatex(n).trim() + '}'); }
        else if (tag === 'UL' || tag === 'OL') { const env = tag === 'OL' ? 'enumerate' : 'itemize'; const items = [].slice.call(n.children).filter((li) => li.tagName === 'LI').map((li) => '  \\item ' + inlineHtmlToLatex(li).replace(/\s+/g, ' ').trim()); if (items.length) out.push('\\begin{' + env + '}\n' + items.join('\n') + '\n\\end{' + env + '}'); }
        else if (tag === 'TABLE') { const tl = tableElToLatex(n); if (tl) out.push(tl); }
        else if (tag === 'BLOCKQUOTE') { const s = inlineHtmlToLatex(n).replace(/\s+/g, ' ').trim(); if (s) out.push('\\begin{quote}\n' + s + '\n\\end{quote}'); }
        else if (tag === 'P' || tag === 'DIV' || tag === 'SECTION' || tag === 'ARTICLE' || tag === 'LI') {
          if (n.querySelector('table, ul, ol, h1, h2, h3, h4, p, div, blockquote')) { walk(n); }
          else { const s = inlineHtmlToLatex(n).replace(/\s+/g, ' ').trim(); if (s) out.push(s); }
        }
        else { const s = inlineHtmlToLatex(n).replace(/\s+/g, ' ').trim(); if (s) out.push(s); }
      });
    }
    walk(root);
    return out.filter(Boolean).join('\n\n');
  }
  function tsvToLatex(text) {
    const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.length);
    const rows = lines.map((l) => l.split('\t'));
    const ncol = Math.max.apply(null, rows.map((r) => r.length));
    const spec = 'l' + 'c'.repeat(Math.max(0, ncol - 1));
    const body = rows.map((r, ri) => {
      const cells = r.map((c) => escTextNode(c.trim()).replace(/&/g, '\\&'));
      while (cells.length < ncol) cells.push('');
      return '  ' + cells.join(' & ') + ' \\\\' + (ri === 0 ? ' \\hline' : '');
    });
    return '\\begin{table}[h]\n\\centering\n\\begin{tabular}{' + spec + '}\n' + body.join('\n') + '\n\\end{tabular}\n\\end{table}';
  }
  function sanitizeInlineHtml(html) {
    const root = document.createElement('div'); root.innerHTML = html;
    function clean(node) {
      let out = '';
      [].forEach.call(node.childNodes, (n) => {
        if (n.nodeType === 3) { out += n.nodeValue.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])); return; }
        if (n.nodeType !== 1) return;
        const t = n.tagName, st = n.style || {}, inner = clean(n);
        if (t === 'STRONG' || t === 'B' || /bold|[6-9]00/.test(st.fontWeight || '')) out += '<b>' + inner + '</b>';
        else if (t === 'EM' || t === 'I' || st.fontStyle === 'italic') out += '<i>' + inner + '</i>';
        else if (t === 'U') out += '<u>' + inner + '</u>';
        else if (t === 'A') { const href = (n.getAttribute('href') || '').replace(/"/g, ''); out += href ? '<a href="' + href + '">' + inner + '</a>' : inner; }
        else out += inner;
      });
      return out;
    }
    return clean(root);
  }

  /* Preview pane — read mode renders the compiled HTML; Write mode makes prose sentences
     contenteditable (incl. bold/italic via a selection toolbar) and round-trips to source. */
  function PreviewBody({ pane, ctx }) {
    const ref = useRef(null);
    const [fmt, setFmt] = useState(null); // formatting toolbar: { top, left, sentEl }
    const [activeSid, setActiveSid] = useState(null); // sentence the caret is in (for block tools)
    const [insertOpen, setInsertOpen] = useState(false); // insert menu open
    const [tableTb, setTableTb] = useState(null); // table row/col toolbar: { top, left, cell }
    const c = ctx.getCompiled(pane.docId);
    const html = c ? c.html : '';
    const editable = ctx.writeMode && ctx.isCurProj(pane.docId) && ctx.canEdit
      && (!ctx.readOnlyDoc || !ctx.readOnlyDoc(pane.docId)) && pane.docId === ctx.activeDocId;

    const activeEl = () => (activeSid != null && ref.current) ? ref.current.querySelector('.sent[data-sid="' + activeSid + '"]') : null;
    const blockInfo = (sentEl) => {
      if (!sentEl) return null;
      const list = sentEl.closest('ul.list, ol.list');
      if (list) return { kind: 'list', sids: [].map.call(list.querySelectorAll('.sent'), (s) => +s.getAttribute('data-sid')) };
      if (sentEl.closest('h2.hd, h3.hd, h4.hd')) return { kind: 'heading', sids: [+sentEl.getAttribute('data-sid')] };
      const p = sentEl.closest('p');
      if (p) return { kind: 'para', sids: [].map.call(p.querySelectorAll('.sent'), (s) => +s.getAttribute('data-sid')) };
      return { kind: 'para', sids: [+sentEl.getAttribute('data-sid')] };
    };
    const curStyle = (() => {
      const el = activeEl(); if (!el) return 'body';
      if (el.closest('h2.hd')) return 'section';
      if (el.closest('h3.hd')) return 'subsection';
      if (el.closest('h4.hd')) return 'subsubsection';
      return 'body';
    })();
    const inList = () => { const el = activeEl(); return !!(el && el.closest('ul.list, ol.list')); };
    const applyStyle = (level) => { const el = activeEl(); if (el) ctx.onBlockTransform(blockInfo(el), { type: 'style', level }); };
    const applyList = (kind) => { const el = activeEl(); if (el) ctx.onBlockTransform(blockInfo(el), { type: 'list', kind }); };

    const insertOffset = () => {
      const el = activeEl(); const info = el && blockInfo(el);
      const comp = ctx.getCompiled(pane.docId), src = ctx.getSource(pane.docId);
      if (!info || !comp) return null;
      const maxEnd = Math.max.apply(null, info.sids.map((id) => { const s = comp.sentences.find((x) => x.id === id); return s ? s.end : 0; }));
      let nl = src.indexOf('\n', maxEnd); if (nl < 0) nl = src.length;
      return nl;
    };
    const tableLatex = (r, c) => {
      const spec = 'l' + 'c'.repeat(Math.max(0, c - 1));
      const head = Array.from({ length: c }, (_, i) => 'Header ' + (i + 1)).join(' & ');
      const row = Array.from({ length: c }, () => 'Cell').join(' & ');
      const rows = ['  ' + head + ' \\\\ \\hline'];
      for (let i = 1; i < r; i++) rows.push('  ' + row + ' \\\\');
      return '\\begin{table}[h]\n\\centering\n\\begin{tabular}{' + spec + '}\n' + rows.join('\n') + '\n\\end{tabular}\n\\caption{Caption}\n\\label{tab:table}\n\\end{table}';
    };
    const serializeTable = (tableEl) => {
      const trs = [].slice.call(tableEl.querySelectorAll('tr'));
      const rows = trs.map((tr) => [].slice.call(tr.children).map((td) => escTextNode(td.textContent.trim()).replace(/&/g, '\\&')));
      const header = trs.length && trs[0].children.length && trs[0].children[0].tagName === 'TH';
      return { rows, header };
    };
    const commitTable = (tableEl) => {
      if (!tableEl) return; const ti = +tableEl.getAttribute('data-tab');
      const { rows, header } = serializeTable(tableEl);
      ctx.onTableEdit(ti, rows, { header });
    };
    const tblOp = (op) => {
      const tb = tableTb; if (!tb || !tb.cell || !tb.cell.isConnected) return;
      const cell = tb.cell, tr = cell.parentElement, table = cell.closest('table.tabular');
      if (!table) return;
      const ci = [].indexOf.call(tr.children, cell);
      const trs = [].slice.call(table.querySelectorAll('tr'));
      if (op === 'addRow') { const nr = tr.cloneNode(true); [].forEach.call(nr.children, (c) => { c.textContent = 'Cell'; }); tr.parentNode.insertBefore(nr, tr.nextSibling); }
      else if (op === 'delRow') { if (trs.length > 1) tr.remove(); }
      else if (op === 'addCol') { trs.forEach((row) => { const ref = row.children[ci]; const isH = ref && ref.tagName === 'TH'; const nc = document.createElement(isH ? 'th' : 'td'); nc.textContent = isH ? 'Header' : 'Cell'; if (ref) row.insertBefore(nc, ref.nextSibling); else row.appendChild(nc); }); }
      else if (op === 'delCol') { if (trs[0] && trs[0].children.length > 1) trs.forEach((row) => { if (row.children[ci]) row.children[ci].remove(); }); }
      commitTable(table); setTableTb(null);
    };

    useEffect(() => {
      const el = ref.current; if (!el) return;
      const sents = el.querySelectorAll('.sent');
      const tables = el.querySelectorAll('table.tabular');
      if (!editable) {
        sents.forEach((s) => { s.removeAttribute('contenteditable'); s.classList.remove('wm-edit', 'wm-lock'); });
        tables.forEach((t) => { t.classList.remove('wm-tbl'); t.querySelectorAll('td, th').forEach((c) => c.removeAttribute('contenteditable')); });
        return;
      }
      const comp = ctx.getCompiled(pane.docId), src = ctx.getSource(pane.docId);
      if (!comp) return;
      tables.forEach((t) => { t.classList.add('wm-tbl'); t.querySelectorAll('td, th').forEach((c) => { c.setAttribute('contenteditable', 'true'); c.spellcheck = true; }); });
      sents.forEach((s) => {
        const id = +s.getAttribute('data-sid');
        const sent = comp.sentences.find((x) => x.id === id); if (!sent) return;
        const raw = src.slice(sent.start, sent.end);
        if (safeEditable(raw)) { s.setAttribute('contenteditable', 'true'); s.classList.add('wm-edit'); s.classList.remove('wm-lock'); s.spellcheck = true; s.querySelectorAll('.anno-tag, .imath').forEach((t) => { t.contentEditable = 'false'; }); }
        else { s.classList.add('wm-lock'); s.classList.remove('wm-edit'); s.removeAttribute('contenteditable'); s.title = 'Contains LaTeX — click to edit in source'; }
      });
    });

    const commit = (s) => {
      if (!s || !s.classList.contains('wm-edit')) return;
      const id = +s.getAttribute('data-sid');
      const comp = ctx.getCompiled(pane.docId); if (!comp) return;
      const sent = comp.sentences.find((x) => x.id === id); if (!sent) return;
      ctx.onPreviewEdit(pane.docId, sent, serializeNode(s), true);
    };
    const fmtCmd = (cmd) => {
      const s = fmt && fmt.sentEl; if (!s) return;
      try { document.execCommand('styleWithCSS', false, false); } catch (_) { }
      try { document.execCommand(cmd, false, null); } catch (_) { }
      commit(s); setFmt(null);
    };
    const fmtLink = () => {
      const s = fmt && fmt.sentEl; if (!s) return;
      const had = (window.getSelection() || '').toString();
      const url = window.prompt('Link URL', /^https?:\/\//.test(had) ? had : 'https://');
      if (url) { try { document.execCommand('createLink', false, url); } catch (_) { } commit(s); }
      setFmt(null);
    };
    const fmtMath = () => {
      const s = fmt && fmt.sentEl; if (!s) return;
      const sel = window.getSelection(); if (!sel || !sel.rangeCount) { setFmt(null); return; }
      const range = sel.getRangeAt(0); const text = sel.toString().trim();
      const span = document.createElement('span');
      span.className = 'imath'; span.contentEditable = 'false'; span.setAttribute('data-tex', text || 'x'); span.textContent = text || 'x';
      try { range.deleteContents(); range.insertNode(span); } catch (_) { }
      commit(s); setFmt(null);
    };
    const onMouseUp = (e) => {
      if (!editable) { ctx.onPreviewMouseUp(pane, e); return; }
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !sel.toString().trim()) { setFmt(null); return; }
      const range = sel.getRangeAt(0);
      let node = range.commonAncestorContainer; if (node.nodeType === 3) node = node.parentNode;
      const sentEl = node && node.closest ? node.closest('.sent.wm-edit') : null;
      if (!sentEl) { setFmt(null); return; }
      const r = range.getBoundingClientRect();
      setFmt({ top: r.top > 70 ? r.top - 44 : r.bottom + 8, left: Math.max(80, Math.min(window.innerWidth - 80, r.left + r.width / 2)), sentEl });
    };

    return <React.Fragment>
      {editable && <div className="wm-bar" onMouseDown={(e) => { if (e.target.tagName !== 'SELECT') e.preventDefault(); }}>
        <select className="wm-style" value={curStyle} onChange={(e) => applyStyle(e.target.value)} title="Paragraph style">
          <option value="body">Body text</option>
          <option value="section">Heading 1</option>
          <option value="subsection">Heading 2</option>
          <option value="subsubsection">Heading 3</option>
        </select>
        <span className="wm-bar-sep" />
        <button className={'wm-bar-b' + (inList() ? ' on' : '')} title="Bulleted list" onMouseDown={(e) => { e.preventDefault(); applyList('itemize'); }}>• List</button>
        <button className="wm-bar-b" title="Numbered list" onMouseDown={(e) => { e.preventDefault(); applyList('enumerate'); }}>1. List</button>
        <span className="wm-bar-sep" />
        <div className="wm-ins-wrap" onMouseDown={(e) => e.preventDefault()}>
          <button className={'wm-bar-b' + (insertOpen ? ' on' : '')} title="Insert" onMouseDown={(e) => { e.preventDefault(); setInsertOpen((o) => !o); }}>＋ Insert ▾</button>
          {insertOpen && <div className="wm-ins-menu">
            <div className="wm-ins-h">Insert table</div>
            <TableGrid onPick={(r, c) => { ctx.onInsertBlock(tableLatex(r, c), insertOffset()); setInsertOpen(false); }} />
            <div className="wm-ins-sep" />
            <button className="wm-ins-i" onMouseDown={(e) => { e.preventDefault(); ctx.onInsertImage(insertOffset()); setInsertOpen(false); }}>
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="2.5" y="3" width="11" height="10" rx="1.5" /><circle cx="6" cy="6.5" r="1" /><path d="M3 11l3-2.5 2.5 2 2-1.5 2.5 2" strokeLinejoin="round" /></svg>
              Image / figure…
            </button>
          </div>}
        </div>
        <span className="wm-bar-hint">Editing the rendered document — changes save to LaTeX</span>
      </div>}
      <div className={'preview-scroll' + (pane.docId === ctx.activeDocId && ctx.status !== 'idle' ? ' reading-mode' : '') + (editable ? ' write-mode' : '')}
        data-doc={pane.docId} ref={(el) => { ref.current = el; ctx.registerPreview(pane.id, el); }}
        onClick={(e) => {
          if (insertOpen) setInsertOpen(false);
          if (editable) { const t = e.target.closest && e.target.closest('.sent'); if (t) { setActiveSid(+t.getAttribute('data-sid')); if (t.classList.contains('wm-edit')) return; } }
          ctx.onPreviewClick(pane, e);
        }}
        onFocus={editable ? (e) => {
          const cell = e.target.closest && e.target.closest('td, th');
          if (cell) { const r = cell.getBoundingClientRect(); setTableTb({ top: r.top - 38 > 60 ? r.top - 38 : r.bottom + 6, left: r.left + r.width / 2, cell }); return; }
          const s = e.target.closest && e.target.closest('.sent'); if (s) { setActiveSid(+s.getAttribute('data-sid')); setTableTb(null); }
        } : undefined}
        onScroll={fmt || tableTb ? () => { setFmt(null); setTableTb(null); } : undefined}
        onMouseUp={onMouseUp}
        onBlur={editable ? (e) => {
          const cell = e.target.closest && e.target.closest('td, th');
          if (cell) { const tbl = cell.closest('table.tabular'); setTimeout(() => { if (tbl && (!tbl.contains(document.activeElement))) { commitTable(tbl); setTableTb(null); } }, 90); return; }
          const s = e.target.closest && e.target.closest('.sent.wm-edit'); if (s) setTimeout(() => { if (!ref.current || !ref.current.contains(document.activeElement)) commit(s); }, 60);
        } : undefined}
        onKeyDown={editable ? (e) => {
          const s = e.target.closest && e.target.closest('.sent.wm-edit'); if (!s) return;
          if (e.key === 'Enter') { e.preventDefault(); commit(s); s.blur(); }
          else if (e.key === 'Escape') { e.preventDefault(); s.blur(); }
        } : undefined}
        onPaste={editable ? (e) => {
          const cd = e.clipboardData; if (!cd) return;
          const items = cd.items ? [].slice.call(cd.items) : [];
          const imgItem = items.find((it) => it.kind === 'file' && /^image\//.test(it.type));
          if (imgItem) { e.preventDefault(); const blob = imgItem.getAsFile(); if (blob) ctx.onInsertImageBlob(blob, insertOffset()); return; }
          const html = cd.getData('text/html'), text = cd.getData('text/plain');
          if (html && /<(table|ul|ol|h[1-6]|img|tr)\b/i.test(html)) { e.preventDefault(); const latex = htmlToLatexBlocks(html); if (latex.trim()) ctx.onInsertBlock(latex, insertOffset()); return; }
          if (text && /\t/.test(text) && /\n/.test(text.trim())) { e.preventDefault(); ctx.onInsertBlock(tsvToLatex(text), insertOffset()); return; }
          if (html && /<(b|strong|i|em|u|a)\b/i.test(html)) { e.preventDefault(); try { document.execCommand('insertHTML', false, sanitizeInlineHtml(html)); } catch (_) { } return; }
        } : undefined}
        onDoubleClick={editable ? (e) => {
          const m = e.target.closest && e.target.closest('.imath'); if (!m) return;
          const s = m.closest('.sent.wm-edit'); if (!s) return;
          const next = window.prompt('Edit inline math (LaTeX)', m.getAttribute('data-tex') || m.textContent || '');
          if (next != null) { m.setAttribute('data-tex', next); commit(s); }
        } : undefined}
        dangerouslySetInnerHTML={{ __html: html }} />
      {fmt && <div className="wm-fmt" style={{ position: 'fixed', top: fmt.top, left: fmt.left, transform: 'translateX(-50%)' }} onMouseDown={(e) => e.preventDefault()}>
        <button title="Bold" onMouseDown={(e) => { e.preventDefault(); fmtCmd('bold'); }}><b>B</b></button>
        <button title="Italic" onMouseDown={(e) => { e.preventDefault(); fmtCmd('italic'); }}><i>I</i></button>
        <button title="Underline" onMouseDown={(e) => { e.preventDefault(); fmtCmd('underline'); }}><u>U</u></button>
        <span className="wm-fmt-sep" />
        <button title="Link" onMouseDown={(e) => { e.preventDefault(); fmtLink(); }}><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M6.5 9.5l3-3M7 5l1-1a2.5 2.5 0 013.5 3.5l-1 1M9 11l-1 1a2.5 2.5 0 01-3.5-3.5l1-1" strokeLinecap="round" /></svg></button>
        <button title="Inline math" onMouseDown={(e) => { e.preventDefault(); fmtMath(); }}><span style={{ fontStyle: 'italic', fontFamily: 'Georgia, serif' }}>ƒx</span></button>
      </div>}
      {tableTb && <div className="wm-tbltb" style={{ position: 'fixed', top: tableTb.top, left: tableTb.left, transform: 'translateX(-50%)' }} onMouseDown={(e) => e.preventDefault()}>
        <button title="Add row below" onMouseDown={(e) => { e.preventDefault(); tblOp('addRow'); }}>＋ Row</button>
        <button title="Add column" onMouseDown={(e) => { e.preventDefault(); tblOp('addCol'); }}>＋ Col</button>
        <span className="wm-fmt-sep" />
        <button title="Delete row" onMouseDown={(e) => { e.preventDefault(); tblOp('delRow'); }}>✕ Row</button>
        <button title="Delete column" onMouseDown={(e) => { e.preventDefault(); tblOp('delCol'); }}>✕ Col</button>
      </div>}
    </React.Fragment>;
  }

  function TableGrid({ onPick }) {
    const [hov, setHov] = useState({ r: 0, c: 0 });
    const R = 6, C = 8;
    return <div className="wm-grid" onMouseLeave={() => setHov({ r: 0, c: 0 })}>
      <div className="wm-grid-cells">
        {Array.from({ length: R }).map((_, ri) => (
          Array.from({ length: C }).map((__, ci) => (
            <div key={ri + '-' + ci} className={'wm-grid-c' + (ri < hov.r && ci < hov.c ? ' on' : '')}
              onMouseEnter={() => setHov({ r: ri + 1, c: ci + 1 })}
              onMouseDown={(e) => { e.preventDefault(); onPick(hov.r || ri + 1, hov.c || ci + 1); }} />
          ))
        ))}
      </div>
      <div className="wm-grid-lbl">{hov.r ? hov.r + ' × ' + hov.c : 'Pick size'}</div>
    </div>;
  }

  function dataURLToBytes(dataURL) {
    const i = dataURL.indexOf(','); const head = dataURL.slice(0, i); const body = dataURL.slice(i + 1);
    if (/;base64/i.test(head)) { const bin = atob(body); const b = new Uint8Array(bin.length); for (let j = 0; j < bin.length; j++) b[j] = bin.charCodeAt(j); return b; }
    const dec = decodeURIComponent(body); const b = new Uint8Array(dec.length); for (let j = 0; j < dec.length; j++) b[j] = dec.charCodeAt(j); return b;
  }
  /* PDF.js canvas renderer — renders from raw bytes (blob/data URLs are blocked in sandboxed previews). */
  function PdfView({ data, url, bytes }) {
    const ref = useRef(null);
    const [state, setState] = useState('loading'); // loading | done | error
    useEffect(() => {
      let cancelled = false; const lib = window.pdfjsLib; const cont = ref.current;
      if (!cont) return;
      if (!lib || (!data && !url && !bytes)) { setState('error'); return; }
      setState('loading'); cont.innerHTML = '';
      let task; let watchdog = setTimeout(() => { if (!cancelled) setState((s) => s === 'loading' ? 'error' : s); }, 30000);
      (async () => {
        try {
          task = bytes ? lib.getDocument({ data: bytes.slice(), disableStream: true, disableAutoFetch: true })
            : data ? lib.getDocument({ data: dataURLToBytes(data), disableStream: true, disableAutoFetch: true })
            : lib.getDocument({ url: url });
          const pdf = await task.promise; if (cancelled) return;
          clearTimeout(watchdog);
          const width = Math.max(280, cont.clientWidth - 28);
          const dpr = window.devicePixelRatio || 1;
          for (let n = 1; n <= pdf.numPages; n++) {
            const page = await pdf.getPage(n); if (cancelled) return;
            const base = page.getViewport({ scale: 1 });
            const scale = Math.min(2.0, width / base.width);
            const vp = page.getViewport({ scale: scale * dpr });
            const canvas = document.createElement('canvas');
            canvas.className = 'pdf-page';
            canvas.width = vp.width; canvas.height = vp.height;
            canvas.style.width = (vp.width / dpr) + 'px';
            cont.appendChild(canvas);
            await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
            if (cancelled) return;
          }
          setState('done');
        } catch (e) { clearTimeout(watchdog); if (!cancelled) setState('error'); }
      })();
      return () => { cancelled = true; clearTimeout(watchdog); };
    }, [data, url, bytes]);
    return <div className="pdf-view-wrap">
      <div className="pdf-view" ref={ref} />
      {state === 'loading' && <div className="pdf-status">Loading PDF…</div>}
      {state === 'error' && <div className="pdf-status">Couldn’t render this PDF inline.{url ? <> <a href={url} target="_blank" rel="noopener">Open in a new tab ↗</a></> : null}</div>}
    </div>;
  }

  /* Compiled-PDF viewer with read-aloud sync: lazy-renders pages + a clickable text layer whose
   * spans are aligned to the engine's spoken sentences (data-sid). Highlights the active sentence
   * and routes clicks through ctx.onPreviewClick (same read-from-here contract as the Preview pane). */
  function ctNorm(s) { return (s || '').toLowerCase().replace(/[^a-z0-9áéíóöőúüű]+/gi, ' ').trim().split(/\s+/).filter(Boolean); }
  function CompiledPdfView({ pane, ctx, bytes }) {
    const docId = pane.docId;
    const ref = useRef(null);
    const stRef = useRef(null);
    const [state, setState] = useState('loading'); // loading | ready | error
    const isActive = docId === ctx.activeDocId;
    const playing = isActive && ctx.status && ctx.status !== 'idle';
    // follow the current sentence even when idle (cursor sync from the editor), not only while reading
    const curSid = (isActive && ctx.sentence) ? ctx.sentence.id : null;
    const curSidRef = useRef(curSid); curSidRef.current = curSid;
    const playingRef = useRef(playing); playingRef.current = playing;
    const annoMap = ctx.annoSids ? ctx.annoSids(docId) : {};
    const annoRef = useRef(annoMap); annoRef.current = annoMap;
    const voicedMap = ctx.voicedSids ? ctx.voicedSids(docId) : {};
    const voicedRef = useRef(voicedMap); voicedRef.current = voicedMap;

    function applyHighlight(root) {
      root = root || (ref.current);
      if (!root) return;
      root.querySelectorAll('.ct-textlayer > span.sent-cur, .ct-textlayer > span.sent-cursor').forEach((s) => s.classList.remove('sent-cur', 'sent-cursor'));
      const sid = curSidRef.current; if (sid == null) return;
      const cls = playingRef.current ? 'sent-cur' : 'sent-cursor';
      const spans = root.querySelectorAll('.ct-textlayer > span[data-sid="' + sid + '"]');
      spans.forEach((s) => s.classList.add(cls));
      if (spans[0]) { try { spans[0].scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { } }
    }
    // highlight sentences that carry a comment/to-do (lazy-safe: applied per page + on annotation change)
    function applyAnno(root) {
      root = root || (ref.current); if (!root) return;
      const map = annoRef.current || {};
      root.querySelectorAll('.ct-textlayer > span.sent').forEach((s) => {
        s.classList.remove('has-comment', 'has-todo', 'has-both');
        const k = map[s.dataset.sid];
        if (k) s.classList.add(k === 'both' ? 'has-both' : k === 'todo' ? 'has-todo' : 'has-comment');
      });
    }
    // mark sentences whose ElevenLabs audio is already generated; ♪ goes on the LAST span per sentence
    function applyVoiced(root) {
      root = root || (ref.current); if (!root) return;
      const map = voicedRef.current || {};
      root.querySelectorAll('.ct-textlayer > span.voiced, .ct-textlayer > span.voiced-end').forEach((s) => { s.classList.remove('voiced', 'voiced-end'); s.removeAttribute('title'); });
      const bySid = {};
      root.querySelectorAll('.ct-textlayer > span.sent').forEach((s) => { const id = s.dataset.sid; if (map[id]) { s.classList.add('voiced'); (bySid[id] = bySid[id] || []).push(s); } });
      Object.keys(bySid).forEach((id) => { const arr = bySid[id]; const last = arr[arr.length - 1]; last.classList.add('voiced-end'); last.title = 'Voiced with ElevenLabs — replays free, no extra credits'; });
    }

    useEffect(() => {
      let cancelled = false; const lib = window.pdfjsLib; const root = ref.current;
      if (!lib || !bytes || !root) { setState('error'); return; }
      setState('loading'); root.innerHTML = '';
      const st = stRef.current = { pageDivs: {}, sids: {}, rendered: {}, io: null };
      (async () => {
        try {
          const pdf = await lib.getDocument({ data: bytes.slice(), disableStream: true, disableAutoFetch: true }).promise;
          if (cancelled) return;
          const comp = ctx.getCompiled(docId); const sentences = (comp && comp.sentences) || [];
          const width = Math.max(280, root.clientWidth - 28);
          const dpr = window.devicePixelRatio || 1;
          const base1 = (await pdf.getPage(1)).getViewport({ scale: 1 });
          const scale = Math.min(2.0, width / base1.width);
          // placeholders (lazy)
          for (let n = 1; n <= pdf.numPages; n++) {
            const div = document.createElement('div'); div.className = 'ct-page'; div.dataset.page = n;
            div.style.width = Math.floor(base1.width * scale) + 'px';
            div.style.height = Math.floor(base1.height * scale) + 'px';
            root.appendChild(div); st.pageDivs[n] = div;
          }
          // ---- alignment: monotonic token match (engine spoken words → PDF tokens) ----
          // Granular per-token advance keeps each sentence's span set small (no clumping); a 2-word-confirmed
          // forward resync avoids wrong jumps on common words; PDF-only tokens (page numbers, table cells,
          // equation numbers, figure furniture) keep the CURRENT sentence instead of desyncing. Per-item majority vote.
          const E = []; sentences.forEach((s) => ctNorm(s.text).forEach((w) => E.push({ w: w, sid: s.id })));
          const firstSid = sentences.length ? sentences[0].id : null;
          const lastSid = sentences.length ? sentences[sentences.length - 1].id : null;
          const pageItems = {}; const P = []; const itemRange = {};
          for (let n = 1; n <= pdf.numPages; n++) {
            const tc = await (await pdf.getPage(n)).getTextContent(); if (cancelled) return;
            const arr = tc.items.map((it) => ctNorm(it.str)); pageItems[n] = arr;
            arr.forEach((ws, i) => { const s0 = P.length; for (let k = 0; k < ws.length; k++) P.push(ws[k]); itemRange[n + ':' + i] = [s0, P.length]; });
          }
          const tokSid = new Array(P.length); let ei = 0;
          for (let pi = 0; pi < P.length; pi++) {
            const pw = P[pi];
            if (ei < E.length && E[ei].w === pw) { tokSid[pi] = E[ei].sid; ei++; continue; }
            let r = -1; const lim = Math.min(ei + 60, E.length);
            for (let j = ei + 1; j < lim; j++) { if (E[j].w === pw && (pi + 1 >= P.length || (E[j + 1] && E[j + 1].w === P[pi + 1]))) { r = j; break; } }
            if (r >= 0) { ei = r; tokSid[pi] = E[ei].sid; ei++; }
            else tokSid[pi] = ei < E.length ? E[ei].sid : lastSid;
          }
          for (let n = 1; n <= pdf.numPages; n++) {
            const arr = pageItems[n]; const sids = new Array(arr.length);
            for (let i = 0; i < arr.length; i++) {
              const rg = itemRange[n + ':' + i]; let sid = firstSid;
              if (rg && rg[1] > rg[0]) { const votes = {}; let best = null, bc = 0; for (let t = rg[0]; t < rg[1]; t++) { const v = tokSid[t]; if (v == null) continue; votes[v] = (votes[v] || 0) + 1; if (votes[v] > bc) { bc = votes[v]; best = v; } } if (best != null) sid = best; }
              sids[i] = sid;
            }
            st.sids[n] = sids;
          }
          if (cancelled) return;
          setState('ready');
          const renderPage = async (n) => {
            if (st.rendered[n] || cancelled) return; st.rendered[n] = true;
            const page = await pdf.getPage(n);
            const cssVp = page.getViewport({ scale }); const vp = page.getViewport({ scale: scale * dpr });
            const canvas = document.createElement('canvas'); canvas.className = 'ct-canvas';
            canvas.width = vp.width; canvas.height = vp.height;
            canvas.style.width = Math.floor(cssVp.width) + 'px'; canvas.style.height = Math.floor(cssVp.height) + 'px';
            st.pageDivs[n].appendChild(canvas);
            await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise; if (cancelled) return;
            const tl = document.createElement('div'); tl.className = 'ct-textlayer';
            tl.style.width = Math.floor(cssVp.width) + 'px'; tl.style.height = Math.floor(cssVp.height) + 'px';
            tl.style.setProperty('--scale-factor', scale); tl.style.setProperty('--total-scale-factor', scale);
            st.pageDivs[n].appendChild(tl);
            const tc = await page.getTextContent(); const textDivs = [];
            await lib.renderTextLayer({ textContent: tc, container: tl, viewport: cssVp, textDivs: textDivs }).promise;
            const sids = st.sids[n] || [];
            textDivs.forEach((sp, i) => { const sid = sids[i]; if (sid != null) { sp.classList.add('sent'); sp.dataset.sid = sid; } });
            applyHighlight(root); applyAnno(root); applyVoiced(root);
          };
          st.renderPage = renderPage;
          const io = new IntersectionObserver((ents) => { ents.forEach((e) => { if (e.isIntersecting) renderPage(+e.target.dataset.page).catch(() => { }); }); }, { root: root, rootMargin: '800px 0px' });
          Object.keys(st.pageDivs).forEach((n) => io.observe(st.pageDivs[n]));
          st.io = io;
        } catch (e) { if (!cancelled) setState('error'); }
      })();
      return () => { cancelled = true; if (stRef.current && stRef.current.io) stRef.current.io.disconnect(); };
    }, [bytes, docId]);

    // re-highlight when the active spoken sentence changes
    useEffect(() => { applyHighlight(); }, [curSid, playing, state]);
    // re-apply comment/to-do highlights to already-rendered pages when annotations change
    useEffect(() => { applyAnno(); }, [JSON.stringify(annoMap), state]);
    // re-apply ♪ voiced markers when the cached-audio set or voice changes
    useEffect(() => { applyVoiced(); }, [JSON.stringify(voicedMap), state]);

    // register this pane's scroll element so comment/todo selection (ctx.onPreviewMouseUp) works here too
    useEffect(() => {
      if (ctx.registerPreview && ref.current) ctx.registerPreview(pane.id, ref.current);
      return () => { if (ctx.registerPreview) ctx.registerPreview(pane.id, null); };
    }, [pane.id]);

    // The ref'd scroll div is imperatively filled (kept empty in JSX so React never reconciles its
    // children); status overlays are React-managed siblings inside the positioned pdf-view-wrap.
    return <React.Fragment>
      <div className="ct-scroll" ref={ref} data-doc={docId}
        onClick={(e) => ctx.onPreviewClick && ctx.onPreviewClick(pane, e)}
        onMouseUp={(e) => ctx.onPreviewMouseUp && ctx.onPreviewMouseUp(pane, e)} />
      {state === 'loading' && <div className="pdf-status">Renderelés…</div>}
      {state === 'error' && <div className="pdf-status">Nem sikerült megjeleníteni.</div>}
    </React.Fragment>;
  }

  /* Compiled view — runs the real TeX engine (in-browser SwiftLaTeX by default; external API for the
   * byte-identical "Pontos PDF"), then renders the resulting PDF via CompiledPdfView. Hybrid Version B. */
  function CompiledView({ pane, ctx }) {
    const docId = pane.docId;
    const st = ctx.getCompiledPdf ? ctx.getCompiledPdf(docId) : null;
    const src = ctx.getSource ? ctx.getSource(docId) : '';
    // initial compile on mount
    useEffect(() => { if (ctx.requestCompile) ctx.requestCompile(docId, true); }, [docId]);
    // debounced recompile when the source changes (Version B auto-recompile)
    useEffect(() => { if (ctx.requestCompile) ctx.requestCompile(docId, false); }, [src]);
    const busy = !!(st && st.busy), pdf = st && st.pdf, err = st && st.err;
    const modeLabel = st && st.mode === 'exact' ? 'pontos (TeX Live 2026)' : 'böngésző (pdfTeX)';
    return <div className="pdf-render">
      <div className="pdf-render-bar">
        <span>Compiled · {ctx.docLabel(docId)}{st && st.pages ? ' · ' + st.pages + ' o.' : ''} · {modeLabel}{busy ? ' · fordítás…' : (err ? ' · ⚠ fordítási hiba' : '')}</span>
        <span style={{ display: 'inline-flex', gap: 6 }}>
          <button onClick={() => ctx.requestCompile && ctx.requestCompile(docId, true)} disabled={busy}>Újrafordítás</button>
          <button onClick={() => ctx.onCompileExact && ctx.onCompileExact(docId)} disabled={busy} title="Byte-azonos PDF külső TeX Live 2026 API-val">Pontos PDF</button>
        </span>
      </div>
      <div className="pdf-view-wrap" style={{ flex: 1, minHeight: 0 }}>
        {err && !pdf ? <div className="pdf-status" style={{ maxWidth: '82%', whiteSpace: 'normal', lineHeight: 1.45, textAlign: 'center', background: 'rgba(120,30,30,.55)' }}>⚠️ {String(err)}</div>
          : pdf ? <CompiledPdfView pane={pane} ctx={ctx} bytes={pdf} />
          : <div className="pdf-status">{busy ? 'Fordítás folyamatban…' : 'Várakozás a fordításra…'}</div>}
      </div>
    </div>;
  }

  /* ---------------- pane header ---------------- */
  function Pane({ pane, ctx }) {
    const [menu, setMenu] = useState(null); // 'bind' | 'split'
    const [dz, setDz] = useState(null); // active drop zone while dragging over
    const bodyRef = useRef(null);
    const focused = ctx.focusedPaneId === pane.id;
    const syncable = pane.kind === 'source' || pane.kind === 'preview' || pane.kind === 'compiled';
    const color = syncable ? ctx.docColor(pane.docId) : null;
    const active = syncable && pane.docId === ctx.activeDocId;
    useEffect(() => { if (!menu) return; const c = () => setMenu(null); window.addEventListener('click', c); return () => window.removeEventListener('click', c); }, [menu]);
    const label = syncable ? ctx.docLabel(pane.docId) : (pane.kind === 'pdf' && pane.docId ? ctx.docLabel(pane.docId) : bn(pane.file || ''));
    const zoneFrom = (e) => {
      const el = bodyRef.current; if (!el) return 'center';
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      if (x > 0.32 && x < 0.68 && y > 0.32 && y < 0.68) return 'center';
      const dl = x, dr = 1 - x, dt = y, db = 1 - y, m = Math.min(dl, dr, dt, db);
      return m === dl ? 'left' : m === dr ? 'right' : m === dt ? 'top' : 'bottom';
    };
    const onDragOver = (e) => {
      if (ctx.dragId == null) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move';
      const z = ctx.dragId === pane.id ? null : zoneFrom(e);
      setDz((p) => p === z ? p : z);
    };
    return (
      <div className={'ws-pane ws-' + pane.kind + (focused ? ' focused' : '') + (ctx.dragId === pane.id ? ' dragging' : '')}
        onMouseDown={() => ctx.onFocus(pane)}>
        <div className="ws-head" draggable
          onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', pane.id); ctx.onDragStart(pane.id); }}
          onDragEnd={() => { ctx.onDragEnd(); setDz(null); }}>
          {syncable && <span className="ws-sync-dot" style={{ background: color }} title={'Sync group · ' + ctx.docLabel(pane.docId)} />}
          <span className={'ws-type ' + pane.kind}>{IC[pane.kind]}</span>
          <button className="ws-name" title="Change what this pane shows" onClick={(e) => { e.stopPropagation(); setMenu(menu === 'bind' ? null : 'bind'); }}>
            <span className="ws-name-t">{label || 'Empty'}</span>
            {ctx.readOnlyDoc && syncable && ctx.readOnlyDoc(pane.docId) && <span className="ws-ro">ref</span>}
            {active && ctx.status !== 'idle' && <span className="ws-reading">● reading</span>}
            <svg className="ws-caret" viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          {menu === 'bind' && <BindMenu pane={pane} ctx={ctx} close={() => setMenu(null)} />}
          <span className="ws-head-sp" />
          {pane.kind === 'preview' && ctx.isCurProj(pane.docId) && ctx.canEdit && (!ctx.readOnlyDoc || !ctx.readOnlyDoc(pane.docId)) &&
            <div className="wm-seg" onClick={(e) => e.stopPropagation()} title="Edit the rendered document — no LaTeX needed">
              <button className={!ctx.writeMode ? 'on' : ''} onClick={() => ctx.setWrite(false)}>Read</button>
              <button className={ctx.writeMode ? 'on' : ''} onClick={() => ctx.setWrite(true)}>Write</button>
            </div>}
          <button className="ws-hbtn" title="Add / split" onClick={(e) => { e.stopPropagation(); setMenu(menu === 'split' ? null : 'split'); }}>
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2.5" y="2.5" width="11" height="11" rx="1.5" /><path d="M8 2.5v11" strokeDasharray="2 1.5" /></svg>
          </button>
          {menu === 'split' && <div className="ws-menu sm" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => { ctx.onAdd(pane.id, 'row'); setMenu(null); }}><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.3"><rect x="2" y="3" width="12" height="10" rx="1" /><path d="M8 3v10" /></svg>Split right</button>
            <button onClick={() => { ctx.onAdd(pane.id, 'col'); setMenu(null); }}><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.3"><rect x="2" y="3" width="12" height="10" rx="1" /><path d="M2 8h12" /></svg>Split down</button>
          </div>}
          <button className="ws-hbtn" title={ctx.soloPaneId === pane.id ? 'Restore layout' : 'Focus this pane'} onClick={(e) => { e.stopPropagation(); ctx.onSolo(pane.id); }}>
            {ctx.soloPaneId === pane.id
              ? <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 7l4-4M13 3v3M13 3h-3M7 9l-4 4M3 13v-3M3 13h3" strokeLinecap="round" strokeLinejoin="round" /></svg>
              : <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 6V3h3M13 6V3h-3M3 10v3h3M13 10v3h-3" strokeLinecap="round" strokeLinejoin="round" /></svg>}
          </button>
          {ctx.canClose && <button className="ws-hbtn ws-close" title="Close pane" onClick={(e) => { e.stopPropagation(); ctx.onClose(pane.id); }}>
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" /></svg>
          </button>}
        </div>
        <div className="ws-body" ref={bodyRef}
          onDragOver={onDragOver} onDragLeave={(e) => { if (!bodyRef.current || !bodyRef.current.contains(e.relatedTarget)) setDz(null); }}
          onDrop={(e) => { e.preventDefault(); const sid = e.dataTransfer.getData('text/plain'); const z = dz; setDz(null); if (sid && z && sid !== pane.id) ctx.onMovePane(sid, pane.id, z); ctx.onDragEnd(); }}>
          <PaneBody pane={pane} ctx={ctx} />
          {syncable && ctx.isCurProj(pane.docId) && ctx.canComment && ctx.selPaneId === pane.id && ctx.selQuote &&
            <window.Collab.SelectionToolbar pos={ctx.selPos} quote={ctx.selQuote}
              onComment={() => ctx.onComment(pane)} onTodo={() => ctx.onTodo(pane)} onClose={ctx.onCloseSel} />}
          {dz && <div className={'ws-dropzone dz-' + dz}><div className="ws-drop-hint">{dz === 'center' ? 'Swap' : 'Move here'}</div></div>}
        </div>
      </div>
    );
  }

  function BindMenu({ pane, ctx, close }) {
    const texFiles = ctx.listFiles('tex');
    const otherFiles = ctx.listFiles('other');
    const syncable = pane.kind === 'source' || pane.kind === 'preview';
    return <div className="ws-menu bm" onClick={(e) => e.stopPropagation()}>
      {syncable && <>
        <div className="ws-menu-h">Show as</div>
        <div className="ws-seg">
          <button className={pane.kind === 'source' ? 'on' : ''} onClick={() => { ctx.onRebind(pane, { kind: 'source' }); close(); }}>Source</button>
          <button className={pane.kind === 'preview' ? 'on' : ''} onClick={() => { ctx.onRebind(pane, { kind: 'preview' }); close(); }}>Preview</button>
          <button className={pane.kind === 'compiled' ? 'on' : ''} onClick={() => { ctx.onRebind(pane, { kind: 'compiled' }); close(); }}>Compiled</button>
        </div>
        <div className="ws-menu-h">Document</div>
        {texFiles.map((f) => <button key={f} className={'ws-menu-i' + (pane.docId === f ? ' sel' : '')} onClick={() => { ctx.onRebind(pane, { docId: f }); close(); }}><span className="ws-sync-dot" style={{ background: ctx.docColor(f) }} />{bn(f)}</button>)}
        {ctx.externalDocs().map((d) => <button key={d.docId} className={'ws-menu-i' + (pane.docId === d.docId ? ' sel' : '')} onClick={() => { ctx.onRebind(pane, { docId: d.docId }); close(); }}><span className="ws-sync-dot" style={{ background: ctx.docColor(d.docId) }} />{d.label} <em>ref</em></button>)}
      </>}
      {(pane.kind === 'pdf' || pane.kind === 'image') && <>
        <div className="ws-menu-h">{pane.kind === 'pdf' ? 'PDF / file' : 'Image'}</div>
        {otherFiles.filter((f) => pane.kind === 'pdf' ? /\.pdf$/i.test(f) : /\.(png|jpe?g|gif|svg)$/i.test(f)).map((f) => <button key={f} className={'ws-menu-i' + (pane.file === f ? ' sel' : '')} onClick={() => { ctx.onRebind(pane, { file: f, docId: null }); close(); }}>{bn(f)}</button>)}
      </>}
    </div>;
  }

  /* ---------------- split divider ---------------- */
  function Divider({ node, ctx }) {
    const onDown = (e) => {
      e.preventDefault();
      const host = e.currentTarget.parentNode;
      const rect = host.getBoundingClientRect();
      const horiz = node.dir === 'row';
      const move = (ev) => {
        const r = horiz ? (ev.clientX - rect.left) / rect.width : (ev.clientY - rect.top) / rect.height;
        ctx.onSetRatio(node.id, r);
      };
      const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); document.body.style.cursor = ''; document.body.style.userSelect = ''; };
      window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
      document.body.style.cursor = horiz ? 'col-resize' : 'row-resize'; document.body.style.userSelect = 'none';
    };
    return <div className={'ws-divider ' + node.dir} onMouseDown={onDown} onDoubleClick={() => ctx.onSetRatio(node.id, 0.5)}><span /></div>;
  }

  /* ---------------- recursive tree renderer ---------------- */
  function Node({ node, ctx }) {
    if (!node) return null;
    if (isPane(node)) return <Pane pane={node} ctx={ctx} />;
    const horiz = node.dir === 'row';
    const aFlex = node.ratio, bFlex = 1 - node.ratio;
    return <div className={'ws-split ' + node.dir}>
      <div className="ws-cell" style={{ flexGrow: aFlex, flexBasis: 0, minWidth: 0, minHeight: 0 }}><Node node={node.a} ctx={ctx} /></div>
      <Divider node={node} ctx={ctx} />
      <div className="ws-cell" style={{ flexGrow: bFlex, flexBasis: 0, minWidth: 0, minHeight: 0 }}><Node node={node.b} ctx={ctx} /></div>
    </div>;
  }

  function Workspace({ ctx }) {
    if (ctx.soloPaneId) {
      const p = find(ctx.layout, ctx.soloPaneId);
      if (p) return <div className="ws-root"><Node node={p} ctx={ctx} /></div>;
    }
    if (!ctx.layout) return <div className="ws-root ws-empty"><button className="ws-add-empty" onClick={() => ctx.onAddFirst()}>+ Add a pane</button></div>;
    return <div className="ws-root"><Node node={ctx.layout} ctx={ctx} /></div>;
  }

  /* ---------------- Add-pane menu (toolbar) ---------------- */
  function AddPaneMenu({ ctx, onClose }) {
    const [sub, setSub] = useState(null); // 'file' | 'article' | 'articleFile'
    const [proj, setProj] = useState(null);
    const texFiles = ctx.listFiles('tex');
    const pdfs = ctx.listFiles('other').filter((f) => /\.pdf$/i.test(f));
    const imgs = ctx.listFiles('other').filter((f) => /\.(png|jpe?g|gif|svg)$/i.test(f));
    return <div className="ws-add-menu" onClick={(e) => e.stopPropagation()}>
      {!sub && <>
        <div className="ws-menu-h">Add to workspace</div>
        <button className="ws-menu-i" onClick={() => { ctx.onAddKind('preview', ctx.activeDocId); onClose(); }}>{IC.preview}Preview of this document</button>
        <button className="ws-menu-i" onClick={() => { ctx.onAddKind('source', ctx.activeDocId); onClose(); }}>{IC.source}Source of this document</button>
        <button className="ws-menu-i" onClick={() => { ctx.onAddKind('compiled', ctx.activeDocId); onClose(); }}>{IC.compiled}Compiled (real TeX → PDF)</button>
        <div className="ws-menu-sep" />
        {texFiles.length > 1 && <button className="ws-menu-i" onClick={() => setSub('file')}>{IC.preview}Another file in this project…<span className="ws-chev">›</span></button>}
        <button className="ws-menu-i" onClick={() => setSub('article')}>{IC.source}Another article (my projects)…<span className="ws-chev">›</span></button>
        {(pdfs.length || imgs.length) ? <button className="ws-menu-i" onClick={() => setSub('media')}>{IC.image}Open a file (PDF / image)…<span className="ws-chev">›</span></button> : null}
        <button className="ws-menu-i" onClick={() => { ctx.onUploadPdf(); onClose(); }}>{IC.pdf}Upload a PDF…</button>
        <button className="ws-menu-i" onClick={() => { ctx.onAddKind('pdf', ctx.activeDocId, true); onClose(); }}>{IC.pdf}Export this preview as PDF</button>
      </>}
      {sub === 'file' && <>
        <button className="ws-back" onClick={() => setSub(null)}>‹ Back</button>
        <div className="ws-menu-h">Open file as preview</div>
        {texFiles.map((f) => <button key={f} className="ws-menu-i" onClick={() => { ctx.onAddKind('preview', f); onClose(); }}><span className="ws-sync-dot" style={{ background: ctx.docColor(f) }} />{bn(f)}</button>)}
      </>}
      {sub === 'media' && <>
        <button className="ws-back" onClick={() => setSub(null)}>‹ Back</button>
        {pdfs.length ? <div className="ws-menu-h">PDF</div> : null}
        {pdfs.map((f) => <button key={f} className="ws-menu-i" onClick={() => { ctx.onAddMedia('pdf', f); onClose(); }}>{IC.pdf}{bn(f)}</button>)}
        {imgs.length ? <div className="ws-menu-h">Images</div> : null}
        {imgs.map((f) => <button key={f} className="ws-menu-i" onClick={() => { ctx.onAddMedia('image', f); onClose(); }}>{IC.image}{bn(f)}</button>)}
      </>}
      {sub === 'article' && <>
        <button className="ws-back" onClick={() => setSub(null)}>‹ Back</button>
        <div className="ws-menu-h">Pick a project</div>
        {ctx.myProjects().length === 0 && <div className="ws-menu-empty">No other projects.</div>}
        {ctx.myProjects().map((p) => <button key={p.id} className="ws-menu-i" onClick={() => { setProj(p); setSub('articleFile'); }}>{IC.source}<span className="ws-name-t">{p.title}</span><span className="ws-chev">›</span></button>)}
      </>}
      {sub === 'articleFile' && proj && <>
        <button className="ws-back" onClick={() => setSub('article')}>‹ {proj.title}</button>
        <div className="ws-menu-h">Open article (read-only reference)</div>
        {ctx.projTexFiles(proj).map((f) => <div key={f} className="ws-art-row">
          <span className="ws-name-t">{bn(f)}</span>
          <button onClick={() => { ctx.onAddExternal(proj, f, 'source'); onClose(); }}>Source</button>
          <button onClick={() => { ctx.onAddExternal(proj, f, 'preview'); onClose(); }}>Preview</button>
          <button className="both" onClick={() => { ctx.onAddExternal(proj, f, 'both'); onClose(); }}>Both</button>
        </div>)}
      </>}
    </div>;
  }

  /* ---------------- preset bar ---------------- */
  function Presets({ ctx }) {
    const items = [
      ['split', 'Split', 'M2 3h12v10H2z M8 3v10'],
      ['preview', 'Preview only', 'M2 3h12v10H2z M5 6h6M5 8.5h6M5 11h4'],
      ['source', 'Source only', 'M2 3h12v10H2z M6 6L4 8l2 2M10 6l2 2-2 2'],
      ['compiled', 'Source + Compiled (real TeX)', 'M2 3h12v10H2z M8 3v10 M10 6l1.3 1.3L10 8.6'],
      ['threeup', '3-up + PDF', 'M2 3h12v10H2z M6.5 3v10M10.5 3v10'],
    ];
    return <div className="ws-presets">
      {items.map(([k, label, d]) => <button key={k} className={'ws-preset' + (ctx.preset === k ? ' on' : '')} title={label} onClick={() => ctx.onPreset(k)}>
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.2">{d.split(' M').map((seg, i) => <path key={i} d={(i ? 'M' : '') + seg} strokeLinejoin="round" />)}</svg>
        <span>{label}</span>
      </button>)}
    </div>;
  }

  window.Workspace = { Workspace, AddPaneMenu, Presets };
})();
