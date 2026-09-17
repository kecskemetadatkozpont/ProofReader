/* Publify — Kurzus: csapat-munkatér (course-team-room.js).
 * Loaded by Course.html before course.jsx; exposes window.PRTeamRoom.
 *
 * Every approved team gets a small project room: a weekly sprint that opens by itself (Monday–Sunday),
 * a Kanban board (Teendő / Folyamatban / Ellenőrzés / Kész), and three short asynchronous ceremonies —
 * planning, daily and retro — one entry per member per day. A task may only be marked done once it carries
 * evidence: an uploaded file (course-media, '<course>/<uploader>/team/…') or a link. That upload is the
 * record of who actually did the work, and it feeds the per-member activity table. The lecturer opens any
 * room read-only and has a course-wide overview. Schema + rules: migration-125. UI Hungarian, comments English. */
(function () {
  'use strict';
  var h = React.createElement;
  var useState = React.useState, useEffect = React.useEffect, useRef = React.useRef;
  var BE = window.PR_BACKEND, sb = BE && BE.sb;

  function toast(m, o) { try { window.PRUI && window.PRUI.toast(m, o); } catch (e) { } }
  function confirmBox(title, body, label, danger) {
    if (window.PRUI && window.PRUI.confirm) return window.PRUI.confirm({ title: title, body: body, confirmLabel: label, danger: !!danger });
    return Promise.resolve(window.confirm(title + (body ? '\n\n' + body : '')));
  }
  function missingSchema(err) { return !!(err && (err.code === 'PGRST202' || err.code === 'PGRST205' || err.code === '42P01')); }
  function initials(n) { return String(n || '?').split(/\s+/).map(function (w) { return w.charAt(0); }).join('').slice(0, 2).toUpperCase() || '?'; }
  function fmtDay(d) { if (!d) return '—'; try { return new Date(d).toLocaleDateString('hu-HU', { month: 'short', day: 'numeric' }); } catch (e) { return d; } }
  function fmtWhen(d) { if (!d) return 'még semmi'; try { return new Date(d).toLocaleString('hu-HU', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return d; } }
  function today() { return new Date().toISOString().slice(0, 10); }
  function bytes(n) { if (!n && n !== 0) return ''; return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' kB'; }
  function uuid() { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : ('x' + Date.now() + Math.random().toString(36).slice(2)); }

  var COLS = [
    { k: 'todo', t: 'Teendő' },
    { k: 'doing', t: 'Folyamatban' },
    { k: 'review', t: 'Ellenőrzés' },
    { k: 'done', t: 'Kész' }
  ];
  var ROLE_HU = { po: '🎯 PO', sm: '🛡 SM', dev: '🔧 Fejlesztő' };
  var MAX_FILE = 25 * 1024 * 1024;

  function Avatar(p) { return h('span', { className: 'tr-av', title: p.name }, initials(p.name)); }

  // ---------- task detail drawer ----------
  function TaskDrawer(props) {
    var task = props.task, members = props.members, canWrite = props.canWrite;
    var tS = useState(task.title), title = tS[0], setTitle = tS[1];
    var dS = useState(task.detail || ''), detail = dS[0], setDetail = dS[1];
    var aS = useState(task.assignee || ''), assignee = aS[0], setAssignee = aS[1];
    var eS = useState(task.estimate == null ? '' : task.estimate), est = eS[0], setEst = eS[1];
    var uS = useState(task.due_on || ''), due = uS[0], setDue = uS[1];
    var bS = useState(false), busy = bS[0], setBusy = bS[1];
    var lS = useState(''), link = lS[0], setLink = lS[1];
    var fileRef = useRef(null);
    var files = task.files || [];

    function save() {
      setBusy(true);
      sb.rpc('team_task_save', { p_team: props.teamId, p_task: {
        id: task.id, title: title, detail: detail, assignee: assignee || null,
        estimate: est === '' ? null : est, due_on: due || null, sprint_id: task.sprint_id || null
      } }).then(function (r) {
        setBusy(false);
        if (r && r.error) { toast(r.error.message, { kind: 'error' }); return; }
        toast('✓ Mentve', { kind: 'ok' }); props.onChange();
      });
    }
    function addLink() {
      if (!/^https?:\/\//.test(link.trim())) { toast('A link http:// vagy https:// címmel kezdődjön.', { kind: 'error' }); return; }
      sb.rpc('team_file_add', { p_task: task.id, p_kind: 'link', p_name: link.trim().replace(/^https?:\/\//, '').slice(0, 60), p_url: link.trim() }).then(function (r) {
        if (r && r.error) { toast(r.error.message, { kind: 'error' }); return; }
        setLink(''); toast('✓ Link hozzáadva', { kind: 'ok' }); props.onChange();
      });
    }
    function pickFile(e) {
      var f = e.target.files && e.target.files[0]; e.target.value = '';
      if (!f) return;
      if (f.size > MAX_FILE) { toast('A fájl legfeljebb 25 MB lehet.', { kind: 'error' }); return; }
      setBusy(true);
      // path shape is fixed by the storage policy (migration-67): '<course>/<uploader>/…'
      var path = props.courseId + '/' + props.meId + '/team/' + task.id + '/' + uuid() + '-' + f.name.replace(/[^\w.\-]+/g, '_').slice(-60);
      sb.storage.from('course-media').upload(path, f, { upsert: false }).then(function (up) {
        if (up && up.error) { setBusy(false); toast('A feltöltés nem sikerült: ' + up.error.message, { kind: 'error' }); return; }
        sb.rpc('team_file_add', { p_task: task.id, p_kind: 'file', p_name: f.name.slice(0, 200), p_path: path, p_size: f.size, p_mime: f.type || null }).then(function (r) {
          setBusy(false);
          if (r && r.error) { toast(r.error.message, { kind: 'error' }); return; }
          toast('✓ Bizonyíték feltöltve', { kind: 'ok' }); props.onChange();
        });
      });
    }
    function openFile(f) {
      if (f.kind === 'link') { window.open(f.url, '_blank', 'noopener'); return; }
      sb.storage.from('course-media').createSignedUrl(f.storage_path, 300).then(function (r) {
        if (r && r.error) { toast('Nem sikerült megnyitni: ' + r.error.message, { kind: 'error' }); return; }
        window.open(r.data.signedUrl, '_blank', 'noopener');
      });
    }
    function delFile(f) {
      confirmBox('Törlöd a bizonyítékot?', f.name + ' törlődik. Ha ez volt az egyetlen bizonyíték, a feladat visszakerül „Ellenőrzés” állapotba.', 'Törlés', true).then(function (ok) {
        if (!ok) return;
        sb.rpc('team_file_delete', { p_file: f.id }).then(function (r) {
          if (r && r.error) { toast(r.error.message, { kind: 'error' }); return; }
          if (f.kind === 'file' && f.storage_path) sb.storage.from('course-media').remove([f.storage_path]);
          props.onChange();
        });
      });
    }
    function del() {
      confirmBox('Törlöd a feladatot?', '„' + task.title + '” és a hozzá tartozó bizonyítékok törlődnek.', 'Törlés', true).then(function (ok) {
        if (!ok) return;
        sb.rpc('team_task_delete', { p_task: task.id }).then(function (r) {
          if (r && r.error) { toast(r.error.message, { kind: 'error' }); return; }
          props.onClose(); props.onChange();
        });
      });
    }

    return h('div', { className: 'tr-drawer-wrap', onClick: function (e) { if (e.target === e.currentTarget) props.onClose(); } },
      h('div', { className: 'tr-drawer', role: 'dialog', 'aria-label': 'Feladat' },
        h('div', { className: 'tr-dr-head' },
          h('b', null, 'Feladat'),
          h('span', { className: 'sp' }),
          canWrite ? h('button', { type: 'button', className: 'btn sm danger', onClick: del }, '🗑') : null,
          h('button', { type: 'button', className: 'btn sm', onClick: props.onClose }, 'Bezárom')),
        h('div', { className: 'tr-dr-body' },
          h('label', { className: 'form-l' }, 'Cím'),
          h('input', { className: 'in', value: title, disabled: !canWrite, maxLength: 200, onChange: function (e) { setTitle(e.target.value); } }),
          h('label', { className: 'form-l' }, 'Leírás'),
          h('textarea', { className: 'in', rows: 4, value: detail, disabled: !canWrite, onChange: function (e) { setDetail(e.target.value); } }),
          h('div', { className: 'tr-dr-grid' },
            h('div', null, h('label', { className: 'form-l' }, 'Felelős'),
              h('select', { className: 'in', value: assignee || '', disabled: !canWrite, onChange: function (e) { setAssignee(e.target.value); } },
                h('option', { value: '' }, '— nincs —'),
                members.map(function (m) { return h('option', { key: m.user_id, value: m.user_id }, m.name); }))),
            h('div', null, h('label', { className: 'form-l' }, 'Becslés (pont)'),
              h('input', { className: 'in', type: 'number', min: 0, max: 100, value: est, disabled: !canWrite, onChange: function (e) { setEst(e.target.value); } })),
            h('div', null, h('label', { className: 'form-l' }, 'Határidő'),
              h('input', { className: 'in', type: 'date', value: due || '', disabled: !canWrite, onChange: function (e) { setDue(e.target.value); } }))),
          canWrite ? h('button', { type: 'button', className: 'btn pri', disabled: busy, onClick: save }, 'Mentés') : null,

          h('div', { className: 'tr-ev' },
            h('b', null, '📎 Bizonyítékok (' + files.length + ')'),
            h('p', { className: 'co-note' }, 'A feladatot csak akkor lehet késznek jelölni, ha van hozzá legalább egy fájl vagy link. A rendszer rögzíti, ki és mikor töltötte fel.'),
            files.length ? h('ul', { className: 'tr-files' }, files.map(function (f) {
              return h('li', { key: f.id },
                h('button', { type: 'button', className: 'tr-file', onClick: function () { openFile(f); } },
                  h('span', null, f.kind === 'link' ? '🔗' : '📄'), h('span', { className: 'tr-fname' }, f.name)),
                h('span', { className: 'co-note' }, (f.uploader || '') + ' · ' + fmtWhen(f.created_at) + (f.size ? ' · ' + bytes(f.size) : '')),
                canWrite ? h('button', { type: 'button', className: 'btn sm', 'aria-label': 'Bizonyíték törlése', onClick: function () { delFile(f); } }, '×') : null);
            })) : h('p', { className: 'co-note' }, 'Még nincs bizonyíték.'),
            canWrite ? h('div', { className: 'tr-ev-add' },
              h('button', { type: 'button', className: 'btn sm', disabled: busy, onClick: function () { fileRef.current && fileRef.current.click(); } }, busy ? 'Feltöltés…' : '⬆ Fájl feltöltése'),
              h('input', { ref: fileRef, type: 'file', style: { display: 'none' }, onChange: pickFile }),
              h('input', { className: 'in sm', value: link, placeholder: 'vagy link: https://…', onChange: function (e) { setLink(e.target.value); },
                onKeyDown: function (e) { if (e.key === 'Enter') addLink(); } }),
              h('button', { type: 'button', className: 'btn sm', onClick: addLink }, 'Link hozzáadása')) : null))));
  }

  // ---------- kanban ----------
  function Board(props) {
    var tasks = props.tasks, canWrite = props.canWrite;
    var nS = useState(''), newTitle = nS[0], setNewTitle = nS[1];
    var oS = useState(null), open = oS[0], setOpen = oS[1];
    var openTask = open ? tasks.filter(function (t) { return t.id === open; })[0] : null;

    function add() {
      if (newTitle.trim().length < 2) return;
      sb.rpc('team_task_save', { p_team: props.teamId, p_task: { title: newTitle, sprint_id: props.sprintId } }).then(function (r) {
        if (r && r.error) { toast(r.error.message, { kind: 'error' }); return; }
        setNewTitle(''); props.onChange();
      });
    }
    function setStatus(t, st) {
      sb.rpc('team_task_status', { p_task: t.id, p_status: st, p_ord: null }).then(function (r) {
        if (r && r.error) { toast(r.error.message, { kind: 'error' }); return; }
        props.onChange();
      });
    }
    return h('div', null,
      canWrite ? h('div', { className: 'tr-add' },
        h('input', { className: 'in', value: newTitle, placeholder: 'Új feladat a sprintbe…', 'aria-label': 'Új feladat',
          onChange: function (e) { setNewTitle(e.target.value); }, onKeyDown: function (e) { if (e.key === 'Enter') add(); } }),
        h('button', { type: 'button', className: 'btn pri', onClick: add }, '+ Feladat')) : null,
      h('div', { className: 'tr-board' }, COLS.map(function (c) {
        var list = tasks.filter(function (t) { return t.status === c.k; });
        return h('div', { key: c.k, className: 'tr-col' },
          h('div', { className: 'tr-col-h' }, h('b', null, c.t), h('span', { className: 'co-note' }, list.length)),
          list.map(function (t) {
            var i = COLS.map(function (x) { return x.k; }).indexOf(t.status);
            return h('div', { key: t.id, className: 'tr-task' + (t.status === 'done' ? ' done' : '') },
              h('button', { type: 'button', className: 'tr-task-t', onClick: function () { setOpen(t.id); } }, t.title),
              h('div', { className: 'tr-task-m' },
                t.assignee_name ? h('span', { className: 'chip' }, initials(t.assignee_name)) : h('span', { className: 'chip' }, 'nincs felelős'),
                t.estimate != null ? h('span', { className: 'chip' }, t.estimate + ' pont') : null,
                t.due_on ? h('span', { className: 'chip' }, '⏰ ' + fmtDay(t.due_on)) : null,
                (t.files || []).length ? h('span', { className: 'chip ok' }, '📎 ' + t.files.length) : null),
              canWrite ? h('div', { className: 'tr-task-a' },
                i > 0 ? h('button', { type: 'button', className: 'btn sm', title: 'Vissza', onClick: function () { setStatus(t, COLS[i - 1].k); } }, '‹') : null,
                i < COLS.length - 1 ? h('button', { type: 'button', className: 'btn sm', title: 'Tovább', onClick: function () { setStatus(t, COLS[i + 1].k); } }, '›') : null) : null);
          }),
          !list.length ? h('p', { className: 'co-note' }, '—') : null);
      })),
      openTask ? h(TaskDrawer, { task: openTask, members: props.members, canWrite: canWrite, teamId: props.teamId,
        courseId: props.courseId, meId: props.meId, onClose: function () { setOpen(null); }, onChange: props.onChange }) : null);
  }

  // ---------- ceremonies ----------
  var FORMS = {
    daily: [['did', 'Mit csináltam a múlt alkalom óta?'], ['will', 'Mit csinálok a következőig?'], ['blocker', 'Mi akaszt meg?']],
    planning: [['note', 'Mit vállalunk ebben a sprintben? (a te vállalásod)']],
    retro: [['good', 'Mi ment jól?'], ['bad', 'Mi nem ment jól?'], ['action', 'Mit csinálunk másképp?']]
  };
  var KIND_HU = { daily: 'Daily', planning: 'Sprint planning', retro: 'Retrospektív' };

  function Ceremony(props) {
    var kind = props.kind, mine = props.mine, canWrite = props.canWrite;
    var vS = useState((mine && mine.payload) || {}), val = vS[0], setVal = vS[1];
    var bS = useState(false), busy = bS[0], setBusy = bS[1];
    useEffect(function () { setVal((mine && mine.payload) || {}); }, [mine && mine.id, mine && mine.updated_at]);
    function save() {
      setBusy(true);
      sb.rpc('team_event_save', { p_team: props.teamId, p_kind: kind, p_payload: val, p_day: kind === 'daily' ? today() : null }).then(function (r) {
        setBusy(false);
        if (r && r.error) { toast(r.error.message, { kind: 'error' }); return; }
        toast('✓ Rögzítve', { kind: 'ok' }); props.onChange();
      });
    }
    var others = (props.events || []).filter(function (e) { return e.kind === kind && !(mine && e.id === mine.id); });
    return h('div', { className: 'co-card tr-cer' },
      h('div', { className: 'tr-cer-h' }, h('b', null, KIND_HU[kind]),
        kind === 'daily' ? h('span', { className: 'co-note' }, 'ma: ' + fmtDay(today())) : null,
        h('span', { className: 'sp' }),
        mine ? h('span', { className: 'chip ok' }, '✓ kitöltötted') : null),
      canWrite ? h('div', { className: 'tr-cer-form' },
        FORMS[kind].map(function (f) {
          return h('div', { key: f[0] },
            h('label', { className: 'form-l' }, f[1]),
            h('textarea', { className: 'in', rows: 2, value: val[f[0]] || '',
              onChange: function (e) { var v = e.target.value; setVal(function (s) { var n = Object.assign({}, s); n[f[0]] = v; return n; }); } }));
        }),
        h('button', { type: 'button', className: 'btn pri sm', disabled: busy, onClick: save }, mine ? 'Frissítem' : 'Rögzítem')) : null,
      others.length ? h('div', { className: 'tr-cer-list' }, others.map(function (e) {
        return h('div', { key: e.id, className: 'tr-cer-i' },
          h('div', { className: 'tr-cer-who' }, h(Avatar, { name: e.author_name }), h('b', null, e.author_name || '—'),
            h('span', { className: 'co-note' }, fmtDay(e.day))),
          FORMS[kind].map(function (f) {
            var v = (e.payload || {})[f[0]];
            return v ? h('p', { key: f[0], className: 'tr-cer-p' }, h('span', { className: 'co-note' }, f[1] + ' '), v) : null;
          }));
      })) : h('p', { className: 'co-note' }, canWrite ? 'A csapattársaid bejegyzései itt jelennek meg.' : 'Nincs bejegyzés.'));
  }

  // ---------- activity ----------
  function Stats(props) {
    var rows = props.stats || [];
    return h('div', { className: 'co-card' },
      h('b', null, '📊 Ki mennyit tett hozzá'),
      h('p', { className: 'co-note' }, 'A számok a csapat teljes működésére vonatkoznak: kiosztott és kész feladatok, feltöltött bizonyítékok, kitöltött dailyk és retrók.'),
      h('div', { className: 'tr-stats-wrap' }, h('table', { className: 'mem-table' },
        h('thead', null, h('tr', null, h('th', null, 'Tag'), h('th', null, 'Szerep'), h('th', null, 'Feladat'),
          h('th', null, 'Kész'), h('th', null, 'Bizonyíték'), h('th', null, 'Daily'), h('th', null, 'Retro'), h('th', null, 'Utoljára'))),
        h('tbody', null, rows.map(function (r) {
          var idle = !r.last_seen;
          return h('tr', { key: r.user_id, className: idle ? 'tr-idle' : '' },
            h('td', null, r.name || '—'),
            h('td', null, ROLE_HU[r.role] || r.role),
            h('td', { className: 'tr-n' }, r.assigned),
            h('td', { className: 'tr-n' }, r.done),
            h('td', { className: 'tr-n' }, r.files),
            h('td', { className: 'tr-n' }, r.dailies),
            h('td', { className: 'tr-n' }, r.retros),
            h('td', null, idle ? h('span', { className: 'chip' }, 'még semmi') : fmtWhen(r.last_seen)));
        })))));
  }

  // ---------- the room ----------
  function TeamRoom(props) {
    var dS = useState(null), data = dS[0], setData = dS[1];
    var eS = useState(''), schema = eS[0], setSchema = eS[1];
    var vS = useState('board'), view = vS[0], setView = vS[1];
    var gS = useState(''), goal = gS[0], setGoal = gS[1];

    function load() {
      sb.rpc('team_room_state', { p_team: props.teamId }).then(function (r) {
        if (r && r.error) { if (missingSchema(r.error)) setSchema('missing'); else toast(r.error.message, { kind: 'error' }); return; }
        setData(r.data || {});
        setGoal(((r.data || {}).sprint || {}).goal || '');
      });
    }
    useEffect(function () { load(); }, [props.teamId]);

    if (schema === 'missing') return h('div', { className: 'soon' },
      h('b', null, 'A csapat-munkatér még nincs bekapcsolva az adatbázisban. '),
      'Az adminisztrátornak le kell futtatnia a ', h('code', null, 'backend/migration-125-team-room.sql'), ' fájlt.');
    if (!data) return h('div', { className: 'soon' }, 'Betöltés…');
    if (data.pending) return h('div', { className: 'soon' },
      h('button', { type: 'button', className: 'btn sm', onClick: props.onClose }, '‹ Vissza'),
      h('p', null, 'A munkatér akkor nyílik meg, ha az oktató jóváhagyta a csapat összeállítását.'));

    var team = data.team || {}, sprint = data.sprint || {}, canWrite = !!data.can_write;
    var members = data.members || [], events = data.events || [];
    var myDaily = events.filter(function (e) { return e.kind === 'daily' && e.author === props.meId && e.day === today(); })[0];
    var myPlan = events.filter(function (e) { return e.kind === 'planning' && e.author === props.meId; })[0];
    var myRetro = events.filter(function (e) { return e.kind === 'retro' && e.author === props.meId; })[0];
    var tasks = data.tasks || [];
    var done = tasks.filter(function (t) { return t.status === 'done'; }).length;

    function saveGoal() {
      sb.rpc('team_sprint_goal', { p_sprint: sprint.id, p_goal: goal }).then(function (r) {
        if (r && r.error) { toast(r.error.message, { kind: 'error' }); return; }
        toast('✓ Sprintcél mentve', { kind: 'ok' }); load();
      });
    }

    return h('div', { className: 'tr-wrap' },
      h('div', { className: 'tr-top' },
        h('button', { type: 'button', className: 'btn sm', onClick: props.onClose }, '‹ Csapatok'),
        h('h3', null, team.name),
        canWrite ? null : h('span', { className: 'chip acc' }, '👁 betekintés — nem írsz bele'),
        h('span', { className: 'sp' }),
        h('span', { className: 'chip' }, sprint.idx + '. sprint · ' + fmtDay(sprint.starts_on) + ' – ' + fmtDay(sprint.ends_on)),
        h('span', { className: 'chip' + (done ? ' ok' : '') }, done + ' / ' + tasks.length + ' kész')),

      h('div', { className: 'co-card tr-goal' },
        h('label', { className: 'form-l' }, 'A sprint célja'),
        h('div', { className: 'tr-goal-row' },
          h('input', { className: 'in', value: goal, disabled: !canWrite, maxLength: 300,
            placeholder: 'Mit akartok a hét végére elérni?', onChange: function (e) { setGoal(e.target.value); },
            onKeyDown: function (e) { if (e.key === 'Enter') saveGoal(); } }),
          canWrite ? h('button', { type: 'button', className: 'btn sm', onClick: saveGoal }, 'Mentés') : null),
        h('div', { className: 'tr-people' }, members.map(function (m) {
          return h('span', { key: m.user_id, className: 'tr-person', title: m.responsibility || '' },
            h(Avatar, { name: m.name }), h('span', null, m.name), h('span', { className: 'co-note' }, ROLE_HU[m.role] || ''));
        }))),

      h('span', { className: 'seg tr-seg' }, [['board', '🗂 Tábla'], ['planning', '🧭 Planning'], ['daily', '☀️ Daily'], ['retro', '🔁 Retro'], ['stats', '📊 Aktivitás']].map(function (t) {
        return h('button', { key: t[0], type: 'button', className: view === t[0] ? 'on' : '', onClick: function () { setView(t[0]); } }, t[1]);
      })),

      view === 'board' ? h(Board, { tasks: tasks, members: members, canWrite: canWrite, teamId: props.teamId,
          courseId: team.course_id, meId: props.meId, sprintId: sprint.id, onChange: load })
        : view === 'stats' ? h(Stats, { stats: data.stats })
          : h(Ceremony, { kind: view, teamId: props.teamId, canWrite: canWrite, events: events, onChange: load,
              mine: view === 'daily' ? myDaily : view === 'planning' ? myPlan : myRetro }));
  }

  // ---------- lecturer overview ----------
  function TeamsOverview(props) {
    var rS = useState(null), rows = rS[0], setRows = rS[1];
    useEffect(function () {
      sb.rpc('course_teams_overview', { p_course: props.courseId }).then(function (r) {
        if (r && r.error) { setRows([]); return; }
        setRows(r.data || []);
      });
    }, [props.courseId]);
    if (!rows) return h('div', { className: 'soon' }, 'Betöltés…');
    if (!rows.length) return null;
    return h('div', { className: 'co-card tr-ov' },
      h('b', null, '📊 Csapatok haladása'),
      h('p', { className: 'co-note' }, 'Minden jóváhagyott csapatnak saját munkatere van. Innen bármelyikbe belenézhetsz — olvasóként.'),
      h('div', { className: 'tr-stats-wrap' }, h('table', { className: 'mem-table' },
        h('thead', null, h('tr', null, h('th', null, 'Csapat'), h('th', null, 'Fő'), h('th', null, 'Feladat'),
          h('th', null, 'Kész'), h('th', null, 'Folyamatban'), h('th', null, 'Bizonyíték'),
          h('th', null, 'Daily (7 nap)'), h('th', null, 'Retro'), h('th', null, 'Néma tag'), h('th', null, 'Utolsó mozgás'), h('th', null, ''))),
        h('tbody', null, rows.map(function (r) {
          return h('tr', { key: r.team_id },
            h('td', null, r.name, r.status !== 'approved' ? h('span', { className: 'chip' }, ' nem jóváhagyott') : null),
            h('td', { className: 'tr-n' }, r.members),
            h('td', { className: 'tr-n' }, r.tasks),
            h('td', { className: 'tr-n' }, r.done),
            h('td', { className: 'tr-n' }, r.doing),
            h('td', { className: 'tr-n' }, r.files),
            h('td', { className: 'tr-n' }, r.dailies_7d),
            h('td', { className: 'tr-n' }, r.retros),
            h('td', { className: 'tr-n' }, r.inactive_members ? h('span', { className: 'chip acc' }, r.inactive_members) : '0'),
            h('td', null, fmtWhen(r.last_activity)),
            h('td', null, r.status === 'approved'
              ? h('button', { type: 'button', className: 'btn sm', onClick: function () { props.onOpen(r.team_id); } }, 'Megnyitom')
              : null));
        })))));
  }

  window.PRTeamRoom = { TeamRoom: TeamRoom, TeamsOverview: TeamsOverview };
})();
