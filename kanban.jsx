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
      if (me && me.viewing) { toast('Read-only preview — you are viewing another user’s tasks.', { kind: 'warn' }); return; }
      setTodos(function (l) { return l.map(function (x) { return x.id === t.id ? Object.assign({}, x, p) : x; }); });   // optimistic
      sb.from('research_todos').update(Object.assign({ updated_at: new Date().toISOString() }, p)).eq('id', t.id).then(function (r) { if (r && r.error) { toast('Move failed: ' + r.error.message, { kind: 'error' }); reload(); } });
    }
    function moveToCol(t, key) { var p = colPatch(key); if (p) patch(t, p); }
    // save an AI protocol step edited via the shared Task editor (task-editor.js) — same fields as the Protocol board
    function saveStep(s, data) {
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
        key: t.id, className: 'bcard ' + (a === 'human' ? 'hu' : 'ai'), draggable: !(me && me.viewing),
        onDragStart: function (e) { setDrag(t.id); try { e.dataTransfer.effectAllowed = 'move'; } catch (x) { } },
        onDragEnd: function () { setDrag(null); setOver(null); },
        onClick: function () { setModal({ task: t }); }, title: 'Edit task'
      },
        h('div', { className: 'gb-proj' }, h('i', { style: { background: proj ? colorFor(proj.id) : 'var(--faint)' } }), h('span', null, proj ? proj.title : 'Personal')),
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

    var ro = !!(me && me.viewing);
    return h('div', { className: 'kb-wrap' },
      ro ? h('div', { style: { background: 'var(--warn-bg)', color: 'var(--warn)', padding: '9px 14px', fontSize: 13, fontWeight: 600, borderRadius: 10, margin: '0 0 14px' } },
        '👁 Admin preview — viewing ', h('b', null, (me && me.name) || 'user'), '’s tasks (read-only). ',
        h('a', { href: 'Admin.html', style: { color: 'var(--warn)' } }, '← Back to admin')) : null,
      h('div', { className: 'kb-top' },
        h('div', null, h('h1', null, ro ? ((me && me.name ? me.name + '’s tasks' : 'Tasks')) : '🗂️ My tasks'), h('div', { className: 'kb-sub' }, todos.length + ' task' + (todos.length === 1 ? '' : 's') + (steps.length ? ' + ' + steps.length + ' AI protocol step' + (steps.length === 1 ? '' : 's') : '') + (elicitJobs.length ? ' + ' + elicitJobs.length + ' study' + (elicitJobs.length === 1 ? '' : ' studies') : '') + ((steps.length || elicitJobs.length) ? ' (read-only)' : '') + ' across ' + withItems.length + ' project' + (withItems.length === 1 ? '' : 's'))),
        ro ? null : h('button', { className: 'kb-btn pri', onClick: function () { setModal({ defaultProject: projF || '' }); } }, '+ Add task')
      ),
      h('div', { className: 'gb-bar' },
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
      (!todos.length && !steps.length && !elicitJobs.length) ? (ro
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
            allSteps: steps.filter(function (x) { return x.protocol_id === modal.step.protocol_id; }),
            onSave: function (data) { saveStep(modal.step, data); }, onClose: function () { setModal(null); }
          })
          : null)
        : h(TaskModal, { task: modal.task, defaultProject: modal.defaultProject, meId: me.id, projects: projects, readOnly: ro, onClose: function () { setModal(null); }, onSaved: function () { setModal(null); reload(); } })) : null
    );
  }

  ReactDOM.createRoot(document.getElementById('root')).render(h(App));
})();
