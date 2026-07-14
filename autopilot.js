/* Publify — Autopilot (Autopilot.html).
 * A chat-first belépő: (1) Launcher — nagy kutatási-irány input + starter-kártyák + dropzone → valós
 * research_projects sor + chat; (2) Brief — valós streamelő AI-beszélgetés (research-chat) + élő brief-panel,
 * ami a projekt tényleges állapotát tükrözi (cél, kulcsszavak, feltöltött fájlok, ötletek); (3) Indítás —
 * tisztázó inputok (venue-szint, max cikk, fázisok, emberi gate) → a brief perzisztálódik és a projekt
 * megnyílik a Research munkaterületen. A teljes automatikus fázis-futtató (orchestrator) egy későbbi lépés.
 * A chat-szerződés megegyezik a research.jsx ChatPanel-jével (research_messages insert → research-chat SSE stream). */
(function () {
  'use strict';
  var BE = window.PR_BACKEND, sb = BE && BE.sb, CFG = window.PR_CONFIG || {};
  var h = React.createElement;
  var useState = React.useState, useEffect = React.useEffect, useRef = React.useRef;
  var root = document.getElementById('root');

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (x) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[x]; }); }
  function mdSafe(md) { try { return DOMPurify.sanitize(marked.parse(String(md || ''))); } catch (e) { return esc(md || ''); } }
  function nowIso() { return new Date().toISOString(); }
  function uid() { return (BE.user && BE.user.id) || null; }
  function fmtSize(n) { n = +n || 0; return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB'; }
  function deriveTitle(text) {
    var t = String(text || '').trim().replace(/\s+/g, ' ');
    if (!t) return 'Új kutatás';
    var firstSentence = t.split(/[.?!]\s/)[0];
    if (firstSentence.length <= 70) return firstSentence;
    return t.split(' ').slice(0, 9).join(' ').slice(0, 70).trim() + '…';
  }
  var TEXT_RE = /\.(txt|md|markdown|csv|tsv|json|bib|tex|py|js|ts|jsx|r|yaml|yml|log|html|xml)$/i;
  function isTextFile(f) { return TEXT_RE.test(f.name || '') || /^text\//.test(f.type || '') || f.type === 'application/json'; }
  function readStaged(fileList) {
    // read text-like files' content (capped); binary files keep name/size only (content extracted later in the workspace)
    var arr = [].slice.call(fileList || []);
    return Promise.all(arr.map(function (f) {
      var base = { name: f.name, size: f.size, mime: f.type || 'application/octet-stream', content: '' };
      if (!isTextFile(f) || f.size > 400 * 1024) return Promise.resolve(base);
      return new Promise(function (res) {
        var rd = new FileReader();
        rd.onload = function () { base.content = String(rd.result || '').slice(0, 400 * 1024); if (base.mime === 'application/octet-stream') base.mime = 'text/plain'; res(base); };
        rd.onerror = function () { res(base); };
        rd.readAsText(f);
      });
    }));
  }

  function toast(msg, ok) {
    var t = document.createElement('div'); t.className = 'ap-toast' + (ok === false ? ' err' : ''); t.textContent = msg;
    document.body.appendChild(t); requestAnimationFrame(function () { t.classList.add('show'); });
    setTimeout(function () { t.classList.remove('show'); setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 260); }, 2600);
  }

  // ---- shared: upload staged files into research_files (real rows, visible in the workspace file browser) ----
  function uploadFiles(pid, staged) {
    if (!staged || !staged.length) return Promise.resolve([]);
    var u = uid();
    return Promise.all(staged.map(function (f) {
      var path = 'uploads/' + f.name;
      return sb.from('research_files').upsert({
        project_id: pid, path: path, content: f.content || '', mime: f.mime || 'text/plain',
        size: f.size || (f.content || '').length, source: 'upload', created_by: u, updated_by: u, updated_at: nowIso()
      }, { onConflict: 'project_id,path' }).then(function (r) { return { name: f.name, size: f.size, path: path, mime: f.mime, ok: !(r && r.error), err: r && r.error && r.error.message }; });
    }));
  }
  function loadFiles(pid) {
    return sb.from('research_files').select('path,size,mime').eq('project_id', pid).like('path', 'uploads/%').order('path').then(function (r) {
      return ((r && r.data) || []).map(function (x) { return { name: String(x.path).replace(/^uploads\//, ''), size: x.size, path: x.path, mime: x.mime }; });
    });
  }

  // ======================================================================= CHAT
  function Chat(props) {
    var mS = useState([]), msgs = mS[0], setMsgs = mS[1];
    var stS = useState(null), streaming = stS[0], setStreaming = stS[1];
    var bS = useState(false), busy = bS[0], setBusy = bS[1];
    var iS = useState(''), input = iS[0], setInput = iS[1];
    var eS = useState(''), err = eS[0], setErr = eS[1];
    var alive = useRef(true), scrollRef = useRef(null), taRef = useRef(null), autoStreamed = useRef(false), atBottom = useRef(true), streamingRef = useRef(false);
    useEffect(function () { return function () { alive.current = false; }; }, []);

    // loadMsgs is side-effect-free (fetch + setMsgs only) — the seed-reply decision lives in the mount effect,
    // so it can never double-fire alongside the explicit streamReply() in sendText/onFile.
    function loadMsgs(cid) {
      return sb.from('research_messages').select('id,role,content,created_at').eq('chat_id', cid).order('created_at', { ascending: true }).then(function (r) {
        var data = (r && r.data) || []; setMsgs(data); return data;
      });
    }
    useEffect(function () {
      if (!props.chatId) return;
      loadMsgs(props.chatId).then(function (data) {
        // seed reply: the newest persisted message is the user's opener with no AI answer yet → stream one reply (once per mount)
        var last = data[data.length - 1];
        if (!autoStreamed.current && last && last.role === 'user') { autoStreamed.current = true; streamReply(props.chatId); }
      });
    }, [props.chatId]);
    useEffect(function () { var el = scrollRef.current; if (el && atBottom.current) el.scrollTop = el.scrollHeight; }, [msgs.length, streaming, busy]);
    function onScroll() { var el = scrollRef.current; if (!el) return; atBottom.current = (el.scrollHeight - el.scrollTop - el.clientHeight) < 60; }

    function streamReply(cid) {
      if (streamingRef.current) return;                                  // re-entrancy guard: never two concurrent streams
      if (!CFG.supabaseUrl) { setErr('Hiányzó backend konfiguráció.'); return; }
      streamingRef.current = true; setBusy(true); setErr(''); atBottom.current = true;
      // reset the guard + busy on EVERY exit path; keep the live streaming bubble until the persisted message loads (no flash)
      function endStream(reload) {
        streamingRef.current = false;
        if (!alive.current) return;                                      // don't setState after unmount
        setBusy(false);
        if (reload) loadMsgs(cid).then(function () { if (alive.current) setStreaming(null); }); else setStreaming(null);
      }
      sb.auth.getSession().then(function (s) {
        var token = (s && s.data && s.data.session && s.data.session.access_token) || CFG.supabaseAnonKey;
        fetch(CFG.supabaseUrl + '/functions/v1/research-chat', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'apikey': CFG.supabaseAnonKey, 'Authorization': 'Bearer ' + token },
          body: JSON.stringify({ chat_id: cid, stream: true })
        }).then(function (resp) {
          if (!resp.ok || !resp.body || !resp.body.getReader) { setErr('AI-kapcsolat függőben — telepítsd a research-chat Edge függvényt és állítsd be az ANTHROPIC_API_KEY-t.'); endStream(false); return; }
          var reader = resp.body.getReader(), dec = new TextDecoder(), acc = '';
          setStreaming({ text: '' });
          (function pump() {
            reader.read().then(function (rr) {
              if (!alive.current) { streamingRef.current = false; return; }
              if (rr.done) { if (props.onReply) props.onReply(); endStream(true); return; }
              acc += dec.decode(rr.value, { stream: true }); setStreaming({ text: acc }); pump();
            }, function () { endStream(true); });
          })();
        }, function () { setErr('AI-kapcsolat függőben — telepítsd a research-chat Edge függvényt.'); endStream(false); });
      }, function () { setErr('Nem sikerült a munkamenet lekérése.'); endStream(false); });
    }
    function sendText(raw) {
      var txt = (raw || '').trim(); if (!txt || busy) return;
      setBusy(true); setErr(''); setInput(''); if (taRef.current) taRef.current.style.height = 'auto';
      sb.from('research_messages').insert({ chat_id: props.chatId, role: 'user', content: txt }).then(function (ins) {
        if (ins && ins.error) { setBusy(false); setErr(ins.error.message); return; }
        loadMsgs(props.chatId); streamReply(props.chatId);
      });
    }
    function onKey(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText(input); } }
    function onTa(e) { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 140) + 'px'; }

    var fileRef = useRef(null);
    function pickFile() { if (fileRef.current) fileRef.current.click(); }
    function onFile(e) {
      var list = e.target.files; if (!list || !list.length) return;
      setBusy(true);
      readStaged(list).then(function (staged) {
        uploadFiles(props.projectId, staged).then(function (up) {
          var okd = up.filter(function (x) { return x.ok; });
          if (props.onFilesChanged) props.onFilesChanged();
          var names = okd.map(function (x) { return x.name; }).join(', ');
          if (!names) { setBusy(false); toast('A fájl feltöltése nem sikerült.', false); return; }
          sb.from('research_messages').insert({ chat_id: props.chatId, role: 'user', content: 'Feltöltöttem: ' + names }).then(function () {
            loadMsgs(props.chatId); streamReply(props.chatId);
          });
        });
      });
      e.target.value = '';
    }

    function turn(m) {
      var isAI = m.role === 'assistant';
      return h('div', { key: m.id, className: 'ap-turn ' + (isAI ? 'ai' : 'me') },
        h('span', { className: 'ap-av ' + (isAI ? 'ai' : 'me') }, isAI ? 'AI' : 'Te'),
        isAI
          ? h('div', { className: 'ap-bub', dangerouslySetInnerHTML: { __html: mdSafe(m.content) } })
          : h('div', { className: 'ap-bub' }, String(m.content || '')));
    }

    return h('div', { className: 'ap-card ap-chat' },
      h('div', { className: 'ap-chat-h' }, h('span', { className: 'ap-av ai' }, 'AI'), h('b', null, 'Kutatási asszisztens'), h('span', { className: 'prj' }, props.projectTitle || ''),
        props.onDiscard ? h('button', { className: 'ap-discard', title: 'A projekt, a beszélgetés és a fájlok elvetése', onClick: props.onDiscard }, 'Elvetés') : null),
      h('div', { className: 'ap-thread', ref: scrollRef, onScroll: onScroll },
        msgs.map(turn),
        streaming ? h('div', { className: 'ap-turn ai', key: 'stream' }, h('span', { className: 'ap-av ai' }, 'AI'), h('div', { className: 'ap-bub', dangerouslySetInnerHTML: { __html: mdSafe(streaming.text || '') } })) : null,
        (busy && !streaming) ? h('div', { className: 'ap-turn ai', key: 'typing' }, h('span', { className: 'ap-av ai' }, 'AI'), h('div', { className: 'ap-typing' }, h('i'), h('i'), h('i'))) : null),
      err ? h('div', { className: 'ap-cerr' }, err) : null,
      h('div', { className: 'ap-cbar' },
        h('input', { type: 'file', ref: fileRef, multiple: true, style: { display: 'none' }, onChange: onFile }),
        h('button', { className: 'ap-cicon', title: 'Fájl feltöltése', onClick: pickFile, disabled: busy }, '📎'),
        h('textarea', { ref: taRef, className: 'ap-cin', rows: 1, value: input, placeholder: 'Írj az asszisztensnek…', onChange: onTa, onKeyDown: onKey }),
        h('button', { className: 'ap-csend', title: 'Küldés', disabled: busy || !input.trim(), onClick: function () { sendText(input); } }, '➤')));
  }

  // ======================================================================= BRIEF PANEL
  function BriefPanel(props) {
    var p = props.project, files = props.files || [];
    var edS = useState(null), editing = edS[0], setEditing = edS[1];   // 'goal' | 'keywords' | null
    var vS = useState(''), draft = vS[0], setDraft = vS[1];
    var sgS = useState(false), sgBusy = sgS[0], setSgBusy = sgS[1];

    function startEdit(k) { setEditing(k); setDraft(k === 'keywords' ? (p.keywords || []).join(', ') : (p[k] || '')); }
    function saveEdit() {
      var k = editing, patch = {};
      if (k === 'keywords') patch.keywords = draft ? draft.split(',').map(function (x) { return x.trim(); }).filter(Boolean) : null;
      else patch[k] = draft.trim() || null;
      sb.from('research_projects').update(patch).eq('id', p.id).then(function (r) {
        if (r && r.error) { toast(r.error.message, false); return; }
        setEditing(null); if (props.onPatched) props.onPatched(patch);
      });
    }
    function suggest() {
      if (sgBusy) return; setSgBusy(true);
      Promise.resolve(props.onSuggestIdeas && props.onSuggestIdeas()).then(function () { setSgBusy(false); }, function () { setSgBusy(false); });
    }

    var hasGoal = !!(p.goal && p.goal.trim()), hasKw = (p.keywords || []).length > 0, hasFiles = files.length > 0, hasIdeas = (props.ideasCount || 0) > 0;
    var filled = [hasGoal, hasKw, hasFiles, hasIdeas].filter(Boolean).length;
    var pct = Math.round(filled / 4 * 100);

    function row(k, label, filledFlag, body, editKey) {
      return h('div', { className: 'ap-bfrow' + (filledFlag ? ' filled' : '') },
        h('div', { className: 'ap-bfk' }, h('span', { className: 'dot' }), label),
        body,
        (editKey && editing !== editKey) ? h('button', { className: 'ap-bfedit', onClick: function () { startEdit(editKey); } }, '✎ Szerkesztés') : null);
    }
    function editor() {
      return h('div', { style: { marginTop: 6 } },
        editing === 'keywords'
          ? h('input', { className: 'ap-cin', style: { width: '100%' }, value: draft, placeholder: 'OOD, LiDAR, uncertainty', onChange: function (e) { setDraft(e.target.value); } })
          : h('textarea', { className: 'ap-cin', style: { width: '100%' }, rows: 3, value: draft, onChange: function (e) { setDraft(e.target.value); } }),
        h('div', { style: { display: 'flex', gap: 8, marginTop: 8 } },
          h('button', { className: 'btn pri sm', onClick: saveEdit }, 'Mentés'),
          h('button', { className: 'btn sm', onClick: function () { setEditing(null); } }, 'Mégse')));
    }

    return h('div', { className: 'ap-card ap-brief' },
      h('div', { className: 'ap-brief-h' }, h('h3', null, 'Research brief'), h('span', { className: 'ap-ready' }, filled + ' / 4 kész')),
      h('div', { className: 'ap-rtrack' }, h('i', { style: { width: pct + '%' } })),

      row('goal', 'Cél', hasGoal,
        editing === 'goal' ? editor() : h('div', { className: 'ap-bfv' + (hasGoal ? '' : ' empty') }, p.goal || 'Nincs megadva'),
        'goal'),

      row('keywords', 'Kulcsszavak', hasKw,
        editing === 'keywords' ? editor()
          : (hasKw ? h('div', { className: 'ap-tags' }, p.keywords.map(function (kw, i) { return h('span', { className: 'ap-tag', key: i }, kw); }))
            : h('div', { className: 'ap-bfv empty' }, 'Add meg a kulcsszavakat a fókuszált irodalomkereséshez')),
        'keywords'),

      row('data', 'Adat', hasFiles,
        hasFiles ? h('div', { className: 'ap-tags' }, files.map(function (f, i) { return h('span', { className: 'ap-fchip', key: i }, '📎 ' + f.name, f.size ? h('span', { className: 'fsz' }, fmtSize(f.size)) : null); }))
          : h('div', { className: 'ap-bfv empty' }, 'Tölts fel adatot vagy dokumentumot a chatben (📎)'),
        null),

      row('ideas', 'Ötletek', hasIdeas,
        h('div', null,
          h('div', { className: 'ap-bfv' + (hasIdeas ? '' : ' empty') }, hasIdeas ? (props.ideasCount + ' ötlet-jelölt az Ideas-listán') : 'Még nincs ötlet kinyerve'),
          h('button', { className: 'ap-bfedit', disabled: sgBusy, onClick: suggest }, sgBusy ? h('span', null, h('span', { className: 'spin' }), ' Generálás…') : '✦ Ötletek a beszélgetésből')),
        null),

      h('div', { className: 'ap-brief-cta' },
        h('button', { className: 'ap-launch', onClick: props.onReview }, '⚡ Áttekintés & indítás →'),
        h('div', { className: 'ap-ctahint' + (filled >= 3 ? ' on' : '') }, filled >= 3 ? '✓ Az irány kikristályosodott' : 'A briefet te töltöd fel a beszélgetésből — bármikor indíthatod.')));
  }

  // ======================================================================= LAUNCH (clarify)
  var PHASES = [
    ['💡', 'Ideas', 'ötletek + PICO'], ['📚', 'Literature', 'keresés + screening'], ['🔬', 'Systematic review', 'Elicit'],
    ['🧪', 'Protocol', 'lépések generálása'], ['🎯', 'Journal', 'venue-ajánló'], ['✍️', 'Writing', 'draft szekciók'], ['📤', 'Submission', 'csomagolás']
  ];
  var TIERS = ['Top-tier (Q1)', 'Open access', 'Gyors döntés'];
  function LaunchView(props) {
    var p = props.project, files = props.files || [], cfg = props.cfg;
    function setTier(t) { props.setCfg(Object.assign({}, cfg, { tier: t })); }
    function togglePhase(i) { var ph = cfg.phases.slice(); ph[i] = !ph[i]; props.setCfg(Object.assign({}, cfg, { phases: ph })); }
    function setMax(v) { props.setCfg(Object.assign({}, cfg, { maxPapers: v.replace(/[^0-9]/g, '').slice(0, 6) })); }

    return h('div', { className: 'ap-launchwrap' },
      h('div', { className: 'ap-card ap-pad' },
        h('h2', null, 'A kutatási brief'),
        h('div', { className: 'sub' }, 'A beszélgetésből kikristályosodott — a „Vissza" gombbal szerkesztheted.'),
        h('div', { className: 'ap-sumrow' }, h('div', { className: 'ap-sumk' }, 'Cél'), h('div', { className: 'ap-sumv' }, p.goal || '—')),
        h('div', { className: 'ap-sumrow' }, h('div', { className: 'ap-sumk' }, 'Kulcsszavak'), h('div', { className: 'ap-sumv' }, (p.keywords || []).join(' · ') || '—')),
        h('div', { className: 'ap-sumrow' }, h('div', { className: 'ap-sumk' }, 'Adat'), h('div', { className: 'ap-sumv' }, files.length ? files.map(function (f) { return '📎 ' + f.name; }).join(' · ') : '—')),
        h('div', { className: 'ap-sumrow' }, h('div', { className: 'ap-sumk' }, 'Cél-venue'), h('div', { className: 'ap-sumv' }, cfg.tier)),
        h('div', { style: { marginTop: 16 } }, h('span', { className: 'ap-backlink', onClick: props.onBack }, '‹ Vissza a beszélgetéshez'))),

      h('div', { className: 'ap-card ap-pad' },
        h('h2', null, 'Indítás előtt — pár tisztázó kérdés'),
        h('div', { className: 'sub' }, 'Ezek szabják meg, hogyan fusson majd az Autopilot.'),
        h('div', { className: 'ap-clari' }, h('div', { className: 'ap-cl-lbl' }, 'Cél-folyóirat szint'),
          h('div', { className: 'ap-seg' }, TIERS.map(function (t) { return h('button', { key: t, className: cfg.tier === t ? 'on' : '', onClick: function () { setTier(t); } }, t); }))),
        h('div', { className: 'ap-clari' }, h('div', { className: 'ap-cl-lbl' }, 'Max. átvizsgált cikk'),
          h('input', { className: 'ap-numf', value: cfg.maxPapers, onChange: function (e) { setMax(e.target.value); } })),
        h('div', { className: 'ap-clari' }, h('div', { className: 'ap-cl-lbl' }, 'Tervezett fázisok ', h('span', { className: 'ap-soon' }, 'hamarosan'), h('div', { style: { fontWeight: 400, color: 'var(--muted)', fontSize: 11.5, marginTop: 3 } }, 'Beállításként mentjük a jövőbeli automata futtatóhoz — most nem indítja el őket.')),
          PHASES.map(function (ph, i) {
            return h('div', { className: 'ap-phrow', key: i },
              h('span', { className: 'pi' }, ph[0]),
              h('span', { className: 'pn' }, ph[1], h('small', null, ph[2])),
              h('button', { className: 'ap-sw' + (cfg.phases[i] ? ' on' : ''), role: 'switch', 'aria-checked': cfg.phases[i] ? 'true' : 'false', 'aria-label': ph[1], onClick: function () { togglePhase(i); } }, h('i')));
          })),
        h('div', { className: 'ap-gatehint' }, '⏸ ', h('b', null, 'Emberi jóváhagyás lesz bekapcsolva.'), ' Az automata futtató majd megáll a kulcs-döntéseknél (included források · protokoll-lépések · végső beküldés), és a jóváhagyásodra fog várni.'),
        h('div', { style: { marginTop: 16 } },
          h('button', { className: 'ap-launch', disabled: props.launching, onClick: props.onLaunch }, props.launching ? h('span', null, h('span', { className: 'spin' }), ' Mentés…') : '⚡ Mentés és megnyitás a munkaterületen →')),
        h('div', { className: 'ap-ctahint' }, 'A projekt megnyílik a Research munkaterületen a beszélgetéssel és a briefel. Az automatikus fázis-futtató hamarosan.')));
  }

  // ======================================================================= LAUNCHER (variant C)
  var STARTERS = [
    { key: 'paper', si: '📄', b: 'Egy cikkből', s: 'DOI / PDF alapján', ph: 'Illeszd be a DOI-t vagy írd le, melyik cikkből indulnál ki…' },
    { key: 'data', si: '📊', b: 'Adatból', s: 'CSV / eredmény', ph: 'Írd le, milyen adatod / eredményed van, és mit szeretnél belőle…' },
    { key: 'idea', si: '💡', b: 'Egy ötletből', s: 'kérdés + PICO', ph: 'Fogalmazd meg a kutatási kérdést vagy hipotézist egy mondatban…' },
    { key: 'upload', si: '📎', b: 'Feltöltésből', s: 'több fájl', ph: 'Tölts fel fájlokat lent, és írd le, mit kezdjünk velük…' }
  ];
  function Launcher(props) {
    var dS = useState(''), dir = dS[0], setDir = dS[1];
    var stS = useState(''), starter = stS[0], setStarter = stS[1];
    var fS = useState([]), staged = fS[0], setStaged = fS[1];
    var dgS = useState(false), drag = dgS[0], setDrag = dgS[1];
    var taRef = useRef(null), fileRef = useRef(null);
    var ph = (STARTERS.filter(function (x) { return x.key === starter; })[0] || {}).ph || 'Írd le egy mondatban, mit szeretnél kutatni…';

    function pickStarter(k) {
      setStarter(k);
      if (k === 'upload') { if (fileRef.current) fileRef.current.click(); }
      else if (taRef.current) taRef.current.focus();
    }
    function addFiles(list) { readStaged(list).then(function (arr) { setStaged(function (cur) { return cur.concat(arr); }); }); }
    function onFile(e) { if (e.target.files && e.target.files.length) addFiles(e.target.files); e.target.value = ''; }
    function removeStaged(i) { setStaged(function (cur) { return cur.filter(function (_, j) { return j !== i; }); }); }
    function onDrop(e) { e.preventDefault(); setDrag(false); if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }
    function onTa(e) { setDir(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 180) + 'px'; }
    function onKey(e) { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); start(); } }

    var canStart = !!(dir.trim() || staged.length);
    function start() { if (!canStart || props.creating) return; props.onStart(dir.trim(), staged); }

    return h('div', { className: 'ap-launcher' },
      h('div', { className: 'ap-lhead' }, 'Mit szeretnél kutatni?'),
      h('div', { className: 'ap-lsub' }, 'Írd le egy mondatban — vagy indíts egy cikkből, adatból, ötletből. A beszélgetés innen folytatódik, a briefet pedig menet közben te töltöd fel.'),
      h('div', { className: 'ap-inwrap' },
        h('textarea', { ref: taRef, className: 'ap-bigin', rows: 1, value: dir, placeholder: ph, onChange: onTa, onKeyDown: onKey }),
        h('button', { className: 'ap-gobtn', title: 'Indítás (⌘/Ctrl+Enter)', disabled: !canStart || props.creating, onClick: start }, props.creating ? h('span', { className: 'spin' }) : '➤')),
      h('div', { className: 'ap-starters' }, STARTERS.map(function (s) {
        return h('div', { key: s.key, className: 'ap-starter' + (starter === s.key ? ' on' : ''), onClick: function () { pickStarter(s.key); } },
          h('div', { className: 'si' }, s.si), h('b', null, s.b), h('small', null, s.s));
      })),
      h('input', { type: 'file', ref: fileRef, multiple: true, style: { display: 'none' }, onChange: onFile }),
      h('div', { className: 'ap-drop' + (drag ? ' drag' : ''), onClick: function () { if (fileRef.current) fileRef.current.click(); },
        onDragOver: function (e) { e.preventDefault(); setDrag(true); }, onDragLeave: function () { setDrag(false); }, onDrop: onDrop },
        staged.length ? h('span', null, h('b', null, staged.length + ' fájl kész'), ' — kattints vagy húzz ide továbbiakat')
          : h('span', null, '📎 ', h('b', null, 'Húzz ide fájlokat'), ' vagy kattints — CSV, PDF, dokumentum'),
        staged.length ? h('div', { className: 'dz-files' }, staged.map(function (f, i) {
          return h('span', { className: 'ap-fchip', key: i }, '📎 ' + f.name, h('span', { className: 'fsz' }, fmtSize(f.size)),
            h('span', { className: 'fx', title: 'Eltávolítás', onClick: function (e) { e.stopPropagation(); removeStaged(i); } }, '×'));
        })) : null),
      h('div', { className: 'ap-lnote' }, 'A „➤" létrehoz egy projektet a munkaterületeden, és átvisz a beszélgetésre: az AI tisztázó kérdéseket tesz fel, a briefet pedig te töltöd fel (az „Ötletek" gomb és a fájlfeltöltések segítenek). Elvetni bármikor tudod.'));
  }

  // ======================================================================= APP
  function App() {
    var vS = useState('launcher'), view = vS[0], setView = vS[1];
    var pS = useState(null), project = pS[0], setProject = pS[1];
    var cS = useState(null), chatId = cS[0], setChatId = cS[1];
    var fS = useState([]), files = fS[0], setFiles = fS[1];
    var icS = useState(0), ideasCount = icS[0], setIdeasCount = icS[1];
    var crS = useState(false), creating = crS[0], setCreating = crS[1];
    var lS = useState(false), launching = lS[0], setLaunching = lS[1];
    var cfgS = useState({ tier: TIERS[0], maxPapers: '500', phases: PHASES.map(function () { return true; }) }), cfg = cfgS[0], setCfg = cfgS[1];

    function refreshIdeas(pid) {
      sb.from('research_ideas').select('id', { count: 'exact', head: true }).eq('project_id', pid).then(function (r) { setIdeasCount((r && r.count) || 0); });
    }
    function refreshFiles(pid) { loadFiles(pid).then(setFiles); }
    // a partial create failed after the project row existed → delete it so abandonment never orphans a project
    function abortCreate(pid, msg) { if (pid) sb.from('research_projects').delete().eq('id', pid); setCreating(false); toast(msg, false); }

    function startProject(dir, staged) {
      setCreating(true);
      var u = uid();
      // student_id is deliberately NOT stamped here — it's set at launch (doLaunch), so abandoned exploration
      // never reaches the supervisor. The project is created now only because the live AI chat needs a real row.
      var payload = { owner_id: u, title: deriveTitle(dir || (staged[0] && staged[0].name) || ''), field: null, keywords: null, goal: dir || null, stage: 0, status: 'active' };
      sb.from('research_projects').insert(payload).select().maybeSingle().then(function (r) {
        if (!r || r.error || !r.data) { setCreating(false); toast('Nem sikerült létrehozni: ' + ((r && r.error && r.error.message) || 'ismeretlen hiba'), false); return; }
        var proj = r.data;
        sb.from('research_chats').insert({ project_id: proj.id, title: 'Publify chat' }).select('id').maybeSingle().then(function (cr) {
          var cid = cr && cr.data && cr.data.id;
          if (!cr || cr.error || !cid) { abortCreate(proj.id, 'Nem sikerült elindítani a beszélgetést' + ((cr && cr.error) ? ': ' + cr.error.message : '.')); return; }
          uploadFiles(proj.id, staged).then(function (up) {
            var okd = up.filter(function (x) { return x.ok; });
            var seed = (dir || '(fájl-alapú indítás)') + (okd.length ? '\n\nFeltöltött fájlok: ' + okd.map(function (x) { return x.name; }).join(', ') : '');
            sb.from('research_messages').insert({ chat_id: cid, role: 'user', content: seed }).then(function (ins) {
              if (ins && ins.error) { abortCreate(proj.id, 'Nem sikerült elküldeni az első üzenetet: ' + ins.error.message); return; }
              setProject(proj); setChatId(cid); setCreating(false); setView('brief');
              refreshFiles(proj.id); refreshIdeas(proj.id);
            });
          });
        });
      });
    }
    // discard the in-progress project (deletes the row + chat + files via cascade) and return to the launcher
    function discardProject() {
      var proj = project;
      function go(ok) {
        if (!ok) return;
        if (proj) sb.from('research_projects').delete().eq('id', proj.id);
        setProject(null); setChatId(null); setFiles([]); setIdeasCount(0); setView('launcher');
      }
      if (window.PRUI && window.PRUI.confirm) window.PRUI.confirm({ title: 'Elveted ezt a projektet?', confirmLabel: 'Elvetés', danger: true }).then(go);
      else go(window.confirm('Elveted ezt a projektet? A beszélgetés és a feltöltött fájlok törlődnek.'));
    }

    function suggestIdeas() {
      if (!project) return Promise.resolve();
      return sb.from('research_messages').select('role,content').eq('chat_id', chatId).order('created_at', { ascending: true }).then(function (r) {
        var m = (r && r.data) || [];
        if (!m.length) { toast('Beszélgess előbb a projektről — abból javaslok ötleteket.'); return; }
        var transcript = m.slice(-16).map(function (x) { return (x.role === 'assistant' ? 'AI: ' : 'User: ') + String(x.content || ''); }).join('\n\n').slice(0, 12000);
        return sb.functions.invoke('research-ai', { body: { action: 'suggest', project_id: project.id, text: transcript } }).then(function (res) {
          if (res && res.error) { toast('Az AI nincs konfigurálva (research-ai / ANTHROPIC_API_KEY).', false); return; }
          var d = res && res.data;
          if (d && d.count) { toast('✓ ' + d.count + ' új ötlet az Ideas-listán'); refreshIdeas(project.id); }
          else toast('Ebből a beszélgetésből nem született új ötlet.');
        }, function () { toast('Az AI-hívás nem sikerült.', false); });
      });
    }

    function doLaunch() {
      if (!project) return; setLaunching(true);
      var u = uid();
      var md = '# Autopilot brief\n\n**Cél:** ' + (project.goal || '—') + '\n\n**Kulcsszavak:** ' + ((project.keywords || []).join(', ') || '—')
        + '\n\n**Adat:** ' + (files.length ? files.map(function (f) { return f.name; }).join(', ') : '—')
        + '\n\n**Cél-venue:** ' + cfg.tier + '\n\n**Max. átvizsgált cikk:** ' + (cfg.maxPapers || '—')
        + '\n\n**Tervezett fázisok:** ' + PHASES.filter(function (_, i) { return cfg.phases[i]; }).map(function (ph) { return ph[1]; }).join(', ')
        + '\n\n**Emberi jóváhagyás:** tervezve (included források · protokoll-lépések · végső beküldés).\n\n---\n*A Publify Autopilot belépőből mentve. Az automatikus fázis-futtató hamarosan — ez a brief előkészíti hozzá a projektet.*\n';
      function nav() { location.href = 'Research.html?project=' + encodeURIComponent(project.id); }
      function finish() {
        sb.from('research_files').upsert({ project_id: project.id, path: 'autopilot/brief.md', content: md, mime: 'text/markdown', size: md.length, source: 'ai', created_by: u, updated_by: u, updated_at: nowIso() }, { onConflict: 'project_id,path' }).then(nav, nav);
      }
      // stamp student_id now (deferred from creation) so the LAUNCHED project reaches the supervisor, then persist + open
      sb.from('phd_students').select('id').eq('profile_id', u).maybeSingle().then(function (sr) {
        var sid = sr && sr.data && sr.data.id;
        if (sid && !project.student_id) sb.from('research_projects').update({ student_id: sid }).eq('id', project.id).then(finish, finish);
        else finish();
      }, finish);
    }

    // stepper
    var STEP = view === 'launcher' || view === 'brief' ? 1 : view === 'launch' ? 2 : 3;
    function stepBtn(n, label, vgo, disabled) {
      var cls = 'ap-st' + (STEP === n ? ' on' : STEP > n ? ' done' : '');
      return h('button', { className: cls, disabled: disabled || !project, onClick: function () { if (!disabled && project) setView(vgo); } }, h('span', { className: 'n' }, n), label);
    }

    var body;
    if (view === 'launcher') body = h(Launcher, { creating: creating, onStart: startProject });
    else if (view === 'brief') body = h('div', { className: 'ap-split' },
      h(Chat, { projectId: project.id, chatId: chatId, projectTitle: project.title, onReply: function () { }, onFilesChanged: function () { refreshFiles(project.id); }, onDiscard: discardProject }),
      h(BriefPanel, {
        project: project, files: files, ideasCount: ideasCount,
        onPatched: function (patch) { setProject(Object.assign({}, project, patch)); },
        onSuggestIdeas: suggestIdeas, onReview: function () { setView('launch'); }
      }));
    else body = h(LaunchView, { project: project, files: files, cfg: cfg, setCfg: setCfg, launching: launching, onBack: function () { setView('brief'); }, onLaunch: doLaunch });

    return h('div', { className: 'ap-wrap' },
      h('div', { className: 'ap-steps' },
        stepBtn(1, 'Beszélgetés & brief', 'brief', false), h('span', { className: 'ap-st-sep' }, '›'),
        stepBtn(2, 'Indítás', 'launch', false), h('span', { className: 'ap-st-sep' }, '›'),
        h('button', { className: 'ap-st', disabled: true, title: 'Az automatikus fázis-futtató hamarosan' }, h('span', { className: 'n' }, '3'), 'Autopilot dashboard')),
      body);
  }

  // ---- boot ----
  if (!BE || !BE.sb) { root.innerHTML = '<div class="center"><div class="box"><h1>A backend nem elérhető</h1></div></div>'; return; }
  if (BE.mode !== 'cloud' || !BE.user) { root.innerHTML = '<div class="center"><div class="box"><div class="mk"><i></i></div><h1>Jelentkezz be</h1><p>Az Autopilot bejelentkezést igényel.</p><a class="btn" href="Landing.html">Bejelentkezés</a></div></div>'; return; }
  ReactDOM.createRoot(root).render(h(App));
})();
