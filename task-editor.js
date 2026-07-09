/* Publify — shared Task/Step editor.
 * The SAME editor the Protocol page uses under "Steps" (research.jsx TaskEditorModal), extracted so the
 * header Kanban ("My tasks") can offer identical settings when editing an AI protocol step: title, kind,
 * needs-approval, instruction, inputs, expected outputs, acceptance, command hint, est. minutes,
 * per-task attachments (files/folders + notes), depends-on, and ✨ Refine.
 *
 * Plain JS (React.createElement) so any page can load it with a normal <script> after the React UMDs.
 * Exposes window.PRTaskEditor.TaskEditorModal(props) with:
 *   { step, isNew, allSteps, projectId, onSave(data), onClose, boardFields }
 * onSave receives { title, kind, spec:{instruction,inputs,expected_outputs,acceptance,command_hint,est_minutes,attachments}, depends_on, needs_approval }
 * plus { assignee, status } when boardFields is true (the Kanban board columns).
 *
 * Styling uses the shared class vocabulary (.scrim/.modal/.field/.btn/.att-drop/.lchip/.field-label/.icon-x/.fb-mini);
 * a page must provide those (Research.html + Kanban.html do). Only the tiny refine spinner CSS is self-injected.
 *
 * NOTE: keep in sync with research.jsx's inline TaskEditorModal until that page also adopts this module. */
