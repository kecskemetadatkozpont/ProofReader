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
  var ED_TABS = [['submitted', 'Beérkezett'], ['screening', 'Szűrés'], ['under_review', 'Bírálat'], ['decision_pending', 'Döntés'], ['revision_requested', 'Revízió'], ['accepted', 'Elfogadva'], ['camera_ready', 'Camera-ready'], ['all', 'Mind']];
  var TYPES = ['article', 'review', 'short communication', 'case study', 'conference paper'];
  // author-visible timeline events (no actor names, no reviewer identities — single-blind)
  var EV_LABEL = { submitted: 'Beadva', screening_started: 'Érkeztetés / szűrés megkezdve', desk_reject: 'Szerkesztői elutasítás', return_corrections: 'Javításra visszaküldve', sent_to_review: 'Bírálatra továbbítva', letter_sent: 'Levél a szerzőnek', withdrawn: 'Visszavonva', resubmitted: 'Javított változat beadva', decision: 'Szerkesztői döntés', camera_ready_started: 'Camera-ready fázis megnyitva', camera_ready_uploaded: 'Végleges változat feltöltve', published: 'Publikálva / lezárva' };
  var REC_LABEL = { accept: 'elfogadás', minor: 'kisebb revízió', major: 'nagyobb revízió', reject: 'elutasítás' };

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
    var dS = useState({ authors: [], versions: [], events: [], letters: [], reviews: [], loading: true }), d = dS[0], setD = dS[1];
    var ckS = useState({}), chk = ckS[0], setChk = ckS[1];        // desk-check checklist (editor, local)
    var ltS = useState(null), letter = ltS[0], setLetter = ltS[1]; // { key, subject, body, to_status, event, detail }
    var bzS = useState(false), busy = bzS[0], setBusy = bzS[1];
    var rqS = useState(''), rq = rqS[0], setRq = rqS[1];           // reviewer search query (editor)
    var rrS = useState([]), rres = rrS[0], setRres = rrS[1];
    var rvfS = useState(null), revF = rvfS[0], setRevF = rvfS[1];  // author: revised manuscript file
    var rspS = useState(null), respF = rspS[0], setRespF = rspS[1];// author: response-to-reviewers file
    var crfS = useState(null), crF = crfS[0], setCrF = crfS[1];    // author: camera-ready file
    var revRef = useRef(null), respRef = useRef(null), crRef = useRef(null);
    function load() {
      Promise.all([
        sb.from('submission_authors').select('*').eq('submission_id', s.id).order('position'),
        sb.from('submission_versions').select('*').eq('submission_id', s.id).order('created_at'),
        sb.from('submission_events').select('*').eq('submission_id', s.id).order('created_at'),
        sb.from('submission_letters').select('*').eq('submission_id', s.id).order('sent_at'),
        sb.from('submission_reviews').select('*').eq('submission_id', s.id).order('created_at')   // RLS: [] for authors
      ]).then(function (r) {
        setD({ authors: (r[0] && r[0].data) || [], versions: (r[1] && r[1].data) || [], events: (r[2] && r[2].data) || [], letters: (r[3] && r[3].data) || [], reviews: (r[4] && r[4].data) || [], loading: false });
      });
    }
    useEffect(function () {
      if (!rq.trim() || rq.trim().length < 2) { setRres([]); return; }
      var t = setTimeout(function () { sb.rpc('pr_search_users', { q: rq.trim() }).then(function (r) { setRres((r && r.data) || []); }); }, 300);
      return function () { clearTimeout(t); };
    }, [rq]);
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
    function openLetter(key, to_status, event, extraVars, detail) {
      var corr = d.authors.filter(function (a) { return a.is_corresponding; })[0] || d.authors[0] || {};
      sb.from('letter_templates').select('*').eq('key', key).maybeSingle().then(function (r) {
        var t = (r && r.data) || { subject: '', body: '' };
        var vars = Object.assign({ authorName: corr.name || '', manuscriptId: s.manuscript_code || '', title: s.title, reason: '[indoklás]', reviews: '', dueDate: '' }, extraVars || {});
        setLetter({ key: key, subject: subst(t.subject, vars), body: subst(t.body, vars), to_status: to_status, event: event, detail: detail || {} });
      });
    }
    function sendLetter() {
      if (!letter) return; setBusy(true);
      sb.from('submission_letters').insert({ submission_id: s.id, template_key: letter.key, subject: letter.subject, body: letter.body, recipient_user_id: s.owner_id, sent_by: me.id }).then(function () {
        var fin = function () { setLetter(null); setBusy(false); load(); props.onChanged(); window.PRUI.toast('Levél elküldve + naplózva', { kind: 'ok' }); };
        if (letter.to_status) {
          var patch = { status: letter.to_status };
          if (letter.to_status === 'rejected' || letter.to_status === 'accepted') patch.decided_at = new Date().toISOString();
          sb.from('submissions').update(patch).eq('id', s.id).then(function () {
            logEvent(s.id, me.id, letter.event || 'letter_sent', s.status, letter.to_status, Object.assign({ template: letter.key }, letter.detail || {})).then(fin);
          });
        } else { logEvent(s.id, me.id, 'letter_sent', null, null, { template: letter.key }).then(fin); }
      });
    }
    // ---- Phase 2: reviewer management + decisions (editor) ----
    var curRound = Math.max(1, s.round || 0);
    var roundReviews = d.reviews.filter(function (r) { return r.round === curRound && r.status !== 'cancelled'; });
    function reviewsText() {
      var done = roundReviews.filter(function (r) { return r.status === 'completed'; });
      return done.map(function (r, i) { return 'Bírálat ' + (i + 1) + ' (ajánlás: ' + (r.recommendation || '—') + '):\n' + (r.comments_author || ''); }).join('\n\n') || '(nincs szöveges bírálat)';
    }
    function invite(u) {
      if (u.id === s.owner_id) { window.PRUI.toast('A levelező szerző nem lehet bíráló.', { kind: 'error' }); return; }
      var due = new Date(Date.now() + 21 * 864e5).toISOString();
      sb.from('submission_reviews').insert({ submission_id: s.id, round: curRound, reviewer_id: u.id, reviewer_name: u.name || null, status: 'invited', due_at: due, invited_by: me.id }).then(function (r) {
        if (r && r.error) { window.PRUI.toast(r.error.message, { kind: 'error' }); return; }
        var after = function () { setRq(''); setRres([]); load(); props.onChanged(); window.PRUI.toast('Bíráló meghívva: ' + (u.name || ''), { kind: 'ok' }); };
        if (!s.round) sb.from('submissions').update({ round: 1 }).eq('id', s.id).then(after); else after();
      });
    }
    function cancelInvite(r) { sb.from('submission_reviews').update({ status: 'cancelled' }).eq('id', r.id).then(load); }
    function decide(kind) {
      var map = { accept: ['decision_accept', 'accepted'], minor: ['decision_minor', 'revision_requested'], major: ['decision_major', 'revision_requested'], reject: ['decision_reject', 'rejected'] };
      var due = new Date(Date.now() + (kind === 'minor' ? 30 : 60) * 864e5).toISOString().slice(0, 10);
      openLetter(map[kind][0], map[kind][1], 'decision', { reviews: reviewsText(), dueDate: due }, { kind: kind });
    }
    // ---- Phase 2: author revision resubmit + camera-ready upload ----
    function resubmit() {
      if (!revF || busy) return; setBusy(true);
      var nr = (s.round || 0) + 1;
      var up = function (f, kind, cb) {
        var sp = s.id + '/' + nr + '/' + f.name.replace(/[^A-Za-z0-9._-]/g, '_');
        sb.storage.from('submission-files').upload(sp, f).then(function (res) {
          if (res && res.error) { setBusy(false); window.PRUI.toast(res.error.message, { kind: 'error' }); return; }
          sb.from('submission_versions').insert({ submission_id: s.id, round: nr, kind: kind, storage_path: sp, file_name: f.name, size: f.size, uploaded_by: me.id }).then(cb);
        });
      };
      up(revF, 'manuscript', function () {
        var fin = function () {
          sb.from('submissions').update({ status: 'under_review', round: nr }).eq('id', s.id).then(function () {
            logEvent(s.id, me.id, 'resubmitted', 'revision_requested', 'under_review', { round: nr }).then(function () {
              setBusy(false); setRevF(null); setRespF(null); window.PRUI.toast('Javított változat beadva (R' + nr + ')', { kind: 'ok' }); props.onChanged(); load();
            });
          });
        };
        if (respF) up(respF, 'response_to_reviewers', fin); else fin();
      });
    }
    function uploadCameraReady() {
      if (!crF || busy) return; setBusy(true);
      var sp = s.id + '/' + (s.round || 0) + '/camera_ready_' + crF.name.replace(/[^A-Za-z0-9._-]/g, '_');
      sb.storage.from('submission-files').upload(sp, crF).then(function (res) {
        if (res && res.error) { setBusy(false); window.PRUI.toast(res.error.message, { kind: 'error' }); return; }
        sb.from('submission_versions').insert({ submission_id: s.id, round: s.round || 0, kind: 'camera_ready', storage_path: sp, file_name: crF.name, size: crF.size, uploaded_by: me.id }).then(function () {
          logEvent(s.id, me.id, 'camera_ready_uploaded', null, null, { file: crF.name }).then(function () {
            setBusy(false); setCrF(null); window.PRUI.toast('Végleges változat feltöltve', { kind: 'ok' }); load();
          });
        });
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
        // ---- editor: reviewer management (round R{n}) ----
        (isEd && (s.status === 'under_review' || s.status === 'decision_pending')) ? h('div', { style: { marginTop: 16, borderTop: '1px solid var(--line)', paddingTop: 12 } },
          h('b', { style: { fontSize: 13 } }, '🔍 Bírálók — R' + curRound + ' kör (' + roundReviews.filter(function (r) { return r.status === 'completed'; }).length + '/' + roundReviews.length + ' kész)'),
          roundReviews.length ? roundReviews.map(function (r) {
            return h('div', { key: r.id, style: { margin: '6px 0', fontSize: 12.5 } },
              h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
                h('b', null, r.reviewer_name || 'Bíráló'),
                h('span', { className: 'chip ' + (r.status === 'completed' ? 'c-ok' : r.status === 'declined' ? 'c-danger' : 'c-acc'), style: { fontSize: 10 } }, r.status),
                r.due_at ? h('span', { style: { fontSize: 11, color: (new Date(r.due_at) < new Date() && r.status !== 'completed') ? 'var(--danger)' : 'var(--faint)' } }, 'határidő: ' + fmtD(r.due_at)) : null,
                r.recommendation ? h('span', { className: 'chip c-warn', style: { fontSize: 10 } }, REC_LABEL[r.recommendation] || r.recommendation) : null,
                (r.status === 'invited' || r.status === 'agreed') ? h('button', { className: 'btn', style: { padding: '1px 8px', fontSize: 10.5 }, onClick: function () { cancelInvite(r); } }, '× visszavonás') : null),
              r.status === 'completed' ? h('details', { style: { marginTop: 2 } },
                h('summary', { style: { fontSize: 11.5, cursor: 'pointer', color: 'var(--muted)' } }, 'Bírálat megnyitása'),
                h('div', { style: { background: 'var(--soft)', borderRadius: 8, padding: '8px 10px', marginTop: 4 } },
                  h('div', { style: { fontSize: 12, whiteSpace: 'pre-wrap', lineHeight: 1.5 } }, h('b', null, 'Szerzőnek: '), r.comments_author || '—'),
                  r.comments_editor ? h('div', { style: { fontSize: 12, whiteSpace: 'pre-wrap', lineHeight: 1.5, marginTop: 6, color: 'var(--warn)' } }, h('b', null, '🔒 Bizalmas (szerkesztőnek): '), r.comments_editor) : null)) : null);
          }) : h('div', { style: { fontSize: 12, color: 'var(--faint)', margin: '6px 0' } }, 'Még nincs meghívott bíráló ebben a körben.'),
          h('div', { style: { position: 'relative', marginTop: 6 } },
            h('input', { className: 'field', style: { width: '100%', boxSizing: 'border-box' }, placeholder: '🔎 Bíráló keresése (név vagy email)…', value: rq, onChange: function (e) { setRq(e.target.value); } }),
            rres.length ? h('div', { style: { border: '1px solid var(--line)', borderRadius: 8, marginTop: 4, overflow: 'hidden', background: 'var(--surface)' } }, rres.map(function (u) {
              var already = roundReviews.some(function (r) { return r.reviewer_id === u.id; });
              return h('button', { key: u.id, disabled: already, style: { display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px', border: 0, borderBottom: '1px solid var(--soft)', background: 'var(--surface)', cursor: already ? 'default' : 'pointer', fontSize: 12.5, opacity: already ? 0.5 : 1 }, onClick: function () { invite(u); } }, u.name || u.id, already ? '  (már meghívva)' : '');
            })) : null),
          (s.status === 'under_review') ? h('div', { style: { marginTop: 8 } },
            h('button', { className: 'btn', disabled: busy, title: 'A kör lezárása — tovább a döntésre', onClick: function () { setStatus('decision_pending', 'review_round_closed'); } }, '→ Döntésre')) : null) : null,
        // ---- editor: decision ----
        (isEd && (s.status === 'under_review' || s.status === 'decision_pending')) ? h('div', { style: { marginTop: 14, borderTop: '1px solid var(--line)', paddingTop: 12 } },
          h('b', { style: { fontSize: 13 } }, '⚖️ Döntés'),
          h('div', { style: { fontSize: 11.5, color: 'var(--faint)', margin: '4px 0 8px' } }, 'A döntőlevélbe a kör lezárt bírálatai automatikusan bekerülnek (anonimizálva).'),
          h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
            h('button', { className: 'btn pri', disabled: busy, onClick: function () { decide('accept'); } }, '✓ Elfogadás'),
            h('button', { className: 'btn', disabled: busy, onClick: function () { decide('minor'); } }, 'Kisebb revízió'),
            h('button', { className: 'btn', disabled: busy, onClick: function () { decide('major'); } }, 'Nagyobb revízió'),
            h('button', { className: 'btn', style: { color: 'var(--danger)' }, disabled: busy, onClick: function () { decide('reject'); } }, '✗ Elutasítás'))) : null,
        // ---- editor: camera-ready / publish ----
        (isEd && s.status === 'accepted') ? h('div', { style: { marginTop: 14, borderTop: '1px solid var(--line)', paddingTop: 12 } },
          h('button', { className: 'btn pri', disabled: busy, onClick: function () { setStatus('camera_ready', 'camera_ready_started'); } }, '→ Camera-ready fázis megnyitása')) : null,
        (isEd && s.status === 'camera_ready') ? h('div', { style: { marginTop: 14, borderTop: '1px solid var(--line)', paddingTop: 12 } },
          d.versions.some(function (v) { return v.kind === 'camera_ready'; })
            ? h('button', { className: 'btn pri', disabled: busy, title: 'Ellenőrizd, hogy a végleges PDF metaadatai egyeznek a rekorddal!', onClick: function () { setStatus('published', 'published'); } }, '✓ Lezárás / publikálás')
            : h('div', { style: { fontSize: 12, color: 'var(--faint)' } }, 'Várakozás a szerző végleges (camera-ready) változatára…')) : null,
        // ---- author: revision resubmit ----
        (!isEd && s.owner_id === me.id && s.status === 'revision_requested') ? h('div', { style: { marginTop: 16, borderTop: '1px solid var(--line)', paddingTop: 12 } },
          h('b', { style: { fontSize: 13 } }, '📝 Javított változat beadása (R' + ((s.round || 0) + 1) + ')'),
          h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' } },
            h('button', { className: 'btn', onClick: function () { if (revRef.current) revRef.current.click(); } }, revF ? '↻ Kézirat cseréje' : '⤒ Javított kézirat (PDF) *'),
            revF ? h('span', { style: { fontSize: 12 } }, '📄 ' + revF.name) : null,
            h('input', { ref: revRef, type: 'file', accept: '.pdf', style: { display: 'none' }, onChange: function (e) { setRevF(e.target.files && e.target.files[0]); e.target.value = ''; } })),
          h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' } },
            h('button', { className: 'btn', onClick: function () { if (respRef.current) respRef.current.click(); } }, respF ? '↻ Válaszlevél cseréje' : '⤒ Válasz a bírálóknak (PDF)'),
            respF ? h('span', { style: { fontSize: 12 } }, '📄 ' + respF.name) : null,
            h('input', { ref: respRef, type: 'file', accept: '.pdf,.doc,.docx', style: { display: 'none' }, onChange: function (e) { setRespF(e.target.files && e.target.files[0]); e.target.value = ''; } })),
          h('button', { className: 'btn pri', style: { marginTop: 10 }, disabled: !revF || busy, onClick: resubmit }, busy ? '⏳ Feltöltés…' : '📤 Újra beadás')) : null,
        // ---- author: camera-ready upload ----
        (!isEd && s.owner_id === me.id && s.status === 'camera_ready') ? h('div', { style: { marginTop: 16, borderTop: '1px solid var(--line)', paddingTop: 12 } },
          h('b', { style: { fontSize: 13 } }, '🎯 Végleges (camera-ready) változat'),
          s.editor_project_id ? h('div', { style: { marginTop: 6 } }, h('a', { className: 'btn', href: 'ProofReader.html?p=' + s.editor_project_id, style: { textDecoration: 'none' } }, '📝 Megnyitás a LaTeX editorban')) : null,
          h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' } },
            h('button', { className: 'btn', onClick: function () { if (crRef.current) crRef.current.click(); } }, crF ? '↻ Csere' : '⤒ Végleges PDF kiválasztása'),
            crF ? h('span', { style: { fontSize: 12 } }, '📄 ' + crF.name) : null,
            h('input', { ref: crRef, type: 'file', accept: '.pdf', style: { display: 'none' }, onChange: function (e) { setCrF(e.target.files && e.target.files[0]); e.target.value = ''; } }),
            h('button', { className: 'btn pri', disabled: !crF || busy, onClick: uploadCameraReady }, busy ? '⏳…' : '⤒ Feltöltés'))) : null,
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

  // ---------------- Reviewer: review workspace ----------------
  function ReviewWorkspace(props) {
    var r0 = props.rev; var s = props.sub; var me = props.me;
    var rvS = useState(r0), rev = rvS[0], setRev = rvS[1];
    var vS = useState([]), vers = vS[0], setVers = vS[1];
    var recS = useState(r0.recommendation || ''), rec = recS[0], setRec = recS[1];
    var caS = useState(r0.comments_author || ''), ca = caS[0], setCa = caS[1];
    var ceS = useState(r0.comments_editor || ''), ce2 = ceS[0], setCe2 = ceS[1];
    var bS = useState(false), busy = bS[0], setBusy = bS[1];
    useEffect(function () {
      if (s) sb.from('submission_versions').select('*').eq('submission_id', r0.submission_id).order('created_at').then(function (r) { setVers((r && r.data) || []); });
    }, [r0.submission_id]);
    function dl(v) { sb.storage.from('submission-files').createSignedUrl(v.storage_path, 3600, { download: v.file_name }).then(function (r) { if (r && r.data && r.data.signedUrl) window.open(r.data.signedUrl, '_blank'); }); }
    function setSt(st, extra, msg) {
      setBusy(true);
      sb.from('submission_reviews').update(Object.assign({ status: st }, extra || {})).eq('id', rev.id).then(function (r) {
        setBusy(false);
        if (r && r.error) { window.PRUI.toast(r.error.message, { kind: 'error' }); return; }
        setRev(Object.assign({}, rev, { status: st }, extra || {}));
        window.PRUI.toast(msg || 'Mentve', { kind: 'ok' }); props.onChanged();
        if (st === 'declined') props.onBack();
      });
    }
    function submitReview() {
      if (!rec || !ca.trim() || busy) return;
      setSt('completed', { recommendation: rec, comments_author: ca.trim(), comments_editor: ce2.trim() || null, submitted_at: new Date().toISOString() }, 'Bírálat beküldve — köszönjük!');
    }
    return h('div', { className: 'panel' },
      h('div', { style: { display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' } },
        h('button', { className: 'btn', style: { padding: '3px 10px', fontSize: 12, flex: 'none' }, onClick: props.onBack }, '←'),
        h('b', { style: { fontSize: 15, flex: 1, minWidth: 200 } }, s ? s.title : '(kézirat)'),
        h('span', { className: 'chip ' + (rev.status === 'completed' ? 'c-ok' : 'c-acc') }, rev.status),
        rev.due_at ? h('span', { style: { fontSize: 11.5, color: 'var(--faint)' } }, 'határidő: ' + fmtD(rev.due_at)) : null),
      s && s.abstract ? h('details', { style: { marginTop: 8 }, open: rev.status === 'invited' }, h('summary', { style: { fontSize: 12, cursor: 'pointer', color: 'var(--muted)' } }, 'Absztrakt'), h('div', { style: { fontSize: 12.5, lineHeight: 1.5, marginTop: 4 } }, s.abstract)) : null,
      rev.status === 'invited' ? h('div', { style: { marginTop: 14 } },
        h('div', { style: { fontSize: 13, marginBottom: 8 } }, 'Felkérést kaptál a kézirat bírálatára. Elvállalod?'),
        h('div', { style: { display: 'flex', gap: 8 } },
          h('button', { className: 'btn pri', disabled: busy, onClick: function () { setSt('agreed', null, 'Felkérés elfogadva'); } }, '✓ Elvállalom'),
          h('button', { className: 'btn', disabled: busy, onClick: function () { setSt('declined', null, 'Felkérés elutasítva'); } }, 'Nem vállalom')),
        h('label', { style: { display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, marginTop: 8 } },
          h('input', { type: 'checkbox', checked: !!rev.coi_declared, onChange: function (e) { sb.from('submission_reviews').update({ coi_declared: e.target.checked }).eq('id', rev.id).then(function () { setRev(Object.assign({}, rev, { coi_declared: e.target.checked })); }); } }),
          'Összeférhetetlenséget jelzek (a szerkesztő látja)')) : null,
      (rev.status === 'agreed' || rev.status === 'completed') ? h('div', null,
        h('div', { className: 'field-label', style: { marginTop: 12 } }, 'Kézirat-fájlok'),
        vers.length ? vers.map(function (v) {
          return h('div', { key: v.id, style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, padding: '3px 0' } },
            h('span', { className: 'chip c-grey', style: { fontSize: 10 } }, 'R' + v.round + ' · ' + v.kind),
            h('span', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, v.file_name),
            h('button', { className: 'btn', style: { padding: '2px 9px', fontSize: 11 }, onClick: function () { dl(v); } }, '⬇'));
        }) : h('div', { style: { fontSize: 12, color: 'var(--faint)' } }, 'Nincs elérhető fájl.'),
        rev.status === 'agreed' ? h('div', { style: { marginTop: 12 } },
          h('div', { className: 'field-label' }, 'Ajánlás *'),
          h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } }, [['accept', '✓ Elfogadás'], ['minor', 'Kisebb revízió'], ['major', 'Nagyobb revízió'], ['reject', '✗ Elutasítás']].map(function (o) {
            return h('button', { key: o[0], className: 'btn' + (rec === o[0] ? ' pri' : ''), style: { padding: '4px 12px', fontSize: 12.5 }, onClick: function () { setRec(o[0]); } }, o[1]);
          })),
          h('div', { className: 'field-label', style: { marginTop: 10 } }, 'Megjegyzések a szerzőnek *'),
          h('textarea', { className: 'field', rows: 8, style: { width: '100%', boxSizing: 'border-box', lineHeight: 1.5 }, value: ca, onChange: function (e) { setCa(e.target.value); } }),
          h('div', { className: 'field-label', style: { marginTop: 10 } }, '🔒 Bizalmas megjegyzés a szerkesztőnek (a szerző nem látja)'),
          h('textarea', { className: 'field', rows: 3, style: { width: '100%', boxSizing: 'border-box', lineHeight: 1.5 }, value: ce2, onChange: function (e) { setCe2(e.target.value); } }),
          h('button', { className: 'btn pri', style: { marginTop: 10 }, disabled: !rec || !ca.trim() || busy, onClick: submitReview }, busy ? '⏳…' : '📤 Bírálat beküldése')) : null,
        rev.status === 'completed' ? h('div', { style: { marginTop: 12, background: 'var(--soft)', borderRadius: 8, padding: '10px 12px' } },
          h('div', { style: { fontSize: 12.5 } }, h('b', null, 'Ajánlásod: '), REC_LABEL[rev.recommendation] || rev.recommendation, ' · beküldve: ' + fmtD(rev.submitted_at)),
          h('div', { style: { fontSize: 12.5, whiteSpace: 'pre-wrap', marginTop: 6, lineHeight: 1.5 } }, rev.comments_author)) : null) : null);
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
    var modeS = useState('author'), mode = modeS[0], setMode = modeS[1];  // author | editor | reviewer
    var mrS = useState([]), myRevs = mrS[0], setMyRevs = mrS[1];          // my reviewer assignments
    var srS = useState(null), selRev = srS[0], setSelRev = srS[1];
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
      sb.from('submission_reviews').select('*').eq('reviewer_id', BE.user.id).neq('status', 'cancelled').order('created_at', { ascending: false }).then(function (r) { setMyRevs((r && r.data) || []); });
    }
    if (phase === 'loading') return h('div', { className: 'center' }, h('div', { className: 'box' }, h('div', { className: 'mk' }, h('span')), h('h1', null, 'Érkeztető'), h('p', null, 'Betöltés…')));
    if (phase !== 'ready') return h('div', { className: 'center' }, h('div', { className: 'box' }, h('div', { className: 'mk' }, h('span')), h('h1', null, 'Érkeztető'), h('p', null, 'Jelentkezz be a Publify-ba a használathoz.'), h('a', { className: 'btn pri', href: 'Landing.html', style: { textDecoration: 'none' } }, 'Bejelentkezés')));

    var mine = subs.filter(function (s) { return s.owner_id === me.id; });
    var queue = subs.filter(function (s) { return tab === 'all' ? true : s.status === tab; });
    var counts = {}; subs.forEach(function (s) { counts[s.status] = (counts[s.status] || 0) + 1; });

    var body;
    if (view === 'wizard') body = h(Wizard, { me: me, onDone: function () { setView('list'); load(); }, onCancel: function () { setView('list'); } });
    else if (view === 'review' && selRev) body = h(ReviewWorkspace, { rev: selRev, sub: subs.filter(function (x) { return x.id === selRev.submission_id; })[0], me: me, onBack: function () { setView('list'); setSelRev(null); }, onChanged: load });
    else if (view === 'detail' && sel) body = h(Detail, { sub: sel, me: me, isEditor: isEditor && mode === 'editor', onBack: function () { setView('list'); setSel(null); }, onChanged: function () { load(); sb.from('submissions').select('*').eq('id', sel.id).maybeSingle().then(function (r) { if (r && r.data) setSel(r.data); }); } });
    else if (mode === 'reviewer') {
      body = h('div', { className: 'panel' },
        h('h3', { style: { marginTop: 0 } }, '🔍 Bírálati felkéréseim (' + myRevs.length + ')'),
        myRevs.length ? myRevs.map(function (r) {
          var su = subs.filter(function (x) { return x.id === r.submission_id; })[0];
          return h('div', { key: r.id, style: { display: 'flex', gap: 10, alignItems: 'baseline', padding: '9px 0', borderBottom: '1px solid var(--soft)', cursor: 'pointer' }, onClick: function () { setSelRev(r); setView('review'); } },
            h('b', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13.5 } }, su ? su.title : '(kézirat)'),
            h('span', { className: 'chip ' + (r.status === 'completed' ? 'c-ok' : r.status === 'declined' ? 'c-grey' : 'c-acc'), style: { fontSize: 10.5, flex: 'none' } }, r.status),
            r.due_at ? h('span', { style: { fontSize: 11, color: (new Date(r.due_at) < new Date() && r.status !== 'completed' && r.status !== 'declined') ? 'var(--danger)' : 'var(--faint)', flex: 'none' } }, fmtD(r.due_at)) : null);
        }) : h('div', { className: 'empty' }, 'Nincs bírálati felkérésed.'));
    }
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
          h('button', { className: mode === 'author' && view !== 'wizard' ? 'on' : '', onClick: function () { setMode('author'); setView('list'); setSel(null); setSelRev(null); } }, h('span', null, '📄 Kézirataim')),
          (myRevs.length || mode === 'reviewer') ? h('button', { className: mode === 'reviewer' ? 'on' : '', onClick: function () { setMode('reviewer'); setView('list'); setSel(null); setSelRev(null); } },
            h('span', null, '🔍 Bírálataim'),
            (function () { var n = myRevs.filter(function (r) { return r.status === 'invited' || r.status === 'agreed'; }).length; return n ? h('span', { className: 'nav-badge' }, n) : null; })()) : null,
          isEditor ? h('button', { className: mode === 'editor' ? 'on' : '', onClick: function () { setMode('editor'); setView('list'); setSel(null); setSelRev(null); } }, h('span', null, '🗂 Szerkesztőség')) : null),
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
