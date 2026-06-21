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
      sb.from('research_projects').insert({
        owner_id: props.ownerId, title: form.title.trim(), field: form.field.trim() || null,
        keywords: form.keywords ? form.keywords.split(',').map(function (x) { return x.trim(); }).filter(Boolean) : null,
        goal: form.goal.trim() || null, stage: 0, status: 'active'
      }).select().maybeSingle().then(function (r) {
        setSaving(false);
        if (r && r.error) { alert('Could not create: ' + r.error.message); return; }
        props.onSaved(r && r.data);
      });
    }
    return h('div', { className: 'scrim', onClick: props.onClose },
      h('div', { className: 'modal', onClick: function (e) { e.stopPropagation(); } },
        h('div', { className: 'modal-h' }, h('b', null, 'New research project'), h('button', { className: 'x', onClick: props.onClose }, '×')),
        h('div', { className: 'modal-b' },
          h('div', { className: 'field' }, h('label', null, 'Title *'), h('input', { value: form.title, onChange: function (e) { up('title', e.target.value); }, placeholder: 'e.g. Fisher fusion for LiDAR OOD detection' })),
          h('div', { className: 'field' }, h('label', null, 'Field'), h('input', { value: form.field, onChange: function (e) { up('field', e.target.value); }, placeholder: 'e.g. Computer vision, Robotics' })),
          h('div', { className: 'field' }, h('label', null, 'Keywords (comma-separated)'), h('input', { value: form.keywords, onChange: function (e) { up('keywords', e.target.value); }, placeholder: 'OOD, LiDAR, uncertainty' })),
          h('div', { className: 'field' }, h('label', null, 'Goal / expected output'), h('textarea', { rows: 3, value: form.goal, onChange: function (e) { up('goal', e.target.value); }, placeholder: 'What does success look like? (paper, thesis chapter, …)' }))
        ),
        h('div', { className: 'modal-foot' }, h('button', { className: 'btn', onClick: props.onClose }, 'Cancel'), h('button', { className: 'btn pri', disabled: saving, onClick: save }, saving ? 'Creating…' : 'Create project'))
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
        key: i, className: cls, disabled: !props.canEdit,
        title: props.canEdit ? 'Set stage to ' + name : name,
        onClick: function () { if (props.canEdit && i !== cur) props.onSet(i); }
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
    var uS = useState(''), upMsg = uS[0], setUpMsg = uS[1];
    useEffect(function () { sb.from('publication_files').select('id,name,mime,size,storage_path').eq('owner_id', props.authorId).order('created_at', { ascending: false }).then(function (r) { setFiles((r && r.data) || []); }); }, []);
    function onUpload(e) {
      var f = e.target.files && e.target.files[0]; if (!f) return;
      setUpMsg('Uploading…');
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
          h('div', { className: 'sec-t' }, 'My publication files'),
          files === null ? h('div', { style: { fontSize: 12.5, color: 'var(--faint)' } }, 'Loading…') : (files.length ? files.map(function (f) { return row('f' + f.id, f.name, (f.mime || '') + (f.size ? ' · ' + fmtBytes(f.size) : ''), function () { props.onPick({ kind: 'file', bucket: 'publication-files', path: f.storage_path, name: f.name, mime: f.mime, label: f.name }); props.onClose(); }); }) : h('div', { style: { fontSize: 12.5, color: 'var(--faint)' } }, 'No files uploaded to your profile yet.')),
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
  var CHAT_SUGGEST = ['What are the open problems in this field?', 'Summarize the key methods used so far.', 'Suggest 3 testable research questions for my goal.', 'What evidence would support or refute my hypothesis?'];
  function ChatPanel(props) {
    var cS = useState(null), chat = cS[0], setChat = cS[1];
    var mS = useState([]), msgs = mS[0], setMsgs = mS[1];
    var eS = useState({}), evByMsg = eS[0], setEvByMsg = eS[1];
    var iS = useState(''), input = iS[0], setInput = iS[1];
    var bS = useState(false), busy = bS[0], setBusy = bS[1];
    var er = useState(''), err = er[0], setErr = er[1];
    var ty = useState(null), typing = ty[0], setTyping = ty[1];          // { id, len } of the message being typed out
    var atS = useState([]), attach = atS[0], setAttach = atS[1];          // pending attachments for the next message
    var pkS = useState(false), picker = pkS[0], setPicker = pkS[1];
    var firstLoad = useRef(true), animated = useRef({}), alive = useRef(true), scrollRef = useRef(null), taRef = useRef(null);
    useEffect(function () { return function () { alive.current = false; }; }, []);
    function startTyping(id, full) {
      if (!full) return;
      var i = 0, step = Math.max(1, Math.round(full.length / 110));       // ~half the previous speed (more frames + slower tick)
      setTyping({ id: id, len: 0 });
      (function tick() {
        if (!alive.current) return;
        i += step;
        if (i >= full.length) { setTyping(null); return; }
        setTyping({ id: id, len: i });
        setTimeout(tick, 30);
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
          if (last && !animated.current[last.id]) { animated.current[last.id] = true; startTyping(last.id, last.content); }  // animate only a freshly-arrived reply
        }
      });
    }
    useEffect(function () {
      sb.from('research_chats').select('id').eq('project_id', props.projectId).order('created_at', { ascending: true }).limit(1).then(function (r) {
        var c = (r && r.data && r.data[0]) || null; setChat(c); if (c) loadMsgs(c.id);
      });
    }, []);
    useEffect(function () { var el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; }, [msgs.length, typing]);  // follow the conversation
    function ensureChat() {
      if (chat) return Promise.resolve(chat.id);
      return sb.from('research_chats').insert({ project_id: props.projectId, title: 'Publify chat' }).select('id').maybeSingle().then(function (r) { var c = r && r.data; setChat(c); return c && c.id; });
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
          sb.functions.invoke('research-chat', { body: { chat_id: cid } }).then(function (res) {
            setBusy(false);
            if (res && (res.error || (res.data && res.data.error))) { setErr('AI connection pending — deploy the research-chat Edge function and set ANTHROPIC_API_KEY.'); return; }
            loadMsgs(cid);
          }, function () { setBusy(false); setErr('AI connection pending — deploy the research-chat Edge function.'); });
        });
      });
    }
    function send() { sendText(input); }
    function copy(m) { try { navigator.clipboard.writeText(m.content || ''); } catch (e) { } }
    function onTaKey(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }
    function onTaInput(e) { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px'; }
    function saveIdea(m) { sb.from('research_ideas').insert({ project_id: props.projectId, source: 'consensus', question: (m.content || '').slice(0, 500), created_by: props.authorId, status: 'candidate' }).then(function (r) { if (r && r.error) { alert(r.error.message); return; } props.onChanged(); }); }
    return h('div', { className: 'panel' },
      h('h3', null, 'Chat with Publify', h('span', { style: { fontWeight: 600, color: 'var(--faint)' } }, 'research assistant')),
      props.supervised ? h('div', { style: { fontSize: 12, color: 'var(--muted)', background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 8, padding: '7px 11px', marginBottom: 10, lineHeight: 1.45 } }, 'ℹ️ A kutatási beszélgetéseidből a témavezetőd napi összefoglalót kaphat (mit dolgoztál, milyen döntéseket hoztál).') : null,
      h('div', { className: 'chat-msgs', ref: scrollRef },
        msgs.length ? msgs.map(function (m) {
          var isTyping = typing && typing.id === m.id;
          var ai = m.role === 'assistant';
          var body = (ai && !isTyping)
            ? h('div', { className: 'btxt md', dangerouslySetInnerHTML: { __html: mdHtml(m.content) } })
            : h('div', { className: 'btxt' }, isTyping ? (m.content || '').slice(0, typing.len) : m.content, isTyping ? h('span', { className: 'tw-cursor' }, '▌') : null);
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
        busy ? h('div', { className: 'bubble ai' }, h('div', { className: 'btxt', style: { color: 'var(--faint)' } }, 'Publify is thinking…')) : null
      ),
      err ? h('div', { style: { fontSize: 12.5, color: 'var(--warn)', margin: '6px 0 0' } }, err) : null,
      props.canEdit ? h('div', null,
        attach.length ? h('div', { className: 'attach-chips' }, attach.map(function (a, i) {
          return h('span', { className: 'attach-chip', key: i }, (a.kind === 'source' ? '📄 ' : '📎 ') + (a.label || a.name || a.title || 'attachment'),
            h('button', { title: 'Remove', onClick: function () { setAttach(attach.filter(function (_, j) { return j !== i; })); } }, '×'));
        })) : null,
        h('div', { className: 'chat-input' },
          h('button', { className: 'attach-btn', title: 'Attach a library source, publication or file', disabled: busy, onClick: function () { setPicker(true); } }, '📎'),
          h('textarea', { ref: taRef, value: input, rows: 1, placeholder: 'Message Publify…  (Enter to send · Shift+Enter newline)', disabled: busy, onChange: onTaInput, onKeyDown: onTaKey }),
          h('button', { className: 'btn pri', disabled: busy, onClick: send }, 'Send')
        )
      ) : null,
      picker ? h(AttachModal, { projectId: props.projectId, authorId: props.authorId, sources: props.sources, onPick: function (a) { setAttach(function (p) { return p.concat([a]); }); }, onClose: function () { setPicker(false); } }) : null
    );
  }

  // ---------- Ideas (R1) ----------
  function IdeasPanel(props) {
    var f = useState({ question: '', hypothesis: '' }), form = f[0], setForm = f[1];
    var b = useState(false), busy = b[0], setBusy = b[1];
    var m = useState(''), msg = m[0], setMsg = m[1];
    function add() {
      if (!form.question.trim()) { setMsg('Type a research question first.'); return; }
      setMsg('');
      sb.from('research_ideas').insert({ project_id: props.projectId, source: 'own', question: form.question.trim(), hypothesis: form.hypothesis.trim() || null, created_by: props.authorId, status: 'candidate' }).then(function (r) { if (r && r.error) { setMsg('Could not add: ' + r.error.message); return; } setForm({ question: '', hypothesis: '' }); props.onChanged(); });
    }
    function onKey(e) { if (e.key === 'Enter') add(); }
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
    return h('div', { className: 'panel' },
      h('h3', null, 'Research ideas', props.canEdit ? h('button', { className: 'btn', style: { padding: '4px 10px', fontSize: 12 }, disabled: busy, onClick: gap }, '✨ Gap analysis (AI)') : null),
      msg ? h('div', { style: { fontSize: 12.5, color: 'var(--muted)', marginBottom: 8 } }, msg) : null,
      props.canEdit ? h('div', { style: { marginBottom: 10 } },
        h('input', { style: { width: '100%', height: 36, border: '1px solid var(--line)', borderRadius: 8, padding: '0 10px', fontFamily: 'inherit', fontSize: 13 }, value: form.question, placeholder: 'A research question…', onChange: function (e) { setForm(Object.assign({}, form, { question: e.target.value })); }, onKeyDown: onKey }),
        h('input', { style: { width: '100%', height: 36, marginTop: 6, border: '1px solid var(--line)', borderRadius: 8, padding: '0 10px', fontFamily: 'inherit', fontSize: 13 }, value: form.hypothesis, placeholder: 'Hypothesis (optional)', onChange: function (e) { setForm(Object.assign({}, form, { hypothesis: e.target.value })); }, onKeyDown: onKey }),
        h('div', { style: { marginTop: 8 } }, h('button', { className: 'btn pri', onClick: add }, 'Add idea'))
      ) : null,
      ideas.length ? ideas.map(function (idea) {
        return h('div', { className: 'idea', key: idea.id },
          h('div', { style: { display: 'flex', gap: 7, alignItems: 'center', marginBottom: 4 } },
            h('span', { className: 'chip ' + (idea.source === 'gap' ? 'c-acc' : 'c-grey') }, idea.source),
            idea.novelty != null ? h('span', { className: 'chip c-ok' }, 'novelty ' + idea.novelty) : null,
            h('span', { className: 'chip ' + (idea.status === 'selected' ? 'c-ok' : (idea.status === 'rejected' ? 'c-grey' : 'c-warn')) }, idea.status),
            props.canEdit ? h('button', { className: 'icon-x', style: { marginLeft: 'auto' }, onClick: function () { del(idea); } }, '✕') : null
          ),
          h('div', { style: { fontSize: 13.5, fontWeight: 600 } }, idea.question),
          idea.hypothesis ? h('div', { style: { fontSize: 12.5, color: 'var(--muted)', marginTop: 2 } }, idea.hypothesis) : null,
          idea.rationale ? h('div', { style: { fontSize: 12, color: 'var(--faint)', marginTop: 4 } }, idea.rationale) : null,
          props.canEdit ? h('div', { className: 'idea-foot' },
            h('button', { onClick: function () { setStatus(idea, 'selected'); } }, 'Select'),
            h('button', { onClick: function () { setStatus(idea, 'rejected'); } }, 'Reject'),
            h('button', { onClick: function () { setStatus(idea, 'candidate'); } }, 'Reset')
          ) : null
        );
      }) : h('div', { style: { fontSize: 13, color: 'var(--faint)', padding: '8px 0' } }, 'No ideas yet — add your own or run a gap analysis.')
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

  // ---------- Project detail ----------
  function ProjectDetail(props) {
    var p = props.project;
    var tS = useState('overview'), tab = tS[0], setTab = tS[1];
    function setStage(i) {
      sb.from('research_projects').update({ stage: i }).eq('id', p.id).then(function () {
        // record the milestone so stage progress shows in the log + the supervisor's digest
        sb.from('research_log').insert({ project_id: p.id, profile_id: props.authorId, type: 'MILESTONE', summary: 'Moved to the ' + STAGES[i] + ' stage' }).then(function () { props.onChanged(); });
      });
    }
    function setStatus(e) { sb.from('research_projects').update({ status: e.target.value }).eq('id', p.id).then(props.onChanged); }
    var openTasks = (props.tasks || []).filter(function (t) { return t.status !== 'done'; }).length;
    var TABS = [['overview', 'Overview', null], ['ideas', 'Ideas', (props.ideas || []).length], ['literature', 'Literature', (props.sources || []).length], ['data', 'Data', (props.datasets || []).length], ['compute', 'Compute', (props.jobs || []).length], ['writing', 'Writing', null], ['canvas', 'Canvas', null], ['log', 'Log', (props.log || []).length], ['tasks', 'Tasks', openTasks]];
    var content;
    if (tab === 'ideas') content = h('div', null, h(ChatPanel, { projectId: p.id, supervised: !!p.student_id, canEdit: props.canEdit, authorId: props.authorId, sources: props.sources, onChanged: props.onChanged }), h(IdeasPanel, { projectId: p.id, ideas: props.ideas, canEdit: props.canEdit, authorId: props.authorId, onChanged: props.onChanged }));
    else if (tab === 'literature') content = h(LiteraturePanel, { projectId: p.id, sources: props.sources, canEdit: props.canEdit, myEmail: props.myEmail, onChanged: props.onChanged });
    else if (tab === 'data') content = h(DataPanel, { projectId: p.id, datasets: props.datasets, canEdit: props.canEdit, authorId: props.authorId, onChanged: props.onChanged });
    else if (tab === 'compute') content = h(ComputePanel, { projectId: p.id, jobs: props.jobs, datasets: props.datasets, canEdit: props.canEdit, authorId: props.authorId, onChanged: props.onChanged });
    else if (tab === 'writing') content = h(WritingPanel, { project: p, sources: props.sources, ideas: props.ideas, jobs: props.jobs });
    else if (tab === 'canvas') content = window.PRCanvas ? h(window.PRCanvas, { projectId: p.id, canEdit: props.canEdit, authorId: props.authorId }) : h('div', { className: 'empty' }, 'Canvas betöltése…');
    else if (tab === 'log') content = h(LogPanel, { projectId: p.id, authorId: props.authorId, entries: props.log, canEdit: props.canEdit, onChanged: props.onChanged });
    else if (tab === 'tasks') content = h(TasksPanel, { projectId: p.id, tasks: props.tasks, canEdit: props.canEdit, onChanged: props.onChanged });
    else content = p.goal ? h('div', { className: 'panel' }, h('h3', null, 'Goal'), h('div', { style: { fontSize: 13.5 } }, p.goal)) : h('div', { className: 'soon' }, 'No goal set yet.');
    return h('div', null,
      h('button', { className: 'back-btn', onClick: props.onBack }, '← All projects'),
      h('div', { className: 'dhead' },
        h('div', { className: 'dt' }, h('h1', null, p.title), h('p', null, (p.field || 'No field set') + (p.keywords && p.keywords.length ? ' · ' + p.keywords.join(', ') : ''))),
        props.canEdit
          ? h('select', { className: 'field', style: { width: 'auto', height: 32 }, value: p.status, onChange: setStatus }, Object.keys(STATUS_LABEL).map(function (k) { return h('option', { key: k, value: k }, STATUS_LABEL[k]); }))
          : h('span', { className: 'chip c-grey' }, STATUS_LABEL[p.status] || p.status)
      ),
      h(Stepper, { stage: p.stage, canEdit: props.canEdit, onSet: setStage }),
      h('div', { className: 'tabs' }, TABS.map(function (t) { return h('button', { key: t[0], className: tab === t[0] ? 'on' : '', onClick: function () { setTab(t[0]); } }, t[1], t[2] ? h('span', { className: 'c' }, t[2]) : null); })),
      content
    );
  }

  // ---------- Project card ----------
  function ProjectCard(props) {
    var p = props.project;
    var openTasks = p._openTasks;
    return h('div', { className: 'card', onClick: function () { props.onOpen(p); } },
      h('div', { className: 'ch' }, h('div', null, h('b', null, p.title), h('span', null, p.field || '—'))),
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

  // ---------- App ----------
  function App() {
    var ph = useState('loading'), phase = ph[0], setPhase = ph[1];
    var meS = useState(null), me = meS[0], setMe = meS[1];
    var pjS = useState([]), projects = pjS[0], setProjects = pjS[1];
    var selS = useState(null), sel = selS[0], setSel = selS[1];
    var dS = useState({ log: [], tasks: [], ideas: [], sources: [], datasets: [], jobs: [] }), detail = dS[0], setDetail = dS[1];

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
      }, function () { setMe({ id: pid, name: (target && target.name) || BE.user.name, email: email, _preview: !!target }); setPhase('ready'); });
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
        sb.from('research_log').select('id,type,summary,ts,profile_id,profiles(name)').eq('project_id', projectId).order('ts', { ascending: false }),
        sb.from('research_tasks').select('id,title,status,stage,due').eq('project_id', projectId).order('sort', { ascending: true }),
        sb.from('research_ideas').select('id,source,question,hypothesis,rationale,novelty,status').eq('project_id', projectId).order('created_at', { ascending: false }),
        sb.from('research_sources').select('id,source_api,ext_id,doi,title,authors,year,venue,cited_by,url,screening').eq('project_id', projectId).order('cited_by', { ascending: false, nullsFirst: false }),
        sb.from('research_datasets').select('id,name,source,uri,size_bytes,license,status,local_path').eq('project_id', projectId).order('created_at', { ascending: false }),
        sb.from('research_jobs').select('id,type,title,status,progress,result,result_path,logs,created_at').eq('project_id', projectId).order('created_at', { ascending: false })
      ]).then(function (res) {
        setDetail({ log: (res[0] && res[0].data) || [], tasks: (res[1] && res[1].data) || [], ideas: (res[2] && res[2].data) || [], sources: (res[3] && res[3].data) || [], datasets: (res[4] && res[4].data) || [], jobs: (res[5] && res[5].data) || [] });
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
    function canEdit(p) { return !!(p && (isAdmin || p.owner_id === me.id)); }

    return h(AppShell, {
      me: me, preview: preview, projects: projects, sel: sel,
      openProject: openProject, onBack: function () { setSel(null); },
      detail: detail, canEdit: canEdit, authorId: authorId, refreshAll: refreshAll, reloadProjects: reloadProjects
    });
  }

  // shell split out so "new project" modal state is local & simple
  function AppShell(props) {
    var a = useState(false), adding = a[0], setAdding = a[1];
    var me = props.me, sel = props.sel;
    var roleLabel = me.role === 'admin' ? 'Administrator' : 'Researcher';
    var sub = sel ? STAGES[sel.stage || 0] + ' stage' : (props.projects.length + ' project' + (props.projects.length === 1 ? '' : 's'));

    var body;
    if (sel) {
      body = h(ProjectDetail, { project: sel, log: props.detail.log, tasks: props.detail.tasks, ideas: props.detail.ideas, sources: props.detail.sources, datasets: props.detail.datasets, jobs: props.detail.jobs, canEdit: props.canEdit(sel), authorId: props.authorId, myEmail: props.me.email, onBack: props.onBack, onChanged: props.refreshAll });
    } else if (!props.projects.length) {
      body = h('div', { className: 'soon' }, h('b', null, 'No research projects yet. '), 'Create one to start tracking a study from idea to submission.', h('div', { style: { marginTop: 14 } }, h('button', { className: 'btn pri', onClick: function () { setAdding(true); } }, '+ New project')));
    } else {
      body = h('div', { className: 'grid' }, props.projects.map(function (p) { return h(ProjectCard, { key: p.id, project: p, onOpen: props.openProject }); }));
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
            sel ? null : h('button', { className: 'btn pri', onClick: function () { setAdding(true); } }, '+ New project')
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
