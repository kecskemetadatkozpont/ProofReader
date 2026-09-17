/* Publify — Kurzus: csapat-munkatér (course-team-room.js).
 * Loaded by Course.html before course.jsx; exposes window.PRTeamRoom.
 *
 * Every approved team gets a project room in the shape students know from tools like ClickUp: a left rail of
 * views (board / list / calendar / ceremonies / activity), one weekly sprint that opens by itself (Mon–Sun),
 * drag-and-drop cards carrying priority, tags, checklists and comments, and the same tasks rendered three ways.
 * A task may only reach "Kész" once it carries evidence — an uploaded file (course-media,
 * '<course>/<uploader>/team/…', the path shape migration-67's storage policy requires) or a link — and that
 * upload is the record of who did the work. The lecturer opens any room read-only.
 * Schema: migration-125 + 126. UI copy Hungarian, comments English, like the rest of the repo. */
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
  function daysUntil(d) { if (!d) return null; return Math.round((new Date(d + 'T00:00:00') - new Date(today() + 'T00:00:00')) / 86400000); }
  function bytes(n) { if (!n && n !== 0) return ''; return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' kB'; }
  function uuid() { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : ('x' + Date.now() + Math.random().toString(36).slice(2)); }

  var COLS = [
    { k: 'todo', t: 'Teendő', hint: 'Ide kerül, amiben még senki nem kezdett bele.' },
    { k: 'doing', t: 'Folyamatban', hint: 'Amin épp dolgozik valaki.' },
    { k: 'review', t: 'Ellenőrzés', hint: 'Kész, de még más szeme kell rá.' },
    { k: 'done', t: 'Kész', hint: 'Bizonyítékkal lezárva.' }
  ];
  var COL_BY = {}; COLS.forEach(function (c, i) { COL_BY[c.k] = i; });
  var PRIOS = [
    { k: 'urgent', t: 'Sürgős', ic: '🔴' },
    { k: 'high', t: 'Fontos', ic: '🟠' },
    { k: 'normal', t: 'Normál', ic: '🔵' },
    { k: 'low', t: 'Ráér', ic: '⚪️' }
  ];
  var PRIO_BY = {}; PRIOS.forEach(function (p) { PRIO_BY[p.k] = p; });
  var PRIO_ORDER = { urgent: 0, high: 1, normal: 2, low: 3 };
  var ROLE_HU = { po: '🎯 PO', sm: '🛡 SM', dev: '🔧 Fejlesztő' };
  var MAX_FILE = 25 * 1024 * 1024;

  function Avatar(p) {
    return h('span', { className: 'tr-av' + (p.sm ? ' sm' : '') + (p.on ? ' on' : ''), title: p.name || '' }, initials(p.name));
  }
  function dueChip(d) {
    var n = daysUntil(d);
    if (n === null) return null;
    var cls = n < 0 ? ' late' : n <= 2 ? ' soon' : '';
    var txt = n < 0 ? 'lejárt · ' + fmtDay(d) : n === 0 ? 'ma' : n === 1 ? 'holnap' : fmtDay(d);
    return h('span', { className: 'tr-chip due' + cls }, '⏰ ' + txt);
  }
  function checkProgress(list) {
    var arr = Array.isArray(list) ? list : [];
    if (!arr.length) return null;
    var d = arr.filter(function (x) { return x && x.done; }).length;
    return { done: d, total: arr.length };
  }

  // ---------- comments ----------
  function Comments(props) {
    var lS = useState(null), list = lS[0], setList = lS[1];
    var bS = useState(''), body = bS[0], setBody = bS[1];
    function load() {
      sb.rpc('team_task_comments_list', { p_task: props.taskId }).then(function (r) {
        if (r && r.error) { setList([]); return; }
        setList(r.data || []);
      });
    }
    useEffect(load, [props.taskId]);
    function send() {
      if (!body.trim()) return;
      sb.rpc('team_comment_add', { p_task: props.taskId, p_body: body }).then(function (r) {
        if (r && r.error) { toast(r.error.message, { kind: 'error' }); return; }
        setBody(''); load(); props.onChange();
      });
    }
    function del(c) {
      sb.rpc('team_comment_delete', { p_id: c.id }).then(function (r) {
        if (r && r.error) { toast(r.error.message, { kind: 'error' }); return; }
        load(); props.onChange();
      });
    }
    return h('div', { className: 'tr-comments' },
      h('b', null, '💬 Beszélgetés'),
      list === null ? h('p', { className: 'co-note' }, 'Betöltés…')
        : list.length ? h('div', { className: 'tr-cmt-list' }, list.map(function (c) {
          return h('div', { key: c.id, className: 'tr-cmt' },
            h(Avatar, { name: c.author_name, sm: true }),
            h('div', { className: 'tr-cmt-b' },
              h('div', { className: 'tr-cmt-h' }, h('b', null, c.author_name || '—'),
                h('span', { className: 'co-note' }, fmtWhen(c.created_at)),
                props.canWrite ? h('button', { type: 'button', className: 'tr-x', 'aria-label': 'Törlés', onClick: function () { del(c); } }, '×') : null),
              h('p', null, c.body)));
        })) : h('p', { className: 'co-note' }, 'Még nincs hozzászólás.'),
      props.canWrite ? h('div', { className: 'tr-cmt-new' },
        h('textarea', { className: 'in', rows: 2, value: body, placeholder: 'Írj a csapatnak…',
          onChange: function (e) { setBody(e.target.value); },
          onKeyDown: function (e) { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); } }),
        h('button', { type: 'button', className: 'btn pri sm', onClick: send }, 'Küldés')) : null);
  }

  // ---------- checklist ----------
  function Checklist(props) {
    var items = Array.isArray(props.items) ? props.items : [];
    var nS = useState(''), text = nS[0], setText = nS[1];
    function toggle(i) {
      if (!props.canWrite) return;
      sb.rpc('team_task_check', { p_task: props.taskId, p_index: i, p_done: !items[i].done }).then(function (r) {
        if (r && r.error) { toast(r.error.message, { kind: 'error' }); return; }
        props.onChange();
      });
    }
    function add() {
      if (!text.trim()) return;
      props.onSave(items.concat([{ id: uuid(), text: text.trim().slice(0, 140), done: false }]));
      setText('');
    }
    var pr = checkProgress(items);
    return h('div', { className: 'tr-check' },
      h('div', { className: 'tr-check-h' }, h('b', null, '☑️ Részfeladatok'),
        pr ? h('span', { className: 'co-note' }, pr.done + ' / ' + pr.total) : null),
      pr ? h('div', { className: 'tr-bar' }, h('i', { style: { width: Math.round(pr.done / pr.total * 100) + '%' } })) : null,
      items.map(function (it, i) {
        return h('label', { key: it.id || i, className: 'tr-check-i' + (it.done ? ' on' : '') },
          h('input', { type: 'checkbox', checked: !!it.done, disabled: !props.canWrite, onChange: function () { toggle(i); } }),
          h('span', null, it.text),
          props.canWrite ? h('button', { type: 'button', className: 'tr-x', 'aria-label': 'Törlés',
            onClick: function (e) { e.preventDefault(); props.onSave(items.filter(function (_, j) { return j !== i; })); } }, '×') : null);
      }),
      props.canWrite ? h('div', { className: 'tr-check-new' },
        h('input', { className: 'in sm', value: text, placeholder: 'Új részfeladat…',
          onChange: function (e) { setText(e.target.value); },
          onKeyDown: function (e) { if (e.key === 'Enter') { e.preventDefault(); add(); } } }),
        h('button', { type: 'button', className: 'btn sm', onClick: add }, '+')) : null);
  }

  // ---------- evidence ----------
  function Evidence(props) {
    var files = props.files || [], canWrite = props.canWrite;
    var lS = useState(''), link = lS[0], setLink = lS[1];
    var bS = useState(false), busy = bS[0], setBusy = bS[1];
    var fileRef = useRef(null);
    function addLink() {
      if (!/^https?:\/\//.test(link.trim())) { toast('A link http:// vagy https:// címmel kezdődjön.', { kind: 'error' }); return; }
      sb.rpc('team_file_add', { p_task: props.taskId, p_kind: 'link', p_name: link.trim().replace(/^https?:\/\//, '').slice(0, 60), p_url: link.trim() }).then(function (r) {
        if (r && r.error) { toast(r.error.message, { kind: 'error' }); return; }
        setLink(''); toast('✓ Link hozzáadva', { kind: 'ok' }); props.onChange();
      });
    }
    function pickFile(e) {
      var f = e.target.files && e.target.files[0]; e.target.value = '';
      if (!f) return;
      if (f.size > MAX_FILE) { toast('A fájl legfeljebb 25 MB lehet.', { kind: 'error' }); return; }
      setBusy(true);
      var path = props.courseId + '/' + props.meId + '/team/' + props.taskId + '/' + uuid() + '-' + f.name.replace(/[^\w.\-]+/g, '_').slice(-60);
      sb.storage.from('course-media').upload(path, f, { upsert: false }).then(function (up) {
        if (up && up.error) { setBusy(false); toast('A feltöltés nem sikerült: ' + up.error.message, { kind: 'error' }); return; }
        sb.rpc('team_file_add', { p_task: props.taskId, p_kind: 'file', p_name: f.name.slice(0, 200), p_path: path, p_size: f.size, p_mime: f.type || null }).then(function (r) {
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
      confirmBox('Törlöd a bizonyítékot?', f.name + ' törlődik. Ha ez volt az egyetlen, a feladat visszakerül „Ellenőrzés” állapotba.', 'Törlés', true).then(function (ok) {
        if (!ok) return;
        sb.rpc('team_file_delete', { p_file: f.id }).then(function (r) {
          if (r && r.error) { toast(r.error.message, { kind: 'error' }); return; }
          if (f.kind === 'file' && f.storage_path) sb.storage.from('course-media').remove([f.storage_path]);
          props.onChange();
        });
      });
    }
    return h('div', { className: 'tr-ev' },
      h('b', null, '📎 Bizonyítékok (' + files.length + ')'),
      h('p', { className: 'co-note' }, 'A feladat csak akkor kerülhet „Kész” oszlopba, ha van hozzá fájl vagy link. A rendszer rögzíti, ki és mikor tette fel.'),
      files.length ? h('ul', { className: 'tr-files' }, files.map(function (f) {
        return h('li', { key: f.id },
          h('button', { type: 'button', className: 'tr-file', onClick: function () { openFile(f); } },
            h('span', null, f.kind === 'link' ? '🔗' : '📄'), h('span', { className: 'tr-fname' }, f.name)),
          h('span', { className: 'co-note' }, (f.uploader || '') + ' · ' + fmtWhen(f.created_at) + (f.size ? ' · ' + bytes(f.size) : '')),
          canWrite ? h('button', { type: 'button', className: 'tr-x', 'aria-label': 'Bizonyíték törlése', onClick: function () { delFile(f); } }, '×') : null);
      })) : h('p', { className: 'co-note' }, 'Még nincs bizonyíték.'),
      canWrite ? h('div', { className: 'tr-ev-add' },
        h('button', { type: 'button', className: 'btn sm', disabled: busy, onClick: function () { fileRef.current && fileRef.current.click(); } }, busy ? 'Feltöltés…' : '⬆ Fájl'),
        h('input', { ref: fileRef, type: 'file', style: { display: 'none' }, onChange: pickFile }),
        h('input', { className: 'in sm', value: link, placeholder: 'vagy link: https://…', onChange: function (e) { setLink(e.target.value); },
          onKeyDown: function (e) { if (e.key === 'Enter') addLink(); } }),
        h('button', { type: 'button', className: 'btn sm', onClick: addLink }, 'Hozzáadom')) : null);
  }

  // ---------- task drawer ----------
  function TaskDrawer(props) {
    var task = props.task, members = props.members, canWrite = props.canWrite;
    var fS = useState({
      title: task.title, detail: task.detail || '', assignee: task.assignee || '',
      estimate: task.estimate == null ? '' : task.estimate, due_on: task.due_on || '',
      priority: task.priority || 'normal'
    });
    var form = fS[0], setForm = fS[1];
    var tS = useState((task.tags || []).join(', ')), tagStr = tS[0], setTagStr = tS[1];
    var bS = useState(false), busy = bS[0], setBusy = bS[1];
    useEffect(function () {
      setForm({ title: task.title, detail: task.detail || '', assignee: task.assignee || '',
        estimate: task.estimate == null ? '' : task.estimate, due_on: task.due_on || '', priority: task.priority || 'normal' });
      setTagStr((task.tags || []).join(', '));
    }, [task.id]);
    function up(k, v) { setForm(function (s) { var n = Object.assign({}, s); n[k] = v; return n; }); }
    function save(extra, quiet) {
      var body = Object.assign({
        id: task.id, title: form.title, detail: form.detail, assignee: form.assignee || null,
        estimate: form.estimate === '' ? null : form.estimate, due_on: form.due_on || null,
        priority: form.priority, sprint_id: task.sprint_id || null,
        tags: tagStr.split(',').map(function (x) { return x.trim(); }).filter(Boolean).slice(0, 6)
      }, extra || {});
      setBusy(true);
      sb.rpc('team_task_save', { p_team: props.teamId, p_task: body }).then(function (r) {
        setBusy(false);
        if (r && r.error) { toast(r.error.message, { kind: 'error' }); return; }
        if (!quiet) toast('✓ Mentve', { kind: 'ok' });
        props.onChange();
      });
    }
    function del() {
      confirmBox('Törlöd a feladatot?', '„' + task.title + '” és a hozzá tartozó bizonyítékok, részfeladatok, hozzászólások törlődnek.', 'Törlés', true).then(function (ok) {
        if (!ok) return;
        sb.rpc('team_task_delete', { p_task: task.id }).then(function (r) {
          if (r && r.error) { toast(r.error.message, { kind: 'error' }); return; }
          props.onClose(); props.onChange();
        });
      });
    }
    function move(st) {
      sb.rpc('team_task_status', { p_task: task.id, p_status: st, p_ord: null }).then(function (r) {
        if (r && r.error) { toast(r.error.message, { kind: 'error' }); return; }
        props.onChange();
      });
    }
    return h('div', { className: 'tr-drawer-wrap', onClick: function (e) { if (e.target === e.currentTarget) props.onClose(); } },
      h('div', { className: 'tr-drawer', role: 'dialog', 'aria-label': 'Feladat' },
        h('div', { className: 'tr-dr-head' },
          h('span', { className: 'seg tr-statuses' }, COLS.map(function (c) {
            return h('button', { key: c.k, type: 'button', className: task.status === c.k ? 'on' : '', disabled: !canWrite,
              title: c.hint, onClick: function () { move(c.k); } }, c.t);
          })),
          h('span', { className: 'sp' }),
          canWrite ? h('button', { type: 'button', className: 'btn sm danger', 'aria-label': 'Feladat törlése', onClick: del }, '🗑') : null,
          h('button', { type: 'button', className: 'btn sm', onClick: props.onClose }, 'Bezárom')),
        h('div', { className: 'tr-dr-body' },
          h('input', { className: 'in tr-title', value: form.title, disabled: !canWrite, maxLength: 200,
            onChange: function (e) { up('title', e.target.value); }, onBlur: function () { if (canWrite) save(null, true); } }),
          h('div', { className: 'tr-dr-grid' },
            h('div', null, h('label', { className: 'form-l' }, 'Felelős'),
              h('select', { className: 'in', value: form.assignee || '', disabled: !canWrite,
                onChange: function (e) { var v = e.target.value; up('assignee', v); setTimeout(function () { save({ assignee: v || null }, true); }, 0); } },
                h('option', { value: '' }, '— nincs —'),
                members.map(function (m) { return h('option', { key: m.user_id, value: m.user_id }, m.name); }))),
            h('div', null, h('label', { className: 'form-l' }, 'Prioritás'),
              h('select', { className: 'in', value: form.priority, disabled: !canWrite,
                onChange: function (e) { var v = e.target.value; up('priority', v); setTimeout(function () { save({ priority: v }, true); }, 0); } },
                PRIOS.map(function (p) { return h('option', { key: p.k, value: p.k }, p.ic + ' ' + p.t); }))),
            h('div', null, h('label', { className: 'form-l' }, 'Határidő'),
              h('input', { className: 'in', type: 'date', value: form.due_on || '', disabled: !canWrite,
                onChange: function (e) { var v = e.target.value; up('due_on', v); setTimeout(function () { save({ due_on: v || null }, true); }, 0); } })),
            h('div', null, h('label', { className: 'form-l' }, 'Becslés (pont)'),
              h('input', { className: 'in', type: 'number', min: 0, max: 100, value: form.estimate, disabled: !canWrite,
                onChange: function (e) { up('estimate', e.target.value); }, onBlur: function () { if (canWrite) save(null, true); } }))),
          h('label', { className: 'form-l' }, 'Címkék (vesszővel)'),
          h('input', { className: 'in', value: tagStr, disabled: !canWrite, placeholder: 'mérés, doksi, kód',
            onChange: function (e) { setTagStr(e.target.value); }, onBlur: function () { if (canWrite) save(null, true); } }),
          h('label', { className: 'form-l' }, 'Leírás'),
          h('textarea', { className: 'in', rows: 4, value: form.detail, disabled: !canWrite,
            placeholder: 'Mi a feladat pontosan? Mit jelent, hogy kész?',
            onChange: function (e) { up('detail', e.target.value); }, onBlur: function () { if (canWrite) save(null, true); } }),
          canWrite ? h('p', { className: 'co-note' }, busy ? 'Mentés…' : 'A módosítások magukat mentik.') : null,
          h(Checklist, { items: task.checklist, taskId: task.id, canWrite: canWrite, onChange: props.onChange,
            onSave: function (next) { save({ checklist: next }, true); } }),
          h(Evidence, { files: task.files, taskId: task.id, canWrite: canWrite, courseId: props.courseId,
            meId: props.meId, onChange: props.onChange }),
          h(Comments, { taskId: task.id, canWrite: canWrite, onChange: props.onChange }))));
  }

  // ---------- card ----------
  function Card(props) {
    var t = props.task, canWrite = props.canWrite;
    var pr = checkProgress(t.checklist);
    var prio = PRIO_BY[t.priority || 'normal'];
    return h('div', {
      className: 'tr-card' + (t.status === 'done' ? ' done' : '') + (props.dragging ? ' dragging' : ''),
      draggable: canWrite, onDragStart: props.onDragStart, onDragEnd: props.onDragEnd,
      onClick: function () { props.onOpen(t.id); },
      onKeyDown: function (e) { if (e.key === 'Enter') props.onOpen(t.id); },
      tabIndex: 0, role: 'button'
    },
      h('div', { className: 'tr-card-top' },
        h('span', { className: 'tr-prio ' + prio.k, title: 'Prioritás: ' + prio.t }, prio.ic),
        h('span', { className: 'tr-card-t' }, t.title),
        t.assignee_name ? h(Avatar, { name: t.assignee_name, sm: true }) : null),
      (t.tags || []).length ? h('div', { className: 'tr-tags' }, (t.tags || []).map(function (g) {
        return h('span', { key: g, className: 'tr-tag' }, g);
      })) : null,
      pr ? h('div', { className: 'tr-bar sm' }, h('i', { style: { width: Math.round(pr.done / pr.total * 100) + '%' } })) : null,
      h('div', { className: 'tr-card-m' },
        dueChip(t.due_on),
        t.estimate != null ? h('span', { className: 'tr-chip' }, t.estimate + ' pont') : null,
        pr ? h('span', { className: 'tr-chip' }, '☑️ ' + pr.done + '/' + pr.total) : null,
        (t.files || []).length ? h('span', { className: 'tr-chip ok' }, '📎 ' + t.files.length) : null,
        t.comments ? h('span', { className: 'tr-chip' }, '💬 ' + t.comments) : null));
  }

  // ---------- board ----------
  function Board(props) {
    var canWrite = props.canWrite;
    var dS = useState(null), drag = dS[0], setDrag = dS[1];
    // the dragged task also lives in a ref: dragover/drop can arrive before React re-renders with the new state
    var dragRef = useRef(null);
    var oS = useState(null), over = oS[0], setOver = oS[1];
    function startDrag(t) { dragRef.current = t; setDrag(t); }
    function endDrag() { dragRef.current = null; setDrag(null); setOver(null); }
    var aS = useState(''), addTo = aS[0], setAddTo = aS[1];
    var nS = useState(''), newTitle = nS[0], setNewTitle = nS[1];

    function drop(col) {
      var t = dragRef.current;
      endDrag();
      if (!t || t.status === col) return;
      sb.rpc('team_task_status', { p_task: t.id, p_status: col, p_ord: Date.now() / 1000 }).then(function (r) {
        if (r && r.error) { toast(r.error.message, { kind: 'error' }); return; }
        props.onChange();
      });
    }
    function add(col) {
      if (newTitle.trim().length < 2) { setAddTo(''); setNewTitle(''); return; }
      sb.rpc('team_task_save', { p_team: props.teamId, p_task: { title: newTitle, sprint_id: props.sprintId } }).then(function (r) {
        if (r && r.error) { toast(r.error.message, { kind: 'error' }); return; }
        var id = r.data;
        setNewTitle('');
        if (col === 'todo' || !id) { props.onChange(); return; }
        sb.rpc('team_task_status', { p_task: id, p_status: col, p_ord: Date.now() / 1000 }).then(function () { props.onChange(); });
      });
    }
    return h('div', { className: 'tr-board' }, COLS.map(function (c) {
      var list = props.tasks.filter(function (t) { return t.status === c.k; });
      return h('div', {
        key: c.k, className: 'tr-col' + (over === c.k ? ' over' : ''),
        onDragOver: function (e) { if (dragRef.current) { e.preventDefault(); setOver(c.k); } },
        onDragLeave: function () { setOver(function (o) { return o === c.k ? null : o; }); },
        onDrop: function (e) { e.preventDefault(); drop(c.k); }
      },
        h('div', { className: 'tr-col-h ' + c.k },
          h('span', { className: 'tr-dot ' + c.k }), h('b', null, c.t), h('span', { className: 'tr-count' }, list.length)),
        list.map(function (t) {
          return h(Card, { key: t.id, task: t, canWrite: canWrite, dragging: !!(drag && drag.id === t.id),
            onOpen: props.onOpen, onDragStart: function () { startDrag(t); }, onDragEnd: endDrag });
        }),
        !list.length ? h('p', { className: 'tr-empty' }, c.hint) : null,
        canWrite ? (addTo === c.k
          ? h('div', { className: 'tr-quick' },
            h('input', { className: 'in sm', autoFocus: true, value: newTitle, placeholder: 'Feladat címe…',
              onChange: function (e) { setNewTitle(e.target.value); },
              onKeyDown: function (e) { if (e.key === 'Enter') add(c.k); if (e.key === 'Escape') { setAddTo(''); setNewTitle(''); } } }),
            h('button', { type: 'button', className: 'btn pri sm', onMouseDown: function (e) { e.preventDefault(); add(c.k); } }, 'OK'))
          : h('button', { type: 'button', className: 'tr-addbtn', onClick: function () { setAddTo(c.k); setNewTitle(''); } }, '+ Feladat')) : null);
    }));
  }

  // ---------- list ----------
  function ListView(props) {
    var gS = useState('status'), group = gS[0], setGroup = gS[1];
    var tasks = props.tasks, groups = {}, order = [];
    if (group === 'status') {
      COLS.forEach(function (c) { groups[c.t] = tasks.filter(function (t) { return t.status === c.k; }); order.push(c.t); });
    } else if (group === 'assignee') {
      props.members.forEach(function (m) { groups[m.name] = tasks.filter(function (t) { return t.assignee === m.user_id; }); order.push(m.name); });
      groups['Nincs felelős'] = tasks.filter(function (t) { return !t.assignee; }); order.push('Nincs felelős');
    } else {
      PRIOS.forEach(function (p) { var n = p.ic + ' ' + p.t; groups[n] = tasks.filter(function (t) { return (t.priority || 'normal') === p.k; }); order.push(n); });
    }
    return h('div', { className: 'tr-list' },
      h('div', { className: 'tr-list-h' },
        h('span', { className: 'co-note' }, 'Csoportosítás:'),
        h('span', { className: 'seg' }, [['status', 'Állapot'], ['assignee', 'Felelős'], ['priority', 'Prioritás']].map(function (g) {
          return h('button', { key: g[0], type: 'button', className: group === g[0] ? 'on' : '', onClick: function () { setGroup(g[0]); } }, g[1]);
        }))),
      order.map(function (name) {
        var list = groups[name];
        if (!list || !list.length) return null;
        return h('div', { key: name, className: 'tr-lgroup' },
          h('div', { className: 'tr-lgroup-h' }, h('b', null, name), h('span', { className: 'tr-count' }, list.length)),
          list.map(function (t) {
            var pr = checkProgress(t.checklist), prio = PRIO_BY[t.priority || 'normal'];
            return h('div', { key: t.id, className: 'tr-lrow', role: 'button', tabIndex: 0,
              onClick: function () { props.onOpen(t.id); },
              onKeyDown: function (e) { if (e.key === 'Enter') props.onOpen(t.id); } },
              h('span', { className: 'tr-prio ' + prio.k, title: prio.t }, prio.ic),
              h('span', { className: 'tr-lrow-t' }, t.title),
              (t.tags || []).length ? h('span', { className: 'tr-tags' }, t.tags.map(function (g) { return h('span', { key: g, className: 'tr-tag' }, g); })) : null,
              h('span', { className: 'sp' }),
              pr ? h('span', { className: 'tr-chip' }, '☑️ ' + pr.done + '/' + pr.total) : null,
              (t.files || []).length ? h('span', { className: 'tr-chip ok' }, '📎 ' + t.files.length) : null,
              dueChip(t.due_on),
              h('span', { className: 'tr-chip status ' + t.status }, COLS[COL_BY[t.status]].t),
              t.assignee_name ? h(Avatar, { name: t.assignee_name, sm: true }) : h('span', { className: 'co-note' }, '—'));
          }));
      }));
  }

  // ---------- calendar ----------
  function Calendar(props) {
    var sprint = props.sprint || {}, tasks = props.tasks, days = [];
    if (sprint.starts_on) {
      for (var i = 0; i < 7; i++) {
        var d = new Date(sprint.starts_on + 'T00:00:00'); d.setDate(d.getDate() + i);
        days.push(d.toISOString().slice(0, 10));
      }
    }
    var overdue = tasks.filter(function (t) { return t.due_on && t.status !== 'done' && daysUntil(t.due_on) < 0; });
    var undated = tasks.filter(function (t) { return !t.due_on; });
    var names = ['hétfő', 'kedd', 'szerda', 'csütörtök', 'péntek', 'szombat', 'vasárnap'];
    return h('div', { className: 'tr-cal-wrap' },
      overdue.length ? h('div', { className: 'co-card tr-late' },
        h('b', null, '⚠ Lejárt határidő (' + overdue.length + ')'),
        h('div', { className: 'tr-late-list' }, overdue.map(function (t) {
          return h('button', { key: t.id, type: 'button', className: 'tr-mini', onClick: function () { props.onOpen(t.id); } },
            h('span', null, t.title), h('span', { className: 'co-note' }, fmtDay(t.due_on)));
        }))) : null,
      h('div', { className: 'tr-cal' }, days.map(function (d, i) {
        var list = tasks.filter(function (t) { return t.due_on === d; });
        return h('div', { key: d, className: 'tr-day' + (d === today() ? ' today' : '') },
          h('div', { className: 'tr-day-h' }, h('b', null, names[i]), h('span', { className: 'co-note' }, fmtDay(d))),
          list.map(function (t) {
            var prio = PRIO_BY[t.priority || 'normal'];
            return h('button', { key: t.id, type: 'button', className: 'tr-mini' + (t.status === 'done' ? ' done' : ''),
              onClick: function () { props.onOpen(t.id); } },
              h('span', { className: 'tr-prio ' + prio.k }, prio.ic), h('span', null, t.title));
          }),
          !list.length ? h('span', { className: 'tr-empty' }, '—') : null);
      })),
      undated.length ? h('div', { className: 'co-card' },
        h('b', null, '📥 Határidő nélkül (' + undated.length + ')'),
        h('div', { className: 'tr-late-list' }, undated.map(function (t) {
          return h('button', { key: t.id, type: 'button', className: 'tr-mini', onClick: function () { props.onOpen(t.id); } }, t.title);
        }))) : null);
  }

  // ---------- ceremonies ----------
  var FORMS = {
    daily: [['did', 'Mit csináltam a múlt alkalom óta?'], ['will', 'Mit csinálok a következőig?'], ['blocker', 'Mi akaszt meg?']],
    planning: [['note', 'Mit vállalok ebben a sprintben?']],
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
    var missing = (props.members || []).filter(function (m) {
      return !(props.events || []).some(function (e) { return e.kind === kind && e.author === m.user_id && (kind !== 'daily' || e.day === today()); });
    });
    return h('div', { className: 'tr-cer' },
      h('div', { className: 'co-card' },
        h('div', { className: 'tr-cer-h' }, h('b', null, KIND_HU[kind]),
          kind === 'daily' ? h('span', { className: 'co-note' }, 'ma · ' + fmtDay(today())) : null,
          h('span', { className: 'sp' }),
          mine ? h('span', { className: 'tr-chip ok' }, '✓ kitöltötted') : null),
        canWrite ? h('div', { className: 'tr-cer-form' },
          FORMS[kind].map(function (f) {
            return h('div', { key: f[0] },
              h('label', { className: 'form-l' }, f[1]),
              h('textarea', { className: 'in', rows: 2, value: val[f[0]] || '',
                onChange: function (e) { var v = e.target.value; setVal(function (s) { var n = Object.assign({}, s); n[f[0]] = v; return n; }); } }));
          }),
          h('button', { type: 'button', className: 'btn pri sm', disabled: busy, onClick: save }, mine ? 'Frissítem' : 'Rögzítem')) : null,
        missing.length ? h('p', { className: 'co-note' }, 'Még hiányzik: ' + missing.map(function (m) { return m.name; }).join(', ')) : null),
      others.length ? h('div', { className: 'tr-cer-list' }, others.map(function (e) {
        return h('div', { key: e.id, className: 'co-card tr-cer-i' },
          h('div', { className: 'tr-cer-who' }, h(Avatar, { name: e.author_name, sm: true }), h('b', null, e.author_name || '—'),
            h('span', { className: 'co-note' }, fmtDay(e.day))),
          FORMS[kind].map(function (f) {
            var v = (e.payload || {})[f[0]];
            return v ? h('p', { key: f[0], className: 'tr-cer-p' }, h('span', { className: 'co-note' }, f[1] + ' '), v) : null;
          }));
      })) : null);
  }

  // ---------- activity ----------
  function Stats(props) {
    var rows = props.stats || [];
    return h('div', { className: 'co-card' },
      h('b', null, '📊 Ki mennyit tett hozzá'),
      h('p', { className: 'co-note' }, 'A csapat teljes működésére: kiosztott és kész feladatok, feltöltött bizonyítékok, hozzászólások, kitöltött dailyk és retrók.'),
      h('div', { className: 'tr-stats-wrap' },
        h('table', { className: 'mem-table' },
          h('thead', null, h('tr', null, h('th', null, 'Tag'), h('th', null, 'Szerep'), h('th', null, 'Feladat'),
            h('th', null, 'Kész'), h('th', null, 'Bizonyíték'), h('th', null, '💬'), h('th', null, 'Daily'), h('th', null, 'Retro'), h('th', null, 'Utoljára'))),
          h('tbody', null, rows.map(function (r) {
            var idle = !r.last_seen;
            return h('tr', { key: r.user_id, className: idle ? 'tr-idle' : '' },
              h('td', null, h('span', { className: 'tr-who' }, h(Avatar, { name: r.name, sm: true }), r.name || '—')),
              h('td', null, ROLE_HU[r.role] || r.role),
              h('td', { className: 'tr-n' }, r.assigned),
              h('td', { className: 'tr-n' }, r.done),
              h('td', { className: 'tr-n' }, r.files),
              h('td', { className: 'tr-n' }, r.comments == null ? 0 : r.comments),
              h('td', { className: 'tr-n' }, r.dailies),
              h('td', { className: 'tr-n' }, r.retros),
              h('td', null, idle ? h('span', { className: 'tr-chip' }, 'még semmi') : fmtWhen(r.last_seen)));
          })))));
  }

  // ---------- the room ----------
  var VIEWS = [
    { k: 'board', t: 'Tábla', ic: '🗂' },
    { k: 'list', t: 'Lista', ic: '📋' },
    { k: 'calendar', t: 'Naptár', ic: '📅' },
    { k: 'planning', t: 'Planning', ic: '🧭' },
    { k: 'daily', t: 'Daily', ic: '☀️' },
    { k: 'retro', t: 'Retro', ic: '🔁' },
    { k: 'stats', t: 'Aktivitás', ic: '📊' }
  ];

  function TeamRoom(props) {
    var dS = useState(null), data = dS[0], setData = dS[1];
    var eS = useState(''), schema = eS[0], setSchema = eS[1];
    var vS = useState('board'), view = vS[0], setView = vS[1];
    var gS = useState(''), goal = gS[0], setGoal = gS[1];
    var oS = useState(null), openId = oS[0], setOpenId = oS[1];
    var qS = useState(''), term = qS[0], setTerm = qS[1];
    var mS = useState(false), onlyMine = mS[0], setOnlyMine = mS[1];
    var pS = useState(''), prioF = pS[0], setPrioF = pS[1];
    var uS = useState(''), whoF = uS[0], setWhoF = uS[1];

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
      'Az adminisztrátornak le kell futtatnia a ', h('code', null, 'backend/migration-125-team-room.sql'), ' és a ',
      h('code', null, 'migration-126-team-room-pro.sql'), ' fájlt.');
    if (!data) return h('div', { className: 'soon' }, 'Betöltés…');
    if (data.pending) return h('div', { className: 'soon' },
      h('button', { type: 'button', className: 'btn sm', onClick: props.onClose }, '‹ Vissza'),
      h('p', null, 'A munkatér akkor nyílik meg, ha az oktató jóváhagyta a csapat összeállítását.'));

    var team = data.team || {}, sprint = data.sprint || {}, canWrite = !!data.can_write;
    var members = data.members || [], events = data.events || [], all = data.tasks || [];
    var q = term.trim().toLowerCase();
    var tasks = all.filter(function (t) {
      if (onlyMine && t.assignee !== props.meId) return false;
      if (whoF && t.assignee !== whoF) return false;
      if (prioF && (t.priority || 'normal') !== prioF) return false;
      if (!q) return true;
      return (t.title || '').toLowerCase().indexOf(q) >= 0
        || (t.detail || '').toLowerCase().indexOf(q) >= 0
        || (t.tags || []).join(' ').toLowerCase().indexOf(q) >= 0;
    }).sort(function (a, b) {
      return (PRIO_ORDER[a.priority || 'normal'] - PRIO_ORDER[b.priority || 'normal']) || (a.ord - b.ord);
    });
    var openTask = openId ? all.filter(function (t) { return t.id === openId; })[0] : null;
    var done = all.filter(function (t) { return t.status === 'done'; }).length;
    var pct = all.length ? Math.round(done / all.length * 100) : 0;
    var filtered = tasks.length !== all.length;
    var myDaily = events.filter(function (e) { return e.kind === 'daily' && e.author === props.meId && e.day === today(); })[0];
    var myPlan = events.filter(function (e) { return e.kind === 'planning' && e.author === props.meId; })[0];
    var myRetro = events.filter(function (e) { return e.kind === 'retro' && e.author === props.meId; })[0];
    var boardish = view === 'board' || view === 'list' || view === 'calendar';

    function saveGoal() {
      sb.rpc('team_sprint_goal', { p_sprint: sprint.id, p_goal: goal }).then(function (r) {
        if (r && r.error) { toast(r.error.message, { kind: 'error' }); return; }
        toast('✓ Sprintcél mentve', { kind: 'ok' }); load();
      });
    }
    return h('div', { className: 'tr-room' },
      h('aside', { className: 'tr-rail' },
        h('button', { type: 'button', className: 'btn sm tr-back', onClick: props.onClose }, '‹ Csapatok'),
        h('div', { className: 'tr-rail-team' },
          h('b', null, team.name),
          h('span', { className: 'co-note' }, sprint.idx + '. sprint · ' + fmtDay(sprint.starts_on) + ' – ' + fmtDay(sprint.ends_on))),
        h('div', { className: 'tr-progress' },
          h('div', { className: 'tr-bar' }, h('i', { style: { width: pct + '%' } })),
          h('span', { className: 'co-note' }, done + ' / ' + all.length + ' kész')),
        h('nav', { className: 'tr-nav' }, VIEWS.map(function (v) {
          return h('button', { key: v.k, type: 'button', className: 'tr-nav-i' + (view === v.k ? ' on' : ''),
            onClick: function () { setView(v.k); } }, h('span', { className: 'ic' }, v.ic), h('span', null, v.t));
        })),
        h('div', { className: 'tr-rail-people' },
          h('span', { className: 'co-note' }, 'Csapat'),
          members.map(function (m) {
            return h('button', { key: m.user_id, type: 'button', className: 'tr-person' + (whoF === m.user_id ? ' on' : ''),
              title: (m.responsibility || 'nincs megadott felelősség') + ' — kattints a feladataiért',
              onClick: function () { setWhoF(whoF === m.user_id ? '' : m.user_id); if (!boardish) setView('board'); } },
              h(Avatar, { name: m.name, sm: true, on: whoF === m.user_id }),
              h('span', { className: 'tr-person-n' }, m.name),
              h('span', { className: 'co-note' }, ROLE_HU[m.role] || ''));
          })),
        canWrite ? null : h('span', { className: 'tr-chip acc tr-ro' }, '👁 betekintés')),

      h('section', { className: 'tr-main' },
        h('div', { className: 'tr-goalbar' },
          h('span', { className: 'tr-goal-l' }, 'Sprintcél'),
          h('input', { className: 'in', value: goal, disabled: !canWrite, maxLength: 300,
            placeholder: 'Mit akartok a hét végére elérni?', onChange: function (e) { setGoal(e.target.value); },
            onKeyDown: function (e) { if (e.key === 'Enter') saveGoal(); },
            onBlur: function () { if (canWrite && goal !== (sprint.goal || '')) saveGoal(); } })),

        boardish ? h('div', { className: 'tr-tools' },
          h('input', { className: 'in sm tr-search', value: term, placeholder: '🔍 Keresés a feladatok közt…',
            'aria-label': 'Keresés', onChange: function (e) { setTerm(e.target.value); } }),
          h('button', { type: 'button', className: 'tr-toggle' + (onlyMine ? ' on' : ''), onClick: function () { setOnlyMine(!onlyMine); } }, '🙋 Csak az enyém'),
          h('select', { className: 'in sm', value: prioF, 'aria-label': 'Prioritás szűrő', onChange: function (e) { setPrioF(e.target.value); } },
            h('option', { value: '' }, 'Minden prioritás'),
            PRIOS.map(function (p) { return h('option', { key: p.k, value: p.k }, p.ic + ' ' + p.t); })),
          whoF ? h('button', { type: 'button', className: 'tr-toggle on', onClick: function () { setWhoF(''); } },
            '👤 ' + ((members.filter(function (m) { return m.user_id === whoF; })[0] || {}).name || '') + ' ×') : null,
          filtered ? h('span', { className: 'co-note' }, tasks.length + ' / ' + all.length + ' feladat') : null) : null,

        view === 'board' ? h(Board, { tasks: tasks, canWrite: canWrite, teamId: props.teamId, sprintId: sprint.id,
            onOpen: setOpenId, onChange: load })
          : view === 'list' ? h(ListView, { tasks: tasks, members: members, onOpen: setOpenId })
            : view === 'calendar' ? h(Calendar, { tasks: tasks, sprint: sprint, onOpen: setOpenId })
              : view === 'stats' ? h(Stats, { stats: data.stats })
                : h(Ceremony, { kind: view, teamId: props.teamId, canWrite: canWrite, events: events, members: members,
                    onChange: load, mine: view === 'daily' ? myDaily : view === 'planning' ? myPlan : myRetro })),

      openTask ? h(TaskDrawer, { task: openTask, members: members, canWrite: canWrite, teamId: props.teamId,
        courseId: team.course_id, meId: props.meId, onClose: function () { setOpenId(null); }, onChange: load }) : null);
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
      h('div', { className: 'tr-stats-wrap' },
        h('table', { className: 'mem-table' },
          h('thead', null, h('tr', null, h('th', null, 'Csapat'), h('th', null, 'Fő'), h('th', null, 'Feladat'),
            h('th', null, 'Kész'), h('th', null, 'Folyamatban'), h('th', null, 'Bizonyíték'),
            h('th', null, 'Daily (7 nap)'), h('th', null, 'Retro'), h('th', null, 'Néma tag'), h('th', null, 'Utolsó mozgás'), h('th', null, ''))),
          h('tbody', null, rows.map(function (r) {
            var pct = r.tasks ? Math.round(r.done / r.tasks * 100) : 0;
            return h('tr', { key: r.team_id },
              h('td', null, r.name, r.status !== 'approved' ? h('span', { className: 'tr-chip' }, ' nem jóváhagyott') : null),
              h('td', { className: 'tr-n' }, r.members),
              h('td', { className: 'tr-n' }, r.tasks),
              h('td', null, h('span', { className: 'tr-mini-bar' }, h('i', { style: { width: pct + '%' } })), ' ', r.done),
              h('td', { className: 'tr-n' }, r.doing),
              h('td', { className: 'tr-n' }, r.files),
              h('td', { className: 'tr-n' }, r.dailies_7d),
              h('td', { className: 'tr-n' }, r.retros),
              h('td', { className: 'tr-n' }, r.inactive_members ? h('span', { className: 'tr-chip acc' }, r.inactive_members) : '0'),
              h('td', null, fmtWhen(r.last_activity)),
              h('td', null, r.status === 'approved'
                ? h('button', { type: 'button', className: 'btn sm', onClick: function () { props.onOpen(r.team_id); } }, 'Megnyitom')
                : null));
          })))));
  }

  window.PRTeamRoom = { TeamRoom: TeamRoom, TeamsOverview: TeamsOverview };
})();
