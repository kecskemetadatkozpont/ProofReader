/* Publify — Memory / Knowledge-map (tudástérkép).
 * A read surface over the km_* knowledge graph (migration-45), built automatically by the km-distill
 * edge function from completed protocol tasks (deterministic edges + Claude extraction, gte-small
 * embeddings). RLS scopes everything: a user sees their own + supervised projects' knowledge; an admin
 * sees the whole platform. Three tabs: Search (FTS instant + optional semantic via km-search), Map
 * (force-graph), Timeline (km_log). Nodes deep-link back to the task that produced them. */
(function () {
  'use strict';
  var h = React.createElement;
  var useState = React.useState, useEffect = React.useEffect, useRef = React.useRef;
  var BE = window.PR_BACKEND, sb = BE && BE.sb;

  function toast(m, o) { try { window.PRUI && window.PRUI.toast(m, o); } catch (e) { } }
  function esc(s) { return String(s == null ? '' : s); }
  function escHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  // shared with research.jsx / kanban.jsx so a project is the SAME colour everywhere
  var GPAL = ['#4f46e5', '#0e9f6e', '#d9760b', '#db2777', '#0891b2', '#7c3aed', '#ca8a04', '#dc2626'];
  function colorFor(id) { var x = 0; id = String(id || ''); for (var i = 0; i < id.length; i++) x = (x * 31 + id.charCodeAt(i)) >>> 0; return GPAL[x % GPAL.length]; }
  function adminTargetUser() {
    try {
      if (!/[?&]adminView=1/.test(location.search)) return null;
      var u = BE && BE.user; if (!u) return null;
      if (!(u.role === 'admin' || (BE.profiles && BE.profiles[u.id] && BE.profiles[u.id].role === 'admin'))) return null;
      var t = JSON.parse(localStorage.getItem('pr-admin-view') || 'null');
      return t && t.id ? t : null;
    } catch (e) { return null; }
  }

  // node-kind visual language (color + glyph); shared by cards, facets and the graph
  var KIND = {
    result: { c: '#4f46e5', ic: '◆', label: 'Result' },
    finding: { c: '#0e9f6e', ic: '★', label: 'Finding' },
    method: { c: '#d9760b', ic: '⚙', label: 'Method' },
    dataset: { c: '#0891b2', ic: '🗄', label: 'Dataset' },
    metric: { c: '#db2777', ic: '#', label: 'Metric' },
    artifact: { c: '#7c3aed', ic: '📄', label: 'Artifact' },
    tool: { c: '#ca8a04', ic: '🔧', label: 'Tool' },
    hypothesis: { c: '#2563eb', ic: '?', label: 'Hypothesis' },
    paper: { c: '#6d28d9', ic: '📚', label: 'Paper' },
    entity: { c: '#5b6473', ic: '•', label: 'Entity' }
  };
  function km(k) { return KIND[k] || KIND.entity; }
  var REL_LABEL = { uses: 'uses', produces: 'produces', measures: 'measures', supports: 'supports', contradicts: 'contradicts', derived_from: 'derived from', evaluates: 'evaluates', cites: 'cites', related_to: 'related to' };

  // ---------- force-graph map (with optional clustering by project / researcher / university) ----------
  function GraphMap(props) {
    var elRef = useRef(null), fgRef = useRef(null), nodesRef = useRef([]);
    // live refs the once-built force + frame callbacks read (avoid stale closures on re-render)
    var gbRef = useRef(props.groupBy), grpRef = useRef(props.groups || []), anchRef = useRef({}), mapRef = useRef(props.groupMap || {});
    var data = props.data;   // {nodes:[{id,kind,title,group}], links:[{source,target,rel}]}

    function recomputeAnchors() {
      var groups = grpRef.current || [], A = {}, n = groups.length;
      var R = 60 + n * 42;
      groups.forEach(function (g, i) { var a = n <= 1 ? 0 : (i / n) * Math.PI * 2 - Math.PI / 2; A[g.key] = { x: Math.cos(a) * R, y: Math.sin(a) * R }; });
      anchRef.current = A;
    }
    useEffect(function () {
      if (!elRef.current || !window.ForceGraph) return;
      var isDark = document.documentElement.classList.contains('dark');
      var fg = window.ForceGraph()(elRef.current)
        .backgroundColor(isDark ? '#0d1017' : '#fbfcfe')
        .nodeRelSize(5)
        .nodeVal(function (n) { return n.kind === 'result' ? 3 : 1; })
        .nodeColor(function (n) { return km(n.kind).c; })
        .nodeLabel(function (n) { return '<div style="font:12px IBM Plex Sans,sans-serif;padding:2px 4px">' + escHtml(km(n.kind).label) + ' — ' + escHtml(n.title) + '</div>'; })
        .linkColor(function (l) {
          if (l.rel === 'contradicts') return 'rgba(240,85,155,.85)';
          if (gbRef.current !== 'none' && l.source && l.target && l.source.group != null && l.target.group != null && l.source.group !== l.target.group) return 'rgba(168,85,247,.75)';
          return isDark ? 'rgba(150,160,180,.26)' : 'rgba(90,100,120,.22)';
        })
        .linkWidth(function (l) { return (l.rel === 'contradicts' || (gbRef.current !== 'none' && l.source && l.target && l.source.group !== l.target.group)) ? 1.6 : 1; })
        .linkDirectionalArrowLength(3).linkDirectionalArrowRelPos(1)
        .onNodeClick(function (n) { if (props.onPick) props.onPick(n.id); })
        .onRenderFramePre(function (ctx, scale) {
          if (gbRef.current === 'none') return;
          var groups = grpRef.current || [], nn = nodesRef.current || [];
          groups.forEach(function (g) {
            var pts = nn.filter(function (n) { return n.group === g.key && n.x != null; });
            if (!pts.length) return;
            var minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
            pts.forEach(function (p) { minx = Math.min(minx, p.x); miny = Math.min(miny, p.y); maxx = Math.max(maxx, p.x); maxy = Math.max(maxy, p.y); });
            var pad = 14; roundRectG(ctx, minx - pad, miny - pad, (maxx - minx) + pad * 2, (maxy - miny) + pad * 2, 10);
            ctx.fillStyle = hexA(g.color, .09); ctx.fill(); ctx.strokeStyle = hexA(g.color, .38); ctx.lineWidth = 1.2 / scale; ctx.stroke();
            var fs = Math.max(3, 11 / scale); ctx.font = '700 ' + fs + 'px IBM Plex Sans, sans-serif';
            ctx.fillStyle = g.color; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
            ctx.fillText((g.label.length > 26 ? g.label.slice(0, 26) + '…' : g.label) + ' · ' + pts.length, minx - pad + 2, miny - pad - 2);
          });
        })
        .nodeCanvasObjectMode(function () { return 'after'; })
        .nodeCanvasObject(function (n, ctx, scale) {
          if (scale < 2.2) return;   // labels only when zoomed in, to avoid clutter
          var t = n.title || ''; var label = t.length > 26 ? t.slice(0, 26) + '…' : t;
          ctx.font = '3.2px IBM Plex Sans, sans-serif';
          ctx.fillStyle = isDark ? 'rgba(230,235,245,.85)' : 'rgba(30,36,50,.85)';
          ctx.textAlign = 'center'; ctx.textBaseline = 'top';
          ctx.fillText(label, n.x, n.y + 5);
        });
      // gentle attraction of each node toward its group's anchor (only when grouping is on)
      fg.d3Force('group', function (alpha) {
        if (gbRef.current === 'none') return; var A = anchRef.current, nn = nodesRef.current || [];
        for (var i = 0; i < nn.length; i++) { var nd = nn[i], a = A[nd.group]; if (!a) continue; nd.vx += (a.x - nd.x) * 0.10 * alpha; nd.vy += (a.y - nd.y) * 0.10 * alpha; }
      });
      fgRef.current = fg;
      function size() { if (!elRef.current) return; fg.width(elRef.current.clientWidth).height(elRef.current.clientHeight); }
      size(); window.addEventListener('resize', size);
      return function () { window.removeEventListener('resize', size); try { fg._destructor && fg._destructor(); } catch (e) { } };
    }, []);
    // re-feed on any content change (keyed on a stable id signature)
    var sig = data.nodes.map(function (n) { return n.id; }).join(',') + '|' + data.links.map(function (l) { return l.source + '>' + l.target; }).join(',');
    useEffect(function () {
      if (!fgRef.current) return;
      var nn = data.nodes.map(function (n) { return Object.assign({}, n); }); nodesRef.current = nn;
      recomputeAnchors();
      fgRef.current.graphData({ nodes: nn, links: data.links.map(function (l) { return Object.assign({}, l); }) });
    }, [sig]);
    // grouping changed: re-tag each live node's group + recompute anchors + reheat (no re-feed → animates)
    useEffect(function () {
      gbRef.current = props.groupBy; grpRef.current = props.groups || []; mapRef.current = props.groupMap || {};
      (nodesRef.current || []).forEach(function (n) { n.group = mapRef.current[n.id]; });
      recomputeAnchors();
      if (fgRef.current) {
        fgRef.current.d3ReheatSimulation();
        if (props.groupBy !== 'none') setTimeout(function () { try { fgRef.current && fgRef.current.zoomToFit(600, 40); } catch (e) { } }, 750);
      }
    }, [props.groupBy, props.groupSig]);
    useEffect(function () {
      if (fgRef.current && props.focus) { var n = (fgRef.current.graphData().nodes || []).filter(function (x) { return x.id === props.focus; })[0]; if (n && n.x != null) { fgRef.current.centerAt(n.x, n.y, 600); fgRef.current.zoom(4, 600); } }
    }, [props.focus]);
    if (!window.ForceGraph) return h('div', { className: 'empty' }, 'Graph library did not load.');
    return h('div', { ref: elRef, className: 'kg-canvas' });
  }
  function roundRectG(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function hexA(hex, a) { hex = String(hex || '#888').replace('#', ''); if (hex.length === 3) hex = hex.split('').map(function (x) { return x + x; }).join(''); var n = parseInt(hex, 16); return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'; }

  // ---------- node detail ----------
  function Detail(props) {
    var n = props.node; if (!n) return null;
    var meta = km(n.kind);
    var proj = props.projById[n.project_id];
    var owner = proj && props.ownerById && props.ownerById[proj.owner_id];
    var neigh = props.neighbors || [];
    var link = 'Research.html?project=' + encodeURIComponent(n.project_id) + (n.step_id ? '&step=' + encodeURIComponent(n.step_id) : '') + (/[?&]adminView=1/.test(location.search) ? '&adminView=1' : '');
    return h('div', { className: 'kg-detail' },
      h('div', { className: 'kg-d-head' },
        h('span', { className: 'kg-kind', style: { background: meta.c } }, meta.ic + ' ' + meta.label),
        h('button', { className: 'kg-x', 'aria-label': 'Close', onClick: props.onClose }, '×')),
      h('h2', { className: 'kg-d-title' }, n.title),
      (n.props && n.props.value != null) ? h('div', { className: 'kg-d-val' }, 'Value: ', h('b', null, String(n.props.value))) : null,
      n.body ? h('p', { className: 'kg-d-body' }, n.body) : null,
      proj ? h('div', { className: 'kg-d-proj' }, '🗂️ ', proj.title,
        (owner && (owner.name || owner.affiliation)) ? h('span', null, ' · ' + (owner.name ? '👤 ' + owner.name : '') + (owner.affiliation ? '  🏛 ' + owner.affiliation : '')) : null) : null,
      neigh.length ? h('div', { className: 'kg-d-sec' },
        h('div', { className: 'kg-d-lbl' }, 'Connections (' + neigh.length + ')'),
        h('div', { className: 'kg-d-rels' }, neigh.slice(0, 40).map(function (e, i) {
          var other = e.node, m = km(other.kind);
          return h('button', { key: i, className: 'kg-rel', onClick: function () { props.onPick(other.id); } },
            h('span', { className: 'kg-rel-verb' }, (e.dir === 'out' ? '→ ' : '← ') + (REL_LABEL[e.rel] || e.rel)),
            h('span', { className: 'kg-rel-node' }, h('span', { style: { color: m.c } }, m.ic + ' '), other.title));
        }))
      ) : null,
      n.step_id ? h('a', { className: 'kg-open', href: link, target: '_blank', rel: 'noopener' }, '↗ Open the task that produced this') : null
    );
  }

  // ---------- app ----------
  function App() {
    var phS = useState('loading'), phase = phS[0], setPhase = phS[1];
    var meS = useState(null), me = meS[0], setMe = meS[1];
    var ndS = useState([]), nodes = ndS[0], setNodes = ndS[1];
    var egS = useState([]), edges = egS[0], setEdges = egS[1];
    var pjS = useState({}), projById = pjS[0], setProjById = pjS[1];
    var vwS = useState('search'), view = vwS[0], setView = vwS[1];
    var qS = useState(''), q = qS[0], setQ = qS[1];
    var kfS = useState(null), kindF = kfS[0], setKindF = kfS[1];      // null = all
    var pfS = useState(null), projF = pfS[0], setProjF = pfS[1];      // null = all
    var selS = useState(null), sel = selS[0], setSel = selS[1];       // selected node id
    var semS = useState(null), sem = semS[0], setSem = semS[1];       // semantic result ids (ordered) or null
    var busyS = useState(false), busy = busyS[0], setBusy = busyS[1];
    var logS = useState([]), logRows = logS[0], setLogRows = logS[1];
    var gbS = useState('none'), groupBy = gbS[0], setGroupBy = gbS[1];   // Map clustering: none|project|owner|univ
    var owS = useState({}), ownerById = owS[0], setOwnerById = owS[1];   // owner_id → {name, affiliation}

    useEffect(function () { boot(); }, []);
    function boot() {
      if (!BE || !BE.sb) { setPhase('nobackend'); return; }
      if (BE.mode !== 'cloud' || !BE.user) { setPhase('signin'); return; }
      sb.from('profiles').select('role,name').eq('id', BE.user.id).maybeSingle().then(function (r) {
        setMe({ id: BE.user.id, name: (r && r.data && r.data.name) || BE.user.name, role: (r && r.data && r.data.role) || null });
        load();
      }, function () { setMe({ id: BE.user.id, name: BE.user.name }); load(); });
    }
    function load() {
      Promise.all([
        sb.from('research_projects').select('id,owner_id,title'),
        sb.from('km_nodes').select('id,kind,title,body,project_id,protocol_id,step_id,source_kind,props,created_at').order('created_at', { ascending: false }).limit(2500),
        sb.from('km_edges').select('source_id,target_id,rel,evidence').limit(8000),
        sb.from('km_log').select('id,ts,op,node_id,project_id,note').order('ts', { ascending: false }).limit(60)
      ]).then(function (res) {
        var projs = (res[0] && res[0].data) || [];
        var pb = {}; projs.forEach(function (p) { pb[p.id] = p; }); setProjById(pb);
        setNodes((res[1] && res[1].data) || []);
        setEdges((res[2] && res[2].data) || []);
        setLogRows((res[3] && res[3].data) || []);
        setPhase('ready');
        // owners → names (profiles_public, any readable) + affiliations (profiles: admin sees all, else own)
        // for grouping the Map by researcher / university.
        var oids = projs.map(function (p) { return p.owner_id; }).filter(function (x, i, a) { return x && a.indexOf(x) === i; });
        if (oids.length) Promise.all([
          sb.from('profiles_public').select('id,name').in('id', oids),
          sb.from('profiles').select('id,affiliation').in('id', oids)
        ]).then(function (pr) {
          var m = {};
          ((pr[0] && pr[0].data) || []).forEach(function (x) { m[x.id] = Object.assign(m[x.id] || {}, { name: x.name }); });
          ((pr[1] && pr[1].data) || []).forEach(function (x) { m[x.id] = Object.assign(m[x.id] || {}, { affiliation: x.affiliation }); });
          setOwnerById(m);
        }, function () { });
      }, function (e) { setPhase('ready'); });
    }
    function sync() {
      setBusy(true); toast('Distilling completed tasks into the knowledge graph…');
      sb.functions.invoke('km-distill', { body: { limit: 12 } }).then(function (r) {
        setBusy(false);
        var d = r && r.data, err = (d && d.error) || (r && r.error && r.error.message);
        if (err) { toast('Sync failed: ' + err, { kind: 'error' }); return; }
        toast('✓ ' + (d.steps_processed || 0) + ' task(s) → ' + (d.nodes || 0) + ' nodes, ' + (d.edges || 0) + ' edges', { kind: 'ok' });
        load();
      }, function (e) { setBusy(false); toast('Sync failed: ' + e, { kind: 'error' }); });
    }
    function runSemantic() {
      if (!q.trim()) { setSem(null); return; }
      setBusy(true);
      sb.functions.invoke('km-search', { body: { query: q.trim(), kinds: kindF ? [kindF] : null, project_id: projF || null, limit: 40 } }).then(function (r) {
        setBusy(false);
        var d = r && r.data;
        if (!d || d.error) { toast('Semantic search unavailable' + (d && d.error ? ': ' + d.error : ' (deploy km-search)'), { kind: 'error' }); return; }
        setSem(d.results || []);   // full km_nodes rows, already ranked by the RPC
      }, function () { setBusy(false); toast('Semantic search unavailable (deploy km-search)', { kind: 'error' }); });
    }

    // ---- derived ----
    var nodeById = {}; nodes.forEach(function (n) { nodeById[n.id] = n; });
    if (sem) sem.forEach(function (n) { if (!nodeById[n.id]) nodeById[n.id] = n; });   // semantic hits may be outside the capped cache
    var kindCounts = {}; nodes.forEach(function (n) { kindCounts[n.kind] = (kindCounts[n.kind] || 0) + 1; });
    var projCounts = {}; nodes.forEach(function (n) { projCounts[n.project_id] = (projCounts[n.project_id] || 0) + 1; });
    var projList = Object.keys(projCounts).map(function (id) { return projById[id]; }).filter(Boolean);
    function passFacet(n) { return (!kindF || n.kind === kindF) && (!projF || n.project_id === projF); }
    var qq = q.trim().toLowerCase();
    var filtered = nodes.filter(function (n) {
      if (!passFacet(n)) return false;
      if (qq && (n.title || '').toLowerCase().indexOf(qq) < 0 && (n.body || '').toLowerCase().indexOf(qq) < 0) return false;
      return true;
    });
    // semantic mode renders the RPC's own ranked rows (facet-filtered) — NOT an intersection with the
    // capped local cache, so a hit outside the first 2500 nodes still shows.
    var listNodes = sem ? sem.filter(passFacet) : filtered;

    // grouping: map each node to a group (project / researcher / university) for the Map's cluster view
    function groupInfo(n) {
      var proj = projById[n.project_id], oid = proj && proj.owner_id, o = oid && ownerById[oid];
      if (groupBy === 'project') return { key: n.project_id || '?', label: (proj && proj.title) || 'Untitled project', color: colorFor(n.project_id) };
      if (groupBy === 'owner') return { key: oid || '?', label: (o && o.name) || 'Researcher', color: colorFor(oid) };
      if (groupBy === 'univ') { var aff = (o && o.affiliation) || 'No affiliation'; return { key: aff, label: aff, color: colorFor(aff) }; }
      return null;
    }
    var groupMap = {}, gcount = {}, glabel = {}, gcolorm = {};
    if (groupBy !== 'none') listNodes.forEach(function (n) { var gi = groupInfo(n); if (!gi) return; groupMap[n.id] = gi.key; gcount[gi.key] = (gcount[gi.key] || 0) + 1; glabel[gi.key] = gi.label; gcolorm[gi.key] = gi.color; });
    var groups = Object.keys(gcount).sort(function (a, b) { return gcount[b] - gcount[a]; }).map(function (k) { return { key: k, label: glabel[k], color: gcolorm[k], count: gcount[k] }; });
    var groupSig = groupBy + '|' + groups.map(function (g) { return g.key; }).join(',');

    // graph data (facet-filtered; links only between shown nodes)
    // the Map shows the same set the list does — so a semantic search reflects in the graph, not just the list
    var shownIds = {}; listNodes.forEach(function (n) { shownIds[n.id] = 1; });
    var gLinks = edges.filter(function (e) { return shownIds[e.source_id] && shownIds[e.target_id]; }).map(function (e) { return { source: e.source_id, target: e.target_id, rel: e.rel }; });
    var gData = { nodes: listNodes.map(function (n) { return { id: n.id, kind: n.kind, title: n.title, group: groupMap[n.id] != null ? groupMap[n.id] : null }; }), links: gLinks };

    // neighbors of the selected node
    var selNode = sel ? nodeById[sel] : null;
    var neighbors = [];
    if (selNode) {
      edges.forEach(function (e) {
        if (e.source_id === sel && nodeById[e.target_id]) neighbors.push({ rel: e.rel, dir: 'out', node: nodeById[e.target_id] });
        else if (e.target_id === sel && nodeById[e.source_id]) neighbors.push({ rel: e.rel, dir: 'in', node: nodeById[e.source_id] });
      });
    }

    var isAdmin = me && me.role === 'admin';

    if (phase === 'loading') return h('div', { className: 'center' }, h('div', { className: 'box' }, h('div', { className: 'mk' }, h('span')), h('h1', null, 'Memory'), h('p', null, 'Loading…')));
    if (phase === 'nobackend') return h('div', { className: 'center' }, h('div', { className: 'box' }, h('div', { className: 'mk' }, h('span')), h('h1', null, 'Memory'), h('p', null, 'The cloud backend is unavailable.')));
    if (phase === 'signin') return h('div', { className: 'center' }, h('div', { className: 'box' }, h('div', { className: 'mk' }, h('span')), h('h1', null, 'Sign in'), h('p', null, 'The knowledge map needs your account.'), h('a', { className: 'btn pri', href: 'Landing.html' }, 'Sign in')));

    var facetBar = h('div', { className: 'kg-facets' },
      h('div', { className: 'kg-chips' },
        h('button', { className: 'kg-chip' + (!kindF ? ' on' : ''), onClick: function () { setKindF(null); } }, 'All types ', h('span', { className: 'kg-c' }, nodes.length)),
        Object.keys(KIND).filter(function (k) { return kindCounts[k]; }).map(function (k) {
          return h('button', { key: k, className: 'kg-chip' + (kindF === k ? ' on' : ''), onClick: function () { setKindF(kindF === k ? null : k); }, style: kindF === k ? { borderColor: km(k).c, color: km(k).c } : null },
            h('span', { style: { color: km(k).c } }, km(k).ic + ' '), km(k).label, ' ', h('span', { className: 'kg-c' }, kindCounts[k]));
        })
      ),
      projList.length > 1 ? h('div', { className: 'kg-chips' },
        h('button', { className: 'kg-chip' + (!projF ? ' on' : ''), onClick: function () { setProjF(null); } }, '🗂️ All projects'),
        projList.map(function (p) { return h('button', { key: p.id, className: 'kg-chip' + (projF === p.id ? ' on' : ''), title: p.title, onClick: function () { setProjF(projF === p.id ? null : p.id); } }, h('span', { className: 'kg-nm' }, p.title), ' ', h('span', { className: 'kg-c' }, projCounts[p.id])); })
      ) : null
    );

    var body;
    if (!nodes.length) {
      body = h('div', { className: 'soon' }, h('b', null, 'The knowledge map is empty. '),
        'It fills automatically as your protocol tasks complete — each finished result is distilled into findings, methods, datasets and metrics (Claude extraction + gte-small embeddings), all scoped to who can see the source project.',
        isAdmin ? h('div', { style: { marginTop: 14 } }, h('button', { className: 'btn pri', disabled: busy, onClick: sync }, busy ? 'Syncing…' : '⟳ Distill completed tasks now')) : null);
    } else if (view === 'map') {
      body = h('div', null,
        h('div', { className: 'kg-groupbar' },
          h('span', { className: 'kg-gb-l' }, 'Cluster by'),
          h('div', { className: 'kg-seg' }, [['none', 'None'], ['project', '🗂️ Project'], ['owner', '👤 Researcher'], ['univ', '🏛 University']].map(function (o) {
            return h('button', { key: o[0], className: groupBy === o[0] ? 'on' : '', onClick: function () { setGroupBy(o[0]); } }, o[1]);
          })),
          (groupBy !== 'none' && groups.length) ? h('div', { className: 'kg-glegend' },
            groups.slice(0, 12).map(function (g) { return h('span', { key: g.key, className: 'kg-gtag', title: g.label }, h('i', { style: { background: g.color } }), h('span', { className: 'kg-nm' }, g.label), h('span', { className: 'kg-c' }, g.count)); }),
            groups.length > 12 ? h('span', { className: 'kg-c' }, '+' + (groups.length - 12)) : null) : null
        ),
        h('div', { className: 'kg-split' },
          h(GraphMap, { data: gData, groupBy: groupBy, groups: groups, groupMap: groupMap, groupSig: groupSig, focus: sel, onPick: function (id) { setSel(id); } }),
          selNode ? h(Detail, { node: selNode, projById: projById, ownerById: ownerById, neighbors: neighbors, onClose: function () { setSel(null); }, onPick: function (id) { setSel(id); } })
            : h('div', { className: 'kg-hint' }, groupBy !== 'none' ? 'Bubbles group by ' + (groupBy === 'univ' ? 'university' : groupBy) + '. Purple edges cross groups (bridges); pink = contradictions. Click a node to inspect.' : 'Click a node to inspect it. Zoom in for labels.')
        )
      );
    } else if (view === 'timeline') {
      body = h('div', { className: 'panel' },
        h('h3', null, '🕑 Recent memory activity'),
        logRows.length ? logRows.map(function (r) {
          var p = projById[r.project_id];
          return h('div', { key: r.id, className: 'kg-log', onClick: r.node_id ? function () { setSel(r.node_id); setView('map'); } : null },
            h('span', { className: 'kg-log-op' }, r.op),
            h('span', { className: 'kg-log-note' }, esc(r.note) || (p ? p.title : '')),
            h('span', { className: 'kg-log-ts' }, new Date(r.ts).toISOString().slice(0, 16).replace('T', ' ')));
        }) : h('div', { className: 'empty' }, 'No activity yet.')
      );
    } else {
      body = h('div', { className: 'kg-split' },
        h('div', { className: 'kg-list' },
          h('div', { className: 'kg-list-h' }, listNodes.length + ' node' + (listNodes.length === 1 ? '' : 's') + (sem ? ' · semantic' : '')),
          listNodes.slice(0, 300).map(function (n) {
            var m = km(n.kind), p = projById[n.project_id];
            return h('div', { key: n.id, className: 'kg-card' + (sel === n.id ? ' on' : ''), onClick: function () { setSel(n.id); } },
              h('div', { className: 'kg-card-h' }, h('span', { className: 'kg-kdot', style: { background: m.c } }), h('span', { className: 'kg-kname' }, m.label),
                (n.props && n.props.value != null) ? h('span', { className: 'kg-mval' }, String(n.props.value)) : null),
              h('div', { className: 'kg-card-t' }, n.title),
              n.body ? h('div', { className: 'kg-card-b' }, n.body.length > 130 ? n.body.slice(0, 130) + '…' : n.body) : null,
              p ? h('div', { className: 'kg-card-p' }, '🗂️ ' + p.title) : null);
          }),
          listNodes.length > 300 ? h('div', { className: 'empty', style: { fontSize: 12 } }, '+' + (listNodes.length - 300) + ' more — narrow with facets or search') : null
        ),
        selNode ? h(Detail, { node: selNode, projById: projById, neighbors: neighbors, onClose: function () { setSel(null); }, onPick: function (id) { setSel(id); } }) : h('div', { className: 'kg-hint' }, 'Select a node to see its connections and jump to the task that produced it.')
      );
    }

    return h('div', { className: 'kg-wrap' },
      h('div', { className: 'kg-top' },
        h('div', null, h('h1', null, '🧠 Memory'), h('div', { className: 'kg-sub' }, isAdmin ? 'Knowledge map across every project on the platform' : 'Knowledge map across your research')),
        h('div', { className: 'kg-tools' },
          h('div', { className: 'kg-tabs' }, [['search', '🔎 Search'], ['map', '🕸 Map'], ['timeline', '🕑 Timeline']].map(function (t) {
            return h('button', { key: t[0], className: 'kg-tab' + (view === t[0] ? ' on' : ''), onClick: function () { setView(t[0]); } }, t[1]);
          })),
          isAdmin ? h('button', { className: 'btn', disabled: busy, title: 'Distill newly-completed tasks into the graph', onClick: sync }, busy ? '⟳…' : '⟳ Sync') : null
        )
      ),
      (view !== 'timeline') ? h('div', { className: 'kg-searchbar' },
        h('input', { className: 'kg-q', value: q, placeholder: 'Search findings, methods, datasets, metrics…', onChange: function (e) { setQ(e.target.value); setSem(null); }, onKeyDown: function (e) { if (e.key === 'Enter') runSemantic(); } }),
        h('button', { className: 'btn', disabled: busy || !q.trim(), title: 'Semantic (vector) ranking via gte-small', onClick: runSemantic }, '✨ Semantic'),
        sem ? h('button', { className: 'btn', onClick: function () { setSem(null); } }, 'Clear') : null
      ) : null,
      (view !== 'timeline' && nodes.length) ? facetBar : null,
      body
    );
  }

  ReactDOM.createRoot(document.getElementById('root')).render(h(App));
})();
