/* CodeEditor: editable textarea + synced highlight backdrop + gutter.
 * Props: value, onChange, readStart, readEnd, onCaret(offset), fontSize, lineHeight
 *
 * Tier-1 editing features (all client-side, undo-preserving via execCommand):
 *   • Smart bracket / quote / $ auto-close + wrap-selection + skip-over + pair-delete
 *   • Tab / Shift+Tab indent of the selection; auto-indent on Enter
 *   • Cmd/Ctrl + /  toggle % line comments
 *   • Alt+↑/↓ move line(s); Shift+Alt+↑/↓ duplicate line(s)
 *   • Cmd/Ctrl + F  Find & Replace bar (case / whole-word / regex, next/prev, replace, replace-all)
 */
(function () {
  const { useRef, useLayoutEffect, useCallback, useState, useEffect } = React;

  function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  // Tokenize LaTeX and emit highlighted HTML. `marks` = sorted, non-overlapping
  // [{s,e,cls}] ranges wrapped in <mark class=cls> (reading highlight + find matches).
  function highlight(src, marks) {
    marks = (marks || []).filter((m) => m && m.e > m.s).sort((a, b) => a.s - b.s);
    const n = src.length; let i = 0; let out = '';
    function span(t, cls) { return t ? (cls ? '<span class="' + cls + '">' + esc(t) + '</span>' : esc(t)) : ''; }
    function emit(s, e, cls) {
      if (s >= e) return;
      let p = s;
      for (const mk of marks) {
        if (mk.e <= p || mk.s >= e) continue;
        if (mk.s > p) { out += span(src.slice(p, mk.s), cls); p = mk.s; }
        const b = Math.min(e, mk.e);
        out += '<mark class="' + mk.cls + '">' + span(src.slice(p, b), cls) + '</mark>';
        p = b; if (p >= e) break;
      }
      if (p < e) out += span(src.slice(p, e), cls);
    }

    while (i < n) {
      const ch = src[i];
      if (ch === '%') { let j = i + 1; while (j < n && src[j] !== '\n') j++; emit(i, j, 'tk-com'); i = j; continue; }
      if (ch === '\\') {
        if (/[a-zA-Z]/.test(src[i + 1] || '')) { let j = i + 1; while (j < n && /[a-zA-Z]/.test(src[j])) j++; if (src[j] === '*') j++; emit(i, j, 'tk-cmd'); i = j; continue; }
        emit(i, i + 2, 'tk-cmd'); i += 2; continue;
      }
      if (ch === '$') { let j = i + 1; while (j < n && !(src[j] === '$' && src[j - 1] !== '\\')) j++; j = Math.min(j + 1, n); emit(i, j, 'tk-math'); i = j; continue; }
      if (ch === '{' || ch === '}' || ch === '[' || ch === ']') { emit(i, i + 1, 'tk-br'); i++; continue; }
      if (ch === '&' || ch === '#' || ch === '~' || ch === '^' || ch === '_') { emit(i, i + 1, 'tk-sp'); i++; continue; }
      // text run
      let j = i + 1; while (j < n && '%\\${}[]&#~^_'.indexOf(src[j]) < 0) j++;
      emit(i, j, null); i = j;
    }
    return out + '\n';
  }

  // ---- edit primitives (preserve the native undo stack) ----
  const OPEN = { '{': '}', '[': ']', '(': ')', '$': '$' };
  const CLOSERS = ')]}$';

  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function uniq(a) { const o = []; a.forEach((x) => { if (x && o.indexOf(x) < 0) o.push(x); }); return o; }

  // ---- autocomplete dictionaries ----
  const COMMANDS = ['section', 'subsection', 'subsubsection', 'paragraph', 'textbf', 'textit', 'texttt', 'emph', 'underline',
    'footnote', 'label', 'ref', 'eqref', 'autoref', 'cite', 'citep', 'citet', 'href', 'url', 'caption', 'includegraphics',
    'item', 'begin', 'end', 'frac', 'sqrt', 'sum', 'int', 'alpha', 'beta', 'gamma', 'delta', 'theta', 'lambda', 'sigma',
    'today', 'maketitle', 'tableofcontents', 'newpage', 'centering', 'noindent', 'textwidth', 'linewidth'];
  // commands that take a {…} argument → insert cmd{} with the caret inside
  const ARGCMD = new Set(['section', 'subsection', 'subsubsection', 'paragraph', 'textbf', 'textit', 'texttt', 'emph',
    'underline', 'footnote', 'label', 'ref', 'eqref', 'autoref', 'cite', 'citep', 'citet', 'caption', 'includegraphics', 'frac', 'sqrt']);
  const ENVS = ['itemize', 'enumerate', 'figure', 'table', 'tabular', 'equation', 'align', 'abstract', 'center', 'quote',
    'verbatim', 'theorem', 'proof', 'lemma', 'definition', 'matrix', 'cases', 'description'];
  // snippet body uses ‹0›…‹3› as tab-stops; ‹0› is the initial caret
  const SNIPPETS = {
    figure: { alias: 'fig', body: '\\begin{figure}[h]\n\\centering\n\\includegraphics[width=0.8\\linewidth]{‹0›}\n\\caption{‹1›}\n\\label{fig:‹2›}\n\\end{figure}' },
    table: { alias: 'tbl', body: '\\begin{table}[h]\n\\centering\n\\begin{tabular}{‹0›}\n‹1›\n\\end{tabular}\n\\caption{‹2›}\n\\label{tab:‹3›}\n\\end{table}' },
    equation: { alias: 'eq', body: '\\begin{equation}\n‹0›\n\\label{eq:‹1›}\n\\end{equation}' },
    itemize: { alias: 'list', body: '\\begin{itemize}\n\\item ‹0›\n\\end{itemize}' },
    enumerate: { alias: 'num', body: '\\begin{enumerate}\n\\item ‹0›\n\\end{enumerate}' },
  };

  function CodeEditor(props) {
    const taRef = useRef(null), backRef = useRef(null), gutRef = useRef(null);
    const pendingSel = useRef(null);          // [start,end] to restore after a controlled value change
    const findRef = useRef(null);

    const [find, setFind] = useState(null);   // null = closed; else { q, repl, cs, ww, re }
    const [info, setInfo] = useState({ idx: 0, total: 0, err: false });
    const [ac, setAc] = useState(null);        // autocomplete: { items, sel, from, to, kind, x, y }
    const charWRef = useRef({ fs: 0, w: 0 });
    const acRef = useRef(null); acRef.current = ac;

    const sync = useCallback(() => {
      const ta = taRef.current; if (!ta) return;
      if (backRef.current) { backRef.current.scrollTop = ta.scrollTop; backRef.current.scrollLeft = ta.scrollLeft; }
      if (gutRef.current) gutRef.current.scrollTop = ta.scrollTop;
    }, []);

    useLayoutEffect(() => { sync(); });

    // restore programmatic selection after a controlled re-render
    useLayoutEffect(() => {
      if (!pendingSel.current) return;
      const ta = taRef.current; if (!ta) { pendingSel.current = null; return; }
      const [s, e] = pendingSel.current; pendingSel.current = null;
      try { ta.setSelectionRange(s, e); } catch (_) { }
    }, [props.value]);

    // auto-scroll to the reading line when it changes
    useLayoutEffect(() => {
      if (props.readStart == null) return;
      const ta = taRef.current; if (!ta) return;
      const line = props.value.slice(0, props.readStart).split('\n').length - 1;
      const y = line * props.lineHeight;
      const top = ta.scrollTop, h = ta.clientHeight;
      if (y < top + props.lineHeight || y > top + h - props.lineHeight * 2) {
        ta.scrollTop = Math.max(0, y - h / 2);
        sync();
      }
    }, [props.readStart]);

    // programmatic selection (jump from a comment/to-do)
    useLayoutEffect(() => {
      const sr = props.selectReq; if (!sr) return;
      const ta = taRef.current; if (!ta) return;
      ta.focus(); try { ta.setSelectionRange(sr.start, sr.end); } catch (e) { }
      const line = props.value.slice(0, sr.start).split('\n').length - 1;
      ta.scrollTop = Math.max(0, line * props.lineHeight - ta.clientHeight / 2); sync();
    }, [props.selectReq]);

    /* ------- edit helpers ------- */
    // Replace the textarea's current selection, preserving undo; optionally re-select.
    function insertText(text, selOffsetStart, selOffsetEnd) {
      const ta = taRef.current; if (!ta) return;
      const start = ta.selectionStart;
      let ok = false;
      try { ok = document.execCommand('insertText', false, text); } catch (_) { ok = false; }
      if (!ok) {
        // fallback: controlled update
        const v = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
        const nv = v.slice(0, s) + text + v.slice(e);
        const cs = s + (selOffsetStart != null ? selOffsetStart : text.length);
        const ce = s + (selOffsetEnd != null ? selOffsetEnd : selOffsetStart != null ? selOffsetStart : text.length);
        pendingSel.current = [cs, ce];
        props.onChange(nv);
        return;
      }
      if (selOffsetStart != null) {
        const cs = start + selOffsetStart, ce = start + (selOffsetEnd != null ? selOffsetEnd : selOffsetStart);
        try { ta.setSelectionRange(cs, ce); } catch (_) { }
      }
    }
    // Select an absolute range, then replace it (used by line ops / replace).
    function replaceRange(s, e, text, selS, selE) {
      const ta = taRef.current; if (!ta) return;
      ta.focus();
      try { ta.setSelectionRange(s, e); } catch (_) { }
      let ok = false;
      try { ok = document.execCommand('insertText', false, text); } catch (_) { ok = false; }
      if (!ok) {
        const v = ta.value, nv = v.slice(0, s) + text + v.slice(e);
        pendingSel.current = [selS != null ? selS : s + text.length, selE != null ? selE : (selS != null ? selS : s + text.length)];
        props.onChange(nv);
        return;
      }
      if (selS != null) { try { ta.setSelectionRange(selS, selE != null ? selE : selS); } catch (_) { } }
    }

    function lineBounds(v, from, to) {
      let ls = v.lastIndexOf('\n', from - 1) + 1;
      let le = v.indexOf('\n', to); if (le < 0) le = v.length;
      return [ls, le];
    }

    /* ------- autocomplete ------- */
    function charWidth() {
      const c = charWRef.current;
      if (c.fs === props.fontSize && c.w) return c.w;
      const cx = document.createElement('canvas').getContext('2d');
      cx.font = props.fontSize + 'px "JetBrains Mono", monospace';
      const w = cx.measureText('M').width || props.fontSize * 0.6;
      charWRef.current = { fs: props.fontSize, w }; return w;
    }
    function curIndent(v, pos) {
      const ls = v.lastIndexOf('\n', pos - 1) + 1;
      return (v.slice(ls).match(/^[ \t]*/) || [''])[0];
    }
    function collectKeys(v, re) { const out = []; let m; while ((m = re.exec(v))) out.push(m[1]); return out; }
    function acPos(to) {
      const ta = taRef.current; const v = ta.value;
      const upto = v.slice(0, to);
      const line = upto.split('\n').length - 1;
      const col = to - (upto.lastIndexOf('\n') + 1);
      const x = 16 + col * charWidth() - ta.scrollLeft;
      const y = 14 + (line + 1) * props.lineHeight - ta.scrollTop + 3;
      return { x: Math.max(4, x), y };
    }
    function openAC(items, from, to, kind) {
      if (!items.length) { setAc(null); return; }
      const p = acPos(to);
      setAc({ items: items.slice(0, 8), sel: 0, from, to, kind, x: p.x, y: p.y });
    }
    function refreshAC() {
      const ta = taRef.current; if (!ta || props.readOnly) { setAc(null); return; }
      if (ta.selectionStart !== ta.selectionEnd) { setAc(null); return; }
      const caret = ta.selectionStart, v = ta.value, before = v.slice(0, caret);
      let m;
      if ((m = /\\(?:ref|eqref|autoref|cref|pageref)\{([^}\n]*)$/.exec(before))) {
        const partial = m[1], from = caret - partial.length;
        const keys = uniq(collectKeys(v, /\\(?:label|ref|eqref|autoref|cref|pageref)\{([^}\n]+)\}/g));
        const items = keys.filter((k) => k.toLowerCase().indexOf(partial.toLowerCase()) >= 0).map((k) => ({ label: k, insert: k, kind: 'ref' }));
        return openAC(items, from, caret, 'ref');
      }
      if ((m = /\\cite[a-z]*\{([^}\n]*)$/.exec(before))) {
        const partial = m[1], from = caret - partial.length;
        const keys = uniq((props.bibKeys || []).concat(collectKeys(v, /\\bibitem\{([^}\n]+)\}/g)));
        const items = keys.filter((k) => k.toLowerCase().indexOf(partial.toLowerCase()) >= 0).map((k) => ({ label: k, insert: k, kind: 'cite' }));
        return openAC(items, from, caret, 'cite');
      }
      if ((m = /\\(begin|end)\{([a-zA-Z*]*)$/.exec(before))) {
        const which = m[1], partial = m[2], from = caret - partial.length;
        const items = ENVS.filter((en) => en.toLowerCase().indexOf(partial.toLowerCase()) === 0)
          .map((en) => ({ label: en, insert: en, kind: 'env', which }));
        return openAC(items, from, caret, 'env');
      }
      if ((m = /\\([a-zA-Z]+)$/.exec(before))) {
        const partial = m[1], pl = partial.toLowerCase(), from = caret - partial.length;
        const cmds = COMMANDS.filter((c) => c.toLowerCase().indexOf(pl) === 0).map((c) => ({ label: '\\' + c, insert: c, kind: ARGCMD.has(c) ? 'argcmd' : 'cmd' }));
        const snips = Object.keys(SNIPPETS).filter((s) => s.indexOf(pl) === 0 || (SNIPPETS[s].alias && SNIPPETS[s].alias.indexOf(pl) === 0))
          .map((s) => ({ label: s, insert: s, kind: 'snippet', hint: 'snippet' }));
        return openAC(cmds.concat(snips), from, caret, 'cmd');
      }
      setAc(null);
    }
    function acceptAC(item) {
      const ta = taRef.current; if (!ta || !item) return;
      const v = ta.value, a = acRef.current; if (!a) return;
      const from = a.from, to = a.to;
      if (item.kind === 'ref' || item.kind === 'cite') {
        replaceRange(from, to, item.insert, from + item.insert.length, from + item.insert.length);
      } else if (item.kind === 'env') {
        const cmdStart = from - ('\\' + item.which + '{').length;
        const closeAt = v[to] === '}' ? to + 1 : to;
        const indent = curIndent(v, cmdStart);
        if (item.which === 'begin') {
          const head = '\\begin{' + item.insert + '}';
          const body = '\n' + indent + '  ';
          const tail = '\n' + indent + '\\end{' + item.insert + '}';
          const text = head + body + tail;
          const caret = cmdStart + head.length + body.length;
          replaceRange(cmdStart, closeAt, text, caret, caret);
        } else {
          const text = '\\end{' + item.insert + '}';
          replaceRange(cmdStart, closeAt, text, cmdStart + text.length, cmdStart + text.length);
        }
      } else if (item.kind === 'snippet') {
        const sp = SNIPPETS[item.insert];
        const bsStart = from - 1; // include the backslash
        const indent = curIndent(v, bsStart);
        let body = sp.body.split('\n').map((ln, i) => i === 0 ? ln : indent + ln).join('\n');
        let caretOff = body.indexOf('‹0›'); if (caretOff < 0) caretOff = body.length;
        body = body.replace(/‹\d›/g, '');
        // recompute caret after stripping markers before it
        const cleanBefore = sp.body; // approximate: count markers removed before ‹0›
        const stripped = body;
        const caret = bsStart + caretOff;
        replaceRange(bsStart, to, stripped, caret, caret);
      } else { // cmd / argcmd
        if (item.kind === 'argcmd') {
          const text = item.insert + '{}';
          const caret = from + item.insert.length + 1;
          replaceRange(from, to, text, caret, caret);
        } else {
          replaceRange(from, to, item.insert, from + item.insert.length, from + item.insert.length);
        }
      }
      setAc(null);
    }

    function onKeyDown(e) {
      const ta = taRef.current; if (!ta) return;

      // autocomplete navigation takes priority
      if (acRef.current) {
        const a = acRef.current;
        if (e.key === 'ArrowDown') { e.preventDefault(); setAc({ ...a, sel: (a.sel + 1) % a.items.length }); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); setAc({ ...a, sel: (a.sel - 1 + a.items.length) % a.items.length }); return; }
        if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); acceptAC(a.items[a.sel]); return; }
        if (e.key === 'Escape') { e.preventDefault(); setAc(null); return; }
      }

      const mod = e.metaKey || e.ctrlKey;
      const v = ta.value, s = ta.selectionStart, en = ta.selectionEnd;

      // Find / Replace
      if (mod && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        const seed = (s !== en && v.slice(s, en).indexOf('\n') < 0) ? v.slice(s, en) : (find ? find.q : '');
        setFind((f) => ({ q: seed, repl: f ? f.repl : '', cs: f ? f.cs : false, ww: f ? f.ww : false, re: f ? f.re : false }));
        setTimeout(() => { if (findRef.current) { findRef.current.focus(); findRef.current.select(); } }, 0);
        return;
      }
      if (e.key === 'Escape' && find) { setFind(null); ta.focus(); return; }
      if (props.readOnly) return;

      // Cmd/Ctrl + /  → toggle % comment
      if (mod && e.key === '/') {
        e.preventDefault();
        const [ls, le] = lineBounds(v, s, en);
        const block = v.slice(ls, le);
        const lines = block.split('\n');
        const allCommented = lines.every((l) => l.trim() === '' || /^\s*%/.test(l));
        const out = lines.map((l) => {
          if (allCommented) return l.replace(/^(\s*)%\s?/, '$1');
          if (l.trim() === '') return l;
          return l.replace(/^(\s*)/, '$1% ');
        }).join('\n');
        replaceRange(ls, le, out, ls, ls + out.length);
        return;
      }

      // Alt+↑/↓ move lines; Shift+Alt+↑/↓ duplicate
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        const [ls, le] = lineBounds(v, s, en);
        const block = v.slice(ls, le);
        if (e.shiftKey) {
          // duplicate
          if (e.key === 'ArrowDown') { replaceRange(le, le, '\n' + block, le + 1, le + 1 + block.length); }
          else { replaceRange(ls, ls, block + '\n', ls, ls + block.length); }
          return;
        }
        if (e.key === 'ArrowUp') {
          if (ls === 0) return;
          const prevStart = v.lastIndexOf('\n', ls - 2) + 1;
          const prev = v.slice(prevStart, ls - 1);
          const newText = block + '\n' + prev;
          replaceRange(prevStart, le, newText, prevStart + (s - ls), prevStart + (en - ls));
        } else {
          if (le >= v.length) return;
          let nextEnd = v.indexOf('\n', le + 1); if (nextEnd < 0) nextEnd = v.length;
          const next = v.slice(le + 1, nextEnd);
          const newText = next + '\n' + block;
          const delta = next.length + 1;
          replaceRange(ls, nextEnd, newText, s + delta, en + delta);
        }
        return;
      }

      // Tab / Shift+Tab → indent selection
      if (e.key === 'Tab') {
        e.preventDefault();
        if (s === en) { insertText('  ', 2, 2); return; }
        const [ls, le] = lineBounds(v, s, en);
        const block = v.slice(ls, le);
        let out, dS = 0, dE = 0;
        if (e.shiftKey) {
          out = block.split('\n').map((l, i) => {
            const m = l.match(/^( {1,2}|\t)/);
            if (m && i === 0) dS = -m[0].length;
            if (m) dE -= m[0].length;
            return l.replace(/^( {1,2}|\t)/, '');
          }).join('\n');
        } else {
          const arr = block.split('\n');
          out = arr.map((l) => '  ' + l).join('\n');
          dS = 2; dE = 2 * arr.length;
        }
        replaceRange(ls, le, out, Math.max(ls, s + dS), en + dE);
        return;
      }

      // Enter → keep current line indentation
      if (e.key === 'Enter' && !e.shiftKey && s === en) {
        const lineStart = v.lastIndexOf('\n', s - 1) + 1;
        const indent = (v.slice(lineStart, s).match(/^[ \t]*/) || [''])[0];
        if (indent) { e.preventDefault(); insertText('\n' + indent, indent.length + 1, indent.length + 1); return; }
        return;
      }

      // Backspace → delete an empty pair  {|}  $|$
      if (e.key === 'Backspace' && s === en && s > 0) {
        const before = v[s - 1], after = v[s];
        if (OPEN[before] && OPEN[before] === after) { e.preventDefault(); replaceRange(s - 1, s + 1, '', s - 1, s - 1); return; }
        return;
      }

      // Skip over a just-typed closer
      if (CLOSERS.indexOf(e.key) >= 0 && s === en && v[s] === e.key) {
        // for $ only skip if it actually closes (handled simply: skip)
        e.preventDefault();
        try { ta.setSelectionRange(s + 1, s + 1); } catch (_) { }
        return;
      }

      // Auto-close / wrap
      if (OPEN[e.key]) {
        const close = OPEN[e.key];
        if (s !== en) { // wrap selection
          e.preventDefault();
          const sel = v.slice(s, en);
          replaceRange(s, en, e.key + sel + close, s + 1, en + 1);
          return;
        }
        // don't auto-close $ right after a letter/backslash-less context is fine; keep simple
        const next = v[s] || '';
        if (next === '' || /[\s${}()[\].,;:]/.test(next)) {
          e.preventDefault();
          insertText(e.key + close, 1, 1);
          return;
        }
      }
    }

    const lines = props.value.split('\n').length;
    const gutter = [];
    for (let k = 1; k <= lines; k++) gutter.push(k);

    let marks = [];
    if (find && find.q) {
      const r = allMatches(find);
      if (!r.err) marks = r.list.map((m, k) => ({ s: m[0], e: m[1], cls: 'fm' + (k === info.idx - 1 ? ' cur' : '') }));
    } else if (props.readStart != null && props.readEnd != null && props.readEnd > props.readStart) {
      marks = [{ s: props.readStart, e: props.readEnd, cls: 'rd' }];
    }
    // subtle comment/to-do underlay (highlight() sorts; overlaps resolve gracefully)
    if (props.annoMarks && props.annoMarks.length) marks = marks.concat(props.annoMarks);

    const fontStyle = { fontSize: props.fontSize + 'px', lineHeight: props.lineHeight + 'px' };

    const reportCaret = () => { const ta = taRef.current; if (!ta) return; if (props.onCaret) props.onCaret(ta.selectionStart); if (props.onSelectRange) props.onSelectRange(ta.selectionStart, ta.selectionEnd); };
    const reportJump = () => { const ta = taRef.current; if (!ta) return; if (props.onJump) props.onJump(ta.selectionStart); if (props.onSelectRange) props.onSelectRange(ta.selectionStart, ta.selectionEnd); };

    /* ------- find / replace logic ------- */
    function buildRe(f) {
      if (!f || !f.q) return null;
      let pat = f.re ? f.q : escRe(f.q);
      if (f.ww) pat = '\\b' + pat + '\\b';
      try { return new RegExp(pat, 'g' + (f.cs ? '' : 'i')); } catch (_) { return false; }
    }
    function allMatches(f) {
      const re = buildRe(f);
      if (re === false) return { list: [], err: true };
      if (!re) return { list: [], err: false };
      const out = []; let m, guard = 0;
      const v = props.value;
      while ((m = re.exec(v)) && guard++ < 5000) { out.push([m.index, m.index + m[0].length]); if (m.index === re.lastIndex) re.lastIndex++; }
      return { list: out, err: false };
    }
    function gotoMatch(list, i) {
      if (!list.length) { setInfo({ idx: 0, total: 0, err: false }); return; }
      const idx = ((i % list.length) + list.length) % list.length;
      const a = list[idx][0];
      const ta = taRef.current;
      if (ta) {
        const line = props.value.slice(0, a).split('\n').length - 1;
        const y = line * props.lineHeight;
        if (y < ta.scrollTop + props.lineHeight || y > ta.scrollTop + ta.clientHeight - props.lineHeight * 2) {
          ta.scrollTop = Math.max(0, y - ta.clientHeight / 2); sync();
        }
      }
      setInfo({ idx: idx + 1, total: list.length, err: false });
      return idx;
    }
    function nextMatch(dir) {
      const { list, err } = allMatches(find);
      if (err) { setInfo({ idx: 0, total: 0, err: true }); return; }
      if (!list.length) { setInfo({ idx: 0, total: 0, err: false }); return; }
      const cur = info.idx - 1;
      let target = dir >= 0 ? (cur < 0 ? 0 : cur + 1) : (cur <= 0 ? list.length - 1 : cur - 1);
      gotoMatch(list, target);
    }
    function doReplace() {
      if (props.readOnly || !find) return;
      const { list } = allMatches(find);
      if (!list.length) return;
      let i = info.idx - 1; if (i < 0 || i >= list.length) i = 0;
      const [a, b] = list[i];
      const rep = computeRepl(find, props.value.slice(a, b));
      replaceRange(a, b, rep, a + rep.length, a + rep.length);
      setTimeout(() => {
        const r = allMatches(find);
        if (r.list.length) gotoMatch(r.list, Math.min(i, r.list.length - 1)); else setInfo({ idx: 0, total: 0, err: false });
        if (findRef.current) findRef.current.focus();
      }, 0);
    }
    function doReplaceAll() {
      if (props.readOnly || !find) return;
      const re = buildRe(find);
      if (!re || re === false) return;
      let count = 0;
      const nv = props.value.replace(re, (m0) => { count++; return computeRepl(find, m0); });
      if (count > 0) { pendingSel.current = null; props.onChange(nv); setTimeout(() => { const r = allMatches({ ...find }); setInfo({ idx: 0, total: r.list.length, err: false }); }, 0); }
    }
    function computeRepl(f, matched) {
      if (!f.re) return f.repl;
      // allow $1 group refs in regex mode
      try { const re = buildRe(f); re.lastIndex = 0; return matched.replace(new RegExp(re.source, re.flags.replace('g', '')), f.repl); } catch (_) { return f.repl; }
    }

    // recompute the count whenever the query/value changes while open
    useEffect(() => {
      if (!find) return;
      const { list, err } = allMatches(find);
      if (err) { setInfo({ idx: 0, total: 0, err: true }); return; }
      setInfo((prev) => ({ idx: prev.idx > 0 && prev.idx <= list.length ? prev.idx : 0, total: list.length, err: false }));
    }, [find && find.q, find && find.cs, find && find.ww, find && find.re, props.value]);

    function FindBar() {
      const f = find;
      const Toggle = (key, label, title) => React.createElement('button', {
        className: 'fb-tg' + (f[key] ? ' on' : ''), title, onClick: () => setFind({ ...f, [key]: !f[key] })
      }, label);
      return React.createElement('div', { className: 'find-bar', onKeyDown: (ev) => { if (ev.key === 'Escape') { setFind(null); if (taRef.current) taRef.current.focus(); } } },
        React.createElement('div', { className: 'fb-row' },
          React.createElement('input', {
            ref: findRef, className: 'fb-in', placeholder: 'Find', value: f.q,
            onChange: (ev) => setFind({ ...f, q: ev.target.value }),
            onKeyDown: (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); nextMatch(ev.shiftKey ? -1 : 1); } }
          }),
          React.createElement('span', { className: 'fb-count' + (info.err ? ' err' : '') }, info.err ? 'bad regex' : (info.total ? (info.idx ? info.idx + '/' + info.total : info.total + ' found') : 'no results')),
          React.createElement('div', { className: 'fb-tgs' },
            Toggle('cs', 'Aa', 'Match case'),
            Toggle('ww', 'W', 'Whole word'),
            Toggle('re', '.*', 'Regular expression')
          ),
          React.createElement('button', { className: 'fb-btn', title: 'Previous (Shift+Enter)', onClick: () => nextMatch(-1) }, '↑'),
          React.createElement('button', { className: 'fb-btn', title: 'Next (Enter)', onClick: () => nextMatch(1) }, '↓'),
          React.createElement('button', { className: 'fb-btn fb-x', title: 'Close (Esc)', onClick: () => { setFind(null); if (taRef.current) taRef.current.focus(); } }, '✕')
        ),
        !props.readOnly && React.createElement('div', { className: 'fb-row' },
          React.createElement('input', {
            className: 'fb-in', placeholder: 'Replace', value: f.repl,
            onChange: (ev) => setFind({ ...f, repl: ev.target.value }),
            onKeyDown: (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); doReplace(); } }
          }),
          React.createElement('button', { className: 'fb-rep', onClick: doReplace }, 'Replace'),
          React.createElement('button', { className: 'fb-rep', onClick: doReplaceAll }, 'All')
        )
      );
    }

    return (
      React.createElement('div', { className: 'editor' },
        React.createElement('div', { className: 'gutter', ref: gutRef },
          React.createElement('div', { className: 'gutter-inner', style: fontStyle },
            gutter.map((k) => React.createElement('div', { key: k, className: 'ln' + (props.readLine === k - 1 ? ' ln-active' : '') }, k))
          )
        ),
        React.createElement('div', { className: 'codearea' },
          find && FindBar(),
          React.createElement('pre', {
            ref: backRef, className: 'backdrop', style: fontStyle, 'aria-hidden': 'true',
            dangerouslySetInnerHTML: { __html: highlight(props.value, marks) }
          }),
          React.createElement('textarea', {
            ref: taRef, className: 'code-input', style: fontStyle, spellCheck: false,
            value: props.value, wrap: 'off', readOnly: !!props.readOnly,
            onChange: (e) => { props.onChange(e.target.value); refreshAC(); },
            onScroll: sync, onKeyDown: onKeyDown,
            onClick: () => { setAc(null); reportJump(); }, onKeyUp: reportCaret, onSelect: reportCaret, onMouseUp: reportCaret,
            onBlur: () => setTimeout(() => setAc(null), 150)
          }),
          ac && React.createElement('div', { className: 'ac-menu', style: { left: ac.x + 'px', top: ac.y + 'px' } },
            ac.items.map((it, i) => React.createElement('div', {
              key: i, className: 'ac-item' + (i === ac.sel ? ' on' : ''),
              onMouseDown: (ev) => { ev.preventDefault(); acceptAC(it); },
              onMouseEnter: () => setAc((a) => a ? { ...a, sel: i } : a)
            },
              React.createElement('span', { className: 'ac-label' }, it.label),
              it.hint && React.createElement('span', { className: 'ac-hint' }, it.hint)
            ))
          )
        )
      )
    );
  }

  window.CodeEditor = CodeEditor;
})();
