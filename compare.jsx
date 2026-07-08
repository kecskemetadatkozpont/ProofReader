/* Publify — Revízió-összehasonlítás. Loads a P1_review_compare FOLDER (change_database.json + the two
 * version sub-folders with their .tex/.bib/figures/class + compiled PDF) and shows how a manuscript was
 * revised in response to peer review, four ways:
 *   • Változások  — word-level v2→v3 diff + the verbatim reviewer comment/reason + a reviewer-concern filter
 *   • PDF         — the two compiled PDFs (PDF.js), with the selected change highlighted on the page
 *   • Szerkesztés — live SwiftLaTeX: edit a version's .tex and recompile to a fresh PDF (window.AloudTeX)
 *   • Hangoskönyv — narrate the revision story (change_summary + reason) with ElevenLabs (window.PREleven)
 * No bundler — React.createElement. The diff/why views work on the JSON alone; the others use the folder. */
(function () {
  var h = React.createElement;
  var useState = React.useState, useRef = React.useRef, useEffect = React.useEffect;
  var sb = (window.PR_BACKEND && window.PR_BACKEND.sb) || window.PR_SB || null;   // Supabase client (for saving)
  var shareToken = (function () { try { return new URLSearchParams(location.search).get('share') || ''; } catch (e) { return ''; } })();   // ?share=<token> → read-only public view
  function shareLinkFor(token) { return location.origin + location.pathname + '?share=' + token; }

  var CAT = {
    reframing: { c: '#4f46e5', t: 'reframing' }, correction: { c: '#dc2626', t: 'correction' },
    'number-update': { c: '#0891b2', t: 'number update' }, 'new-content': { c: '#16a34a', t: 'new content' },
    notation: { c: '#7c3aed', t: 'notation' }, figure: { c: '#b45309', t: 'figure' },
    citation: { c: '#0d9488', t: 'citation' }, editorial: { c: '#6b7280', t: 'editorial' }
  };
  var OP = { replace: { t: 'modified', c: '#b45309' }, insert: { t: 'new', c: '#16a34a' }, delete: { t: 'deleted', c: '#dc2626' } };

  function diffWords(a, b) {
    if (window.Diff && window.Diff.diffWords) return window.Diff.diffWords(a || '', b || '');
    return [{ value: a || '', removed: true }, { value: ' ' }, { value: b || '', added: true }];
  }
  // strip LaTeX so a change's source text can be matched against PDF-extracted text / read aloud
  function stripTex(s) {
    return String(s || '')
      .replace(/\\(cite|ref|eqref|label|citep|citet)\s*\{[^}]*\}/g, ' ')
      .replace(/\\[a-zA-Z]+\*?\s*(\[[^\]]*\])?\s*\{([^}]*)\}/g, ' $2 ')
      .replace(/\\[a-zA-Z]+\*?/g, ' ').replace(/[{}$&~^_\\%]/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }
  function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean); }
  function toSegs(text) {
    text = String(text || '').replace(/\s+/g, ' ').trim(); if (!text) return [];
    var parts = text.match(/[^.!?]+[.!?]*/g) || [text]; var out = []; var cur = '';
    parts.forEach(function (s) { s = s.trim(); if (!s) return; if (cur && (cur + ' ' + s).length > 280) { out.push(cur); cur = s; } else { cur = cur ? cur + ' ' + s : s; } });
    if (cur) out.push(cur); return out;
  }

  // drag a vertical splitter; onMove(xWithinContainer, containerWidth)
  function startDrag(e, containerEl, onMove) {
    e.preventDefault(); if (!containerEl) return;
    function mv(ev) { var r = containerEl.getBoundingClientRect(); onMove(ev.clientX - r.left, r.width); }
    function up() { document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); document.body.style.userSelect = ''; document.body.style.cursor = ''; }
    document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up); document.body.style.userSelect = 'none'; document.body.style.cursor = 'col-resize';
  }
  // drag a floating panel by its header
  function startMove(e, setPos) {
    var card = e.currentTarget && e.currentTarget.closest ? e.currentTarget.closest('.cm-note') : null; if (!card) return;
    e.preventDefault(); var r = card.getBoundingClientRect(); var ox = e.clientX - r.left, oy = e.clientY - r.top;
    function mv(ev) { setPos({ left: Math.max(4, Math.min(window.innerWidth - 80, ev.clientX - ox)), top: Math.max(54, Math.min(window.innerHeight - 60, ev.clientY - oy)) }); }
    function up() { document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); document.body.style.userSelect = ''; }
    document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up); document.body.style.userSelect = 'none';
  }

  // ---- a single PDF: render every page (canvas + text layer) and highlight the selected change ----
  function PdfDoc(props) {   // {bytes, change, side}  side = 'original' | 'final'
    var ref = useRef(null);
    var rdyS = useState(0), ready = rdyS[0], setReady = rdyS[1];
    var locS = useState(1), located = locS[0], setLocated = locS[1];   // 1 = n/a, 2 = found, 0 = not found
    useEffect(function () {
      var cont = ref.current, cancelled = false; if (!cont) return;
      cont.innerHTML = ''; setReady(0);
      if (!props.bytes || !window.pdfjsLib) return;
      var scale = 1.5, dpr = window.devicePixelRatio || 1;
      window.pdfjsLib.getDocument({ data: props.bytes.slice(0) }).promise.then(function (pdf) {
        var chain = Promise.resolve();
        for (var n = 1; n <= pdf.numPages; n++) (function (pn) {
          chain = chain.then(function () {
            if (cancelled) return;
            return pdf.getPage(pn).then(function (page) {
              var cssVp = page.getViewport({ scale: scale }); var vp = page.getViewport({ scale: scale * dpr });
              var pageDiv = document.createElement('div'); pageDiv.className = 'cmp-page'; pageDiv.style.width = Math.floor(cssVp.width) + 'px'; pageDiv.style.height = Math.floor(cssVp.height) + 'px';
              var canvas = document.createElement('canvas'); canvas.width = vp.width; canvas.height = vp.height; canvas.style.width = Math.floor(cssVp.width) + 'px'; canvas.style.height = Math.floor(cssVp.height) + 'px'; pageDiv.appendChild(canvas);
              var tl = document.createElement('div'); tl.className = 'cmp-tl'; tl.style.width = Math.floor(cssVp.width) + 'px'; tl.style.height = Math.floor(cssVp.height) + 'px';
              tl.style.setProperty('--scale-factor', scale); tl.style.setProperty('--total-scale-factor', scale);   // pdf.js 3.11 text layer needs this or spans collapse/mis-size → highlights invisible
              pageDiv.appendChild(tl); cont.appendChild(pageDiv);
              return page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise.then(function () {
                return page.getTextContent().then(function (tc) { return window.pdfjsLib.renderTextLayer({ textContent: tc, container: tl, viewport: cssVp, textDivs: [] }).promise; });
              }).catch(function () { });   // one bad page must not abort the whole document
            }).catch(function () { });
          });
        })(n);
        chain.then(function () { if (!cancelled) setReady(function (x) { return x + 1; }); });
      }).catch(function () { if (!cancelled) setReady(function (x) { return x + 1; }); });
      return function () { cancelled = true; };
    }, [props.bytes]);

    useEffect(function () {
      var cont = ref.current; if (!cont || !ready) return;
      Array.prototype.forEach.call(cont.querySelectorAll('.cmp-hl, .cmp-hl-first'), function (s) { s.classList.remove('cmp-hl', 'cmp-hl-first'); });
      var ch = props.change; if (!ch) { setLocated(1); return; }
      var side = ch[props.side]; if (!side || !side.text) { setLocated(1); return; }   // nothing to find on this side (e.g. insert on v2) — no banner
      var words = norm(stripTex(side.text)); if (words.length < 3) { setLocated(1); return; }
      var spans = Array.prototype.slice.call(cont.querySelectorAll('.cmp-tl > span'));
      var toks = []; spans.forEach(function (sp, si) { norm(sp.textContent).forEach(function (w) { toks.push({ w: w, si: si }); }); });
      var T = toks.map(function (t) { return t.w; }); var found = null;
      for (var L = Math.min(6, words.length); L >= 3 && !found; L--) {
        for (var s = 0; s + L <= words.length && !found; s++) {
          for (var p = 0; p + L <= T.length; p++) {
            var ok = true; for (var k = 0; k < L; k++) { if (T[p + k] !== words[s + k]) { ok = false; break; } }
            if (ok) { var sp2 = Math.min(words.length - s, T.length - p); found = { start: p, end: Math.min(T.length - 1, p + sp2 - 1) }; break; }
          }
        }
      }
      if (found) {
        setLocated(2);
        for (var i = found.start; i <= found.end; i++) { var el = spans[toks[i].si]; if (el) el.classList.add('cmp-hl'); }
        var first = spans[toks[found.start].si];
        if (first) {
          first.classList.add('cmp-hl-first');
          var cr = cont.getBoundingClientRect(), fr = first.getBoundingClientRect();
          cont.scrollTop += (fr.top - cr.top) - cont.clientHeight * 0.32;
        }
      } else { setLocated(0); }
    }, [props.change, props.side, ready]);

    return h('div', { className: 'cmp-pdfhost' },
      (props.change && located === 0) ? h('div', { className: 'cmp-notfound' }, '⚠ This change could not be located in the PDF text (e.g. a formula, figure, table or citation) — the exact text difference is shown on the „Changes" tab.') : null,
      h('div', { className: 'cmp-pdfdoc', ref: ref }));
  }

  function App() {
    var dbS = useState(null), db = dbS[0], setDb = dbS[1];
    var pkgS = useState(null), pkg = pkgS[0], setPkg = pkgS[1];          // {v2:{label,main,files[],pdfFile}, v3:{...}}
    var pdfS = useState({}), pdfs = pdfS[0], setPdfs = pdfS[1];          // {v2:Uint8Array, v3:Uint8Array}
    var selS = useState(null), selId = selS[0], setSelId = selS[1];
    var fpS = useState(''), filterP = fpS[0], setFilterP = fpS[1];
    var viewS = useState('workspace'), view = viewS[0], setView = viewS[1];
    var loadS = useState(false), loading = loadS[0], setLoading = loadS[1];
    var errS = useState(''), err = errS[0], setErr = errS[1];
    var folderRef = useRef(null);
    // edit (SwiftLaTeX)
    var evS = useState('v3'), editVer = evS[0], setEditVer = evS[1];
    var txS = useState(''), texSrc = txS[0], setTexSrc = txS[1];
    var cbS = useState(null), compiledBytes = cbS[0], setCompiledBytes = cbS[1];
    var clS = useState(''), compileLog = clS[0], setCompileLog = clS[1];
    var cgS = useState(false), compiling = cgS[0], setCompiling = cgS[1];
    // audio (ElevenLabs)
    var voS = useState('21m00Tcm4TlvDq8ikWAM'), voice = voS[0], setVoice = voS[1];
    var moS = useState('eleven_multilingual_v2'), model = moS[0], setModel = moS[1];
    var abS = useState(false), aBusy = abS[0], setABusy = abS[1];
    var apS = useState(''), aProg = apS[0], setAProg = apS[1];
    var auS = useState(''), audioUrl = auS[0], setAudioUrl = auS[1];
    var aeS = useState(''), aErr = aeS[0], setAErr = aeS[1];
    var nkS = useState(false), needKey = nkS[0], setNeedKey = nkS[1];
    var keyS = useState(''), keyVal = keyS[0], setKeyVal = keyS[1];
    // persistence (saved comparison packages)
    var meS = useState(null), me = meS[0], setMe = meS[1];
    var prjS = useState([]), projects = prjS[0], setProjects = prjS[1];
    var plS = useState(false), projLoading = plS[0], setProjLoading = plS[1];   // true until the first loadProjects resolves (skeleton)
    var rawS = useState(null), rawFiles = rawS[0], setRawFiles = rawS[1];       // {relPath: File|Blob} of the loaded package
    var svS = useState(''), saving = svS[0], setSaving = svS[1];                 // '' | progress text
    var sidS = useState(null), savedId = sidS[0], setSavedId = sidS[1];          // id of the currently-loaded saved project
    // resizable panes
    var swS = useState(330), sideW = swS[0], setSideW = swS[1];
    var pfS = useState(0.5), pdfFrac = pfS[0], setPdfFrac = pfS[1];
    var efS = useState(0.5), editFrac = efS[0], setEditFrac = efS[1];
    var rwS = useState(310), revW = rwS[0], setRevW = rwS[1];
    var cwS = useState(330), chgW = cwS[0], setChgW = cwS[1];
    var bodyRef = useRef(null), pdfWrapRef = useRef(null), editRef = useRef(null), wsRef = useRef(null);
    // reviewers' raw text (free reference, persisted with the saved project)
    var rtS = useState(''), reviewerText = rtS[0], setReviewerText = rtS[1];
    var rvsS = useState(''), revSaving = rvsS[0], setRevSaving = rvsS[1];
    var rspS = useState(''), responseText = rspS[0], setResponseText = rspS[1];   // auto-drafted Response-to-Reviewers letter
    var npS = useState(false), notePanel = npS[0], setNotePanel = npS[1];        // floating reviewer-note overlay
    var posS = useState(null), notePos = posS[0], setNotePos = posS[1];          // {top,left} once dragged
    // public sharing
    var sharedMode = !!shareToken, ro = sharedMode;                              // read-only public view
    var shoS = useState(false), shareOpen = shoS[0], setShareOpen = shoS[1];
    var shbS = useState(false), shareBusy = shbS[0], setShareBusy = shbS[1];
    var shcS = useState(false), shareCopied = shcS[0], setShareCopied = shcS[1];

    useEffect(function () {
      if (!sb || sharedMode) return;
      sb.auth.getUser().then(function (r) { var u = r && r.data && r.data.user; if (u) { setMe(u); loadProjects(u.id); } });
    }, []);
    useEffect(function () { if (sharedMode && sb && window.JSZip) loadShared(shareToken); }, []);
    // Esc closes the share modal / floating reviewer note (additive keyboard affordance)
    useEffect(function () {
      function onKey(e) { if (e.key !== 'Escape') return; if (shareOpen) setShareOpen(false); else if (notePanel) setNotePanel(false); }
      document.addEventListener('keydown', onKey); return function () { document.removeEventListener('keydown', onKey); };
    }, [shareOpen, notePanel]);
    function loadShared(token) {
      setLoading(true); setErr('');
      sb.rpc('compare_shared', { p_token: token }).then(function (r) {
        var row = r && r.data && r.data[0];
        if ((r && r.error) || !row) { setErr('The shared comparison is not available — the share may have been revoked.'); setLoading(false); return; }
        setReviewerText(row.reviewer_text || '');
        if (!row.zip_public_url) { setErr('The shared package is not available.'); setLoading(false); return; }
        fetch(row.zip_public_url).then(function (resp) { return resp.blob(); }).then(function (blob) {
          return window.JSZip.loadAsync(blob).then(function (zip) {
            var byPath = {}; var names = Object.keys(zip.files).filter(function (n) { return !zip.files[n].dir; });
            return Promise.all(names.map(function (n) { return zip.files[n].async('blob').then(function (b) { byPath[n] = b; }); })).then(function () { loadPackage(byPath); });
          });
        }).catch(function (e) { setErr('Loading error: ' + e); setLoading(false); });
      });
    }
    function shareProject(makePublic) {
      if (!sb || !me || !savedId) return;
      var row = projects.filter(function (p) { return p.id === savedId; })[0]; if (!row) return;
      setShareBusy(true);
      if (!makePublic) { sb.from('compare_projects').update({ is_public: false }).eq('id', savedId).then(function () { setShareBusy(false); if (me) loadProjects(me.id); }); return; }
      var token = row.share_token || ((window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID().replace(/-/g, '') : ('t' + Date.now().toString(36) + Math.round(Math.random() * 1e9).toString(36)));
      var zpath = row.zip_path || (me.id + '/' + savedId + '/package.zip');
      sb.storage.from('compare').createSignedUrl(zpath, 31536000).then(function (r) {
        var url = (r && r.data && r.data.signedUrl) || null;
        if (!url) { setShareBusy(false); setErr('The share link could not be created — re-save the project.'); return; }
        sb.from('compare_projects').update({ is_public: true, share_token: token, zip_public_url: url, shared_at: new Date().toISOString() }).eq('id', savedId).then(function () { setShareBusy(false); if (me) loadProjects(me.id); });
      });
    }
    function loadProjects(uid) {
      if (!sb) return;
      setProjLoading(true);
      sb.from('compare_projects').select('id,title,publication,stats,file_count,size_bytes,zip_path,reviewer_text,is_public,share_token,created_at').eq('owner', uid).order('created_at', { ascending: false }).then(function (r) { setProjects((r && r.data) || []); setProjLoading(false); });
    }

    var rp = {}; ((db && db.review_points) || []).forEach(function (r) { rp[r.id] = r; });
    var changes = (db && db.changes) || [];
    var shown = filterP ? changes.filter(function (c) { return (c.review_points || []).indexOf(filterP) >= 0; }) : changes;
    var sel = changes.filter(function (c) { return c.id === selId; })[0] || shown[0];
    var curRow = (projects || []).filter(function (p) { return p.id === savedId; })[0] || {};
    // staged save progress: a save is "active" while the saving text is set but not yet done/error/transient-notice
    var saveActive = !!(saving && saving !== 'Saved ✓' && saving.indexOf('Error') < 0 && saving.indexOf('Sign in') < 0 && saving.indexOf('No package') < 0);
    var savePct = saving.indexOf('Uploading') >= 0 ? 80 : (saving.indexOf('Starting') >= 0 ? 45 : (saving.indexOf('Packaging') >= 0 ? 18 : 5));

    function buildVer(byPath, base, folder) {
      var prefix = base + (folder.path || '') + '/';
      var out = { label: folder.label || folder.path || '', main: folder.manuscript || '', files: [], pdfFile: null };
      Object.keys(byPath).forEach(function (key) {
        if (key.indexOf(prefix) !== 0) return; var inner = key.slice(prefix.length); if (!inner) return;
        out.files.push({ inner: inner, file: byPath[key] });
      });
      if (!out.main) { var t = out.files.filter(function (f) { return /\.tex$/i.test(f.inner) && f.inner.indexOf('/') < 0; })[0]; out.main = t ? t.inner : ''; }
      var want = out.main ? out.main.replace(/\.tex$/i, '.pdf') : ''; var pf = out.files.filter(function (f) { return f.inner === want; })[0] || out.files.filter(function (f) { return /\.pdf$/i.test(f.inner) && f.inner.indexOf('/') < 0; })[0];
      out.pdfFile = pf ? pf.file : null;
      return out;
    }
    // shared loader — byPath = { relPathFromPackageRoot: File|Blob }
    function loadPackage(byPath, opts) {
      opts = opts || {};
      var dbKey = Object.keys(byPath).filter(function (k) { return /(^|\/)change_database\.json$/.test(k); }).sort(function (a, b) { return a.split('/').length - b.split('/').length; })[0];
      if (!dbKey) { setErr('The package does not contain change_database.json.'); setLoading(false); return; }
      byPath[dbKey].text().then(function (t) {
        var d; try { d = JSON.parse(t); } catch (x) { setErr('change_database.json could not be read.'); setLoading(false); return; }
        if (!d || !Array.isArray(d.changes)) { setErr('Invalid change_database.json.'); setLoading(false); return; }
        var base = dbKey.indexOf('/') >= 0 ? dbKey.slice(0, dbKey.lastIndexOf('/') + 1) : '';
        var of = (d.folders && d.folders.original) || { path: '01_original_v2' };
        var ff = (d.folders && d.folders.final) || { path: '02_final_v3' };
        var p = { v2: buildVer(byPath, base, of), v3: buildVer(byPath, base, ff) };
        setRawFiles(byPath); setSavedId(opts.savedId || null);
        setDb(d); setPkg(p); setSelId((d.changes[0] || {}).id || null); setFilterP(''); setCompiledBytes(null); setTexSrc(''); setView('workspace');
        Promise.all(['v2', 'v3'].map(function (kk) { var pf = p[kk].pdfFile; return pf ? pf.arrayBuffer().then(function (ab) { return new Uint8Array(ab); }) : Promise.resolve(null); }))
          .then(function (arr) { setPdfs({ v2: arr[0], v3: arr[1] }); setLoading(false); });
      });
    }
    function onFolder(e) {
      var files = Array.prototype.slice.call(e.target.files || []); if (!files.length) return;
      setErr(''); setLoading(true);
      var byPath = {};
      files.forEach(function (f) { var pp = f.webkitRelativePath || f.name; var parts = pp.split('/'); if (parts.length > 1) parts.shift(); byPath[parts.join('/')] = f; });
      setReviewerText('');
      loadPackage(byPath);
    }
    function saveProject() {
      if (!sb || !me) { setSaving('Sign in to save.'); setTimeout(function () { setSaving(''); }, 3000); return; }
      if (!rawFiles || !db || !window.JSZip) { setSaving('No package loaded.'); return; }
      setSaving('Packaging…');
      var zip = new window.JSZip();
      Object.keys(rawFiles).forEach(function (k) { zip.file(k, rawFiles[k]); });
      var meta = { title: (db.publication && db.publication.title) || 'Comparison', publication: db.publication || null, stats: db.stats || { changes: (db.changes || []).length }, file_count: Object.keys(rawFiles).length, reviewer_text: reviewerText || null };
      zip.generateAsync({ type: 'blob', compression: 'STORE' }).then(function (blob) {
        meta.size_bytes = blob.size; setSaving('Starting save…');
        return sb.from('compare_projects').insert(Object.assign({ owner: me.id }, meta)).select('id').single().then(function (r) {
          if (r.error || !r.data) throw new Error((r.error && r.error.message) || 'insert');
          var id = r.data.id, path = me.id + '/' + id + '/package.zip';
          setSaving('Uploading… (' + Math.round(blob.size / 1048576) + ' MB)');
          return sb.storage.from('compare').upload(path, blob, { contentType: 'application/zip', upsert: true }).then(function (up) {
            if (up.error) { sb.from('compare_projects').delete().eq('id', id); throw new Error(up.error.message || 'upload'); }
            return sb.from('compare_projects').update({ zip_path: path }).eq('id', id).then(function () { setSavedId(id); setSaving('Saved ✓'); loadProjects(me.id); setTimeout(function () { setSaving(''); }, 2500); });
          });
        });
      }).catch(function (e) { setSaving('Error while saving: ' + (e && e.message || e)); });
    }
    function loadProject(row) {
      if (!sb || !window.JSZip) return; setErr(''); setLoading(true); setReviewerText(row.reviewer_text || '');
      var path = row.zip_path || (me && (me.id + '/' + row.id + '/package.zip'));
      sb.storage.from('compare').download(path).then(function (r) {
        if (r.error || !r.data) { setErr('The saved package could not be downloaded.'); setLoading(false); return; }
        return window.JSZip.loadAsync(r.data).then(function (zip) {
          var byPath = {}; var names = Object.keys(zip.files).filter(function (n) { return !zip.files[n].dir; });
          return Promise.all(names.map(function (n) { return zip.files[n].async('blob').then(function (b) { byPath[n] = b; }); })).then(function () { loadPackage(byPath, { savedId: row.id }); });
        });
      }).catch(function (e) { setErr('Loading error: ' + e); setLoading(false); });
    }
    function deleteProject(row, ev) {
      if (ev) ev.stopPropagation();
      if (!sb) return;
      window.PRUI.confirm({ title: 'Delete the saved comparison?', body: row.title || '', danger: true, confirmLabel: 'Delete' }).then(function (ok) {
        if (!ok) return;
        var path = row.zip_path || (me && (me.id + '/' + row.id + '/package.zip'));
        if (path) sb.storage.from('compare').remove([path]).then(function () { });
        sb.from('compare_projects').delete().eq('id', row.id).then(function () { if (savedId === row.id) setSavedId(null); if (me) loadProjects(me.id); });
      });
    }
    function saveReviewerText() {
      if (!sb || !me) { setRevSaving('Sign in to save.'); setTimeout(function () { setRevSaving(''); }, 3000); return; }
      if (!savedId) { setRevSaving('Save the project first (💾 Save in the header), then the reviewer text can also be saved separately.'); setTimeout(function () { setRevSaving(''); }, 4500); return; }
      setRevSaving('saving…');
      sb.from('compare_projects').update({ reviewer_text: reviewerText || null }).eq('id', savedId).then(function (r) { setRevSaving((r && r.error) ? 'Error' : 'Saved ✓'); setTimeout(function () { setRevSaving(''); }, 2500); });
    }
    function reviewersPanel() {
      return h('div', { className: 'cm-rev' },
        h('div', { className: 'cm-rev-bar' },
          h('h3', { style: { margin: 0 } }, '📝 Reviewers\' text'),
          h('span', { className: 'cm-sub', style: { flex: 1 } }, 'Paste the reviewers\' original (native) text here — it is preserved together with the saved project.'),
          (!ro && sb) ? h('button', { className: 'btn pri', onClick: saveReviewerText, disabled: revSaving === 'saving…' }, '💾 Save') : null,
          revSaving ? h('span', { style: { fontSize: 12.5, color: revSaving.indexOf('Error') >= 0 ? 'var(--danger)' : 'var(--muted)' } }, revSaving) : null),
        h('textarea', { className: 'cm-revtext', value: reviewerText, spellCheck: false, readOnly: ro, placeholder: 'Reviewer 1\n1. ...\n2. ...\n\nReviewer 2\n1. ...', onChange: function (e) { setReviewerText(e.target.value); } }));
    }
    // auto-draft a "Response to Reviewers" letter from the change_database (each comment → the changes that address it)
    function buildResponse() {
      var rps = db.review_points || []; var byId = {}; changes.forEach(function (c) { byId[c.id] = c; });
      var ix = db.index_by_review_point || {}; var byRev = {}; var order = [];
      rps.forEach(function (r) { if (!byRev[r.reviewer]) { byRev[r.reviewer] = []; order.push(r.reviewer); } byRev[r.reviewer].push(r); });
      var L = ['# Response to Reviewers'];
      if (db.publication && db.publication.title) L.push('', '**Manuscript:** ' + db.publication.title);
      L.push('', 'We thank the reviewers for their careful reading and constructive comments. We address each point below: the reviewer\'s comment is quoted, followed by our response and the corresponding revisions.');
      order.forEach(function (rev) {
        L.push('', '', '## ' + rev);
        byRev[rev].forEach(function (rp0) {
          if (rp0.id === 'editorial' || /^re-audit/.test(rp0.id)) return;   // not a reviewer comment — skip in the letter
          L.push('', '**' + rp0.id + '.** ' + String(rp0.comment || '').replace(/\s+/g, ' ').trim());
          var cs = (ix[rp0.id] || []).map(function (id) { return byId[id]; }).filter(Boolean);
          if (cs.length) {
            var acts = cs.map(function (c) { return String(c.change_summary || '').replace(/\s+/g, ' ').replace(/\.\s*$/, '').trim(); }).filter(Boolean);
            L.push('', '*Response:* We thank the reviewer for this comment. In response, ' + acts.join('; ') + '.');
            cs.forEach(function (c) { L.push('  - *' + (c.section || '') + '* — ' + String(c.change_summary || '').trim() + (c.reason ? ' (' + String(c.reason).replace(/\s+/g, ' ').trim() + ')' : '')); });
          } else {
            L.push('', '*Response:* [Please add your response — no specific change is linked to this point yet.]');
          }
        });
      });
      L.push('', '', '---', 'We believe these revisions address the reviewers\' concerns and have strengthened the manuscript.');
      return L.join('\n');
    }
    function responsePanel() {
      var txt = responseText || buildResponse();
      var dl = function () { var blob = new Blob([txt], { type: 'text/markdown' }); var u = URL.createObjectURL(blob); var a = document.createElement('a'); a.href = u; a.download = 'response-to-reviewers.md'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 3000); };
      return h('div', { className: 'cm-rev' },
        h('div', { className: 'cm-rev-bar' },
          h('h3', { style: { margin: 0 } }, '✍️ Response to Reviewers'),
          h('span', { className: 'cm-sub', style: { flex: 1 } }, 'Auto-drafted from the reviewer points and the changes addressing each. Edit freely, then copy or download.'),
          h('button', { className: 'btn', onClick: function () { setResponseText(buildResponse()); } }, '↻ Regenerate'),
          h('button', { className: 'btn', onClick: function () { try { navigator.clipboard.writeText(txt); window.PRUI && window.PRUI.toast('Response copied to clipboard', { kind: 'ok' }); } catch (e) { } } }, 'Copy'),
          h('button', { className: 'btn pri', onClick: dl }, '⬇ Download .md')),
        h('textarea', { className: 'cm-revtext', value: txt, spellCheck: false, onChange: function (e) { setResponseText(e.target.value); } }));
    }
    function savedListBlock() {
      if (!sb) return null;
      if (!me) return h('div', { style: { marginTop: 22, fontSize: 13, color: 'var(--faint)' } }, 'Sign in to save your uploaded comparisons and reload them later with a single click.');
      if (projLoading && !projects.length) return h('div', { className: 'cm-saved' },
        h('div', { className: 'cm-saved-h' }, '💾 Saved comparisons'),
        [0, 1, 2, 3].map(function (i) { return h('div', { key: i, className: 'cm-saved-li', 'aria-hidden': 'true', style: { pointerEvents: 'none' } }, h('div', { className: 'pr-skel pr-skel-row', style: { width: (62 - i * 7) + '%' } })); }));
      if (!projects.length) return null;
      return h('div', { className: 'cm-saved' },
        h('div', { className: 'cm-saved-h' }, '💾 Saved comparisons (' + projects.length + ')'),
        projects.map(function (row) {
          var n = (row.stats && (row.stats.changes || row.stats.n_changes)) || '';
          return h('div', { key: row.id, className: 'cm-saved-li', onClick: function () { loadProject(row); } },
            h('div', { style: { minWidth: 0, textAlign: 'left' } },
              h('div', { className: 'cm-saved-t' }, row.title || 'Comparison'),
              h('div', { className: 'cm-saved-m' }, (n ? n + ' changes · ' : '') + (row.size_bytes ? Math.round(row.size_bytes / 1048576) + ' MB · ' : '') + (row.created_at ? String(row.created_at).slice(0, 10) : ''))),
            h('button', { className: 'cm-saved-del', title: 'Delete', 'aria-label': 'Delete saved comparison', onClick: function (ev) { deleteProject(row, ev); } }, '🗑'));
        }));
    }

    function openEdit() {
      var v = pkg && pkg[editVer]; if (!v || !v.main) { setCompileLog('No .tex for this version.'); return; }
      var mf = v.files.filter(function (f) { return f.inner === v.main; })[0]; if (!mf) { setCompileLog('The main .tex was not found.'); return; }
      mf.file.text().then(function (t) { setTexSrc(t); setCompiledBytes(null); setCompileLog(''); });
    }
    function compile() {
      var v = pkg && pkg[editVer]; if (!v || !window.AloudTeX) { setCompileLog('The LaTeX engine is not available.'); return; }
      setCompiling(true); setCompileLog('Loading files…');
      Promise.all(v.files.map(function (f) {
        var isText = /\.(tex|bib|cls|bst|clo|sty|def|cfg|ltx|txt|bbl|aux)$/i.test(f.inner);
        if (f.inner === v.main) return Promise.resolve({ path: f.inner, text: texSrc });
        return isText ? f.file.text().then(function (t) { return { path: f.inner, text: t }; }) : f.file.arrayBuffer().then(function (ab) { return { path: f.inner, bytes: new Uint8Array(ab) }; });
      })).then(function (filesArr) {
        return window.AloudTeX.compile({ mainFile: v.main, files: filesArr, passes: 3, onProgress: function (m) { setCompileLog(m); } });
      }).then(function (r) {
        setCompiling(false);
        if (r && r.ok && r.pdf) { setCompiledBytes(r.pdf); setCompileLog('Done — ' + (r.pages || '?') + ' pages' + (r.ms ? ', ' + Math.round(r.ms / 1000) + 's' : '')); }
        else { setCompileLog('Compile error (without bibtex, citations may be „?"):\n' + ((r && r.log) || '').slice(-1600)); }
      }).catch(function (e) { setCompiling(false); setCompileLog('Error: ' + e); });
    }

    function narration() {
      var lines = [];
      if (db.publication && db.publication.title) lines.push('Summary of the response to peer review for the manuscript „' + db.publication.title + '".');
      shown.forEach(function (c) {
        var pts = (c.review_points || []).join(', ');
        lines.push((pts ? pts + '. ' : '') + stripTex(c.change_summary || '') + (c.reason ? ' ' + stripTex(c.reason) : ''));
      });
      return lines.join(' ');
    }
    function genAudio() {
      if (!window.PREleven) { setAErr('The audio engine is not available.'); return; }
      if (!window.PREleven.hasKey()) { setNeedKey(true); return; }
      var segs = toSegs(narration()); if (!segs.length) { setAErr('No changes to narrate.'); return; }
      setABusy(true); setAErr(''); setAudioUrl(''); setAProg('0 / ' + segs.length);
      var cfg = { elevenVoice: voice, model: model, stability: 50, similarity: 75 };
      var blobs = []; var i = 0;
      (function next() {
        if (i >= segs.length) { window.PREleven.concatMp3(blobs).then(function (mp3) { setAudioUrl(URL.createObjectURL(mp3)); setABusy(false); setAProg(''); }); return; }
        setAProg((i + 1) + ' / ' + segs.length);
        window.PREleven.getBlob(segs[i], cfg, null, null).then(function (b) { if (b) blobs.push(b); i++; next(); }, function (e) { setAErr('Speech synthesis error: ' + e); setABusy(false); });
      })();
    }
    function saveKey() { if (window.PREleven && keyVal.trim()) { window.PREleven.setKey(keyVal); setNeedKey(false); setKeyVal(''); genAudio(); } }

    // ---------- render ----------
    if (!db) {
      if (sharedMode) return h('div', { className: 'cm-wrap' }, h('div', { className: 'cm-empty' },
        h('h1', null, '🔀 Shared comparison'),
        err ? h('div', { style: { color: 'var(--danger)', marginTop: 10 } }, err) : h('p', null, 'Loading… (downloading the shared package)')));
      return h('div', { className: 'cm-wrap' },
        h('div', { className: 'cm-empty' },
          h('h1', null, '🔀 Revision comparison'),
          h('p', null, 'Load the entire ', h('code', null, 'P1_review_compare'), ' folder — the ', h('code', null, 'change_database.json'), ' + the two version subfolders (the .tex / .bib / figures / class + the compiled PDF). Loading happens locally; if you click Save, the entire package is stored to your account so you don\'t have to upload it again next time.'),
          h('input', { ref: function (el) { folderRef.current = el; if (el) { el.setAttribute('webkitdirectory', ''); el.setAttribute('directory', ''); el.setAttribute('mozdirectory', ''); } }, type: 'file', multiple: true, style: { display: 'none' }, onChange: onFolder }),
          h('div', { style: { marginTop: 14 } }, h('button', { className: 'btn pri', onClick: function () { folderRef.current && folderRef.current.click(); } }, loading ? 'Loading…' : '📁 Choose folder')),
          err ? h('div', { style: { color: 'var(--danger)', marginTop: 10 } }, err) : null,
          savedListBlock()));
    }

    var TABS = [['workspace', '⊞ Overview'], ['changes', 'Changes'], ['pdf', 'PDF + highlight'], ['edit', 'Live editing'], ['reviewers', '📝 Reviewers'], ['response', '✍️ Response'], ['audio', '🎧 Audiobook']];
    var header = h('div', { className: 'cm-head' },
      h('div', { style: { minWidth: 0 } },
        h('h1', null, (db.publication && db.publication.title) || 'Revision comparison'),
        h('div', { className: 'cm-sub' }, (db.publication && db.publication.venue ? db.publication.venue + ' · ' : '') + changes.length + ' changes · ' + ((db.review_points || []).length) + ' reviewer points' + (pkg ? ' · ' + (pdfs.v2 ? 'v2✓' : 'v2✗') + ' ' + (pdfs.v3 ? 'v3✓' : 'v3✗') : ''))),
      h('div', { style: { marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' } },
        ro ? h('span', { className: 'cm-robadge' }, '🔗 Shared view — read-only') : null,
        (!ro && saving) ? h('span', { style: { fontSize: 12.5, color: saving.indexOf('Error') >= 0 ? 'var(--danger)' : 'var(--muted)' } }, saving) : null,
        (!ro && saveActive) ? h('div', { className: 'pr-bar', style: { width: 90, flex: 'none' }, role: 'progressbar', 'aria-label': 'Save progress' }, h('i', { style: { width: savePct + '%' } })) : null,
        (!ro && sb) ? h('button', { className: 'btn' + (savedId ? '' : ' pri'), onClick: saveProject, disabled: !!(saving && saving !== 'Saved ✓' && saving.indexOf('Error') < 0 && saving.indexOf('Sign in') < 0) }, savedId ? '💾 Re-save' : '💾 Save') : null,
        (!ro && sb && savedId) ? h('button', { className: 'btn' + (curRow.is_public ? ' pri' : ''), title: 'Public link for the reviewers', onClick: function () { setShareOpen(true); } }, curRow.is_public ? '🔗 Shared' : '🔗 Share') : null,
        h('button', { className: 'btn' + (notePanel ? ' pri' : ''), title: 'Reviewer note as a floating panel', onClick: function () { var show = !notePanel; if (show && !notePos) setNotePos({ top: 66, left: Math.max(8, window.innerWidth - 404) }); setNotePanel(show); } }, '📝 Note'),
        (!ro) ? h('button', { className: 'btn', onClick: function () { setDb(null); setPkg(null); setPdfs({}); setRawFiles(null); setSavedId(null); setErr(''); } }, '← Folders') : null,
        (!ro) ? h('div', { className: 'seg', role: 'tablist', 'aria-label': 'View' }, TABS.map(function (t) { return h('button', { key: t[0], className: view === t[0] ? 'on' : '', role: 'tab', 'aria-selected': view === t[0] ? 'true' : 'false', 'aria-label': t[1], onClick: function () { setView(t[0]); if (t[0] === 'edit' && !texSrc) openEdit(); } }, t[1]); })) : null));

    function sidebar() {
      return h('div', { className: 'cm-side' },
        h('div', { className: 'cm-filter' },
          h('label', null, 'Reviewer comment'),
          h('select', { className: 'field', value: filterP, onChange: function (e) { setFilterP(e.target.value); } },
            h('option', { value: '' }, 'All changes (' + changes.length + ')'),
            (db.review_points || []).map(function (r) { var n = (db.index_by_review_point && db.index_by_review_point[r.id] || []).length; return h('option', { key: r.id, value: r.id }, r.id + ' (' + n + ') — ' + r.reviewer); }))),
        filterP && rp[filterP] ? h('div', { className: 'cm-rpcomment' }, '„' + rp[filterP].comment + '"') : null,
        h('div', { className: 'cm-list' }, shown.map(changeLi)));
    }
    function changeLi(c) {
      var cat = CAT[c.category] || { c: '#6b7280', t: c.category };
      return h('div', { key: c.id, className: 'cm-li' + (c.id === (sel && sel.id) ? ' on' : ''), role: 'button', tabIndex: 0, 'aria-label': 'Change: ' + (c.change_summary || c.id), onClick: function () { setSelId(c.id); }, onKeyDown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelId(c.id); } } },
        h('div', { style: { display: 'flex', gap: 6, alignItems: 'center', marginBottom: 2 } },
          h('span', { className: 'cm-op', style: { color: (OP[c.op] || {}).c } }, (OP[c.op] || {}).t || c.op),
          h('span', { className: 'cm-cat', style: { background: cat.c } }, cat.t),
          h('span', { className: 'cm-sec' }, c.section)),
        h('div', { className: 'cm-li-sum' }, c.change_summary));
    }
    function selectRp(id) {
      setFilterP(id);
      var ids = id ? ((db.index_by_review_point && db.index_by_review_point[id]) || []) : changes.map(function (c) { return c.id; });
      if (ids.length) setSelId(ids[0]);
    }
    // default 4-pane workspace: reviewer observation → its changes → the change on both PDFs
    function workspaceView() {
      var rps = db.review_points || [];
      return h('div', { className: 'cm-ws', ref: wsRef },
        h('div', { className: 'cm-ws-col', style: { width: revW + 'px', flex: 'none' } },
          h('div', { className: 'cm-ws-h' }, '📝 Reviewer comments (' + rps.length + ')'),
          h('div', { className: 'cm-ws-scroll' },
            h('div', { className: 'cm-rp-item' + (filterP === '' ? ' on' : ''), role: 'button', tabIndex: 0, 'aria-label': 'Show all changes', onClick: function () { selectRp(''); }, onKeyDown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectRp(''); } } }, h('div', { className: 'cm-rp-top' }, h('span', { className: 'cm-rp-id' }, 'All changes'), h('span', { className: 'cm-rp-cnt' }, changes.length))),
            rps.map(function (r) {
              var n = (db.index_by_review_point && db.index_by_review_point[r.id] || []).length;
              return h('div', { key: r.id, className: 'cm-rp-item' + (filterP === r.id ? ' on' : ''), role: 'button', tabIndex: 0, 'aria-label': 'Reviewer comment ' + r.id + ' (' + r.reviewer + ')', onClick: function () { selectRp(r.id); }, onKeyDown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectRp(r.id); } } },
                h('div', { className: 'cm-rp-top' }, h('span', { className: 'cm-rp-id' }, r.id), h('span', { className: 'cm-rp-rev' }, r.reviewer), h('span', { className: 'cm-rp-cnt' }, n)),
                h('div', { className: 'cm-rp-text' }, r.comment));
            }))),
        h('div', { className: 'cm-split', role: 'separator', 'aria-orientation': 'vertical', 'aria-label': 'Resize panels', tabIndex: 0, onPointerDown: function (e) { startDrag(e, wsRef.current, function (x, w) { setRevW(Math.max(190, Math.min(w - 470, x))); }); } }),
        h('div', { className: 'cm-ws-col', style: { width: chgW + 'px', flex: 'none' } },
          h('div', { className: 'cm-ws-h' }, 'Applied changes' + (filterP ? ' · ' + filterP : '') + ' (' + shown.length + ')'),
          h('div', { className: 'cm-ws-scroll' }, shown.length ? shown.map(changeLi) : h('div', { style: { padding: 12, color: 'var(--muted)', fontSize: 13 } }, 'No changes for this comment.')),
          sel ? h('div', { className: 'cm-ws-detail' }, h('div', { className: 'cm-ws-detail-sum' }, sel.change_summary), sel.reason ? h('div', { className: 'cm-ws-detail-reason' }, sel.reason) : null) : null),
        h('div', { className: 'cm-split', role: 'separator', 'aria-orientation': 'vertical', 'aria-label': 'Resize panels', tabIndex: 0, onPointerDown: function (e) { startDrag(e, wsRef.current, function (x, w) { setChgW(Math.max(220, Math.min(w - revW - 340, x - revW - 8))); }); } }),
        h('div', { className: 'cm-ws-pdfs', ref: pdfWrapRef, style: { gridTemplateColumns: pdfFrac + 'fr 8px ' + (1 - pdfFrac) + 'fr' } },
          h('div', { className: 'cm-pdfcol' }, h('div', { className: 'cm-pdf-h' }, 'Original (v2)', sel ? h('span', { className: 'cm-pdf-hint' }, ' — ' + sel.id) : null), pdfs.v2 ? h(PdfDoc, { bytes: pdfs.v2, change: sel, side: 'original' }) : h('div', { className: 'cm-pdf-empty' }, 'no original PDF — load a folder/project')),
          h('div', { className: 'cm-split', role: 'separator', 'aria-orientation': 'vertical', 'aria-label': 'Resize panels', tabIndex: 0, onPointerDown: function (e) { startDrag(e, pdfWrapRef.current, function (x, w) { setPdfFrac(Math.max(0.18, Math.min(0.82, x / w))); }); } }),
          h('div', { className: 'cm-pdfcol' }, h('div', { className: 'cm-pdf-h' }, 'Revised (v3)', sel ? h('span', { className: 'cm-pdf-hint' }, ' — ' + sel.id) : null), pdfs.v3 ? h(PdfDoc, { bytes: pdfs.v3, change: sel, side: 'final' }) : h('div', { className: 'cm-pdf-empty' }, 'no revised PDF'))));
    }
    function changeDetail() {
      if (!sel) return h('div', { className: 'cm-main' }, h('div', { style: { color: 'var(--muted)' } }, 'No changes for this filter.'));
      return h('div', { className: 'cm-main' },
        h('div', { className: 'cm-ch-head' },
          h('span', { className: 'cm-cat', style: { background: (CAT[sel.category] || {}).c } }, (CAT[sel.category] || {}).t || sel.category),
          h('span', { className: 'cm-op', style: { color: (OP[sel.op] || {}).c, fontSize: 13 } }, (OP[sel.op] || {}).t),
          h('span', { style: { fontSize: 13, color: 'var(--muted)' } }, sel.section),
          sel.confidence ? h('span', { className: 'cm-conf', title: 'confidence' }, sel.confidence) : null),
        h('h3', { style: { margin: '4px 0 10px' } }, sel.change_summary),
        h('div', { className: 'cm-diff' },
          sel.op === 'insert' ? h('span', { className: 'd-add' }, (sel.final && sel.final.text) || '')
            : sel.op === 'delete' ? h('span', { className: 'd-del' }, (sel.original && sel.original.text) || '')
              : diffWords((sel.original && sel.original.text) || '', (sel.final && sel.final.text) || '').map(function (p, i) { return h('span', { key: i, className: p.added ? 'd-add' : p.removed ? 'd-del' : '' }, p.value); })),
        h('div', { className: 'cm-why' },
          h('div', { className: 'cm-why-h' }, '💬 Why did it change?'),
          (sel.review_points || []).map(function (id) { var r = rp[id]; return h('div', { key: id, className: 'cm-rp' }, h('b', null, id + (r ? ' · ' + r.reviewer : '')), r ? h('div', { className: 'cm-rp-c' }, '„' + r.comment + '"') : null); }),
          sel.reason ? h('div', { className: 'cm-reason' }, h('b', null, 'Reason: '), sel.reason) : null));
    }
    function pdfPanes() {
      if (!pdfs.v2 && !pdfs.v3) return h('div', { className: 'cm-main' }, h('div', { style: { color: 'var(--muted)' } }, 'The PDFs did not load from the folder. Reload the entire folder (it must also contain the compiled PDF for both versions).'));
      return h('div', { className: 'cm-pdfwrap', ref: pdfWrapRef, style: { gridTemplateColumns: pdfFrac + 'fr 8px ' + (1 - pdfFrac) + 'fr' } },
        h('div', { className: 'cm-pdfcol' }, h('div', { className: 'cm-pdf-h' }, 'v2 — submitted', sel ? h('span', { className: 'cm-pdf-hint' }, ' — ' + sel.id) : null), pdfs.v2 ? h(PdfDoc, { bytes: pdfs.v2, change: sel, side: 'original' }) : h('div', { className: 'cm-pdf-empty' }, 'no v2 PDF')),
        h('div', { className: 'cm-split', onPointerDown: function (e) { startDrag(e, pdfWrapRef.current, function (x, w) { setPdfFrac(Math.max(0.18, Math.min(0.82, x / w))); }); } }),
        h('div', { className: 'cm-pdfcol' }, h('div', { className: 'cm-pdf-h' }, 'v3 — revised', sel ? h('span', { className: 'cm-pdf-hint' }, ' — ' + sel.id) : null), pdfs.v3 ? h(PdfDoc, { bytes: pdfs.v3, change: sel, side: 'final' }) : h('div', { className: 'cm-pdf-empty' }, 'no v3 PDF')));
    }
    function editPanel() {
      return h('div', { className: 'cm-edit', ref: editRef, style: { gridTemplateColumns: editFrac + 'fr 8px ' + (1 - editFrac) + 'fr' } },
        h('div', { className: 'cm-edit-l' },
          h('div', { className: 'cm-edit-bar' },
            h('div', { className: 'seg' }, [['v2', 'v2'], ['v3', 'v3']].map(function (o) { return h('button', { key: o[0], className: editVer === o[0] ? 'on' : '', onClick: function () { setEditVer(o[0]); setTexSrc(''); setCompiledBytes(null); setCompileLog(''); setTimeout(openEdit, 0); } }, o[1]); })),
            h('button', { className: 'btn', onClick: openEdit }, '↻ Original .tex'),
            h('button', { className: 'btn pri', onClick: compile, disabled: compiling || !texSrc }, compiling ? 'Compiling…' : '▶ Compile (PDF)')),
          h('textarea', { className: 'cm-tex', value: texSrc, spellCheck: false, onChange: function (e) { setTexSrc(e.target.value); }, placeholder: 'Choose a version, then „Original .tex" — the manuscript source loads here…' }),
          compileLog ? h('pre', { className: 'cm-log' }, compileLog) : null),
        h('div', { className: 'cm-split', role: 'separator', 'aria-orientation': 'vertical', 'aria-label': 'Resize panels', tabIndex: 0, onPointerDown: function (e) { startDrag(e, editRef.current, function (x, w) { setEditFrac(Math.max(0.2, Math.min(0.8, x / w))); }); } }),
        h('div', { className: 'cm-edit-r' },
          compiledBytes ? h(PdfDoc, { bytes: compiledBytes, change: null, side: 'final' })
            : h('div', { className: 'cm-pdf-empty', style: { height: '100%' } }, 'The compiled PDF appears here. (SwiftLaTeX, in the browser — no bibtex, so citations may be „?"; live text/figure changes, however, are visible.)')));
    }
    function audioPanel() {
      var V = (window.PREleven && window.PREleven.voices) || [{ id: voice, name: voice }];
      var M = (window.PREleven && window.PREleven.models) || [{ id: model, name: model }];
      var nSeg = toSegs(narration()).length;
      return h('div', { className: 'cm-audio' },
        h('h3', { style: { marginTop: 0 } }, '🎧 Revision audiobook'),
        h('p', { className: 'cm-sub' }, 'The story of the ' + (filterP ? 'filtered ' : '') + shown.length + ' changes (summary + reason) read aloud' + (filterP && rp[filterP] ? ' — ' + filterP : '') + '. ~' + nSeg + ' segments.'),
        needKey ? h('div', { className: 'cm-key' },
          h('div', { style: { fontSize: 13, marginBottom: 6 } }, 'Enter your ElevenLabs API key (stored only in this browser):'),
          h('div', { style: { display: 'flex', gap: 8 } },
            h('input', { className: 'field', type: 'password', value: keyVal, placeholder: 'xi-...', onChange: function (e) { setKeyVal(e.target.value); }, style: { flex: 1 } }),
            h('button', { className: 'btn pri', onClick: saveKey }, 'Save + start'))) : null,
        h('div', { className: 'cm-arow' },
          h('label', null, 'Voice'), h('select', { className: 'field', value: voice, onChange: function (e) { setVoice(e.target.value); } }, V.map(function (v) { return h('option', { key: v.id, value: v.id }, v.name); })),
          h('label', null, 'Model'), h('select', { className: 'field', value: model, onChange: function (e) { setModel(e.target.value); } }, M.map(function (m) { return h('option', { key: m.id, value: m.id }, m.name); }))),
        h('div', { style: { marginTop: 12 } },
          h('button', { className: 'btn pri', onClick: genAudio, disabled: aBusy || !nSeg }, aBusy ? 'Generating… ' + aProg : '🎙️ Generate audiobook')),
        aErr ? h('div', { style: { color: 'var(--danger)', marginTop: 8, fontSize: 13 } }, aErr) : null,
        audioUrl ? h('div', { style: { marginTop: 14 } }, h('audio', { src: audioUrl, controls: true, style: { width: '100%' } }), h('div', { style: { marginTop: 6 } }, h('a', { className: 'btn', href: audioUrl, download: 'revizio-hangoskonyv.mp3' }, '⬇ Download (MP3)'))) : null,
        h('details', { style: { marginTop: 14 } }, h('summary', { style: { cursor: 'pointer', fontSize: 13, color: 'var(--muted)' } }, 'Preview of the text to be read'), h('div', { style: { fontSize: 13, lineHeight: 1.55, marginTop: 8, whiteSpace: 'pre-wrap' } }, narration())));
    }

    function withSide(mainEl) {
      return h('div', { className: 'cm-body', ref: bodyRef, style: { gridTemplateColumns: sideW + 'px 8px minmax(0,1fr)' } },
        sidebar(),
        h('div', { className: 'cm-split', role: 'separator', 'aria-orientation': 'vertical', 'aria-label': 'Resize panels', tabIndex: 0, onPointerDown: function (e) { startDrag(e, bodyRef.current, function (x, w) { setSideW(Math.max(220, Math.min(w * 0.7, x))); }); } }),
        mainEl);
    }
    var body;
    var eview = ro ? 'workspace' : view;   // shared/public view is locked to the 4-pane Overview
    if (eview === 'workspace') body = workspaceView();
    else if (eview === 'pdf') body = withSide(pdfPanes());
    else if (eview === 'edit') body = editPanel();
    else if (eview === 'reviewers') body = reviewersPanel();
    else if (eview === 'response') body = responsePanel();
    else if (eview === 'audio') body = audioPanel();
    else body = withSide(changeDetail());

    var notePanelEl = notePanel ? h('div', { className: 'cm-note', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Reviewer note', style: notePos ? { top: notePos.top + 'px', left: notePos.left + 'px', right: 'auto', bottom: 'auto' } : null },
      h('div', { className: 'cm-note-h', onPointerDown: function (e) { startMove(e, setNotePos); } },
        h('span', { className: 'cm-note-title' }, '📝 Reviewer note'),
        (!ro && sb && savedId) ? h('button', { className: 'cm-note-btn', title: 'Save', 'aria-label': 'Save reviewer note', onPointerDown: function (e) { e.stopPropagation(); }, onClick: saveReviewerText }, '💾') : null,
        h('button', { className: 'cm-note-x', title: 'Close', 'aria-label': 'Close reviewer note', onPointerDown: function (e) { e.stopPropagation(); }, onClick: function () { setNotePanel(false); } }, '×')),
      revSaving ? h('div', { className: 'cm-note-status' }, revSaving) : null,
      h('textarea', { className: 'cm-note-t', value: reviewerText, spellCheck: false, readOnly: ro, placeholder: 'Paste / edit the reviewers\' text here — it is preserved together with the saved project…', onChange: function (e) { setReviewerText(e.target.value); } })) : null;

    var shareLink = curRow.share_token ? shareLinkFor(curRow.share_token) : '';
    var shareModalEl = (shareOpen && !ro) ? h('div', { className: 'cm-modal-scrim', onClick: function () { setShareOpen(false); } },
      h('div', { className: 'cm-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Share with the reviewers', onClick: function (e) { e.stopPropagation(); } },
        h('div', { className: 'cm-modal-h' }, h('b', null, '🔗 Share with the reviewers'), h('button', { className: 'cm-note-x', 'aria-label': 'Close share dialog', onClick: function () { setShareOpen(false); } }, '×')),
        h('p', { style: { fontSize: 13, color: 'var(--muted)', margin: '2px 0 12px' } }, 'Public link: anyone you send it to can view this comparison (the two PDFs, the applied changes, the reviewer comments) — without signing in, in read-only mode.'),
        h('label', { className: 'cm-share-toggle' },
          h('input', { type: 'checkbox', checked: !!curRow.is_public, disabled: shareBusy, onChange: function (e) { shareProject(e.target.checked); } }),
          h('span', null, shareBusy ? 'Updating…' : (curRow.is_public ? 'Public link enabled' : 'Enable public link'))),
        (curRow.is_public && shareLink) ? h('div', { style: { marginTop: 12 } },
          h('div', { style: { display: 'flex', gap: 8 } },
            h('input', { className: 'field', readOnly: true, value: shareLink, onFocus: function (e) { e.target.select(); }, style: { flex: 1, fontSize: 12 } }),
            h('button', { className: 'btn pri', onClick: function () { try { navigator.clipboard.writeText(shareLink); setShareCopied(true); setTimeout(function () { setShareCopied(false); }, 1800); } catch (e) { } } }, shareCopied ? 'Copied ✓' : 'Copy')),
          h('div', { style: { fontSize: 11.5, color: 'var(--faint)', marginTop: 8 } }, 'The link is valid for ~1 year. To revoke, turn off the toggle above — after that the link will not open.')) : null)) : null;

    return h('div', { className: 'cm-wrap' }, header, body, notePanelEl, shareModalEl);
  }

  var root = document.getElementById('root');
  if (root && window.React && window.ReactDOM) ReactDOM.createRoot(root).render(h(App));
})();
