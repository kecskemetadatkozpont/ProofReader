/* Publify — „Beküldési csomagok” felület a publikáció-szerkesztőben.
 *
 * Egy publikációhoz több, egymást követő csomagverzió tartozik. Itt lehet újat feltölteni
 * (ZIP), megnézni, hogy a séma szerint mi hiányzik belőle, és két verziót TARTALMILAG
 * összehasonlítani — nem bájtszinten: ha a kézirat PDF-je csak újra lett fordítva, azt
 * ki is mondjuk, és nem soroljuk fel hamis változásként.
 *
 * A feldolgozás a böngészőben fut (JSZip + pdf.js), a szerverre csak a manifest megy
 * (submission_packages, migration-139) és a méretkorlát alatti fájlok bájtjai.
 * A logika a submission-package.js-ben van, hogy Node-ból is tesztelhető legyen.
 */
(function () {
  'use strict';
  var h = React.createElement;
  var useState = React.useState, useEffect = React.useEffect, useRef = React.useRef;
  var BE = window.PR_BACKEND, sb = BE && BE.sb;
  var P = window.PRPackage;
  var STORE_CAP = 45 * 1024 * 1024;     // a tárhely fájlonként 50 MB-ot enged
  var PDFJS_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';

  function mb(n) { n = +n || 0; return n >= 1e6 ? (n / 1e6).toFixed(1) + ' MB' : n >= 1e3 ? Math.round(n / 1e3) + ' kB' : n + ' B'; }
  function fmtDate(s) { try { return new Date(s).toLocaleString('hu-HU', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (e) { return String(s || '').slice(0, 16); } }
  function toast(m, kind) { try { window.PRUI.toast(m, { kind: kind || 'info' }); } catch (e) { } }

  function ensurePdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (window._pdfjsLoading) return window._pdfjsLoading;
    window._pdfjsLoading = new Promise(function (res, rej) {
      var sc = document.createElement('script'); sc.src = PDFJS_URL;
      sc.onload = function () {
        if (!window.pdfjsLib) { window._pdfjsLoading = null; rej(new Error('A PDF-olvasó nem töltődött be.')); return; }
        try { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js'; } catch (e) { }
        res(window.pdfjsLib);
      };
      sc.onerror = function () { window._pdfjsLoading = null; rej(new Error('A PDF-olvasót nem sikerült betölteni.')); };
      document.head.appendChild(sc);
    });
    return window._pdfjsLoading;
  }

  // A PDF szövege SORONKÉNT: az elemeket az y-koordinátájuk szerint csoportosítjuk, mert
  // a diff egysége a sor. Mindkét verzió ugyanígy készül, így a kettő összevethető.
  async function pdfText(bytes) {
    var lib = await ensurePdfJs();
    var doc = await lib.getDocument({ data: bytes }).promise;
    var out = [];
    for (var i = 1; i <= doc.numPages; i++) {
      var page = await doc.getPage(i);
      var tc = await page.getTextContent();
      var lines = {}, order = [];
      tc.items.forEach(function (it) {
        var y = Math.round(it.transform[5]);
        if (!lines[y]) { lines[y] = []; order.push(y); }
        lines[y].push(it.str);
      });
      order.sort(function (a, b) { return b - a; });
      out.push(order.map(function (y) { return lines[y].join(' ').replace(/\s+/g, ' ').trim(); }).filter(Boolean).join('\n'));
      page.cleanup();
    }
    try { doc.destroy(); } catch (e) { }
    return out.join('\n');
  }

  async function sha256(bytes) {
    var buf = await crypto.subtle.digest('SHA-256', bytes.buffer ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes);
    var a = new Uint8Array(buf), s = '';
    for (var i = 0; i < 16; i++) s += a[i].toString(16).padStart(2, '0');
    return s;
  }

  var configured = false;
  function ensureConfigured() {
    if (configured) return;
    if (!window.JSZip) throw new Error('A ZIP-olvasó (JSZip) nem érhető el.');
    P.configure({ JSZip: window.JSZip, sha256: sha256, pdfText: pdfText });
    configured = true;
  }

  /* ---------------------------------------------------------------- felület */
  function Chip(props) {
    return h('span', { style: Object.assign({ display: 'inline-flex', alignItems: 'center', height: 20, padding: '0 8px', borderRadius: 6, fontSize: 11, fontWeight: 700, background: 'var(--surface-2)', color: 'var(--muted)' }, props.style || {}) }, props.children);
  }

  function Modal(props) {
    var pid = props.projectId, ce = props.canEdit;
    var lS = useState(null), list = lS[0], setList = lS[1];
    var vS = useState('list'), view = vS[0], setView = vS[1];      // list | detail | compare | stage
    var dS = useState(null), detail = dS[0], setDetail = dS[1];
    var aS = useState(''), aId = aS[0], setAId = aS[1];
    var bS = useState(''), bId = bS[0], setBId = bS[1];
    var rS = useState(null), report = rS[0], setReport = rS[1];
    var stS = useState(null), stage = stS[0], setStage = stS[1];    // {file, manifest, label, note, isRev}
    var pS = useState(''), prog = pS[0], setProg = pS[1];
    var bsS = useState(false), busy = bsS[0], setBusy = bsS[1];
    var eS = useState(''), err = eS[0], setErr = eS[1];
    var fileRef = useRef(null);
    var alive = useRef(true);
    useEffect(function () { alive.current = true; return function () { alive.current = false; }; }, []);

    function load() {
      if (!sb || !pid) return;
      sb.rpc('sp_list', { p_project: pid }).then(function (r) {
        if (!alive.current) return;
        if (r && r.error) { setErr(r.error.code === 'PGRST202' ? 'Ehhez a funkcióhoz a migration-139-submission-packages.sql lefuttatása kell.' : r.error.message); setList([]); return; }
        var L = (r && r.data) || [];
        setList(L); setErr('');
        if (L.length >= 2) { setBId(L[0].id); setAId(L[1].id); } else if (L.length === 1) { setBId(L[0].id); }
      });
    }
    useEffect(function () { load(); }, [pid]);

    /* --- új csomag beolvasása (böngészőben) --- */
    function pick(e) {
      var f = e.target.files && e.target.files[0]; e.target.value = '';
      if (!f) return;
      if (!/\.zip$/i.test(f.name)) { toast('A csomagot ZIP-ként várjuk.', 'error'); return; }
      setBusy(true); setErr(''); setProg('ZIP kibontása…');
      try { ensureConfigured(); } catch (er) { setBusy(false); setErr(er.message); return; }
      P.readArchive(f, { onProgress: function (i, n, path) { if (alive.current) setProg('Feldolgozás ' + i + '/' + n + ' — ' + path); } })
        .then(function (m) {
          if (!alive.current) return;
          setBusy(false); setProg('');
          setStage({ file: f, manifest: m, label: '', note: '', isRev: (list || []).length > 0 });
          setView('stage');
        }, function (er) { if (alive.current) { setBusy(false); setProg(''); setErr('A csomagot nem sikerült beolvasni: ' + (er && er.message || er)); } });
    }

    /* --- mentés: a méretkorlát alatti fájlok tárolóba, a manifest az adatbázisba --- */
    async function save() {
      if (!stage) return;
      setBusy(true); setErr('');
      var m = stage.manifest, files = m.files || [];
      var stored = 0, skipped = 0;
      try {
        if (window.PRUploads && window.PRUploads.enabled) {
          var zip = await window.JSZip.loadAsync(stage.file);
          var names = Object.keys(zip.files);
          for (var i = 0; i < files.length; i++) {
            var e = files[i];
            if (e.size > STORE_CAP) { skipped++; continue; }
            setProg('Feltöltés ' + (i + 1) + '/' + files.length + ' — ' + e.path);
            var full = names.filter(function (n) { return n === (m.root ? m.root + '/' + e.path : e.path) || n.slice(-e.path.length) === e.path; })[0];
            if (!full) { skipped++; continue; }
            var blob = await zip.files[full].async('blob');
            try {
              var meta = await window.PRUploads.put(props.projectId, e.path.split('/').pop(), blob);
              e.sp = meta.storagePath; stored++;
            } catch (up) { skipped++; }
          }
        } else { skipped = files.length; }
        setProg('Mentés…');
        var payload = {
          label: stage.label, note: stage.note, archive_name: stage.file.name, archive_size: String(stage.file.size),
          is_revision: !!stage.isRev, manifest: P.trimManifest(m),
          stats: { files: files.length, bytes: m.bytes, stored: stored, skipped: skipped,
                   missing: P.checklist(m, !!stage.isRev).filter(function (r) { return r.required && !r.present; }).map(function (r) { return r.id; }) },
        };
        var r = await sb.rpc('sp_create', { p_project: pid, p_payload: payload });
        if (r && r.error) throw new Error(r.error.message);
        if (!alive.current) return;
        setBusy(false); setProg(''); setStage(null); setView('list');
        toast('Csomag mentve (v' + (r.data && r.data.version) + ')' + (skipped ? ' — ' + skipped + ' fájl csak ujjlenyomattal' : ''), 'success');
        load();
      } catch (er) {
        if (!alive.current) return;
        setBusy(false); setProg(''); setErr('Mentés sikertelen: ' + (er && er.message || er));
      }
    }

    function openDetail(id) {
      setBusy(true);
      sb.rpc('sp_get', { p_id: id }).then(function (r) {
        if (!alive.current) return;
        setBusy(false);
        if (r && r.error) { setErr(r.error.message); return; }
        setDetail(r.data); setView('detail');
      });
    }

    function runCompare() {
      if (!aId || !bId || aId === bId) { toast('Válassz két különböző verziót.', 'error'); return; }
      setBusy(true); setErr(''); setProg('Összehasonlítás…');
      Promise.all([sb.rpc('sp_get', { p_id: aId }), sb.rpc('sp_get', { p_id: bId })]).then(function (rs) {
        if (!alive.current) return;
        setBusy(false); setProg('');
        if (rs[0].error || rs[1].error) { setErr((rs[0].error || rs[1].error).message); return; }
        var A = rs[0].data, B = rs[1].data;
        var older = A.version <= B.version ? A : B, newer = A.version <= B.version ? B : A;
        var cmp = P.compare(older.manifest, newer.manifest, { isRevision: !!newer.is_revision });
        setReport({ a: older, b: newer, cmp: cmp });
        setView('compare');
      });
    }

    function del(id, ver) {
      if (!window.confirm('Biztosan törlöd a(z) v' + ver + ' csomagot? A tárolt fájljai is törlődnek.')) return;
      sb.rpc('sp_delete', { p_id: id }).then(function (r) {
        if (r && r.error) { toast('Törlés sikertelen: ' + r.error.message, 'error'); return; }
        var paths = (r.data && r.data.storage_paths) || [];
        paths.forEach(function (sp) { try { window.PRUploads && window.PRUploads.remove && window.PRUploads.remove(sp); } catch (e) { } });
        toast('Csomag törölve', 'success'); load();
        if (detail && detail.id === id) { setDetail(null); setView('list'); }
      });
    }

    function downloadReport() {
      if (!report) return;
      var md = reportMarkdown(report);
      var blob = new Blob([md], { type: 'text/markdown' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'csomag-osszehasonlitas-v' + report.a.version + '-v' + report.b.version + '.md';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    }

    /* ---------------- oldalsáv: verziólista ---------------- */
    var side = h('div', { style: { width: 250, flex: '0 0 250px', borderRight: '1px solid var(--line)', display: 'flex', flexDirection: 'column', minHeight: 0 } },
      h('div', { style: { padding: '10px 12px', borderBottom: '1px solid var(--line)', display: 'flex', gap: 8, alignItems: 'center' } },
        h('b', { style: { fontSize: 13, flex: 1 } }, 'Verziók'),
        ce ? h('button', { className: 'btn-ghost', style: { height: 28, padding: '0 9px' }, disabled: busy, onClick: function () { fileRef.current && fileRef.current.click(); } }, '＋ ZIP') : null),
      h('input', { ref: fileRef, type: 'file', accept: '.zip', style: { display: 'none' }, onChange: pick }),
      h('div', { style: { overflow: 'auto', flex: 1, minHeight: 0 } },
        list === null ? h('div', { style: { padding: 12, fontSize: 12.5, color: 'var(--muted)' } }, 'Betöltés…')
          : !list.length ? h('div', { style: { padding: 12, fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.5 } }, 'Még nincs csomag. Tölts fel egy beküldési ZIP-et — a rendszer felismeri a szerepeket, és a következő verziót ehhez tudod hasonlítani.')
            : list.map(function (s) {
              var missing = (s.stats && s.stats.missing) || [];
              return h('div', {
                key: s.id,
                style: { padding: '9px 12px', borderBottom: '1px solid var(--line)', cursor: 'pointer', background: (detail && detail.id === s.id && view === 'detail') ? 'var(--surface-2)' : 'transparent' },
                onClick: function () { openDetail(s.id); }
              },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                  h('b', { style: { fontSize: 13 } }, 'v' + s.version),
                  s.is_revision ? h(Chip, null, 'revízió') : null,
                  missing.length ? h(Chip, { style: { background: 'var(--danger-bg)', color: 'var(--danger)' } }, missing.length + ' hiány') : null,
                  h('span', { style: { flex: 1 } }),
                  h('input', { type: 'radio', name: 'cmpA', checked: aId === s.id, title: 'Régebbi (A)', onClick: function (e) { e.stopPropagation(); setAId(s.id); }, onChange: function () { } }),
                  h('input', { type: 'radio', name: 'cmpB', checked: bId === s.id, title: 'Újabb (B)', onClick: function (e) { e.stopPropagation(); setBId(s.id); }, onChange: function () { } })),
                h('div', { style: { fontSize: 11.5, color: 'var(--muted)', marginTop: 2 } }, s.label || s.archive_name || '—'),
                h('div', { style: { fontSize: 11, color: 'var(--faint)', marginTop: 1 } }, fmtDate(s.created_at) + ' · ' + (s.files || 0) + ' fájl · ' + mb((s.stats && s.stats.bytes) || s.archive_size)));
            })),
      h('div', { style: { padding: 10, borderTop: '1px solid var(--line)', display: 'flex', gap: 6 } },
        h('button', { className: 'btn-primary', style: { flex: 1, height: 32 }, disabled: busy || !aId || !bId || aId === bId, onClick: runCompare }, '⇄ Összehasonlítás')));

    /* ---------------- jobb oldal ---------------- */
    var body;
    if (view === 'stage' && stage) body = h(Stage, { stage: stage, setStage: setStage, onSave: save, onCancel: function () { setStage(null); setView('list'); }, busy: busy });
    else if (view === 'compare' && report) body = h(Report, { report: report, onDownload: downloadReport });
    else if (view === 'detail' && detail) body = h(Detail, { pkg: detail, canEdit: ce, onDelete: function () { del(detail.id, detail.version); } });
    else body = h('div', { style: { padding: 22, color: 'var(--muted)', fontSize: 13, lineHeight: 1.6, maxWidth: 620 } },
      h('h3', { style: { marginTop: 0, color: 'var(--ink)' } }, 'Mi tartozik egy beküldési csomagba?'),
      h('p', null, 'Ezt a listát kérjük minden körben. A feltöltött ZIP-ben a rendszer felismeri a szerepeket, és jelzi, ha valami hiányzik.'),
      h('div', null, P.ROLES.map(function (r) {
        return h('div', { key: r.id, style: { display: 'flex', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--line)' } },
          h('span', { style: { width: 230, flex: '0 0 230px', fontWeight: 600, color: 'var(--ink)', fontSize: 12.5 } }, r.label),
          h('span', { style: { flex: 1, fontSize: 12 } }, (r.hint || '') + (r.portal && r.portal !== '—' ? ' · portál: ' + r.portal : '')),
          h(Chip, { style: r.req === 'always' ? { background: 'var(--danger-bg)', color: 'var(--danger)' } : r.req === 'revision' ? { background: 'var(--warn-bg)', color: 'var(--warn)' } : null },
            r.req === 'always' ? 'kötelező' : r.req === 'revision' ? 'revízióhoz' : 'opcionális'));
      })));

    return h('div', { className: 'overlay', onClick: props.onClose },
      h('div', { className: 'modal', style: { width: 1060, maxWidth: '96vw', height: '86vh', maxHeight: '86vh' }, onClick: function (e) { e.stopPropagation(); } },
        h('div', { className: 'modal-head', style: { display: 'flex', alignItems: 'flex-start', gap: 10, paddingBottom: 12, borderBottom: '1px solid var(--line)' } },
          h('div', { style: { flex: 1 } },
            h('h3', null, '📦 Beküldési csomagok'),
            h('p', null, props.title ? props.title : 'Verziók feltöltése és tartalmi összehasonlítása')),
          busy ? h('span', { style: { fontSize: 12, color: 'var(--muted)' } }, prog || 'Dolgozom…') : null,
          h('button', { className: 'btn-ghost', style: { height: 30 }, onClick: props.onClose }, 'Bezár')),
        err ? h('div', { style: { padding: '8px 22px', color: 'var(--danger)', fontSize: 12.5 } }, '⚠ ' + err) : null,
        h('div', { style: { display: 'flex', flex: 1, minHeight: 0 } }, side,
          h('div', { style: { flex: 1, minWidth: 0, overflow: 'auto' } }, body))));
  }

  /* ---------------- egy beolvasott, még nem mentett csomag ---------------- */
  function Stage(props) {
    var s = props.stage, m = s.manifest;
    var cl = P.checklist(m, s.isRev);
    var willStore = (m.files || []).filter(function (f) { return f.size <= STORE_CAP; });
    var tooBig = (m.files || []).filter(function (f) { return f.size > STORE_CAP; });
    return h('div', { style: { padding: 18 } },
      h('h3', { style: { marginTop: 0 } }, 'Új verzió — ' + s.file.name),
      h('div', { style: { fontSize: 12.5, color: 'var(--muted)', marginBottom: 12 } },
        (m.files || []).length + ' fájl · ' + mb(m.bytes) + ' · feltöltésre kerül ' + willStore.length + ' fájl (' + mb(willStore.reduce(function (a, f) { return a + f.size; }, 0)) + ')' +
        (tooBig.length ? ' · ' + tooBig.length + ' fájl a tárhely 50 MB-os korlátja miatt csak ujjlenyomattal: ' + tooBig.map(function (f) { return f.path; }).join(', ') : '')),
      h('div', { style: { display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' } },
        h('input', { className: 'text-input', style: { flex: 1, minWidth: 220 }, placeholder: 'Címke (pl. „2. revízió — Sensors”)', value: s.label, onChange: function (e) { props.setStage(Object.assign({}, s, { label: e.target.value })); } }),
        h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5 } },
          h('input', { type: 'checkbox', checked: s.isRev, onChange: function (e) { props.setStage(Object.assign({}, s, { isRev: e.target.checked })); } }), 'revíziós kör')),
      h('textarea', { className: 'text-input', style: { height: 62, padding: '8px 12px' }, placeholder: 'Mi változott ebben a körben? (opcionális)', value: s.note, onChange: function (e) { props.setStage(Object.assign({}, s, { note: e.target.value })); } }),
      h('div', { style: { margin: '14px 0 6px', fontWeight: 700, fontSize: 13 } }, 'A séma szerint'),
      cl.filter(function (r) { return r.required || r.present; }).map(function (r) {
        return h('div', { key: r.id, style: { display: 'flex', gap: 8, alignItems: 'center', padding: '5px 0', borderBottom: '1px solid var(--line)' } },
          h('span', { style: { width: 18, color: r.present ? 'var(--ok)' : 'var(--danger)' } }, r.present ? '✓' : '✗'),
          h('span', { style: { width: 240, flex: '0 0 240px', fontSize: 12.5, fontWeight: 600 } }, r.label),
          h('span', { style: { flex: 1, fontSize: 12, color: 'var(--muted)' } }, r.files.join(', ') || (r.required ? 'hiányzik' : '—')),
          r.required ? h(Chip, { style: r.present ? null : { background: 'var(--danger-bg)', color: 'var(--danger)' } }, 'kötelező') : null);
      }),
      h('div', { style: { display: 'flex', gap: 8, marginTop: 16 } },
        h('button', { className: 'btn-primary', style: { height: 34 }, disabled: props.busy, onClick: props.onSave }, props.busy ? 'Mentés…' : 'Mentés verzióként'),
        h('button', { className: 'btn-ghost', style: { height: 34 }, disabled: props.busy, onClick: props.onCancel }, 'Mégse')));
  }

  /* ---------------- egy mentett csomag részletei ---------------- */
  function Detail(props) {
    var p = props.pkg, m = p.manifest || {};
    var cl = P.checklist(m, p.is_revision);
    return h('div', { style: { padding: 18 } },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
        h('h3', { style: { margin: 0, flex: 1 } }, 'v' + p.version + (p.label ? ' — ' + p.label : '')),
        h('button', { className: 'btn-ghost', style: { height: 30 }, onClick: function () {
          var md = P.contentsMarkdown(m, { title: p.label || p.archive_name || '', note: p.note || '' });
          var b = new Blob([md], { type: 'text/markdown' }); var a = document.createElement('a');
          a.href = URL.createObjectURL(b); a.download = 'CONTENTS_v' + p.version + '.md'; document.body.appendChild(a); a.click(); a.remove();
        } }, '⬇ CONTENTS.md'),
        props.canEdit ? h('button', { className: 'btn-ghost', style: { height: 30, color: 'var(--danger)' }, onClick: props.onDelete }, 'Törlés') : null),
      h('div', { style: { fontSize: 12, color: 'var(--muted)', margin: '4px 0 12px' } },
        fmtDate(p.created_at) + ' · ' + (m.files || []).length + ' fájl · ' + mb(m.bytes) + (p.archive_name ? ' · ' + p.archive_name : '')),
      p.note ? h('div', { style: { fontSize: 12.5, marginBottom: 12, padding: 10, background: 'var(--surface-2)', borderRadius: 8, whiteSpace: 'pre-wrap' } }, p.note) : null,
      cl.filter(function (r) { return r.required || r.present; }).map(function (r) {
        return h('div', { key: r.id, style: { display: 'flex', gap: 8, alignItems: 'center', padding: '5px 0', borderBottom: '1px solid var(--line)' } },
          h('span', { style: { width: 18, color: r.present ? 'var(--ok)' : 'var(--danger)' } }, r.present ? '✓' : '✗'),
          h('span', { style: { width: 230, flex: '0 0 230px', fontSize: 12.5, fontWeight: 600 } }, r.label),
          h('span', { style: { flex: 1, fontSize: 12, color: 'var(--muted)' } }, r.files.join(', ') || (r.required ? 'hiányzik' : '—')));
      }),
      h('div', { style: { margin: '14px 0 6px', fontWeight: 700, fontSize: 13 } }, 'Fájlok'),
      (m.files || []).map(function (f) {
        return h('div', { key: f.path, style: { display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0', fontSize: 12.5 } },
          h('span', { style: { flex: 1, fontFamily: 'JetBrains Mono, monospace', fontSize: 11.5 } }, f.path),
          f.nested ? h(Chip, null, f.nested.length + ' fájl benne') : null,
          h(Chip, null, (P.ROLE_BY_ID[f.role] || {}).label || 'egyéb'),
          h('span', { style: { width: 70, textAlign: 'right', color: 'var(--muted)' } }, mb(f.size)),
          h('span', { style: { width: 16, textAlign: 'right', color: f.sp ? 'var(--ok)' : 'var(--faint)' }, title: f.sp ? 'a fájl tárolva van' : 'csak ujjlenyomat (méretkorlát)' }, f.sp ? '⬤' : '○'));
      }));
  }

  /* ---------------- összehasonlító jelentés ---------------- */
  function Block(props) {
    var b = props.b;
    return h('div', { style: { borderLeft: '2px solid var(--line)', paddingLeft: 10, margin: '8px 0' } },
      h('div', { style: { fontSize: 11.5, color: 'var(--muted)', marginBottom: 3 } },
        (b.heading ? b.heading + ' · ' : '') + (b.kind === 'add' ? 'új szöveg' : b.kind === 'del' ? 'törölt szöveg' : 'módosítás') +
        ' · ' + b.wordsOld + ' → ' + b.wordsNew + ' szó' +
        (b.numbersChanged && b.numbersChanged.length ? ' · számok: ' + b.numbersChanged.slice(0, 8).map(function (n) { return (n.side === 'added' ? '+' : '−') + n.value; }).join(' ') : '')),
      b.changes ? b.changes.map(function (ch, i) {
        return h('div', { key: i, style: { fontSize: 11.5, fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.55, marginBottom: 4 } },
          ch.context ? h('span', { style: { color: 'var(--faint)' } }, '…' + ch.context.slice(-70) + ' ') : null,
          ch.removed ? h('span', { style: { background: 'var(--danger-bg)', color: 'var(--danger)', textDecoration: 'line-through' } }, ch.removed.slice(0, 300)) : null,
          ch.removed && ch.added ? ' ' : null,
          ch.added ? h('span', { style: { background: 'var(--ok-bg)', color: 'var(--ok)' } }, ch.added.slice(0, 300)) : null);
      }) : h('div', { style: { fontSize: 11.5, fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.55 } },
        b.old ? h('div', { style: { background: 'var(--danger-bg)', color: 'var(--danger)' } }, b.old.slice(0, 300)) : null,
        b.new ? h('div', { style: { background: 'var(--ok-bg)', color: 'var(--ok)' } }, b.new.slice(0, 300)) : null),
      b.moreChanges ? h('div', { style: { fontSize: 11, color: 'var(--faint)' } }, '… még ' + b.moreChanges + ' változás ebben a blokkban') : null);
  }

  function Report(props) {
    var r = props.report, c = r.cmp, s = c.summary;
    var row = function (label, arr, color) {
      if (!arr.length) return null;
      return h('div', { style: { marginBottom: 8 } },
        h('div', { style: { fontSize: 12, fontWeight: 700, color: color || 'var(--ink)' } }, label + ' (' + arr.length + ')'),
        arr.map(function (f, i) { return h('div', { key: i, style: { fontSize: 12, fontFamily: 'JetBrains Mono, monospace', color: 'var(--muted)' } }, (f.oldPath && f.oldPath !== f.path ? f.oldPath + ' → ' : '') + f.path + (f.size != null ? '  ' + mb(f.size) : '')); }));
    };
    return h('div', { style: { padding: 18 } },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
        h('h3', { style: { margin: 0, flex: 1 } }, 'v' + r.a.version + ' → v' + r.b.version),
        h('button', { className: 'btn-ghost', style: { height: 30 }, onClick: props.onDownload }, '⬇ Jelentés (.md)')),
      h('div', { style: { fontSize: 12, color: 'var(--muted)', margin: '4px 0 12px' } },
        fmtDate(r.a.created_at) + ' → ' + fmtDate(r.b.created_at)),
      h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 } },
        h(Chip, { style: { background: 'var(--ok-bg)', color: 'var(--ok)' } }, s.added + ' új'),
        h(Chip, { style: { background: 'var(--danger-bg)', color: 'var(--danger)' } }, s.removed + ' törölt'),
        h(Chip, { style: { background: 'var(--warn-bg)', color: 'var(--warn)' } }, s.contentChanged + ' tartalmilag módosult'),
        s.recompiledOnly ? h(Chip, null, s.recompiledOnly + ' csak újrafordítva') : null,
        h(Chip, null, s.same + ' változatlan')),
      c.missing.length ? h('div', { style: { padding: 10, background: 'var(--danger-bg)', color: 'var(--danger)', borderRadius: 8, fontSize: 12.5, marginBottom: 12 } },
        '⚠ Az újabb csomagból hiányzik: ' + c.missing.map(function (x) { return x.label; }).join(', ')) : null,
      row('Új fájlok', c.added, 'var(--ok)'),
      row('Törölt fájlok', c.removed, 'var(--danger)'),
      row('Átnevezett', c.renamed),
      c.changed.map(function (ch) {
        return h('div', { key: ch.path, style: { border: '1px solid var(--line)', borderRadius: 10, padding: 12, marginBottom: 10 } },
          h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
            h('b', { style: { fontSize: 13, fontFamily: 'JetBrains Mono, monospace' } }, ch.path),
            h(Chip, null, (P.ROLE_BY_ID[ch.role] || {}).label || 'egyéb'),
            h('span', { style: { fontSize: 11.5, color: 'var(--muted)' } }, mb(ch.sizeA) + ' → ' + mb(ch.sizeB))),
          ch.contentSame === true
            ? h('div', { style: { fontSize: 12.5, color: 'var(--ok)', marginTop: 5 } }, '✓ A bájtok mások, de a tartalom azonos — csak újrafordítás/újracsomagolás történt.')
            : null,
          ch.contentSame === null && !ch.nested
            ? h('div', { style: { fontSize: 12.5, color: 'var(--muted)', marginTop: 5 } }, 'A tartalmát nem tudjuk összevetni (ehhez a fájltípushoz nem nyerünk ki szöveget) — a fájl mérete ' + (ch.sizeB > ch.sizeA ? 'nőtt' : ch.sizeB < ch.sizeA ? 'csökkent' : 'nem változott') + '.')
            : null,
          ch.text && !ch.text.same ? h('div', { style: { marginTop: 6 } },
            h('div', { style: { fontSize: 12, color: 'var(--muted)' } },
              ch.text.wordsA + ' → ' + ch.text.wordsB + ' szó · a szöveg ' + (ch.text.changedPct != null ? ch.text.changedPct + '%-a' : 'egy része') + ' változott · ' + ch.text.blocks.length + ' helyen'),
            ch.text.blocks.slice(0, 12).map(function (b, i) { return h(Block, { key: i, b: b }); }),
            ch.text.blocks.length > 12 ? h('div', { style: { fontSize: 11.5, color: 'var(--faint)' } }, '… még ' + (ch.text.blocks.length - 12) + ' hely') : null) : null,
          ch.nested ? h('div', { style: { marginTop: 6 } },
            h('div', { style: { fontSize: 12, color: 'var(--muted)' } },
              'A ZIP tartalma: ' + ch.nested.added.length + ' új, ' + ch.nested.removed.length + ' törölt, ' + ch.nested.changed.length + ' módosult, ' + ch.nested.same.length + ' változatlan'),
            ch.nested.added.map(function (f) { return h('div', { key: 'a' + f.path, style: { fontSize: 11.5, color: 'var(--ok)', fontFamily: 'JetBrains Mono, monospace' } }, '+ ' + f.path); }),
            ch.nested.removed.map(function (f) { return h('div', { key: 'r' + f.path, style: { fontSize: 11.5, color: 'var(--danger)', fontFamily: 'JetBrains Mono, monospace' } }, '− ' + f.path); }),
            ch.nested.changed.map(function (f) {
              return h('div', { key: 'c' + f.path, style: { marginTop: 6 } },
                h('div', { style: { fontSize: 12, fontFamily: 'JetBrains Mono, monospace' } }, '~ ' + f.path +
                  (f.contentSame === true ? '  — a tartalom azonos' : f.text ? '  — a szöveg ' + f.text.changedPct + '%-a változott' : '')),
                f.text && !f.text.same ? f.text.blocks.slice(0, 6).map(function (b, i) { return h(Block, { key: i, b: b }); }) : null);
            })) : null);
      }),
      !c.added.length && !c.removed.length && !c.changed.length
        ? h('div', { style: { fontSize: 13, color: 'var(--ok)' } }, '✓ A két csomag minden fájlja megegyezik.') : null);
  }

  /* A jelentés letölthető változata — ugyanaz az adat, Markdownban. */
  function reportMarkdown(r) {
    var c = r.cmp, s = c.summary, L = [];
    L.push('# Csomag-összehasonlítás — v' + r.a.version + ' → v' + r.b.version, '');
    L.push('- Régebbi: v' + r.a.version + (r.a.label ? ' — ' + r.a.label : '') + ' (' + fmtDate(r.a.created_at) + ')');
    L.push('- Újabb: v' + r.b.version + (r.b.label ? ' — ' + r.b.label : '') + ' (' + fmtDate(r.b.created_at) + ')');
    L.push('- Összegzés: ' + s.added + ' új, ' + s.removed + ' törölt, ' + s.contentChanged + ' tartalmilag módosult, ' +
      s.recompiledOnly + ' csak újrafordítva, ' + s.same + ' változatlan', '');
    if (c.missing.length) L.push('> ⚠ Hiányzik az újabb csomagból: ' + c.missing.map(function (x) { return x.label; }).join(', '), '');
    if (c.added.length) { L.push('## Új fájlok'); c.added.forEach(function (f) { L.push('- `' + f.path + '` (' + mb(f.size) + ')'); }); L.push(''); }
    if (c.removed.length) { L.push('## Törölt fájlok'); c.removed.forEach(function (f) { L.push('- `' + f.path + '`'); }); L.push(''); }
    if (c.renamed.length) { L.push('## Átnevezett'); c.renamed.forEach(function (f) { L.push('- `' + f.oldPath + '` → `' + f.path + '`'); }); L.push(''); }
    c.changed.forEach(function (ch) {
      L.push('## ' + ch.path + '  (' + mb(ch.sizeA) + ' → ' + mb(ch.sizeB) + ')');
      if (ch.contentSame === true) L.push('A bájtok mások, de a tartalom azonos — újrafordítás/újracsomagolás.');
      if (ch.text && !ch.text.same) {
        L.push(ch.text.wordsA + ' → ' + ch.text.wordsB + ' szó, a szöveg ' + ch.text.changedPct + '%-a változott, ' + ch.text.blocks.length + ' helyen.', '');
        ch.text.blocks.slice(0, 40).forEach(function (b) {
          L.push('### ' + (b.heading || '(fejezetcím nélkül)') + ' — ' + b.kind + ' (' + b.wordsOld + ' → ' + b.wordsNew + ' szó)');
          (b.changes || []).forEach(function (x) {
            if (x.removed) L.push('- − ' + x.removed.slice(0, 400));
            if (x.added) L.push('- + ' + x.added.slice(0, 400));
          });
          if (!b.changes) { if (b.old) L.push('- − ' + b.old.slice(0, 400)); if (b.new) L.push('- + ' + b.new.slice(0, 400)); }
          if (b.numbersChanged && b.numbersChanged.length) L.push('- számok: ' + b.numbersChanged.map(function (n) { return (n.side === 'added' ? '+' : '−') + n.value; }).join(' '));
          L.push('');
        });
      }
      if (ch.nested) {
        L.push('A ZIP tartalma: ' + ch.nested.added.length + ' új, ' + ch.nested.removed.length + ' törölt, ' + ch.nested.changed.length + ' módosult.');
        ch.nested.added.forEach(function (f) { L.push('- + `' + f.path + '`'); });
        ch.nested.removed.forEach(function (f) { L.push('- − `' + f.path + '`'); });
        ch.nested.changed.forEach(function (f) {
          L.push('- ~ `' + f.path + '`' + (f.contentSame === true ? ' (tartalom azonos)' : f.text ? ' (' + f.text.changedPct + '% szöveg)' : ''));
          if (f.text && f.text.blocks) f.text.blocks.slice(0, 20).forEach(function (b) {
            (b.changes || []).slice(0, 4).forEach(function (x) {
              if (x.removed) L.push('    - − ' + x.removed.slice(0, 200));
              if (x.added) L.push('    - + ' + x.added.slice(0, 200));
            });
          });
        });
        L.push('');
      }
    });
    return L.join('\n') + '\n';
  }

  window.PRPackages = { Modal: Modal, reportMarkdown: reportMarkdown };
})();
