/* Publify — Research Canvas. A license-clean, dependency-free edgeless whiteboard for a research
 * project: typed nodes (note / idea / publication / source) on an infinite pan-zoom surface, typed
 * connectors, persisted as jsonb in research_canvas (migration-21). No BlockSuite / no bundler — pure
 * React.createElement + SVG, so it fits the no-build app. Exposed as window.PRCanvas. */
(function () {
  var h = React.createElement;
  var useState = React.useState, useEffect = React.useEffect, useRef = React.useRef;
  var BE = window.PR_BACKEND, sb = BE && BE.sb;

  var NW = 200, NH = 84;                 // default node box (for edge anchoring)
  function uid() { return 'n' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4); }
  var TYPE = {
    note: { label: 'Note', bg: 'var(--surface, #fff)', bd: 'var(--line, #e6e8ee)', accent: 'var(--muted)' },
    idea: { label: 'Idea', bg: 'var(--warn-bg, #fdf6e3)', bd: 'var(--warn, #b45309)', accent: 'var(--warn, #b45309)' },
    publication: { label: 'Publication', bg: 'var(--accent-tint, #eef0ff)', bd: 'var(--accent, #4f46e5)', accent: 'var(--accent, #4f46e5)' },
    source: { label: 'Source', bg: 'var(--ok-bg, #e7f6ee)', bd: 'var(--ok, #15803d)', accent: 'var(--ok, #15803d)' }
  };
  var EDGE_TYPES = ['relates', 'supports', 'contradicts', 'leads-to'];
  var EDGE_COLOR = { relates: 'var(--faint)', supports: 'var(--ok)', contradicts: 'var(--danger)', 'leads-to': 'var(--accent)' };

  function Canvas(props) {
    var canEdit = props.canEdit !== false;
    var nS = useState([]), nodes = nS[0], setNodes = nS[1];
    var eS = useState([]), edges = eS[0], setEdges = eS[1];
    var vS = useState({ tx: 60, ty: 60, k: 1 }), view = vS[0], setView = vS[1];
    var ldS = useState(false), loaded = ldS[0], setLoaded = ldS[1];
    var selS = useState(null), sel = selS[0], setSel = selS[1];      // {kind:'node'|'edge', id}
    var edS = useState(null), editing = edS[0], setEditing = edS[1]; // node id being edited
    var cnS = useState(null), conn = cnS[0], setConn = cnS[1];       // {from, x, y} live connector
    var stS = useState(''), status = stS[0], setStatus = stS[1];
    var mnS = useState(null), menu = mnS[0], setMenu = mnS[1];       // 'idea' | 'pub' picker open
    var ideaS = useState([]), pickIdeas = ideaS[0], setPickIdeas = ideaS[1];
    var pubS = useState([]), pickPubs = pubS[0], setPickPubs = pubS[1];

    var vpRef = useRef(null), drag = useRef(null), justLoaded = useRef(false), saveT = useRef(null);

    // ---- load ----
    useEffect(function () {
      if (!sb) { setLoaded(true); return; }
      sb.from('research_canvas').select('data').eq('project_id', props.projectId).maybeSingle().then(function (r) {
        var d = (r && r.data && r.data.data) || {};
        setNodes(Array.isArray(d.nodes) ? d.nodes : []);
        setEdges(Array.isArray(d.edges) ? d.edges : []);
        if (d.view && typeof d.view.k === 'number') setView(d.view);
        justLoaded.current = true; setLoaded(true);
      }, function () { setLoaded(true); });
    }, [props.projectId]);

    // ---- debounced autosave ----
    useEffect(function () {
      if (!loaded || !canEdit || !sb) return;
      if (justLoaded.current) { justLoaded.current = false; return; }
      if (saveT.current) clearTimeout(saveT.current);
      saveT.current = setTimeout(function () {
        setStatus('Mentés…');
        sb.from('research_canvas').upsert({ project_id: props.projectId, data: { nodes: nodes, edges: edges, view: view }, updated_at: new Date().toISOString(), updated_by: props.authorId }, { onConflict: 'project_id' })
          .then(function (r) { setStatus(r && r.error ? 'Mentés sikertelen' : 'Mentve ✓'); setTimeout(function () { setStatus(''); }, 1400); });
      }, 900);
      return function () { if (saveT.current) clearTimeout(saveT.current); };
    }, [nodes, edges, view, loaded]); // eslint-disable-line

    // ---- coordinate helpers ----
    function toWorld(clientX, clientY) {
      var r = vpRef.current.getBoundingClientRect();
      return { x: (clientX - r.left - view.tx) / view.k, y: (clientY - r.top - view.ty) / view.k };
    }
    function center(n) { return { x: n.x + (n.w || NW) / 2, y: n.y + (n.h || NH) / 2 }; }
    function screen(p) { return { x: p.x * view.k + view.tx, y: p.y * view.k + view.ty }; }

    // ---- mutations ----
    function addNode(type, partial) {
      var r = vpRef.current.getBoundingClientRect();
      var w = toWorld(r.left + r.width / 2, r.top + r.height / 2);
      var n = Object.assign({ id: uid(), type: type, x: Math.round(w.x - NW / 2), y: Math.round(w.y - NH / 2), w: NW, text: '' }, partial || {});
      setNodes(function (ns) { return ns.concat([n]); });
      setSel({ kind: 'node', id: n.id });
      if (type === 'note' && !n.ref) setEditing(n.id);
    }
    function updateNode(id, patch) { setNodes(function (ns) { return ns.map(function (n) { return n.id === id ? Object.assign({}, n, patch) : n; }); }); }
    function delNode(id) { setNodes(function (ns) { return ns.filter(function (n) { return n.id !== id; }); }); setEdges(function (es) { return es.filter(function (e) { return e.from !== id && e.to !== id; }); }); setSel(null); }
    function addEdge(from, to) {
      if (from === to) return;
      setEdges(function (es) { if (es.some(function (e) { return e.from === from && e.to === to; })) return es; return es.concat([{ id: uid(), from: from, to: to, type: 'relates' }]); });
    }
    function cycleEdge(id) { setEdges(function (es) { return es.map(function (e) { if (e.id !== id) return e; var i = (EDGE_TYPES.indexOf(e.type) + 1) % EDGE_TYPES.length; return Object.assign({}, e, { type: EDGE_TYPES[i] }); }); }); }
    function delEdge(id) { setEdges(function (es) { return es.filter(function (e) { return e.id !== id; }); }); setSel(null); }

    // ---- pickers (research-native nodes) ----
    function openIdeas() {
      setMenu('idea');
      sb.from('research_ideas').select('id,question,hypothesis,status').eq('project_id', props.projectId).order('created_at', { ascending: false }).limit(50).then(function (r) { setPickIdeas((r && r.data) || []); });
    }
    function openPubs() {
      setMenu('pub');
      sb.from('publications').select('mtid,title,year,journal').eq('researcher_id', props.authorId).order('year', { ascending: false }).limit(80).then(function (r) { setPickPubs((r && r.data) || []); });
    }

    // ---- pan / zoom / drag (window-level during a gesture) ----
    function onVpDown(e) {
      if (e.button !== 0) return;
      // background → pan; deselect
      setSel(null); setEditing(null); setMenu(null);
      drag.current = { mode: 'pan', sx: e.clientX, sy: e.clientY, tx: view.tx, ty: view.ty };
      window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
    }
    function onNodeDown(e, n) {
      e.stopPropagation();
      setSel({ kind: 'node', id: n.id });
      if (!canEdit || editing === n.id) return;
      drag.current = { mode: 'node', id: n.id, sx: e.clientX, sy: e.clientY, ox: n.x, oy: n.y };
      window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
    }
    function onHandleDown(e, n) {
      e.stopPropagation();
      if (!canEdit) return;
      var c = center(n), s = screen(c);
      drag.current = { mode: 'conn', from: n.id };
      setConn({ from: n.id, x: s.x, y: s.y });
      window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
    }
    function onMove(e) {
      var d = drag.current; if (!d) return;
      if (d.mode === 'pan') setView(function (v) { return { tx: d.tx + (e.clientX - d.sx), ty: d.ty + (e.clientY - d.sy), k: v.k }; });
      else if (d.mode === 'node') { var dx = (e.clientX - d.sx) / view.k, dy = (e.clientY - d.sy) / view.k; updateNode(d.id, { x: Math.round(d.ox + dx), y: Math.round(d.oy + dy) }); }
      else if (d.mode === 'conn') { var r = vpRef.current.getBoundingClientRect(); setConn(function (c) { return c && { from: c.from, x: e.clientX - r.left, y: e.clientY - r.top }; }); }
    }
    function onUp(e) {
      var d = drag.current; drag.current = null;
      window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp);
      if (d && d.mode === 'conn') {
        var tgt = e.target.closest && e.target.closest('[data-node]');
        if (tgt) addEdge(d.from, tgt.getAttribute('data-node'));
        setConn(null);
      }
    }
    function onWheel(e) {
      e.preventDefault();
      var r = vpRef.current.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      setView(function (v) {
        var k = Math.min(2.2, Math.max(0.25, v.k * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
        return { k: k, tx: mx - (mx - v.tx) * (k / v.k), ty: my - (my - v.ty) * (k / v.k) };
      });
    }
    function zoom(f) { setView(function (v) { var k = Math.min(2.2, Math.max(0.25, v.k * f)); return { tx: v.tx, ty: v.ty, k: k }; }); }
    function fit() {
      if (!nodes.length) { setView({ tx: 60, ty: 60, k: 1 }); return; }
      var xs = nodes.map(function (n) { return n.x; }), ys = nodes.map(function (n) { return n.y; });
      var minX = Math.min.apply(null, xs), minY = Math.min.apply(null, ys);
      var maxX = Math.max.apply(null, nodes.map(function (n) { return n.x + (n.w || NW); })), maxY = Math.max.apply(null, nodes.map(function (n) { return n.y + (n.h || NH); }));
      var r = vpRef.current.getBoundingClientRect();
      var k = Math.min(1.4, Math.max(0.3, Math.min((r.width - 80) / (maxX - minX || 1), (r.height - 80) / (maxY - minY || 1))));
      setView({ k: k, tx: 40 - minX * k, ty: 40 - minY * k });
    }

    // ---- keyboard: delete selected ----
    useEffect(function () {
      function onKey(e) {
        if (editing) return;
        if ((e.key === 'Delete' || e.key === 'Backspace') && sel && canEdit) { e.preventDefault(); if (sel.kind === 'node') delNode(sel.id); else delEdge(sel.id); }
      }
      window.addEventListener('keydown', onKey); return function () { window.removeEventListener('keydown', onKey); };
    }, [sel, editing]); // eslint-disable-line

    if (!loaded) return h('div', { className: 'empty' }, 'Vászon betöltése…');

    // ---- edges (screen-space SVG) ----
    var nodeById = {}; nodes.forEach(function (n) { nodeById[n.id] = n; });
    var edgeEls = edges.map(function (e) {
      var a = nodeById[e.from], b = nodeById[e.to]; if (!a || !b) return null;
      var p1 = screen(center(a)), p2 = screen(center(b));
      var mx = (p1.x + p2.x) / 2;
      var d = 'M' + p1.x + ',' + p1.y + ' C' + mx + ',' + p1.y + ' ' + mx + ',' + p2.y + ' ' + p2.x + ',' + p2.y;
      var on = sel && sel.kind === 'edge' && sel.id === e.id;
      return h('g', { key: e.id, style: { cursor: 'pointer' }, onMouseDown: function (ev) { ev.stopPropagation(); setSel({ kind: 'edge', id: e.id }); }, onDoubleClick: function () { if (canEdit) cycleEdge(e.id); } },
        h('path', { d: d, fill: 'none', stroke: 'transparent', strokeWidth: 14 }),
        h('path', { d: d, fill: 'none', stroke: EDGE_COLOR[e.type] || 'var(--faint)', strokeWidth: on ? 3 : 2, strokeDasharray: e.type === 'contradicts' ? '6 4' : null, markerEnd: 'url(#arrow)' }),
        e.type !== 'relates' ? h('text', { x: mx, y: (p1.y + p2.y) / 2 - 4, fill: EDGE_COLOR[e.type], fontSize: 10, fontWeight: 700, textAnchor: 'middle', style: { userSelect: 'none' } }, e.type) : null);
    });
    var connEl = conn ? (function () { var a = nodeById[conn.from]; if (!a) return null; var p1 = screen(center(a)); return h('path', { d: 'M' + p1.x + ',' + p1.y + ' L' + conn.x + ',' + conn.y, fill: 'none', stroke: 'var(--accent)', strokeWidth: 2, strokeDasharray: '5 4' }); })() : null;

    // ---- node boxes (world via transform) ----
    var nodeEls = nodes.map(function (n) {
      var t = TYPE[n.type] || TYPE.note, on = sel && sel.kind === 'node' && sel.id === n.id, isEd = editing === n.id;
      return h('div', {
        key: n.id, 'data-node': n.id,
        style: { position: 'absolute', left: n.x, top: n.y, width: (n.w || NW), minHeight: NH, boxSizing: 'border-box', background: t.bg, border: '1.5px solid ' + (on ? 'var(--accent)' : t.bd), borderRadius: 12, boxShadow: on ? '0 4px 16px rgba(0,0,0,.18)' : '0 2px 8px rgba(0,0,0,.08)', cursor: canEdit ? 'grab' : 'default', userSelect: isEd ? 'text' : 'none' },
        onMouseDown: function (e) { onNodeDown(e, n); }, onDoubleClick: function (e) { e.stopPropagation(); if (canEdit && n.type === 'note') setEditing(n.id); }
      },
        h('div', { style: { fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.4px', color: t.accent, padding: '6px 10px 0' } }, t.label),
        isEd
          ? h('textarea', { autoFocus: true, defaultValue: n.text || '', onBlur: function (e) { updateNode(n.id, { text: e.target.value }); setEditing(null); }, onMouseDown: function (e) { e.stopPropagation(); }, style: { width: '100%', minHeight: 50, border: 0, background: 'transparent', resize: 'none', fontFamily: 'inherit', fontSize: 13, lineHeight: 1.4, padding: '2px 10px 10px', color: 'inherit', outline: 'none', boxSizing: 'border-box' } })
          : h('div', { style: { fontSize: 13, lineHeight: 1.4, padding: '2px 10px 10px', color: 'var(--ink)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, n.text || h('span', { style: { color: 'var(--faint)' } }, n.type === 'note' ? 'dupla katt a szerkesztéshez' : '—')),
        n.meta ? h('div', { style: { fontSize: 11, color: 'var(--muted)', padding: '0 10px 8px' } }, n.meta) : null,
        // connector handle
        canEdit ? h('div', { title: 'Húzd egy másik node-ra', onMouseDown: function (e) { onHandleDown(e, n); }, style: { position: 'absolute', right: -7, top: '50%', marginTop: -7, width: 14, height: 14, borderRadius: '50%', background: 'var(--accent)', border: '2px solid var(--surface)', cursor: 'crosshair' } }) : null,
        // delete
        (on && canEdit) ? h('button', { onClick: function (e) { e.stopPropagation(); delNode(n.id); }, onMouseDown: function (e) { e.stopPropagation(); }, style: { position: 'absolute', top: -10, right: -10, width: 22, height: 22, borderRadius: '50%', border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--danger)', cursor: 'pointer', fontSize: 13, lineHeight: '20px', padding: 0 } }, '×') : null);
    });

    var btn = { border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)', borderRadius: 8, padding: '6px 11px', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
    return h('div', { style: { position: 'relative' } },
      // toolbar
      h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' } },
        canEdit ? h('button', { style: btn, onClick: function () { addNode('note'); } }, '+ Jegyzet') : null,
        canEdit ? h('button', { style: btn, onClick: openIdeas }, '+ Ötlet') : null,
        canEdit ? h('button', { style: btn, onClick: openPubs }, '+ Publikáció') : null,
        h('span', { style: { width: 1, height: 22, background: 'var(--line)', margin: '0 2px' } }),
        h('button', { style: btn, title: 'Kicsinyítés', onClick: function () { zoom(1 / 1.2); } }, '−'),
        h('button', { style: btn, title: 'Nagyítás', onClick: function () { zoom(1.2); } }, '+'),
        h('button', { style: btn, onClick: fit }, 'Illesztés'),
        h('span', { style: { fontSize: 12, color: 'var(--muted)' } }, Math.round(view.k * 100) + '%'),
        h('span', { style: { flex: 1 } }),
        status ? h('span', { style: { fontSize: 12, fontWeight: 600, color: /sikertelen/.test(status) ? 'var(--danger)' : 'var(--ok)' } }, status) : null),
      // picker dropdown
      menu ? h('div', { style: { position: 'absolute', zIndex: 30, top: 44, left: menu === 'idea' ? 92 : 168, width: 320, maxHeight: 280, overflowY: 'auto', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, boxShadow: '0 12px 36px rgba(0,0,0,.22)', padding: 6 } },
        (menu === 'idea' ? pickIdeas : pickPubs).length === 0 ? h('div', { style: { fontSize: 12.5, color: 'var(--muted)', padding: 10 } }, menu === 'idea' ? 'Nincs ötlet ebben a projektben.' : 'Nincs publikáció.') :
          (menu === 'idea' ? pickIdeas : pickPubs).map(function (it) {
            var label = menu === 'idea' ? it.question : (it.title + (it.year ? ' (' + it.year + ')' : ''));
            return h('div', { key: it.id || it.mtid, onClick: function () { addNode(menu === 'idea' ? 'idea' : 'publication', { text: label, ref: menu === 'idea' ? { kind: 'idea', id: it.id } : { kind: 'publication', mtid: it.mtid }, meta: menu === 'idea' ? ('státusz: ' + (it.status || '—')) : (it.journal || null) }); setMenu(null); }, style: { fontSize: 13, padding: '8px 10px', borderRadius: 7, cursor: 'pointer', lineHeight: 1.35 }, onMouseEnter: function (e) { e.currentTarget.style.background = 'var(--surface-2)'; }, onMouseLeave: function (e) { e.currentTarget.style.background = 'transparent'; } }, label);
          })) : null,
      // viewport
      h('div', { ref: vpRef, onMouseDown: onVpDown, onWheel: onWheel, style: { position: 'relative', height: '64vh', minHeight: 420, border: '1px solid var(--line)', borderRadius: 14, overflow: 'hidden', background: 'var(--softer)', backgroundImage: 'radial-gradient(var(--line) 1px, transparent 1px)', backgroundSize: (22 * view.k) + 'px ' + (22 * view.k) + 'px', backgroundPosition: view.tx + 'px ' + view.ty + 'px', cursor: drag.current && drag.current.mode === 'pan' ? 'grabbing' : 'default' } },
        h('svg', { style: { position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' } },
          h('defs', null, h('marker', { id: 'arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, h('path', { d: 'M0,0 L10,5 L0,10 z', fill: 'var(--faint)' }))),
          h('g', { style: { pointerEvents: 'auto' } }, edgeEls), connEl),
        h('div', { style: { position: 'absolute', left: 0, top: 0, transform: 'translate(' + view.tx + 'px,' + view.ty + 'px) scale(' + view.k + ')', transformOrigin: '0 0' } }, nodeEls),
        nodes.length === 0 ? h('div', { style: { position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--faint)', fontSize: 14, pointerEvents: 'none' } }, 'Üres vászon — adj hozzá Jegyzetet / Ötletet / Publikációt, és kösd össze őket.') : null),
      h('div', { style: { fontSize: 11.5, color: 'var(--faint)', marginTop: 6 } }, 'Háttér húzása = mozgatás · görgő = zoom · node széléről húzva = kapcsolat · dupla katt élen = típus · Delete = törlés')
    );
  }

  window.PRCanvas = Canvas;
})();
