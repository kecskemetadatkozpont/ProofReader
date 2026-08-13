/* Publify — Session. A plain full Publify chat (Zola-style) with a left history sidebar.
 * Streams via the claude-session Edge function; conversations live in user_chats / user_chat_messages
 * (migration-25), owner-scoped. Uses the user's per-user model. No bundler — React.createElement. */
(function () {
  var h = React.createElement;
  var useState = React.useState, useEffect = React.useEffect, useRef = React.useRef;
  var BE = window.PR_BACKEND, sb = BE && BE.sb;
  var CFG = window.PR_CONFIG || {};

  // Local indeterminate variant of the shared .pr-bar: its <i> slides instead of being width-driven,
  // so a multi-minute agent/streaming run shows live motion (reduced-motion is handled by theme.js).
  (function () {
    if (document.getElementById('pr-bar-indet-style')) return;
    var s = document.createElement('style'); s.id = 'pr-bar-indet-style';
    s.textContent = '.pr-bar.indet { width: 120px; max-width: 40vw; }' +
      '.pr-bar.indet > i { width: 40%; transition: none; animation: pr-bar-indet 1.2s ease-in-out infinite; }' +
      '@keyframes pr-bar-indet { 0% { transform: translateX(-110%); } 100% { transform: translateX(280%); } }';
    (document.head || document.documentElement).appendChild(s);
  })();

  function mdHtml(t) { var s = String(t == null ? '' : t); try { if (window.marked && window.DOMPurify) return window.DOMPurify.sanitize(window.marked.parse(s, { breaks: true })); } catch (e) { } return s.replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }).replace(/\n/g, '<br>'); }
  function foldCode(html) { if (!html) return html; return html.replace(/<pre>/g, '<details class="code-fold"><summary>⟨⟩ Code — expand / collapse</summary><pre>').replace(/<\/pre>/g, '</pre></details>'); }
  // Split live-activity frames (␟{"s":…}␟, emitted by claude-session during web search) out of the streamed answer text.
  function parseStatus(acc) {
    var s = String(acc || ''); if (s.indexOf('␟') < 0) return { statuses: [], text: s };
    var statuses = [], re = /␟([\s\S]*?)␟/g, m;
    while ((m = re.exec(s))) { try { var o = JSON.parse(m[1]); if (o && o.s) statuses.push(String(o.s)); } catch (e) { } }
    var text = s.replace(/␟[\s\S]*?␟/g, '');            // drop complete frames
    var lone = text.lastIndexOf('␟'); if (lone >= 0) text = text.slice(0, lone);   // hide a half-arrived trailing frame
    return { statuses: statuses, text: text };
  }
  var SUGGEST = ['Explain Fisher information simply.', 'Write a short research abstract on OOD detection.', 'Give me 5 ideas for a dissertation chapter.', 'Help me structure a presentation.'];

  function App() {
    var phS = useState('loading'), phase = phS[0], setPhase = phS[1];
    var meS = useState(null), me = meS[0], setMe = meS[1];
    var chS = useState([]), chats = chS[0], setChats = chS[1];
    var cidS = useState(null), cid = cidS[0], setCid = cidS[1];
    var mgS = useState([]), msgs = mgS[0], setMsgs = mgS[1];
    var inS = useState(''), input = inS[0], setInput = inS[1];
    var bzS = useState(false), busy = bzS[0], setBusy = bzS[1];
    var stS = useState(null), streaming = stS[0], setStreaming = stS[1];
    var wfS = useState(false), wf = wfS[0], setWf = wfS[1];               // workflow (agentic) mode toggle
    var cwS = useState(false), canWf = cwS[0], setCanWf = cwS[1];         // admin-granted permission
    var wbS = useState(function () { try { return localStorage.getItem('pr-session-web') === '1'; } catch (e) { return false; } }), webOn = wbS[0], setWebOn = wbS[1];   // 🌐 web search (Anthropic tool, entitlement-gated server-side)
    function toggleWeb() { setWebOn(function (v) { var n = !v; try { localStorage.setItem('pr-session-web', n ? '1' : '0'); } catch (e) { } return n; }); }
    var amS = useState(function () { try { return localStorage.getItem('pr-session-agents') === '1'; } catch (e) { return false; } }), agentMode = amS[0], setAgentMode = amS[1];   // 🤖 multi-agent swarm
    var caS = useState(false), canAgents = caS[0], setCanAgents = caS[1];   // entitlement (research_agents; admin bypasses)
    function toggleAgents() { setAgentMode(function (v) { var n = !v; try { localStorage.setItem('pr-session-agents', n ? '1' : '0'); } catch (e) { } return n; }); }
    var flS = useState([]), files = flS[0], setFiles = flS[1];           // user_chat_files for the current chat
    var pvS = useState(null), preview = pvS[0], setPreview = pvS[1];
    var atS = useState(false), atOpen = atS[0], setAtOpen = atS[1];        // attach menu open
    var pkS = useState(null), picker = pkS[0], setPicker = pkS[1];         // {kind, items} for the browse pickers
    var dgS = useState(false), dragOver = dgS[0], setDragOver = dgS[1];
    var soS = useState(false), sideOpen = soS[0], setSideOpen = soS[1];     // mobile history drawer
    var hlS = useState(true), histLoading = hlS[0], setHistLoading = hlS[1];   // true until the first chat list resolves
    var alive = useRef(true), scrollRef = useRef(null), taRef = useRef(null), fileRef = useRef(null), abortRef = useRef(null), stopReq = useRef(false);
    useEffect(function () { return function () { alive.current = false; }; }, []);
    useEffect(function () { boot(); }, []);

    function boot() {
      if (!BE || !BE.sb) { setPhase('nobackend'); return; }
      if (BE.mode === 'signin' || BE.mode === 'pending') { setPhase('signin'); return; }
      if (BE.mode !== 'cloud' || !BE.user) { setPhase('demo'); return; }
      setMe({ id: BE.user.id, name: BE.user.name, email: BE.user.email });
      // wait for supabase-js to attach the restored session JWT before any RLS-scoped read, else the first
      // loadChats runs anon and comes back empty (the session is loaded asynchronously after createClient)
      sb.auth.getSession().then(function () {
        sb.from('profiles').select('can_workflows').eq('id', BE.user.id).maybeSingle().then(function (r) { setCanWf(!!(r && r.data && r.data.can_workflows)); });
        sb.rpc('is_feature_enabled', { p_key: 'research_agents' }).then(function (r) { setCanAgents(!!(r && r.data)); }, function () { });
        loadChats(function (list) { if (list && list.length) openChat(list[0].id); setPhase('ready'); });
      }, function () { setHistLoading(false); setPhase('ready'); });
    }
    function loadChats(done) { sb.from('user_chats').select('id,title,updated_at').order('updated_at', { ascending: false }).then(function (r) { var list = (r && r.data) || []; setChats(list); setHistLoading(false); if (done) done(list); }, function () { setHistLoading(false); }); }
    function loadMsgs(id) { sb.from('user_chat_messages').select('id,role,content,created_at').eq('chat_id', id).order('created_at', { ascending: true }).then(function (r) { setMsgs((r && r.data) || []); }); }
    function loadFiles(id) { if (!id) { setFiles([]); return; } sb.from('user_chat_files').select('id,path,content').eq('chat_id', id).order('path', { ascending: true }).then(function (r) { setFiles((r && r.data) || []); }); }
    function openChat(id) { setCid(id); setStreaming(null); setPreview(null); setSideOpen(false); loadMsgs(id); loadFiles(id); }
    function newChat() { setCid(null); setMsgs([]); setStreaming(null); setFiles([]); setPreview(null); setSideOpen(false); if (taRef.current) taRef.current.focus(); }
    function delChat(id, e) { e.stopPropagation(); window.PRUI.confirm({ title: 'Delete this conversation?', danger: true, confirmLabel: 'Delete' }).then(function (ok) { if (!ok) return; sb.from('user_chats').delete().eq('id', id).then(function () { if (cid === id) { setCid(null); setMsgs([]); } loadChats(); }); }); }

    useEffect(function () { var el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; }, [msgs.length, streaming]);

    function ensureChat(firstMsg) {
      if (cid) return Promise.resolve(cid);
      var title = (firstMsg || 'New conversation').slice(0, 60);
      return sb.from('user_chats').insert({ owner_id: me.id, title: title }).select('id').maybeSingle().then(function (r) { var id = r && r.data && r.data.id; setCid(id); loadChats(); return id; });
    }
    // Stop an in-flight stream / workflow (the ■ button)
    function stop() { stopReq.current = true; if (abortRef.current) { try { abortRef.current.abort(); } catch (e) { } abortRef.current = null; } setStreaming(null); setBusy(false); }
    function streamReply(id) {
      sb.auth.getSession().then(function (s) {
        if (stopReq.current) { stopReq.current = false; setBusy(false); return; }   // Stop pressed before the request went out
        var token = (s && s.data && s.data.session && s.data.session.access_token) || CFG.supabaseAnonKey;
        var ac = new AbortController(); abortRef.current = ac;
        fetch(CFG.supabaseUrl + '/functions/v1/claude-session', { method: 'POST', headers: { 'Content-Type': 'application/json', 'apikey': CFG.supabaseAnonKey, 'Authorization': 'Bearer ' + token }, body: JSON.stringify({ chat_id: id, stream: true, web: webOn }), signal: ac.signal }).then(function (resp) {
          if (!resp.ok || !resp.body || !resp.body.getReader) { abortRef.current = null; setBusy(false); return; }
          var reader = resp.body.getReader(), dec = new TextDecoder(), acc = '';
          setStreaming({ text: '' });
          (function pump() { reader.read().then(function (r) { if (!alive.current) return; if (r.done) { abortRef.current = null; setStreaming(null); setBusy(false); loadMsgs(id); loadChats(); return; } acc += dec.decode(r.value, { stream: true }); var ps = parseStatus(acc); setStreaming({ text: ps.text, statuses: ps.statuses }); pump(); }, function () { abortRef.current = null; setStreaming(null); setBusy(false); loadMsgs(id); }); })();
        }, function () { abortRef.current = null; setBusy(false); });
      });
    }
    // workflow (agentic) run: Publify works multi-step with file tools, then we reload the chat + files
    function runWorkflow(id) {
      sb.auth.getSession().then(function (s) {
        if (stopReq.current) { stopReq.current = false; setBusy(false); return; }
        var token = (s && s.data && s.data.session && s.data.session.access_token) || CFG.supabaseAnonKey;
        var ac = new AbortController(); abortRef.current = ac;
        fetch(CFG.supabaseUrl + '/functions/v1/claude-session', { method: 'POST', headers: { 'Content-Type': 'application/json', 'apikey': CFG.supabaseAnonKey, 'Authorization': 'Bearer ' + token }, body: JSON.stringify({ chat_id: id, mode: 'workflow' }), signal: ac.signal })
          .then(function (r) { return r.json(); })
          .then(function () { if (!alive.current) return; abortRef.current = null; setBusy(false); loadMsgs(id); loadChats(); loadFiles(id); }, function () { abortRef.current = null; setBusy(false); });
      });
    }
    // 🤖 multi-agent swarm: Planner → Workers → Reviewer → Synthesizer, with LIVE per-agent lanes (NDJSON), like the Research Idea Chat.
    function runAgents(id) {
      sb.auth.getSession().then(function (s) {
        if (stopReq.current) { stopReq.current = false; setBusy(false); return; }
        var token = (s && s.data && s.data.session && s.data.session.access_token) || CFG.supabaseAnonKey;
        var ac = new AbortController(); abortRef.current = ac;
        fetch(CFG.supabaseUrl + '/functions/v1/claude-session', { method: 'POST', headers: { 'Content-Type': 'application/json', 'apikey': CFG.supabaseAnonKey, 'Authorization': 'Bearer ' + token }, body: JSON.stringify({ chat_id: id, mode: 'agents', web: webOn }), signal: ac.signal }).then(function (resp) {
          if (!resp.ok || !resp.body || !resp.body.getReader) { abortRef.current = null; setStreaming(null); setBusy(false); try { window.PRUI.toast('Ágens-mód nem elérhető — nincs hozzá jogosultságod (research_agents), vagy hiba történt.', { kind: 'warn' }); } catch (e) { } return; }
          var reader = resp.body.getReader(), dec = new TextDecoder(), buf = '', answer = '';
          var lanes = [{ id: 'plan', role: 'planner', label: 'Tervezés', state: 'run', status: '' }], laneById = { plan: lanes[0] };
          function upd() { setStreaming({ text: answer, lanes: lanes.slice() }); }
          upd();
          (function pump() {
            reader.read().then(function (r) {
              if (!alive.current) return;
              if (r.done) { abortRef.current = null; setStreaming(null); setBusy(false); loadMsgs(id); loadChats(); return; }
              buf += dec.decode(r.value, { stream: true });
              var nl;
              while ((nl = buf.indexOf('\n')) >= 0) {
                var line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
                if (!line) continue;
                var ev; try { ev = JSON.parse(line); } catch (e) { continue; }
                if (ev.t === 'plan' && Array.isArray(ev.items)) {
                  if (laneById.plan) laneById.plan.state = 'done';
                  lanes = [laneById.plan].concat(ev.items.map(function (it) { return { id: it.id, role: it.role, label: it.label, state: 'wait', status: '' }; }));
                  laneById = {}; lanes.forEach(function (l) { laneById[l.id] = l; }); upd();
                } else if (ev.t === 'start') { var la = laneById[ev.a]; if (la) { la.state = 'run'; upd(); } }
                else if (ev.t === 'status') { var lb = laneById[ev.a]; if (lb) { lb.state = 'run'; lb.status = ev.s || ''; upd(); } }
                else if (ev.t === 'done') { var lc = laneById[ev.a]; if (lc) { lc.state = 'done'; lc.status = ev.s || lc.status; upd(); } }
                else if (ev.t === 'tok') { answer += (ev.d || ''); upd(); }
                else if (ev.t === 'err') { try { window.PRUI.toast('Ágens-hiba: ' + (ev.m || 'ismeretlen'), { kind: 'warn' }); } catch (e) { } }
              }
              pump();
            }, function (e) { if (e && e.name === 'AbortError') return; abortRef.current = null; setStreaming(null); setBusy(false); loadMsgs(id); });
          })();
        }, function (e) { if (e && e.name === 'AbortError') return; abortRef.current = null; setBusy(false); });
      });
    }
    function sendText(raw) {
      var txt = (raw || '').trim(); if (!txt || busy) return;
      stopReq.current = false; setBusy(true); setInput(''); if (taRef.current) taRef.current.style.height = 'auto';
      ensureChat(txt).then(function (id) {
        if (!id) { setBusy(false); return; }
        sb.from('user_chat_messages').insert({ chat_id: id, role: 'user', content: txt }).then(function () { loadMsgs(id); if (agentMode && canAgents) runAgents(id); else if (wf) runWorkflow(id); else streamReply(id); });
      });
    }
    function send() { sendText(input); }
    function onKey(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }
    function onInput(e) { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px'; }
    function copy(m) { try { navigator.clipboard.writeText(m.content || ''); } catch (e) { } }

    // ---- attachments: file uploads + browse LaTeX/research projects + publications.
    // Everything lands as a row in user_chat_files; the Edge injects them into Publify's context. ----
    useEffect(function () { if (!atOpen) return; var c = function (e) { if (!e.target.closest('.attach-wrap')) setAtOpen(false); }; document.addEventListener('mousedown', c); return function () { document.removeEventListener('mousedown', c); }; }, [atOpen]);
    function attachText(path, content, source) {
      if (!content) return Promise.resolve();
      return ensureChat(path).then(function (id) { if (!id) return;
        return sb.from('user_chat_files').upsert({ chat_id: id, path: String(path).slice(0, 200), content: String(content).slice(0, 200000), source: source || 'upload', updated_at: new Date().toISOString() }, { onConflict: 'chat_id,path' }).then(function () { loadFiles(id); loadChats(); });
      });
    }
    function isTextFile(f) { return /^text\//.test(f.type || '') || /\.(txt|md|markdown|tex|bib|cls|sty|csv|tsv|json|ya?ml|js|ts|jsx|tsx|py|r|html?|css|log|bbl)$/i.test(f.name || ''); }
    function isPdf(f) { return /^application\/pdf$/i.test(f.type || '') || /\.pdf$/i.test(f.name || ''); }
    function isImage(f) { return /^image\//i.test(f.type || '') || /\.(png|jpe?g|gif|webp)$/i.test(f.name || ''); }
    // PDF → text via pdf.js (loaded in Session.html).
    function extractPdf(file) {
      if (!window.pdfjsLib) return Promise.resolve('(The PDF reader did not load.)');
      return file.arrayBuffer().then(function (buf) {
        return window.pdfjsLib.getDocument({ data: buf }).promise.then(function (pdf) {
          var pages = [], seq = Promise.resolve();
          for (var i = 1; i <= pdf.numPages; i++) { (function (n) { seq = seq.then(function () { return pdf.getPage(n).then(function (pg) { return pg.getTextContent().then(function (tc) { pages.push(tc.items.map(function (it) { return it.str; }).join(' ')); }); }); }); })(i); }
          return seq.then(function () { return pages.join('\n\n').trim() || '(No text could be extracted from the PDF — it may be scanned.)'; });
        });
      }).catch(function (e) { return '(PDF extraction error: ' + e + ')'; });
    }
    // Image → downscaled data URL (so the vision API gets a reasonable payload).
    function downscaleImage(file) {
      return new Promise(function (resolve) {
        var url = URL.createObjectURL(file), img = new Image();
        img.onload = function () { var max = 1280, w = img.naturalWidth, ht = img.naturalHeight, s = Math.min(1, max / Math.max(w, ht)); var c = document.createElement('canvas'); c.width = Math.round(w * s); c.height = Math.round(ht * s); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); try { resolve(c.toDataURL(/png/i.test(file.type) ? 'image/png' : 'image/jpeg', 0.82)); } catch (e) { resolve(null); } };
        img.onerror = function () { URL.revokeObjectURL(url); resolve(null); };
        img.src = url;
      });
    }
    function attachImage(path, dataUrl) {
      if (!dataUrl) return Promise.resolve();
      return ensureChat(path).then(function (id) { if (!id) return;
        return sb.from('user_chat_files').upsert({ chat_id: id, path: String(path).slice(0, 200), content: dataUrl, source: 'image', updated_at: new Date().toISOString() }, { onConflict: 'chat_id,path' }).then(function () { loadFiles(id); loadChats(); });
      });
    }
    function doUpload(fileList) {
      var arr = Array.prototype.slice.call(fileList || []); if (!arr.length) return;
      var skipped = 0;
      arr.reduce(function (chain, f) {
        return chain.then(function () {
          if (isTextFile(f)) return f.text().then(function (t) { return attachText(f.name, t, 'upload'); });
          if (isPdf(f)) return extractPdf(f).then(function (t) { return attachText(f.name + ' (PDF)', t, 'pdf'); });
          if (isImage(f)) return downscaleImage(f).then(function (d) { return attachImage(f.name, d); });
          if (window.PROffice && window.PROffice.isOffice(f.name)) return window.PROffice.extract(f).then(function (r) { return attachText(f.name + ' (Office)', r.text || '', 'upload'); }, function () { skipped++; });
          skipped++; return null;
        });
      }, Promise.resolve()).then(function () { if (skipped) window.PRUI.toast(skipped + ' file(s) skipped (unsupported type — text, PDF and images can be attached).', { kind: 'warn' }); });
    }
    function onPickedFiles(e) { doUpload(e.target.files); e.target.value = ''; }
    function pickFiles() { setAtOpen(false); if (fileRef.current) fileRef.current.click(); }
    function onDrop(e) { e.preventDefault(); setDragOver(false); if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) doUpload(e.dataTransfer.files); }
    function openPicker(kind) {
      setAtOpen(false);
      setPicker({ kind: kind, items: null });
      // LaTeX/research pickers are RLS-scoped (you only see your own + shared projects).
      if (kind === 'latex') sb.from('projects').select('id,title').is('deleted_at', null).order('updated_at', { ascending: false }).then(function (r) { setPicker({ kind: kind, items: (r && r.data) || [] }); });
      else if (kind === 'research') sb.from('research_projects').select('id,title,field,goal,keywords,status,stage').order('updated_at', { ascending: false }).then(function (r) { setPicker({ kind: kind, items: (r && r.data) || [] }); });
      // Publications: only YOUR OWN (publications are world-readable, so scope on the client to your researcher id).
      else if (kind === 'pub') sb.from('publications').select('id,title,year,journal,first_author,citation,doi').eq('researcher_id', me.id).order('year', { ascending: false }).limit(500).then(function (r) { setPicker({ kind: kind, items: (r && r.data) || [] }); });
    }
    function attachLatex(p) {
      setPicker(null);
      sb.from('projects').select('data').eq('id', p.id).maybeSingle().then(function (r) {
        var data = r && r.data && r.data.data, files = (data && data.files) || {}, out = [];
        Object.keys(files).forEach(function (k) { if (/\.(tex|md|txt)$/i.test(k)) { var c = files[k] && files[k].content; if (c) out.push('% ===== ' + k + ' =====\n' + c); } });
        attachText('LaTeX: ' + (p.title || 'project'), out.join('\n\n').slice(0, 150000) || '(no textual .tex content)', 'project');
      });
    }
    function attachResearch(p) {
      setPicker(null);
      var body = 'Research project: ' + (p.title || '') + '\n' + (p.field ? 'Field: ' + p.field + '\n' : '') + (p.goal ? 'Goal: ' + p.goal + '\n' : '') + (p.keywords && p.keywords.length ? 'Keywords: ' + p.keywords.join(', ') + '\n' : '') + 'Status: ' + (p.status || '') + ' · phase ' + (p.stage || 0) + '/7';
      attachText('Research: ' + (p.title || 'project'), body, 'project');
    }
    function attachPub(p) {
      setPicker(null);
      var body = (p.title || '') + (p.year ? ' (' + p.year + ')' : '') + '\n' + (p.first_author ? 'Author: ' + p.first_author + '\n' : '') + (p.journal ? 'Journal: ' + p.journal + '\n' : '') + (p.doi ? 'DOI: ' + p.doi + '\n' : '') + (p.citation ? '\n' + p.citation : '');
      attachText('Publication: ' + String(p.title || 'publication').slice(0, 70), body, 'publication');
    }
    function removeFile(f, e) { e.stopPropagation(); sb.from('user_chat_files').delete().eq('id', f.id).then(function () { loadFiles(cid); }); }

    if (phase === 'loading') return h('div', { className: 'center' }, 'Loading…');
    if (phase === 'nobackend') return h('div', { className: 'center' }, 'The cloud backend is unavailable.');
    if (phase === 'signin') return null;
    if (phase === 'demo') return h('div', { className: 'center' }, h('div', null, h('h1', null, 'Sign in'), h('p', null, 'Publify chat requires your account.'), h('button', { className: 'newchat', style: { display: 'inline-flex', marginTop: 12 }, onClick: function () { try { localStorage.removeItem('proofreader:mode'); } catch (e) { } location.reload(); } }, 'Sign in')));

    var side = h('div', { className: 'side' },
      h('div', { className: 'side-brand' }, h('div', { className: 'mk' }, h('span')), h('div', null, h('b', null, 'Publify'), h('i', null, 'Chat with Publify'))),
      h('button', { className: 'newchat', 'aria-label': 'New conversation', onClick: newChat }, h('span', { 'aria-hidden': 'true' }, '➕'), '  New conversation'),
      h('div', { className: 'hist-h' }, 'History'),
      h('div', { className: 'hist', role: 'list' }, histLoading ? [0, 1, 2, 3, 4].map(function (i) {
        return h('div', { className: 'pr-skel pr-skel-row', key: 'sk' + i, 'aria-hidden': 'true', style: { margin: '7px 9px' } });
      }) : chats.length ? chats.map(function (c) {
        return h('div', { className: 'hist-item' + (c.id === cid ? ' on' : ''), role: 'listitem', key: c.id, onClick: function () { openChat(c.id); } },
          h('span', { className: 'ht' }, c.title || 'Conversation'),
          h('button', { className: 'hx', title: 'Delete', 'aria-label': 'Delete conversation', onClick: function (e) { delChat(c.id, e); } }, '×'));
      }) : h('div', { style: { fontSize: 12.5, color: 'var(--faint)', padding: '8px 9px' } }, 'No conversations yet.')),
      h('div', { className: 'side-foot' }, h('span', null, me.name || me.email), h('a', { href: 'Projects.html', title: 'Back' }, '← Publify'))
    );

    var conv = (msgs.length || streaming || busy) ? h('div', { className: 'conv', ref: scrollRef }, h('div', { className: 'wrap' },
      msgs.map(function (m) {
        var ai = m.role === 'assistant';
        return h('div', { key: m.id, className: 'bubble ' + (ai ? 'ai' : 'user') },
          ai ? h('div', { className: 'btxt md', dangerouslySetInnerHTML: { __html: foldCode(mdHtml(m.content)) } }) : h('div', { className: 'btxt' }, m.content),
          ai ? h('div', { className: 'bmeta' }, h('button', { 'aria-label': 'Copy message', onClick: function () { copy(m); } }, 'Copy')) : null);
      }),
      streaming ? (function () {
        var sts = streaming.statuses || [], live = streaming.text || '', lanes = streaming.lanes || null;   // lanes = 🤖 agent-mode per-agent live rows
        var laneIc = function (role) { return role === 'researcher' ? '🔬' : role === 'reviewer' ? '🧐' : role === 'synth' ? '🧩' : role === 'planner' ? '🧭' : '•'; };
        return h('div', { className: 'bubble ai', key: 'stream', 'aria-live': 'polite' },
          (lanes && lanes.length) ? h('div', { className: 'pr-agents', style: { marginBottom: live ? 8 : 0 } }, lanes.map(function (l) {
            return h('div', { key: l.id, className: 'pr-lane ' + l.state },
              h('span', { className: 'pr-lane-ic' }, laneIc(l.role)),
              h('span', { className: 'pr-lane-lab' }, l.label),
              l.state === 'run' ? h('span', { className: 'pr-spin' }) : l.state === 'done' ? h('span', { className: 'pr-lane-ok' }, '✓') : h('span', { className: 'pr-lane-wait' }, '…'),
              l.status ? h('span', { className: 'pr-lane-st' }, l.status) : null);
          }))
            : (sts.length ? h('div', { className: 'act-strip' }, sts.map(function (s, i) {
              var isCur = (i === sts.length - 1) && !live;   // the newest status is "current" only while no answer text has arrived yet
              return h('div', { key: i, className: 'pr-actrow ' + (isCur ? 'cur' : 'done') }, isCur ? h('span', { className: 'pr-spin' }) : h('span', null, '✓'), h('span', null, s));
            })) : null),
          h('div', { className: 'btxt' }, live || ((sts.length || (lanes && lanes.length)) ? null : h('span', { style: { color: 'var(--faint)' } }, 'Publify is thinking…')), h('span', { className: 'tw-cursor', 'aria-hidden': 'true' }, '▌')));
      })()
        : busy ? h('div', { className: 'bubble ai', 'aria-live': 'polite' }, h('div', { className: 'btxt', style: { color: 'var(--faint)' } },
          h('div', null, wf ? '🛠 Publify is working on the task (multiple steps, with files)…' : 'Publify is thinking…'),
          h('div', { className: 'pr-bar indet', style: { marginTop: 8 }, role: 'progressbar', 'aria-label': wf ? 'Workflow run in progress' : 'Generating reply' }, h('i')))) : null
    )) : h('div', { className: 'empty' }, h('h1', null, 'How can I help?'), h('p', null, 'Ask Publify — ask anything about your research; attach files, LaTeX/research projects or publications (📎).'),
      h('div', { className: 'suggest' }, SUGGEST.map(function (s, i) { return h('button', { key: i, onClick: function () { sendText(s); } }, s); })));

    var curTitle = (cid && (chats.filter(function (c) { return c.id === cid; })[0] || {}).title) || 'New conversation';
    var main = h('div', { className: 'main', onDragOver: function (e) { e.preventDefault(); if (!dragOver) setDragOver(true); }, onDragLeave: function (e) { if (e.target === e.currentTarget) setDragOver(false); }, onDrop: onDrop },
      h('div', { className: 'topbar' }, h('button', { className: 'side-toggle', 'aria-label': 'Conversations', onClick: function () { setSideOpen(true); } }, '☰'), h('span', null, curTitle), h('span', { className: 'mtag' }, wf ? '🛠 Workflow' : 'Publify')),
      (cid && files.length) ? h('div', { className: 'files-strip' }, h('span', { className: 'fs-h' }, '🗂 Attached:'), files.map(function (f) { return h('span', { className: 'fs-chip', key: f.id },
        h('button', { className: 'fs-name', title: 'Preview', 'aria-label': 'Preview attachment', onClick: function () { setPreview(f); } }, f.path),
        h('button', { className: 'fs-x', title: 'Remove', 'aria-label': 'Remove attachment', onClick: function (e) { removeFile(f, e); } }, '×')); })) : null,
      conv,
      h('div', { className: 'composer' },
        h('div', { className: 'wf-row' },
          h('button', { className: 'wf-toggle' + (webOn ? ' on' : ''), 'aria-pressed': webOn, 'aria-label': 'Web search', disabled: busy, title: 'Webkeresés — a modell valós idejű internetes forrásokból is meríthet és idézi őket (a modell dönti el, mikor keres). Jogosultsághoz kötött.', onClick: toggleWeb }, webOn ? '🌐 Web: BE' : '🌐 Web: KI'),
          canAgents ? h('button', { className: 'wf-toggle' + (agentMode ? ' on' : ''), 'aria-pressed': agentMode, 'aria-label': 'Agent mode', disabled: busy, title: 'Ágens-mód — egy kis ügynök-raj (tervező → kutatók → értékelő → szintézis) dolgozik a feladaton, élő státusszal minden ágensről. Költségesebb (több modellhívás).', onClick: toggleAgents }, agentMode ? '🤖 Ágensek: BE' : '🤖 Ágensek: KI') : null,
          canWf ? h('button', { className: 'wf-toggle' + (wf ? ' on' : ''), 'aria-pressed': wf, 'aria-label': 'Workflow mode', onClick: function () { setWf(!wf); } }, '🛠 Workflow mode: ' + (wf ? 'ON' : 'OFF')) : null,
          h('span', { className: 'wf-hint' }, (agentMode && canAgents) ? 'Egy ügynök-raj dolgozik a kérdéseden — élőben látod, melyik ágens mit csinál.' : webOn ? 'A bot valós idejű webforrásokból is meríthet, idézetekkel.' : (canWf && wf ? 'Publify solves a task in multiple steps, with files.' : 'Kapcsold be a webkeresést a friss, hivatkozott válaszokhoz.'))),
        h('div', { className: 'composer-in' },
          h('div', { className: 'attach-wrap' },
            h('button', { className: 'attach-btn', title: 'Attach', 'aria-label': 'Attach', 'aria-haspopup': 'true', 'aria-expanded': atOpen, disabled: busy, onClick: function () { setAtOpen(!atOpen); } }, '📎'),
            atOpen ? h('div', { className: 'attach-menu', role: 'menu', onKeyDown: function (e) { if (e.key === 'Escape') setAtOpen(false); } },
              h('button', { role: 'menuitem', onClick: pickFiles }, h('span', { 'aria-hidden': 'true' }, '📄'), '  Upload file'),
              h('button', { role: 'menuitem', onClick: function () { openPicker('latex'); } }, h('span', { 'aria-hidden': 'true' }, '📐'), '  LaTeX project'),
              h('button', { role: 'menuitem', onClick: function () { openPicker('research'); } }, h('span', { 'aria-hidden': 'true' }, '🔬'), '  Research project'),
              h('button', { role: 'menuitem', onClick: function () { openPicker('pub'); } }, h('span', { 'aria-hidden': 'true' }, '📚'), '  Publication')) : null),
          h('textarea', { ref: taRef, value: input, rows: 1, 'aria-label': 'Message Publify', placeholder: wf ? 'Describe the task — Publify will solve it in multiple steps…' : 'Message Publify…  (Enter = send · Shift+Enter = new line)', disabled: busy, onChange: onInput, onKeyDown: onKey }),
          busy
            ? h('button', { className: 'send-btn', 'aria-label': 'Stop', title: 'Stop', onClick: stop }, '■')
            : h('button', { className: 'send-btn', 'aria-label': 'Send message', disabled: !input.trim(), onClick: send }, '↑'))),
      dragOver ? h('div', { className: 'drop-ov' }, h('div', { className: 'drop-card' }, '📎 Drop files here to attach')) : null
    );

    return h('div', { className: 'app' + (sideOpen ? ' side-open' : '') },
      sideOpen ? h('div', { className: 'side-scrim', onClick: function () { setSideOpen(false); } }) : null,
      side, main,
      h('input', { ref: fileRef, type: 'file', multiple: true, style: { display: 'none' }, onChange: onPickedFiles }),
      preview ? h('div', { className: 'pv-scrim', onClick: function () { setPreview(null); }, onKeyDown: function (e) { if (e.key === 'Escape') setPreview(null); } }, h('div', { className: 'pv-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'File preview', tabIndex: -1, onClick: function (e) { e.stopPropagation(); } },
        h('div', { className: 'pv-head' }, h('b', null, preview.path), h('button', { className: 'pv-x', 'aria-label': 'Close', onClick: function () { setPreview(null); } }, '×')),
        (preview.content && /^data:image\//.test(preview.content))
          ? h('div', { className: 'pv-body', style: { textAlign: 'center' } }, h('img', { src: preview.content, style: { maxWidth: '100%', borderRadius: 8 } }))
          : h('div', { className: 'btxt md pv-body', dangerouslySetInnerHTML: { __html: foldCode(mdHtml(preview.content || '')) } }))) : null,
      picker ? h('div', { className: 'pv-scrim', onClick: function () { setPicker(null); }, onKeyDown: function (e) { if (e.key === 'Escape') setPicker(null); } }, h('div', { className: 'pv-modal pick-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Attach picker', tabIndex: -1, onClick: function (e) { e.stopPropagation(); } },
        h('div', { className: 'pv-head' }, h('b', null, picker.kind === 'latex' ? '📐 LaTeX projects' : picker.kind === 'research' ? '🔬 Research projects' : '📚 Publications'), h('button', { className: 'pv-x', 'aria-label': 'Close', onClick: function () { setPicker(null); } }, '×')),
        h('div', { className: 'pick-body' },
          picker.items == null ? h('div', { className: 'pick-empty' }, 'Loading…')
            : !picker.items.length ? h('div', { className: 'pick-empty' }, 'No items available.')
              : picker.items.map(function (it) {
                var label = (it.title || '(untitled)') + (picker.kind === 'pub' && it.year ? ' (' + it.year + ')' : '');
                var sub = picker.kind === 'latex' ? 'LaTeX project' : picker.kind === 'research' ? (it.field || 'research project') : (it.journal || it.first_author || '');
                return h('button', { className: 'pick-item', key: it.id, onClick: function () { if (picker.kind === 'latex') attachLatex(it); else if (picker.kind === 'research') attachResearch(it); else attachPub(it); } }, h('b', null, label), sub ? h('small', null, sub) : null);
              })))) : null);
  }

  ReactDOM.createRoot(document.getElementById('root')).render(h(App));
})();
