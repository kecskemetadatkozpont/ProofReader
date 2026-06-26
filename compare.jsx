/* Publify — Revízió-összehasonlítás. Loads a P1_review_compare package (change_database.json + the two
 * compiled PDFs) and shows, change by change, how a manuscript changed in response to peer review: a
 * word-level v2→v3 diff, the verbatim reviewer comment + reason behind it, a reviewer-concern filter, and the
 * two PDFs side by side. No bundler — React.createElement. Works entirely on the uploaded files (no backend). */
(function () {
  var h = React.createElement;
  var useState = React.useState, useRef = React.useRef;

  var CAT = {
    reframing: { c: '#4f46e5', t: 'átkeretezés' }, correction: { c: '#dc2626', t: 'javítás' },
    'number-update': { c: '#0891b2', t: 'szám-frissítés' }, 'new-content': { c: '#16a34a', t: 'új tartalom' },
    notation: { c: '#7c3aed', t: 'jelölés' }, figure: { c: '#b45309', t: 'ábra' },
    citation: { c: '#0d9488', t: 'hivatkozás' }, editorial: { c: '#6b7280', t: 'szerkesztői' }
  };
  var OP = { replace: { t: 'módosítva', c: '#b45309' }, insert: { t: 'új', c: '#16a34a' }, delete: { t: 'törölve', c: '#dc2626' } };

  function diffWords(a, b) {
    if (window.Diff && window.Diff.diffWords) return window.Diff.diffWords(a || '', b || '');
    return [{ value: a || '', removed: true }, { value: ' ' }, { value: b || '', added: true }];   // fallback
  }

  function App() {
    var dbS = useState(null), db = dbS[0], setDb = dbS[1];
    var selS = useState(null), selId = selS[0], setSelId = selS[1];
    var fpS = useState(''), filterP = fpS[0], setFilterP = fpS[1];
    var pdfS = useState({}), pdfs = pdfS[0], setPdfs = pdfS[1];
    var viewS = useState('diff'), view = viewS[0], setView = viewS[1];
    var errS = useState(''), err = errS[0], setErr = errS[1];
    var dbRef = useRef(null), pdfRef = useRef(null);

    function onDb(e) {
      var f = e.target.files && e.target.files[0]; if (!f) return;
      f.text().then(function (t) {
        try { var d = JSON.parse(t); if (!d || !Array.isArray(d.changes)) throw 0; setDb(d); setSelId((d.changes[0] || {}).id || null); setFilterP(''); setErr(''); }
        catch (x) { setErr('Ez nem egy érvényes change_database.json.'); }
      });
    }
    function onPdfs(e) {
      var files = Array.prototype.slice.call(e.target.files || []); var p = Object.assign({}, pdfs);
      files.forEach(function (f) { var u = URL.createObjectURL(f); if (/v3|final/i.test(f.name)) p.v3 = u; else if (/v2|orig/i.test(f.name)) p.v2 = u; else if (!p.v2) p.v2 = u; else p.v3 = u; });
      setPdfs(p);
    }

    var rp = {}; ((db && db.review_points) || []).forEach(function (r) { rp[r.id] = r; });
    var changes = (db && db.changes) || [];
    var shown = filterP ? changes.filter(function (c) { return (c.review_points || []).indexOf(filterP) >= 0; }) : changes;
    var sel = changes.filter(function (c) { return c.id === selId; })[0] || shown[0];

    if (!db) return h('div', { className: 'cm-wrap' },
      h('div', { className: 'cm-empty' },
        h('h1', null, '🔀 Revízió-összehasonlítás'),
        h('p', null, 'Tölts be egy review-compare csomagot: a ', h('code', null, 'change_database.json'), '-t (kötelező), és opcionálisan a két verzió PDF-jét (v2 + v3) az egymás-melletti nézethez.'),
        h('input', { ref: dbRef, type: 'file', accept: '.json', style: { display: 'none' }, onChange: onDb }),
        h('input', { ref: pdfRef, type: 'file', accept: '.pdf', multiple: true, style: { display: 'none' }, onChange: onPdfs }),
        h('div', { style: { display: 'flex', gap: 10, justifyContent: 'center', marginTop: 14 } },
          h('button', { className: 'btn pri', onClick: function () { dbRef.current && dbRef.current.click(); } }, '📂 change_database.json betöltése'),
          h('button', { className: 'btn', onClick: function () { pdfRef.current && pdfRef.current.click(); } }, '📄 PDF-ek (v2 + v3)')),
        err ? h('div', { style: { color: 'var(--danger)', marginTop: 10 } }, err) : null));

    return h('div', { className: 'cm-wrap' },
      h('div', { className: 'cm-head' },
        h('div', { style: { minWidth: 0 } },
          h('h1', null, (db.publication && db.publication.title) || 'Revízió-összehasonlítás'),
          h('div', { className: 'cm-sub' }, (db.publication && db.publication.venue ? db.publication.venue + ' · ' : '') + changes.length + ' változás · ' + ((db.review_points || []).length) + ' bírálói pont')),
        h('div', { style: { marginLeft: 'auto', display: 'flex', gap: 8 } },
          h('input', { ref: pdfRef, type: 'file', accept: '.pdf', multiple: true, style: { display: 'none' }, onChange: onPdfs }),
          h('div', { className: 'seg' },
            h('button', { className: view === 'diff' ? 'on' : '', onClick: function () { setView('diff'); } }, 'Változások'),
            h('button', { className: view === 'pdfs' ? 'on' : '', onClick: function () { (pdfs.v2 || pdfs.v3) ? setView('pdfs') : (pdfRef.current && pdfRef.current.click()); } }, '📄 PDF-ek')))),

      view === 'pdfs' ? h('div', { className: 'cm-pdfs' },
        h('div', { className: 'cm-pdf' }, h('div', { className: 'cm-pdf-h' }, 'v2 — beküldött'), pdfs.v2 ? h('iframe', { src: pdfs.v2, title: 'v2' }) : h('div', { className: 'cm-pdf-empty' }, 'Tölts be egy v2 PDF-et.')),
        h('div', { className: 'cm-pdf' }, h('div', { className: 'cm-pdf-h' }, 'v3 — revideált'), pdfs.v3 ? h('iframe', { src: pdfs.v3, title: 'v3' }) : h('div', { className: 'cm-pdf-empty' }, 'Tölts be egy v3 PDF-et.')))
      : h('div', { className: 'cm-body' },
        // left: filter + change list
        h('div', { className: 'cm-side' },
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
          }))),
        // main: the selected change
        sel ? h('div', { className: 'cm-main' },
          h('div', { className: 'cm-ch-head' },
            h('span', { className: 'cm-cat', style: { background: (CAT[sel.category] || {}).c } }, (CAT[sel.category] || {}).t || sel.category),
            h('span', { className: 'cm-op', style: { color: (OP[sel.op] || {}).c, fontSize: 13 } }, (OP[sel.op] || {}).t),
            h('span', { style: { fontSize: 13, color: 'var(--muted)' } }, sel.section),
            sel.confidence ? h('span', { className: 'cm-conf', title: 'megbízhatóság' }, sel.confidence) : null),
          h('h3', { style: { margin: '4px 0 10px' } }, sel.change_summary),
          // diff
          h('div', { className: 'cm-diff' },
            sel.op === 'insert' ? h('span', { className: 'd-add' }, (sel.final && sel.final.text) || '')
              : sel.op === 'delete' ? h('span', { className: 'd-del' }, (sel.original && sel.original.text) || '')
                : diffWords((sel.original && sel.original.text) || '', (sel.final && sel.final.text) || '').map(function (p, i) {
                  return h('span', { key: i, className: p.added ? 'd-add' : p.removed ? 'd-del' : '' }, p.value);
                })),
          // why
          h('div', { className: 'cm-why' },
            h('div', { className: 'cm-why-h' }, '💬 Miért változott?'),
            (sel.review_points || []).map(function (id) {
              var r = rp[id];
              return h('div', { key: id, className: 'cm-rp' }, h('b', null, id + (r ? ' · ' + r.reviewer : '')), r ? h('div', { className: 'cm-rp-c' }, '„' + r.comment + '"') : null);
            }),
            sel.reason ? h('div', { className: 'cm-reason' }, h('b', null, 'Indok: '), sel.reason) : null))
        : h('div', { className: 'cm-main' }, h('div', { style: { color: 'var(--muted)' } }, 'Nincs változás ehhez a szűrőhöz.'))));
  }

  var root = document.getElementById('root');
  if (root && window.React && window.ReactDOM) ReactDOM.createRoot(root).render(h(App));
})();
