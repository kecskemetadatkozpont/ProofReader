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
    source: { label: 'Source', bg: 'var(--ok-bg, #e7f6ee)', bd: 'var(--ok, #15803d)', accent: 'var(--ok, #15803d)' },
    data: { label: 'Data', bg: 'var(--surface-2, #f5f6f9)', bd: 'var(--accent-d, #4338ca)', accent: 'var(--accent-d, #4338ca)' },
    image: { label: 'Image', bg: 'var(--surface, #fff)', bd: 'var(--line)', accent: 'var(--muted)' },
    pdf: { label: 'PDF', bg: 'var(--surface, #fff)', bd: 'var(--danger, #b42318)', accent: 'var(--danger, #b42318)' },
    video: { label: 'Video', bg: 'var(--surface, #fff)', bd: 'var(--accent, #4f46e5)', accent: 'var(--accent, #4f46e5)' },
    markdown: { label: 'Markdown', bg: 'var(--surface, #fff)', bd: 'var(--line)', accent: 'var(--muted)' },
    link: { label: 'Link', bg: 'var(--surface, #fff)', bd: 'var(--accent, #4f46e5)', accent: 'var(--accent, #4f46e5)' }
  };
  var MEDIA = { image: 1, pdf: 1, video: 1, markdown: 1, link: 1 };
  var MEDIA_SIZE = { image: { w: 260, h: 190 }, pdf: { w: 320, h: 400 }, video: { w: 340, h: 210 }, markdown: { w: 320, h: 240 }, link: { w: 280, h: 96 } };
  function ytId(u) { var m = String(u).match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]{11})/); return m ? m[1] : null; }
  function vimeoId(u) { var m = String(u).match(/vimeo\.com\/(\d+)/); return m ? m[1] : null; }
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
    var srcS = useState([]), pickSrcs = srcS[0], setPickSrcs = srcS[1];
    var datS = useState([]), pickDats = datS[0], setPickDats = datS[1];
    var peerS = useState([]), peers = peerS[0], setPeers = peerS[1];     // remote cursors
    var sumS = useState(null), summary = sumS[0], setSummary = sumS[1];  // AI summary { loading?, text?, err? }
    var expS = useState(false), expOpen = expS[0], setExpOpen = expS[1]; // export menu
    var urlS = useState({}), urls = urlS[0], setUrls = urlS[1];          // storage path -> signed URL
    var upS = useState(false), uploading = upS[0], setUploading = upS[1];

    var vpRef = useRef(null), drag = useRef(null), justLoaded = useRef(false), saveT = useRef(null), chanRef = useRef(null), lastBcast = useRef(0), fileRef = useRef(null);

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
        setStatus('Saving…');
        sb.from('research_canvas').upsert({ project_id: props.projectId, data: { nodes: nodes, edges: edges, view: view }, updated_at: new Date().toISOString(), updated_by: props.authorId }, { onConflict: 'project_id' })
          .then(function (r) { setStatus(r && r.error ? 'Save failed' : 'Saved ✓'); setTimeout(function () { setStatus(''); }, 1400); });
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
    function openSources() {
      setMenu('source');
      sb.from('research_sources').select('id,title,year,venue,screening').eq('project_id', props.projectId).order('created_at', { ascending: false }).limit(60).then(function (r) { setPickSrcs((r && r.data) || []); });
    }
    function openData() {
      setMenu('data');
      sb.from('research_datasets').select('id,name,source,status').eq('project_id', props.projectId).order('created_at', { ascending: false }).limit(60).then(function (r) { setPickDats((r && r.data) || []); });
    }

    // ---- media: upload (PDF / image / video / markdown) + links, displayed via signed URLs ----
    function signPath(path) {
      if (!path || urls[path]) return;
      sb.storage.from('research-data').createSignedUrl(path, 86400).then(function (r) { if (r && r.data && r.data.signedUrl) setUrls(function (u) { var n = Object.assign({}, u); n[path] = r.data.signedUrl; return n; }); });
    }
    useEffect(function () { nodes.forEach(function (n) { if (MEDIA[n.type] && n.path && !urls[n.path]) signPath(n.path); }); }, [nodes]); // eslint-disable-line
    function pickFile() { if (fileRef.current) { fileRef.current.value = ''; fileRef.current.click(); } }
    function onPickFile(e) {
      var f = e.target.files && e.target.files[0]; if (!f) return;
      var mime = f.type || '', name = f.name, ext = (name.split('.').pop() || '').toLowerCase();
      var type = mime.indexOf('image') === 0 ? 'image' : (mime === 'application/pdf' || ext === 'pdf') ? 'pdf' : mime.indexOf('video') === 0 ? 'video' : (ext === 'md' || ext === 'markdown' || mime === 'text/markdown') ? 'markdown' : null;
      if (!type) { alert('Unsupported type. You can upload: image, PDF, video, .md.'); return; }
      setUploading(true);
      var path = props.projectId + '/canvas/' + Date.now() + '_' + name.replace(/[^A-Za-z0-9._-]/g, '_');
      sb.storage.from('research-data').upload(path, f).then(function (res) {
        if (res && res.error) { setUploading(false); alert('Upload failed: ' + res.error.message); return; }
        var sz = MEDIA_SIZE[type];
        if (type === 'markdown') { f.text().then(function (txt) { setUploading(false); addNode('markdown', { path: path, name: name, mime: mime, text: String(txt).slice(0, 60000), w: sz.w, h: sz.h }); }); }
        else { setUploading(false); addNode(type, { path: path, name: name, mime: mime, w: sz.w, h: sz.h }); signPath(path); }
      }, function () { setUploading(false); alert('Upload failed.'); });
    }
    function addLink() {
      var url = window.prompt('Link URL (website, YouTube, Vimeo, image…):'); if (!url) return;
      url = url.trim(); if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
      var big = ytId(url) || vimeoId(url);
      addNode('link', { url: url, name: url, w: big ? MEDIA_SIZE.video.w : MEDIA_SIZE.link.w, h: big ? MEDIA_SIZE.video.h : MEDIA_SIZE.link.h });
    }
    function renderMd(t) { try { return (window.DOMPurify && window.marked) ? DOMPurify.sanitize(marked.parse(t || '')) : String(t || '').replace(/[<&>]/g, function (c) { return { '<': '&lt;', '&': '&amp;', '>': '&gt;' }[c]; }).replace(/\n/g, '<br>'); } catch (e) { return ''; } }

    // ---- live cursors (Supabase presence, isolated channel per canvas) ----
    useEffect(function () {
      if (!sb || !BE || !BE.user) return;
      var me = BE.user;
      var ch = sb.channel('rcanvas:' + props.projectId, { config: { presence: { key: me.id } } });
      chanRef.current = ch;
      ch.on('presence', { event: 'sync' }, function () {
        var st = ch.presenceState(), list = [];
        Object.keys(st).forEach(function (k) { if (k !== me.id) (st[k] || []).forEach(function (m) { if (m && m.cursor) list.push({ id: k, name: m.name, color: m.color, cursor: m.cursor }); }); });
        setPeers(list);
      });
      ch.subscribe(function (s) { if (s === 'SUBSCRIBED') ch.track({ name: me.name, color: me.color, cursor: null }); });
      return function () { try { ch.untrack(); sb.removeChannel(ch); } catch (e) { } };
    }, [props.projectId]); // eslint-disable-line
    function broadcastCursor(e) {
      var now = Date.now(); if (now - lastBcast.current < 55 || !chanRef.current || !BE.user) return;
      lastBcast.current = now;
      var w = toWorld(e.clientX, e.clientY);
      try { chanRef.current.track({ name: BE.user.name, color: BE.user.color, cursor: { x: Math.round(w.x), y: Math.round(w.y) } }); } catch (er) { }
    }

    // ---- export (dependency-free SVG → file, and SVG → PNG) ----
    function esc(s) { return String(s == null ? '' : s).replace(/[<&>"]/g, function (c) { return { '<': '&lt;', '&': '&amp;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function buildSVG() {
      if (!nodes.length) return null;
      var pad = 36;
      var minX = Math.min.apply(null, nodes.map(function (n) { return n.x; })) - pad;
      var minY = Math.min.apply(null, nodes.map(function (n) { return n.y; })) - pad;
      var maxX = Math.max.apply(null, nodes.map(function (n) { return n.x + (n.w || NW); })) + pad;
      var maxY = Math.max.apply(null, nodes.map(function (n) { return n.y + NH; })) + pad;
      var W = Math.round(maxX - minX), H = Math.round(maxY - minY), nb = {};
      nodes.forEach(function (n) { nb[n.id] = n; });
      var COL = { note: '#94a3b8', idea: '#b45309', publication: '#4f46e5', source: '#15803d', data: '#4338ca' };
      var eSvg = edges.map(function (e) { var a = nb[e.from], b = nb[e.to]; if (!a || !b) return ''; var c1 = center(a), c2 = center(b); return '<line x1="' + c1.x + '" y1="' + c1.y + '" x2="' + c2.x + '" y2="' + c2.y + '" stroke="#94a3b8" stroke-width="2"' + (e.type === 'contradicts' ? ' stroke-dasharray="6 4"' : '') + '/>'; }).join('');
      var nSvg = nodes.map(function (n) {
        var w = n.w || NW, col = COL[n.type] || '#94a3b8', lines = wrap((n.text || n.name || n.url || '').replace(/\n/g, ' '), Math.floor((w - 22) / 6.6), 4);
        var tspans = lines.map(function (ln, i) { return '<tspan x="' + (n.x + 11) + '" dy="' + (i === 0 ? 0 : 15) + '">' + esc(ln) + '</tspan>'; }).join('');
        return '<g><rect x="' + n.x + '" y="' + n.y + '" width="' + w + '" height="' + NH + '" rx="12" fill="#ffffff" stroke="' + col + '" stroke-width="1.5"/>' +
          '<text x="' + (n.x + 11) + '" y="' + (n.y + 18) + '" font-family="sans-serif" font-size="10" font-weight="700" fill="' + col + '">' + esc((TYPE[n.type] || TYPE.note).label).toUpperCase() + '</text>' +
          '<text x="' + (n.x + 11) + '" y="' + (n.y + 38) + '" font-family="sans-serif" font-size="12" fill="#1e293b">' + tspans + '</text></g>';
      }).join('');
      return '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="' + Math.round(minX) + ' ' + Math.round(minY) + ' ' + W + ' ' + H + '"><rect x="' + Math.round(minX) + '" y="' + Math.round(minY) + '" width="' + W + '" height="' + H + '" fill="#ffffff"/>' + eSvg + nSvg + '</svg>';
    }
    function wrap(s, perLine, maxLines) { var out = [], cur = ''; (s || '').split(/\s+/).forEach(function (wd) { if ((cur + ' ' + wd).trim().length > perLine) { out.push(cur.trim()); cur = wd; } else cur = (cur + ' ' + wd).trim(); }); if (cur) out.push(cur); if (out.length > maxLines) { out = out.slice(0, maxLines); out[maxLines - 1] = out[maxLines - 1].slice(0, perLine - 1) + '…'; } return out; }
    function download(name, blob) { var u = URL.createObjectURL(blob); var a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 4000); }
    function exportSVG() { var svg = buildSVG(); setExpOpen(false); if (!svg) return; download('research-canvas.svg', new Blob([svg], { type: 'image/svg+xml' })); }
    function exportPNG() {
      var svg = buildSVG(); setExpOpen(false); if (!svg) return;
      var img = new Image(); img.onload = function () { var c = document.createElement('canvas'); c.width = img.width * 2; c.height = img.height * 2; var cx = c.getContext('2d'); cx.scale(2, 2); cx.drawImage(img, 0, 0); c.toBlob(function (b) { if (b) download('research-canvas.png', b); }); };
      img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
    }
    function canvasText() {
      var nb = {}; nodes.forEach(function (n) { nb[n.id] = n; });
      var ns = nodes.map(function (n) { return '• [' + (TYPE[n.type] || TYPE.note).label + '] ' + (n.text || n.name || n.url || '').replace(/\n/g, ' '); }).join('\n');
      var es = edges.map(function (e) { var a = nb[e.from], b = nb[e.to]; if (!a || !b) return null; return (a.text || (TYPE[a.type] || {}).label) + ' —[' + e.type + ']→ ' + (b.text || (TYPE[b.type] || {}).label); }).filter(Boolean).join('\n');
      return ns + (es ? '\n\nConnections:\n' + es : '');
    }
    function aiSummary() {
      if (!nodes.length) { setSummary({ err: 'The canvas is empty.' }); return; }
      setSummary({ loading: true });
      sb.functions.invoke('research-ai', { body: { action: 'canvas-summary', project_id: props.projectId, canvas: canvasText() } }).then(function (r) {
        var d = r && r.data; if (d && d.summary) setSummary({ text: d.summary }); else setSummary({ err: (d && d.error) || 'Failed.' });
      }, function () { setSummary({ err: 'Network error.' }); });
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
    function onResizeDown(e, n) { e.stopPropagation(); if (!canEdit) return; setSel({ kind: 'node', id: n.id }); drag.current = { mode: 'resize', id: n.id, media: !!MEDIA[n.type], sx: e.clientX, sy: e.clientY, ow: n.w || NW, oh: n.h || NH }; window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp); }
    function onMove(e) {
      var d = drag.current; if (!d) return;
      if (d.mode === 'pan') setView(function (v) { return { tx: d.tx + (e.clientX - d.sx), ty: d.ty + (e.clientY - d.sy), k: v.k }; });
      else if (d.mode === 'node') { var dx = (e.clientX - d.sx) / view.k, dy = (e.clientY - d.sy) / view.k; updateNode(d.id, { x: Math.round(d.ox + dx), y: Math.round(d.oy + dy) }); }
      else if (d.mode === 'resize') { var rw = Math.round(d.ow + (e.clientX - d.sx) / view.k), rh = Math.round(d.oh + (e.clientY - d.sy) / view.k); updateNode(d.id, d.media ? { w: Math.max(160, rw), h: Math.max(90, rh) } : { w: Math.max(140, rw) }); }
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

    if (!loaded) return h('div', { className: 'empty' }, 'Loading canvas…');

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

    // ---- media preview body ----
    function nodeBody(n) {
      var u = urls[n.path], loading = h('div', { style: { padding: 14, color: 'var(--faint)', fontSize: 12 } }, 'loading…');
      if (n.type === 'image') return u ? h('img', { src: u, draggable: false, style: { width: '100%', height: '100%', objectFit: 'contain', display: 'block' } }) : loading;
      if (n.type === 'pdf') return u ? h('iframe', { src: u + '#toolbar=0&navpanes=0', title: n.name, style: { width: '100%', height: '100%', border: 0, background: '#fff' } }) : loading;
      if (n.type === 'video') return u ? h('video', { src: u, controls: true, style: { width: '100%', height: '100%', background: '#000', display: 'block' } }) : loading;
      if (n.type === 'markdown') return h('div', { className: 'md', style: { padding: '8px 12px', overflow: 'auto', height: '100%', fontSize: 13, lineHeight: 1.5, boxSizing: 'border-box' }, dangerouslySetInnerHTML: { __html: renderMd(n.text) } });
      if (n.type === 'link') {
        var yt = ytId(n.url), vm = vimeoId(n.url);
        if (yt) return h('iframe', { src: 'https://www.youtube.com/embed/' + yt, title: n.name || 'YouTube', allowFullScreen: true, style: { width: '100%', height: '100%', border: 0 } });
        if (vm) return h('iframe', { src: 'https://player.vimeo.com/video/' + vm, title: n.name || 'Vimeo', allowFullScreen: true, style: { width: '100%', height: '100%', border: 0 } });
        var dom = n.url; try { dom = new URL(n.url).hostname.replace(/^www\./, ''); } catch (e) { }
        return h('a', { href: n.url, target: '_blank', rel: 'noopener', onMouseDown: function (e) { e.stopPropagation(); }, style: { display: 'flex', alignItems: 'center', gap: 9, padding: '10px 12px', textDecoration: 'none', color: 'var(--ink)', height: '100%', boxSizing: 'border-box' } },
          h('img', { src: 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(dom) + '&sz=32', width: 20, height: 20, style: { borderRadius: 4, flex: 'none' } }),
          h('div', { style: { minWidth: 0 } }, h('div', { style: { fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, dom), h('div', { style: { fontSize: 11, color: 'var(--accent)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, n.url)));
      }
      return null;
    }

    // ---- node boxes (world via transform) ----
    var nodeEls = nodes.map(function (n) {
      var t = TYPE[n.type] || TYPE.note, on = sel && sel.kind === 'node' && sel.id === n.id, isEd = editing === n.id, media = !!MEDIA[n.type];
      return h('div', {
        key: n.id, 'data-node': n.id,
        onMouseDown: function (e) { if (canEdit && !media && !isEd) onNodeDown(e, n); else { e.stopPropagation(); setSel({ kind: 'node', id: n.id }); } },
        onDoubleClick: function (e) { e.stopPropagation(); if (canEdit && n.type === 'note') setEditing(n.id); },
        style: { position: 'absolute', left: n.x, top: n.y, width: (n.w || NW), height: media ? (n.h || NH) : undefined, minHeight: media ? undefined : NH, display: 'flex', flexDirection: 'column', boxSizing: 'border-box', background: t.bg, border: '1.5px solid ' + (on ? 'var(--accent)' : t.bd), borderRadius: 12, boxShadow: on ? '0 4px 16px rgba(0,0,0,.18)' : '0 2px 8px rgba(0,0,0,.08)', overflow: 'hidden', userSelect: isEd ? 'text' : 'none' }
      },
        // header = drag handle (so iframes/video don't block dragging)
        h('div', { 'data-nodehead': '1', onMouseDown: function (e) { if (canEdit) onNodeDown(e, n); }, style: { fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.4px', color: t.accent, padding: media ? '6px 10px' : '6px 10px 0', cursor: canEdit ? 'grab' : 'default', flex: 'none', display: 'flex', alignItems: 'center', gap: 6, borderBottom: media ? '1px solid var(--line)' : 'none' } },
          t.label, media && n.name ? h('span', { style: { fontWeight: 500, textTransform: 'none', color: 'var(--faint)', fontSize: 10.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, n.name) : null),
        // body
        media ? h('div', { style: { flex: 1, minHeight: 0, position: 'relative' } }, nodeBody(n))
          : isEd ? h('textarea', { autoFocus: true, defaultValue: n.text || '', onBlur: function (e) { updateNode(n.id, { text: e.target.value }); setEditing(null); }, onMouseDown: function (e) { e.stopPropagation(); }, style: { width: '100%', minHeight: 50, border: 0, background: 'transparent', resize: 'none', fontFamily: 'inherit', fontSize: 13, lineHeight: 1.4, padding: '2px 10px 10px', color: 'inherit', outline: 'none', boxSizing: 'border-box' } })
            : h('div', { style: { fontSize: 13, lineHeight: 1.4, padding: '2px 10px 10px', color: 'var(--ink)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, n.text || h('span', { style: { color: 'var(--faint)' } }, n.type === 'note' ? 'double-click to edit' : '—')),
        (!media && n.meta) ? h('div', { style: { fontSize: 11, color: 'var(--muted)', padding: '0 10px 8px' } }, n.meta) : null,
        canEdit ? h('div', { title: 'Drag onto another node', onMouseDown: function (e) { onHandleDown(e, n); }, style: { position: 'absolute', right: -7, top: '50%', marginTop: -7, width: 14, height: 14, borderRadius: '50%', background: 'var(--accent)', border: '2px solid var(--surface)', cursor: 'crosshair', zIndex: 2 } }) : null,
        canEdit ? h('div', { title: 'Resize', onMouseDown: function (e) { onResizeDown(e, n); }, style: { position: 'absolute', right: 0, bottom: 0, width: 16, height: 16, cursor: 'nwse-resize', zIndex: 2, background: 'linear-gradient(135deg, transparent 45%, ' + (on ? 'var(--accent)' : 'var(--muted)') + ' 45%, ' + (on ? 'var(--accent)' : 'var(--muted)') + ' 60%, transparent 60%)' } }) : null,
        (on && canEdit) ? h('button', { onClick: function (e) { e.stopPropagation(); delNode(n.id); }, onMouseDown: function (e) { e.stopPropagation(); }, style: { position: 'absolute', top: -10, right: -10, width: 22, height: 22, borderRadius: '50%', border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--danger)', cursor: 'pointer', fontSize: 13, lineHeight: '20px', padding: 0, zIndex: 3 } }, '×') : null);
    });

    var btn = { border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)', borderRadius: 8, padding: '6px 11px', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
    return h('div', { style: { position: 'relative' } },
      // toolbar
      h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' } },
        canEdit ? h('button', { style: btn, onClick: function () { addNode('note'); } }, '+ Note') : null,
        canEdit ? h('button', { style: btn, onClick: openIdeas }, '+ Idea') : null,
        canEdit ? h('button', { style: btn, onClick: openPubs }, '+ Publication') : null,
        canEdit ? h('button', { style: btn, onClick: openSources }, '+ Source') : null,
        canEdit ? h('button', { style: btn, onClick: openData }, '+ Data') : null,
        canEdit ? h('button', { style: btn, onClick: pickFile, disabled: uploading, title: 'Upload image / PDF / video / .md' }, uploading ? 'Uploading…' : '⬆ Upload') : null,
        canEdit ? h('button', { style: btn, onClick: addLink, title: 'Website / YouTube / Vimeo / image link' }, '+ Link') : null,
        canEdit ? h('input', { ref: fileRef, type: 'file', accept: 'image/*,application/pdf,video/*,.md,.markdown,text/markdown', style: { display: 'none' }, onChange: onPickFile }) : null,
        h('span', { style: { width: 1, height: 22, background: 'var(--line)', margin: '0 2px' } }),
        h('button', { style: btn, title: 'Zoom out', onClick: function () { zoom(1 / 1.2); } }, '−'),
        h('button', { style: btn, title: 'Zoom in', onClick: function () { zoom(1.2); } }, '+'),
        h('button', { style: btn, onClick: fit }, 'Fit'),
        h('span', { style: { fontSize: 12, color: 'var(--muted)' } }, Math.round(view.k * 100) + '%'),
        h('span', { style: { width: 1, height: 22, background: 'var(--line)', margin: '0 2px' } }),
        h('button', { style: btn, onClick: aiSummary }, '✨ AI summary'),
        h('span', { style: { position: 'relative' } },
          h('button', { style: btn, onClick: function () { setExpOpen(!expOpen); } }, 'Export ▾'),
          expOpen ? h('div', { style: { position: 'absolute', zIndex: 30, top: 36, right: 0, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 9, boxShadow: '0 10px 30px rgba(0,0,0,.2)', padding: 5, width: 130 } },
            h('div', { onClick: exportSVG, style: { padding: '7px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 13 } }, 'SVG (.svg)'),
            h('div', { onClick: exportPNG, style: { padding: '7px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 13 } }, 'Image (.png)')) : null),
        h('span', { style: { flex: 1 } }),
        status ? h('span', { style: { fontSize: 12, fontWeight: 600, color: /failed/.test(status) ? 'var(--danger)' : 'var(--ok)' } }, status) : null),
      // picker dropdown
      menu ? (function () {
        var cfg = {
          idea: { list: pickIdeas, type: 'idea', empty: 'No ideas in this project.', left: 92, label: function (it) { return it.question; }, ref: function (it) { return { kind: 'idea', id: it.id }; }, meta: function (it) { return 'status: ' + (it.status || '—'); } },
          pub: { list: pickPubs, type: 'publication', empty: 'No publications.', left: 168, label: function (it) { return it.title + (it.year ? ' (' + it.year + ')' : ''); }, ref: function (it) { return { kind: 'publication', mtid: it.mtid }; }, meta: function (it) { return it.journal || null; } },
          source: { list: pickSrcs, type: 'source', empty: 'No sources (Literature).', left: 250, label: function (it) { return it.title + (it.year ? ' (' + it.year + ')' : ''); }, ref: function (it) { return { kind: 'source', id: it.id }; }, meta: function (it) { return [it.venue, it.screening].filter(Boolean).join(' · ') || null; } },
          data: { list: pickDats, type: 'data', empty: 'No datasets (Data).', left: 320, label: function (it) { return it.name; }, ref: function (it) { return { kind: 'dataset', id: it.id }; }, meta: function (it) { return [it.source, it.status].filter(Boolean).join(' · ') || null; } }
        }[menu];
        return h('div', { style: { position: 'absolute', zIndex: 30, top: 44, left: cfg.left, width: 320, maxHeight: 280, overflowY: 'auto', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, boxShadow: '0 12px 36px rgba(0,0,0,.22)', padding: 6 } },
          !cfg.list.length ? h('div', { style: { fontSize: 12.5, color: 'var(--muted)', padding: 10 } }, cfg.empty) :
            cfg.list.map(function (it) {
              var label = cfg.label(it);
              return h('div', { key: it.id || it.mtid, onClick: function () { addNode(cfg.type, { text: label, ref: cfg.ref(it), meta: cfg.meta(it) }); setMenu(null); }, style: { fontSize: 13, padding: '8px 10px', borderRadius: 7, cursor: 'pointer', lineHeight: 1.35 }, onMouseEnter: function (e) { e.currentTarget.style.background = 'var(--surface-2)'; }, onMouseLeave: function (e) { e.currentTarget.style.background = 'transparent'; } }, label);
            }));
      })() : null,
      // viewport
      h('div', { ref: vpRef, onMouseDown: onVpDown, onWheel: onWheel, onMouseMove: broadcastCursor, style: { position: 'relative', height: '64vh', minHeight: 420, border: '1px solid var(--line)', borderRadius: 14, overflow: 'hidden', background: 'var(--softer)', backgroundImage: 'radial-gradient(var(--line) 1px, transparent 1px)', backgroundSize: (22 * view.k) + 'px ' + (22 * view.k) + 'px', backgroundPosition: view.tx + 'px ' + view.ty + 'px', cursor: drag.current && drag.current.mode === 'pan' ? 'grabbing' : 'default' } },
        h('svg', { style: { position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' } },
          h('defs', null, h('marker', { id: 'arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, h('path', { d: 'M0,0 L10,5 L0,10 z', fill: 'var(--faint)' }))),
          h('g', { style: { pointerEvents: 'auto' } }, edgeEls), connEl),
        h('div', { style: { position: 'absolute', left: 0, top: 0, transform: 'translate(' + view.tx + 'px,' + view.ty + 'px) scale(' + view.k + ')', transformOrigin: '0 0' } }, nodeEls),
        peers.map(function (pr) { var s = screen(pr.cursor); return h('div', { key: pr.id, style: { position: 'absolute', left: s.x, top: s.y, pointerEvents: 'none', zIndex: 45, display: 'flex', alignItems: 'flex-start' } }, h('svg', { width: 18, height: 18, viewBox: '0 0 16 16', style: { filter: 'drop-shadow(0 1px 1px rgba(0,0,0,.3))' } }, h('path', { d: 'M2 2l4.5 11 2-4.5 4.5-2z', fill: pr.color || 'var(--accent)', stroke: '#fff', strokeWidth: 1 })), h('span', { style: { background: pr.color || 'var(--accent)', color: '#fff', fontSize: 10.5, fontWeight: 600, padding: '1px 6px', borderRadius: 7, marginLeft: 2, marginTop: 10, whiteSpace: 'nowrap' } }, pr.name || 'Someone')); }),
        nodes.length === 0 ? h('div', { style: { position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--faint)', fontSize: 14, pointerEvents: 'none' } }, 'Empty canvas — add a Note / Idea / Publication / Source / Data and connect them.') : null),
      h('div', { style: { fontSize: 11.5, color: 'var(--faint)', marginTop: 6 } }, 'Drag background = pan · scroll = zoom · drag from node edge = connection · double-click an edge = type · Delete = remove'),
      summary ? h('div', { onClick: function () { setSummary(null); }, style: { position: 'fixed', inset: 0, background: 'rgba(8,10,16,.5)', zIndex: 2000, display: 'grid', placeItems: 'center', padding: 20 } },
        h('div', { onClick: function (e) { e.stopPropagation(); }, style: { width: 560, maxWidth: '100%', maxHeight: '80vh', overflowY: 'auto', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16, boxShadow: '0 24px 70px rgba(0,0,0,.4)', padding: '22px 24px' } },
          h('div', { style: { display: 'flex', alignItems: 'center', marginBottom: 12 } }, h('b', { style: { fontSize: 16 } }, '✨ Canvas summary'), h('button', { onClick: function () { setSummary(null); }, style: { marginLeft: 'auto', border: 0, background: 'transparent', fontSize: 20, color: 'var(--muted)', cursor: 'pointer' } }, '×')),
          summary.loading ? h('div', { style: { color: 'var(--muted)', fontSize: 14 } }, 'Analyzing…') :
            summary.err ? h('div', { style: { color: 'var(--danger)', fontSize: 14 } }, summary.err) :
              h('div', { style: { fontSize: 14, lineHeight: 1.6 }, dangerouslySetInnerHTML: { __html: (window.DOMPurify && window.marked) ? DOMPurify.sanitize(marked.parse(summary.text || '')) : (summary.text || '').replace(/\n/g, '<br>') } }))) : null
    );
  }

  window.PRCanvas = Canvas;
})();
