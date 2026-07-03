/* Publify — "Érkeztető" (scientific publication intake), Phase 1.
 * Fixed single-office workflow: draft → submitted → screening → under_review → … (migration-42).
 * Author: submission wizard + My Submissions (coarse status vocabulary, timeline, versions, letters).
 * Editor: pipeline queue + triage drawer (desk-check checklist → desk-reject / return / pass to review)
 * with templated letters. Single-blind: reviewer identity never rendered for authors. */
(function () {
  'use strict';
  var h = React.createElement;
  var useState = React.useState, useEffect = React.useEffect, useRef = React.useRef;
  var BE = window.PR_BACKEND;
  var sb = BE && BE.sb;

  var ST_AUTHOR = { draft: 'Piszkozat', submitted: 'Beérkezett', screening: 'Szerkesztőnél', under_review: 'Bírálat alatt', decision_pending: 'Döntés folyamatban', revision_requested: 'Revízió szükséges', accepted: 'Elfogadva', camera_ready: 'Camera-ready', published: 'Publikálva', rejected: 'Elutasítva', withdrawn: 'Visszavonva' };
  var ST_CHIP = { draft: 'c-grey', submitted: 'c-acc', screening: 'c-warn', under_review: 'c-warn', decision_pending: 'c-warn', revision_requested: 'c-warn', accepted: 'c-ok', camera_ready: 'c-ok', published: 'c-ok', rejected: 'c-danger', withdrawn: 'c-grey' };
  var ED_TABS = [['submitted', 'Beérkezett'], ['screening', 'Szűrés'], ['under_review', 'Bírálat'], ['decision_pending', 'Döntés'], ['revision_requested', 'Revízió'], ['accepted', 'Elfogadva'], ['all', 'Mind']];
  var TYPES = ['article', 'review', 'short communication', 'case study', 'conference paper'];
  // author-visible timeline events (no actor names, no reviewer identities — single-blind)
  var EV_LABEL = { submitted: 'Beadva', screening_started: 'Érkeztetés / szűrés megkezdve', desk_reject: 'Szerkesztői elutasítás', return_corrections: 'Javításra visszaküldve', sent_to_review: 'Bírálatra továbbítva', letter_sent: 'Levél a szerzőnek', withdrawn: 'Visszavonva', resubmitted: 'Újra beadva' };

  function fmtD(s) { return s ? String(s).slice(0, 10) : ''; }
  function logEvent(sid, actor, event, from, to, detail) {
    return sb.from('submission_events').insert({ submission_id: sid, actor_id: actor, event: event, from_status: from || null, to_status: to || null, detail: detail || {} });
  }
  function subst(t, vars) { return String(t || '').replace(/\{(\w+)\}/g, function (_, k) { return vars[k] != null ? vars[k] : '{' + k + '}'; }); }

  // ---------------- Author: submission wizard ----------------
  function Wizard(props) {
    var tS = useState(''), title = tS[0], setTitle = tS[1];
    var aS = useState(''), abs = aS[0], setAbs = aS[1];
    var kS = useState(''), kw = kS[0], setKw = kS[1];
    var tyS = useState('article'), typ = tyS[0], setTyp = tyS[1];
    var vqS = useState(''), vq = vqS[0], setVq = vqS[1];
    var vrS = useState([]), vres = vrS[0], setVres = vrS[1];
    var vselS = useState(null), vsel = vselS[0], setVsel = vselS[1];
    var auS = useState([{ name: props.me.name || '', email: props.me.email || '', affiliation: '', orcid: '', is_corresponding: true }]), authors = auS[0], setAuthors = auS[1];
    var clS = useState(''), cover = clS[0], setCover = clS[1];
    var dS = useState({ original: false, approved: false, noconflict: false }), decl = dS[0], setDecl = dS[1];
    var fS = useState(null), file = fS[0], setFile = fS[1];
    var bS = useState(''), busy = bS[0], setBusy = bS[1];
    var fileRef = useRef(null);
    useEffect(function () {
      if (!vq.trim() || vq.trim().length < 3) { setVres([]); return; }
      var t = setTimeout(function () {
        sb.from('journals_ref').select('id,title,field,npi_level').ilike('title', '%' + vq.trim() + '%').gte('npi_level', 1).order('npi_level', { ascending: false }).limit(8).then(function (r) { setVres((r && r.data) || []); });
      }, 350);
      return function () { clearTimeout(t); };
    }, [vq]);
    function setAu(i, k, v) { setAuthors(function (a) { return a.map(function (x, j) { if (j !== i) return x; var n = Object.assign({}, x); n[k] = v; return n; }); }); }
    function addAu() { setAuthors(function (a) { return a.concat([{ name: '', email: '', affiliation: '', orcid: '', is_corresponding: false }]); }); }
    function rmAu(i) { setAuthors(function (a) { return a.filter(function (_, j) { return j !== i; }); }); }
    var ready = title.trim() && abs.trim() && file && decl.original && decl.approved && decl.noconflict && authors.filter(function (a) { return a.name.trim(); }).length;
    function submit() {
      if (!ready || busy) return;
      setBusy('Kézirat rögzítése…');
      var row = { owner_id: props.me.id, title: title.trim(), abstract: abs.trim(), keywords: kw.split(',').map(function (x) { return x.trim(); }).filter(Boolean), article_type: typ, journal_ref_id: vsel ? vsel.id : null, venue_text: vsel ? vsel.title : (vq.trim() || null), declarations: decl, cover_letter: cover.trim() || null, status: 'draft' };
      sb.from('submissions').insert(row).select().then(function (r) {
        if (r && r.error) { setBusy(''); window.PRUI.toast(r.error.message, { kind: 'error' }); return; }
        var s = r.data[0];
        var aRows = authors.filter(function (a) { return a.name.trim(); }).map(function (a, i) { return { submission_id: s.id, position: i + 1, name: a.name.trim(), email: a.email.trim() || null, affiliation: a.affiliation.trim() || null, orcid: a.orcid.trim() || null, user_id: (a.email.trim().toLowerCase() === (props.me.email || '').toLowerCase()) ? props.me.id : null, is_corresponding: !!a.is_corresponding }; });
        sb.from('submission_authors').insert(aRows).then(function () {
          setBusy('PDF feltöltése…');
          var sp = s.id + '/0/' + file.name.replace(/[^A-Za-z0-9._-]/g, '_');
          sb.storage.from('submission-files').upload(sp, file).then(function (up) {
            if (up && up.error) { setBusy(''); window.PRUI.toast('Feltöltési hiba: ' + up.error.message, { kind: 'error' }); return; }
            sb.from('submission_versions').insert({ submission_id: s.id, round: 0, kind: 'manuscript', storage_path: sp, file_name: file.name, size: file.size, uploaded_by: props.me.id }).then(function () {
              sb.from('submissions').update({ status: 'submitted', submitted_at: new Date().toISOString() }).eq('id', s.id).then(function () {
                logEvent(s.id, props.me.id, 'submitted', 'draft', 'submitted', { file: file.name }).then(function () {
                  setBusy(''); window.PRUI.toast('Beadva — azonosító: ' + s.manuscript_code, { kind: 'ok' }); props.onDone();
                });
              });
            });
          });
        });
      });
    }
    return h('div', { className: 'panel' },
      h('h3', { style: { marginTop: 0 } }, '📤 Új kézirat beadása'),
      h('div', { className: 'field-label' }, 'Cím *'),
      h('input', { className: 'field', style: { width: '100%', boxSizing: 'border-box' }, value: title, onChange: function (e) { setTitle(e.target.value); } }),
      h('div', { className: 'field-label', style: { marginTop: 10 } }, 'Absztrakt *'),
      h('textarea', { className: 'field', rows: 5, style: { width: '100%', boxSizing: 'border-box' }, value: abs, onChange: function (e) { setAbs(e.target.value); } }),
      h('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 } },
        h('div', { style: { flex: 2, minWidth: 220 } },
          h('div', { className: 'field-label' }, 'Kulcsszavak (vesszővel)'),
          h('input', { className: 'field', style: { width: '100%', boxSizing: 'border-box' }, value: kw, onChange: function (e) { setKw(e.target.value); } })),
        h('div', { style: { flex: 1, minWidth: 160 } },
          h('div', { className: 'field-label' }, 'Típus'),
          h('select', { className: 'field', style: { width: '100%' }, value: typ, onChange: function (e) { setTyp(e.target.value); } }, TYPES.map(function (t) { return h('option', { key: t, value: t }, t); })))),
      h('div', { className: 'field-label', style: { marginTop: 10 } }, 'Cél-folyóirat / venue (opcionális)'),
      vsel ? h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
        h('span', { className: 'chip c-acc' }, vsel.title + (vsel.npi_level ? ' · L' + vsel.npi_level : '')),
        h('button', { className: 'btn', style: { padding: '2px 8px', fontSize: 11 }, onClick: function () { setVsel(null); } }, '×'))
        : h('div', null,
          h('input', { className: 'field', style: { width: '100%', boxSizing: 'border-box' }, placeholder: 'Keresés a folyóirat-regiszterben…', value: vq, onChange: function (e) { setVq(e.target.value); } }),
          vres.length ? h('div', { style: { border: '1px solid var(--line)', borderRadius: 8, marginTop: 4, overflow: 'hidden' } }, vres.map(function (j) {
            return h('button', { key: j.id, style: { display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px', border: 0, borderBottom: '1px solid var(--soft)', background: 'var(--surface)', cursor: 'pointer', fontSize: 12.5 }, onClick: function () { setVsel(j); setVres([]); } }, j.title, h('span', { style: { color: 'var(--faint)', fontSize: 11 } }, '  · ' + (j.field || '') + ' · L' + j.npi_level));
          })) : null),
      h('div', { className: 'field-label', style: { marginTop: 12 } }, 'Szerzők * (sorrendben)'),
      authors.map(function (a, i) {
        return h('div', { key: i, style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6, alignItems: 'center', background: 'var(--soft)', padding: '6px 8px', borderRadius: 8 } },
          h('span', { style: { fontSize: 11, color: 'var(--faint)', width: 14 } }, (i + 1) + '.'),
          h('input', { className: 'field', style: { flex: 2, minWidth: 140 }, placeholder: 'Név *', value: a.name, onChange: function (e) { setAu(i, 'name', e.target.value); } }),
          h('input', { className: 'field', style: { flex: 2, minWidth: 150 }, placeholder: 'Email', value: a.email, onChange: function (e) { setAu(i, 'email', e.target.value); } }),
          h('input', { className: 'field', style: { flex: 2, minWidth: 140 }, placeholder: 'Affiliáció', value: a.affiliation, onChange: function (e) { setAu(i, 'affiliation', e.target.value); } }),
          h('input', { className: 'field', style: { flex: 1, minWidth: 110 }, placeholder: 'ORCID', value: a.orcid, onChange: function (e) { setAu(i, 'orcid', e.target.value); } }),
          h('label', { style: { fontSize: 11, display: 'flex', gap: 4, alignItems: 'center', whiteSpace: 'nowrap' } }, h('input', { type: 'checkbox', checked: !!a.is_corresponding, onChange: function (e) { setAu(i, 'is_corresponding', e.target.checked); } }), 'levelező'),
          authors.length > 1 ? h('button', { className: 'fb-mini', onClick: function () { rmAu(i); } }, '×') : null);
      }),
      h('button', { className: 'btn', style: { padding: '3px 10px', fontSize: 12 }, onClick: addAu }, '+ szerző'),
      h('div', { className: 'field-label', style: { marginTop: 12 } }, 'Kézirat PDF *'),
      h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
        h('button', { className: 'btn', onClick: function () { if (fileRef.current) fileRef.current.click(); } }, file ? '↻ Csere' : '⤒ PDF kiválasztása'),
        file ? h('span', { style: { fontSize: 12.5 } }, '📄 ' + file.name + ' (' + Math.round(file.size / 1024) + ' KB)') : null,
        h('input', { ref: fileRef, type: 'file', accept: '.pdf', style: { display: 'none' }, onChange: function (e) { setFile(e.target.files && e.target.files[0]); e.target.value = ''; } })),
      h('div', { className: 'field-label', style: { marginTop: 12 } }, 'Kísérőlevél (opcionális)'),
      h('textarea', { className: 'field', rows: 3, style: { width: '100%', boxSizing: 'border-box' }, value: cover, onChange: function (e) { setCover(e.target.value); } }),
      h('div', { style: { marginTop: 12, display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12.5 } },
        h('label', null, h('input', { type: 'checkbox', checked: decl.original, onChange: function (e) { setDecl(Object.assign({}, decl, { original: e.target.checked })); } }), ' A kézirat eredeti, máshol nem áll elbírálás alatt. *'),
        h('label', null, h('input', { type: 'checkbox', checked: decl.approved, onChange: function (e) { setDecl(Object.assign({}, decl, { approved: e.target.checked })); } }), ' Minden szerző jóváhagyta a beadást. *'),
        h('label', null, h('input', { type: 'checkbox', checked: decl.noconflict, onChange: function (e) { setDecl(Object.assign({}, decl, { noconflict: e.target.checked })); } }), ' Összeférhetetlenség nincs / a kísérőlevélben jelezve. *')),
      h('div', { style: { display: 'flex', gap: 10, marginTop: 14, alignItems: 'center' } },
        h('button', { className: 'btn pri', disabled: !ready || !!busy, onClick: submit }, busy ? '⏳ ' + busy : '📤 Beadás'),
        h('button', { className: 'btn', disabled: !!busy, onClick: props.onCancel }, 'Mégse'),
        !ready ? h('span', { style: { fontSize: 11.5, color: 'var(--faint)' } }, 'A *-os mezők és a nyilatkozatok kötelezők.') : null));
  }

  // ---------------- shared: submission detail (author + editor) ----------------
  function Detail(props) {
    var s = props.sub; var me = props.me; var isEd = props.isEditor;
    var dS = useState({ authors: [], versions: [], events: [], letters: [], loading: true }), d = dS[0], setD = dS[1];
    var ckS = useState({}), chk = ckS[0], setChk = ckS[1];        // desk-check checklist (editor, local)
    var ltS = useState(null), letter = ltS[0], setLetter = ltS[1]; // { key, subject, body, to_status, event }
    var bzS = useState(false), busy = bzS[0], setBusy = bzS[1];
    function load() {
      Promise.all([
        sb.from('submission_authors').select('*').eq('submission_id', s.id).order('position'),
        sb.from('submission_versions').select('*').eq('submission_id', s.id).order('created_at'),
        sb.from('submission_events').select('*').eq('submission_id', s.id).order('created_at'),
        sb.from('submission_letters').select('*').eq('submission_id', s.id).order('sent_at')
      ]).then(function (r) {
        setD({ authors: (r[0] && r[0].data) || [], versions: (r[1] && r[1].data) || [], events: (r[2] && r[2].data) || [], letters: (r[3] && r[3].data) || [], loading: false });
      });
    }
    useEffect(load, [s.id]);
    function dl(v) { sb.storage.from('submission-files').createSignedUrl(v.storage_path, 3600, { download: v.file_name }).then(function (r) { if (r && r.data && r.data.signedUrl) window.open(r.data.signedUrl, '_blank'); }); }
    function setStatus(to, event, detail, then) {
      setBusy(true);
      var patch = { status: to };
      if (to === 'screening' && !s.handling_editor_id) patch.handling_editor_id = me.id;
      sb.from('submissions').update(patch).eq('id', s.id).then(function (r) {
        if (r && r.error) { setBusy(false); window.PRUI.toast(r.error.message, { kind: 'error' }); return; }
        logEvent(s.id, me.id, event, s.status, to, detail || {}).then(function () { setBusy(false); if (then) then(); props.onChanged(); });
      });
    }
    function openLetter(key, to_status, event) {
      var corr = d.authors.filter(function (a) { return a.is_corresponding; })[0] || d.authors[0] || {};
      sb.from('letter_templates').select('*').eq('key', key).maybeSingle().then(function (r) {
        var t = (r && r.data) || { subject: '', body: '' };
        var vars = { authorName: corr.name || '', manuscriptId: s.manuscript_code || '', title: s.title, reason: '[indoklás]', reviews: '', dueDate: '' };
        setLetter({ key: key, subject: subst(t.subject, vars), body: subst(t.body, vars), to_status: to_status, event: event });
      });
    }
    function sendLetter() {
      if (!letter) return; setBusy(true);
      sb.from('submission_letters').insert({ submission_id: s.id, template_key: letter.key, subject: letter.subject, body: letter.body, recipient_user_id: s.owner_id, sent_by: me.id }).then(function () {
        var fin = function () { setLetter(null); setBusy(false); load(); props.onChanged(); window.PRUI.toast('Levél elküldve + naplózva', { kind: 'ok' }); };
        if (letter.to_status) {
          sb.from('submissions').update({ status: letter.to_status, decided_at: (letter.to_status === 'rejected' ? new Date().toISOString() : null) }).eq('id', s.id).then(function () {
            logEvent(s.id, me.id, letter.event || 'letter_sent', s.status, letter.to_status, { template: letter.key }).then(fin);
          });
        } else { logEvent(s.id, me.id, 'letter_sent', null, null, { template: letter.key }).then(fin); }
      });
    }
    function withdraw() {
      window.PRUI.confirm({ title: 'Kézirat visszavonása?', body: s.title, danger: true, confirmLabel: 'Visszavonás' }).then(function (ok) {
        if (ok) setStatus('withdrawn', 'withdrawn');
      });
    }
    var CHECKS = [['complete', 'Teljes beadás (PDF, absztrakt, szerzők, nyilatkozatok)'], ['scope', 'Tématerületi illeszkedés (scope) rendben'], ['format', 'Formai követelmények rendben'], ['ethics', 'Nyilatkozatok / etikai feltételek rendben'], ['plag', 'Nincs nyilvánvaló átfedés / plágiumgyanú']];
    var evShown = d.events.filter(function (e) { return isEd || EV_LABEL[e.event]; });
    return h('div', { className: 'panel' },
      h('div', { style: { display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' } },
        h('button', { className: 'btn', style: { padding: '3px 10px', fontSize: 12, flex: 'none' }, onClick: props.onBack }, '←'),
        h('b', { style: { fontSize: 15, flex: 1, minWidth: 200 } }, s.title),
        h('span', { className: 'chip ' + (ST_CHIP[s.status] || 'c-grey') }, isEd ? s.status : (ST_AUTHOR[s.status] || s.status)),
        h('span', { style: { fontSize: 11.5, color: 'var(--faint)' } }, s.manuscript_code)),
      h('div', { style: { fontSize: 12, color: 'var(--muted)', marginTop: 4 } }, (s.article_type || 'article') + (s.venue_text ? ' · cél: ' + s.venue_text : '') + ' · beadva: ' + (fmtD(s.submitted_at) || '—')),
      s.abstract ? h('details', { style: { marginTop: 8 } }, h('summary', { style: { fontSize: 12, cursor: 'pointer', color: 'var(--muted)' } }, 'Absztrakt'), h('div', { style: { fontSize: 12.5, lineHeight: 1.5, marginTop: 4 } }, s.abstract)) : null,
      d.loading ? h('div', { className: 'empty' }, 'Betöltés…') : h('div', null,
        h('div', { className: 'field-label', style: { marginTop: 12 } }, 'Szerzők'),
        h('div', { style: { fontSize: 12.5 } }, d.authors.map(function (a) { return a.name + (a.is_corresponding ? ' ✉' : ''); }).join(' · ') || '—'),
        h('div', { className: 'field-label', style: { marginTop: 12 } }, 'Fájlok / verziók'),
        d.versions.length ? d.versions.map(function (v) {
          return h('div', { key: v.id, style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, padding: '3px 0' } },
            h('span', { className: 'chip c-grey', style: { fontSize: 10 } }, 'R' + v.round + ' · ' + v.kind),
            h('span', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, v.file_name),
            h('span', { style: { color: 'var(--faint)', fontSize: 11 } }, fmtD(v.created_at)),
            h('button', { className: 'btn', style: { padding: '2px 9px', fontSize: 11 }, onClick: function () { dl(v); } }, '⬇'));
        }) : h('div', { style: { fontSize: 12, color: 'var(--faint)' } }, 'Nincs fájl.'),
        h('div', { className: 'field-label', style: { marginTop: 12 } }, 'Idővonal'),
        evShown.length ? h('div', { style: { fontSize: 12, color: 'var(--muted)' } }, evShown.map(function (e) {
          return h('div', { key: e.id, style: { padding: '2px 0' } }, '• ', fmtD(e.created_at), ' — ', (EV_LABEL[e.event] || e.event) + (isEd && e.to_status ? ' → ' + e.to_status : ''));
        })) : h('div', { style: { fontSize: 12, color: 'var(--faint)' } }, 'Még nincs esemény.'),
        d.letters.length ? h('div', null,
          h('div', { className: 'field-label', style: { marginTop: 12 } }, 'Levelek'),
          d.letters.map(function (l) {
            return h('details', { key: l.id, style: { marginBottom: 4 } },
              h('summary', { style: { fontSize: 12.5, cursor: 'pointer' } }, '✉ ' + fmtD(l.sent_at) + ' — ' + l.subject),
              h('pre', { style: { fontSize: 12, whiteSpace: 'pre-wrap', background: 'var(--soft)', padding: '8px 10px', borderRadius: 8, lineHeight: 1.5 } }, l.body));
          })) : null,
        // ---- author actions ----
        (!isEd && s.owner_id === me.id && ['submitted', 'screening', 'under_review', 'decision_pending'].indexOf(s.status) >= 0)
          ? h('div', { style: { marginTop: 14 } }, h('button', { className: 'btn', style: { color: 'var(--danger)' }, disabled: busy, onClick: withdraw }, 'Kézirat visszavonása')) : null,
        // ---- editor triage (desk-check) ----
        (isEd && (s.status === 'submitted' || s.status === 'screening')) ? h('div', { style: { marginTop: 16, borderTop: '1px solid var(--line)', paddingTop: 12 } },
          h('b', { style: { fontSize: 13 } }, '🗂 Érkeztetés / desk-check'),
          s.status === 'submitted' ? h('div', { style: { marginTop: 8 } },
            h('button', { className: 'btn pri', disabled: busy, onClick: function () { setStatus('screening', 'screening_started'); } }, '▶ Szűrés megkezdése (átveszem)')) : h('div', null,
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: 5, margin: '8px 0', fontSize: 12.5 } }, CHECKS.map(function (c) {
              return h('label', { key: c[0] }, h('input', { type: 'checkbox', checked: !!chk[c[0]], onChange: function (e) { var n = Object.assign({}, chk); n[c[0]] = e.target.checked; setChk(n); } }), ' ' + c[1]);
            })),
            h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
              h('button', { className: 'btn pri', disabled: busy || !CHECKS.every(function (c) { return chk[c[0]]; }), title: CHECKS.every(function (c) { return chk[c[0]]; }) ? 'Bírálatra továbbítás' : 'Előbb pipáld ki a checklistet', onClick: function () { setStatus('under_review', 'sent_to_review', { checklist: chk }); } }, '✓ Bírálatra tovább'),
              h('button', { className: 'btn', disabled: busy, onClick: function () { openLetter('return_corrections', 'draft', 'return_corrections'); } }, '↩ Javításra vissza'),
              h('button', { className: 'btn', style: { color: 'var(--danger)' }, disabled: busy, onClick: function () { openLetter('desk_reject', 'rejected', 'desk_reject'); } }, '✗ Desk-reject'))) ) : null,
        (isEd && s.status !== 'submitted' && s.status !== 'screening') ? h('div', { style: { marginTop: 14, fontSize: 12, color: 'var(--faint)' } }, 'A bírálati kör, a döntésrögzítés és a camera-ready lépések a 2. fázisban érkeznek.') : null,
        (isEd) ? h('div', { style: { marginTop: 8 } }, h('button', { className: 'btn', style: { padding: '3px 10px', fontSize: 12 }, disabled: busy, onClick: function () { openLetter('ack_received', null, null); } }, '✉ Visszaigazoló levél küldése')) : null),
      // ---- letter composer ----
      letter ? h('div', { style: { marginTop: 14, border: '1.5px solid var(--accent)', borderRadius: 10, padding: 12, background: 'var(--accent-tint)' } },
        h('b', { style: { fontSize: 13 } }, '✉ Levél (' + letter.key + ')' + (letter.to_status ? ' → státusz: ' + letter.to_status : '')),
        h('input', { className: 'field', style: { width: '100%', boxSizing: 'border-box', marginTop: 8 }, value: letter.subject, onChange: function (e) { setLetter(Object.assign({}, letter, { subject: e.target.value })); } }),
        h('textarea', { className: 'field', rows: 9, style: { width: '100%', boxSizing: 'border-box', marginTop: 6, fontSize: 12.5, lineHeight: 1.5 }, value: letter.body, onChange: function (e) { setLetter(Object.assign({}, letter, { body: e.target.value })); } }),
        h('div', { style: { display: 'flex', gap: 8, marginTop: 8 } },
          h('button', { className: 'btn pri', disabled: busy, onClick: sendLetter }, 'Küldés + naplózás'),
          h('button', { className: 'btn', disabled: busy, onClick: function () { setLetter(null); } }, 'Mégse'))) : null);
  }

  // ---------------- App ----------------
  function App() {
    var phS = useState('loading'), phase = phS[0], setPhase = phS[1];
    var meS = useState(null), me = meS[0], setMe = meS[1];
    var edS = useState(false), isEditor = edS[0], setIsEditor = edS[1];
    var lsS = useState([]), subs = lsS[0], setSubs = lsS[1];
    var vS = useState('list'), view = vS[0], setView = vS[1];      // list | wizard | detail
    var selS = useState(null), sel = selS[0], setSel = selS[1];
    var tabS = useState('submitted'), tab = tabS[0], setTab = tabS[1];
    var modeS = useState('author'), mode = modeS[0], setMode = modeS[1];  // author | editor
    useEffect(function () { boot(); }, []);
    function boot() {
      if (!BE || !sb) { setPhase('nobackend'); return; }
      if (BE.mode !== 'cloud' || !BE.user) { setPhase('signin'); return; }
      Promise.all([
        sb.from('profiles').select('name,email,role').eq('id', BE.user.id).maybeSingle(),
        sb.from('editorial_staff').select('staff_role,active').eq('user_id', BE.user.id).maybeSingle()
      ]).then(function (r) {
        var p = (r[0] && r[0].data) || {};
        var ed = !!(r[1] && r[1].data && r[1].data.active);
        setMe({ id: BE.user.id, name: p.name || BE.user.name, email: p.email || BE.user.email, role: p.role });
        setIsEditor(ed); if (ed) setMode('editor');
        setPhase('ready'); load();
      }, function () { setPhase('signin'); });
    }
    function load() {
      sb.from('submissions').select('*').order('updated_at', { ascending: false }).then(function (r) { setSubs((r && r.data) || []); });
    }
    if (phase === 'loading') return h('div', { className: 'center' }, h('div', { className: 'box' }, h('div', { className: 'mk' }, h('span')), h('h1', null, 'Érkeztető'), h('p', null, 'Betöltés…')));
    if (phase !== 'ready') return h('div', { className: 'center' }, h('div', { className: 'box' }, h('div', { className: 'mk' }, h('span')), h('h1', null, 'Érkeztető'), h('p', null, 'Jelentkezz be a Publify-ba a használathoz.'), h('a', { className: 'btn pri', href: 'Landing.html', style: { textDecoration: 'none' } }, 'Bejelentkezés')));

    var mine = subs.filter(function (s) { return s.owner_id === me.id; });
    var queue = subs.filter(function (s) { return tab === 'all' ? true : s.status === tab; });
    var counts = {}; subs.forEach(function (s) { counts[s.status] = (counts[s.status] || 0) + 1; });

    var body;
    if (view === 'wizard') body = h(Wizard, { me: me, onDone: function () { setView('list'); load(); }, onCancel: function () { setView('list'); } });
    else if (view === 'detail' && sel) body = h(Detail, { sub: sel, me: me, isEditor: isEditor && mode === 'editor', onBack: function () { setView('list'); setSel(null); }, onChanged: function () { load(); sb.from('submissions').select('*').eq('id', sel.id).maybeSingle().then(function (r) { if (r && r.data) setSel(r.data); }); } });
    else if (mode === 'editor' && isEditor) {
      body = h('div', null,
        h('div', { className: 'segctl' }, ED_TABS.map(function (t) {
          var n = t[0] === 'all' ? subs.length : (counts[t[0]] || 0);
          return h('button', { key: t[0], className: tab === t[0] ? 'on' : '', onClick: function () { setTab(t[0]); } }, t[1] + (n ? ' (' + n + ')' : ''));
        })),
        h('div', { className: 'panel' },
          queue.length ? queue.map(function (s) {
            return h('div', { key: s.id, style: { display: 'flex', gap: 10, alignItems: 'baseline', padding: '9px 0', borderBottom: '1px solid var(--soft)', cursor: 'pointer' }, onClick: function () { setSel(s); setView('detail'); } },
              h('span', { style: { fontSize: 11, color: 'var(--faint)', flex: 'none', width: 100 } }, s.manuscript_code),
              h('b', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13.5 } }, s.title),
              h('span', { className: 'chip ' + (ST_CHIP[s.status] || 'c-grey'), style: { fontSize: 10.5, flex: 'none' } }, s.status),
              h('span', { style: { fontSize: 11, color: 'var(--faint)', flex: 'none' } }, fmtD(s.submitted_at || s.created_at)));
          }) : h('div', { className: 'empty' }, 'Nincs kézirat ebben az állapotban.')));
    } else {
      body = h('div', null,
        h('div', { className: 'panel' },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
            h('h3', { style: { margin: 0, flex: 1 } }, '📄 Saját kézirataim (' + mine.length + ')'),
            h('button', { className: 'btn pri', onClick: function () { setView('wizard'); } }, '📤 Új beadás')),
          mine.length ? mine.map(function (s) {
            return h('div', { key: s.id, style: { display: 'flex', gap: 10, alignItems: 'baseline', padding: '9px 0', borderBottom: '1px solid var(--soft)', cursor: 'pointer' }, onClick: function () { setSel(s); setView('detail'); } },
              h('span', { style: { fontSize: 11, color: 'var(--faint)', flex: 'none', width: 100 } }, s.manuscript_code || '—'),
              h('b', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13.5 } }, s.title),
              h('span', { className: 'chip ' + (ST_CHIP[s.status] || 'c-grey'), style: { fontSize: 10.5, flex: 'none' } }, ST_AUTHOR[s.status] || s.status),
              h('span', { style: { fontSize: 11, color: 'var(--faint)', flex: 'none' } }, fmtD(s.submitted_at || s.created_at)));
          }) : h('div', { className: 'empty' }, 'Még nincs beadott kéziratod. Kattints az „Új beadás”-ra.')));
    }

    return h('div', { className: 'app' },
      h('div', { className: 'side' },
        h('div', { className: 'side-brand' }, h('div', { className: 'mk' }, h('span')), h('div', null, h('b', null, 'Publify'), h('i', null, 'Érkeztető'))),
        h('nav', { className: 'nav' },
          h('button', { className: mode === 'author' && view !== 'wizard' ? 'on' : '', onClick: function () { setMode('author'); setView('list'); setSel(null); } }, h('span', null, '📄 Kézirataim')),
          isEditor ? h('button', { className: mode === 'editor' ? 'on' : '', onClick: function () { setMode('editor'); setView('list'); setSel(null); } }, h('span', null, '🗂 Szerkesztőség')) : null),
        h('div', { className: 'side-foot' },
          h('div', { className: 'who' }, h('b', null, me.name), h('span', null, isEditor ? 'editor' : 'szerző')),
          h('a', { className: 'exit', href: 'Profile.html', title: 'Vissza a Publify-ba' }, '←'))),
      h('div', { className: 'main' },
        h('div', { className: 'head' },
          h('div', null, h('h1', null, 'Érkeztető'), h('div', { className: 'sub' }, mode === 'editor' ? 'Szerkesztőségi munkafolyamat — beérkezéstől a döntésig' : 'Tudományos kéziratok beadása és követése'))),
        body));
  }

  ReactDOM.createRoot(document.getElementById('root')).render(h(App));
})();
