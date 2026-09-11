/* Publify — personal ToDo Kanban (header-pinned).
 * One board for a user's own tasks across every research project + standalone personal tasks
 * (research_todos, migration-46). Human↔AI columns from (assignee, status), same language as the
 * protocol-step board. Filter by research project / assignee / text. Add / edit / drag / delete tasks.
 * The runner never touches these — they are hand-owned ToDos, not protocol steps. */
(function () {
  'use strict';
  var h = React.createElement;
  var useState = React.useState, useEffect = React.useEffect;
  var BE = window.PR_BACKEND, sb = BE && BE.sb;

  function toast(m, o) { try { window.PRUI && window.PRUI.toast(m, o); } catch (e) { } }
  var PALETTE = ['#4f46e5', '#0e9f6e', '#d9760b', '#db2777', '#0891b2', '#7c3aed', '#ca8a04', '#dc2626'];
  function colorFor(id) { var x = 0; id = String(id || ''); for (var i = 0; i < id.length; i++) x = (x * 31 + id.charCodeAt(i)) >>> 0; return PALETTE[x % PALETTE.length]; }

  var BOARD_COLS = [
    { key: 'todo-human', title: 'ToDo — Human', who: 'human' },
    { key: 'todo-ai', title: 'ToDo — AI', who: 'ai' },
    { key: 'prog-ai', title: 'In progress — AI', who: 'ai' },
    { key: 'prog-human', title: 'In progress — Human', who: 'human' },
    { key: 'blocked', title: 'Blocked', who: 'any' },
    { key: 'done-ai', title: 'Done by AI', who: 'ai' },
    { key: 'done-human', title: 'Done by Human', who: 'human' }
  ];
  var BCOL_IC = { 'todo-human': '📋', 'todo-ai': '📋', 'prog-ai': '⚙️', 'prog-human': '✋', 'blocked': '⏸', 'done-ai': '✅', 'done-human': '✅' };
  var PRIO = { low: { l: 'Low', c: '#0e9f6e' }, med: { l: 'Med', c: '#d9760b' }, high: { l: 'High', c: '#dc2626' } };
  function assigneeOf(t) { return t.assignee === 'human' ? 'human' : 'ai'; }
  function todoCol(t) {
    var a = assigneeOf(t), s = t.status;
    if (s === 'done') return a === 'human' ? 'done-human' : 'done-ai';
    if (s === 'doing') return a === 'human' ? 'prog-human' : 'prog-ai';
    if (s === 'blocked') return 'blocked';
    return a === 'human' ? 'todo-human' : 'todo-ai';
  }
  function colPatch(key) {
    return key === 'todo-human' ? { assignee: 'human', status: 'todo' }
      : key === 'todo-ai' ? { assignee: 'ai', status: 'todo' }
        : key === 'prog-ai' ? { assignee: 'ai', status: 'doing' }
          : key === 'prog-human' ? { assignee: 'human', status: 'doing' }
            : key === 'blocked' ? { status: 'blocked' }
              : key === 'done-ai' ? { assignee: 'ai', status: 'done' }
                : key === 'done-human' ? { assignee: 'human', status: 'done' } : null;
  }
  // AI protocol steps (research_protocol_steps) appear here read-only, so "My tasks" is ALL my tasks.
  // Their status vocab (todo|queued|running|blocked|failed|done|skipped) maps to the same columns.
  var STEP_ICON = { data: '🗄️', preprocess: '🧹', train: '🏋️', eval: '📊', analysis: '🔬', figure: '📈', writeup: '✍️', custom: '•' };
  function stepColOf(s) {
    var a = assigneeOf(s), st = s.status;
    if (st === 'done') return a === 'human' ? 'done-human' : 'done-ai';
    if (st === 'running') return a === 'human' ? 'prog-human' : 'prog-ai';
    if (st === 'blocked' || st === 'failed' || (s.needs_approval && (st === 'todo' || st === 'queued'))) return 'blocked';
    return a === 'human' ? 'todo-human' : 'todo-ai';
  }
  // Elicit jobs (elicit_jobs: systematic reviews + reports) appear read-only as AI cards.
  var ELICIT_KIND = { sysreview: '🔬 Systematic Review', report: '📄 Report' };
  function elicitColOf(j) {
    if (j.status === 'completed') return 'done-ai';
    if (j.status === 'failed' || j.status === 'pausedForInsufficientQuota') return 'blocked';
    return 'prog-ai';   // processing | unknown → in progress
  }
  function elicitStatusLbl(j) {
    return j.status === 'completed' ? 'Completed' : j.status === 'failed' ? 'Failed'
      : j.status === 'pausedForInsufficientQuota' ? 'Paused (quota)' : (j.stage ? 'Running' : 'Starting');
  }

  // ---------- add / edit task modal ----------
  function TaskModal(props) {
    var init = props.task || {};
    var fS = useState({
      title: init.title || '', notes: init.notes || '', project_id: init.project_id || props.defaultProject || '',
      assignee: init.assignee || 'human', status: init.status || 'todo', priority: init.priority || '', due: init.due || ''
    }), f = fS[0], setF = fS[1];
    var bS = useState(false), busy = bS[0], setBusy = bS[1];
    function up(k, v) { setF(Object.assign({}, f, (function () { var o = {}; o[k] = v; return o; })())); }
    function save() {
      if (props.readOnly) return;
      if (!f.title.trim()) return;
      setBusy(true);
      var row = {
        title: f.title.trim(), notes: f.notes.trim() || null, project_id: f.project_id || null,
        assignee: f.assignee, status: f.status, priority: f.priority || null, due: f.due || null, updated_at: new Date().toISOString()
      };
      var p;
      if (props.task) p = sb.from('research_todos').update(row).eq('id', props.task.id);
      else { row.owner_id = props.meId; row.created_by = props.meId; p = sb.from('research_todos').insert(row); }
      p.then(function (r) {
        setBusy(false);
        if (r && r.error) { toast('Could not save: ' + r.error.message, { kind: 'error' }); return; }
        props.onSaved();
      });
    }
    function del() {
      if (props.readOnly || !props.task) return;
      window.PRUI.confirm({ title: 'Delete this task?', body: props.task.title, danger: true, confirmLabel: 'Delete' }).then(function (ok) {
        if (!ok) return;
        sb.from('research_todos').delete().eq('id', props.task.id).then(function (r) { if (r && r.error) { toast(r.error.message, { kind: 'error' }); return; } props.onSaved(); });
      });
    }
    useEffect(function () { function esc(e) { if (e.key === 'Escape') props.onClose(); } window.addEventListener('keydown', esc); return function () { window.removeEventListener('keydown', esc); }; });
    var seg = function (k, opts) {
      return h('div', { className: 'kb-seg' }, opts.map(function (o) {
        return h('button', { key: o[0], type: 'button', className: f[k] === o[0] ? 'on' : '', onClick: function () { up(k, o[0]); } }, o[1]);
      }));
    };
    function fmt(x) { try { var d = new Date(x); return isNaN(d) ? '—' : d.toLocaleString(); } catch (e) { return '—'; } }
    var projName = f.project_id ? (((props.projects || []).filter(function (p) { return p.id === f.project_id; })[0] || {}).title || 'Project') : 'Personal (no project)';
    return h('div', { className: 'kb-scrim', onClick: props.onClose },
      h('div', { className: 'kb-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': props.task ? 'Task details' : 'Add task', onClick: function (e) { e.stopPropagation(); } },
        h('div', { className: 'kb-mh' }, h('b', null, props.task ? (props.readOnly ? 'Task details (read-only)' : 'Task details') : 'Add task'), h('button', { className: 'kb-x', 'aria-label': 'Close', onClick: props.onClose }, '×')),
        h('div', { className: 'kb-mb' },
          h('label', { className: 'kb-l' }, 'Title *'),
          h('input', { className: 'kb-in', autoFocus: true, value: f.title, onChange: function (e) { up('title', e.target.value); }, onKeyDown: function (e) { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save(); }, placeholder: 'What needs doing?' }),
          h('label', { className: 'kb-l' }, 'Notes'),
          h('textarea', { className: 'kb-in', rows: 3, value: f.notes, onChange: function (e) { up('notes', e.target.value); }, placeholder: 'Optional detail…' }),
          h('label', { className: 'kb-l' }, 'Research project'),
          h('select', { className: 'kb-in', value: f.project_id, onChange: function (e) { up('project_id', e.target.value); } },
            h('option', { value: '' }, '— No project (personal) —'),
            (props.projects || []).map(function (p) { return h('option', { key: p.id, value: p.id }, p.title); })),
          h('div', { className: 'kb-row' },
            h('div', null, h('label', { className: 'kb-l' }, 'Owner'), seg('assignee', [['human', '👤 Human'], ['ai', '🤖 AI']])),
            h('div', null, h('label', { className: 'kb-l' }, 'Status'), seg('status', [['todo', 'ToDo'], ['doing', 'In progress'], ['blocked', 'Blocked'], ['done', 'Done']]))
          ),
          h('div', { className: 'kb-row' },
            h('div', null, h('label', { className: 'kb-l' }, 'Priority'), seg('priority', [['', 'None'], ['low', 'Low'], ['med', 'Med'], ['high', 'High']])),
            h('div', null, h('label', { className: 'kb-l' }, 'Due date'), h('input', { className: 'kb-in', type: 'date', value: f.due || '', onChange: function (e) { up('due', e.target.value); } }))
          ),
          props.task ? h('div', { className: 'kb-meta' },
            h('div', null, h('span', null, 'Project'), h('span', null, projName)),
            props.task.created_at ? h('div', null, h('span', null, 'Created'), h('span', null, fmt(props.task.created_at))) : null,
            props.task.updated_at ? h('div', null, h('span', null, 'Updated'), h('span', null, fmt(props.task.updated_at))) : null
          ) : null
        ),
        h('div', { className: 'kb-mf' },
          (props.task && !props.readOnly) ? h('button', { className: 'kb-btn danger', onClick: del }, 'Delete') : h('span'),
          h('div', { style: { display: 'flex', gap: 8 } },
            h('button', { className: 'kb-btn', onClick: props.onClose }, props.readOnly ? 'Close' : 'Cancel'),
            props.readOnly ? null : h('button', { className: 'kb-btn pri', disabled: busy || !f.title.trim(), onClick: save }, busy ? 'Saving…' : (props.task ? 'Save' : 'Add task')))
        )
      )
    );
  }

  // AI protocol steps are edited with the SAME editor the Protocol page uses (window.PRTaskEditor from
  // task-editor.js) so "My tasks" offers identical settings — title/kind/instruction/inputs/outputs/
  // acceptance/command/est/attachments/depends-on/approval + ✨ Refine, plus board fields (status/owner).

  // Admin "view as": opened from Admin with ?adminView=1 + a stored target. Admin-only (a non-admin who
  // forges the localStorage gets nothing — the check below AND RLS on research_todos both block it).
  // Returns the VIEWED user {id,name,email} so "My tasks" shows THAT user's tasks, not the admin's own.
  function adminTargetUser() {
    try {
      if (!/[?&]adminView=1/.test(location.search)) return null;
      var u = BE && BE.user; if (!u) return null;
      if (!(u.role === 'admin' || (BE.profiles && BE.profiles[u.id] && BE.profiles[u.id].role === 'admin'))) return null;
      var t = JSON.parse(localStorage.getItem('pr-admin-view') || 'null');
      return t && t.id ? t : null;
    } catch (e) { return null; }
  }

  // ---------- admin: every user's tasks — cut by university / researcher / project type / project / day, export as .md ----------
  function isAdminUser() { var u = BE && BE.user; return !!(u && (u.role === 'admin' || (BE.profiles && BE.profiles[u.id] && BE.profiles[u.id].role === 'admin'))); }
  var NO_UNI = '— nincs megadva —';
  var AF0 = { uni: '', user: '', type: 'all', proj: '', from: '', to: '', st: 'all' };
  var DONE_ST = { done: 1, completed: 1, skipped: 1 };
  var PTYPE_HU = { research: 'Research', autopilot: 'Autopilot', personal: 'Személyes' };
  var ST_HU = { todo: 'teendő', queued: 'sorban áll', running: 'fut', doing: 'folyamatban', blocked: 'blokkolt', failed: 'sikertelen', done: 'kész', skipped: 'kihagyva', completed: 'kész', processing: 'fut', pausedForInsufficientQuota: 'szünetel (kvóta)' };
  var KIND_HU = { data: 'adat', preprocess: 'előfeldolgozás', train: 'tanítás', eval: 'kiértékelés', analysis: 'elemzés', figure: 'ábra', writeup: 'írás', custom: 'egyéb' };
  function fold(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
  function dayOf(x) { try { var d = new Date(x); return isNaN(d) ? '' : d.toLocaleDateString('sv-SE'); } catch (e) { return ''; } }   // local YYYY-MM-DD
  // profiles.affiliation is free text: one institution arrives as "Széchenyi István University, Hungary", "Széchenyi István
  // Egyetem (SZE), Hungary", "Neumann János Egyetem — demó fiók"… Match it against the onboarding list (universities.js) so
  // every spelling lands on ONE key — otherwise the filter splits a university in three.
  var UNI_IDX = null;
  function uniIndex() {
    if (UNI_IDX) return UNI_IDX;
    UNI_IDX = [];
    (window.PR_UNIVERSITIES || []).forEach(function (e) {
      var m = String(e).match(/^(.*?)\s*\(([^)]+)\)\s*[–-]\s*([^,]+)/);   // "English (ABBR) – Magyar név, Város, Hungary"
      if (!m) return;
      var label = m[3].trim() + ' (' + m[2].trim() + ')';
      [fold(m[1]).trim(), fold(m[3]).trim()].forEach(function (k) { if (k.length > 6) UNI_IDX.push({ k: k, label: label }); });
    });
    UNI_IDX.sort(function (a, b) { return b.k.length - a.k.length; });   // longest key first: "Medical University of X" beats "University of X"
    return UNI_IDX;
  }
  function uniOf(aff) {
    var raw = String(aff || '').trim(); if (!raw) return NO_UNI;
    var f = fold(raw), idx = uniIndex();
    for (var i = 0; i < idx.length; i++) if (f.indexOf(idx[i].k) >= 0) return idx[i].label;
    return raw.replace(/\s+[—–-]\s+dem[oó].*$/i, '').replace(/,\s*(hungary|magyarország)\s*$/i, '').trim() || raw;
  }

  // ---- .md export: a self-contained work package another agent can take over ----
  var AGENT_BRIEF = [
    '## Utasítás a feldolgozó agentnek',
    '',
    'Ez a csomag a Publify kutatásmenedzsment-rendszerből exportált feladatokat tartalmazza, projektenként csoportosítva, a projekt kontextusával együtt.',
    '',
    '**A feladatod:** dolgozd ki a csomag **nyitott** feladatait (állapot: teendő, sorban áll, fut, folyamatban, blokkolt, sikertelen), projektenként haladva.',
    '',
    '1. Minden feladat előtt olvasd el a projekt kontextusát (cél, terület, kulcsszavak, protokoll). A feladat csak ebben a keretben értelmezhető.',
    '2. A „Függ” mező a feladat előfeltételeit adja meg (T-azonosítók). Ezek sorrendjében haladj: ne kezdj bele olyan feladatba, amelynek az előfeltétele nincs kész.',
    '3. Az **Elfogadási kritériumok** határozzák meg, mikor kész egy feladat. Minden kritériumhoz mutass konkrét bizonyítékot (fájl, szám, idézet). Ha egy kritérium nem teljesíthető, írd le, miért — ne jelentsd késznek.',
    '4. **Ne találj ki eredményt.** Ha adat, fájl vagy hozzáférés hiányzik (pl. a „Bemenetek” között említett fájl), jelöld a feladatot blokkoltnak, és írd le, mi kell a folytatáshoz.',
    '5. A „Felelős: Human” feladatokat nem te hajtod végre: készíts elő mindent, amire a kutatónak szüksége lesz (vázlat, ellenőrzőlista, nyitott kérdések).',
    '6. A kész állapotú feladatok csak kontextusként szerepelnek — ne dolgozd ki őket újra.',
    '7. Ahol „Jóváhagyás szükséges” szerepel, a végrehajtás előtt állj meg, és kérj jóváhagyást.',
    '',
    '**Kimenet feladatonként** (a T-azonosítóval kezdve): állapot (kész / részben kész / blokkolt) · mit csináltál · eredmények (fájlok, számok, szövegrészek) · kritériumonként: teljesül-e, és mi a bizonyíték · nyitott kérdések a kutató felé.'
  ].join('\n');
  function cell(v) { return String(v == null ? '' : v).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' '); }
  function oneLine(v, cap) { var t = String(v || '').trim().replace(/\s*\n+\s*/g, ' '); return cap && t.length > cap ? t.slice(0, cap) + '…' : t; }
  function mdList(v) {
    if (v == null || v === '') return '';
    if (Array.isArray(v)) return v.filter(function (x) { return x != null && String(typeof x === 'object' ? JSON.stringify(x) : x).trim(); })
      .map(function (x) { return '- ' + (typeof x === 'object' ? (x.name || x.title || x.path || JSON.stringify(x)) : String(x).trim()); }).join('\n');
    if (typeof v === 'object') return '```json\n' + JSON.stringify(v, null, 2) + '\n```';
    return String(v).trim();
  }
  function mdSec(label, v) { var t = mdList(v); return t ? '\n**' + label + ':**\n' + t + '\n' : ''; }
  function originMd(o) {
    if (!o || typeof o !== 'object') return '';
    var out = [];
    function add(lbl, arr) { (arr || []).forEach(function (g) { var t = typeof g === 'object' && g ? (g.question || g.title || JSON.stringify(g)) : String(g || ''); if (t.trim()) out.push('- ' + lbl + ': ' + oneLine(t, 400)); }); }
    add('Rés', o.gaps); add('Ötlet', o.ideas); add('Review-kérdés', o.reviews);
    return out.length ? '\n**Eredet (miből készült a lépés):**\n' + out.join('\n') + '\n' : '';
  }
  function slugOf(s) { return fold(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'osszes'; }
  function buildTasksMd(list, D, desc) {
    var base = location.href.replace(/[?#].*$/, '').replace(/[^/]*$/, '');
    function nm(uid) { var u = D.users[uid]; return u ? u.name : 'ismeretlen kutató'; }
    function ptitle(pid) { return String((D.projects[pid] || {}).title || ''); }
    function pcreated(pr) { return String((D.prots[pr] || {}).created_at || ''); }
    var TYPE_ORD = { step: 0, todo: 1, study: 2 };
    // university → researcher → project (personal last) → protocol → step order
    var sorted = list.slice().sort(function (a, b) {
      return a.uni.localeCompare(b.uni, 'hu') || nm(a.uid).localeCompare(nm(b.uid), 'hu') || String(a.uid).localeCompare(String(b.uid))
        || (a.pid ? 0 : 1) - (b.pid ? 0 : 1) || ptitle(a.pid).localeCompare(ptitle(b.pid), 'hu') || String(a.pid).localeCompare(String(b.pid))
        || TYPE_ORD[a.type] - TYPE_ORD[b.type]
        || pcreated(a.raw.protocol_id).localeCompare(pcreated(b.raw.protocol_id)) || String(a.raw.protocol_id || '').localeCompare(String(b.raw.protocol_id || ''))
        || (a.raw.ord || 0) - (b.raw.ord || 0) || String(a.raw.created_at || '').localeCompare(String(b.raw.created_at || ''));
    });
    // stable ids, and protocol:ord → id so "Függ" points at tasks inside THIS file
    var tid = {}, byProtOrd = {};
    sorted.forEach(function (it, i) { tid[it.key] = 'T-' + String(i + 1).padStart(3, '0'); if (it.type === 'step') byProtOrd[it.raw.protocol_id + ':' + it.raw.ord] = tid[it.key]; });
    var protsOf = {}; Object.keys(D.prots).forEach(function (k) { var x = D.prots[k]; (protsOf[x.project_id] || (protsOf[x.project_id] = [])).push(x); });
    var nP = {}, nU = {}, nE = {}, open = 0;
    sorted.forEach(function (it) { if (it.pid) nP[it.pid] = 1; if (it.uid) nU[it.uid] = 1; nE[it.uni] = 1; if (!DONE_ST[it.status]) open++; });
    var L = ['# Publify — feladatcsomag', '',
      '> Exportálva: ' + new Date().toLocaleString('hu-HU') + ' · ' + sorted.length + ' feladat (' + open + ' nyitott) · ' + Object.keys(nP).length + ' projekt · ' + Object.keys(nU).length + ' kutató · ' + Object.keys(nE).length + ' egyetem  ',
      '> Szűrők: ' + (desc.length ? desc.join(' · ') : 'nincs — minden feladat'), '', AGENT_BRIEF, '',
      '## Összesítő', '', '| Projekt | Típus | Kutató | Egyetem | Nyitott | Kész |', '|---|---|---|---|---:|---:|'];
    var rows = {}, order = [];
    sorted.forEach(function (it) { var k = it.pid || ('_' + it.uid); if (!rows[k]) { rows[k] = { it: it, open: 0, done: 0 }; order.push(k); } rows[k][DONE_ST[it.status] ? 'done' : 'open']++; });
    order.forEach(function (k) { var r = rows[k], it = r.it; L.push('| ' + cell(it.pid ? ptitle(it.pid) || 'Projekt' : 'Személyes teendők') + ' | ' + PTYPE_HU[it.ptype] + ' | ' + cell(nm(it.uid)) + ' | ' + cell(it.uni) + ' | ' + r.open + ' | ' + r.done + ' |'); });
    L.push('');
    function projHeader(it) {
      var p = D.projects[it.pid], o = [];
      if (!p) { o.push('### • Személyes teendők — ' + nm(it.uid), '', '- **Kutató:** ' + nm(it.uid) + ' · **Egyetem:** ' + it.uni, ''); return o.join('\n'); }
      o.push('### ' + (it.ptype === 'autopilot' ? '🤖 ' : '🔬 ') + (String(p.title || '').trim() || 'Projekt'), '');
      o.push('- **Típus:** ' + (it.ptype === 'autopilot' ? 'Autopilot-projekt' : 'Research-projekt'));
      o.push('- **Kutató:** ' + nm(it.uid) + ' · **Egyetem:** ' + it.uni);
      if (p.goal) o.push('- **Cél:** ' + oneLine(p.goal, 1500));
      if (p.field) o.push('- **Terület:** ' + oneLine(p.field));
      if (p.keywords && p.keywords.length) o.push('- **Kulcsszavak:** ' + p.keywords.join(', '));
      (protsOf[p.id] || []).forEach(function (x) { o.push('- **Protokoll:** ' + (oneLine(x.title) || '—') + (x.goal ? ' — ' + oneLine(x.goal, 600) : '')); });
      o.push('- **Megnyitás a Publify-ban:** ' + base + 'Research.html?project=' + p.id, '');
      return o.join('\n');
    }
    function taskMd(it) {
      var r = it.raw, o = [], id = tid[it.key], st = '**' + (ST_HU[r.status] || r.status || '—') + '**', who = it.assignee === 'human' ? 'Human' : 'AI';
      if (it.type === 'step') {
        var sp = r.spec || {}, pr = D.prots[r.protocol_id];
        o.push('#### ' + id + ' · ' + (oneLine(r.title) || 'Lépés'), '');
        o.push('`AI protokoll-lépés' + (r.kind ? ' · ' + (KIND_HU[r.kind] || r.kind) : '') + '` · Felelős: ' + who + ' · Állapot: ' + st + ' · Létrehozva: ' + (it.day || '—'), '');
        o.push('- Protokoll: ' + ((pr && oneLine(pr.title)) || '—') + ', ' + r.ord + '. lépés');
        var deps = (r.depends_on || []).map(function (d) { return byProtOrd[r.protocol_id + ':' + d] || (d + '. lépés (nincs ebben a csomagban)'); });
        if (deps.length) o.push('- Függ: ' + deps.join(', '));
        if (r.needs_approval) o.push('- ⚠ Jóváhagyás szükséges a végrehajtás előtt');
        if (sp.est_minutes) o.push('- Becsült idő: ' + sp.est_minutes + ' perc');
        o.push(mdSec('Utasítás', sp.instruction) + mdSec('Bemenetek', sp.inputs) + mdSec('Elvárt kimenetek', sp.expected_outputs) + mdSec('Elfogadási kritériumok', sp.acceptance)
          + (sp.command_hint ? '\n**Javasolt parancs:**\n```bash\n' + String(sp.command_hint).trim() + '\n```\n' : '') + mdSec('Csatolmányok', sp.attachments) + originMd(sp.origin));
      } else if (it.type === 'todo') {
        o.push('#### ' + id + ' · ' + (oneLine(r.title) || 'Teendő'), '');
        o.push('`Kézi teendő` · Felelős: ' + who + ' · Állapot: ' + st + (r.priority ? ' · Prioritás: ' + r.priority : '') + (r.due ? ' · Határidő: ' + r.due : '') + ' · Létrehozva: ' + (it.day || '—'));
        if (r.notes) o.push('', '**Jegyzet:**', String(r.notes).trim());
      } else {
        o.push('#### ' + id + ' · ' + (oneLine(r.result_title || r.research_question) || 'Irodalmi áttekintés'), '');
        o.push('`' + (r.kind === 'report' ? 'Elicit-report' : 'Szisztematikus áttekintés (Elicit)') + '` · Állapot: ' + st + ' · Létrehozva: ' + (it.day || '—'));
        if (r.research_question) o.push('', '**Kutatási kérdés:** ' + oneLine(r.research_question));
        if (r.url) o.push('', '**Link:** ' + r.url);
      }
      return o.join('\n') + '\n';
    }
    var curUni = null, curGroup = null;
    sorted.forEach(function (it) {
      if (it.uni !== curUni) { curUni = it.uni; curGroup = null; L.push('---', '', '## 🏛 ' + it.uni, ''); }
      var gk = it.pid || ('_' + it.uid);
      if (gk !== curGroup) { curGroup = gk; L.push(projHeader(it)); }
      L.push(taskMd(it));
    });
    return L.join('\n');
  }
  function downloadText(name, text) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }

  // ---------- app ----------
  function App() {
    var phS = useState('loading'), phase = phS[0], setPhase = phS[1];
    var meS = useState(null), me = meS[0], setMe = meS[1];
    var tdS = useState([]), todos = tdS[0], setTodos = tdS[1];
    var stS = useState([]), steps = stS[0], setSteps = stS[1];        // read-only AI protocol steps (unified view)
    var ejS = useState([]), elicitJobs = ejS[0], setElicitJobs = ejS[1];   // read-only research studies (systematic reviews + reports)
    var pjS = useState([]), projects = pjS[0], setProjects = pjS[1];
    var pfS = useState(null), projF = pfS[0], setProjF = pfS[1];   // null=all, ''=personal-only, else pid
    var wfS = useState('all'), who = wfS[0], setWho = wfS[1];
    var qS = useState(''), q = qS[0], setQ = qS[1];
    var modalS = useState(null), modal = modalS[0], setModal = modalS[1];   // {task} edit, {} add, null closed
    var dragS = useState(null), drag = dragS[0], setDrag = dragS[1];
    var overS = useState(null), over = overS[0], setOver = overS[1];
    // ---- admin scope: the same board over EVERY user's tasks (read-only). RLS already lets an admin read them all
    //      (research_can_read_project → is_admin(), research_todos / elicit_jobs / profiles admin policies). ----
    var aoS = useState(isAdminUser()), adminOk = aoS[0], setAdminOk = aoS[1];
    var scS = useState(function () { try { return localStorage.getItem('pr-kb-scope') === 'all' ? 'all' : 'mine'; } catch (e) { return 'mine'; } }), scope = scS[0], setScope = scS[1];
    var adS = useState(null), ad = adS[0], setAd = adS[1];   // null | {loading} | {err} | {items, users, projects, prots}
    var afS = useState(function () { try { return Object.assign({}, AF0, JSON.parse(localStorage.getItem('pr-kb-admin-f') || '{}')); } catch (e) { return Object.assign({}, AF0); } }), af = afS[0], setAfRaw = afS[1];
    function setAf(p) { setAfRaw(function (o) { var n = Object.assign({}, o, p); try { localStorage.setItem('pr-kb-admin-f', JSON.stringify(n)); } catch (e) { } return n; }); }
    function pickScope(v) { setScope(v); try { localStorage.setItem('pr-kb-scope', v); } catch (e) { } }
    useEffect(function () { function r() { setAdminOk(isAdminUser()); } window.addEventListener('pr-profile', r); r(); return function () { window.removeEventListener('pr-profile', r); }; }, []);
    var allMode = adminOk && scope === 'all' && !(me && me.viewing);
    useEffect(function () { if (allMode && !ad) loadAdmin(); }, [allMode]);
    function fetchAll(mk) {   // PostgREST caps a response at 1000 rows → page until a short page
      var out = [];
      function page(from) { return mk().range(from, from + 999).then(function (r) { if (r && r.error) throw r.error; var d = (r && r.data) || []; out = out.concat(d); return d.length === 1000 ? page(from + 1000) : out; }); }
      return page(0);
    }
    function soft(p) { return p.then(null, function () { return []; }); }   // optional sources must not sink the whole view
    function loadAdmin() {
      setAd({ loading: true });
      Promise.all([
        fetchAll(function () { return sb.from('profiles').select('id,name,email,affiliation').order('id'); }),
        fetchAll(function () { return sb.from('research_projects').select('id,title,owner_id,goal,field,keywords,status,created_at').order('id'); }),
        soft(fetchAll(function () { return sb.from('research_autopilot_runs').select('id,project_id').order('id'); })),
        soft(fetchAll(function () { return sb.from('research_chats').select('id,project_id').eq('surface', 'autopilot').order('id'); })),
        fetchAll(function () { return sb.from('research_protocols').select('id,project_id,title,goal,status,created_at').or('status.is.null,status.neq.archived').order('id'); }),
        fetchAll(function () { return sb.from('research_protocol_steps').select('id,protocol_id,ord,title,kind,status,assignee,needs_approval,spec,depends_on,created_at,finished_at').order('id'); }),
        fetchAll(function () { return sb.from('research_todos').select('*').order('id'); }),
        soft(fetchAll(function () { return sb.from('elicit_jobs').select('id,kind,status,stage,research_question,result_title,url,project_id,user_id,created_at').order('id'); }))
      ]).then(function (r) {
        var users = {}; r[0].forEach(function (p) { users[p.id] = { id: p.id, name: p.name || (p.email ? String(p.email).split('@')[0] : 'ismeretlen'), aff: p.affiliation || '', uni: uniOf(p.affiliation) }; });
        var projects = {}; r[1].forEach(function (p) { projects[p.id] = p; });
        var auto = {}; r[2].concat(r[3]).forEach(function (x) { if (x.project_id) auto[x.project_id] = 1; });   // a run OR an Autopilot brief chat = Autopilot project
        var prots = {}; r[4].forEach(function (x) { prots[x.id] = x; });
        var items = [];
        function push(type, raw, pid, uid, txt, assignee, status) {
          var u = users[uid];
          items.push({ key: type + ':' + raw.id, type: type, raw: raw, pid: pid || null, uid: uid || null, uni: u ? u.uni : NO_UNI,
            ptype: pid ? (auto[pid] ? 'autopilot' : 'research') : 'personal', day: dayOf(raw.created_at), txt: String(txt || '').toLowerCase(),
            assignee: assignee === 'human' ? 'human' : 'ai', status: status || '' });
        }
        r[6].forEach(function (t) { push('todo', t, t.project_id, t.owner_id, (t.title || '') + ' ' + (t.notes || ''), t.assignee, t.status); });
        r[5].forEach(function (x) {
          var pr = prots[x.protocol_id]; if (!pr) return;   // archived protocol → not a live task
          var pj = projects[pr.project_id]; x.project_id = pr.project_id; x._prot = pr.title;
          push('step', x, pr.project_id, pj && pj.owner_id, (x.title || '') + ' ' + ((x.spec && x.spec.instruction) || ''), x.assignee, x.status);
        });
        r[7].forEach(function (j) { push('study', j, j.project_id, j.user_id, (j.result_title || '') + ' ' + (j.research_question || ''), 'ai', j.status); });
        // newest first (the "what was born today" view); a protocol's steps share created_at → then by step order
        items.sort(function (a, b) { return String(b.raw.created_at || '').localeCompare(String(a.raw.created_at || '')) || (a.raw.ord || 0) - (b.raw.ord || 0); });
        setAd({ items: items, users: users, projects: projects, prots: prots });
      }, function (e) { setAd({ err: (e && e.message) || String(e) }); });
    }

    useEffect(function () {
      boot();
      // the admin role can resolve slightly after mount (async refreshMe); re-boot once it does so a
      // fresh "view as" reliably switches to the viewed user instead of briefly showing the admin's own.
      if (/[?&]adminView=1/.test(location.search)) {
        var reboot = function () { boot(); };
        window.addEventListener('pr-profile', reboot);
        return function () { window.removeEventListener('pr-profile', reboot); };
      }
    }, []);
    function boot() {
      if (!BE || !BE.sb) { setPhase('nobackend'); return; }
      if (BE.mode !== 'cloud' || !BE.user) { setPhase('signin'); return; }
      var tgt = adminTargetUser();                       // admin viewing another user → that user; else null
      var vid = tgt ? tgt.id : BE.user.id;               // whose tasks to show (never blindly the logged-in id)
      setMe({ id: vid, name: tgt ? (tgt.name || tgt.email || 'user') : BE.user.name, viewing: !!tgt });
      load(vid);
    }
    function load(uid) {
      Promise.all([
        sb.from('research_todos').select('*').eq('owner_id', uid).order('sort', { ascending: true }).order('created_at', { ascending: false }),
        sb.from('research_projects').select('id,title,owner_id').order('updated_at', { ascending: false }),
        sb.from('elicit_jobs').select('id,kind,status,stage,research_question,result_title,url,project_id,created_at').eq('user_id', uid).order('created_at', { ascending: false })
      ]).then(function (res) {
        setTodos((res[0] && res[0].data) || []);
        setElicitJobs((res[2] && res[2].data) || []);
        var own = ((res[1] && res[1].data) || []).filter(function (p) { return p.owner_id === uid; });
        setProjects(own);
        // union in the user's own AI protocol steps (read-only) so "My tasks" is genuinely ALL my tasks
        var pids = own.map(function (p) { return p.id; });
        if (!pids.length) { setSteps([]); setPhase('ready'); return; }
        sb.from('research_protocols').select('id,project_id,title').in('project_id', pids).neq('status', 'archived').then(function (pr) {
          var prots = (pr && pr.data) || [], byId = {}; prots.forEach(function (x) { byId[x.id] = x; });
          var protIds = prots.map(function (x) { return x.id; });
          if (!protIds.length) { setSteps([]); setPhase('ready'); return; }
          sb.from('research_protocol_steps').select('id,protocol_id,ord,title,kind,status,assignee,needs_approval,spec,depends_on').in('protocol_id', protIds).order('ord', { ascending: true }).then(function (sr) {
            var rows = (sr && sr.data) || [];
            rows.forEach(function (s) { var pp = byId[s.protocol_id]; s._proj = pp ? { id: pp.project_id, title: (own.filter(function (o) { return o.id === pp.project_id; })[0] || {}).title } : null; s._prot = pp && pp.title; s.project_id = pp && pp.project_id; });
            setSteps(rows); setPhase('ready');
          }, function () { setSteps([]); setPhase('ready'); });
        }, function () { setSteps([]); setPhase('ready'); });
      }, function () { setPhase('ready'); });
    }
    function reload() { if (me) load(me.id); }
    function patch(t, p) {
      if (allMode) { toast('Az admin-nézet csak olvasható — a saját taskjaidat a „Saját” nézetben szerkesztheted.', { kind: 'warn' }); return; }
      if (me && me.viewing) { toast('Read-only preview — you are viewing another user’s tasks.', { kind: 'warn' }); return; }
      setTodos(function (l) { return l.map(function (x) { return x.id === t.id ? Object.assign({}, x, p) : x; }); });   // optimistic
      sb.from('research_todos').update(Object.assign({ updated_at: new Date().toISOString() }, p)).eq('id', t.id).then(function (r) { if (r && r.error) { toast('Move failed: ' + r.error.message, { kind: 'error' }); reload(); } });
    }
    function moveToCol(t, key) { var p = colPatch(key); if (p) patch(t, p); }
    // save an AI protocol step edited via the shared Task editor (task-editor.js) — same fields as the Protocol board
    function saveStep(s, data) {
      if (allMode) { toast('Az admin-nézet csak olvasható — a lépést a projekt Protocol fülén szerkesztheted.', { kind: 'warn' }); return; }
      if (me && me.viewing) { toast('Read-only preview — cannot edit another user’s tasks.', { kind: 'warn' }); return; }
      var row = {
        title: data.title, kind: data.kind, spec: data.spec,
        depends_on: data.depends_on || [], needs_approval: !!data.needs_approval
      };
      if (data.status) row.status = data.status;
      if (data.assignee) row.assignee = data.assignee;
      sb.from('research_protocol_steps').update(row).eq('id', s.id).then(function (r) {
        if (r && r.error) { toast('Could not update step: ' + r.error.message, { kind: 'error' }); return; }
        setModal(null); reload();
      });
    }

    var projById = {}; projects.forEach(function (p) { projById[p.id] = p; });
    // filter chips: personal + each project that has todos OR protocol steps
    var withItems = [], seen = {}, cnt = {}, personalCount = 0;
    function tally(pid) { if (pid) { cnt[pid] = (cnt[pid] || 0) + 1; if (!seen[pid]) { seen[pid] = 1; if (projById[pid]) withItems.push(projById[pid]); } } else personalCount++; }
    todos.forEach(function (t) { tally(t.project_id); });
    steps.forEach(function (s) { tally(s.project_id); });
    elicitJobs.forEach(function (j) { tally(j.project_id); });
    var total = todos.length + steps.length + elicitJobs.length;
    var qq = q.trim().toLowerCase();
    function passItem(pid, assignee, text) {
      if (projF === '') { if (pid) return false; }
      else if (projF) { if (pid !== projF) return false; }
      if (who !== 'all' && (assignee === 'human' ? 'human' : 'ai') !== who) return false;
      if (qq && (text || '').toLowerCase().indexOf(qq) < 0) return false;
      return true;
    }
    var shownTodos = todos.filter(function (t) { return passItem(t.project_id, t.assignee, (t.title || '') + ' ' + (t.notes || '')); });
    var shownSteps = steps.filter(function (s) { return passItem(s.project_id, s.assignee, s.title || ''); });
    var shownElicit = elicitJobs.filter(function (j) { return passItem(j.project_id, 'ai', (j.result_title || '') + ' ' + (j.research_question || '')); });

    // ---- admin scope: filter cascade university → researcher → project type → project; day / status / owner / text first,
    //      so every dropdown count answers "how many tasks match if I pick this" ----
    var viewing = !!(me && me.viewing), ro = viewing || allMode;
    var AD = (allMode && ad && ad.items) ? ad : null;
    var base = [], inUni = [], inUser = [], inType = [], adShown = [], stepPool = steps;
    var uniCnt = {}, userCnt = {}, projCnt = {}, typeCnt = { all: 0, research: 0, autopilot: 0, personal: 0 };
    if (AD) {
      base = AD.items.filter(function (it) {
        if (af.from && it.day < af.from) return false;
        if (af.to && it.day > af.to) return false;
        if (af.st === 'open' && DONE_ST[it.status]) return false;
        if (af.st === 'done' && !DONE_ST[it.status]) return false;
        if (who !== 'all' && it.assignee !== who) return false;
        if (qq && it.txt.indexOf(qq) < 0) return false;
        return true;
      });
      inUni = base.filter(function (it) { uniCnt[it.uni] = (uniCnt[it.uni] || 0) + 1; return !af.uni || it.uni === af.uni; });
      inUser = inUni.filter(function (it) { if (it.uid) userCnt[it.uid] = (userCnt[it.uid] || 0) + 1; return !af.user || it.uid === af.user; });
      inType = inUser.filter(function (it) { typeCnt.all++; typeCnt[it.ptype]++; return af.type === 'all' || it.ptype === af.type; });
      adShown = inType.filter(function (it) { if (it.pid) projCnt[it.pid] = (projCnt[it.pid] || 0) + 1; return !af.proj || it.pid === af.proj; });
      function rawOf(t) { return function (it) { return it.type === t; }; }
      shownTodos = adShown.filter(rawOf('todo')).map(function (it) { return it.raw; });
      shownSteps = adShown.filter(rawOf('step')).map(function (it) { return it.raw; });
      shownElicit = adShown.filter(rawOf('study')).map(function (it) { return it.raw; });
      stepPool = AD.items.filter(rawOf('step')).map(function (it) { return it.raw; });
      projById = AD.projects;
    }
    var adSummary = allMode ? 'Betöltés…' : '';
    if (AD) {
      var sP = {}, sU = {}, sE = {};
      adShown.forEach(function (it) { if (it.pid) sP[it.pid] = 1; if (it.uid) sU[it.uid] = 1; sE[it.uni] = 1; });
      adSummary = 'Minden kutató taskjai (csak olvasható) · ' + adShown.length + ' / ' + AD.items.length + ' task · ' + Object.keys(sP).length + ' projekt · ' + Object.keys(sU).length + ' kutató · ' + Object.keys(sE).length + ' egyetem';
    }
    function ownLine(uid) {
      if (!AD) return null;
      var u = AD.users[uid];
      return h('div', { className: 'kb-own', title: u && u.aff ? 'Affiliáció: ' + u.aff : '' }, '👤 ' + (u ? u.name : '—') + ' · ' + (u ? u.uni : NO_UNI));
    }
    function exportMd(list) {
      if (!AD || !list.length) return;
      var desc = [];
      if (af.uni) desc.push('Egyetem = ' + af.uni);
      if (af.user) desc.push('Kutató = ' + ((AD.users[af.user] || {}).name || af.user));
      if (af.type !== 'all') desc.push('Projekt típusa = ' + PTYPE_HU[af.type]);
      if (af.proj) desc.push('Projekt = ' + ((AD.projects[af.proj] || {}).title || af.proj));
      if (af.from || af.to) desc.push('Létrehozva = ' + (af.from || '…') + ' – ' + (af.to || '…'));
      if (af.st !== 'all') desc.push('Állapot = ' + (af.st === 'open' ? 'nyitott' : 'kész'));
      if (who !== 'all') desc.push('Felelős = ' + (who === 'human' ? 'Human' : 'AI'));
      if (qq) desc.push('Keresés = „' + q.trim() + '”');
      var who0 = af.proj ? (AD.projects[af.proj] || {}).title : af.user ? (AD.users[af.user] || {}).name : af.uni || 'osszes';
      var name = 'publify-taskok_' + slugOf(who0) + (af.from ? '_' + af.from + (af.to && af.to !== af.from ? '_' + af.to : '') : '') + '.md';
      downloadText(name, buildTasksMd(list, AD, desc));
      toast('⬇ ' + name + ' — ' + list.length + ' task', { kind: 'ok' });
    }
    function adminBar() {
      var t0 = Date.now(), today = dayOf(t0), yest = dayOf(t0 - 864e5), wk = dayOf(t0 - 6 * 864e5);
      function nm(id) { var u = AD.users[id]; return u ? u.name : '—'; }
      function pt(id) { var p = AD.projects[id]; return p ? (p.title || 'Projekt') : 'Projekt'; }
      var unis = Object.keys(uniCnt).sort(function (a, b) { return (uniCnt[b] - uniCnt[a]) || a.localeCompare(b, 'hu'); });
      if (af.uni && unis.indexOf(af.uni) < 0) unis.unshift(af.uni);   // a selection must stay visible even when the day leaves it empty
      var uids = Object.keys(userCnt).sort(function (a, b) { return nm(a).localeCompare(nm(b), 'hu'); });
      if (af.user && uids.indexOf(af.user) < 0) uids.unshift(af.user);
      var pids = Object.keys(projCnt).sort(function (a, b) { return (projCnt[b] - projCnt[a]) || pt(a).localeCompare(pt(b), 'hu'); });
      if (af.proj && pids.indexOf(af.proj) < 0) pids.unshift(af.proj);
      function quick(lbl, from, to) {
        var on = af.from === from && af.to === to;
        return h('button', { key: lbl, type: 'button', className: 'ad-q' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false', onClick: function () { setAf(on ? { from: '', to: '' } : { from: from, to: to }); } }, lbl);
      }
      var any = af.uni || af.user || af.proj || af.type !== 'all' || af.from || af.to || af.st !== 'all';
      return h('div', { className: 'ad-bar' },
        h('label', { className: 'ad-f' }, h('span', null, 'Egyetem'),
          h('select', { className: 'ad-sel', value: af.uni, onChange: function (e) { setAf({ uni: e.target.value, user: '', proj: '' }); } },
            h('option', { value: '' }, 'Mind (' + base.length + ')'),
            unis.map(function (u) { return h('option', { key: u, value: u }, u + ' (' + (uniCnt[u] || 0) + ')'); }))),
        h('label', { className: 'ad-f' }, h('span', null, 'Kutató'),
          h('select', { className: 'ad-sel', value: af.user, onChange: function (e) { setAf({ user: e.target.value, proj: '' }); } },
            h('option', { value: '' }, 'Mind (' + inUni.length + ')'),
            uids.map(function (id) { return h('option', { key: id, value: id }, nm(id) + ' (' + (userCnt[id] || 0) + ')'); }))),
        h('div', { className: 'ad-f' }, h('span', null, 'Projekt típusa'),
          h('div', { className: 'kb-seg' }, [['all', 'Mind'], ['research', '🔬 Research'], ['autopilot', '🤖 Autopilot'], ['personal', '• Személyes']].map(function (o) {
            return h('button', { key: o[0], type: 'button', className: af.type === o[0] ? 'on' : '', onClick: function () { setAf({ type: o[0], proj: '' }); } }, o[1] + ' ', h('span', { className: 'ad-n' }, typeCnt[o[0]] || 0));
          }))),
        h('label', { className: 'ad-f' }, h('span', null, 'Projekt'),
          h('select', { className: 'ad-sel wide', value: af.proj, onChange: function (e) { setAf({ proj: e.target.value }); } },
            h('option', { value: '' }, 'Mind (' + inType.length + ')'),
            pids.map(function (id) { return h('option', { key: id, value: id }, pt(id) + ' (' + (projCnt[id] || 0) + ')'); }))),
        h('div', { className: 'ad-f' }, h('span', null, 'Létrehozva'),
          h('div', { className: 'ad-dates' },
            h('input', { type: 'date', className: 'ad-sel ad-date', value: af.from, max: af.to || undefined, 'aria-label': 'Létrehozva ettől', onChange: function (e) { setAf({ from: e.target.value }); } }),
            h('span', { className: 'ad-dash' }, '–'),
            h('input', { type: 'date', className: 'ad-sel ad-date', value: af.to, min: af.from || undefined, 'aria-label': 'Létrehozva eddig', onChange: function (e) { setAf({ to: e.target.value }); } }),
            quick('Ma', today, today), quick('Tegnap', yest, yest), quick('7 nap', wk, today))),
        h('div', { className: 'ad-f' }, h('span', null, 'Állapot'),
          h('div', { className: 'kb-seg' }, [['all', 'Mind'], ['open', 'Nyitott'], ['done', 'Kész']].map(function (o) {
            return h('button', { key: o[0], type: 'button', className: af.st === o[0] ? 'on' : '', onClick: function () { setAf({ st: o[0] }); } }, o[1]);
          }))),
        h('div', { className: 'ad-acts' },
          any ? h('button', { type: 'button', className: 'kb-btn', onClick: function () { setAf(AF0); } }, 'Szűrők törlése') : null,
          h('button', { type: 'button', className: 'kb-btn', title: 'Adatok újratöltése', onClick: loadAdmin }, '↻'),
          h('button', { type: 'button', className: 'kb-btn pri', disabled: !adShown.length, onClick: function () { exportMd(adShown); },
            title: 'A szűrt taskok egy .md fájlban, projekt-kontextussal és agent-utasítással — átadható egy másik agentnek' }, '⬇ Export .md (' + adShown.length + ')')));
    }
    function adminBlock() {
      if (!AD) return h('div', { className: 'soon', style: { marginBottom: 14 } }, (ad && ad.err)
        ? h('span', null, h('b', null, 'Nem sikerült betölteni: '), ad.err, ' ', h('button', { className: 'kb-btn', onClick: loadAdmin }, 'Újra'))
        : 'Minden kutató taskjainak betöltése…');
      return h('div', null, adminBar(),
        h('div', { className: 'gb-bar' },
          h('div', { className: 'ad-note' }, 'A szűrők együtt érvényesek; a listák számai azt mutatják, hány task felel meg, ha azt választod. A „Létrehozva” a task születésének napja (helyi idő).'),
          h('div', { className: 'gb-tools' },
            h('div', { className: 'kb-seg' }, [['all', 'All'], ['human', '👤 Human'], ['ai', '🤖 AI']].map(function (o) { return h('button', { key: o[0], className: who === o[0] ? 'on' : '', onClick: function () { setWho(o[0]); } }, o[1]); })),
            h('input', { className: 'gb-q', value: q, placeholder: '🔍 Keresés…', onChange: function (e) { setQ(e.target.value); } }))));
    }

    // AI protocol-step card — opens a detail drawer (status/owner editable; deep edit on the protocol board)
    function stepCard(s) {
      var a = assigneeOf(s), proj = projById[s.project_id];
      return h('div', {
        key: 's-' + s.id, className: 'bcard rostep ' + (a === 'human' ? 'hu' : 'ai'), title: 'AI protocol step — open details',
        role: 'button', tabIndex: 0,
        onClick: function () { setModal({ step: s }); },
        onKeyDown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setModal({ step: s }); } }
      },
        h('div', { className: 'gb-proj' }, h('i', { style: { background: proj ? colorFor(proj.id) : 'var(--faint)' } }), h('span', null, proj ? proj.title : 'Project')),
        ownLine(proj && proj.owner_id),
        h('div', { className: 'bcard-top' },
          h('span', { className: 'bchip who ' + (a === 'human' ? 'hu' : 'ai') }, a === 'human' ? 'HUMAN' : 'AI'),
          h('span', { className: 'bchip step' }, (STEP_ICON[s.kind] || '•') + ' AI step')),
        h('div', { className: 'bcard-t' }, h('span', { style: { color: 'var(--faint)' } }, s.ord + '. '), s.title)
      );
    }
    // Research study card (systematic review / report) — read-only; opens the project's Studies tab.
    function elicitCard(j) {
      var proj = projById[j.project_id];
      var kindLbl = ELICIT_KIND[j.kind] || '🔎 Study';
      var av = /[?&]adminView=1/.test(location.search) ? '&adminView=1' : '';
      var target = j.project_id ? ('Research.html?project=' + encodeURIComponent(j.project_id) + av) : (j.url || null);
      function open() { if (!target) return; if (/^https?:/.test(target)) window.open(target, '_blank'); else window.location.href = target; }
      return h('div', {
        key: 'e-' + j.id, className: 'bcard rostep ai', title: kindLbl + ' — open in Studies',
        role: 'button', tabIndex: 0, onClick: open,
        onKeyDown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }
      },
        h('div', { className: 'gb-proj' }, h('i', { style: { background: proj ? colorFor(proj.id) : 'var(--faint)' } }), h('span', null, proj ? proj.title : 'Personal')),
        ownLine(j.user_id),
        h('div', { className: 'bcard-top' },
          h('span', { className: 'bchip who ai' }, 'STUDY'),
          h('span', { className: 'bchip step' }, kindLbl)),
        h('div', { className: 'bcard-t' }, j.result_title || j.research_question || 'Research study'),
        h('div', { style: { fontSize: 11, color: 'var(--faint)', marginTop: 3 } }, elicitStatusLbl(j))
      );
    }

    function card(t) {
      var a = assigneeOf(t), proj = projById[t.project_id], pr = PRIO[t.priority];
      var overdue = t.due && t.status !== 'done' && t.due < new Date().toISOString().slice(0, 10);
      var chips = [];
      if (t.due) chips.push(h('span', { key: 'd', className: 'bchip' + (overdue ? ' warn' : '') }, '📅 ' + t.due));
      if (t.notes) chips.push(h('span', { key: 'n', className: 'bchip' }, '📝'));
      return h('div', {
        key: t.id, className: 'bcard ' + (a === 'human' ? 'hu' : 'ai'), draggable: !ro,
        onDragStart: function (e) { setDrag(t.id); try { e.dataTransfer.effectAllowed = 'move'; } catch (x) { } },
        onDragEnd: function () { setDrag(null); setOver(null); },
        onClick: function () { setModal({ task: t }); }, title: 'Edit task'
      },
        h('div', { className: 'gb-proj' }, h('i', { style: { background: proj ? colorFor(proj.id) : 'var(--faint)' } }), h('span', null, proj ? proj.title : 'Personal')),
        ownLine(t.owner_id),
        h('div', { className: 'bcard-top' },
          h('span', { className: 'bchip who ' + (a === 'human' ? 'hu' : 'ai') }, a === 'human' ? 'HUMAN' : 'AI'),
          pr ? h('span', { className: 'bchip', style: { background: 'color-mix(in srgb,' + pr.c + ' 16%, transparent)', color: pr.c } }, pr.l) : null),
        h('div', { className: 'bcard-t' }, t.title),
        chips.length ? h('div', { className: 'bcard-m' }, chips) : null
      );
    }

    if (phase === 'loading') return h('div', { className: 'center' }, h('div', { className: 'box' }, h('div', { className: 'mk' }, h('span')), h('h1', null, 'Kanban'), h('p', null, 'Loading…')));
    if (phase === 'nobackend') return h('div', { className: 'center' }, h('div', { className: 'box' }, h('div', { className: 'mk' }, h('span')), h('h1', null, 'Kanban'), h('p', null, 'The cloud backend is unavailable.')));
    if (phase === 'signin') return h('div', { className: 'center' }, h('div', { className: 'box' }, h('div', { className: 'mk' }, h('span')), h('h1', null, 'Sign in'), h('p', null, 'Your task board needs your account.'), h('a', { className: 'kb-btn pri', href: 'Landing.html' }, 'Sign in')));

    return h('div', { className: 'kb-wrap' },
      viewing ? h('div', { style: { background: 'var(--warn-bg)', color: 'var(--warn)', padding: '9px 14px', fontSize: 13, fontWeight: 600, borderRadius: 10, margin: '0 0 14px' } },
        '👁 Admin preview — viewing ', h('b', null, (me && me.name) || 'user'), '’s tasks (read-only). ',
        h('a', { href: 'Admin.html', style: { color: 'var(--warn)' } }, '← Back to admin')) : null,
      h('div', { className: 'kb-top' },
        h('div', null, h('h1', null, allMode ? '🛡 Összes task — admin' : viewing ? ((me && me.name ? me.name + '’s tasks' : 'Tasks')) : '🗂️ My tasks'), allMode ? h('div', { className: 'kb-sub' }, adSummary) : h('div', { className: 'kb-sub' }, todos.length + ' task' + (todos.length === 1 ? '' : 's') + (steps.length ? ' + ' + steps.length + ' AI protocol step' + (steps.length === 1 ? '' : 's') : '') + (elicitJobs.length ? ' + ' + elicitJobs.length + ' study' + (elicitJobs.length === 1 ? '' : ' studies') : '') + ((steps.length || elicitJobs.length) ? ' (read-only)' : '') + ' across ' + withItems.length + ' project' + (withItems.length === 1 ? '' : 's'))),
        h('div', { className: 'kb-topacts' },
          (adminOk && !viewing) ? h('div', { className: 'kb-seg', role: 'group', 'aria-label': 'Nézet' },
            h('button', { type: 'button', className: !allMode ? 'on' : '', onClick: function () { pickScope('mine'); } }, '👤 Saját'),
            h('button', { type: 'button', className: allMode ? 'on' : '', onClick: function () { pickScope('all'); } }, '🛡 Összes (admin)')) : null,
          ro ? null : h('button', { className: 'kb-btn pri', onClick: function () { setModal({ defaultProject: projF || '' }); } }, '+ Add task'))
      ),
      allMode ? adminBlock() : h('div', { className: 'gb-bar' },
        h('div', { className: 'gb-chips' },
          h('button', { className: 'gb-chip' + (projF == null ? ' on' : ''), onClick: function () { setProjF(null); } }, 'All ', h('span', { className: 'gb-c' }, total)),
          personalCount ? h('button', { className: 'gb-chip' + (projF === '' ? ' on' : ''), onClick: function () { setProjF(projF === '' ? null : ''); } }, '• Personal ', h('span', { className: 'gb-c' }, personalCount)) : null,
          withItems.map(function (p) {
            return h('button', { key: p.id, className: 'gb-chip' + (projF === p.id ? ' on' : ''), title: p.title, onClick: function () { setProjF(projF === p.id ? null : p.id); } },
              h('i', { className: 'gb-dot', style: { background: colorFor(p.id) } }), h('span', { className: 'gb-nm' }, p.title), h('span', { className: 'gb-c' }, cnt[p.id] || 0));
          })
        ),
        h('div', { className: 'gb-tools' },
          h('div', { className: 'kb-seg' }, [['all', 'All'], ['human', '👤 Human'], ['ai', '🤖 AI']].map(function (o) { return h('button', { key: o[0], className: who === o[0] ? 'on' : '', onClick: function () { setWho(o[0]); } }, o[1]); })),
          h('input', { className: 'gb-q', value: q, placeholder: '🔍 Filter…', onChange: function (e) { setQ(e.target.value); } })
        )
      ),
      (allMode && !AD) ? null
      : (AD && !adShown.length) ? h('div', { className: 'soon' }, h('b', null, 'Nincs a szűrőknek megfelelő task. '), 'Lazíts a szűrőkön, vagy válassz másik napot.')
      : (!AD && !todos.length && !steps.length && !elicitJobs.length) ? (viewing
        ? h('div', { className: 'soon' }, h('b', null, 'No tasks. '), 'This user has no tasks yet.')
        : h('div', { className: 'soon' }, h('b', null, 'No tasks yet. '), 'Add your first task — tie it to a research project or keep it personal. Your AI protocol steps also appear here (read-only) once you generate a protocol in a project.',
          h('div', { style: { marginTop: 14 } }, h('button', { className: 'kb-btn pri', onClick: function () { setModal({}); } }, '+ Add task'))))
        : h('div', { className: 'bwrap' }, BOARD_COLS.map(function (col) {
          var tc = shownTodos.filter(function (t) { return todoCol(t) === col.key; });
          var sc = shownSteps.filter(function (s) { return stepColOf(s) === col.key; });
          var ec = shownElicit.filter(function (j) { return elicitColOf(j) === col.key; });
          var n = tc.length + sc.length + ec.length;
          return h('div', {
            key: col.key, className: 'bcol' + (over === col.key ? ' over' : '') + (' cap-' + (col.who === 'human' ? 'hu' : col.who === 'ai' ? 'ai' : 'bk')),
            onDragOver: function (e) { if (drag) { e.preventDefault(); if (over !== col.key) setOver(col.key); } },
            onDrop: function (e) { e.preventDefault(); setOver(null); if (drag) { var t = todos.filter(function (x) { return x.id === drag; })[0]; if (t) moveToCol(t, col.key); setDrag(null); } }
          },
            h('div', { className: 'bcol-h' }, h('span', null, BCOL_IC[col.key]), h('span', { className: 'bcol-t' }, col.title), h('span', { className: 'bcol-n' }, n + '')),
            h('div', { className: 'bcol-b' }, n ? tc.map(card).concat(sc.map(stepCard)).concat(ec.map(elicitCard)) : h('div', { className: 'bcol-empty' }, '—'))
          );
        })),
      modal ? (modal.step
        ? ((window.PRTaskEditor && window.PRTaskEditor.TaskEditorModal)
          ? h(window.PRTaskEditor.TaskEditorModal, {
            step: modal.step, isNew: false, boardFields: true, projectId: modal.step.project_id,
            allSteps: stepPool.filter(function (x) { return x.protocol_id === modal.step.protocol_id; }),
            onSave: function (data) { saveStep(modal.step, data); }, onClose: function () { setModal(null); }
          })
          : null)
        : h(TaskModal, { task: modal.task, defaultProject: modal.defaultProject, meId: me.id, projects: AD ? Object.keys(AD.projects).map(function (k) { return AD.projects[k]; }) : projects, readOnly: ro, onClose: function () { setModal(null); }, onSaved: function () { setModal(null); reload(); } })) : null
    );
  }

  ReactDOM.createRoot(document.getElementById('root')).render(h(App));
})();
