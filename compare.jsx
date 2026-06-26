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

  var CAT = {
    reframing: { c: '#4f46e5', t: 'átkeretezés' }, correction: { c: '#dc2626', t: 'javítás' },
    'number-update': { c: '#0891b2', t: 'szám-frissítés' }, 'new-content': { c: '#16a34a', t: 'új tartalom' },
    notation: { c: '#7c3aed', t: 'jelölés' }, figure: { c: '#b45309', t: 'ábra' },
    citation: { c: '#0d9488', t: 'hivatkozás' }, editorial: { c: '#6b7280', t: 'szerkesztői' }
  };
  var OP = { replace: { t: 'módosítva', c: '#b45309' }, insert: { t: 'új', c: '#16a34a' }, delete: { t: 'törölve', c: '#dc2626' } };

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

  // ---- a single PDF: render every page (canvas + text layer) and highlight the selected change ----
  function PdfDoc(props) {   // {bytes, change, side}  side = 'original' | 'final'
    var ref = useRef(null);
    var rdyS = useState(0), ready = rdyS[0], setReady = rdyS[1];
    useEffect(function () {
      var cont = ref.current, cancelled = false; if (!cont) return;
      cont.innerHTML = ''; setReady(0);
      if (!props.bytes || !window.pdfjsLib) { return; }
      window.pdfjsLib.getDocument({ data: props.bytes.slice(0) }).promise.then(function (pdf) {
        var chain = Promise.resolve();
        for (var n = 1; n <= pdf.numPages; n++) (function (pn) {
          chain = chain.then(function () {
            if (cancelled) return; return pdf.getPage(pn).then(function (page) {
              var vp = page.getViewport({ scale: 1.4 });
              var pageDiv = document.createElement('div'); pageDiv.className = 'cmp-page'; pageDiv.style.width = vp.width + 'px'; pageDiv.style.height = vp.height + 'px';
              var canvas = document.createElement('canvas'); canvas.width = vp.width; canvas.height = vp.height; pageDiv.appendChild(canvas);
              var tl = document.createElement('div'); tl.className = 'cmp-tl'; tl.style.width = vp.width + 'px'; tl.style.height = vp.height + 'px'; pageDiv.appendChild(tl);
              cont.appendChild(pageDiv);
              return page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise.then(function () {
                return page.getTextContent().then(function (tc) { return window.pdfjsLib.renderTextLayer({ textContent: tc, container: tl, viewport: vp, textDivs: [] }).promise; });
              });
            });
          });
        })(n);
        chain.then(function () { if (!cancelled) setReady(function (x) { return x + 1; }); });
      }).catch(function () { });
      return function () { cancelled = true; };
    }, [props.bytes]);

    useEffect(function () {
      var cont = ref.current; if (!cont || !ready) return;
      Array.prototype.forEach.call(cont.querySelectorAll('.cmp-hl'), function (s) { s.classList.remove('cmp-hl'); });
      var ch = props.change; if (!ch) return; var side = ch[props.side]; if (!side || !side.text) return;
      var words = norm(stripTex(side.text)); if (words.length < 3) return;
      var spans = Array.prototype.slice.call(cont.querySelectorAll('.cmp-tl > span'));
      var toks = []; spans.forEach(function (sp, si) { norm(sp.textContent).forEach(function (w) { toks.push({ w: w, si: si }); }); });
      var T = toks.map(function (t) { return t.w; }); var L = Math.min(6, words.length); var found = null;
      for (var s = 0; s + L <= words.length && !found; s++) {
        for (var p = 0; p + L <= T.length; p++) {
          var ok = true; for (var k = 0; k < L; k++) { if (T[p + k] !== words[s + k]) { ok = false; break; } }
          if (ok) { var span = Math.min(words.length - s, T.length - p); found = { start: p, end: Math.min(T.length - 1, p + span - 1) }; break; }
        }
      }
      if (found) {
        for (var i = found.start; i <= found.end; i++) { var el = spans[toks[i].si]; if (el) el.classList.add('cmp-hl'); }
        var first = spans[toks[found.start].si]; if (first && first.scrollIntoView) first.scrollIntoView({ block: 'center' });
      }
    }, [props.change, props.side, ready]);

    return h('div', { className: 'cmp-pdfdoc', ref: ref });
  }

  function App() {
    var dbS = useState(null), db = dbS[0], setDb = dbS[1];
    var pkgS = useState(null), pkg = pkgS[0], setPkg = pkgS[1];          // {v2:{label,main,files[],pdfFile}, v3:{...}}
    var pdfS = useState({}), pdfs = pdfS[0], setPdfs = pdfS[1];          // {v2:Uint8Array, v3:Uint8Array}
    var selS = useState(null), selId = selS[0], setSelId = selS[1];
    var fpS = useState(''), filterP = fpS[0], setFilterP = fpS[1];
    var viewS = useState('changes'), view = viewS[0], setView = viewS[1];
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

    var rp = {}; ((db && db.review_points) || []).forEach(function (r) { rp[r.id] = r; });
    var changes = (db && db.changes) || [];
    var shown = filterP ? changes.filter(function (c) { return (c.review_points || []).indexOf(filterP) >= 0; }) : changes;
    var sel = changes.filter(function (c) { return c.id === selId; })[0] || shown[0];

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
    function onFolder(e) {
      var files = Array.prototype.slice.call(e.target.files || []); if (!files.length) return;
      setErr(''); setLoading(true);
      var byPath = {};
      files.forEach(function (f) { var p = f.webkitRelativePath || f.name; var parts = p.split('/'); if (parts.length > 1) parts.shift(); byPath[parts.join('/')] = f; });
      var dbKey = Object.keys(byPath).filter(function (k) { return /(^|\/)change_database\.json$/.test(k); }).sort(function (a, b) { return a.split('/').length - b.split('/').length; })[0];
      if (!dbKey) { setErr('A kiválasztott mappában nincs change_database.json.'); setLoading(false); return; }
      byPath[dbKey].text().then(function (t) {
        var d; try { d = JSON.parse(t); } catch (x) { setErr('A change_database.json nem olvasható.'); setLoading(false); return; }
        if (!d || !Array.isArray(d.changes)) { setErr('Érvénytelen change_database.json.'); setLoading(false); return; }
        var base = dbKey.indexOf('/') >= 0 ? dbKey.slice(0, dbKey.lastIndexOf('/') + 1) : '';
        var of = (d.folders && d.folders.original) || { path: '01_original_v2' };
        var ff = (d.folders && d.folders.final) || { path: '02_final_v3' };
        var p = { v2: buildVer(byPath, base, of), v3: buildVer(byPath, base, ff) };
        setDb(d); setPkg(p); setSelId((d.changes[0] || {}).id || null); setFilterP(''); setCompiledBytes(null); setTexSrc('');
        Promise.all(['v2', 'v3'].map(function (kk) { var pf = p[kk].pdfFile; return pf ? pf.arrayBuffer().then(function (ab) { return new Uint8Array(ab); }) : Promise.resolve(null); }))
          .then(function (arr) { setPdfs({ v2: arr[0], v3: arr[1] }); setLoading(false); });
      });
    }

    function openEdit() {
      var v = pkg && pkg[editVer]; if (!v || !v.main) { setCompileLog('Nincs .tex ehhez a verzióhoz.'); return; }
      var mf = v.files.filter(function (f) { return f.inner === v.main; })[0]; if (!mf) { setCompileLog('A fő .tex nem található.'); return; }
      mf.file.text().then(function (t) { setTexSrc(t); setCompiledBytes(null); setCompileLog(''); });
    }
    function compile() {
      var v = pkg && pkg[editVer]; if (!v || !window.AloudTeX) { setCompileLog('A LaTeX-motor nem érhető el.'); return; }
      setCompiling(true); setCompileLog('Fájlok betöltése…');
      Promise.all(v.files.map(function (f) {
        var isText = /\.(tex|bib|cls|bst|clo|sty|def|cfg|ltx|txt|bbl|aux)$/i.test(f.inner);
        if (f.inner === v.main) return Promise.resolve({ path: f.inner, text: texSrc });
        return isText ? f.file.text().then(function (t) { return { path: f.inner, text: t }; }) : f.file.arrayBuffer().then(function (ab) { return { path: f.inner, bytes: new Uint8Array(ab) }; });
      })).then(function (filesArr) {
        return window.AloudTeX.compile({ mainFile: v.main, files: filesArr, passes: 3, onProgress: function (m) { setCompileLog(m); } });
      }).then(function (r) {
        setCompiling(false);
        if (r && r.ok && r.pdf) { setCompiledBytes(r.pdf); setCompileLog('Kész — ' + (r.pages || '?') + ' oldal' + (r.ms ? ', ' + Math.round(r.ms / 1000) + 's' : '')); }
        else { setCompileLog('Fordítási hiba (a hivatkozások bibtex nélkül „?" lehetnek):\n' + ((r && r.log) || '').slice(-1600)); }
      }).catch(function (e) { setCompiling(false); setCompileLog('Hiba: ' + e); });
    }

    function narration() {
      var lines = [];
      if (db.publication && db.publication.title) lines.push('A „' + db.publication.title + '" című kézirat bírálatra adott válaszának összefoglalója.');
      shown.forEach(function (c) {
        var pts = (c.review_points || []).join(', ');
        lines.push((pts ? pts + '. ' : '') + stripTex(c.change_summary || '') + (c.reason ? ' ' + stripTex(c.reason) : ''));
      });
      return lines.join(' ');
    }
    function genAudio() {
      if (!window.PREleven) { setAErr('A hangmotor nem érhető el.'); return; }
      if (!window.PREleven.hasKey()) { setNeedKey(true); return; }
      var segs = toSegs(narration()); if (!segs.length) { setAErr('Nincs felolvasandó változás.'); return; }
      setABusy(true); setAErr(''); setAudioUrl(''); setAProg('0 / ' + segs.length);
      var cfg = { elevenVoice: voice, model: model, stability: 50, similarity: 75 };
      var blobs = []; var i = 0;
      (function next() {
        if (i >= segs.length) { window.PREleven.concatMp3(blobs).then(function (mp3) { setAudioUrl(URL.createObjectURL(mp3)); setABusy(false); setAProg(''); }); return; }
        setAProg((i + 1) + ' / ' + segs.length);
        window.PREleven.getBlob(segs[i], cfg, null, null).then(function (b) { if (b) blobs.push(b); i++; next(); }, function (e) { setAErr('Hangszintézis hiba: ' + e); setABusy(false); });
      })();
    }
    function saveKey() { if (window.PREleven && keyVal.trim()) { window.PREleven.setKey(keyVal); setNeedKey(false); setKeyVal(''); genAudio(); } }

    // ---------- render ----------
    if (!db) return h('div', { className: 'cm-wrap' },
      h('div', { className: 'cm-empty' },
        h('h1', null, '🔀 Revízió-összehasonlítás'),
        h('p', null, 'Töltsd be a teljes ', h('code', null, 'P1_review_compare'), ' mappát — a ', h('code', null, 'change_database.json'), ' + a két verzió almappáját (a .tex / .bib / ábrák / osztály + a fordított PDF). A böngésző csak olvassa, nem tölti fel sehova.'),
        h('input', { ref: function (el) { folderRef.current = el; if (el) { el.setAttribute('webkitdirectory', ''); el.setAttribute('directory', ''); el.setAttribute('mozdirectory', ''); } }, type: 'file', multiple: true, style: { display: 'none' }, onChange: onFolder }),
        h('div', { style: { marginTop: 14 } }, h('button', { className: 'btn pri', onClick: function () { folderRef.current && folderRef.current.click(); } }, loading ? 'Betöltés…' : '📁 Mappa kiválasztása')),
        err ? h('div', { style: { color: 'var(--danger)', marginTop: 10 } }, err) : null));

    var TABS = [['changes', 'Változások'], ['pdf', 'PDF + kiemelés'], ['edit', 'Élő szerkesztés'], ['audio', '🎧 Hangoskönyv']];
    var header = h('div', { className: 'cm-head' },
      h('div', { style: { minWidth: 0 } },
        h('h1', null, (db.publication && db.publication.title) || 'Revízió-összehasonlítás'),
        h('div', { className: 'cm-sub' }, (db.publication && db.publication.venue ? db.publication.venue + ' · ' : '') + changes.length + ' változás · ' + ((db.review_points || []).length) + ' bírálói pont' + (pkg ? ' · ' + (pdfs.v2 ? 'v2✓' : 'v2✗') + ' ' + (pdfs.v3 ? 'v3✓' : 'v3✗') : ''))),
      h('div', { className: 'seg', style: { marginLeft: 'auto' } }, TABS.map(function (t) { return h('button', { key: t[0], className: view === t[0] ? 'on' : '', onClick: function () { setView(t[0]); if (t[0] === 'edit' && !texSrc) openEdit(); } }, t[1]); })));

    function sidebar() {
      return h('div', { className: 'cm-side' },
        h('div', { className: 'cm-filter' },
          h('label', null, 'Bírálói észrevétel'),
          h('select', { className: 'field', value: filterP, onChange: function (e) { setFilterP(e.target.value); } },
            h('option', { value: '' }, 'Minden változás (' + changes.length + ')'),
            (db.review_points || []).map(function (r) { var n = (db.index_by_review_point && db.index_by_review_point[r.id] || []).length; return h('option', { key: r.id, value: r.id }, r.id + ' (' + n + ') — ' + r.reviewer); }))),
        filterP && rp[filterP] ? h('div', { className: 'cm-rpcomment' }, '„' + rp[filterP].comment + '"') : null,
        h('div', { className: 'cm-list' }, shown.map(function (c) {
          var cat = CAT[c.category] || { c: '#6b7280', t: c.category };
          return h('div', { key: c.id, className: 'cm-li' + (c.id === (sel && sel.id) ? ' on' : ''), onClick: function () { setSelId(c.id); } },
            h('div', { style: { display: 'flex', gap: 6, alignItems: 'center', marginBottom: 2 } },
              h('span', { className: 'cm-op', style: { color: (OP[c.op] || {}).c } }, (OP[c.op] || {}).t || c.op),
              h('span', { className: 'cm-cat', style: { background: cat.c } }, cat.t),
              h('span', { className: 'cm-sec' }, c.section)),
            h('div', { className: 'cm-li-sum' }, c.change_summary));
        })));
    }
    function changeDetail() {
      if (!sel) return h('div', { className: 'cm-main' }, h('div', { style: { color: 'var(--muted)' } }, 'Nincs változás ehhez a szűrőhöz.'));
      return h('div', { className: 'cm-main' },
        h('div', { className: 'cm-ch-head' },
          h('span', { className: 'cm-cat', style: { background: (CAT[sel.category] || {}).c } }, (CAT[sel.category] || {}).t || sel.category),
          h('span', { className: 'cm-op', style: { color: (OP[sel.op] || {}).c, fontSize: 13 } }, (OP[sel.op] || {}).t),
          h('span', { style: { fontSize: 13, color: 'var(--muted)' } }, sel.section),
          sel.confidence ? h('span', { className: 'cm-conf', title: 'megbízhatóság' }, sel.confidence) : null),
        h('h3', { style: { margin: '4px 0 10px' } }, sel.change_summary),
        h('div', { className: 'cm-diff' },
          sel.op === 'insert' ? h('span', { className: 'd-add' }, (sel.final && sel.final.text) || '')
            : sel.op === 'delete' ? h('span', { className: 'd-del' }, (sel.original && sel.original.text) || '')
              : diffWords((sel.original && sel.original.text) || '', (sel.final && sel.final.text) || '').map(function (p, i) { return h('span', { key: i, className: p.added ? 'd-add' : p.removed ? 'd-del' : '' }, p.value); })),
        h('div', { className: 'cm-why' },
          h('div', { className: 'cm-why-h' }, '💬 Miért változott?'),
          (sel.review_points || []).map(function (id) { var r = rp[id]; return h('div', { key: id, className: 'cm-rp' }, h('b', null, id + (r ? ' · ' + r.reviewer : '')), r ? h('div', { className: 'cm-rp-c' }, '„' + r.comment + '"') : null); }),
          sel.reason ? h('div', { className: 'cm-reason' }, h('b', null, 'Indok: '), sel.reason) : null));
    }
    function pdfPanes() {
      if (!pdfs.v2 && !pdfs.v3) return h('div', { className: 'cm-main' }, h('div', { style: { color: 'var(--muted)' } }, 'A PDF-ek nem töltődtek be a mappából. Töltsd be újra a teljes mappát (a két verzió fordított PDF-jét is tartalmaznia kell).'));
      return h('div', { className: 'cm-pdfwrap' },
        h('div', { className: 'cm-pdfcol' }, h('div', { className: 'cm-pdf-h' }, (pkg && pkg.v2 && pkg.v2.label) || 'v2 — beküldött', sel ? h('span', { className: 'cm-pdf-hint' }, ' — kiemelve: ' + sel.id) : null), pdfs.v2 ? h(PdfDoc, { bytes: pdfs.v2, change: sel, side: 'original' }) : h('div', { className: 'cm-pdf-empty' }, 'nincs v2 PDF')),
        h('div', { className: 'cm-pdfcol' }, h('div', { className: 'cm-pdf-h' }, (pkg && pkg.v3 && pkg.v3.label) || 'v3 — revideált', sel ? h('span', { className: 'cm-pdf-hint' }, ' — kiemelve: ' + sel.id) : null), pdfs.v3 ? h(PdfDoc, { bytes: pdfs.v3, change: sel, side: 'final' }) : h('div', { className: 'cm-pdf-empty' }, 'nincs v3 PDF')));
    }
    function editPanel() {
      return h('div', { className: 'cm-edit' },
        h('div', { className: 'cm-edit-l' },
          h('div', { className: 'cm-edit-bar' },
            h('div', { className: 'seg' }, [['v2', 'v2'], ['v3', 'v3']].map(function (o) { return h('button', { key: o[0], className: editVer === o[0] ? 'on' : '', onClick: function () { setEditVer(o[0]); setTexSrc(''); setCompiledBytes(null); setCompileLog(''); setTimeout(openEdit, 0); } }, o[1]); })),
            h('button', { className: 'btn', onClick: openEdit }, '↻ Eredeti .tex'),
            h('button', { className: 'btn pri', onClick: compile, disabled: compiling || !texSrc }, compiling ? 'Fordítás…' : '▶ Fordítás (PDF)')),
          h('textarea', { className: 'cm-tex', value: texSrc, spellCheck: false, onChange: function (e) { setTexSrc(e.target.value); }, placeholder: 'Válassz verziót, majd „Eredeti .tex" — ide töltődik a kézirat forrása…' }),
          compileLog ? h('pre', { className: 'cm-log' }, compileLog) : null),
        h('div', { className: 'cm-edit-r' },
          compiledBytes ? h(PdfDoc, { bytes: compiledBytes, change: null, side: 'final' })
            : h('div', { className: 'cm-pdf-empty', style: { height: '100%' } }, 'A lefordított PDF itt jelenik meg. (SwiftLaTeX, böngészőben — bibtex nincs, így a hivatkozások „?"-ek lehetnek; az élő szöveg/ábra-változások viszont látszanak.)')));
    }
    function audioPanel() {
      var V = (window.PREleven && window.PREleven.voices) || [{ id: voice, name: voice }];
      var M = (window.PREleven && window.PREleven.models) || [{ id: model, name: model }];
      var nSeg = toSegs(narration()).length;
      return h('div', { className: 'cm-audio' },
        h('h3', { style: { marginTop: 0 } }, '🎧 Revízió-hangoskönyv'),
        h('p', { className: 'cm-sub' }, 'A ' + (filterP ? 'szűrt ' : '') + shown.length + ' változás története (összefoglaló + indok) felolvasva' + (filterP && rp[filterP] ? ' — ' + filterP : '') + '. ~' + nSeg + ' szegmens.'),
        needKey ? h('div', { className: 'cm-key' },
          h('div', { style: { fontSize: 13, marginBottom: 6 } }, 'Add meg az ElevenLabs API-kulcsod (csak ebben a böngészőben tárolódik):'),
          h('div', { style: { display: 'flex', gap: 8 } },
            h('input', { className: 'field', type: 'password', value: keyVal, placeholder: 'xi-...', onChange: function (e) { setKeyVal(e.target.value); }, style: { flex: 1 } }),
            h('button', { className: 'btn pri', onClick: saveKey }, 'Mentés + indítás'))) : null,
        h('div', { className: 'cm-arow' },
          h('label', null, 'Hang'), h('select', { className: 'field', value: voice, onChange: function (e) { setVoice(e.target.value); } }, V.map(function (v) { return h('option', { key: v.id, value: v.id }, v.name); })),
          h('label', null, 'Modell'), h('select', { className: 'field', value: model, onChange: function (e) { setModel(e.target.value); } }, M.map(function (m) { return h('option', { key: m.id, value: m.id }, m.name); }))),
        h('div', { style: { marginTop: 12 } },
          h('button', { className: 'btn pri', onClick: genAudio, disabled: aBusy || !nSeg }, aBusy ? 'Generálás… ' + aProg : '🎙️ Hangoskönyv generálása')),
        aErr ? h('div', { style: { color: 'var(--danger)', marginTop: 8, fontSize: 13 } }, aErr) : null,
        audioUrl ? h('div', { style: { marginTop: 14 } }, h('audio', { src: audioUrl, controls: true, style: { width: '100%' } }), h('div', { style: { marginTop: 6 } }, h('a', { className: 'btn', href: audioUrl, download: 'revizio-hangoskonyv.mp3' }, '⬇ Letöltés (MP3)'))) : null,
        h('details', { style: { marginTop: 14 } }, h('summary', { style: { cursor: 'pointer', fontSize: 13, color: 'var(--muted)' } }, 'Felolvasandó szöveg előnézete'), h('div', { style: { fontSize: 13, lineHeight: 1.55, marginTop: 8, whiteSpace: 'pre-wrap' } }, narration())));
    }

    var body;
    if (view === 'pdf') body = h('div', { className: 'cm-body' }, sidebar(), pdfPanes());
    else if (view === 'edit') body = editPanel();
    else if (view === 'audio') body = audioPanel();
    else body = h('div', { className: 'cm-body' }, sidebar(), changeDetail());

    return h('div', { className: 'cm-wrap' }, header, body);
  }

  var root = document.getElementById('root');
  if (root && window.React && window.ReactDOM) ReactDOM.createRoot(root).render(h(App));
})();
