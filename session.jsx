/* Publify — Claude Session. A plain full Claude chat (Zola-style) with a left history sidebar.
 * Streams via the claude-session Edge function; conversations live in user_chats / user_chat_messages
 * (migration-25), owner-scoped. Uses the user's per-user model. No bundler — React.createElement. */
(function () {
  var h = React.createElement;
  var useState = React.useState, useEffect = React.useEffect, useRef = React.useRef;
  var BE = window.PR_BACKEND, sb = BE && BE.sb;
  var CFG = window.PR_CONFIG || {};

  function mdHtml(t) { var s = String(t == null ? '' : t); try { if (window.marked && window.DOMPurify) return window.DOMPurify.sanitize(window.marked.parse(s, { breaks: true })); } catch (e) { } return s.replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }).replace(/\n/g, '<br>'); }
  function foldCode(html) { if (!html) return html; return html.replace(/<pre>/g, '<details class="code-fold"><summary>⟨⟩ Kód — kinyitás / összecsukás</summary><pre>').replace(/<\/pre>/g, '</pre></details>'); }
  var SUGGEST = ['Magyarázd el egyszerűen a Fisher-információt.', 'Írj egy rövid kutatási absztraktot OOD-detekcióról.', 'Adj 5 ötletet egy disszertáció-fejezethez.', 'Segíts strukturálni egy prezentációt.'];

  function App() {
    var phS = useState('loading'), phase = phS[0], setPhase = phS[1];
    var meS = useState(null), me = meS[0], setMe = meS[1];
    var chS = useState([]), chats = chS[0], setChats = chS[1];
    var cidS = useState(null), cid = cidS[0], setCid = cidS[1];
    var mgS = useState([]), msgs = mgS[0], setMsgs = mgS[1];
    var inS = useState(''), input = inS[0], setInput = inS[1];
    var bzS = useState(false), busy = bzS[0], setBusy = bzS[1];
    var stS = useState(null), streaming = stS[0], setStreaming = stS[1];
    var alive = useRef(true), scrollRef = useRef(null), taRef = useRef(null);
    useEffect(function () { return function () { alive.current = false; }; }, []);
    useEffect(function () { boot(); }, []);

    function boot() {
      if (!BE || !BE.sb) { setPhase('nobackend'); return; }
      if (BE.mode === 'signin' || BE.mode === 'pending') { setPhase('signin'); return; }
      if (BE.mode !== 'cloud' || !BE.user) { setPhase('demo'); return; }
      setMe({ id: BE.user.id, name: BE.user.name, email: BE.user.email });
      // wait for supabase-js to attach the restored session JWT before any RLS-scoped read, else the first
      // loadChats runs anon and comes back empty (the session is loaded asynchronously after createClient)
      sb.auth.getSession().then(function () { loadChats(function (list) { if (list && list.length) openChat(list[0].id); setPhase('ready'); }); }, function () { setPhase('ready'); });
    }
    function loadChats(done) { sb.from('user_chats').select('id,title,updated_at').order('updated_at', { ascending: false }).then(function (r) { var list = (r && r.data) || []; setChats(list); if (done) done(list); }); }
    function loadMsgs(id) { sb.from('user_chat_messages').select('id,role,content,created_at').eq('chat_id', id).order('created_at', { ascending: true }).then(function (r) { setMsgs((r && r.data) || []); }); }
    function openChat(id) { setCid(id); setStreaming(null); loadMsgs(id); }
    function newChat() { setCid(null); setMsgs([]); setStreaming(null); if (taRef.current) taRef.current.focus(); }
    function delChat(id, e) { e.stopPropagation(); if (!window.confirm('Töröljük ezt a beszélgetést?')) return; sb.from('user_chats').delete().eq('id', id).then(function () { if (cid === id) { setCid(null); setMsgs([]); } loadChats(); }); }

    useEffect(function () { var el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; }, [msgs.length, streaming]);

    function ensureChat(firstMsg) {
      if (cid) return Promise.resolve(cid);
      var title = (firstMsg || 'Új beszélgetés').slice(0, 60);
      return sb.from('user_chats').insert({ owner_id: me.id, title: title }).select('id').maybeSingle().then(function (r) { var id = r && r.data && r.data.id; setCid(id); loadChats(); return id; });
    }
    function streamReply(id) {
      sb.auth.getSession().then(function (s) {
        var token = (s && s.data && s.data.session && s.data.session.access_token) || CFG.supabaseAnonKey;
        fetch(CFG.supabaseUrl + '/functions/v1/claude-session', { method: 'POST', headers: { 'Content-Type': 'application/json', 'apikey': CFG.supabaseAnonKey, 'Authorization': 'Bearer ' + token }, body: JSON.stringify({ chat_id: id, stream: true }) }).then(function (resp) {
          if (!resp.ok || !resp.body || !resp.body.getReader) { setBusy(false); return; }
          var reader = resp.body.getReader(), dec = new TextDecoder(), acc = '';
          setStreaming({ text: '' });
          (function pump() { reader.read().then(function (r) { if (!alive.current) return; if (r.done) { setStreaming(null); setBusy(false); loadMsgs(id); loadChats(); return; } acc += dec.decode(r.value, { stream: true }); setStreaming({ text: acc }); pump(); }, function () { setStreaming(null); setBusy(false); loadMsgs(id); }); })();
        }, function () { setBusy(false); });
      });
    }
    function sendText(raw) {
      var txt = (raw || '').trim(); if (!txt || busy) return;
      setBusy(true); setInput(''); if (taRef.current) taRef.current.style.height = 'auto';
      ensureChat(txt).then(function (id) {
        if (!id) { setBusy(false); return; }
        sb.from('user_chat_messages').insert({ chat_id: id, role: 'user', content: txt }).then(function () { loadMsgs(id); streamReply(id); });
      });
    }
    function send() { sendText(input); }
    function onKey(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }
    function onInput(e) { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px'; }
    function copy(m) { try { navigator.clipboard.writeText(m.content || ''); } catch (e) { } }

    if (phase === 'loading') return h('div', { className: 'center' }, 'Betöltés…');
    if (phase === 'nobackend') return h('div', { className: 'center' }, 'A felhő backend nem elérhető.');
    if (phase === 'signin') return null;
    if (phase === 'demo') return h('div', { className: 'center' }, h('div', null, h('h1', null, 'Jelentkezz be'), h('p', null, 'A Claude Session a fiókodat igényli.'), h('button', { className: 'newchat', style: { display: 'inline-flex', marginTop: 12 }, onClick: function () { try { localStorage.removeItem('proofreader:mode'); } catch (e) { } location.reload(); } }, 'Bejelentkezés')));

    var side = h('div', { className: 'side' },
      h('div', { className: 'side-brand' }, h('div', { className: 'mk' }, h('span')), h('div', null, h('b', null, 'Publify'), h('i', null, 'Claude Session'))),
      h('button', { className: 'newchat', onClick: newChat }, '➕  Új beszélgetés'),
      h('div', { className: 'hist-h' }, 'Előzmények'),
      h('div', { className: 'hist' }, chats.length ? chats.map(function (c) {
        return h('div', { className: 'hist-item' + (c.id === cid ? ' on' : ''), key: c.id, onClick: function () { openChat(c.id); } },
          h('span', { className: 'ht' }, c.title || 'Beszélgetés'),
          h('button', { className: 'hx', title: 'Törlés', onClick: function (e) { delChat(c.id, e); } }, '×'));
      }) : h('div', { style: { fontSize: 12.5, color: 'var(--faint)', padding: '8px 9px' } }, 'Még nincs beszélgetés.')),
      h('div', { className: 'side-foot' }, h('span', null, me.name || me.email), h('a', { href: 'Projects.html', title: 'Vissza' }, '← Publify'))
    );

    var conv = (msgs.length || streaming || busy) ? h('div', { className: 'conv', ref: scrollRef }, h('div', { className: 'wrap' },
      msgs.map(function (m) {
        var ai = m.role === 'assistant';
        return h('div', { key: m.id, className: 'bubble ' + (ai ? 'ai' : 'user') },
          ai ? h('div', { className: 'btxt md', dangerouslySetInnerHTML: { __html: foldCode(mdHtml(m.content)) } }) : h('div', { className: 'btxt' }, m.content),
          ai ? h('div', { className: 'bmeta' }, h('button', { onClick: function () { copy(m); } }, 'Másolás')) : null);
      }),
      streaming ? h('div', { className: 'bubble ai', key: 'stream' }, h('div', { className: 'btxt' }, streaming.text || '', h('span', { className: 'tw-cursor' }, '▌')))
        : busy ? h('div', { className: 'bubble ai' }, h('div', { className: 'btxt', style: { color: 'var(--faint)' } }, 'Claude gondolkodik…')) : null
    )) : h('div', { className: 'empty' }, h('h1', null, 'Miben segíthetek?'), h('p', null, 'Teljes értékű Claude beszélgetés — kérdezz bármit.'),
      h('div', { className: 'suggest' }, SUGGEST.map(function (s, i) { return h('button', { key: i, onClick: function () { sendText(s); } }, s); })));

    var curTitle = (cid && (chats.filter(function (c) { return c.id === cid; })[0] || {}).title) || 'Új beszélgetés';
    var main = h('div', { className: 'main' },
      h('div', { className: 'topbar' }, h('span', null, curTitle), h('span', { className: 'mtag' }, 'Claude')),
      conv,
      h('div', { className: 'composer' }, h('div', { className: 'composer-in' },
        h('textarea', { ref: taRef, value: input, rows: 1, placeholder: 'Üzenet Claude-nak…  (Enter = küldés · Shift+Enter = új sor)', disabled: busy, onChange: onInput, onKeyDown: onKey }),
        h('button', { className: 'send-btn', disabled: busy || !input.trim(), onClick: send }, '↑')))
    );

    return h('div', { className: 'app' }, side, main);
  }

  ReactDOM.createRoot(document.getElementById('root')).render(h(App));
})();
