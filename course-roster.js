/* Publify — Kurzus: névsor, hallgatói párosítás, pontok és jegyek (course-roster.js).
 * Loaded by Course.html before course.jsx; exposes window.PRCourseRoster.
 *
 * The Neptun export has no e-mail address, so we cannot create accounts for students. Instead only the Neptun codes are
 * imported (encrypted server side, matching runs on a keyed HMAC — names are deliberately NOT stored) and every student
 * signs up themselves, joins with the course code and claims their own roster row by typing their Neptun code. That
 * claim is what ties an account to a grade. A code that is not on the roster becomes a request the lecturer approves.
 * Points come from lab grades + live-lecture participation; the grade follows a configurable point scale and can be
 * overridden by hand. The Neptun upload CSV is the only place where codes are decrypted — and every such call is
 * logged. Schema + all access rules: migration-118. UI copy is Hungarian; comments English like the rest of the repo. */
(function () {
  'use strict';
  var h = React.createElement;
  var useState = React.useState, useEffect = React.useEffect, useRef = React.useRef;
  var BE = window.PR_BACKEND, sb = BE && BE.sb;
  var XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';

  function toast(m, o) { try { window.PRUI && window.PRUI.toast(m, o); } catch (e) { } }
  function confirmBox(title, body, label, danger) {
    if (window.PRUI && window.PRUI.confirm) return window.PRUI.confirm({ title: title, body: body, confirmLabel: label, danger: !!danger });
    return Promise.resolve(window.confirm(title + (body ? '\n\n' + body : '')));
  }
  function fmtDate(x) { try { return new Date(x).toLocaleString('hu-HU', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }
  // only a genuinely absent table/function means "run the migration" — a 42703 (missing column) is a bug, and
  // must surface as itself instead of hiding behind a migration notice
  function missingSchema(err) { return !!(err && (err.code === 'PGRST202' || err.code === 'PGRST205' || err.code === '42P01')); }
  var scriptP = {};
  function loadScript(src, globalName) {
    if (window[globalName]) return Promise.resolve(window[globalName]);
    if (!scriptP[src]) scriptP[src] = new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = src; s.async = true;
      s.onload = function () { window[globalName] ? res(window[globalName]) : rej(new Error(globalName + ' nem töltődött be')); };
      s.onerror = function () { delete scriptP[src]; rej(new Error('Nem sikerült betölteni: ' + src)); };
      document.head.appendChild(s);
    });
    return scriptP[src];
  }

  var DEFAULT_SCALE = { max_points: 100, activity_points: 10, cut: { 2: 51, 3: 63, 4: 75, 5: 87 } };
  function scaleOf(course) {
    var s = (course && course.settings && course.settings.grades) || {};
    return {
      max_points: +s.max_points || DEFAULT_SCALE.max_points,
      activity_points: s.activity_points == null ? DEFAULT_SCALE.activity_points : +s.activity_points,
      cut: Object.assign({}, DEFAULT_SCALE.cut, s.cut || {})
    };
  }

  // ---------- column mapping for the Neptun export ----------
  // The export's header row is 'Név | Neptunkód | Képzés | Évfolyam | Felvételek száma | Felvett tárgy neve/kódja';
  // other faculties export slightly different labels, so the guess is a starting point the lecturer can correct.
  var FIELDS = [
    { k: 'neptun', t: 'Neptun-kód', re: /neptun/i, req: true },
    { k: 'program', t: 'Képzés', re: /(k[ée]pz[ée]s|szak|program)/i },
    { k: 'subject', t: 'Tárgykód', re: /(t[áa]rgy|k[óo]d|subject)/i }
  ];   // no name column on purpose: the roster only needs the code, the account supplies the person
  function guessMap(headers) {
    var m = {}, used = {};
    FIELDS.forEach(function (f) {
      for (var i = 0; i < headers.length; i++) {
        var hd = String(headers[i] || '').trim();
        if (!hd || used[i]) continue;
        if (f.re.test(hd)) { m[f.k] = i; used[i] = true; break; }
      }
    });
    return m;
  }
  function looksLikeNeptun(v) { return /^[A-Za-z0-9]{5,8}$/.test(String(v || '').trim()); }

  // ---------- import card ----------
  function ImportCard(props) {
    var fileRef = useRef(null);
    var pS = useState(null), parsed = pS[0], setParsed = pS[1];   // {name, headers, rows, map}
    var bS = useState(false), busy = bS[0], setBusy = bS[1];
    var eS = useState(''), err = eS[0], setErr = eS[1];

    function pick(e) {
      var f = e.target.files && e.target.files[0]; e.target.value = '';
      if (!f) return;
      setErr(''); setBusy(true);
      loadScript(XLSX_URL, 'XLSX').then(function (XLSX) {
        return f.arrayBuffer().then(function (buf) {
          var wb = XLSX.read(buf, { type: 'array' });
          var ws = wb.Sheets[wb.SheetNames[0]];
          var rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' });
          if (!rows.length) throw new Error('A munkalap üres.');
          // the header row is the first one that holds a Neptun-like column name
          var hi = 0;
          for (var i = 0; i < Math.min(rows.length, 10); i++) { if (rows[i].some(function (c) { return /neptun/i.test(String(c)); })) { hi = i; break; } }
          var headers = rows[hi].map(function (c) { return String(c || '').trim(); });
          var body = rows.slice(hi + 1).filter(function (r) { return r.some(function (c) { return String(c || '').trim(); }); });
          setParsed({ name: f.name, sheet: wb.SheetNames[0], headers: headers, rows: body, map: guessMap(headers) });
          setBusy(false);
        });
      }).catch(function (e2) { setBusy(false); setErr('A fájl nem olvasható: ' + ((e2 && e2.message) || e2)); });
    }
    function setCol(k, v) { setParsed(function (p) { var m = Object.assign({}, p.map); if (v === '') delete m[k]; else m[k] = +v; return Object.assign({}, p, { map: m }); }); }
    function build() {
      var m = parsed.map;
      return parsed.rows.map(function (r) {
        return { neptun: String(r[m.neptun] == null ? '' : r[m.neptun]).trim(),
                 program: m.program == null ? '' : String(r[m.program] == null ? '' : r[m.program]).trim(),
                 subject: m.subject == null ? '' : String(r[m.subject] == null ? '' : r[m.subject]).trim() };
      }).filter(function (x) { return x.neptun; });
    }
    function run() {
      if (parsed.map.neptun == null) { setErr('A Neptun-kód oszlopát meg kell adni.'); return; }
      var rows = build();
      var bad = rows.filter(function (x) { return !looksLikeNeptun(x.neptun); }).length;
      if (!rows.length) { setErr('Egy használható sor sincs.'); return; }
      confirmBox('Importálod a névsort?', rows.length + ' Neptun-kód kerül fel a kurzus névsorába'
        + (bad ? ' (' + bad + ' gyanús kódot a rendszer kihagy)' : '')
        + '. Nevet nem tárolunk: a kódok titkosítva állnak, és a hallgatót a saját fiókja azonosítja, miután beírta a kódját.', 'Importálás', false).then(function (ok) {
        if (!ok) return;
        setBusy(true);
        // chunked: 474 rows in one statement is fine, but a slow link times out less often in batches
        var chunks = [], size = 150;
        for (var i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size));
        var sum = { total: 0, inserted: 0, updated: 0, invalid: 0 };
        chunks.reduce(function (p, c) {
          return p.then(function () {
            return sb.rpc('course_roster_import', { p_course: props.courseId, p_rows: c }).then(function (r) {
              if (r && r.error) throw r.error;
              var d = r.data || {};
              sum.total += d.total || 0; sum.inserted += d.inserted || 0; sum.updated += d.updated || 0; sum.invalid += d.invalid || 0;
            });
          });
        }, Promise.resolve()).then(function () {
          setBusy(false); setParsed(null);
          toast('✓ Névsor importálva: ' + sum.inserted + ' új, ' + sum.updated + ' frissített'
            + (sum.invalid ? ', ' + sum.invalid + ' kihagyott' : ''), { kind: 'ok' });
          props.onDone();
        }).catch(function (e2) { setBusy(false); setErr('Az importálás nem sikerült: ' + ((e2 && e2.message) || e2)); });
      });
    }

    var preview = parsed ? parsed.rows.slice(0, 3) : [];
    return h('div', { className: 'co-card cr-import' },
      h('div', { className: 'cr-h' },
        h('div', null, h('b', null, '📋 Névsor importálása'),
          h('p', { className: 'co-note' }, 'A Neptunból letöltött Excel-táblát (.xlsx) várja. A fájl a böngésződben nyílik meg, és onnan csak a Neptun-kód — titkosítva —, valamint a képzés és a tárgykód megy fel. A neveket a rendszer nem tárolja.')),
        h('span', { className: 'sp' }),
        h('button', { type: 'button', className: 'btn pri', disabled: busy, onClick: function () { fileRef.current && fileRef.current.click(); } }, busy ? 'Dolgozom…' : '⬆ Excel kiválasztása'),
        h('input', { ref: fileRef, type: 'file', accept: '.xlsx,.xls,.csv', style: { display: 'none' }, onChange: pick })),
      err ? h('p', { className: 'co-err', role: 'alert' }, err) : null,
      parsed ? h('div', { className: 'cr-map' },
        h('p', { className: 'co-note' }, parsed.name + ' · „' + parsed.sheet + '” munkalap · ' + parsed.rows.length + ' sor'),
        h('div', { className: 'cr-map-grid' }, FIELDS.map(function (f) {
          return h('div', { key: f.k },
            h('label', { className: 'form-l' }, f.t + (f.req ? ' *' : '')),
            h('select', { className: 'in', value: parsed.map[f.k] == null ? '' : parsed.map[f.k], onChange: function (e) { setCol(f.k, e.target.value); } },
              h('option', { value: '' }, '—'),
              parsed.headers.map(function (hd, i) { return h('option', { key: i, value: i }, hd || ('oszlop ' + (i + 1))); })));
        })),
        h('div', { className: 'cr-prev' },
          h('table', { className: 'mem-table' },
            h('thead', null, h('tr', null, FIELDS.map(function (f) { return h('th', { key: f.k }, f.t); }))),
            h('tbody', null, preview.map(function (r, i) {
              return h('tr', { key: i }, FIELDS.map(function (f) {
                var ci = parsed.map[f.k];
                return h('td', { key: f.k }, ci == null ? '—' : String(r[ci] == null ? '' : r[ci]));
              }));
            })))),
        h('div', { className: 'cr-f' },
          h('button', { type: 'button', className: 'btn', onClick: function () { setParsed(null); setErr(''); } }, 'Mégse'),
          h('button', { type: 'button', className: 'btn pri', disabled: busy, onClick: run }, busy ? 'Importálás…' : 'Importálás (' + parsed.rows.length + ' sor)'))) : null);
  }

  // ---------- pending claim requests ----------
  function Requests(props) {
    var list = props.list;
    if (!list.length) return null;
    return h('div', { className: 'co-card cr-req' },
      h('b', null, '⏳ Jóváhagyásra vár (' + list.length + ')'),
      h('p', { className: 'co-note' }, 'Ezek a hallgatók olyan Neptun-kódot adtak meg, ami nincs a névsorban. Ha beengeded, felkerülnek a névsorra, és jegyet is kaphatnak.'),
      h('table', { className: 'mem-table' },
        h('thead', null, h('tr', null, h('th', null, 'Fiók'), h('th', null, 'Megadott kód'), h('th', null, 'Mikor'), h('th', null, ''))),
        h('tbody', null, list.map(function (q) {
          return h('tr', { key: q.id },
            h('td', null, q.user_name || '—'),
            h('td', null, h('code', null, q.code)),
            h('td', null, fmtDate(q.created_at)),
            h('td', { style: { textAlign: 'right' } },
              h('button', { type: 'button', className: 'btn pri sm', onClick: function () { props.onDecide(q, true); } }, '✓ Beengedem'),
              ' ',
              h('button', { type: 'button', className: 'btn sm danger', onClick: function () { props.onDecide(q, false); } }, '✕ Elutasítom')));
        }))));
  }

  // ---------- grade scale editor ----------
  function ScaleCard(props) {
    var sc = props.scale;
    var sS = useState(sc), val = sS[0], setVal = sS[1];
    var bS = useState(false), busy = bS[0], setBusy = bS[1];
    useEffect(function () { setVal(sc); }, [JSON.stringify(sc)]);
    function up(k, v) { setVal(function (s) { var n = Object.assign({}, s); n[k] = v === '' ? '' : +v; return n; }); }
    function upCut(g, v) { setVal(function (s) { var c = Object.assign({}, s.cut); c[g] = v === '' ? '' : +v; return Object.assign({}, s, { cut: c }); }); }
    function save() {
      var cuts = [2, 3, 4, 5].map(function (g) { return +val.cut[g]; });
      if (cuts.some(function (x) { return !(x >= 0 && x <= 100); })) { toast('A ponthatárok 0 és 100% közé essenek.', { kind: 'error' }); return; }
      for (var i = 1; i < cuts.length; i++) if (cuts[i] <= cuts[i - 1]) { toast('A ponthatárok növekvő sorrendben kövessék egymást.', { kind: 'error' }); return; }
      setBusy(true);
      sb.from('courses').update({ settings: Object.assign({}, props.settings, { grades: { max_points: +val.max_points || 100, activity_points: +val.activity_points || 0, cut: { 2: cuts[0], 3: cuts[1], 4: cuts[2], 5: cuts[3] } } }) }).eq('id', props.courseId).then(function (r) {
        setBusy(false);
        if (r && r.error) { toast('Nem sikerült menteni: ' + r.error.message, { kind: 'error' }); return; }
        toast('✓ Ponthatárok mentve', { kind: 'ok' }); props.onDone();
      });
    }
    var mx = +val.max_points || 100;
    return h('div', { className: 'co-card cr-scale' },
      h('b', null, '🎯 Pontozás és ponthatárok'),
      h('p', { className: 'co-note' }, 'A pont a labor-értékelésekből és az órai aktivitásból áll össze. Az aktivitás az elindított szavazások megválaszolt hányada — aki minden szavazásra válaszolt, a teljes aktivitási pontot kapja. Akinek még nincs pontja, az nem kap automatikus jegyet.'),
      h('div', { className: 'cr-scale-grid' },
        h('div', null, h('label', { className: 'form-l' }, 'Maximális pont'), h('input', { className: 'in', type: 'number', min: 1, value: val.max_points, onChange: function (e) { up('max_points', e.target.value); } })),
        h('div', null, h('label', { className: 'form-l' }, 'Ebből órai aktivitás'), h('input', { className: 'in', type: 'number', min: 0, value: val.activity_points, onChange: function (e) { up('activity_points', e.target.value); } })),
        [2, 3, 4, 5].map(function (g) {
          return h('div', { key: g },
            h('label', { className: 'form-l' }, g + '-es ettől (%)'),
            h('input', { className: 'in', type: 'number', min: 0, max: 100, value: val.cut[g], onChange: function (e) { upCut(g, e.target.value); } }),
            h('span', { className: 'cr-pts' }, Math.round((+val.cut[g] || 0) * mx / 100) + ' pont'));
        })),
      h('div', { className: 'cr-f' },
        h('button', { type: 'button', className: 'btn', disabled: busy, onClick: props.onRecalc }, '↻ Pontok újraszámolása'),
        h('button', { type: 'button', className: 'btn pri', disabled: busy, onClick: save }, 'Ponthatárok mentése')));
  }

  // ---------- CSV ----------
  function csvCell(v) { var s = String(v == null ? '' : v); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function download(name, text) {
    var blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8;' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  // ---------- roster tab (lecturer) ----------
  function RosterTab(props) {
    var course = props.course, courseId = course.id;
    var sS = useState(null), stats = sS[0], setStats = sS[1];
    var rS = useState(null), rows = rS[0], setRows = rS[1];
    var qS = useState([]), reqs = qS[0], setReqs = qS[1];
    var fS = useState('all'), filter = fS[0], setFilter = fS[1];
    var tS = useState(''), term = tS[0], setTerm = tS[1];
    var eS = useState(''), schema = eS[0], setSchema = eS[1];
    var leS = useState(''), loadErr = leS[0], setLoadErr = leS[1];
    var bS = useState(false), busy = bS[0], setBusy = bS[1];
    var lS = useState(!!(course.settings && course.settings.require_roster)), lock = lS[0], setLock = lS[1];   // optimistic: the checkbox answers the click, the save follows
    useEffect(function () { setLock(!!(course.settings && course.settings.require_roster)); }, [course.settings && course.settings.require_roster]);
    var scale = scaleOf(course);

    function load(f, q) {
      f = f == null ? filter : f; q = q == null ? term : q;
      sb.rpc('course_roster_stats', { p_course: courseId }).then(function (r) {
        if (r && r.error) { if (missingSchema(r.error)) setSchema('missing'); return; }
        setStats(r.data);
      });
      sb.rpc('course_roster_list', { p_course: courseId, p_filter: f, p_q: q || null }).then(function (r) {
        if (r && r.error) {
          if (missingSchema(r.error)) setSchema('missing'); else setLoadErr('A névsor nem tölthető be: ' + r.error.message);
          setRows([]); return;
        }
        setLoadErr(''); setRows(r.data || []);
      });
      sb.rpc('course_roster_requests_list', { p_course: courseId }).then(function (r) { setReqs((r && r.data) || []); });
    }
    useEffect(function () { load(); }, [courseId]);
    useEffect(function () { var t = setTimeout(function () { load(filter, term); }, 300); return function () { clearTimeout(t); }; }, [term, filter]);

    function setRequire(on) {
      setLock(!!on);
      sb.from('courses').update({ settings: Object.assign({}, course.settings || {}, { require_roster: !!on }) }).eq('id', courseId).then(function (r) {
        if (r && r.error) { setLock(!on); toast('Nem sikerült: ' + r.error.message, { kind: 'error' }); return; }
        toast(on ? '✓ A kurzus tartalma zárolva azonosításig' : 'A zárolás kikapcsolva', { kind: 'ok' });
        (props.onCourseChange || function () { })();
      });
    }
    function decide(q, ok) {
      var go = function (okk) {
        if (!okk) return;
        sb.rpc('course_roster_decide', { p_request: q.id, p_ok: ok }).then(function (r) {
          if (r && r.error) { toast('Nem sikerült: ' + r.error.message, { kind: 'error' }); return; }
          toast(ok ? '✓ Felvetted a névsorba' : 'Elutasítva', { kind: 'ok' }); load();
        });
      };
      if (ok) confirmBox('Beengeded a hallgatót?', (q.user_name || 'A fiók') + ' a(z) „' + q.code + '” kóddal kerül a névsorba. Ezután jegyet is kaphat.', 'Beengedem', false).then(go);
      else confirmBox('Elutasítod?', (q.user_name || 'A fiók') + ' nem fér hozzá a kurzus tartalmához. Később újra próbálkozhat.', 'Elutasítom', true).then(go);
    }
    function unclaim(row) {
      confirmBox('Leválasztod a fiókot?', 'A(z) ' + row.neptun + ' kód sora újra szabaddá válik, ' + (row.user_name || 'a hozzá kötött fiók') + ' pedig elveszti a hozzáférést, amíg újra nem azonosítja magát.', 'Leválasztás', true).then(function (ok) {
        if (!ok) return;
        sb.rpc('course_roster_unclaim', { p_roster: row.id }).then(function (r) {
          if (r && r.error) { toast('Nem sikerült: ' + r.error.message, { kind: 'error' }); return; }
          toast('Leválasztva', { kind: 'ok' }); load();
        });
      });
    }
    function setGrade(row, g) {
      sb.rpc('course_grade_set', { p_course: courseId, p_user: row.user_id, p_grade: g === '' ? null : +g, p_note: null }).then(function (r) {
        if (r && r.error) { toast('Nem sikerült: ' + r.error.message, { kind: 'error' }); return; }
        load();
      });
    }
    function recalc() {
      setBusy(true);
      sb.rpc('course_grade_recalc', { p_course: courseId }).then(function (r) {
        setBusy(false);
        if (r && r.error) { toast('Nem sikerült: ' + r.error.message, { kind: 'error' }); return; }
        var d = r.data || {};
        toast('✓ ' + (d.updated || 0) + " hallgató pontja frissült (" + (d.polls || 0) + ' szavazás alapján)', { kind: 'ok' }); load();
      });
    }
    function exportCsv(subject) {
      sb.rpc('course_grade_export', { p_course: courseId }).then(function (r) {
        if (r && r.error) { toast('Nem sikerült: ' + r.error.message, { kind: 'error' }); return; }
        var all = r.data || [];
        var list = subject ? all.filter(function (x) { return (x.subject_code || '') === subject; }) : all;
        if (!list.length) { toast('Ehhez nincs sor.', { kind: 'error' }); return; }
        var head = ['Neptunkód', 'Tárgykód', 'Pont', 'Jegy', 'Regisztrált', 'Fiók'].join(';');
        var body = list.map(function (x) {
          // Hungarian Excel reads ';' columns and a decimal comma
          return [x.neptun, x.subject_code || '', x.points == null ? '' : String(x.points).replace('.', ','), x.grade == null ? '' : x.grade, x.claimed ? 'igen' : 'nem', x.account || ''].map(csvCell).join(';');
        }).join('\n');
        var tag = (subject || 'teljes').replace(/[^\w.-]+/g, '_').slice(0, 40);
        download('jegyek_' + tag + '_' + new Date().toISOString().slice(0, 10) + '.csv', head + '\n' + body);
        toast('A letöltés naplózva — személyes adatot tartalmaz.', { kind: 'ok' });
      });
    }
    function purge() {
      confirmBox('Törlöd a névsort?', 'A titkosított nevek és Neptun-kódok törlődnek, a jegyek megmaradnak. Ezt akkor érdemes, ha a jegyeket már feltöltötted a Neptunba. Új importálással pótolható.', 'Névsor törlése', true).then(function (ok) {
        if (!ok) return;
        sb.rpc('course_roster_purge', { p_course: courseId }).then(function (r) {
          if (r && r.error) { toast('Nem sikerült: ' + r.error.message, { kind: 'error' }); return; }
          toast('A névsor törölve', { kind: 'ok' }); load();
        });
      });
    }

    if (schema === 'missing') return h('div', { className: 'soon' },
      h('b', null, 'A névsor-kezelés még nincs bekapcsolva az adatbázisban. '),
      'Az adminisztrátornak le kell futtatnia a ', h('code', null, 'backend/migration-118-course-roster.sql'), ' fájlt a Supabase SQL-szerkesztőjében.');

    var subjects = {};
    (rows || []).forEach(function (r) { if (r.subject_code) subjects[r.subject_code] = (subjects[r.subject_code] || 0) + 1; });
    var subjectKeys = Object.keys(subjects).sort();
    var st = stats || {};
    var FILTERS = [['all', 'Mind'], ['claimed', 'Regisztrált'], ['missing', 'Még nem regisztrált'], ['graded', 'Van jegye'], ['ungraded', 'Nincs jegye']];

    return h('div', { className: 'cr-wrap' },
      h('div', { className: 'cr-stats' },
        [['Névsor', st.total || 0, 'fő'], ['Regisztrált', st.claimed || 0, 'fő'],
         ['Még hiányzik', Math.max(0, (st.total || 0) - (st.claimed || 0)), 'fő'],
         ['Jóváhagyásra vár', st.pending || 0, 'fő'], ['Jegye van', st.graded || 0, 'fő']].map(function (x) {
          return h('div', { key: x[0], className: 'co-card cr-stat' + (x[0] === 'Jóváhagyásra vár' && x[1] ? ' warn' : '') },
            h('b', null, x[1]), h('span', null, x[0]));
        })),
      loadErr ? h('p', { className: 'co-err', role: 'alert' }, loadErr) : null,
      h('div', { className: 'co-card cr-lock' },
        h('label', { className: 'cr-lock-l' },
          h('input', { type: 'checkbox', checked: lock,
            onChange: function (e) { setRequire(e.target.checked); } }),
          h('span', null, h('b', null, 'A kurzus tartalma csak azonosítás után látható'),
            h('span', { className: 'co-note' }, 'Bekapcsolva a hallgató a kurzuskóddal belép, de a diákat és a szavazásokat csak azután éri el, hogy a Neptun-kódjával azonosította magát. Kikapcsolva bárki hozzáfér, aki ismeri a kurzuskódot — jegyet viszont csak azonosítás után tud kapni.')))),
      h(Requests, { list: reqs, onDecide: decide }),
      h(ImportCard, { courseId: courseId, onDone: load }),
      h(ScaleCard, { courseId: courseId, scale: scale, settings: course.settings || {}, onDone: props.onCourseChange || function () { }, onRecalc: recalc }),
      h('div', { className: 'co-card cr-list' },
        h('div', { className: 'cr-h' },
          h('b', null, '👥 Névsor'),
          h('span', { className: 'sp' }),
          h('input', { className: 'in sm', placeholder: 'Neptun-kód vagy fiók neve…', value: term, 'aria-label': 'Keresés a névsorban', onChange: function (e) { setTerm(e.target.value); } }),
          h('button', { type: 'button', className: 'btn sm', disabled: busy, onClick: recalc }, '↻ Pontok'),
          h('button', { type: 'button', className: 'btn sm', onClick: function () { exportCsv(null); } }, '⬇ Jegyek (CSV)')),
        subjectKeys.length > 1 ? h('div', { className: 'cr-subj' },
          h('span', { className: 'co-note' }, 'Neptun-feltöltéshez tárgykódonként: '),
          subjectKeys.map(function (s) { return h('button', { key: s, type: 'button', className: 'btn sm', onClick: function () { exportCsv(s); } }, '⬇ ' + s + ' (' + subjects[s] + ')'); })) : null,
        h('div', { className: 'seg cr-filters' }, FILTERS.map(function (f) {
          return h('button', { key: f[0], type: 'button', className: filter === f[0] ? 'on' : '', onClick: function () { setFilter(f[0]); } }, f[1]);
        })),
        rows === null ? h('div', { className: 'soon' }, 'Betöltés…')
          : !rows.length ? h('div', { className: 'soon' }, (st.total ? 'Ebben a szűrésben nincs találat.' : 'Még nincs névsor — importáld a Neptun-exportot.'))
            : h('div', { className: 'cr-table-wrap' }, h('table', { className: 'mem-table cr-table' },
              h('thead', null, h('tr', null,
                h('th', null, 'Neptun'), h('th', null, 'Képzés'), h('th', null, 'Tárgykód'),
                h('th', null, 'Ki regisztrált'), h('th', null, 'Pont'), h('th', null, 'Jegy'), h('th', null, ''))),
              h('tbody', null, rows.map(function (r) {
                return h('tr', { key: r.id, className: r.user_id ? '' : 'cr-unclaimed' },
                  h('td', null, h('code', null, r.neptun),
                    r.extra ? h('span', { className: 'chip', title: 'Oktatói jóváhagyással került a névsorba' }, ' utólag') : null),
                  h('td', null, r.program || '—'),
                  h('td', null, r.subject_code || '—'),
                  h('td', null, r.user_id ? h('span', { className: 'chip ok', title: fmtDate(r.claimed_at) }, '✓ ' + (r.user_name || 'regisztrált')) : h('span', { className: 'chip' }, 'még senki')),
                  h('td', { className: 'cr-num' }, r.points == null ? '—' : (Math.round(r.points * 10) / 10).toString().replace('.', ',')),
                  h('td', null, r.user_id ? h('select', { className: 'in sm', value: r.grade == null ? '' : r.grade, 'aria-label': 'Jegy', onChange: function (e) { setGrade(r, e.target.value); } },
                    h('option', { value: '' }, '—'), [1, 2, 3, 4, 5].map(function (g) { return h('option', { key: g, value: g }, g); })) : '—',
                    r.manual ? h('span', { className: 'chip', title: 'Kézzel beírt jegy — az újraszámolás nem írja felül' }, ' kézi') : null),
                  h('td', { style: { textAlign: 'right' } }, r.user_id ? h('button', { type: 'button', className: 'btn sm', onClick: function () { unclaim(r); } }, 'Leválasztás') : null));
              })))),
        h('p', { className: 'co-note cr-priv' }, '🔒 A névsorban nincsenek nevek, csak titkosított Neptun-kódok; a név csak annál látszik, aki regisztrált, és az a saját fiókja neve. A kódokat ezen az oldalon és a CSV-letöltéskor fejti vissza a rendszer, és minden ilyen hozzáférést naplóz. A félév lezárása után érdemes törölni a névsort.'),
        h('div', { className: 'cr-f' }, h('button', { type: 'button', className: 'btn sm danger', onClick: purge }, '🗑 Névsor törlése'))));
  }

  // ---------- student: claim screen ----------
  function ClaimGate(props) {
    var courseId = props.courseId;
    var mS = useState(null), me = mS[0], setMe = mS[1];
    var cS = useState(''), code = cS[0], setCode = cS[1];
    var eS = useState(''), err = eS[0], setErr = eS[1];
    var bS = useState(false), busy = bS[0], setBusy = bS[1];
    function load() {
      sb.rpc('course_my_roster', { p_course: courseId }).then(function (r) {
        if (r && r.error) { setErr(r.error.message); setMe({}); return; }
        setMe(r.data || {});
      });
    }
    useEffect(load, [courseId]);
    function submit() {
      var c = code.trim().toUpperCase();
      if (!/^[A-Z0-9]{5,8}$/.test(c)) { setErr('A Neptun-kód 6 karakter: betűk és számok.'); return; }
      setBusy(true); setErr('');
      sb.rpc('course_roster_claim', { p_course: courseId, p_code: c }).then(function (r) {
        setBusy(false);
        if (r && r.error) { setErr(r.error.message); return; }
        var st = (r.data || {}).status;
        if (st === 'ok' || st === 'already') { toast('✓ Sikeres azonosítás — jó tanulást!', { kind: 'ok' }); props.onVerified && props.onVerified(); return; }
        if (st === 'taken') { setErr('Ezt a Neptun-kódot már egy másik fiók használja. Ha ez a te kódod, szólj az oktatónak.'); load(); return; }
        setMe(function (m) { return Object.assign({}, m || {}, { request: 'pending' }); });
      });
    }
    if (!me) return h('div', { className: 'soon' }, 'Betöltés…');
    var pending = me.request === 'pending';
    return h('div', { className: 'cr-gate' },
      h('div', { className: 'co-card cr-gate-card' },
        h('h2', null, me.course_title || 'Kurzus'),
        pending
          ? h('div', null,
            h('p', { className: 'cr-lead' }, '⏳ A megadott Neptun-kód nem szerepel a kurzus névsorában, ezért az oktató jóváhagyására vár.'),
            h('p', { className: 'co-note' }, 'Ha elgépelted, most javíthatod. Ha a kódod jó, de nem vagy a névsorban (például most vetted fel a tárgyat), az oktató kézzel felvesz.'))
          : h('p', { className: 'cr-lead' }, 'Az utolsó lépés: add meg a Neptun-kódodat. Ez köti össze a fiókodat a kurzus névsorával — enélkül nem tudunk jegyet adni.'),
        h('label', { className: 'form-l' }, 'Neptun-kód'),
        h('input', { className: 'in cr-code', value: code, maxLength: 8, autoFocus: true, placeholder: 'PL. AB12CD', 'aria-label': 'Neptun-kód',
          onChange: function (e) { setCode(e.target.value.toUpperCase()); setErr(''); },
          onKeyDown: function (e) { if (e.key === 'Enter') submit(); } }),
        err ? h('p', { className: 'co-err', role: 'alert' }, err) : null,
        h('button', { type: 'button', className: 'btn pri', disabled: busy, onClick: submit }, busy ? 'Ellenőrzés…' : (pending ? 'Új kód beküldése' : 'Azonosítás')),
        h('p', { className: 'co-note cr-priv' }, '🔒 A kódot titkosítva tároljuk, és csak arra használjuk, hogy a kurzus névsorához és a jegyedhez kössük. Az oktatód a kódodat és a fiókod nevét látja; a többi hallgató nem.')));
  }

  // ---------- student: own grade ----------
  function MyGradeCard(props) {
    var dS = useState(null), d = dS[0], setD = dS[1];
    useEffect(function () {
      sb.rpc('course_my_roster', { p_course: props.courseId }).then(function (r) { if (r && !r.error) setD(r.data || {}); });
    }, [props.courseId]);
    if (!d || !d.verified) return null;
    return h('div', { className: 'co-card cr-mygrade' },
      h('b', null, '🎓 Az én állásom'),
      h('div', { className: 'cr-mg-row' },
        h('div', null, h('span', { className: 'co-note' }, 'Neptun-kód'), h('b', null, d.neptun || '—')),
        h('div', null, h('span', { className: 'co-note' }, 'Pont'), h('b', null, d.points == null ? '—' : String(d.points).replace('.', ','))),
        h('div', null, h('span', { className: 'co-note' }, 'Jegy'), h('b', { className: 'cr-grade' }, d.grade == null ? '—' : d.grade))),
      d.note ? h('p', { className: 'co-note' }, d.note) : null);
  }

  window.PRCourseRoster = { RosterTab: RosterTab, ClaimGate: ClaimGate, MyGradeCard: MyGradeCard, scaleOf: scaleOf };
})();
