/* Publify — Research Management (R0 Foundation).
 * Research projects + stage pipeline + research log + tasks, on Supabase (RLS-scoped to owner,
 * the linked PhD student's supervisor(s), and admin). Mirrors phd.jsx patterns incl. admin View-as. */
(function () {
  'use strict';
  var h = React.createElement;
  var useState = React.useState, useEffect = React.useEffect, useRef = React.useRef;
  var BE = window.PR_BACKEND, PUBS = window.PRPubs;
  var sb = BE && BE.sb;

  var STAGES = ['Setup', 'Idea', 'Literature', 'Protocol', 'Data', 'Compute', 'Analysis', 'Writing', 'Submission'];
  // clicking a workflow step opens the matching panel (the old redundant tab row is gone)
  var STAGE_TAB = ['overview', 'ideas', 'literature', 'tasks', 'data', 'compute', 'compute', 'writing', 'writing'];
  function svg() { var args = Array.prototype.slice.call(arguments); return h('svg', { viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }, args.map(function (d, i) { return h('path', { key: i, d: d }); })); }
  var STAGE_ICONS = [
    svg('M4 14V2.5', 'M4 3h7l-1.4 2.3L11 7.6H4'),                                         // Setup — flag
    svg('M5.6 9.6A3.5 3.5 0 1 1 10.4 9.6c-.5.5-.8 1-.8 1.6H6.4c0-.6-.3-1.1-.8-1.6Z', 'M6.6 13.2h2.8'), // Idea — bulb
    svg('M8 3.6C6.4 2.7 4.8 2.7 3.2 3.4v8.4c1.6-.7 3.2-.7 4.8.2 1.6-.9 3.2-.9 4.8-.2V3.4C11.2 2.7 9.6 2.7 8 3.6Z', 'M8 3.6v8.6'), // Literature — book
    svg('M5.9 8.2 7.2 9.5 10 6.6', 'M4.5 3.5h7v9.5h-7z', 'M6.2 3.5V2.4h3.6v1.1'),          // Protocol — clipboard check
    svg('M12.5 4c0 1-2 1.8-4.5 1.8S3.5 5 3.5 4 5.5 2.2 8 2.2 12.5 3 12.5 4Z', 'M3.5 4v8c0 1 2 1.8 4.5 1.8s4.5-.8 4.5-1.8V4', 'M3.5 8c0 1 2 1.8 4.5 1.8s4.5-.8 4.5-1.8'), // Data — db
    svg('M4.7 4.7h6.6v6.6h-6.6z', 'M6.6 2v2.5M9.4 2v2.5M6.6 11.5V14M9.4 11.5V14M2 6.6h2.5M2 9.4h2.5M11.5 6.6H14M11.5 9.4H14'), // Compute — chip
    svg('M3 13h10', 'M5.2 13V9M8 13V5.5M10.8 13V7.5'),                                     // Analysis — bars
    svg('M10.8 2.6 13.4 5.2 5.6 13l-3 .6.6-3z', 'M9.8 3.6 12.4 6.2'),                       // Writing — pencil
    svg('M8 10.5V3M5.2 5.8 8 3l2.8 2.8', 'M3.5 13h9')                                       // Submission — upload
  ];
  var LOG_TYPES = ['NOTE', 'DECISION', 'RESULT', 'ARTIFACT', 'MILESTONE', 'TASK'];
  var STATUS_LABEL = { active: 'Active', paused: 'Paused', done: 'Done', archived: 'Archived' };

  function adminTargetUser() {
    try {
      if (!/[?&]adminView=1/.test(location.search)) return null;
      var u = BE && BE.user; if (!u) return null;
      if (!(u.role === 'admin' || (BE.profiles && BE.profiles[u.id] && BE.profiles[u.id].role === 'admin'))) return null; // admin-only
      var t = JSON.parse(localStorage.getItem('pr-admin-view') || 'null');
      return t && t.id ? t : null;
    } catch (e) { return null; }
  }

  function initials(n) { return String(n || '?').trim().split(/\s+/).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase(); }
  var PALETTE = ['#4f46e5', '#0e9f6e', '#d9760b', '#db2777', '#0891b2', '#7c3aed', '#ca8a04', '#dc2626'];
  function colorFor(id) { var x = 0; id = String(id || ''); for (var i = 0; i < id.length; i++) x = (x * 31 + id.charCodeAt(i)) >>> 0; return PALETTE[x % PALETTE.length]; }
  function Avatar(props) {
    var u = props.u || {}, s = props.size || 36;
    var st = { width: s, height: s, fontSize: Math.round(s * 0.36) };
    if (u.avatar_url) { st.backgroundImage = 'url(' + u.avatar_url + ')'; return h('div', { className: 'av', style: st }); }
    st.background = colorFor(u.id || u.name);
    return h('div', { className: 'av', style: st }, initials(u.name));
  }

  function whenStr(ts) {
    if (!ts) return '';
    var d = new Date(ts), now = BE && BE._now ? BE._now : null;
    var s = d.toISOString().slice(0, 10);
    var t = d.toTimeString().slice(0, 5);
    return s + ' ' + t;
  }

  // ---------- New project ----------
  function NewProjectModal(props) {
    var f = useState({ title: '', field: '', keywords: '', goal: '' }), form = f[0], setForm = f[1];
    var s = useState(false), saving = s[0], setSaving = s[1];
    function up(k, v) { setForm(Object.assign({}, form, (function () { var o = {}; o[k] = v; return o; })())); }
    function save() {
      if (!form.title.trim()) return;
      setSaving(true);
      // Stamp student_id when the creator is a PhD student, so the project is visible to (and digestible
      // for) their supervisor. Without this the project stays owner-only and never reaches the supervisor.
      sb.from('phd_students').select('id').eq('profile_id', props.ownerId).maybeSingle().then(function (sr) {
        var sid = sr && sr.data && sr.data.id;
        var payload = {
          owner_id: props.ownerId, title: form.title.trim(), field: form.field.trim() || null,
          keywords: form.keywords ? form.keywords.split(',').map(function (x) { return x.trim(); }).filter(Boolean) : null,
          goal: form.goal.trim() || null, stage: 0, status: 'active'
        };
        if (sid) payload.student_id = sid;
        sb.from('research_projects').insert(payload).select().maybeSingle().then(function (r) {
          setSaving(false);
          if (r && r.error) { alert('Could not create: ' + r.error.message); return; }
          props.onSaved(r && r.data);
        });
      });
    }
    // #3 — clicking outside the create-project box must not silently discard what you typed
    function dirty() { return !!(form.title.trim() || form.field.trim() || form.keywords.trim() || form.goal.trim()); }
    function tryClose() { if (dirty() && !window.confirm('Eldobod a beírt projekt-adatokat?')) return; props.onClose(); }
    return h('div', { className: 'scrim', onClick: tryClose },
      h('div', { className: 'modal', onClick: function (e) { e.stopPropagation(); } },
        h('div', { className: 'modal-h' }, h('b', null, 'New research project'), h('button', { className: 'x', onClick: tryClose }, '×')),
        h('div', { className: 'modal-b' },
          h('div', { className: 'field' }, h('label', null, 'Title *'), h('input', { value: form.title, onChange: function (e) { up('title', e.target.value); }, placeholder: 'e.g. Fisher fusion for LiDAR OOD detection' })),
          h('div', { className: 'field' }, h('label', null, 'Field'), h('input', { value: form.field, onChange: function (e) { up('field', e.target.value); }, placeholder: 'e.g. Computer vision, Robotics' })),
          h('div', { className: 'field' }, h('label', null, 'Keywords (comma-separated)'), h('input', { value: form.keywords, onChange: function (e) { up('keywords', e.target.value); }, placeholder: 'OOD, LiDAR, uncertainty' })),
          h('div', { className: 'field' }, h('label', null, 'Goal / expected output'), h('textarea', { rows: 3, value: form.goal, onChange: function (e) { up('goal', e.target.value); }, placeholder: 'What does success look like? (paper, thesis chapter, …)' }))
        ),
        h('div', { className: 'modal-foot' }, h('button', { className: 'btn', onClick: tryClose }, 'Cancel'), h('button', { className: 'btn pri', disabled: saving, onClick: save }, saving ? 'Creating…' : 'Create project'))
      )
    );
  }

  // ---------- Edit project base settings (#2) ----------
  function ProjectSettingsModal(props) {
    var p = props.project;
    var f = useState({ title: p.title || '', field: p.field || '', keywords: (p.keywords || []).join(', '), goal: p.goal || '' }), form = f[0], setForm = f[1];
    var s = useState(false), saving = s[0], setSaving = s[1];
    function up(k, v) { setForm(Object.assign({}, form, (function () { var o = {}; o[k] = v; return o; })())); }
    function save() {
      if (!form.title.trim()) return;
      setSaving(true);
      sb.from('research_projects').update({
        title: form.title.trim(), field: form.field.trim() || null,
        keywords: form.keywords ? form.keywords.split(',').map(function (x) { return x.trim(); }).filter(Boolean) : null,
        goal: form.goal.trim() || null
      }).eq('id', p.id).then(function (r) {
        setSaving(false);
        if (r && r.error) { alert('Could not save: ' + r.error.message); return; }
        props.onSaved();
      });
    }
    return h('div', { className: 'scrim', onClick: props.onClose },
      h('div', { className: 'modal', onClick: function (e) { e.stopPropagation(); } },
        h('div', { className: 'modal-h' }, h('b', null, 'Projekt beállításai'), h('button', { className: 'x', onClick: props.onClose }, '×')),
        h('div', { className: 'modal-b' },
          h('div', { className: 'field' }, h('label', null, 'Title *'), h('input', { value: form.title, onChange: function (e) { up('title', e.target.value); } })),
          h('div', { className: 'field' }, h('label', null, 'Field'), h('input', { value: form.field, onChange: function (e) { up('field', e.target.value); }, placeholder: 'e.g. Computer vision, Robotics' })),
          h('div', { className: 'field' }, h('label', null, 'Keywords (comma-separated)'), h('input', { value: form.keywords, onChange: function (e) { up('keywords', e.target.value); }, placeholder: 'OOD, LiDAR, uncertainty' })),
          h('div', { className: 'field' }, h('label', null, 'Goal / expected output'), h('textarea', { rows: 3, value: form.goal, onChange: function (e) { up('goal', e.target.value); } }))
        ),
        h('div', { className: 'modal-foot' }, h('button', { className: 'btn', onClick: props.onClose }, 'Cancel'), h('button', { className: 'btn pri', disabled: saving, onClick: save }, saving ? 'Saving…' : 'Save'))
      )
    );
  }

  // ---------- Stage stepper ----------
  function Stepper(props) {
    var cur = props.stage || 0;
    var kids = [];
    STAGES.forEach(function (name, i) {
      if (i > 0) kids.push(h('div', { className: 'step-sep', key: 'sep' + i }));
      var cls = 'step' + (i === cur ? ' cur' : (i < cur ? ' done' : ''));
      kids.push(h('button', {
        key: i, className: cls,
        title: name + (props.canEdit ? ' — megnyitás / szakasz beállítása' : ' — megnyitás'),
        onClick: function () { if (props.onNav) props.onNav(i); if (props.canEdit && i !== cur && props.onSet) props.onSet(i); }
      }, h('span', { className: 'dot' }, STAGE_ICONS[i] || (i + 1)), name));
    });
    return h('div', { className: 'stepper' }, kids);
  }

  // ---------- Research log ----------
  function LogPanel(props) {
    var t = useState('NOTE'), type = t[0], setType = t[1];
    var x = useState(''), text = x[0], setText = x[1];
    var b = useState(false), busy = b[0], setBusy = b[1];
    function add() {
      if (!text.trim()) return;
      setBusy(true);
      sb.from('research_log').insert({ project_id: props.projectId, profile_id: props.authorId, type: type, summary: text.trim() }).then(function (r) {
        setBusy(false);
        if (r && r.error) { alert(r.error.message); return; }
        setText(''); props.onChanged();
      });
    }
    function del(e) { sb.from('research_log').delete().eq('id', e.id).then(props.onChanged); }
    var entries = props.entries || [];
    return h('div', { className: 'panel' },
      h('h3', null, 'Research log', h('span', { style: { fontWeight: 600, color: 'var(--faint)' } }, entries.length + ' entries')),
      props.canEdit ? h('div', { className: 'addrow', style: { marginTop: 0, marginBottom: 6 } },
        h('select', { value: type, onChange: function (e) { setType(e.target.value); } }, LOG_TYPES.map(function (lt) { return h('option', { key: lt, value: lt }, lt); })),
        h('input', { className: 'grow', value: text, placeholder: 'What did you do / decide / find?', onChange: function (e) { setText(e.target.value); }, onKeyDown: function (e) { if (e.key === 'Enter') add(); } }),
        h('button', { className: 'btn pri', disabled: busy, onClick: add }, 'Log')
      ) : null,
      entries.length ? entries.map(function (e) {
        var who = (e.profiles && e.profiles.name) || '';
        return h('div', { className: 'log-entry', key: e.id },
          h('span', { className: 'chip ' + (e.type === 'RESULT' || e.type === 'MILESTONE' ? 'c-ok' : (e.type === 'DECISION' ? 'c-acc' : 'c-grey')) }, e.type),
          h('div', { className: 'lt' }, h('p', null, e.summary), h('span', null, whenStr(e.ts) + (who ? ' · ' + who : ''))),
          props.canEdit ? h('button', { className: 'icon-x', onClick: function () { del(e); } }, '✕') : null
        );
      }) : h('div', { style: { fontSize: 13, color: 'var(--faint)', padding: '8px 0' } }, 'No log entries yet.')
    );
  }

  // ---------- Tasks ----------
  function TasksPanel(props) {
    var x = useState(''), text = x[0], setText = x[1];
    function add() { if (!text.trim()) return; sb.from('research_tasks').insert({ project_id: props.projectId, title: text.trim(), status: 'todo' }).then(function (r) { if (r && r.error) { alert(r.error.message); return; } setText(''); props.onChanged(); }); }
    function setStatus(tk, st) { sb.from('research_tasks').update({ status: st }).eq('id', tk.id).then(props.onChanged); }
    function del(tk) { sb.from('research_tasks').delete().eq('id', tk.id).then(props.onChanged); }
    var tasks = props.tasks || [];
    var open = tasks.filter(function (t) { return t.status !== 'done'; }).length;
    return h('div', { className: 'panel' },
      h('h3', null, 'Tasks', h('span', { style: { fontWeight: 600, color: 'var(--faint)' } }, open + ' open')),
      props.canEdit ? h('div', { className: 'addrow', style: { marginTop: 0, marginBottom: 6 } },
        h('input', { className: 'grow', value: text, placeholder: 'New task…', onChange: function (e) { setText(e.target.value); }, onKeyDown: function (e) { if (e.key === 'Enter') add(); } }),
        h('button', { className: 'btn pri', onClick: add }, 'Add')
      ) : null,
      tasks.length ? tasks.map(function (tk) {
        return h('div', { className: 'trow', key: tk.id },
          h('div', { className: 'tt' + (tk.status === 'done' ? ' done' : '') }, tk.title),
          props.canEdit ? h('div', { className: 'seg' }, ['todo', 'doing', 'done'].map(function (st) {
            return h('button', { key: st, className: tk.status === st ? 'on' : '', onClick: function () { setStatus(tk, st); } }, st);
          })) : h('span', { className: 'chip ' + (tk.status === 'done' ? 'c-ok' : (tk.status === 'doing' ? 'c-warn' : 'c-grey')) }, tk.status),
          props.canEdit ? h('button', { className: 'icon-x', onClick: function () { del(tk); } }, '✕') : null
        );
      }) : h('div', { style: { fontSize: 13, color: 'var(--faint)', padding: '8px 0' } }, 'No tasks yet.')
    );
  }

  // ---------- Attach to chat (library source / publication file / upload) ----------
  function AttachModal(props) {
    var fS = useState(null), files = fS[0], setFiles = fS[1];
    var pS = useState(null), latexProjects = pS[0], setLatexProjects = pS[1];
    var uS = useState(''), upMsg = uS[0], setUpMsg = uS[1];
    useEffect(function () {
      var owner = props.fileOwnerId || props.authorId;   // whose files to list = the VIEWED user (me.id), not the real session user — matters in admin-preview
      sb.from('publication_files').select('id,name,mime,size,storage_path').eq('owner_id', owner).order('created_at', { ascending: false }).then(function (r) { setFiles((r && r.data) || []); });
      sb.from('projects').select('id,title').eq('owner_id', owner).is('deleted_at', null).order('updated_at', { ascending: false }).then(function (r) { setLatexProjects((r && r.data) || []); });
    }, []);
    function onUpload(e) {
      var f = e.target.files && e.target.files[0]; if (!f) return;
      setUpMsg('Uploading…');
      // Office files → extract text and attach THAT (so the AI reads the content, not an opaque binary)
      if (window.PROffice && window.PROffice.isOffice(f.name)) {
        setUpMsg('Office-fájl feldolgozása…');
        window.PROffice.extract(f).then(function (r) {
          var name = f.name.replace(/\.(docx|xlsx|xlsm|xls|pptx)$/i, '') + '.' + (r.ext || 'md');
          var path = props.projectId + '/' + Date.now() + '_' + name.replace(/[^A-Za-z0-9._-]/g, '_');
          sb.storage.from('research-data').upload(path, new Blob([r.text || ''], { type: r.ext === 'csv' ? 'text/csv' : 'text/markdown' })).then(function (res) {
            if (res.error) { setUpMsg('Upload failed: ' + res.error.message); return; }
            props.onPick({ kind: 'file', bucket: 'research-data', path: path, name: name, mime: 'text/markdown', label: name }); props.onClose();
          });
        }, function (er) { setUpMsg('Office-feldolgozás hiba: ' + ((er && er.message) || er)); });
        return;
      }
      var path = props.projectId + '/' + Date.now() + '_' + f.name.replace(/[^A-Za-z0-9._-]/g, '_');
      sb.storage.from('research-data').upload(path, f).then(function (res) {
        if (res.error) { setUpMsg('Upload failed: ' + res.error.message); return; }
        props.onPick({ kind: 'file', bucket: 'research-data', path: path, name: f.name, mime: f.type || '', label: f.name }); props.onClose();
      });
    }
    var srcs = props.sources || [];
    var row = function (key, title, sub, pick) { return h('div', { className: 'src', key: key }, h('div', { style: { flex: 1, minWidth: 0 } }, h('b', { style: { fontSize: 13 } }, title), sub ? h('div', { style: { fontSize: 11.5, color: 'var(--muted)' } }, sub) : null), h('button', { className: 'btn', style: { padding: '4px 10px', fontSize: 12, flex: 'none' }, onClick: pick }, 'Attach')); };
    return h('div', { className: 'scrim', onClick: props.onClose },
      h('div', { className: 'modal', onClick: function (e) { e.stopPropagation(); } },
        h('div', { className: 'modal-h' }, h('b', null, 'Attach to the chat'), h('button', { className: 'x', onClick: props.onClose }, '×')),
        h('div', { className: 'modal-b' },
          h('div', { className: 'sec-t' }, 'Project library'),
          srcs.length ? srcs.map(function (s) { return row('s' + s.id, s.title, [s.year, s.venue].filter(Boolean).join(' · '), function () { props.onPick({ kind: 'source', source_id: s.id, title: s.title, label: s.title }); props.onClose(); }); }) : h('div', { style: { fontSize: 12.5, color: 'var(--faint)' } }, 'No library sources yet — add some on the Literature tab.'),
          h('div', { className: 'sec-t', style: { display: 'flex', alignItems: 'center', gap: 8 } }, h('span', null, 'My publication files'),
            (files && files.length > 1) ? h('button', { className: 'btn', style: { padding: '2px 8px', fontSize: 11, marginLeft: 'auto', flex: 'none' }, onClick: function () { files.forEach(function (f) { props.onPick({ kind: 'file', bucket: 'publication-files', path: f.storage_path, name: f.name, mime: f.mime, label: f.name }); }); props.onClose(); } }, '📎 Összes csatolása') : null),
          files === null ? h('div', { style: { fontSize: 12.5, color: 'var(--faint)' } }, 'Loading…') : (files.length ? files.map(function (f) { return row('f' + f.id, f.name, (f.mime || '') + (f.size ? ' · ' + fmtBytes(f.size) : ''), function () { props.onPick({ kind: 'file', bucket: 'publication-files', path: f.storage_path, name: f.name, mime: f.mime, label: f.name }); props.onClose(); }); }) : h('div', { style: { fontSize: 12.5, color: 'var(--faint)' } }, 'No files uploaded to your profile yet.')),
          h('div', { className: 'sec-t', style: { display: 'flex', alignItems: 'center', gap: 8 } }, h('span', null, 'My LaTeX publications'),
            (latexProjects && latexProjects.length > 1) ? h('button', { className: 'btn', style: { padding: '2px 8px', fontSize: 11, marginLeft: 'auto', flex: 'none' }, onClick: function () { latexProjects.forEach(function (p) { props.onPick({ kind: 'project', project_id: p.id, title: p.title, label: p.title || 'LaTeX' }); }); props.onClose(); } }, '📎 Összes csatolása') : null),
          latexProjects === null ? h('div', { style: { fontSize: 12.5, color: 'var(--faint)' } }, 'Loading…') : (latexProjects.length ? latexProjects.map(function (p) { return row('p' + p.id, p.title || 'Untitled', 'LaTeX projekt — a teljes szöveg csatolva lesz', function () { props.onPick({ kind: 'project', project_id: p.id, title: p.title, label: p.title || 'LaTeX' }); props.onClose(); }); }) : h('div', { style: { fontSize: 12.5, color: 'var(--faint)' } }, 'Nincs LaTeX publikációd (Editor-projekt) még.')),
          h('div', { className: 'sec-t' }, 'Upload a file'),
          h('div', null, h('input', { type: 'file', onChange: onUpload }), upMsg ? h('span', { style: { marginLeft: 8, fontSize: 12 } }, upMsg) : null)
        )
      )
    );
  }

  // ---------- Chat with Publify (R5b) ----------
  function mdHtml(t) {
    var s = String(t == null ? '' : t);
    try { if (window.marked && window.DOMPurify) return window.DOMPurify.sanitize(window.marked.parse(s, { breaks: true })); } catch (e) { }
    return s.replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }).replace(/\n/g, '<br>');
  }
  // wrap each rendered code block in a collapsible <details> so the AI's code stays folded until expanded
  function foldCode(html) {
    if (!html) return html;
    return html.replace(/<pre>/g, '<details class="code-fold"><summary>⟨⟩ Kód — kinyitás / összecsukás</summary><pre>').replace(/<\/pre>/g, '</pre></details>');
  }
  var CHAT_SUGGEST = ['What are the open problems in this field?', 'Summarize the key methods used so far.', 'Suggest 3 testable research questions for my goal.', 'What evidence would support or refute my hypothesis?'];
  // In a chat reply, the AI saves files via fenced ```file:<path> … ``` blocks. For DISPLAY we collapse
  // those to a compact chip (the full content lives in the file browser, not inline in the chat).
  function stripFiles(text) {
    if (!text) return text;
    return text.replace(/```file:([^\n`]+)\n[\s\S]*?```/g, function (_, p) { return '\n📄 **' + p.trim() + '** _(elmentve a fájlokhoz)_\n'; });
  }
  function extractFiles(text) {
    var out = [], re = /```file:([^\n`]+)\n([\s\S]*?)```/g, m;
    while ((m = re.exec(text || ''))) { out.push({ path: m[1].trim(), content: m[2].replace(/\n+$/, '') }); }
    return out;
  }

  // #5 — lazy-load mammoth (Word .docx → markdown) only when a user actually imports a Word file
  var _mammothP = null;
  function loadMammoth() {
    if (window.mammoth) return Promise.resolve(window.mammoth);
    if (!_mammothP) _mammothP = new Promise(function (resolve, reject) {
      var s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js';
      s.onload = function () { resolve(window.mammoth); }; s.onerror = reject; document.head.appendChild(s);
    });
    return _mammothP;
  }

  // ---------- Session file browser (Antigravity-style): the project's file tree next to the chat ----------
  function SessionFileBrowser(props) {
    var fS = useState(null), files = fS[0], setFiles = fS[1];
    var pvS = useState(null), preview = pvS[0], setPreview = pvS[1];
    var adS = useState(false), added = adS[0], setAdded = adS[1];   // #8: brief "added to ideas" feedback
    var spS = useState(null), selPop = spS[0], setSelPop = spS[1];   // #1: text selection in the MD preview → "add to idea" popup
    var upRef = useRef(null);
    function onPreviewMouseUp() {
      if (!(props.canEdit && props.onAddIdea)) return;
      setTimeout(function () {
        var s = window.getSelection ? window.getSelection() : null;
        var txt = s ? String(s).trim() : '';
        if (txt && txt.length > 3) { try { var r = s.getRangeAt(0).getBoundingClientRect(); setSelPop({ text: txt, x: r.left + r.width / 2, y: r.top }); } catch (e) { setSelPop(null); } }
        else setSelPop(null);
      }, 1);
    }
    function load() { sb.from('research_files').select('id,path,content,storage_path,mime,size,source,updated_at').eq('project_id', props.projectId).order('updated_at', { ascending: false }).then(function (r) { setFiles((r && r.data) || []); }); }
    useEffect(load, [props.projectId, props.version]);
    function newFile() {
      var name = (window.prompt('Új fájl neve:', 'jegyzet.md') || '').trim(); if (!name) return;
      sb.from('research_files').upsert({ project_id: props.projectId, path: name, content: '', mime: 'text/markdown', source: 'manual', created_by: props.authorId, updated_by: props.authorId, updated_at: new Date().toISOString() }, { onConflict: 'project_id,path' }).then(function (r) { if (r && r.error) { alert(r.error.message); return; } load(); });
    }
    function onUpload(e) {
      var f = e.target.files && e.target.files[0]; if (!f) return;
      if (upRef.current) upRef.current.value = '';
      if (window.PROffice && window.PROffice.isOffice(f.name)) { importOffice(f); return; }   // Word/Excel/PowerPoint → editable text/markdown
      var sp = props.projectId + '/files/' + Date.now() + '_' + f.name.replace(/[^A-Za-z0-9._-]/g, '_');
      sb.storage.from('research-data').upload(sp, f).then(function (res) {
        if (res && res.error) { alert(res.error.message); return; }
        sb.from('research_files').upsert({ project_id: props.projectId, path: f.name, storage_path: sp, mime: f.type || 'application/octet-stream', size: f.size, source: 'upload', created_by: props.authorId, updated_by: props.authorId, updated_at: new Date().toISOString() }, { onConflict: 'project_id,path' }).then(load);
      });
    }
    // Office (Word/Excel/PowerPoint) → editable markdown/CSV stored as a text file (shared PROffice util)
    function importOffice(f) {
      window.PROffice.extract(f).then(function (r) {
        var name = f.name.replace(/\.(docx|xlsx|xlsm|xls|pptx)$/i, '') + '.' + (r.ext || 'md');
        sb.from('research_files').upsert({ project_id: props.projectId, path: name, content: r.text || '', mime: r.ext === 'csv' ? 'text/csv' : 'text/markdown', source: 'upload', created_by: props.authorId, updated_by: props.authorId, updated_at: new Date().toISOString() }, { onConflict: 'project_id,path' }).then(function (rr) { if (rr && rr.error) { alert(rr.error.message); return; } load(); });
      }, function (er) { alert('Office-feldolgozás hiba: ' + ((er && er.message) || er)); });
    }
    function del(f) { if (!window.confirm('Törlöd: ' + f.path + ' ?')) return; sb.from('research_files').delete().eq('id', f.id).then(function () { if (f.storage_path) { try { sb.storage.from('research-data').remove([f.storage_path]); } catch (e) { } } if (preview && preview.id === f.id) setPreview(null); load(); }); }
    function openSigned(path) { sb.storage.from('research-data').createSignedUrl(path, 3600).then(function (r) { if (r && r.data && r.data.signedUrl) window.open(r.data.signedUrl, '_blank'); }); }
    function dlBlob(name, url) { var a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
    function download(f) {   // #1: download a file (inline content as a blob; binary via a forced-download signed URL)
      if (f.content != null) { var u = URL.createObjectURL(new Blob([f.content], { type: 'text/plain;charset=utf-8' })); dlBlob(f.path, u); setTimeout(function () { URL.revokeObjectURL(u); }, 4000); }
      else if (f.storage_path) { sb.storage.from('research-data').createSignedUrl(f.storage_path, 3600, { download: f.path }).then(function (r) { if (r && r.data && r.data.signedUrl) dlBlob(f.path, r.data.signedUrl); }); }
    }
    function attach(f) { props.onAttach({ kind: f.content != null ? 'projectfile' : 'file', file_id: f.id, bucket: 'research-data', path: f.storage_path, name: f.path, title: f.path, label: f.path }); }
    function icon(f) { var p = (f.path || '').toLowerCase(); if (/\.md$|\.txt$/.test(p)) return '📄'; if (/\.(png|jpe?g|gif|webp|svg)$/.test(p)) return '🖼'; if (/\.pdf$/.test(p)) return '📕'; if (/\.(csv|tsv|xlsx?)$/.test(p)) return '📊'; return '📎'; }
    return h('div', { className: 'filebrowser', style: { width: (props.width || 256) } },
      h('div', { className: 'fb-head' }, h('b', null, 'Files'), h('span', { style: { flex: 1 } }),
        props.canEdit ? h('button', { className: 'fb-mini', title: 'Új fájl', onClick: newFile }, '+') : null,
        props.canEdit ? h('button', { className: 'fb-mini', title: 'Feltöltés', onClick: function () { if (upRef.current) upRef.current.click(); } }, '⤒') : null,
        h('input', { ref: upRef, type: 'file', style: { display: 'none' }, onChange: onUpload })
      ),
      files === null ? h('div', { className: 'fb-empty' }, 'Betöltés…')
        : (files.length ? h('div', { className: 'fb-list' }, files.map(function (f) {
          return h('div', { className: 'fb-item' + (preview && preview.id === f.id ? ' on' : ''), key: f.id },
            h('button', { className: 'fb-name', title: f.path, onClick: function () { setPreview(f); } }, h('span', { className: 'fb-ic' }, icon(f)), h('span', { className: 'fb-lbl' }, f.path), f.source === 'ai' ? h('span', { className: 'fb-tag' }, 'AI') : null),
            h('span', { className: 'fb-acts' },
              h('button', { className: 'fb-mini', title: 'Letöltés', onClick: function () { download(f); } }, '⬇'),
              props.canEdit ? h('button', { className: 'fb-mini', title: 'Csatolás a chathez', onClick: function () { attach(f); } }, '📎') : null,
              props.canEdit ? h('button', { className: 'fb-mini', title: 'Törlés', onClick: function () { del(f); } }, '×') : null));
        })) : h('div', { className: 'fb-empty' }, 'Még nincs fájl. Kérd a chatben: „írd ki egy fájlba…", vagy tölts fel egyet.')),
      preview ? h('div', { className: 'fb-preview' },
        h('div', { className: 'fb-pv-head' }, h('span', { className: 'fb-lbl' }, preview.path),
          (props.canEdit && props.onAddIdea && preview.content != null) ? h('button', { className: 'fb-mini', style: { width: 'auto', padding: '0 7px', fontSize: 11, color: 'var(--accent)' }, title: 'A fájl tartalmának hozzáadása ötletként', onClick: function () { props.onAddIdea(preview.content); setAdded(true); setTimeout(function () { setAdded(false); }, 1800); } }, added ? '✓ Hozzáadva' : '✚ Ötlethez') : null,
          h('button', { className: 'fb-mini', onClick: function () { setPreview(null); } }, '×')),
        preview.content != null
          ? h('div', { className: 'btxt md', style: { fontSize: 12.5 }, onMouseUp: onPreviewMouseUp, onScroll: function () { if (selPop) setSelPop(null); }, dangerouslySetInnerHTML: { __html: mdHtml(preview.content) } })
          : h('button', { className: 'btn', style: { fontSize: 12 }, onClick: function () { openSigned(preview.storage_path); } }, 'Megnyitás / letöltés →')
      ) : null,
      // #1 — floating "add the selected passage to a research idea" button, popped on a text selection in the preview
      selPop ? h('button', { className: 'sel-idea-btn', style: { position: 'fixed', left: selPop.x, top: selPop.y - 40, transform: 'translateX(-50%)', zIndex: 60 }, onMouseDown: function (e) { e.preventDefault(); }, onClick: function () { props.onAddIdea(selPop.text); setSelPop(null); try { window.getSelection().removeAllRanges(); } catch (e) { } } }, '✚ Ötlethez') : null
    );
  }

  function ChatPanel(props) {
    var cS = useState(null), chat = cS[0], setChat = cS[1];
    var mS = useState([]), msgs = mS[0], setMsgs = mS[1];
    var eS = useState({}), evByMsg = eS[0], setEvByMsg = eS[1];
    var iS = useState(''), input = iS[0], setInput = iS[1];
    var bS = useState(false), busy = bS[0], setBusy = bS[1];
    var er = useState(''), err = er[0], setErr = er[1];
    var ty = useState(null), typing = ty[0], setTyping = ty[1];          // { id, len } of the message being typed out (non-stream fallback)
    var stmS = useState(null), streaming = stmS[0], setStreaming = stmS[1];   // { text } while a reply streams in live
    var fvS = useState(0), filesVersion = fvS[0], setFilesVersion = fvS[1];   // bump to refresh the file browser after the AI writes files
    var fbwS = useState(function () { try { return parseInt(localStorage.getItem('pr-fb-width') || '280', 10) || 280; } catch (e) { return 280; } }), fbWidth = fbwS[0], setFbWidth = fbwS[1];   // resizable file-browser width
    var spS = useState(null), selPop = spS[0], setSelPop = spS[1];   // { text, x, y } floating "add selection to ideas" button
    var atS = useState([]), attach = atS[0], setAttach = atS[1];          // pending attachments for the next message
    var pkS = useState(false), picker = pkS[0], setPicker = pkS[1];
    var enS = useState(false), enhancing = enS[0], setEnhancing = enS[1];   // #6: prompt enhancement in flight
    var firstLoad = useRef(true), animated = useRef({}), alive = useRef(true), scrollRef = useRef(null), taRef = useRef(null), justStreamed = useRef(false);
    var sgS = useState(''), sgMsg = sgS[0], setSgMsg = sgS[1];
    var sgB = useState(false), sgBusy = sgB[0], setSgBusy = sgB[1];
    useEffect(function () { return function () { alive.current = false; }; }, []);
    // #3 — AI ideas are generated ON DEMAND (button), not continuously: pull NEW research ideas out of the
    // current conversation into the Ideas list as candidates (deduped + capped server-side; user accepts/rejects).
    function suggestIdeas() {
      if (sgBusy) return;
      if (!msgs.length) { setSgMsg('Előbb beszélgess a projektről — abból javaslok ötleteket.'); setTimeout(function () { setSgMsg(''); }, 3500); return; }
      setSgBusy(true); setSgMsg('Ötletek generálása a beszélgetésből (AI)…');
      var transcript = msgs.slice(-16).map(function (m) { return (m.role === 'assistant' ? 'AI: ' : 'User: ') + String(m.content || ''); }).join('\n\n').slice(0, 12000);
      sb.functions.invoke('research-ai', { body: { action: 'suggest', project_id: props.projectId, text: transcript } }).then(function (res) {
        setSgBusy(false);
        if (res && res.error) { setSgMsg('AI nincs beállítva (research-ai / ANTHROPIC_API_KEY).'); return; }
        var d = res && res.data;
        if (d && d.count) { setSgMsg('✓ ' + d.count + ' új ötlet az Ötletek listában.'); props.onChanged(); }
        else setSgMsg('Nem találtam új ötletet ebben a beszélgetésben.');
        setTimeout(function () { setSgMsg(''); }, 4500);
      }, function () { setSgBusy(false); setSgMsg('AI hívás sikertelen.'); });
    }
    function startTyping(id, full) {
      if (!full) return;
      // reveal word-by-word at a calm, readable pace (each word fades in) — clearly slower than a raw
      // char dump, but the per-token delay scales down for long replies so they never drag.
      var toks = full.split(/(\s+)/);
      var per = Math.max(15, Math.min(48, Math.round(7000 / toks.length)));
      var n = 0;
      setTyping({ id: id, n: 0 });
      (function tick() {
        if (!alive.current) return;
        n += 1;
        if (n >= toks.length) { setTyping(null); return; }
        setTyping({ id: id, n: n });
        setTimeout(tick, per);
      })();
    }
    function loadMsgs(cid) {
      Promise.all([
        sb.from('research_messages').select('id,role,content,created_at').eq('chat_id', cid).order('created_at', { ascending: true }),
        sb.from('research_evidence').select('message_id').eq('chat_id', cid)
      ]).then(function (res) {
        var data = (res[0] && res[0].data) || [];
        setMsgs(data);
        var by = {}; ((res[1] && res[1].data) || []).forEach(function (e) { if (e.message_id) by[e.message_id] = (by[e.message_id] || 0) + 1; });
        setEvByMsg(by);
        if (firstLoad.current) { data.forEach(function (m) { animated.current[m.id] = true; }); firstLoad.current = false; }  // no animation on the initial history load
        else {
          var aMsgs = data.filter(function (m) { return m.role === 'assistant'; });
          var last = aMsgs[aMsgs.length - 1];
          if (last && !animated.current[last.id]) { animated.current[last.id] = true; if (!justStreamed.current) startTyping(last.id, last.content); }  // a streamed reply was already revealed live → no replay
          justStreamed.current = false;
        }
      });
    }
    useEffect(function () {
      sb.from('research_chats').select('id').eq('project_id', props.projectId).order('created_at', { ascending: true }).limit(1).then(function (r) {
        var c = (r && r.data && r.data[0]) || null; setChat(c); if (c) loadMsgs(c.id);
      });
    }, []);
    useEffect(function () { var el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; }, [msgs.length, typing, streaming]);  // follow the conversation (incl. live stream)
    function ensureChat() {
      if (chat) return Promise.resolve(chat.id);
      return sb.from('research_chats').insert({ project_id: props.projectId, title: 'Publify chat' }).select('id').maybeSingle().then(function (r) { var c = r && r.data; setChat(c); return c && c.id; });
    }
    // Persist any ```file:…``` blocks the AI emitted into the project's file browser.
    function saveAiFiles(text) {
      var fs = extractFiles(text); if (!fs.length) return;
      Promise.all(fs.map(function (f) {
        return sb.from('research_files').upsert({ project_id: props.projectId, path: f.path, content: f.content, mime: 'text/markdown', size: (f.content || '').length, source: 'ai', created_by: props.authorId, updated_by: props.authorId, updated_at: new Date().toISOString() }, { onConflict: 'project_id,path' });
      })).then(function () { setFilesVersion(function (v) { return v + 1; }); });
    }
    // Real token streaming: POST to the Edge function and append text deltas to a live bubble as they arrive.
    function streamReply(cid) {
      var CFG = window.PR_CONFIG || {};
      if (!CFG.supabaseUrl) { setBusy(false); setErr('Missing backend config.'); return; }
      sb.auth.getSession().then(function (s) {
        var token = (s && s.data && s.data.session && s.data.session.access_token) || CFG.supabaseAnonKey;
        fetch(CFG.supabaseUrl + '/functions/v1/research-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': CFG.supabaseAnonKey, 'Authorization': 'Bearer ' + token },
          body: JSON.stringify({ chat_id: cid, stream: true })
        }).then(function (resp) {
          if (!resp.ok || !resp.body || !resp.body.getReader) { setBusy(false); setErr('AI connection pending — deploy the research-chat Edge function and set ANTHROPIC_API_KEY.'); return; }
          var reader = resp.body.getReader(), dec = new TextDecoder(), acc = '';
          setStreaming({ text: '' });
          (function pump() {
            reader.read().then(function (r) {
              if (!alive.current) return;
              if (r.done) { setStreaming(null); setBusy(false); justStreamed.current = true; saveAiFiles(acc); loadMsgs(cid); return; }
              acc += dec.decode(r.value, { stream: true });
              setStreaming({ text: acc });
              pump();
            }, function () { setStreaming(null); setBusy(false); loadMsgs(cid); });
          })();
        }, function () { setBusy(false); setErr('AI connection pending — deploy the research-chat Edge function.'); });
      });
    }
    function sendText(raw) {
      var txt = (raw || '').trim();
      if (!txt || busy) return;
      var atts = attach;
      setBusy(true); setErr(''); setInput(''); setAttach([]);
      if (taRef.current) taRef.current.style.height = 'auto';
      ensureChat().then(function (cid) {
        if (!cid) { setBusy(false); setErr('Could not start a chat.'); return; }
        var payload = { chat_id: cid, role: 'user', content: txt }; if (atts.length) payload.attachments = atts;   // omit the column when unused (works pre-migration-17)
        sb.from('research_messages').insert(payload).then(function (ins) {
          if (ins && ins.error) { setBusy(false); setErr(atts.length ? 'Attachments need migration-17 + a research-chat redeploy — ' + ins.error.message : ins.error.message); return; }
          loadMsgs(cid);
          streamReply(cid);   // live token stream → persisted + reloaded on completion
        });
      });
    }
    function send() { sendText(input); }
    // #6 — rewrite the current input into a clearer, more specific prompt via research-ai (action: enhance)
    function enhance() {
      var txt = (input || '').trim(); if (!txt || enhancing || busy) return;
      setEnhancing(true); setErr('');
      sb.functions.invoke('research-ai', { body: { action: 'enhance', project_id: props.projectId, text: txt } }).then(function (res) {
        setEnhancing(false);
        if (res && res.error) { setErr('A prompt-feljavítás nem elérhető (research-ai / ANTHROPIC_API_KEY).'); return; }
        var d = res && res.data;
        if (d && d.text) { setInput(d.text); var ta = taRef.current; if (ta) { setTimeout(function () { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'; ta.focus(); }, 0); } }
      }, function () { setEnhancing(false); setErr('A prompt-feljavítás nem elérhető.'); });
    }
    function copy(m) { try { navigator.clipboard.writeText(m.content || ''); } catch (e) { } }
    function onTaKey(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }
    function onTaInput(e) { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px'; }
    function saveIdea(m) { sb.from('research_ideas').insert({ project_id: props.projectId, source: 'consensus', question: (m.content || '').slice(0, 8000), created_by: props.authorId, status: 'candidate' }).then(function (r) { if (r && r.error) { alert(r.error.message); return; } props.onChanged(); }); }
    function saveIdeaText(text) { sb.from('research_ideas').insert({ project_id: props.projectId, source: 'own', question: (text || '').slice(0, 8000), created_by: props.authorId, status: 'candidate' }).then(function (r) { if (r && r.error) { alert(r.error.message); return; } props.onChanged(); }); }
    // drag the divider to resize the file browser (the chat takes the rest); persisted in localStorage
    function startResize(e) {
      e.preventDefault();
      var startX = e.clientX, startW = fbWidth, last = startW;
      function move(ev) { last = Math.max(190, Math.min(620, startW + (startX - ev.clientX))); setFbWidth(last); }
      function up() { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); document.body.style.cursor = ''; try { localStorage.setItem('pr-fb-width', String(last)); } catch (e2) { } }
      document.body.style.cursor = 'col-resize';
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    }
    // a text selection inside a chat bubble pops an "add to ideas" button
    function onChatMouseUp() {
      if (!props.canEdit) return;
      setTimeout(function () {
        var s = window.getSelection ? window.getSelection() : null;
        var txt = s ? String(s).trim() : '';
        if (txt && txt.length > 3) { try { var r = s.getRangeAt(0).getBoundingClientRect(); setSelPop({ text: txt, x: r.left + r.width / 2, y: r.top }); } catch (e) { setSelPop(null); } }
        else setSelPop(null);
      }, 1);
    }
    return h('div', { className: 'panel chatwrap' },
      h('div', { className: 'chat-col' },
      h('h3', null, 'Chat with Publify', h('span', { style: { fontWeight: 600, color: 'var(--faint)' } }, 'research assistant')),
      props.canEdit ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' } },
        h('button', { className: 'btn', style: { padding: '4px 10px', fontSize: 12 }, disabled: sgBusy || !msgs.length, title: 'A mostani beszélgetés tartalmából ötleteket javasol az Ötletek listába (kézzel, nem folyamatosan)', onClick: suggestIdeas }, sgBusy ? '💡 Generálás…' : '💡 Ötletek generálása a beszélgetésből'),
        sgMsg ? h('span', { style: { fontSize: 12, color: 'var(--muted)' } }, sgMsg) : null
      ) : null,
      props.supervised ? h('div', { style: { fontSize: 12, color: 'var(--muted)', background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 8, padding: '7px 11px', marginBottom: 10, lineHeight: 1.45 } }, 'ℹ️ A kutatási beszélgetéseidből a témavezetőd napi összefoglalót kaphat (mit dolgoztál, milyen döntéseket hoztál).') : null,
      h('div', { className: 'chat-msgs', ref: scrollRef, onMouseUp: onChatMouseUp, onScroll: function () { if (selPop) setSelPop(null); } },
        msgs.length ? msgs.map(function (m) {
          var isTyping = typing && typing.id === m.id;
          var ai = m.role === 'assistant';
          var body;
          if (ai && !isTyping) body = h('div', { className: 'btxt md', dangerouslySetInnerHTML: { __html: foldCode(mdHtml(stripFiles(m.content))) } });
          else if (ai && isTyping) {
            var toks = (m.content || '').split(/(\s+)/), shown = toks.slice(0, typing.n);
            body = h('div', { className: 'btxt' }, shown.slice(0, -1).join(''), h('span', { key: typing.n, className: 'tw-word' }, shown[shown.length - 1] || ''), h('span', { className: 'tw-cursor' }, '▌'));
          } else body = h('div', { className: 'btxt' }, m.content);
          return h('div', { key: m.id, className: 'bubble ' + (ai ? 'ai' : 'user') },
            body,
            (ai && !isTyping) ? h('div', { className: 'bmeta' },
              evByMsg[m.id] ? h('span', null, '📄 ' + evByMsg[m.id] + ' sources') : null,
              h('button', { className: 'copybtn', onClick: function () { copy(m); } }, 'Copy'),
              props.canEdit ? h('button', { className: 'savebtn', onClick: function () { saveIdea(m); } }, '✚ Save as idea') : null
            ) : null
          );
        }) : h('div', null,
          h('div', { className: 'chat-empty' }, 'Ask Publify about your topic — grounded in evidence when Consensus is connected.'),
          props.canEdit ? h('div', { className: 'chat-suggest' }, CHAT_SUGGEST.map(function (s, i) { return h('button', { key: i, onClick: function () { sendText(s); } }, s); })) : null
        ),
        streaming ? h('div', { className: 'bubble ai', key: 'stream' }, h('div', { className: 'btxt' }, streaming.text || '', h('span', { className: 'tw-cursor' }, '▌')))
          : busy ? h('div', { className: 'bubble ai' }, h('div', { className: 'btxt', style: { color: 'var(--faint)' } }, 'Publify is thinking…')) : null
      ),
      err ? h('div', { style: { fontSize: 12.5, color: 'var(--warn)', margin: '6px 0 0' } }, err) : null,
      props.canEdit ? h('div', null,
        attach.length ? h('div', { className: 'attach-chips' }, attach.map(function (a, i) {
          return h('span', { className: 'attach-chip', key: i }, (a.kind === 'source' ? '📄 ' : '📎 ') + (a.label || a.name || a.title || 'attachment'),
            h('button', { title: 'Remove', onClick: function () { setAttach(attach.filter(function (_, j) { return j !== i; })); } }, '×'));
        })) : null,
        h('div', { className: 'chat-input' },
          h('button', { className: 'attach-btn', title: 'Attach a library source, publication or file', disabled: busy, onClick: function () { setPicker(true); } }, '📎'),
          h('button', { className: 'attach-btn', title: 'Prompt feljavítása (AI) — érthetőbbé, konkrétabbá teszi a beírt szöveget', disabled: busy || enhancing || !input.trim(), onClick: enhance }, enhancing ? '⏳' : '✨'),
          h('textarea', { ref: taRef, value: input, rows: 1, placeholder: 'Message Publify…  (Enter to send · Shift+Enter newline)', disabled: busy, onChange: onTaInput, onKeyDown: onTaKey }),
          h('button', { className: 'btn pri', disabled: busy, onClick: send }, 'Send')
        )
      ) : null
      ),
      h('div', { className: 'fb-resizer', onMouseDown: startResize, title: 'Húzd az ablakok átméretezéséhez' }),
      h(SessionFileBrowser, { projectId: props.projectId, authorId: props.authorId, canEdit: props.canEdit, version: filesVersion, width: fbWidth, onAttach: function (a) { setAttach(function (p) { return p.concat([a]); }); }, onAddIdea: function (text) { saveIdeaText(text); } }),
      selPop ? h('button', { className: 'sel-idea-btn', style: { position: 'fixed', left: selPop.x, top: selPop.y - 40, transform: 'translateX(-50%)', zIndex: 60 }, onMouseDown: function (e) { e.preventDefault(); }, onClick: function () { saveIdeaText(selPop.text); setSelPop(null); try { window.getSelection().removeAllRanges(); } catch (e) { } } }, '✚ Ötlethez') : null,
      picker ? h(AttachModal, { projectId: props.projectId, authorId: props.authorId, fileOwnerId: props.fileOwnerId, sources: props.sources, onPick: function (a) { setAttach(function (p) { return p.concat([a]); }); }, onClose: function () { setPicker(false); } }) : null
    );
  }

  // ---------- Ideas (R1) ----------
  function IdeasPanel(props) {
    var f = useState({ question: '', hypothesis: '' }), form = f[0], setForm = f[1];
    var b = useState(false), busy = b[0], setBusy = b[1];
    var m = useState(''), msg = m[0], setMsg = m[1];
    var exS = useState({}), expanded = exS[0], setExpanded = exS[1];   // #10: per-idea open/closed
    function toggle(id) { setExpanded(function (e) { var n = Object.assign({}, e); n[id] = e[id] === false ? true : false; return n; }); }
    function add() {
      var q = form.question.trim();
      if (!q) { setMsg('Type a research question first.'); return; }
      // #11 — tell the user instead of silently storing a duplicate
      if ((props.ideas || []).some(function (i) { return (i.question || '').trim().toLowerCase() === q.toLowerCase(); })) { setMsg('⚠️ Ez az ötlet már szerepel a listában.'); return; }
      setMsg('');
      sb.from('research_ideas').insert({ project_id: props.projectId, source: 'own', question: q, hypothesis: form.hypothesis.trim() || null, created_by: props.authorId, status: 'candidate' }).then(function (r) { if (r && r.error) { setMsg('Could not add: ' + r.error.message); return; } setForm({ question: '', hypothesis: '' }); setMsg('✓ Ötlet hozzáadva.'); setTimeout(function () { setMsg(''); }, 2500); props.onChanged(); });
    }
    function onKey(e) { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); add(); } }
    function setStatus(idea, st) { sb.from('research_ideas').update({ status: st }).eq('id', idea.id).then(props.onChanged); }
    function del(idea) { sb.from('research_ideas').delete().eq('id', idea.id).then(props.onChanged); }
    function gap() {
      setBusy(true); setMsg('Running gap analysis (AI)…');
      sb.functions.invoke('research-ai', { body: { action: 'gap', project_id: props.projectId } }).then(function (res) {
        setBusy(false);
        if (res && res.error) { setMsg('AI not configured yet — deploy the research-ai Edge function (supabase/functions/research-ai) and set ANTHROPIC_API_KEY.'); return; }
        setMsg(''); props.onChanged();
      }, function () { setBusy(false); setMsg('AI not configured yet — deploy the research-ai Edge function.'); });
    }
    var ideas = props.ideas || [];
    var selected = ideas.filter(function (i) { return i.status === 'selected'; });
    var rest = ideas.filter(function (i) { return i.status !== 'selected'; });
    return h('div', null,
      // 📌 separate "study basis" window — collects the ideas chosen (Select) as the study's foundation
      h('div', { className: 'panel', style: { marginBottom: 10, border: '1.5px solid var(--accent)' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('h3', { style: { margin: 0 } }, '📌 A tanulmány alapja' + (selected.length ? ' — ' + selected.length + ' ötlet' : '')),
          props.onGoStudy ? h('button', { className: 'btn', style: { marginLeft: 'auto', padding: '4px 10px', fontSize: 12, flex: 'none' }, title: 'Ugrás a meglévő tanulmányokhoz', onClick: function () { props.onGoStudy(); } }, '📚 Tanulmányok →') : null),
        selected.length ? h('div', null,
          selected.map(function (idea) {
            return h('div', { key: idea.id, style: { display: 'flex', gap: 8, alignItems: 'flex-start', padding: '7px 0', borderTop: '1px solid var(--line)' } },
              h('div', { style: { flex: 1, minWidth: 0 } },
                h('div', { style: { fontSize: 13, fontWeight: 600, whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, idea.question),
                idea.hypothesis ? h('div', { style: { fontSize: 12, color: 'var(--muted)', marginTop: 2, whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, idea.hypothesis) : null
              ),
              props.canEdit ? h('button', { className: 'icon-x', title: 'Eltávolítás az alapból', style: { flex: 'none' }, onClick: function () { setStatus(idea, 'candidate'); } }, '✕') : null
            );
          }),
          props.onStartStudyMulti ? h('div', { style: { marginTop: 10 } }, h('button', { className: 'btn pri', onClick: function () { props.onStartStudyMulti(selected); } }, '🔬 Tanulmány indítása ezekből az ötletekből →'),
            h('div', { style: { fontSize: 11.5, color: 'var(--faint)', marginTop: 5 } }, 'Claude kitölti a Step-1 mezőit (kulcsszavak, kritériumok, szűrők) az ötletek alapján — utána átírhatod.')) : null
        ) : h('div', { style: { fontSize: 12.5, color: 'var(--faint)' } }, 'Még üres. Lent egy ötletnél nyomd a „Select" gombot — ide kerül, és ezek lesznek a tanulmány alapjai.')
      ),
      h('div', { className: 'panel' },
      h('h3', null, 'Research ideas', props.canEdit ? h('button', { className: 'btn', style: { padding: '4px 10px', fontSize: 12 }, disabled: busy, onClick: gap }, '✨ Gap analysis (AI)') : null),
      msg ? h('div', { style: { fontSize: 12.5, color: 'var(--muted)', marginBottom: 8 } }, msg) : null,
      props.canEdit ? h('div', { style: { marginBottom: 10 } },
        h('textarea', { rows: 2, style: { width: '100%', minHeight: 40, border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px', fontFamily: 'inherit', fontSize: 13, lineHeight: 1.45, resize: 'vertical', boxSizing: 'border-box' }, value: form.question, placeholder: 'A research question…  (Ctrl/⌘+Enter = hozzáadás)', onChange: function (e) { setForm(Object.assign({}, form, { question: e.target.value })); }, onKeyDown: onKey }),
        h('textarea', { rows: 2, style: { width: '100%', minHeight: 40, marginTop: 6, border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px', fontFamily: 'inherit', fontSize: 13, lineHeight: 1.45, resize: 'vertical', boxSizing: 'border-box' }, value: form.hypothesis, placeholder: 'Hypothesis (optional)', onChange: function (e) { setForm(Object.assign({}, form, { hypothesis: e.target.value })); }, onKeyDown: onKey }),
        h('div', { style: { marginTop: 8 } }, h('button', { className: 'btn pri', onClick: add }, 'Add idea'))
      ) : null,
      rest.length ? rest.map(function (idea) {
        var open = expanded[idea.id] !== false;   // #10: default open; click chevron / question to collapse
        return h('div', { className: 'idea', key: idea.id },
          h('div', { style: { display: 'flex', gap: 7, alignItems: 'center', marginBottom: 4 } },
            h('button', { className: 'icon-x', title: open ? 'Összecsukás' : 'Kinyitás', style: { marginRight: 1, flex: 'none' }, onClick: function () { toggle(idea.id); } }, open ? '▾' : '▸'),
            h('span', { className: 'chip ' + (idea.source === 'gap' || idea.source === 'chat' ? 'c-acc' : 'c-grey') }, idea.source === 'chat' ? '💡 AI (chat)' : idea.source === 'gap' ? '💡 AI (gap)' : idea.source === 'own' ? 'saját' : idea.source),
            idea.novelty != null ? h('span', { className: 'chip c-ok' }, 'novelty ' + idea.novelty) : null,
            h('span', { className: 'chip ' + (idea.status === 'selected' ? 'c-ok' : (idea.status === 'rejected' ? 'c-grey' : 'c-warn')) }, idea.status),
            props.canEdit ? h('button', { className: 'icon-x', style: { marginLeft: 'auto' }, onClick: function () { del(idea); } }, '✕') : null
          ),
          h('div', { onClick: function () { toggle(idea.id); }, title: open ? '' : idea.question, style: open ? { fontSize: 13.5, fontWeight: 600, whiteSpace: 'pre-wrap', wordBreak: 'break-word', cursor: 'pointer' } : { fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'pointer' } }, idea.question),
          open && idea.hypothesis ? h('div', { style: { fontSize: 12.5, color: 'var(--muted)', marginTop: 2, whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, idea.hypothesis) : null,
          open && idea.rationale ? h('div', { style: { fontSize: 12, color: 'var(--faint)', marginTop: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, idea.rationale) : null,
          props.canEdit ? h('div', { className: 'idea-foot' },
            h('button', { onClick: function () { setStatus(idea, 'selected'); } }, 'Select'),
            h('button', { onClick: function () { setStatus(idea, 'rejected'); } }, 'Reject'),
            h('button', { onClick: function () { setStatus(idea, 'candidate'); } }, 'Reset')
          ) : null
        );
      }) : h('div', { style: { fontSize: 13, color: 'var(--faint)', padding: '8px 0' } }, selected.length ? 'Minden ötlet a tanulmány alapjába került — adj hozzá újat fent.' : 'No ideas yet — add your own or run a gap analysis.')
      )
    );
  }

  // ---------- Literature (R1, OpenAlex) ----------
  function abstractFromInverted(inv) { if (!inv) return null; var w = []; Object.keys(inv).forEach(function (k) { inv[k].forEach(function (p) { w[p] = k; }); }); return w.join(' ').slice(0, 1500); }
  function normWork(w) { var s = (w.primary_location && w.primary_location.source) || {}; return { journal: s.display_name, type: s.type, indexed: !!s.is_core, doaj: !!s.is_in_doaj, oa: !!(w.open_access && w.open_access.is_oa), fwci: w.fwci, year: w.publication_year, date: w.publication_date, cites: w.cited_by_count }; }
  // SCImago (Scopus) quartile map — lazy-loaded once; absent/{} until backend/scimago/build_scimago.py is run
  var _scimago = null, _scimagoP = null;
  function loadScimago() {
    if (_scimago) return Promise.resolve(_scimago);
    if (_scimagoP) return _scimagoP;
    _scimagoP = fetch('scimago-scopus.json').then(function (r) { return r.ok ? r.json() : {}; }).then(function (m) { _scimago = m || {}; return _scimago; }, function () { _scimago = {}; return _scimago; });
    return _scimagoP;
  }
  function scopusQ(map, w) {
    if (!map) return null;
    var s = (w.primary_location && w.primary_location.source) || {}, c = [];
    if (s.issn_l) c.push(s.issn_l);
    if (Array.isArray(s.issn)) c = c.concat(s.issn);
    for (var i = 0; i < c.length; i++) { var n = String(c[i] || '').replace(/[^0-9Xx]/g, '').toUpperCase(); if (n.length === 8 && map[n]) return map[n]; }
    return null;
  }
  function metricTags(o) {
    var t = [];
    if (o.journal) t.push(h('span', { className: 'mtag j', key: 'j', title: 'Journal / venue' }, o.journal));
    if (o.scopus) t.push(h('span', { className: 'mtag sc', key: 's', title: 'Scopus quartile (SCImago Journal Rank) — Q1 is the top 25% by SJR in its field' }, 'Scopus Q' + o.scopus));
    if (o.type && o.type !== 'journal') t.push(h('span', { className: 'mtag', key: 't' }, o.type === 'conference' ? 'Conference' : (o.type.charAt(0).toUpperCase() + o.type.slice(1))));
    if (o.date || o.year) t.push(h('span', { className: 'mtag', key: 'y' }, o.date || o.year));
    if (o.cites != null) t.push(h('span', { className: 'mtag', key: 'c' }, o.cites + ' cites'));
    if (o.indexed) t.push(h('span', { className: 'mtag ok', key: 'i', title: 'Indexed core source (OpenAlex) — the open proxy for Scopus / Web of Science indexing' }, '✓ Indexed'));
    if (o.fwci != null) t.push(h('span', { className: 'mtag imp', key: 'f', title: 'Field-Weighted Citation Impact — 1.0 = average for the field; >1 is above-average impact' }, 'FWCI ' + Number(o.fwci).toFixed(1)));
    if (o.oa) t.push(h('span', { className: 'mtag oa', key: 'o', title: o.doaj ? 'Open access (DOAJ journal)' : 'Open access' }, 'OA'));
    return t.length ? h('div', { className: 'mtags' }, t) : null;
  }
  function bibKey(s, used) {
    var first = (s.authors && s.authors[0]) ? String(s.authors[0]).split(/\s+/).pop() : 'ref';
    var base = (first + (s.year || '')).replace(/[^A-Za-z0-9]/g, '') || ('ref' + (s.year || ''));
    var k = base, i = 0; while (used[k]) { k = base + String.fromCharCode(97 + i); i++; } used[k] = true; return k;
  }
  function genBibtex(sources) {
    var used = {};
    return sources.map(function (s) {
      var key = bibKey(s, used), f = [];
      f.push('  title = {' + (s.title || '') + '}');
      if (s.authors && s.authors.length) f.push('  author = {' + s.authors.join(' and ') + '}');
      if (s.year) f.push('  year = {' + s.year + '}');
      if (s.venue) f.push('  journal = {' + s.venue + '}');
      if (s.doi) f.push('  doi = {' + String(s.doi).replace(/^https?:\/\/doi\.org\//, '') + '}');
      if (s.url) f.push('  url = {' + s.url + '}');
      return '@article{' + key + ',\n' + f.join(',\n') + '\n}';
    }).join('\n\n');
  }
  function downloadText(name, text) {
    var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  function escapeTex(s) { return String(s == null ? '' : s).replace(/([&%#_$])/g, '\\$1'); }
  function genTexSkeleton(project, idea, sources, doneJobs) {
    var used = {}, keys = (sources || []).map(function (s) { return bibKey(s, used); });
    var cites = keys.length ? '\\cite{' + keys.join(',') + '}' : '';
    var results = (doneJobs || []).map(function (j) { return '\\paragraph{' + escapeTex(j.title || 'Result') + '} ' + (j.result ? escapeTex(JSON.stringify(j.result)) : ''); }).join('\n');
    return [
      '\\documentclass{article}', '\\usepackage{cite}',
      '\\title{' + escapeTex(project.title || '') + '}', '\\begin{document}', '\\maketitle', '',
      '\\begin{abstract}', escapeTex(idea ? (idea.question + (idea.hypothesis ? ' ' + idea.hypothesis : '')) : (project.goal || '')), '\\end{abstract}', '',
      '\\section{Introduction}', escapeTex(project.goal || '% TODO') + ' ' + cites, '',
      '\\section{Related work}', 'We reviewed ' + (sources || []).length + ' relevant works. ' + cites, '',
      '\\section{Method}', idea && idea.hypothesis ? escapeTex(idea.hypothesis) : '% TODO: methodology', '',
      '\\section{Results}', results || '% TODO: results', '',
      '\\bibliographystyle{plain}', '\\bibliography{library}', '\\end{document}'
    ].join('\n');
  }
  // ---------- Add the user's own (MTMT) publications to the library ----------
  function MyPubsModal(props) {
    var pubs = props.pubs || [];
    return h('div', { className: 'scrim', onClick: props.onClose },
      h('div', { className: 'modal', onClick: function (e) { e.stopPropagation(); } },
        h('div', { className: 'modal-h' }, h('b', null, 'Add from my publications'), h('span', { style: { fontSize: 12, color: 'var(--faint)' } }, pubs.length + ' from MTMT'), h('button', { className: 'x', onClick: props.onClose }, '×')),
        h('div', { className: 'modal-b' },
          pubs.length ? pubs.map(function (p) {
            var inLib = props.saved['mtmt:' + p.mtid];
            return h('div', { className: 'src', style: { alignItems: 'flex-start' }, key: p.mtid },
              h('div', { style: { flex: 1, minWidth: 0 } },
                h('b', { style: { fontSize: 13 } }, p.title || 'Untitled'),
                h('div', { style: { fontSize: 11.5, color: 'var(--muted)', marginTop: 1 } }, [p.firstAuthor ? (p.firstAuthor + (p.authorCount > 1 ? ' et al.' : '')) : '', p.year, p.journal].filter(Boolean).join(' · ')),
                metricTags({ journal: p.journal, year: p.year, cites: p.citations })
              ),
              inLib ? h('span', { className: 'chip c-ok' }, 'in library') : h('button', { className: 'btn', style: { padding: '4px 10px', fontSize: 12, flex: 'none' }, onClick: function () { props.onAdd(p); } }, 'Add')
            );
          }) : h('div', { className: 'empty' }, 'No publications are linked to your account (MTMT).')
        ),
        h('div', { className: 'modal-foot' },
          h('button', { className: 'btn', onClick: props.onClose }, 'Close'),
          pubs.length ? h('button', { className: 'btn pri', onClick: function () { pubs.forEach(function (p) { if (!props.saved['mtmt:' + p.mtid]) props.onAdd(p); }); } }, 'Add all') : null
        )
      )
    );
  }

  function LiteraturePanel(props) {
    var q = useState(''), query = q[0], setQuery = q[1];
    var pm = useState(false), pubsOpen = pm[0], setPubsOpen = pm[1];
    var myPubs = (PUBS && props.myEmail) ? ((PUBS.forUser({ email: props.myEmail }) || {}).publications || []) : [];
    function addPub(p) { sb.from('research_sources').insert({ project_id: props.projectId, source_api: 'mtmt', ext_id: 'mtmt:' + p.mtid, doi: p.doi || null, title: p.title || 'Untitled', authors: p.firstAuthor ? [p.firstAuthor + (p.authorCount > 1 ? ' et al.' : '')] : null, year: p.year || null, venue: p.journal || null, cited_by: p.citations, url: p.doi ? 'https://doi.org/' + p.doi : p.mtmtUrl, screening: 'unscreened' }).then(function (res) { if (res && res.error) { if (!/duplicate|unique/i.test(res.error.message)) alert(res.error.message); return; } props.onChanged(); }); }
    var r = useState(null), results = r[0], setResults = r[1];
    var b = useState(false), busy = b[0], setBusy = b[1];
    var fl = useState({ minCites: '', fromYear: '', indexed: false, oa: false, journals: false }), flt = fl[0], setFlt = fl[1];
    var sm = useState(null), scimap = sm[0], setScimap = sm[1];
    var sq = useState(0), scopusMax = sq[0], setScopusMax = sq[1];
    useEffect(function () { loadScimago().then(setScimap); }, []);
    var saved = {}; (props.sources || []).forEach(function (s) { if (s.ext_id) saved[s.ext_id] = true; });
    function setF(k, v) { var o = {}; o[k] = v; setFlt(Object.assign({}, flt, o)); }
    function buildFilter(f) {
      var p = [];
      var mc = parseInt(f.minCites, 10); if (mc > 0) p.push('cited_by_count:>' + (mc - 1));
      var fy = parseInt(f.fromYear, 10); if (fy > 1800) p.push('from_publication_date:' + fy + '-01-01');
      if (f.indexed) p.push('primary_location.source.is_core:true');
      if (f.oa) p.push('open_access.is_oa:true');
      if (f.journals) p.push('primary_location.source.type:journal');
      return p.join(',');
    }
    function runSearch(f) {
      if (!query.trim()) return;
      setBusy(true); setResults(null);
      var email = (BE.user && BE.user.email) || 'research@publify.app';
      var url = 'https://api.openalex.org/works?search=' + encodeURIComponent(query.trim()) + '&per-page=25&mailto=' + encodeURIComponent(email);
      var fs = buildFilter(f || flt); if (fs) url += '&filter=' + fs.replace(/>/g, '%3E');
      fetch(url).then(function (x) { return x.json(); }).then(function (j) { setBusy(false); setResults((j && j.results) || []); }, function () { setBusy(false); setResults([]); });
    }
    // re-run automatically when a filter changes (only after the first search)
    useEffect(function () { if (results !== null) runSearch(flt); }, [flt.minCites, flt.fromYear, flt.indexed, flt.oa, flt.journals]);
    function venueOf(w) { return (w.primary_location && w.primary_location.source && w.primary_location.source.display_name) || ''; }
    function add(w) {
      var authors = (w.authorships || []).slice(0, 8).map(function (a) { return a.author && a.author.display_name; }).filter(Boolean);
      sb.from('research_sources').insert({ project_id: props.projectId, source_api: 'openalex', ext_id: w.id, doi: w.doi || null, title: w.display_name || 'Untitled', authors: authors.length ? authors : null, year: w.publication_year || null, venue: venueOf(w) || null, abstract: abstractFromInverted(w.abstract_inverted_index), cited_by: w.cited_by_count, url: w.doi || w.id, screening: 'unscreened' }).then(function (res) { if (res && res.error) { if (!/duplicate|unique/i.test(res.error.message)) alert(res.error.message); return; } props.onChanged(); });
    }
    function setScreen(s, v) { sb.from('research_sources').update({ screening: v }).eq('id', s.id).then(props.onChanged); }
    function del(s) { sb.from('research_sources').delete().eq('id', s.id).then(props.onChanged); }
    var lib = props.sources || [];
    var hasSci = scimap && Object.keys(scimap).length > 0;
    var shown = results ? (scopusMax ? results.filter(function (w) { var qq = scopusQ(scimap, w); return qq != null && qq <= scopusMax; }) : results) : null;
    return h('div', null,
      h('div', { className: 'panel' },
        h('h3', null, 'Literature search', h('span', { style: { fontWeight: 600, color: 'var(--faint)' } }, 'OpenAlex')),
        props.canEdit ? h('div', { className: 'addrow', style: { marginTop: 0 } },
          h('input', { className: 'grow', value: query, placeholder: 'Search papers (e.g. LiDAR out-of-distribution detection)…', onChange: function (e) { setQuery(e.target.value); }, onKeyDown: function (e) { if (e.key === 'Enter') runSearch(); } }),
          h('button', { className: 'btn pri', disabled: busy, onClick: function () { runSearch(); } }, busy ? 'Searching…' : 'Search')
        ) : null,
        props.canEdit ? h('div', { className: 'lfilters' },
          h('span', { className: 'flab' }, 'Min cites'), h('input', { className: 'num', type: 'number', min: 0, value: flt.minCites, onChange: function (e) { setF('minCites', e.target.value); } }),
          h('span', { className: 'flab' }, 'From year'), h('input', { className: 'num', type: 'number', value: flt.fromYear, placeholder: 'YYYY', onChange: function (e) { setF('fromYear', e.target.value); } }),
          h('button', { className: 'lchip' + (flt.indexed ? ' on' : ''), title: 'Only indexed core sources (Scopus/WoS-level)', onClick: function () { setF('indexed', !flt.indexed); } }, '✓ Indexed'),
          h('button', { className: 'lchip' + (flt.oa ? ' on' : ''), onClick: function () { setF('oa', !flt.oa); } }, 'Open access'),
          h('button', { className: 'lchip' + (flt.journals ? ' on' : ''), onClick: function () { setF('journals', !flt.journals); } }, 'Journals only'),
          hasSci ? h('select', { className: 'num', style: { width: 'auto' }, value: scopusMax, title: 'Scopus quartile (SCImago)', onChange: function (e) { setScopusMax(parseInt(e.target.value, 10)); } }, h('option', { value: 0 }, 'Scopus: any'), h('option', { value: 1 }, 'Scopus Q1'), h('option', { value: 2 }, 'Scopus Q1–Q2'), h('option', { value: 3 }, 'Scopus Q1–Q3')) : null
        ) : null,
        (props.canEdit && myPubs.length) ? h('div', { style: { marginTop: 10, fontSize: 12.5, color: 'var(--muted)' } }, 'Add your own work: ', h('button', { className: 'btn', style: { padding: '4px 10px', fontSize: 12 }, onClick: function () { setPubsOpen(true); } }, '📚 From my publications (' + myPubs.length + ')')) : null,
        results ? (shown.length ? shown.map(function (w) {
          var au = (w.authorships || []).slice(0, 3).map(function (a) { return a.author && a.author.display_name; }).filter(Boolean).join(', ');
          var nw = normWork(w); nw.scopus = scopusQ(scimap, w);
          return h('div', { className: 'src', style: { alignItems: 'flex-start' }, key: w.id },
            h('div', { style: { flex: 1, minWidth: 0 } },
              h('b', { style: { fontSize: 13 } }, w.display_name || 'Untitled'),
              au ? h('div', { style: { fontSize: 11.5, color: 'var(--muted)', marginTop: 1 } }, au) : null,
              metricTags(nw)
            ),
            saved[w.id] ? h('span', { className: 'chip c-ok' }, 'in library') : (props.canEdit ? h('button', { className: 'btn', style: { padding: '4px 10px', fontSize: 12, flex: 'none' }, onClick: function () { add(w); } }, 'Add') : null)
          );
        }) : h('div', { style: { fontSize: 13, color: 'var(--faint)', padding: '8px 0' } }, scopusMax ? 'No results match the Scopus filter.' : 'No results.')) : null
      ),
      h('div', { className: 'panel' },
        h('h3', null, 'Library', h('div', { style: { display: 'flex', gap: 10, alignItems: 'center' } },
          h('span', { style: { fontWeight: 600, color: 'var(--faint)' } }, lib.length + ' source' + (lib.length === 1 ? '' : 's')),
          lib.length ? h('button', { className: 'btn', style: { padding: '4px 10px', fontSize: 12 }, title: 'Export included (or all) as BibTeX', onClick: function () { var inc = lib.filter(function (x) { return x.screening === 'include'; }); downloadText('library.bib', genBibtex(inc.length ? inc : lib)); } }, '⬇ BibTeX') : null
        )),
        lib.length ? lib.map(function (s) {
          return h('div', { className: 'src', style: { alignItems: 'flex-start' }, key: s.id },
            h('div', { style: { flex: 1, minWidth: 0 } },
              h('b', { style: { fontSize: 13 } }, s.url ? h('a', { href: s.url, target: '_blank' }, s.title) : s.title),
              (s.authors && s.authors.length) ? h('div', { style: { fontSize: 11.5, color: 'var(--muted)', marginTop: 1 } }, s.authors.slice(0, 3).join(', ')) : null,
              metricTags({ journal: s.venue, year: s.year, cites: s.cited_by })
            ),
            props.canEdit ? h('div', { className: 'seg', style: { flex: 'none' } }, ['include', 'maybe', 'exclude'].map(function (v) { return h('button', { key: v, className: s.screening === v ? 'on' : '', onClick: function () { setScreen(s, v); } }, v); })) : h('span', { className: 'chip c-grey' }, s.screening),
            props.canEdit ? h('button', { className: 'icon-x', style: { flex: 'none' }, onClick: function () { del(s); } }, '✕') : null
          );
        }) : h('div', { style: { fontSize: 13, color: 'var(--faint)', padding: '8px 0' } }, 'No sources saved yet — search above and Add.')
      ),
      pubsOpen ? h(MyPubsModal, { pubs: myPubs, saved: saved, onAdd: addPub, onClose: function () { setPubsOpen(false); } }) : null
    );
  }

  // ---------- Data (R3) ----------
  var DS_SOURCES = ['url', 'upload', 'huggingface', 'kaggle', 'zenodo', 'openml', 'other'];
  function fmtBytes(n) { if (!n) return ''; var u = ['B', 'KB', 'MB', 'GB', 'TB']; var i = 0; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; } return n.toFixed(n < 10 && i > 0 ? 1 : 0) + ' ' + u[i]; }
  function DataPanel(props) {
    var f = useState({ name: '', source: 'url', uri: '', license: '' }), form = f[0], setForm = f[1];
    var u = useState(''), msg = u[0], setMsg = u[1];
    function up(k, v) { var o = {}; o[k] = v; setForm(Object.assign({}, form, o)); }
    function register() {
      if (!form.name.trim()) return;
      sb.from('research_datasets').insert({ project_id: props.projectId, name: form.name.trim(), source: form.source, uri: form.uri.trim() || null, license: form.license.trim() || null, status: 'registered', created_by: props.authorId }).then(function (r) { if (r && r.error) { alert(r.error.message); return; } setForm({ name: '', source: 'url', uri: '', license: '' }); props.onChanged(); });
    }
    function onFile(e) {
      var file = e.target.files && e.target.files[0]; if (!file) return;
      setMsg('Uploading ' + file.name + '…');
      var path = props.projectId + '/' + Date.now() + '_' + file.name.replace(/[^A-Za-z0-9._-]/g, '_');
      sb.storage.from('research-data').upload(path, file).then(function (res) {
        if (res.error) { setMsg('Upload failed: ' + res.error.message); return; }
        sb.from('research_datasets').insert({ project_id: props.projectId, name: file.name, source: 'upload', uri: path, size_bytes: file.size, status: 'ready', created_by: props.authorId }).then(function (r) { setMsg(''); if (r && r.error) { alert(r.error.message); return; } props.onChanged(); });
      });
    }
    function del(d) { if (d.source === 'upload' && d.uri) sb.storage.from('research-data').remove([d.uri]); sb.from('research_datasets').delete().eq('id', d.id).then(props.onChanged); }
    var ds = props.datasets || [];
    var stCls = { ready: 'c-ok', downloading: 'c-warn', error: 'c-danger', registered: 'c-grey' };
    return h('div', null,
      props.canEdit ? h('div', { className: 'panel' }, h('h3', null, 'Add data'),
        h('div', { className: 'addrow', style: { marginTop: 0 } },
          h('input', { className: 'grow', value: form.name, placeholder: 'Dataset name', onChange: function (e) { up('name', e.target.value); } }),
          h('select', { value: form.source, onChange: function (e) { up('source', e.target.value); } }, DS_SOURCES.map(function (s) { return h('option', { key: s, value: s }, s); })),
          h('input', { className: 'grow', value: form.uri, placeholder: 'URL / identifier (e.g. hf: user/dataset)', onChange: function (e) { up('uri', e.target.value); } }),
          h('input', { value: form.license, placeholder: 'License', style: { width: 110 }, onChange: function (e) { up('license', e.target.value); } }),
          h('button', { className: 'btn pri', onClick: register }, 'Register')
        ),
        h('div', { style: { marginTop: 10, fontSize: 12.5, color: 'var(--muted)' } }, 'Or upload a file: ', h('input', { type: 'file', onChange: onFile }), msg ? h('span', { style: { marginLeft: 8 } }, msg) : null),
        h('div', { style: { marginTop: 6, fontSize: 11.5, color: 'var(--faint)' } }, 'Registered external datasets are fetched by the self-hosted worker (a download job).')
      ) : null,
      h('div', { className: 'panel' }, h('h3', null, 'Datasets', h('span', { style: { fontWeight: 600, color: 'var(--faint)' } }, ds.length + '')),
        ds.length ? ds.map(function (d) {
          return h('div', { className: 'src', key: d.id },
            h('div', { style: { flex: 1, minWidth: 0 } }, h('b', { style: { fontSize: 13 } }, d.name), h('div', { style: { fontSize: 11.5, color: 'var(--muted)' } }, [d.source, d.uri, fmtBytes(d.size_bytes), d.license].filter(Boolean).join(' · '))),
            h('span', { className: 'chip ' + (stCls[d.status] || 'c-grey') }, d.status),
            props.canEdit ? h('button', { className: 'icon-x', onClick: function () { del(d); } }, '✕') : null
          );
        }) : h('div', { style: { fontSize: 13, color: 'var(--faint)', padding: '8px 0' } }, 'No datasets yet — register a source or upload a file.')
      )
    );
  }

  // ---------- Compute (R4) ----------
  var JOB_TYPES = ['python', 'stats', 'download'];
  function ComputePanel(props) {
    var t = useState('python'), type = t[0], setType = t[1];
    var ti = useState(''), title = ti[0], setTitle = ti[1];
    var c = useState('print(2 + 2)'), code = c[0], setCode = c[1];
    var d = useState(''), datasetId = d[0], setDatasetId = d[1];
    var ex = useState(null), exp = ex[0], setExp = ex[1];
    function submit() {
      var spec = type === 'python' ? { code: code } : { dataset_id: datasetId };
      if (type !== 'python' && !datasetId) { alert('Pick a dataset.'); return; }
      sb.from('research_jobs').insert({ project_id: props.projectId, type: type, title: title.trim() || (type + ' job'), spec: spec, status: 'queued', created_by: props.authorId }).then(function (r) { if (r && r.error) { alert(r.error.message); return; } setTitle(''); props.onChanged(); });
    }
    function cancel(j) { sb.from('research_jobs').update({ status: 'canceled' }).eq('id', j.id).then(props.onChanged); }
    function del(j) { sb.from('research_jobs').delete().eq('id', j.id).then(props.onChanged); }
    var jobs = props.jobs || [], datasets = props.datasets || [];
    var stCls = { done: 'c-ok', running: 'c-warn', queued: 'c-grey', error: 'c-danger', canceled: 'c-grey' };
    return h('div', null,
      props.canEdit ? h('div', { className: 'panel' }, h('h3', null, 'Submit a compute job', h('span', { style: { fontWeight: 600, color: 'var(--faint)' } }, 'self-hosted worker')),
        h('div', { className: 'addrow', style: { marginTop: 0 } },
          h('input', { className: 'grow', value: title, placeholder: 'Job title', onChange: function (e) { setTitle(e.target.value); } }),
          h('select', { value: type, onChange: function (e) { setType(e.target.value); } }, JOB_TYPES.map(function (x) { return h('option', { key: x, value: x }, x); }))
        ),
        type === 'python'
          ? h('textarea', { value: code, onChange: function (e) { setCode(e.target.value); }, rows: 5, style: { width: '100%', marginTop: 8, border: '1px solid var(--line)', borderRadius: 9, padding: '9px 11px', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12.5 } })
          : h('select', { value: datasetId, style: { marginTop: 8, width: '100%', height: 36, border: '1px solid var(--line)', borderRadius: 9, padding: '0 10px', fontFamily: 'inherit' }, onChange: function (e) { setDatasetId(e.target.value); } }, [h('option', { key: '', value: '' }, 'Choose a dataset…')].concat(datasets.map(function (ds) { return h('option', { key: ds.id, value: ds.id }, ds.name); }))),
        h('div', { style: { marginTop: 8 } }, h('button', { className: 'btn pri', onClick: submit }, 'Queue job')),
        h('div', { style: { marginTop: 6, fontSize: 11.5, color: 'var(--faint)' } }, 'Jobs run on your self-hosted worker (worker/README.md). Results return here when done.')
      ) : null,
      h('div', { className: 'panel' }, h('h3', null, 'Jobs', h('span', { style: { fontWeight: 600, color: 'var(--faint)' } }, jobs.length + '')),
        jobs.length ? jobs.map(function (j) {
          return h('div', { key: j.id, style: { padding: '10px 0', borderBottom: '1px solid var(--soft)' } },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
              h('div', { style: { flex: 1, minWidth: 0 } }, h('b', { style: { fontSize: 13 } }, j.title), h('span', { style: { fontSize: 11.5, color: 'var(--muted)', marginLeft: 6 } }, j.type)),
              j.status === 'running' && j.progress ? h('span', { style: { fontSize: 11, color: 'var(--muted)' } }, j.progress + '%') : null,
              h('span', { className: 'chip ' + (stCls[j.status] || 'c-grey') }, j.status),
              (j.result || j.logs) ? h('button', { className: 'icon-x', style: { color: 'var(--muted)' }, title: 'Details', onClick: function () { setExp(exp === j.id ? null : j.id); } }, exp === j.id ? '▾' : '▸') : null,
              props.canEdit && j.status === 'queued' ? h('button', { className: 'chip c-grey', onClick: function () { cancel(j); } }, 'Cancel') : null,
              props.canEdit ? h('button', { className: 'icon-x', onClick: function () { del(j); } }, '✕') : null
            ),
            exp === j.id ? h('pre', { style: { marginTop: 8, background: 'var(--softer)', border: '1px solid var(--line)', borderRadius: 8, padding: 10, fontSize: 11.5, overflow: 'auto', maxHeight: 220, whiteSpace: 'pre-wrap' } }, (j.result ? JSON.stringify(j.result, null, 2) + '\n\n' : '') + (j.logs || '')) : null
          );
        }) : h('div', { style: { fontSize: 13, color: 'var(--faint)', padding: '8px 0' } }, 'No jobs yet — queue one above.')
      )
    );
  }

  // ---------- Writing (R6 bridge) ----------
  function WritingPanel(props) {
    var p = props.project;
    var inc = (props.sources || []).filter(function (s) { return s.screening === 'include'; });
    var lib = inc.length ? inc : (props.sources || []);
    var idea = (props.ideas || []).filter(function (i) { return i.status === 'selected'; })[0] || (props.ideas || [])[0];
    var doneJobs = (props.jobs || []).filter(function (j) { return j.status === 'done'; });
    return h('div', { className: 'panel' },
      h('h3', null, 'Writing'),
      h('div', { style: { fontSize: 13, color: 'var(--muted)', marginBottom: 12 } },
        'Assemble a manuscript starter from this project — the selected idea as the abstract, the ',
        h('b', null, lib.length), ' library source' + (lib.length === 1 ? '' : 's') + ' as \\cite references' + (inc.length ? ' (included)' : '') + ', and ',
        h('b', null, doneJobs.length), ' finished result' + (doneJobs.length === 1 ? '' : 's') + '.'),
      h('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap' } },
        h('button', { className: 'btn pri', onClick: function () { downloadText((p.title || 'manuscript').replace(/[^A-Za-z0-9]+/g, '_') + '.tex', genTexSkeleton(p, idea, lib, doneJobs)); } }, '⬇ .tex skeleton'),
        h('button', { className: 'btn', onClick: function () { downloadText('library.bib', genBibtex(lib)); } }, '⬇ library.bib'),
        h('a', { className: 'btn', href: 'ProofReader.html', style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center' } }, 'Open LaTeX editor →')
      ),
      idea ? h('div', { style: { marginTop: 14, fontSize: 12.5, color: 'var(--faint)' } }, 'Abstract seed: ' + idea.question) : h('div', { style: { marginTop: 14, fontSize: 12.5, color: 'var(--faint)' } }, 'Tip: select an idea on the Ideas tab to seed the abstract.')
    );
  }

  // ---------- Literature Study (Elicit-style 4-step funnel) ----------
  var LS_STEPS = [{ step: 1, kind: 'quick', label: '1. Gyors' }, { step: 2, kind: 'abstract', label: '2. Absztrakt' }, { step: 3, kind: 'fulltext', label: '3. Teljes szöveg' }, { step: 4, kind: 'review', label: '4. Review' }];
  // Mirror of the server's screenSystem() — the exact screening prompt Claude gets for steps 1–3, built from
  // the question + the current keywords/criteria. Lets the user preview (and re-generate after editing) it.
  function buildScreenPrompt(question, cfg) {
    cfg = cfg || {};
    var kws = (cfg.keywords || []).filter(Boolean);
    var inc = (cfg.include || []).filter(Boolean);
    var exc = (cfg.exclude || []).filter(Boolean);
    return 'You are screening papers for a systematic literature review.\n'
      + 'Research question: ' + (question || '(none given)') + '\n'
      + (kws.length ? 'Keywords: ' + kws.join(', ') + '\n' : '')
      + (inc.length ? 'Inclusion criteria (the paper should plausibly satisfy ALL): ' + inc.join('; ') + '\n' : '')
      + (exc.length ? 'Exclusion criteria (exclude if ANY clearly holds): ' + exc.join('; ') + '\n' : '')
      + 'For each paper decide: "include" (relevant to the question and plausibly meets the inclusion criteria), '
      + '"maybe" (relevant but you are genuinely unsure it meets a criterion), or "exclude" (off-topic, or clearly '
      + 'violates an exclusion criterion). This is a screening FUNNEL — be inclusive here; later steps narrow '
      + 'further. Prefer "maybe" over "exclude" when uncertain. Give a one-line reason, a 0..100 relevance score, '
      + 'and detect signals has_github (a public code repo) and has_dataset (a public dataset).\n'
      + 'Return ONLY a JSON array, one object per paper.';
  }
  // criteria editor — each include/exclude criterion is its own small card (add / remove) instead of a lumped
  // textarea. accent = green for inclusion, red for exclusion. To edit a criterion, remove it and add a new one.
  function CritEditor(props) {
    var nS = useState(''), nv = nS[0], setNv = nS[1];
    var items = props.items || [];
    function add() { var v = nv.trim(); if (!v) return; props.onChange(items.concat([v])); setNv(''); }
    function rm(i) { props.onChange(items.filter(function (_, j) { return j !== i; })); }
    return h('div', null,
      items.length ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 6 } },
        items.map(function (it, i) {
          return h('div', { key: i, style: { display: 'flex', gap: 6, alignItems: 'flex-start', background: 'var(--surface-2)', border: '1px solid var(--line)', borderLeft: '3px solid ' + (props.accent || 'var(--accent)'), borderRadius: 7, padding: '5px 9px' } },
            h('span', { style: { flex: 1, minWidth: 0, fontSize: 12.5, lineHeight: 1.35, whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, it),
            props.disabled ? null : h('button', { className: 'icon-x', style: { flex: 'none' }, title: 'Törlés', onClick: function () { rm(i); } }, '✕')
          );
        })
      ) : h('div', { style: { fontSize: 11.5, color: 'var(--faint)', marginBottom: 6 } }, props.empty || 'Nincs kritérium.'),
      props.disabled ? null : h('div', { style: { display: 'flex', gap: 6 } },
        h('input', { className: 'field', style: { flex: 1, minWidth: 0, fontSize: 12.5 }, value: nv, placeholder: props.placeholder, onChange: function (e) { setNv(e.target.value); }, onKeyDown: function (e) { if (e.key === 'Enter') { e.preventDefault(); add(); } } }),
        h('button', { className: 'btn', style: { flex: 'none', padding: '4px 10px', fontSize: 12 }, onClick: add }, '+ Hozzáad')
      )
    );
  }
  function lsDefaultConfig(step, project, idea) {
    if (step === 1) return { keywords: (project && project.keywords) || [], include: [], exclude: [], filters: { fromYear: '', minCites: '', oa: false, journals: true }, signals: ['has_github', 'has_dataset'], source_adapter: 'openalex', max_results: 150 };
    return { keywords: [], include: [], exclude: [], filters: {}, signals: ['has_github', 'has_dataset'] };
  }
  function callStudy(body) {
    var CFG = window.PR_CONFIG || {};
    return sb.auth.getSession().then(function (s) {
      var token = (s && s.data && s.data.session && s.data.session.access_token) || CFG.supabaseAnonKey;
      return fetch(CFG.supabaseUrl + '/functions/v1/research-study', { method: 'POST', headers: { 'Content-Type': 'application/json', 'apikey': CFG.supabaseAnonKey, 'Authorization': 'Bearer ' + token }, body: JSON.stringify(body) }).then(function (r) { return r.json().catch(function () { return { error: 'A szerver válasza nem értelmezhető (lehet időtúllépés) — próbáld újra.' }; }); }, function () { return { error: 'network' }; });
    });
  }
  function LiteratureStudy(props) {
    var studies = props.studies || [];
    var seS = useState((studies[0] && studies[0].id) || null), selId = seS[0], setSelId = seS[1];
    var stS = useState([]), steps = stS[0], setSteps = stS[1];
    var paS = useState([]), papers = paS[0], setPapers = paS[1];
    var cuS = useState(1), curStep = cuS[0], setCurStep = cuS[1];
    var cfS = useState(lsDefaultConfig(1, props.project)), cfg = cfS[0], setCfg = cfS[1];
    var rnS = useState(false), running = rnS[0], setRunning = rnS[1];
    var pgS = useState(null), prog = pgS[0], setProg = pgS[1];
    var ttS = useState({}), titles = ttS[0], setTitles = ttS[1];
    var erS = useState(''), err = erS[0], setErr = erS[1];
    var plS = useState(false), planning = plS[0], setPlanning = plS[1];   // Claude pre-filling the funnel config
    var ppS = useState(''), promptText = ppS[0], setPromptText = ppS[1];   // previewed screening prompt
    var smS = useState(false), studiesOpen = smS[0], setStudiesOpen = smS[1];   // "Tanulmányok" manage modal
    var alive = useRef(true), stop = useRef(false);
    useEffect(function () { return function () { alive.current = false; }; }, []);
    // #12 — selId is seeded from studies[0] at mount; if the studies list loads AFTER mount it stays null
    // and a step run would POST an empty study_id ("study_id required"). Sync selId once studies arrive.
    useEffect(function () { if (!selId && studies.length) setSelId(studies[0].id); }, [studies.length]);
    var sel = studies.filter(function (x) { return x.id === selId; })[0];
    var srcMap = {}; (props.sources || []).forEach(function (s) { srcMap[s.id] = s; });

    function loadStudy(id) {
      if (!id) { setSteps([]); setPapers([]); return; }
      Promise.all([
        sb.from('research_study_steps').select('step,kind,config,status,cursor,total,counts').eq('study_id', id).order('step'),
        sb.from('research_study_papers').select('source_id,step,decision,reason,score,signals,overridden').eq('study_id', id)
      ]).then(function (r) {
        var st = (r[0] && r[0].data) || []; setSteps(st); setPapers((r[1] && r[1].data) || []);
        var cs = st.filter(function (x) { return x.step === curStep; })[0]; if (cs && cs.config) setCfg(cs.config);
      });
    }
    useEffect(function () { loadStudy(selId); }, [selId]);
    function stepRow(n) { return steps.filter(function (x) { return x.step === n; })[0]; }
    function viewStep(n) { setCurStep(n); var cs = stepRow(n); setCfg((cs && cs.config) || lsDefaultConfig(n, props.project)); }
    function incCount(n) { return papers.filter(function (p) { return p.step === n && p.decision === 'include'; }).length; }

    // create a study from one OR MORE selected ideas (or empty), then let Claude pre-fill the funnel config
    // one-click from the Ideas "study basis" window: auto-create the study from the selected ideas and let
    // Claude pre-fill step 1 (newStudy = create → plan → load). Consume the signal first so it can't re-fire.
    useEffect(function () {
      if (props.autoCreateFrom && props.autoCreateFrom.length) { var ids = props.autoCreateFrom; if (props.onAutoConsumed) props.onAutoConsumed(); newStudy(ids); }
    }, [props.autoCreateFrom]);
    function newStudy(ideas) {
      var arr = Array.isArray(ideas) ? ideas : (ideas ? [ideas] : []);
      var q = arr.length ? arr.map(function (i) { return i.question + (i.hypothesis ? ' — hipotézis: ' + i.hypothesis : ''); }).join('\n\n') : props.project.title;
      var title = String(arr.length ? (arr.length > 1 ? (props.project.title + ' — ' + arr.length + ' ötlet') : arr[0].question) : (props.project.title + ' — irodalom')).slice(0, 80);
      setErr(''); setPlanning(true);
      sb.from('research_studies').insert({ project_id: props.projectId, idea_id: arr[0] ? arr[0].id : null, title: title, question: String(q).slice(0, 4000), created_by: props.authorId }).select('id').maybeSingle().then(function (r) {
        var id = r && r.data && r.data.id; if (!id) { setPlanning(false); setErr('Nem sikerült létrehozni a tanulmányt.'); return; }
        var rows = LS_STEPS.map(function (s) { return { study_id: id, step: s.step, kind: s.kind, config: lsDefaultConfig(s.step, props.project, arr[0]) }; });
        sb.from('research_study_steps').insert(rows).then(function () {
          setSelId(id); setCurStep(1); props.onChanged();
          // dynamically pre-fill keywords + criteria + filters with Claude; the user only fine-tunes
          callStudy({ action: 'plan', study_id: id }).then(function (d) { setPlanning(false); loadStudy(id); if (d && d.error) setErr('AI-kitöltés: ' + d.error); }, function () { setPlanning(false); });
        });
      });
    }
    // re-run the AI pre-fill for the current study (Claude regenerates keywords/criteria/filters)
    function runPlan() {
      if (!selId || planning) return;
      setErr(''); setPlanning(true);
      callStudy({ action: 'plan', study_id: selId }).then(function (d) { setPlanning(false); if (d && d.error) { setErr('AI-kitöltés: ' + d.error); return; } loadStudy(selId); }, function () { setPlanning(false); setErr('AI-kitöltés nem sikerült.'); });
    }
    // (re)generate the prompt preview from the CURRENT question + criteria (reflects manual edits)
    function genPrompt() { setPromptText(buildScreenPrompt((sel && (sel.question || sel.title)) || '', cfg)); }
    // delete a whole study (cascades to its steps + papers)
    function delStudy(s) {
      if (!window.confirm('Biztosan törlöd ezt a tanulmányt és minden lépését/eredményét?\n\n„' + (s.title || '') + '"')) return;
      sb.from('research_studies').delete().eq('id', s.id).then(function (r) {
        if (r && r.error) { setErr('Törlés sikertelen: ' + r.error.message); return; }
        if (selId === s.id) { setSelId(null); setSteps([]); setPapers([]); setCurStep(1); }
        props.onChanged();
      });
    }
    function up(k, v) { setCfg(Object.assign({}, cfg, (function () { var o = {}; o[k] = v; return o; })())); }
    function upFilter(k, v) { setCfg(Object.assign({}, cfg, { filters: Object.assign({}, cfg.filters || {}, (function () { var o = {}; o[k] = v; return o; })()) })); }
    var linesToArr = function (s) { return String(s || '').split('\n').map(function (x) { return x.trim(); }).filter(Boolean); };

    function runStep(n) {
      if (running) return;
      if (!selId) { setErr('Nincs kiválasztott tanulmány — válassz egyet a listából.'); return; }   // #12 guard
      setErr(''); stop.current = false; setRunning(true); setProg({ done: 0, total: 0, counts: {} }); setTitles({});
      sb.from('research_study_steps').update({ config: cfg, status: 'running' }).eq('study_id', selId).eq('step', n).then(function () {
        if (n === 4) {
          callStudy({ action: 'generate_review', study_id: selId }).then(function (d) {
            setRunning(false); setProg(null);
            if (!d || d.error) { setErr((d && d.error) || 'Hiba a review generálásnál.'); return; }
            loadStudy(selId); props.onChanged(); window.alert('Review elkészült: ' + d.file_path + ' (a Fájlok közt).');
          });
          return;
        }
        sb.from('research_study_papers').delete().eq('study_id', selId).gte('step', n).eq('overridden', false).then(function () {
          var action = n === 1 ? 'search_step1' : 'screen_batch';
          (function loop(offset) {
            if (!alive.current || stop.current) { setRunning(false); setProg(null); loadStudy(selId); return; }
            callStudy({ action: action, study_id: selId, step: n, offset: offset }).then(function (d) {
              if (!d || d.error) { setRunning(false); setProg(null); setErr((d && d.error) || 'A lépés hibázott.'); loadStudy(selId); return; }
              setProg({ done: d.next_offset, total: d.total_estimate || d.next_offset, counts: d.counts });
              setTitles(function (t) { var n2 = Object.assign({}, t); (d.results || []).forEach(function (x) { if (x.title) n2[x.source_id] = x.title; }); return n2; });
              loadStudy(selId);
              if (!d.done && alive.current && !stop.current) loop(d.next_offset);
              else { setRunning(false); setProg(null); loadStudy(selId); props.onChanged();
                if (n === 1 && !(d.total_estimate || d.new_sources || d.fetched)) setErr('0 találat az OpenAlex-en — próbálj tágabb/más kulcsszavakat, vagy lazább szűrőket (pl. töröld az „Évtől"-t vagy a „csak cikkek"-et), majd futtasd újra.');
                else if (n === 1 && d.relaxed) setErr('ℹ️ A megadott kulcsszavak/szűrők túl szűkek voltak — automatikusan lazítottam rajtuk (pl. szűrők nélkül kerestem), hogy találjak cikkeket. Finomíthatod a kulcsszavakat/szűrőket és újrafuttathatod.'); }
            });
          })(0);
        });
      });
    }
    function override(p, dec) { sb.from('research_study_papers').update({ decision: dec, overridden: true }).eq('study_id', selId).eq('source_id', p.source_id).eq('step', curStep).then(function () { loadStudy(selId); }); }

    if (!studies.length) {
      if (planning) return h('div', { className: 'panel' }, h('h3', null, '🔬 Irodalmi tanulmány'), h('div', { style: { fontSize: 13, color: 'var(--muted)', padding: '12px 0' } }, '✨ Claude előkészíti a tanulmányt a kijelölt ötletek alapján — egy pillanat, töltöm a Step-1 adatait (kulcsszavak, kritériumok, szűrők)…'));
      var selIdeas = (props.ideas || []).filter(function (i) { return i.status === 'selected'; });
      return h('div', { className: 'panel' }, h('h3', null, '🔬 Irodalmi tanulmány'),
        h('p', { style: { fontSize: 13, color: 'var(--muted)' } }, 'Jelöld ki (Select) az Ötletek közül azokat, amik alapján a tanulmány menjen, majd indíts egy 4-lépéses szűrést: gyors screening → absztrakt → teljes szöveg → review. A lépéseket Claude előre kitölti (kulcsszavak, kritériumok, szűrők) az ötletek alapján — Te csak finomhangolsz.'),
        props.canEdit ? h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 } },
          selIdeas.length
            ? h('button', { className: 'btn pri', disabled: planning, onClick: function () { newStudy(selIdeas); } }, planning ? '✨ Claude tervez…' : ('🔬 Tanulmány a kijelölt ' + selIdeas.length + ' ötletből'))
            : h('span', { style: { fontSize: 12.5, color: 'var(--warn)' } }, 'Jelölj ki legalább egy ötletet (Select) az Ötletek fülön.'),
          h('button', { className: 'btn', disabled: planning, onClick: function () { newStudy(null); } }, '+ Üres tanulmány')
        ) : h('div', { style: { fontSize: 13, color: 'var(--faint)' } }, 'Csak olvasható nézet.'),
        err ? h('div', { style: { color: 'var(--danger)', fontSize: 12.5, marginTop: 8 } }, err) : null);
    }

    var stepPapers = papers.filter(function (p) { return p.step === curStep; });
    var grp = { include: [], maybe: [], exclude: [] }; stepPapers.forEach(function (p) { (grp[p.decision] || (grp[p.decision] = [])).push(p); });
    var cur = stepRow(curStep) || {};
    return h('div', null,
      // studies overview — every study with its progress + status; click to open one. Lets you follow several.
      h('div', { style: { marginBottom: 12 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 } },
          h('div', { style: { fontSize: 11.5, color: 'var(--faint)', textTransform: 'uppercase', letterSpacing: '.04em' } }, 'Tanulmányok (' + studies.length + ')'),
          h('button', { className: 'btn', style: { marginLeft: 'auto', padding: '3px 9px', fontSize: 11.5, flex: 'none' }, onClick: function () { setStudiesOpen(true); } }, '📚 Tanulmányok megtekintése')),
        h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
          studies.map(function (s) {
            var on = s.id === selId;
            var st = s.status === 'done' ? '✓ kész' : ('lépés ' + (s.cur_step || 1) + '/4');
            return h('button', { key: s.id, onClick: function () { setSelId(s.id); setCurStep(s.cur_step || 1); }, style: { textAlign: 'left', maxWidth: 260, border: '1.5px solid ' + (on ? 'var(--accent)' : 'var(--line)'), background: on ? 'var(--surface-2)' : 'var(--surface)', borderRadius: 8, padding: '6px 10px', cursor: 'pointer' } },
              h('div', { style: { fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, s.title),
              h('div', { style: { fontSize: 11, color: (running && on) ? 'var(--accent)' : 'var(--muted)', marginTop: 2 } }, (running && on ? '⏳ fut… ' : '') + st)
            );
          }),
          props.canEdit ? h('button', { onClick: function () { newStudy(null); }, style: { border: '1px dashed var(--line)', background: 'transparent', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 12.5, color: 'var(--muted)' } }, '+ Új tanulmány') : null
        )),
      // funnel stepper
      h('div', { className: 'funnel' }, LS_STEPS.map(function (s) {
        return h('button', { key: s.step, className: 'funnel-step' + (curStep === s.step ? ' on' : '') + (((stepRow(s.step) || {}).status === 'done') ? ' done' : ''), onClick: function () { viewStep(s.step); } },
          h('b', null, s.label), s.step < 4 ? h('span', { className: 'funnel-count' }, incCount(s.step) + ' include') : h('span', { className: 'funnel-count' }, (stepRow(4) || {}).status === 'done' ? 'kész' : 'review'));
      })),
      // config panel (steps 1-3) or review panel (step 4)
      curStep < 4 ? h('div', { className: 'panel', style: { marginTop: 10 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('h3', { style: { margin: 0 } }, LS_STEPS[curStep - 1].label + ' — beállítások'),
          props.canEdit ? h('button', { className: 'btn', style: { padding: '3px 9px', fontSize: 11.5, marginLeft: 'auto', flex: 'none' }, disabled: planning, title: 'Claude (újra)tölti a kulcsszavakat, kritériumokat és szűrőket az ötletek alapján', onClick: runPlan }, planning ? '✨ Claude tölti…' : '✨ AI-kitöltés') : null),
        props.canEdit ? h('div', { style: { fontSize: 11.5, color: 'var(--muted)', margin: '4px 0 8px', lineHeight: 1.4 } }, planning ? '✨ Claude éppen tölti a mezőket az ötleteid alapján…' : '✨ A mezőket Claude töltötte ki az ötleteid alapján — szabadon átírhatod, majd futtasd a lépést.') : null,
        h('div', { className: 'field-label' }, 'Kulcsszavak (vesszővel)'),
        h('input', { className: 'field', style: { width: '100%' }, disabled: !props.canEdit, value: (cfg.keywords || []).join(', '), placeholder: 'pl. out-of-distribution, LiDAR', onChange: function (e) { up('keywords', e.target.value.split(',').map(function (x) { return x.trim(); }).filter(Boolean)); } }),
        h('div', { style: { display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap' } },
          h('div', { style: { flex: 1, minWidth: 220 } }, h('div', { className: 'field-label' }, '✓ Beválogatási kritériumok'), h(CritEditor, { items: cfg.include || [], onChange: function (a) { up('include', a); }, disabled: !props.canEdit, accent: '#16a34a', placeholder: 'pl. van publikus github repo vagy dataset', empty: 'Még nincs beválogatási kritérium.' })),
          h('div', { style: { flex: 1, minWidth: 220 } }, h('div', { className: 'field-label' }, '✕ Kizárási kritériumok'), h(CritEditor, { items: cfg.exclude || [], onChange: function (a) { up('exclude', a); }, disabled: !props.canEdit, accent: '#dc2626', placeholder: 'pl. nincs kvantitatív kiértékelés', empty: 'Még nincs kizárási kritérium.' }))),
        curStep === 1 ? h('div', { className: 'lfilters', style: { marginTop: 8 } },
          h('input', { className: 'num', type: 'number', disabled: !props.canEdit, placeholder: 'Évtől', value: (cfg.filters || {}).fromYear || '', onChange: function (e) { upFilter('fromYear', e.target.value); } }),
          h('input', { className: 'num', type: 'number', disabled: !props.canEdit, placeholder: 'Min. idézet', value: (cfg.filters || {}).minCites || '', onChange: function (e) { upFilter('minCites', e.target.value); } }),
          h('button', { className: 'lchip' + ((cfg.filters || {}).oa ? ' on' : ''), disabled: !props.canEdit, onClick: function () { upFilter('oa', !(cfg.filters || {}).oa); } }, 'Csak open access'),
          h('button', { className: 'lchip' + ((cfg.filters || {}).journals ? ' on' : ''), disabled: !props.canEdit, onClick: function () { upFilter('journals', !(cfg.filters || {}).journals); } }, 'Csak cikkek')
        ) : null,
        curStep > 1 && incCount(curStep - 1) === 0 ? h('div', { style: { fontSize: 12.5, color: 'var(--warn)', marginTop: 8 } }, 'Az előző lépésben még nincs „include" cikk — futtasd előbb azt.') : null,
        props.canEdit ? h('div', { className: 'runbar' },
          h('button', { className: 'btn pri', disabled: running || (curStep > 1 && incCount(curStep - 1) === 0), onClick: function () { runStep(curStep); } }, running ? 'Fut…' : ((cur.status === 'done' ? 'Újra: ' : 'Futtatás: ') + LS_STEPS[curStep - 1].label)),
          running ? h('button', { className: 'btn', onClick: function () { stop.current = true; } }, 'Mégse') : null,
          (cur.status === 'done' && curStep < 4) ? h('span', { style: { fontSize: 11.5, color: 'var(--warn)' } }, 'Az újrafuttatás törli a későbbi lépéseket.') : null,
          prog ? h('span', { className: 'progress' }, h('i', { style: { width: (prog.total ? Math.round(prog.done / prog.total * 100) : 0) + '%' } }), h('span', { className: 'progress-t' }, prog.done + (prog.total ? '/' + prog.total : '') + ' · ✓' + ((prog.counts || {}).include || 0) + ' ✗' + ((prog.counts || {}).exclude || 0))) : null
        ) : null,
        err ? h('div', { style: { color: 'var(--danger)', fontSize: 12.5, marginTop: 6 } }, err) : null,
        // 📝 prompt preview — the exact screening prompt Claude gets, built from the current question + criteria
        props.canEdit ? h('div', { style: { marginTop: 12, borderTop: '1px solid var(--line)', paddingTop: 8 } },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
            h('div', { style: { fontSize: 12, fontWeight: 600 } }, '📝 Claude screening-prompt'),
            h('button', { className: 'btn', style: { padding: '3px 9px', fontSize: 11.5, flex: 'none' }, onClick: genPrompt }, promptText ? '🔄 Prompt újragenerálása' : '📝 Prompt megtekintése'),
            promptText ? h('button', { className: 'btn', style: { padding: '3px 9px', fontSize: 11.5, flex: 'none' }, onClick: function () { try { navigator.clipboard.writeText(promptText); } catch (e) { } } }, 'Másolás') : null,
            promptText ? h('button', { className: 'btn', style: { padding: '3px 9px', fontSize: 11.5, flex: 'none' }, onClick: function () { setPromptText(''); } }, 'Elrejtés') : null),
          promptText ? h('div', { style: { fontSize: 11, color: 'var(--muted)', marginTop: 4 } }, 'Ez a rendszer-prompt megy a Claude-nak minden cikk megítélésekor (a kérdés + kulcsszavak + kritériumok alapján). Kulcsszó/kritérium módosítása után nyomd az „újragenerálás"-t.') : null,
          promptText ? h('pre', { style: { marginTop: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 11.5, lineHeight: 1.45, background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px', maxHeight: 280, overflow: 'auto', fontFamily: 'ui-monospace, monospace' } }, promptText) : null
        ) : null
      ) : h('div', { className: 'panel', style: { marginTop: 10 } },
        h('h3', null, '4. Review cikk'),
        h('p', { style: { fontSize: 13, color: 'var(--muted)' } }, 'A 3. lépésben „include"-olt ' + incCount(3) + ' cikkből egy strukturált review-t generálunk (a Fájlok közé mentve). Consensus-grounding, ha be van kötve a token.'),
        props.canEdit ? h('div', { className: 'runbar' }, h('button', { className: 'btn pri', disabled: running || incCount(3) === 0, onClick: function () { runStep(4); } }, running ? 'Generálás…' : 'Review generálása'), (stepRow(4) || {}).status === 'done' ? h('span', { className: 'chip c-ok' }, 'Kész — lásd a Fájlokat') : null) : null,
        err ? h('div', { style: { color: 'var(--danger)', fontSize: 12.5, marginTop: 6 } }, err) : null
      ),
      // results list (steps 1-3)
      curStep < 4 ? h('div', { className: 'panel', style: { marginTop: 10 } },
        h('h3', null, 'Eredmények — ' + LS_STEPS[curStep - 1].label + ' (' + stepPapers.length + ' cikk)'),
        stepPapers.length === 0 ? h('div', { style: { fontSize: 13, color: 'var(--faint)' } }, 'Még nincs eredmény — futtasd a lépést.') :
          ['include', 'maybe', 'exclude'].map(function (dec) {
            var arr = grp[dec] || []; if (!arr.length) return null;
            return h('div', { key: dec, style: { marginTop: 6 } },
              h('div', { className: 'field-label' }, (dec === 'include' ? '✅ Beválogatva' : dec === 'maybe' ? '🟡 Talán' : '❌ Kizárva') + ' (' + arr.length + ')'),
              arr.map(function (p) {
                var s = srcMap[p.source_id]; var title = titles[p.source_id] || (s && s.title) || '(cikk)';
                return h('div', { className: 'src', key: p.source_id },
                  h('div', { style: { flex: 1, minWidth: 0 } },
                    h('div', { style: { fontSize: 12.5, fontWeight: 600 } }, s && s.url ? h('a', { href: s.url, target: '_blank', rel: 'noreferrer', style: { color: 'var(--ink)' } }, title) : title),
                    p.reason ? h('div', { className: 'result-reason' }, p.reason) : null,
                    h('div', { style: { display: 'flex', gap: 5, marginTop: 3, flexWrap: 'wrap' } },
                      p.score != null ? h('span', { className: 'mtag' }, p.score + '%') : null,
                      (p.signals && p.signals.has_github) ? h('span', { className: 'mtag ok' }, 'github') : null,
                      (p.signals && p.signals.has_dataset) ? h('span', { className: 'mtag ok' }, 'dataset') : null,
                      (p.signals && p.signals.screened_on) ? h('span', { className: 'mtag' }, p.signals.screened_on) : null,
                      p.overridden ? h('span', { className: 'mtag warn' }, 'kézi') : null)),
                  props.canEdit ? h('div', { className: 'seg', style: { flex: 'none' } }, ['include', 'maybe', 'exclude'].map(function (v) { return h('button', { key: v, className: p.decision === v ? 'on' : '', onClick: function () { override(p, v); } }, v); })) : null);
              }));
          })
      ) : null,
      // 📚 studies manage modal — view all studies + delete (cascades to steps/papers)
      studiesOpen ? h('div', { style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '6vh 16px', overflow: 'auto' }, onClick: function () { setStudiesOpen(false); } },
        h('div', { style: { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, width: 'min(680px, 100%)', maxHeight: '88vh', overflow: 'auto', boxShadow: '0 12px 40px rgba(0,0,0,.25)' }, onClick: function (e) { e.stopPropagation(); } },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '14px 16px', borderBottom: '1px solid var(--line)', position: 'sticky', top: 0, background: 'var(--surface)' } },
            h('h3', { style: { margin: 0 } }, '📚 Tanulmányok (' + studies.length + ')'),
            h('button', { className: 'icon-x', style: { marginLeft: 'auto' }, onClick: function () { setStudiesOpen(false); } }, '✕')),
          h('div', { style: { padding: '4px 16px 16px' } },
            studies.length ? studies.map(function (s) {
              return h('div', { key: s.id, style: { display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 0', borderBottom: '1px solid var(--line)' } },
                h('div', { style: { flex: 1, minWidth: 0 } },
                  h('div', { style: { fontSize: 13.5, fontWeight: 600, whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, s.title),
                  s.question ? h('div', { style: { fontSize: 12, color: 'var(--muted)', marginTop: 2, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 54, overflow: 'hidden' } }, s.question) : null,
                  h('div', { style: { display: 'flex', gap: 6, marginTop: 5, flexWrap: 'wrap' } },
                    h('span', { className: 'chip ' + (s.status === 'done' ? 'c-ok' : 'c-warn') }, s.status === 'done' ? '✓ kész' : 'lépés ' + (s.cur_step || 1) + '/4'),
                    s.id === selId ? h('span', { className: 'chip c-acc' }, 'kiválasztva') : null)),
                h('div', { style: { display: 'flex', flexDirection: 'column', gap: 5, flex: 'none' } },
                  h('button', { className: 'btn', style: { padding: '3px 10px', fontSize: 12 }, onClick: function () { setSelId(s.id); setCurStep(s.cur_step || 1); setStudiesOpen(false); } }, 'Megnyitás'),
                  props.canEdit ? h('button', { className: 'btn', style: { padding: '3px 10px', fontSize: 12, color: 'var(--danger)' }, onClick: function () { delStudy(s); } }, '🗑 Törlés') : null));
            }) : h('div', { style: { fontSize: 13, color: 'var(--faint)', padding: '12px 0' } }, 'Nincs még tanulmány.')
          )
        )
      ) : null
    );
  }

  // ---------- Project detail ----------
  function ProjectDetail(props) {
    var p = props.project;
    var tS = useState('overview'), tab = tS[0], setTab = tS[1];
    var asS = useState(null), autoStudy = asS[0], setAutoStudy = asS[1];   // ideas to auto-create a study from (set by the Ideas "study basis" window → one-click create + Claude pre-fill)
    var edS = useState(false), editOpen = edS[0], setEditOpen = edS[1];   // #2: project settings editor
    function setStage(i) {
      sb.from('research_projects').update({ stage: i }).eq('id', p.id).then(function () {
        // record the milestone so stage progress shows in the log + the supervisor's digest
        sb.from('research_log').insert({ project_id: p.id, profile_id: props.authorId, type: 'MILESTONE', summary: 'Moved to the ' + STAGES[i] + ' stage' }).then(function () { props.onChanged(); });
      });
    }
    function setStatus(e) { sb.from('research_projects').update({ status: e.target.value }).eq('id', p.id).then(props.onChanged); }
    var openTasks = (props.tasks || []).filter(function (t) { return t.status !== 'done'; }).length;
    function startStudyFromIdea(idea) {
      var title = String((idea && idea.question) || 'Irodalom').slice(0, 80);
      sb.from('research_studies').insert({ project_id: p.id, idea_id: idea ? idea.id : null, title: title, question: idea ? idea.question : p.title, created_by: props.authorId }).select('id').maybeSingle().then(function (r) {
        var id = r && r.data && r.data.id; if (!id) return;
        var rows = LS_STEPS.map(function (s) { return { study_id: id, step: s.step, kind: s.kind, config: lsDefaultConfig(s.step, p, idea) }; });
        sb.from('research_study_steps').insert(rows).then(function () { props.onChanged(); setTab('study'); });
      });
    }
    var TABS = [['overview', 'Overview', null], ['ideas', 'Ideas', (props.ideas || []).length], ['literature', 'Literature', (props.sources || []).length], ['study', 'Lit. study', (props.studies || []).length], ['data', 'Data', (props.datasets || []).length], ['compute', 'Compute', (props.jobs || []).length], ['writing', 'Writing', null], ['canvas', 'Canvas', null], ['notes', 'Notes', null], ['log', 'Log', (props.log || []).length], ['tasks', 'Tasks', openTasks]];
    var content;
    if (tab === 'ideas') content = h('div', null, h(ChatPanel, { projectId: p.id, supervised: !!p.student_id, canEdit: props.canEdit, authorId: props.authorId, fileOwnerId: props.fileOwnerId, sources: props.sources, onChanged: props.onChanged }), h(IdeasPanel, { projectId: p.id, ideas: props.ideas, canEdit: props.canEdit, authorId: props.authorId, onChanged: props.onChanged, onStartStudyMulti: function (ideas) { setAutoStudy(ideas || []); setTab('study'); }, onGoStudy: function () { setTab('study'); } }));
    else if (tab === 'literature') content = h(LiteraturePanel, { projectId: p.id, sources: props.sources, canEdit: props.canEdit, myEmail: props.myEmail, onChanged: props.onChanged });
    else if (tab === 'study') content = null;   // #9: rendered persistently below so a running study survives tab switches
    else if (tab === 'data') content = h(DataPanel, { projectId: p.id, datasets: props.datasets, canEdit: props.canEdit, authorId: props.authorId, onChanged: props.onChanged });
    else if (tab === 'compute') content = h(ComputePanel, { projectId: p.id, jobs: props.jobs, datasets: props.datasets, canEdit: props.canEdit, authorId: props.authorId, onChanged: props.onChanged });
    else if (tab === 'writing') content = h(WritingPanel, { project: p, sources: props.sources, ideas: props.ideas, jobs: props.jobs });
    else if (tab === 'canvas') content = window.PRCanvas ? h(window.PRCanvas, { projectId: p.id, canEdit: props.canEdit, authorId: props.authorId }) : h('div', { className: 'empty' }, 'Canvas betöltése…');
    else if (tab === 'notes') content = window.PRNotes ? h(window.PRNotes, { projectId: p.id, canEdit: props.canEdit, authorId: props.authorId }) : h('div', { className: 'empty' }, 'Notes betöltése…');
    else if (tab === 'log') content = h(LogPanel, { projectId: p.id, authorId: props.authorId, entries: props.log, canEdit: props.canEdit, onChanged: props.onChanged });
    else if (tab === 'tasks') content = h(TasksPanel, { projectId: p.id, tasks: props.tasks, canEdit: props.canEdit, onChanged: props.onChanged });
    else content = p.goal ? h('div', { className: 'panel' }, h('h3', null, 'Goal'), h('div', { style: { fontSize: 13.5 } }, p.goal)) : h('div', { className: 'soon' }, 'No goal set yet.');
    return h('div', null,
      h('button', { className: 'back-btn', onClick: props.onBack }, '← All projects'),
      (!props.canEdit && props.viewerId && p.owner_id !== props.viewerId) ? h('div', { className: 'ro-banner' }, '👁 Témavezetői nézet — ' + (props.studentName ? props.studentName + ' projektje' : 'diák projektje') + '. Csak olvasható.') : null,
      h('div', { className: 'dhead' },
        h('div', { className: 'dt' }, h('h1', null, p.title), h('p', null, (p.field || 'No field set') + (p.keywords && p.keywords.length ? ' · ' + p.keywords.join(', ') : ''))),
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
          props.canEdit
            ? h('select', { className: 'field', style: { width: 'auto', height: 32 }, value: p.status, onChange: setStatus }, Object.keys(STATUS_LABEL).map(function (k) { return h('option', { key: k, value: k }, STATUS_LABEL[k]); }))
            : h('span', { className: 'chip c-grey' }, STATUS_LABEL[p.status] || p.status),
          props.canEdit ? h('button', { className: 'btn', style: { height: 32, flex: 'none' }, title: 'Projekt alapbeállításai (cím, terület, kulcsszavak, cél)', onClick: function () { setEditOpen(true); } }, '✎ Beállítások') : null
        )
      ),
      h(Stepper, { stage: p.stage, canEdit: props.canEdit, onSet: setStage, onNav: function (i) { setTab(STAGE_TAB[i] || 'overview'); } }),
      h('div', { className: 'subtabs' }, [['overview', 'Overview', null], ['canvas', 'Canvas', null], ['notes', 'Notes', null], ['log', 'Log', (props.log || []).length], ['tasks', 'Tasks', openTasks]].map(function (t) {
        return h('button', { key: t[0], className: tab === t[0] ? 'on' : '', onClick: function () { setTab(t[0]); } }, t[1], t[2] ? h('span', { className: 'c' }, t[2]) : null);
      })),
      content,
      // #9 — persistent Lit. study: stays mounted (just hidden) on other tabs, so a running study keeps going
      // in the background while you use the Chat / other tabs.
      h('div', { style: { display: tab === 'study' ? 'block' : 'none' } }, h(LiteratureStudy, { projectId: p.id, project: p, studies: props.studies, sources: props.sources, ideas: props.ideas, canEdit: props.canEdit, authorId: props.authorId, onChanged: props.onChanged, autoCreateFrom: autoStudy, onAutoConsumed: function () { setAutoStudy(null); } })),
      editOpen ? h(ProjectSettingsModal, { project: p, onClose: function () { setEditOpen(false); }, onSaved: function () { setEditOpen(false); props.onChanged(); } }) : null
    );
  }

  // ---------- Project card ----------
  function ProjectCard(props) {
    var p = props.project;
    var openTasks = p._openTasks;
    // explicit author attribution so a student's (or a test's) project can never read as the viewer's own
    var badge;
    if (props.meId && p.owner_id === props.meId) badge = h('span', { className: 'chip c-grey author-badge' }, 'Saját');
    else { var st = props.studentById && props.studentById[p.student_id]; badge = h('span', { className: 'chip ' + (st ? 'c-acc' : 'c-warn') + ' author-badge' }, st ? 'Diák: ' + st.name : 'Diák munkája'); }
    return h('div', { className: 'card', onClick: function () { props.onOpen(p); } },
      h('div', { className: 'ch' }, h('div', null, h('b', null, p.title), h('span', null, p.field || '—')), badge),
      p.keywords && p.keywords.length ? h('div', { className: 'tags' }, p.keywords.slice(0, 4).map(function (k, i) { return h('span', { className: 'tag', key: i }, k); })) : null,
      h('div', { className: 'meter' }, h('i', { style: { width: Math.round((p.stage / (STAGES.length - 1)) * 100) + '%' } })),
      h('div', { className: 'kv' }, h('span', null, 'Stage: ' + STAGES[p.stage || 0]), h('span', { className: 'chip ' + (p.status === 'active' ? 'c-ok' : 'c-grey') }, STATUS_LABEL[p.status] || p.status))
    );
  }

  // ---------- Notifications bell (R2) ----------
  function NotifBell() {
    var nS = useState([]), notes = nS[0], setNotes = nS[1];
    var oS = useState(false), open = oS[0], setOpen = oS[1];
    var eS = useState(null), expanded = eS[0], setExpanded = eS[1];
    function load() { sb.from('notifications').select('id,kind,payload,read_at,created_at').order('created_at', { ascending: false }).limit(40).then(function (r) { setNotes((r && r.data) || []); }); }
    useEffect(function () { load(); }, []);
    function markRead(n) { if (n.read_at) return; sb.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', n.id).then(function () { setNotes(function (l) { return l.map(function (x) { return x.id === n.id ? Object.assign({}, x, { read_at: 'now' }) : x; }); }); }); }
    function markAll() { var ids = notes.filter(function (n) { return !n.read_at; }).map(function (n) { return n.id; }); if (!ids.length) return; sb.from('notifications').update({ read_at: new Date().toISOString() }).in('id', ids).then(load); }
    var unread = notes.filter(function (n) { return !n.read_at; }).length;
    function title(n) { return n.kind === 'digest' ? 'Daily research digest' : ((n.payload && n.payload.title) || n.kind); }
    function summ(n) { var p = n.payload || {}; if (n.kind === 'digest') return (p.day || '') + ' · ' + (p.students || 0) + ' student' + (p.students === 1 ? '' : 's') + ', ' + (p.entries || 0) + ' update' + (p.entries === 1 ? '' : 's'); return p.body || ''; }
    return h('div', { className: 'notif-wrap' },
      h('button', { className: 'bell', onClick: function () { setOpen(!open); if (!open) load(); } },
        h('svg', { viewBox: '0 0 16 16', fill: 'none', stroke: 'var(--muted)', strokeWidth: 1.5 }, h('path', { d: 'M8 2a3.5 3.5 0 0 0-3.5 3.5c0 3-1.5 4-1.5 4h10s-1.5-1-1.5-4A3.5 3.5 0 0 0 8 2z', strokeLinejoin: 'round' }), h('path', { d: 'M6.6 12.4a1.5 1.5 0 0 0 2.8 0', strokeLinecap: 'round' })),
        unread ? h('i', { className: 'nb' }, unread) : null
      ),
      open ? h('div', { className: 'notif-pop' },
        h('div', { className: 'nh' }, 'Notifications', unread ? h('button', { className: 'back-btn', style: { margin: 0 }, onClick: markAll }, 'Mark all read') : null),
        notes.length ? notes.map(function (n) {
          var p = n.payload || {};
          return h('div', { key: n.id, className: 'notif-item' + (n.read_at ? '' : ' unread'), onClick: function () { markRead(n); setExpanded(expanded === n.id ? null : n.id); } },
            h('b', null, title(n)), h('div', { className: 'nx' }, summ(n)),
            (expanded === n.id && n.kind === 'digest' && p.items && p.items.length) ? h('div', { style: { marginTop: 8 } }, p.items.map(function (it, i) {
              return h('div', { key: i, className: 'nx', style: { paddingTop: 4 } }, h('span', { className: 'chip c-grey', style: { marginRight: 6 } }, it.type), it.student + ' — ' + it.summary);
            })) : null
          );
        }) : h('div', { style: { padding: 22, textAlign: 'center', color: 'var(--faint)', fontSize: 13 } }, 'No notifications.')
      ) : null
    );
  }

  // ---------- Supervisor view: each supervised student → their (read-only) projects + today's digest chip ----------
  function SupervisedView(props) {
    var students = (props.students && props.students.list) || [];
    var projects = props.projects || [];
    var day = new Date().toISOString().slice(0, 10);
    var dgS = useState({}), digests = dgS[0], setDigests = dgS[1];
    var gnS = useState({}), gen = gnS[0], setGen = gnS[1];
    var ids = students.map(function (s) { return s.id; });
    function loadDigests() {
      if (!ids.length) return;
      sb.from('student_daily_reports').select('student_id,chat_msgs,ideas,log_entries').in('student_id', ids).eq('day', day).then(function (r) {
        var m = {}; ((r && r.data) || []).forEach(function (x) { m[x.student_id] = x; }); setDigests(m);
      });
    }
    useEffect(loadDigests, [ids.length]); // eslint-disable-line
    function setG(sid, v) { setGen(function (g) { var n = Object.assign({}, g); n[sid] = v; return n; }); }
    function generate(sid) {
      setG(sid, true);
      sb.functions.invoke('student-digest', { body: { student_id: sid, day: day } }).then(function () { setG(sid, false); loadDigests(); }, function () { setG(sid, false); });
    }
    var byStudent = {}; projects.forEach(function (p) { (byStudent[p.student_id] = byStudent[p.student_id] || []).push(p); });
    var known = {}; students.forEach(function (s) { known[s.id] = 1; });
    var orphans = projects.filter(function (p) { return !known[p.student_id]; });
    function card(p) { return h(ProjectCard, { key: p.id, project: p, meId: null, studentById: props.studentById, onOpen: props.onOpen }); }
    if (!students.length && !projects.length) return h('div', { className: 'soon' }, h('b', null, 'Még nincs diákod kutatási projekttel. '), 'Amikor egy diákod kutatási projektet hoz létre, itt jelenik meg — diákonként és összesítve.');
    return h('div', null,
      students.map(function (s) {
        var ps = byStudent[s.id] || [];
        var rep = digests[s.id], g = gen[s.id];
        return h('div', { className: 'sup-student', key: s.id },
          h('div', { className: 'sup-head' },
            h(Avatar, { u: s, size: 30 }),
            h('div', { style: { flex: 1, minWidth: 0 } }, h('b', null, s.name), h('span', { className: 'sup-topic' }, s.topic || '—')),
            rep ? h('span', { className: 'chip c-grey' }, (rep.chat_msgs || 0) + ' chat · ' + (rep.ideas || 0) + ' ötlet · ' + (rep.log_entries || 0) + ' napló') : null,
            h('button', { className: 'btn' + (rep ? '' : ' pri'), style: { padding: '5px 10px', fontSize: 12 }, disabled: g, onClick: function () { generate(s.id); } }, g ? 'Készül…' : (rep ? 'Riport frissítése' : 'Riport generálása')),
            h('a', { className: 'btn', style: { padding: '5px 10px', fontSize: 12, textDecoration: 'none' }, href: 'PhD.html?view=reports', title: 'Napi AI-összefoglaló a Doctoral School-ban' }, 'Napi riport →')
          ),
          ps.length ? h('div', { className: 'grid' }, ps.map(card)) : h('div', { className: 'sup-empty' }, 'Nincs aktív kutatási projekt.')
        );
      }),
      orphans.length ? h('div', { className: 'sup-student' },
        h('div', { className: 'sup-head' }, h('b', null, 'Egyéb diák-projektek')),
        h('div', { className: 'grid' }, orphans.map(card))
      ) : null
    );
  }

  // ---------- App ----------
  function App() {
    var ph = useState('loading'), phase = ph[0], setPhase = ph[1];
    var meS = useState(null), me = meS[0], setMe = meS[1];
    var pjS = useState([]), projects = pjS[0], setProjects = pjS[1];
    var selS = useState(null), sel = selS[0], setSel = selS[1];
    var dS = useState({ log: [], tasks: [], ideas: [], sources: [], datasets: [], jobs: [] }), detail = dS[0], setDetail = dS[1];
    var stuS = useState({ byId: {}, list: [] }), supStudents = stuS[0], setSupStudents = stuS[1];   // this supervisor's students (for the "Diákjaim kutatása" view + author badges)

    useEffect(function () { boot(); }, []);
    function boot() {
      if (!BE || !BE.sb) { setPhase('nobackend'); return; }
      if (BE.mode === 'signin' || BE.mode === 'pending') { setPhase('signin'); return; }
      if (BE.mode !== 'cloud' || !BE.user) { setPhase('demo'); return; }
      var target = adminTargetUser();
      var pid = target ? target.id : BE.user.id;
      var email = target ? target.email : (BE.user && BE.user.email);
      sb.from('profiles').select('role,name').eq('id', pid).maybeSingle().then(function (r) {
        var p = (r && r.data) || {};
        setMe({ id: pid, name: p.name || (target && target.name) || BE.user.name, role: p.role, email: email, _preview: !!target });
        loadProjects(pid, !!target, function () { setPhase('ready'); });
        loadStudents(pid);
      }, function () { setMe({ id: pid, name: (target && target.name) || BE.user.name, email: email, _preview: !!target }); setPhase('ready'); });
    }
    // Load the students this user supervises (scoped like phd.jsx effStudents). Empty for non-supervisors
    // or if RLS returns nothing — the supervised view + badges then degrade gracefully.
    function loadStudents(pid) {
      Promise.all([
        sb.from('phd_students').select('id,name,email,profile_id,supervisor_id,topic,avatar_url'),
        sb.from('phd_supervisions').select('student_id,supervisor_id,status')
      ]).then(function (res) {
        var all = (res[0] && res[0].data) || [];
        var acc = ((res[1] && res[1].data) || []).filter(function (v) { return v.supervisor_id === pid && v.status === 'accepted'; }).map(function (v) { return v.student_id; });
        var mine = all.filter(function (s) { return s.supervisor_id === pid || acc.indexOf(s.id) >= 0; });
        var byId = {}; mine.forEach(function (s) { byId[s.id] = s; });
        setSupStudents({ byId: byId, list: mine });
      }, function () { setSupStudents({ byId: {}, list: [] }); });
    }
    function loadProjects(pid, preview, done) {
      sb.from('research_projects').select('id,owner_id,student_id,title,field,keywords,stage,status,goal,updated_at').order('updated_at', { ascending: false }).then(function (r) {
        var list = (r && r.data) || [];
        if (preview) list = list.filter(function (x) { return x.owner_id === pid; });
        setProjects(list);
        setSel(function (cur) { return cur ? (list.filter(function (x) { return x.id === cur.id; })[0] || null) : null; });
        if (done) done();
      });
    }
    function reloadProjects() { loadProjects(me.id, !!me._preview); }
    function loadDetail(projectId) {
      Promise.all([
        sb.from('research_log').select('id,type,summary,ts,profile_id').eq('project_id', projectId).order('ts', { ascending: false }),
        sb.from('research_tasks').select('id,title,status,stage,due').eq('project_id', projectId).order('sort', { ascending: true }),
        sb.from('research_ideas').select('id,source,question,hypothesis,rationale,novelty,status').eq('project_id', projectId).order('created_at', { ascending: false }),
        sb.from('research_sources').select('id,source_api,ext_id,doi,title,authors,year,venue,cited_by,url,screening').eq('project_id', projectId).order('cited_by', { ascending: false, nullsFirst: false }),
        sb.from('research_datasets').select('id,name,source,uri,size_bytes,license,status,local_path').eq('project_id', projectId).order('created_at', { ascending: false }),
        sb.from('research_jobs').select('id,type,title,status,progress,result,result_path,logs,created_at').eq('project_id', projectId).order('created_at', { ascending: false }),
        sb.from('research_studies').select('id,idea_id,title,question,status,cur_step,created_at').eq('project_id', projectId).order('created_at', { ascending: false })
      ]).then(function (res) {
        var log = (res[0] && res[0].data) || [];
        var base = { log: log, tasks: (res[1] && res[1].data) || [], ideas: (res[2] && res[2].data) || [], sources: (res[3] && res[3].data) || [], datasets: (res[4] && res[4].data) || [], jobs: (res[5] && res[5].data) || [], studies: (res[6] && res[6].data) || [] };
        // resolve log author names via profiles_public (base profiles is own/admin-only now), keeping the
        // e.profiles.name shape the renderer expects.
        var ids = {}; log.forEach(function (e) { if (e.profile_id) ids[e.profile_id] = 1; });
        var idList = Object.keys(ids);
        function done(names) { log.forEach(function (e) { e.profiles = { name: (names && names[e.profile_id]) || '' }; }); setDetail(base); }
        if (idList.length) sb.from('profiles_public').select('id,name').in('id', idList).then(function (pr) { var m = {}; ((pr && pr.data) || []).forEach(function (x) { m[x.id] = x.name; }); done(m); }, function () { done({}); });
        else done({});
      });
    }
    function openProject(p) { setSel(p); loadDetail(p.id); }
    function refreshAll() { reloadProjects(); if (sel) loadDetail(sel.id); }

    if (phase === 'loading') return h('div', { className: 'center' }, h('div', { className: 'box' }, h('div', { className: 'mk' }, h('span')), h('h1', null, 'Research'), h('p', null, 'Loading…')));
    if (phase === 'nobackend') return h('div', { className: 'center' }, h('div', { className: 'box' }, h('div', { className: 'mk' }, h('span')), h('h1', null, 'Research'), h('p', null, 'The cloud backend is unavailable.')));
    if (phase === 'signin') return null;
    if (phase === 'demo') return h('div', { className: 'center' }, h('div', { className: 'box' }, h('div', { className: 'mk' }, h('span')), h('h1', null, 'Sign in to Research'), h('p', null, 'The research workspace needs your account.'), h('button', { className: 'btn pri', onClick: function () { try { localStorage.removeItem('proofreader:mode'); } catch (e) { } location.reload(); } }, 'Sign in')));

    var preview = !!me._preview;
    var isAdmin = me.role === 'admin';
    var authorId = (BE.user && BE.user.id) || me.id;   // RLS ties a log author to the real session user
    function canEdit(p) { return !!(p && !preview && (isAdmin || p.owner_id === me.id)); }   // admin-preview is read-only (you are viewing another user's data)

    var initStudent = null; try { initStudent = new URLSearchParams(location.search).get('student'); } catch (e) { }
    return h(AppShell, {
      me: me, preview: preview, projects: projects, sel: sel, students: supStudents, initStudent: initStudent,
      openProject: openProject, onBack: function () { setSel(null); },
      detail: detail, canEdit: canEdit, authorId: authorId, refreshAll: refreshAll, reloadProjects: reloadProjects
    });
  }

  // shell split out so "new project" modal state is local & simple
  function AppShell(props) {
    var a = useState(false), adding = a[0], setAdding = a[1];
    var me = props.me, sel = props.sel, meId = me.id;
    var studentById = (props.students && props.students.byId) || {};
    var studentList = (props.students && props.students.list) || [];
    var mineProjects = props.projects.filter(function (p) { return p.owner_id === meId; });
    var supProjects = props.projects.filter(function (p) { return p.owner_id !== meId; });
    var isSup = studentList.length > 0 || supProjects.length > 0;
    var vw = useState(props.initStudent ? 'supervised' : 'mine'), view = vw[0], setView = vw[1];
    if (!isSup && view === 'supervised') view = 'mine';
    var roleLabel = me.role === 'admin' ? 'Administrator' : (isSup ? 'Supervisor' : 'Researcher');
    var sub = sel ? STAGES[sel.stage || 0] + ' stage' : (view === 'supervised' ? (studentList.length + ' diák') : (mineProjects.length + ' project' + (mineProjects.length === 1 ? '' : 's')));

    var seg = (isSup && !sel) ? h('div', { className: 'segctl' },
      h('button', { className: view === 'mine' ? 'on' : '', onClick: function () { setView('mine'); } }, 'Saját kutatásom (' + mineProjects.length + ')'),
      h('button', { className: view === 'supervised' ? 'on' : '', onClick: function () { setView('supervised'); } }, 'Diákjaim kutatása (' + supProjects.length + ')')
    ) : null;
    var body;
    if (sel) {
      body = h(ProjectDetail, { project: sel, log: props.detail.log, tasks: props.detail.tasks, ideas: props.detail.ideas, sources: props.detail.sources, datasets: props.detail.datasets, jobs: props.detail.jobs, studies: props.detail.studies, canEdit: props.canEdit(sel), viewerId: meId, fileOwnerId: meId, studentName: (studentById[sel.student_id] && studentById[sel.student_id].name) || null, authorId: props.authorId, myEmail: props.me.email, onBack: props.onBack, onChanged: props.refreshAll });
    } else if (view === 'supervised') {
      body = h('div', null, seg, h(SupervisedView, { students: props.students, projects: supProjects, studentById: studentById, onOpen: props.openProject }));
    } else if (!mineProjects.length) {
      body = h('div', null, seg, h('div', { className: 'soon' }, h('b', null, 'No research projects yet. '), 'Create one to start tracking a study from idea to submission.', h('div', { style: { marginTop: 14 } }, h('button', { className: 'btn pri', onClick: function () { setAdding(true); } }, '+ New project'))));
    } else {
      body = h('div', null, seg, h('div', { className: 'grid' }, mineProjects.map(function (p) { return h(ProjectCard, { key: p.id, project: p, meId: meId, studentById: studentById, onOpen: props.openProject }); })));
    }

    return h('div', { className: 'app' },
      h('div', { className: 'side' },
        h('div', { className: 'side-brand' }, h('div', { className: 'mk' }, h('span')), h('div', null, h('b', null, 'Publify'), h('i', null, 'Research'))),
        h('nav', { className: 'nav' },
          h('button', { className: 'on', onClick: props.onBack }, ICp, h('span', null, 'Projects'))
        ),
        h('div', { className: 'side-foot' }, h(Avatar, { u: me, size: 32 }), h('div', { className: 'who' }, h('b', null, me.name), h('span', null, roleLabel)), h('a', { className: 'exit', href: 'Projects.html', title: 'Back to Publify' }, '←'))
      ),
      h('div', { className: 'main' },
        props.preview ? h('div', { className: 'preview-banner' }, '👁 Admin preview — viewing ', h('b', null, me.name), '’s Research. ', h('a', { href: 'PhD.html?adminView=1' }, 'Doctoral School'), ' · ', h('a', { href: 'Profile.html?adminView=1' }, 'Profile'), ' · ', h('a', { href: 'Admin.html' }, '← Back to admin')) : null,
        h('div', { className: 'head' },
          h('div', null, h('h1', null, sel ? 'Project' : 'Research projects'), h('div', { className: 'sub' }, sub)),
          h('div', { style: { display: 'flex', gap: 10, alignItems: 'center' } },
            h(NotifBell, null),
            (sel || view === 'supervised') ? null : h('button', { className: 'btn pri', onClick: function () { setAdding(true); } }, '+ New project')
          )
        ),
        body,
        adding ? h(NewProjectModal, { ownerId: me.id, onClose: function () { setAdding(false); }, onSaved: function (created) { setAdding(false); props.reloadProjects(); if (created) props.openProject(created); } }) : null
      )
    );
  }

  var ICp = h('svg', { viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 }, h('path', { d: 'M2 4.5A1.5 1.5 0 0 1 3.5 3H7l1.5 1.5h4A1.5 1.5 0 0 1 14 6v5.5A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5z' }));

  ReactDOM.createRoot(document.getElementById('root')).render(h(App));
})();
