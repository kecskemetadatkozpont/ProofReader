/* Publify — Research Notes. A license-clean, dependency-free block-notes editor for a research project
 * (Notion-like): typed blocks (paragraph / h1-3 / bullet / todo / quote / code) with markdown shortcuts,
 * Enter→new block, Backspace→merge, debounced jsonb autosave to research_notes (migration-22). Pure
 * React.createElement + textareas, no contentEditable quirks, no bundler. Exposed as window.PRNotes. */
(function () {
  var h = React.createElement;
  var useState = React.useState, useEffect = React.useEffect, useRef = React.useRef;
  var BE = window.PR_BACKEND, sb = BE && BE.sb;

  function uid() { return 'b' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4); }
  var SHORTCUTS = [['### ', 'h3'], ['## ', 'h2'], ['# ', 'h1'], ['- ', 'bullet'], ['* ', 'bullet'], ['[] ', 'todo'], ['[ ] ', 'todo'], ['> ', 'quote'], ['``` ', 'code']];
  var TYPE_OPTS = [['p', 'Szöveg'], ['h1', 'Cím 1'], ['h2', 'Cím 2'], ['h3', 'Cím 3'], ['bullet', 'Felsorolás'], ['todo', 'Teendő'], ['quote', 'Idézet'], ['code', 'Kód']];
  function taStyle(t) {
    var base = { width: '100%', border: 0, outline: 'none', resize: 'none', background: 'transparent', fontFamily: 'inherit', color: 'var(--ink)', lineHeight: 1.55, padding: '2px 0', overflow: 'hidden', boxSizing: 'border-box' };
    if (t === 'h1') return Object.assign(base, { fontSize: 25, fontWeight: 700, lineHeight: 1.25 });
    if (t === 'h2') return Object.assign(base, { fontSize: 20, fontWeight: 700, lineHeight: 1.3 });
    if (t === 'h3') return Object.assign(base, { fontSize: 16.5, fontWeight: 700 });
    if (t === 'quote') return Object.assign(base, { fontSize: 14.5, fontStyle: 'italic', color: 'var(--muted)' });
    if (t === 'code') return Object.assign(base, { fontSize: 13, fontFamily: 'ui-monospace, Menlo, monospace' });
    return Object.assign(base, { fontSize: 14.5 });
  }

  function Notes(props) {
    var canEdit = props.canEdit !== false;
    var bS = useState([]), blocks = bS[0], setBlocks = bS[1];
    var ldS = useState(false), loaded = ldS[0], setLoaded = ldS[1];
    var stS = useState(''), status = stS[0], setStatus = stS[1];
    var hovS = useState(null), hover = hovS[0], setHover = hovS[1];
    var taRefs = useRef({}), focusId = useRef(null), justLoaded = useRef(false), saveT = useRef(null);

    useEffect(function () {
      if (!sb) { setLoaded(true); return; }
      sb.from('research_notes').select('blocks').eq('project_id', props.projectId).maybeSingle().then(function (r) {
        var b = (r && r.data && r.data.blocks) || [];
        setBlocks(Array.isArray(b) && b.length ? b : [{ id: uid(), type: 'p', text: '' }]);
        justLoaded.current = true; setLoaded(true);
      }, function () { setBlocks([{ id: uid(), type: 'p', text: '' }]); setLoaded(true); });
    }, [props.projectId]);

    useEffect(function () {
      if (!loaded || !canEdit || !sb) return;
      if (justLoaded.current) { justLoaded.current = false; return; }
      if (saveT.current) clearTimeout(saveT.current);
      saveT.current = setTimeout(function () {
        setStatus('Mentés…');
        sb.from('research_notes').upsert({ project_id: props.projectId, blocks: blocks, updated_at: new Date().toISOString(), updated_by: props.authorId }, { onConflict: 'project_id' })
          .then(function (r) { setStatus(r && r.error ? 'Mentés sikertelen' : 'Mentve ✓'); setTimeout(function () { setStatus(''); }, 1400); });
      }, 900);
      return function () { if (saveT.current) clearTimeout(saveT.current); };
    }, [blocks, loaded]); // eslint-disable-line

    // focus a block after a structural change
    useEffect(function () { if (focusId.current && taRefs.current[focusId.current]) { var ta = taRefs.current[focusId.current]; ta.focus(); try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch (e) { } focusId.current = null; } });

    function fit(ta) { if (ta) { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; } }
    function patch(id, p) { setBlocks(function (bs) { return bs.map(function (b) { return b.id === id ? Object.assign({}, b, p) : b; }); }); }
    function onInput(b, e) {
      var v = e.target.value;
      // markdown shortcut at the very start
      for (var i = 0; i < SHORTCUTS.length; i++) { if (v.indexOf(SHORTCUTS[i][0]) === 0 && b.type === 'p') { patch(b.id, { type: SHORTCUTS[i][1], text: v.slice(SHORTCUTS[i][0].length) }); fit(e.target); return; } }
      patch(b.id, { text: v }); fit(e.target);
    }
    function newAfter(id) { var nb = { id: uid(), type: 'p', text: '' }; setBlocks(function (bs) { var i = bs.findIndex(function (b) { return b.id === id; }); var c = bs.slice(); c.splice(i + 1, 0, nb); return c; }); focusId.current = nb.id; }
    function remove(id) { setBlocks(function (bs) { if (bs.length <= 1) return [{ id: uid(), type: 'p', text: '' }]; var i = bs.findIndex(function (b) { return b.id === id; }); focusId.current = bs[i - 1] && bs[i - 1].id; return bs.filter(function (b) { return b.id !== id; }); }); }
    function onKey(b, e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); newAfter(b.id); }
      else if (e.key === 'Backspace' && e.target.value === '' && e.target.selectionStart === 0) { e.preventDefault(); if (b.type !== 'p') patch(b.id, { type: 'p' }); else remove(b.id); }
    }

    if (!loaded) return h('div', { className: 'empty' }, 'Jegyzetek betöltése…');

    return h('div', null,
      h('div', { style: { display: 'flex', alignItems: 'center', marginBottom: 8 } },
        h('div', { style: { fontSize: 12, color: 'var(--faint)' } }, 'Markdown: # cím · - felsorolás · [] teendő · > idézet'),
        h('span', { style: { flex: 1 } }),
        status ? h('span', { style: { fontSize: 12, fontWeight: 600, color: /sikertelen/.test(status) ? 'var(--danger)' : 'var(--ok)' } }, status) : null),
      h('div', { style: { maxWidth: 760, border: '1px solid var(--line)', borderRadius: 14, background: 'var(--surface)', padding: '18px 22px', minHeight: '50vh' } },
        blocks.map(function (b) {
          var isQ = b.type === 'quote', isC = b.type === 'code', isB = b.type === 'bullet', isT = b.type === 'todo';
          return h('div', { key: b.id, onMouseEnter: function () { setHover(b.id); }, onMouseLeave: function () { setHover(function (x) { return x === b.id ? null : x; }); }, style: { display: 'flex', alignItems: 'flex-start', gap: 6, position: 'relative', padding: '1px 0', marginLeft: isQ ? 12 : 0, borderLeft: isQ ? '3px solid var(--line)' : 'none', paddingLeft: isQ ? 12 : 0 } },
            // hover gutter
            (canEdit && hover === b.id) ? h('div', { style: { position: 'absolute', left: -64, top: 2, display: 'flex', gap: 2 } },
              h('button', { title: 'Új blokk', onMouseDown: function (e) { e.preventDefault(); }, onClick: function () { newAfter(b.id); }, style: gbtn }, '+'),
              h('select', { value: b.type, onChange: function (e) { patch(b.id, { type: e.target.value }); }, style: { fontSize: 11, border: '1px solid var(--line)', borderRadius: 6, background: 'var(--surface)', color: 'var(--ink)' } }, TYPE_OPTS.map(function (o) { return h('option', { key: o[0], value: o[0] }, o[1]); })),
              h('button', { title: 'Törlés', onMouseDown: function (e) { e.preventDefault(); }, onClick: function () { remove(b.id); }, style: gbtn }, '×')) : null,
            isT ? h('input', { type: 'checkbox', checked: !!b.checked, onChange: function (e) { patch(b.id, { checked: e.target.checked }); }, style: { marginTop: 5 } }) : null,
            isB ? h('span', { style: { marginTop: 1, color: 'var(--muted)', lineHeight: '1.55', fontSize: 16 } }, '•') : null,
            isC ? null : null,
            h('textarea', {
              ref: function (el) { if (el) { taRefs.current[b.id] = el; fit(el); } else delete taRefs.current[b.id]; },
              value: b.text, rows: 1, disabled: !canEdit, placeholder: b.type === 'p' && blocks.length === 1 ? 'Írj ide… (Markdown támogatott)' : '',
              onChange: function (e) { onInput(b, e); }, onKeyDown: function (e) { onKey(b, e); },
              style: Object.assign({}, taStyle(b.type), isT && b.checked ? { textDecoration: 'line-through', color: 'var(--faint)' } : {}, isC ? { background: 'var(--surface-2)', borderRadius: 8, padding: '8px 10px' } : {})
            }));
        })),
      h('div', { style: { fontSize: 11.5, color: 'var(--faint)', marginTop: 6 } }, 'Enter = új blokk · Shift+Enter = sortörés · Backspace üres blokkon = törlés · vidd az egeret a blokk fölé a típusváltáshoz')
    );
  }
  var gbtn = { width: 20, height: 20, border: '1px solid var(--line)', borderRadius: 5, background: 'var(--surface)', color: 'var(--muted)', cursor: 'pointer', fontSize: 12, lineHeight: '16px', padding: 0 };

  window.PRNotes = Notes;
})();