(function () {
  'use strict';
  var h = React.createElement;
  var useState = React.useState, useRef = React.useRef, useEffect = React.useEffect;
  function sb() { var BE = window.PR_BACKEND; return BE && BE.sb; }
  function toast(m, o) { try { window.PRUI && window.PRUI.toast(m, o); } catch (e) { } }

  var PROT_KINDS = ['data', 'preprocess', 'train', 'eval', 'analysis', 'figure', 'writeup', 'custom'];
  var STEP_STATUS = [['todo', 'ToDo'], ['queued', 'Queued'], ['running', 'In progress'], ['blocked', 'Blocked'], ['failed', 'Failed'], ['done', 'Done'], ['skipped', 'Skipped']];

  // one-time tiny spinner style (page-agnostic, so the module never depends on page CSS for it)
  (function injectCss() {
    if (document.getElementById('pte-css')) return;
    var s = document.createElement('style'); s.id = 'pte-css';
    s.textContent = '.pte-spin{display:inline-block;width:13px;height:13px;border:2px solid var(--line);border-top-color:var(--accent);border-radius:50%;animation:pte-rot .7s linear infinite;vertical-align:-2px}@keyframes pte-rot{to{transform:rotate(360deg)}}.pte-refining{display:flex;gap:8px;align-items:center;font-size:12.5px;color:var(--muted)}';
    (document.head || document.documentElement).appendChild(s);
  })();

  // ---- criteria list editor (inputs / expected outputs / acceptance) ----
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
            props.disabled ? null : h('button', { className: 'icon-x', 'aria-label': 'Delete criterion', style: { flex: 'none' }, title: 'Delete', onClick: function () { rm(i); } }, '✕')
          );
        })
      ) : h('div', { style: { fontSize: 11.5, color: 'var(--faint)', marginBottom: 6 } }, props.empty || 'No criteria.'),
      props.disabled ? null : h('div', { style: { display: 'flex', gap: 6 } },
        h('input', { className: 'field', style: { flex: 1, minWidth: 0, fontSize: 12.5 }, value: nv, placeholder: props.placeholder, onChange: function (e) { setNv(e.target.value); }, onKeyDown: function (e) { if (e.key === 'Enter') { e.preventDefault(); add(); } } }),
        h('button', { className: 'btn', style: { flex: 'none', padding: '4px 10px', fontSize: 12 }, onClick: add }, '+ Add')
      )
    );
  }

  // ---- drag/drop helpers (files or whole folders) ----
  function walkEntry(entry, prefix) {
    return new Promise(function (resolve) {
      if (entry.isFile) { entry.file(function (f) { resolve([{ file: f, relpath: prefix + entry.name }]); }, function () { resolve([]); }); }
      else if (entry.isDirectory) {
        var reader = entry.createReader(), all = [];
        (function read() {
          reader.readEntries(function (ents) {
            if (!ents.length) { Promise.all(all.map(function (c) { return walkEntry(c, prefix + entry.name + '/'); })).then(function (a) { resolve(a.reduce(function (x, y) { return x.concat(y); }, [])); }); }
            else { all = all.concat(ents); read(); }
          }, function () { resolve([]); });
        })();
      } else resolve([]);
    });
  }
  function collectDropped(e) {
    var items = e.dataTransfer && e.dataTransfer.items;
    if (items && items.length && items[0].webkitGetAsEntry) {
      var entries = []; for (var i = 0; i < items.length; i++) { var en = items[i].webkitGetAsEntry && items[i].webkitGetAsEntry(); if (en) entries.push(en); }
      return Promise.all(entries.map(function (en) { return walkEntry(en, ''); })).then(function (a) { return a.reduce(function (x, y) { return x.concat(y); }, []); });
    }
    return Promise.resolve(Array.prototype.slice.call((e.dataTransfer && e.dataTransfer.files) || []).map(function (f) { return { file: f, relpath: f.name }; }));
  }

  // ---- the editor ----
  function TaskEditorModal(props) {
    var st = props.step || {}; var sx0 = st.spec || {};
    var board = !!props.boardFields;
    var tt = useState(st.title || ''), title = tt[0], setTitle = tt[1];
    var kk = useState(st.kind || 'custom'), kind = kk[0], setKind = kk[1];
    var ii = useState(sx0.instruction || ''), instr = ii[0], setInstr = ii[1];
    var ip = useState(sx0.inputs || []), inputs = ip[0], setInputs = ip[1];
    var oo = useState(sx0.expected_outputs || []), outs = oo[0], setOuts = oo[1];
    var aa = useState(sx0.acceptance || []), accept = aa[0], setAccept = aa[1];
    var cc = useState(sx0.command_hint || ''), cmd = cc[0], setCmd = cc[1];
    var ee = useState(sx0.est_minutes != null ? String(sx0.est_minutes) : ''), est = ee[0], setEst = ee[1];
    var dd = useState(st.depends_on || []), deps = dd[0], setDeps = dd[1];
    var nn = useState(!!st.needs_approval), needsApp = nn[0], setNeedsApp = nn[1];
    var asg = useState(st.assignee === 'human' ? 'human' : 'ai'), assignee = asg[0], setAssignee = asg[1];
    var sta = useState(st.status || 'todo'), status = sta[0], setStatus = sta[1];
    var rr = useState(false), refining = rr[0], setRefining = rr[1];
    var atA = useState(sx0.attachments || []), att = atA[0], setAtt = atA[1];
    var ubA = useState(''), upBusy = ubA[0], setUpBusy = ubA[1];
    var dgA = useState(false), dragOver = dgA[0], setDragOver = dgA[1];
    var fileRef = useRef(null), folderRef = useRef(null);
    useEffect(function () { function esc(e) { if (e.key === 'Escape') props.onClose(); } window.addEventListener('keydown', esc); return function () { window.removeEventListener('keydown', esc); }; });
    function toggleDep(o) { setDeps(function (d) { return d.indexOf(o) >= 0 ? d.filter(function (x) { return x !== o; }) : d.concat([o]); }); }
    function uploadList(items) {
      if (!items.length) return;
      var batch = String(Date.now()) + '_' + Math.random().toString(36).slice(2, 7);
      var added = [], done = 0; setUpBusy('Uploading 0/' + items.length);
      (function next(i) {
        if (i >= items.length) { if (added.length) setAtt(function (a) { return a.concat(added); }); setUpBusy(''); return; }
        var f = items[i].file; var rel = items[i].relpath || f.name;
        var sp = (props.projectId || 'misc') + '/protocol/' + batch + '/' + rel.replace(/[^A-Za-z0-9._\/-]/g, '_');
        sb().storage.from('research-data').upload(sp, f).then(function (res) {
          done++; setUpBusy('Uploading ' + done + '/' + items.length);
          if (res && res.error) toast(rel + ': ' + res.error.message, { kind: 'error' });
          else added.push({ name: rel, storage_path: sp, mime: f.type || '', size: f.size, note: '' });
          next(i + 1);
        }, function () { done++; next(i + 1); });
      })(0);
    }
    function uploadFiles(e) {
      var fs = Array.prototype.slice.call((e.target && e.target.files) || []); if (e.target) e.target.value = '';
      uploadList(fs.map(function (f) { return { file: f, relpath: f.webkitRelativePath || f.name }; }));
    }
    function onDrop(e) { e.preventDefault(); setDragOver(false); collectDropped(e).then(uploadList); }
    function setNote(i, v) { setAtt(function (x) { return x.map(function (it, j) { return j === i ? Object.assign({}, it, { note: v }) : it; }); }); }
    function removeAtt(i) {
      var a = att[i]; if (a && a.storage_path) { try { sb().storage.from('research-data').remove([a.storage_path]); } catch (e) { } }
      setAtt(function (x) { return x.filter(function (_, j) { return j !== i; }); });
    }
    function dlAtt(a) { sb().storage.from('research-data').createSignedUrl(a.storage_path, 3600, { download: (a.name || '').split('/').pop() }).then(function (r) { if (r && r.data && r.data.signedUrl) window.open(r.data.signedUrl, '_blank'); }); }
    function save() {
      if (!title.trim()) { toast('A title is required', { kind: 'error' }); return; }
      var data = { title: title.trim(), kind: kind, spec: { instruction: instr, inputs: inputs, expected_outputs: outs, acceptance: accept, command_hint: cmd, est_minutes: est ? parseInt(est, 10) : null, attachments: att }, depends_on: deps, needs_approval: needsApp };
      if (board) { data.assignee = assignee; data.status = status; }
      props.onSave(data);
    }
    function refine() {
      if (!st.id) return; setRefining(true);
      sb().functions.invoke('research-protocol', { body: { action: 'refine_step', project_id: props.projectId, step_id: st.id } }).then(function (r) {
        setRefining(false); var sp = r && r.data && r.data.step;
        if (!sp) { toast('Refine failed: ' + ((r && r.data && r.data.error) || ''), { kind: 'error' }); return; }
        if (sp.title) setTitle(sp.title); if (sp.kind) setKind(sp.kind);
        if (sp.instruction != null) setInstr(sp.instruction); if (sp.inputs) setInputs(sp.inputs); if (sp.expected_outputs) setOuts(sp.expected_outputs);
        if (sp.acceptance) setAccept(sp.acceptance); if (sp.command_hint != null) setCmd(sp.command_hint); if (sp.est_minutes != null) setEst(String(sp.est_minutes)); if (sp.needs_approval != null) setNeedsApp(!!sp.needs_approval);
        toast('Refined — review and Save', { kind: 'ok' });
      }, function (e) { setRefining(false); toast('Refine failed: ' + e, { kind: 'error' }); });
    }
    var chip = function (on) { return 'lchip' + (on ? ' on' : ''); };
    return h('div', { className: 'scrim', onClick: props.onClose }, h('div', {
      className: 'modal', style: { width: 620 }, onClick: function (e) { e.stopPropagation(); },
      onDragOver: function (e) { e.preventDefault(); if (!dragOver) setDragOver(true); },
      onDragLeave: function (e) { if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget)) return; setDragOver(false); },
      onDrop: onDrop
    },
      h('div', { className: 'modal-h' },
        h('h3', { style: { margin: 0, flex: 1 } }, props.isNew ? 'New task' : (board ? 'Edit task' : 'Edit task')),
        st.id ? h('button', { className: 'btn', style: { padding: '4px 9px', fontSize: 12, flex: 'none' }, disabled: refining, title: 'Let Publify improve this step', onClick: refine }, refining ? '✨…' : '✨ Refine') : null,
        h('button', { className: 'icon-x', 'aria-label': 'Close', onClick: props.onClose }, '✕')),
      h('div', { style: { padding: 16, display: 'flex', flexDirection: 'column', gap: 10, maxHeight: '70vh', overflow: 'auto' } },
        refining ? h('div', { className: 'pte-refining' }, h('span', { className: 'pte-spin' }), 'Refining this task…') : null,
        h('div', { style: { display: 'flex', gap: 8 } },
          h('input', { className: 'field', style: { flex: 1 }, placeholder: 'Task title', value: title, onChange: function (e) { setTitle(e.target.value); } }),
          h('select', { className: 'field', style: { width: 130, flex: 'none' }, value: kind, onChange: function (e) { setKind(e.target.value); } }, PROT_KINDS.map(function (x) { return h('option', { key: x, value: x }, x); }))),
        board ? h('div', { style: { display: 'flex', gap: 18, flexWrap: 'wrap' } },
          h('div', null, h('div', { className: 'field-label' }, 'Owner'),
            h('div', { style: { display: 'flex', gap: 6 } }, [['human', '👤 Human'], ['ai', '🤖 AI']].map(function (o) { return h('button', { key: o[0], className: chip(assignee === o[0]), onClick: function () { setAssignee(o[0]); } }, o[1]); }))),
          h('div', null, h('div', { className: 'field-label' }, 'Status'),
            h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } }, STEP_STATUS.map(function (o) { return h('button', { key: o[0], className: chip(status === o[0]), onClick: function () { setStatus(o[0]); } }, o[1]); })))
        ) : null,
        h('label', { style: { display: 'flex', gap: 7, alignItems: 'center', fontSize: 12.5 } }, h('input', { type: 'checkbox', checked: needsApp, onChange: function (e) { setNeedsApp(e.target.checked); } }), '⏸ Needs my approval before the runner executes it'),
        h('div', null, h('div', { className: 'field-label' }, 'Instruction'), h('textarea', { className: 'field', rows: 3, style: { width: '100%', boxSizing: 'border-box' }, placeholder: 'Exactly what the agent should do…', value: instr, onChange: function (e) { setInstr(e.target.value); } })),
        h('div', null, h('div', { className: 'field-label' }, 'Inputs'), h(CritEditor, { items: inputs, onChange: setInputs, placeholder: 'a file / dataset / prior-step output', empty: 'No inputs.' })),
        h('div', null, h('div', { className: 'field-label' }, 'Expected outputs'), h(CritEditor, { items: outs, onChange: setOuts, placeholder: 'a file / metric / artifact produced', empty: 'No outputs.' })),
        h('div', null, h('div', { className: 'field-label' }, 'Acceptance — done when…'), h(CritEditor, { items: accept, onChange: setAccept, accent: '#16a34a', placeholder: 'an objective success check', empty: 'No acceptance checks.' })),
        h('div', null, h('div', { className: 'field-label' }, 'Command hint'), h('textarea', { className: 'field', rows: 2, style: { width: '100%', boxSizing: 'border-box', fontFamily: 'monospace', fontSize: 12 }, placeholder: 'a likely shell command / script', value: cmd, onChange: function (e) { setCmd(e.target.value); } })),
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } }, h('span', { className: 'field-label', style: { margin: 0 } }, 'Est. minutes'), h('input', { className: 'field', type: 'number', min: 0, style: { width: 100 }, value: est, onChange: function (e) { setEst(e.target.value); } })),
        h('div', null,
          h('div', { className: 'field-label' }, 'Attachments — files / folders for this task'),
          h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' } },
            h('button', { className: 'btn', style: { padding: '4px 10px', fontSize: 12 }, onClick: function () { if (fileRef.current) fileRef.current.click(); } }, '⤒ Add files'),
            h('button', { className: 'btn', style: { padding: '4px 10px', fontSize: 12 }, title: 'Upload a whole folder (structure preserved)', onClick: function () { if (folderRef.current) folderRef.current.click(); } }, '📁 Add folder'),
            upBusy ? h('span', { style: { fontSize: 11.5, color: 'var(--muted)' } }, '⏳ ' + upBusy) : null,
            h('input', { ref: fileRef, type: 'file', multiple: true, style: { display: 'none' }, onChange: uploadFiles }),
            h('input', { ref: function (n) { if (n) { try { n.webkitdirectory = true; n.directory = true; } catch (e) { } } folderRef.current = n; }, type: 'file', multiple: true, style: { display: 'none' }, onChange: uploadFiles })),
          h('div', { className: 'att-drop' + (dragOver ? ' over' : ''), onDragOver: function (e) { e.preventDefault(); if (!dragOver) setDragOver(true); }, onDragLeave: function (e) { e.preventDefault(); setDragOver(false); }, onDrop: onDrop },
            dragOver ? '⤓ Drop to upload' : '⤓ Drag & drop files or a folder here'),
          att.length ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 5, marginTop: 6 } }, att.map(function (a, i) {
            return h('div', { key: i, style: { background: 'var(--soft)', padding: '5px 8px', borderRadius: 6 } },
              h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 11.5 } },
                h('span', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: a.name }, '📎 ' + a.name),
                h('span', { style: { color: 'var(--faint)', flex: 'none' } }, a.size != null ? (Math.max(1, Math.round(a.size / 1024)) + ' KB') : ''),
                h('button', { className: 'fb-mini', 'aria-label': 'Download', title: 'Download', onClick: function () { dlAtt(a); } }, '⬇'),
                h('button', { className: 'fb-mini', 'aria-label': 'Remove', title: 'Remove', onClick: function () { removeAtt(i); } }, '×')),
              h('input', { className: 'field', style: { width: '100%', boxSizing: 'border-box', marginTop: 4, fontSize: 11.5, padding: '3px 7px' }, placeholder: '📝 What to do with this file (optional per-file note)…', value: a.note || '', onChange: function (e) { setNote(i, e.target.value); } }));
          })) : h('div', { style: { fontSize: 11.5, color: 'var(--faint)' } }, 'No files yet. Upload files/folders, then say in the Instruction (or per-file note) what the runner should do with them.')),
        (props.allSteps && props.allSteps.filter(function (x) { return x.id !== st.id; }).length) ? h('div', null, h('div', { className: 'field-label' }, 'Depends on (must finish first)'),
          h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } }, props.allSteps.filter(function (x) { return x.id !== st.id; }).map(function (x) {
            return h('button', { key: x.id, className: 'lchip' + (deps.indexOf(x.ord) >= 0 ? ' on' : ''), style: { fontSize: 11 }, onClick: function () { toggleDep(x.ord); } }, x.ord + '. ' + (x.title || '').slice(0, 26));
          }))) : null
      ),
      h('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '12px 16px', borderTop: '1px solid var(--line)' } },
        h('button', { className: 'btn', onClick: props.onClose }, 'Cancel'),
        h('button', { className: 'btn pri', onClick: save }, props.isNew ? 'Add task' : 'Save'))
    ));
  }

  window.PRTaskEditor = { TaskEditorModal: TaskEditorModal, CritEditor: CritEditor };
})();
