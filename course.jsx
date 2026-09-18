/* Publify — Kurzus (Course.html): student lab notebook + instructor console for the
 * "MI Alapok" course module (migrations 65 core / 66 credits+audit / 67 canvas+polls).
 * Student side: lecture rail → lab notebook (instructions_md) → embedded MCP caller panel
 * (mcp-bridge edge fn, SSE stream with tool blocks; media results can be posted to the
 * class canvas — course_canvas_items — or submitted — lab_submissions upsert).
 * Instructor side (course_is_instructor RPC): submission list + rubric grading (course-ops
 * 'grade'), mcp_call_log audit feed ('audit_feed'), poll admin (create/open/close + top-3
 * results) and bulk credit grants ('set_budget_bulk'). Every course-ops action has a
 * direct-RLS fallback so the page keeps working before the edge fn is deployed.
 * UI copy is Hungarian (course module); comments stay English like the rest of the repo. */
(function () {
  'use strict';
  var h = React.createElement;
  var useState = React.useState, useEffect = React.useEffect, useRef = React.useRef;
  var BE = window.PR_BACKEND, sb = BE && BE.sb;
  var CFG = window.PR_CONFIG || {};

  function toast(m, o) { try { window.PRUI && window.PRUI.toast(m, o); } catch (e) { } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
  function fmtT(x) { try { var d = new Date(x); return isNaN(d) ? '—' : d.toLocaleString('hu-HU', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return '—'; } }
  function initials(n) { return String(n || '?').split(/\s+/).map(function (w) { return w.charAt(0); }).join('').slice(0, 2).toUpperCase() || '?'; }

  // ---------- markdown (marked+DOMPurify when the CDN loaded; minimal fallback otherwise) ----------
  function miniMd(s) {
    var out = [], list = null;
    function closeList() { if (list) { out.push(list === 'ol' ? '</ol>' : '</ul>'); list = null; } }
    function inline(t) {
      return esc(t)
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
        .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>');
    }
    String(s || '').split(/\r?\n/).forEach(function (ln) {
      var m;
      if ((m = /^(#{1,4})\s+(.*)/.exec(ln))) { closeList(); var l = Math.min(4, m[1].length + 2); out.push('<h' + l + '>' + inline(m[2]) + '</h' + l + '>'); }
      else if ((m = /^\s*[-*]\s+(.*)/.exec(ln))) { if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; } out.push('<li>' + inline(m[1]) + '</li>'); }
      else if ((m = /^\s*\d+[.)]\s+(.*)/.exec(ln))) { if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; } out.push('<li>' + inline(m[1]) + '</li>'); }
      else if (!ln.trim()) closeList();
      else { closeList(); out.push('<p>' + inline(ln) + '</p>'); }
    });
    closeList();
    return out.join('\n');
  }
  function mdHtml(t) {
    var s = String(t == null ? '' : t);
    try { if (window.marked && window.DOMPurify) return window.DOMPurify.sanitize(window.marked.parse(s, { breaks: true })); } catch (e) { }
    return miniMd(s);
  }

  // ---------- credit services (course_credit_budgets vocabulary, migration-67) ----------
  var SERVICES = ['llm', 'image', 'video', 'audio', 'search'];
  var SVC_HU = { llm: 'LLM', image: 'Kép', video: 'Videó', audio: 'Hang', search: 'Keresés' };
  var PROV_HU = { 'anthropic-mcp': 'Claude + MCP', anthropic: 'Claude + MCP', gemini: 'Gemini', 'gemini-image': 'Gemini (kép)', elevenlabs: 'ElevenLabs', higgsfield: 'Higgsfield' };
  // CONTRACT CANON: canonical provider names on the wire are 'anthropic' and 'gemini-image' —
  // the client maps legacy profile names before sending (the bridge normalizes too, belt-and-braces).
  var PROV_CANON = { 'anthropic-mcp': 'anthropic', gemini: 'gemini-image' };
  // Map a Higgsfield/Gemini/… tool or service name onto the course credit service bucket.
  function serviceOf(tool) {
    var t = String(tool || '').toLowerCase();
    if (/video|veo|animation|motion|reframe|clip/.test(t)) return 'video';
    if (/image|imagen|upscale|outpaint|background|photo|3d/.test(t)) return 'image';
    if (/audio|music|lyria|voice|speech|dub|sound|tts/.test(t)) return 'audio';
    if (/search|consensus|elicit|openalex|paper|scholar/.test(t)) return 'search';
    return 'llm';
  }
  // Per-call credit price from the lab's mcp_profile.credit_cost contract.
  function costOf(tool, profile) {
    var cc = (profile && profile.credit_cost) || {};
    if (cc[tool] != null) return +cc[tool];
    var svc = serviceOf(tool);
    if (svc === 'llm') return cc.llm_call != null ? +cc.llm_call : 1;
    var generic = { image: 'generate_image', video: 'generate_video', audio: 'generate_audio', search: 'search' }[svc];
    return (generic && cc[generic] != null) ? +cc[generic] : 1;
  }

  // ---------- edge fn plumbing (figure-board.js callFn pattern: caller JWT + anon apikey) ----------
  function callFn(fn, body) {
    return sb.auth.getSession().then(function (s) {
      var token = (s && s.data && s.data.session && s.data.session.access_token) || CFG.supabaseAnonKey;
      return fetch(CFG.supabaseUrl + '/functions/v1/' + fn, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': CFG.supabaseAnonKey, 'Authorization': 'Bearer ' + token },
        body: JSON.stringify(body)
      }).then(function (r) { return r.json().catch(function () { return { error: 'bad response' }; }); }, function () { return { error: 'network' }; });
    });
  }
  // course-ops action with a direct-RLS fallback so the console works before the fn is deployed.
  function courseOps(body, fallback) {
    return callFn('course-ops', body).then(function (res) {
      if (res && !res.error) return res;
      if (fallback) return fallback((res && res.error) || 'course-ops unavailable');
      return res || { error: 'course-ops unavailable' };
    });
  }
  function fetchNames(ids) {
    ids = (ids || []).filter(function (v, i, a) { return v && a.indexOf(v) === i; });
    if (!ids.length) return Promise.resolve({});
    return sb.from('profiles_public').select('id,name').in('id', ids).then(function (r) {
      var m = {}; (((r || {}).data) || []).forEach(function (p) { m[p.id] = p.name; }); return m;
    }, function () { return {}; });
  }
  function chip(text, kind, key) { return h('span', { key: key, className: 'chip' + (kind ? ' ' + kind : '') }, text); }

  // ---------- media renderer: private course-media path → signed URL → img/video/audio ----------
  function MediaBox(props) {
    var uS = useState(props.url || null), url = uS[0], setUrl = uS[1];
    useEffect(function () {
      if (props.url) { setUrl(props.url); return; }
      if (!props.path) { setUrl(null); return; }
      var on = true;
      sb.storage.from('course-media').createSignedUrl(props.path, 3600).then(function (r) {
        if (on && r && r.data && r.data.signedUrl) setUrl(r.data.signedUrl);
      }, function () { });
      return function () { on = false; };
    }, [props.path, props.url]);
    if (!url) return h('div', { className: 'pr-skel', style: { height: props.height || 120 } });
    var mime = props.mime || '';
    if (/^video/.test(mime)) return h('video', { className: 'co-media', src: url, controls: true });
    if (/^audio/.test(mime)) return h('audio', { className: 'co-media', src: url, controls: true, style: { width: '100%' } });
    return h('img', { className: 'co-media', src: url, alt: props.alt || 'Generált eredmény', style: { maxHeight: props.height || 260 } });
  }

  // ---------- credit bars ("mennyi maradt" — own course_credit_budgets rows) ----------
  function CreditBars(props) {
    var rows = (props.budgets || []).slice().sort(function (a, b) { return SERVICES.indexOf(a.service) - SERVICES.indexOf(b.service); });
    if (!rows.length) return null;
    return h('div', { className: 'credits', 'aria-label': 'Kreditkeret' }, rows.map(function (b) {
      var granted = +b.granted || 0, used = +b.used || 0, left = Math.max(0, granted - used);
      var pct = granted > 0 ? Math.min(100, Math.round(used / granted * 100)) : 100;
      return h('div', { className: 'cr', key: b.service, title: (SVC_HU[b.service] || b.service) + ' kredit: ' + left + ' maradt a(z) ' + granted + ' keretből' },
        h('div', { className: 'l' }, h('span', null, SVC_HU[b.service] || b.service), h('b', null, left + '/' + granted)),
        h('div', { className: 'pr-bar' }, h('i', { style: { width: pct + '%' } })));
    }));
  }

  // ---------- join screen (course_join RPC) ----------
  function JoinScreen(props) {
    var cS = useState(''), code = cS[0], setCode = cS[1];
    var bS = useState(false), busy = bS[0], setBusy = bS[1];
    var eS = useState(''), err = eS[0], setErr = eS[1];
    function join() {
      var c = code.trim();
      if (!c || busy) return;
      setBusy(true); setErr('');
      sb.rpc('course_join', { p_code: c }).then(function (r) {
        setBusy(false);
        if (r && r.error) { setErr('Érvénytelen kurzuskód — ellenőrizd, és próbáld újra.'); return; }
        toast('Sikeres csatlakozás a kurzushoz 🎓', { kind: 'ok' });
        props.onJoined();
      }, function () { setBusy(false); setErr('Hálózati hiba — próbáld újra.'); });
    }
    return h('div', { className: 'center' }, h('div', { className: 'box' },
      h('div', { className: 'mk' }, h('span')),
      h('h1', null, 'Csatlakozás kurzushoz'),
      h('p', null, 'Még nem vagy tagja egyetlen kurzusnak sem. Írd be az oktatódtól kapott kurzuskódot.'),
      h('div', { style: { display: 'flex', gap: 8, justifyContent: 'center' } },
        h('input', { className: 'in', style: { width: 200, textAlign: 'center' }, placeholder: 'Kurzuskód', value: code, autoFocus: true, onChange: function (e) { setCode(e.target.value); }, onKeyDown: function (e) { if (e.key === 'Enter') join(); } }),
        h('button', { className: 'btn pri', disabled: busy || !code.trim(), onClick: join }, busy ? 'Csatlakozás…' : 'Csatlakozom')),
      err ? h('p', { style: { color: 'var(--danger)', marginTop: 12 } }, err) : null
    ));
  }

  // ---------- lecture rail (left column) ----------
  function LectureRail(props) {
    return h('nav', { className: 'rail card', 'aria-label': 'Előadások' },
      h('h3', null, props.course.title || 'Kurzus'),
      (props.lectures || []).map(function (l) {
        var done = !!props.doneMap[l.id], now = l.id === props.selId;
        return h('button', {
          key: l.id, className: 'rl' + (now ? ' now' : done ? ' done' : '') + (l.visible === false ? ' dim' : ''),
          onClick: function () { props.onSelect(l.id); }
        },
          h('span', { className: 'st' }, (done && !now) ? '✓' : String(l.ord)),
          h('span', { className: 't', title: l.title }, l.title),
          l.visible === false ? h('span', { title: 'A hallgatók még nem látják' }, '🙈') : null);
      }),
      !(props.lectures || []).length ? h('div', { style: { fontSize: 12, color: 'var(--faint)', padding: '6px 9px' } }, 'Még nincs előadás.') : null
    );
  }

  // ---------- submission status chip ----------
  function subStatus(sub, grade) {
    if (!sub) return chip('nincs beadás', '', 'st');
    if (grade) return chip('osztályozva · ' + (+grade.points) + ' pont', 'ok', 'st');
    if (sub.status === 'returned') return chip('visszaküldve', 'warn', 'st');
    if (sub.status === 'draft') return chip('piszkozat', '', 'st');
    return chip('beadva ✔', 'acc', 'st');
  }

  // ---------- one lab card in the notebook (instructions + text/link submit) ----------
  function LabCard(props) {
    var lab = props.lab, sub = props.sub, grade = props.grade;
    var kinds = lab.submit_kinds || ['text', 'link', 'media'];
    var txS = useState((sub && sub.body_text) || ''), txt = txS[0], setTxt = txS[1];
    var lkS = useState((sub && sub.link_url) || ''), link = lkS[0], setLink = lkS[1];
    var bS = useState(false), busy = bS[0], setBusy = bS[1];
    useEffect(function () { setTxt((sub && sub.body_text) || ''); setLink((sub && sub.link_url) || ''); }, [(sub && sub.id) || '', lab.id]);
    var overdue = lab.due_at && !sub && new Date(lab.due_at) < new Date();
    function submit() {
      if (!txt.trim() && !link.trim()) { toast('Írj szöveget vagy adj meg linket a beadáshoz.', { kind: 'warn' }); return; }
      var row = {
        assignment_id: lab.id, course_id: lab.course_id, user_id: props.meId,
        kind: txt.trim() ? 'text' : 'link', body_text: txt.trim() || null, link_url: link.trim() || null,
        status: 'submitted', updated_at: new Date().toISOString()
      };
      if (lab.team_based && props.team) row.team = props.team;
      setBusy(true);
      sb.from('lab_submissions').upsert(row, { onConflict: 'assignment_id,user_id' }).then(function (r) {
        setBusy(false);
        if (r && r.error) { toast('Beadás sikertelen: ' + r.error.message, { kind: 'error' }); return; }
        toast('Beadva ✔', { kind: 'ok' }); props.onSubmitted();
      });
    }
    return h('div', { className: 'co-card card' },
      h('div', { className: 'lab-h' },
        h('span', { className: 'lab-n' }, String(lab.ord || 1)),
        h('h3', null, lab.title),
        h('span', { className: 'sp' }),
        lab.team_based ? chip('👥 csapat', 'acc', 'tm') : null,
        lab.due_at ? chip('⏰ ' + fmtT(lab.due_at), overdue ? 'danger' : '', 'due') : null,
        chip((+lab.points_max || 10) + ' pont', '', 'pt'),
        subStatus(sub, grade)),
      lab.instructions_md
        ? h('div', { className: 'md', dangerouslySetInnerHTML: { __html: mdHtml(lab.instructions_md) } })
        : h('div', { style: { fontSize: 13, color: 'var(--faint)' } }, 'Ehhez a laborhoz még nincs feladatleírás.'),
      grade && (grade.feedback_md || grade.rubric_scores) ? h('div', { className: 'feedback' },
        h('b', null, 'Oktatói visszajelzés'),
        grade.rubric_scores && Array.isArray(lab.rubric) ? h('div', { style: { margin: '6px 0' } }, lab.rubric.map(function (r) {
          return h('div', { key: r.key, style: { display: 'flex', justifyContent: 'space-between', gap: 10 } },
            h('span', null, r.label || r.key), h('b', null, (+grade.rubric_scores[r.key] || 0) + '/' + (+r.points || 0)));
        })) : null,
        grade.feedback_md ? h('div', { className: 'md', dangerouslySetInnerHTML: { __html: mdHtml(grade.feedback_md) } }) : null) : null,
      h('div', { className: 'sub-box' },
        h('div', { className: 'row' },
          h('button', { className: 'btn sm' + (props.active ? ' pri' : ''), onClick: props.onUse, title: 'A jobb oldali MCP-panel ezen a laboron dolgozik' }, props.active ? '● MCP-panel ezen a laboron' : '🤖 MCP-panelre'),
          kinds.indexOf('media') >= 0 ? h('span', { style: { fontSize: 11.5, color: 'var(--faint)' } }, 'Médiát az MCP-panelből adhatsz be („Beadom”).') : null),
        kinds.indexOf('text') >= 0 ? h('textarea', { className: 'in', rows: 2, placeholder: 'Szöveges beadás / reflexió…', value: txt, onChange: function (e) { setTxt(e.target.value); } }) : null,
        h('div', { className: 'row' },
          kinds.indexOf('link') >= 0 ? h('input', { className: 'in', style: { flex: 1, minWidth: 180 }, placeholder: 'Link (URL) a beadáshoz…', value: link, onChange: function (e) { setLink(e.target.value); } }) : null,
          (kinds.indexOf('text') >= 0 || kinds.indexOf('link') >= 0)
            ? h('button', { className: 'btn pri sm', disabled: busy, onClick: submit }, busy ? 'Mentés…' : (sub && sub.status !== 'draft' ? 'Beadás frissítése' : '📤 Beadom'))
            : null)
      ));
  }

  // ---------- embedded MCP caller panel (mcp-bridge SSE; research-chat stream pattern) ----------
  function McpPanel(props) {
    var itS = useState([]), items = itS[0], setItems = itS[1];
    var inS = useState(''), input = inS[0], setInput = inS[1];
    var bS = useState(false), busy = bS[0], setBusy = bS[1];
    var pvS = useState(null), provider = pvS[0], setProvider = pvS[1];
    var mtS = useState(null), meta = mtS[0], setMeta = mtS[1];
    var alive = useRef(true);
    var scrollRef = useRef(null);
    var lab = props.assignment;
    var profile = (lab && lab.mcp_profile) || {};
    var providers = (profile.providers && profile.providers.length) ? profile.providers : [];
    var noProv = !!lab && !providers.length;   // empty mcp_profile → sending disabled
    var prov = (provider && providers.indexOf(provider) >= 0) ? provider : providers[0];
    useEffect(function () { alive.current = true; return function () { alive.current = false; }; }, []);
    useEffect(function () { var el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; }, [items, busy]);
    useEffect(function () { setItems([]); setProvider(null); setMeta(null); }, [(lab && lab.id) || '']);   // switching labs → fresh panel

    function push(it) { setItems(function (l) { return l.concat([it]); }); }
    function appendText(t) {
      if (!t) return;
      setItems(function (l) {
        var last = l[l.length - 1];
        if (last && last.type === 'text' && last.live) { var nl = l.slice(); nl[nl.length - 1] = { type: 'text', text: last.text + t, live: true }; return nl; }
        return l.concat([{ type: 'text', text: t, live: true }]);
      });
    }
    function closeText() { setItems(function (l) { return l.map(function (it) { return it.live ? { type: 'text', text: it.text } : it; }); }); }
    // Typed SSE events from mcp-bridge (tolerant field names, since the fn evolves in parallel).
    function handleEvent(ev, ctx) {
      var t = ev && ev.type;
      if (t === 'text' || t === 'text_delta' || t === 'delta') appendText(ev.delta != null ? ev.delta : ev.text);
      else if (t === 'tool_use' || t === 'tool') push({ type: 'tool', name: ev.name || ev.tool || 'tool', server: ev.server || '', input: ev.input || ev.params || null, running: true });
      else if (t === 'tool_result') setItems(function (l) {
        var nl = l.slice();
        for (var i = nl.length - 1; i >= 0; i--) if (nl[i].type === 'tool' && nl[i].running) { nl[i] = Object.assign({}, nl[i], { running: false, ok: !ev.is_error }); break; }
        return nl;
      });
      else if (t === 'media') push({
        type: 'media', path: ev.media_path || ev.path || null, url: ev.media_url || ev.url || null,
        mime: ev.mime || 'image/png', callLogId: ev.call_log_id != null ? ev.call_log_id : null,
        model: ev.model || null, params: ev.params || null, tool: ev.tool || null,
        credits: ev.credits != null ? ev.credits : null
      });
      else if (t === 'done' || t === 'meta') ctx.meta = { callLogId: ev.call_log_id, credits: ev.credits, service: ev.service, model: ev.model, auditWarning: ev.audit_warning || null };
      else if (t === 'error') push({ type: 'error', text: ev.message || ev.error || 'Ismeretlen hiba' });
    }
    function send() {
      var txt = (input || '').trim();
      if (!txt || busy || !lab || noProv) return;
      setBusy(true); setInput(''); setMeta(null);
      var history = [];
      items.forEach(function (it) {
        if (it.type === 'user') history.push({ role: 'user', content: it.text });
        else if (it.type === 'text' && it.text) history.push({ role: 'assistant', content: it.text });
      });
      history.push({ role: 'user', content: txt });
      push({ type: 'user', text: txt });
      var ctx = { meta: null };
      function fail(status, e) {
        if (!alive.current) return;
        setBusy(false);
        var msg = (e && (e.error || e.message)) || '';
        if (status === 429 || status === 402 || /quota|kredit/i.test(msg)) push({ type: 'error', text: 'Elfogyott a kreditkereted ehhez a szolgáltatáshoz — jelezd az oktatónak.' + (msg ? ' (' + msg + ')' : '') });
        else if (status === 403) push({ type: 'error', text: msg || 'Ezt az eszközt/providert ez a labor nem engedélyezi.' });
        else push({ type: 'error', text: 'Az mcp-bridge nem elérhető' + (msg ? ' — ' + msg : '') + '.' });
      }
      function finish() {
        if (!alive.current) return;
        closeText(); setBusy(false);
        if (ctx.meta) {
          setMeta(ctx.meta);
          if (ctx.meta.auditWarning) toast('⚠ ' + ctx.meta.auditWarning, { kind: 'warn' });
        }
        if (props.onBudgets) props.onBudgets();   // the call debited credits → refresh the bars
      }
      sb.auth.getSession().then(function (s) {
        var token = (s && s.data && s.data.session && s.data.session.access_token) || CFG.supabaseAnonKey;
        var wire = PROV_CANON[prov] || prov;       // canonical provider name on the wire
        var isImg = wire === 'gemini-image';       // gemini-image: plain JSON response, NOT a stream
        fetch(CFG.supabaseUrl + '/functions/v1/mcp-bridge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': CFG.supabaseAnonKey, 'Authorization': 'Bearer ' + token },
          body: JSON.stringify({ course_id: props.course.id, assignment_id: lab.id, provider: wire, messages: history, stream: !isImg })
        }).then(function (resp) {
          if (!resp.ok) { resp.json().then(function (e) { fail(resp.status, e); }, function () { fail(resp.status, null); }); return; }
          if (isImg) {
            // contract: {ok:true, media_path, mime:'image/png', model, credits, call_log_id}
            resp.json().then(function (res) {
              if (!alive.current) return;
              if (!res || res.ok !== true || res.error) { fail(0, res); return; }
              handleEvent({
                type: 'media', media_path: res.media_path, mime: res.mime || 'image/png',
                model: res.model, call_log_id: res.call_log_id, credits: res.credits
              }, ctx);
              ctx.meta = { callLogId: res.call_log_id, credits: res.credits, service: res.service || 'image', model: res.model, auditWarning: res.audit_warning || null };
              finish();
            }, function () { fail(0, null); });
            return;
          }
          if (!resp.body || !resp.body.getReader) { fail(0, null); return; }
          var reader = resp.body.getReader(), dec = new TextDecoder(), buf = '', sawSse = false;
          function handleLine(line) {
            line = line.replace(/\r$/, '');
            if (!line) return;
            if (line.indexOf('data:') === 0) {
              sawSse = true;
              var p = line.slice(5).trim();
              if (!p || p === '[DONE]') return;
              try { handleEvent(JSON.parse(p), ctx); } catch (e) { appendText(p); }
              return;
            }
            if (/^(event|id|retry):/.test(line)) return;   // SSE metadata lines
            if (!sawSse) appendText(line + '\n');          // plain-text stream fallback (research-chat style)
          }
          (function pump() {
            reader.read().then(function (r) {
              if (!alive.current) return;
              if (r.done) { if (buf) handleLine(buf); finish(); return; }
              buf += dec.decode(r.value, { stream: true });
              var lines = buf.split('\n'); buf = lines.pop();
              lines.forEach(handleLine);
              pump();
            }, function () { finish(); });
          })();
        }, function () { fail(0, null); });
      });
    }
    // the user prompt that PRECEDES a media item = its provenance prompt
    function promptFor(idx) {
      for (var j = idx - 1; j >= 0; j--) if (items[j].type === 'user') return items[j].text;
      return null;
    }
    function toCanvas(it, idx) {
      var row = {
        course_id: props.course.id, lecture_id: lab.lecture_id, author_id: props.meId,
        kind: /^video/.test(it.mime || '') ? 'video' : /^audio/.test(it.mime || '') ? 'audio' : 'image',
        media_path: it.path, media_url: it.url, title: lab.title || null,
        prompt: promptFor(idx) || '(prompt nélkül)',
        model: it.model || (meta && meta.model) || profile.model_max || 'ismeretlen',
        provider: prov, params: it.params || {},
        call_log_id: it.callLogId != null ? it.callLogId : (meta && meta.callLogId != null ? meta.callLogId : null),
        x: 40 + Math.round(Math.random() * 480), y: 40 + Math.round(Math.random() * 320)
      };
      sb.from('course_canvas_items').insert(row).select('id').maybeSingle().then(function (r) {
        if (r && r.error) { toast('Nem került a vászonra: ' + r.error.message, { kind: 'error' }); return; }
        var cid = r && r.data && r.data.id;
        setItems(function (l) { var nl = l.slice(); nl[idx] = Object.assign({}, nl[idx], { canvasId: cid }); return nl; });
        toast('Kint van az évfolyam-vásznon 🖼', { kind: 'ok' });
      });
    }
    function submitMedia(it) {
      var logIds = [];
      if (it.callLogId != null) logIds.push(it.callLogId);
      else if (meta && meta.callLogId != null) logIds.push(meta.callLogId);
      var row = {
        assignment_id: lab.id, course_id: props.course.id, user_id: props.meId,
        kind: 'media', media_path: it.path || null, media_mime: it.mime || null,
        canvas_item_id: it.canvasId || null, call_log_ids: logIds.length ? logIds : null,
        status: 'submitted', updated_at: new Date().toISOString()
      };
      if (!it.path && it.url) { row.kind = 'link'; row.link_url = it.url; }
      if (lab.team_based && props.team) row.team = props.team;
      sb.from('lab_submissions').upsert(row, { onConflict: 'assignment_id,user_id' }).then(function (r) {
        if (r && r.error) { toast('Beadás sikertelen: ' + r.error.message, { kind: 'error' }); return; }
        toast('Beadva ✔ — a labor állapota frissült', { kind: 'ok' });
        if (props.onSubmitted) props.onSubmitted();
      });
    }
    function renderItem(it, idx) {
      if (it.type === 'user') return h('div', { key: idx, className: 'msg user' }, it.text);
      if (it.type === 'text') return h('div', { key: idx, className: 'msg ai md', dangerouslySetInnerHTML: { __html: mdHtml(it.text) } });
      if (it.type === 'error') return h('div', { key: idx, className: 'msg err' }, '⚠ ' + it.text);
      if (it.type === 'tool') return h('div', { key: idx, className: 'tool' },
        h('div', { className: 'th' }, h('span', { className: 'tk' }, 'tool'), it.name,
          it.server ? h('span', { style: { marginLeft: 'auto' } }, it.server) : null,
          h('span', { style: it.server ? {} : { marginLeft: 'auto' } }, it.running ? '⏳' : (it.ok === false ? '✕' : '✓'))),
        it.input ? h('div', { className: 'tb', style: { fontFamily: 'ui-monospace,Menlo,monospace', fontSize: 11 } }, JSON.stringify(it.input).slice(0, 400)) : null);
      if (it.type === 'media') return h('div', { key: idx, className: 'tool' },
        h('div', { className: 'th' }, h('span', { className: 'tk' }, 'eredmény'), it.tool || 'média',
          it.callLogId != null ? h('span', { style: { marginLeft: 'auto' } }, 'call_log #' + it.callLogId) : null),
        h('div', { className: 'tb' },
          h(MediaBox, { path: it.path, url: it.url, mime: it.mime }),
          h('div', { className: 'meta' },
            it.canvasId ? chip('✓ kint a vásznon', 'ok') : h('button', { className: 'btn sm pri', onClick: function () { toCanvas(it, idx); } }, '🖼 Vászonra teszem'),
            h('button', { className: 'btn sm', onClick: function () { submitMedia(it); } }, '📤 Beadom'))));
      return null;
    }
    // credit price line from the lab's mcp_profile.credit_cost
    var costMap = {}, cc = profile.credit_cost || {};
    Object.keys(cc).forEach(function (k) { var svc = serviceOf(k); var v = +cc[k]; if (!isNaN(v) && (costMap[svc] == null || v > costMap[svc])) costMap[svc] = v; });
    var costBits = SERVICES.filter(function (s) { return costMap[s] != null; }).map(function (s) { return SVC_HU[s] + ' −' + costMap[s]; });
    var costLine;
    if (meta && meta.callLogId != null) {
      var left = null;
      (props.budgets || []).forEach(function (b) { if (b.service === meta.service) left = Math.max(0, (+b.granted || 0) - (+b.used || 0)); });
      costLine = 'kredit: ' + (SVC_HU[meta.service] || meta.service || 'LLM') + ' −' + (meta.credits != null ? meta.credits : '?')
        + (left != null ? ' → ' + left + ' marad' : '') + ' · call_log #' + meta.callLogId;
    } else costLine = (costBits.length ? 'kredit-árak: ' + costBits.join(' · ') + ' · ' : '') + 'minden hívás auditált (mcp_call_log)';
    return h('aside', { className: 'mcp card', 'aria-label': 'MCP-hívó panel' },
      h('div', { className: 'mcp-h' }, h('span', { className: 'dot' }), 'MCP-panel',
        h('span', { style: { marginLeft: 'auto', display: 'flex', gap: 5, flexWrap: 'wrap' } },
          providers.map(function (p) { return h('button', { key: p, className: 'chip' + (p === prov ? ' acc' : ''), onClick: function () { setProvider(p); } }, PROV_HU[p] || p); }))),
      lab ? h('div', { className: 'mcp-sub' }, lab.title + (noProv ? ' · nincs MCP-profil' : ' · labor-profil ✓')) : null,
      h('div', { className: 'mcp-b', ref: scrollRef },
        items.length ? items.map(renderItem) : h('div', { className: 'mcp-empty' },
          !lab ? 'Válassz labort a füzetben („MCP-panelre”) — utána itt tudsz generálni.'
            : noProv ? 'Ehhez a laborhoz az oktató még nem állított be MCP-profilt.'
              : 'Írd be a promptot — a hívás a labor MCP-profilja szerint, auditáltan fut. Kép/hang/videó eredménynél egy kattintás a vászonra tenni vagy beadni.'),
        busy ? h('div', { className: 'msg ai', style: { color: 'var(--faint)' } }, 'Folyamatban…') : null),
      h('div', { className: 'mcp-actions' },
        h('textarea', {
          className: 'in', rows: 2, value: input, disabled: !lab || busy || noProv,
          placeholder: !lab ? 'Előbb válassz labort' : noProv ? 'Ehhez a laborhoz az oktató még nem állított be MCP-profilt.' : 'Prompt…  (Enter küldés · Shift+Enter új sor)',
          onChange: function (e) { setInput(e.target.value); },
          onKeyDown: function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }
        }),
        h('button', { className: 'btn pri', disabled: !lab || busy || noProv || !input.trim(), onClick: send }, 'Küldés')),
      h('div', { className: 'mcp-cost' }, costLine));
  }

  // ---------- instructor: submissions + rubric grading ----------
  function GradePanel(props) {
    var lab = props.lab || {}, sub = props.sub;
    var rubric = Array.isArray(lab.rubric) && lab.rubric.length ? lab.rubric : null;
    function initScores() {
      var s = {};
      if (rubric) rubric.forEach(function (r) { s[r.key] = (props.grade && props.grade.rubric_scores && props.grade.rubric_scores[r.key] != null) ? +props.grade.rubric_scores[r.key] : 0; });
      return s;
    }
    var scS = useState(initScores()), scores = scS[0], setScores = scS[1];
    var ptS = useState(props.grade ? +props.grade.points : 0), pts = ptS[0], setPts = ptS[1];
    var fbS = useState((props.grade && props.grade.feedback_md) || ''), fb = fbS[0], setFb = fbS[1];
    var bS = useState(false), busy = bS[0], setBusy = bS[1];
    useEffect(function () { setScores(initScores()); setPts(props.grade ? +props.grade.points : 0); setFb((props.grade && props.grade.feedback_md) || ''); }, [(sub && sub.id) || '']);
    var total = rubric ? rubric.reduce(function (a, r) { return a + (+scores[r.key] || 0); }, 0) : (+pts || 0);
    function bump(r, d) {
      setScores(function (s) {
        var n = Object.assign({}, s);
        n[r.key] = Math.max(0, Math.min(+r.points || 0, Math.round(((+n[r.key] || 0) + d) * 2) / 2));
        return n;
      });
    }
    function save() {
      setBusy(true);
      courseOps({ action: 'grade', course_id: props.course.id, submission_id: sub.id, points: total, rubric_scores: rubric ? scores : null, feedback_md: fb.trim() || null }, function () {
        // direct-RLS fallback (lg_write policy) while course-ops is not deployed
        return sb.from('lab_grades').upsert({
          submission_id: sub.id, course_id: props.course.id, grader_id: props.meId,
          points: total, rubric_scores: rubric ? scores : null, feedback_md: fb.trim() || null
        }, { onConflict: 'submission_id' }).then(function (r) {
          if (r && r.error) return { error: r.error.message };
          return sb.from('lab_submissions').update({ status: 'graded', updated_at: new Date().toISOString() }).eq('id', sub.id).then(function () { return { ok: true }; });
        });
      }).then(function (res) {
        setBusy(false);
        if (res && res.error) { toast('Az értékelés mentése nem sikerült: ' + res.error, { kind: 'error' }); return; }
        toast('Értékelés mentve ✔', { kind: 'ok' });
        props.onSaved();
      });
    }
    var prov = (sub.call_log_ids || []).length;
    return h('div', { className: 'co-card card' },
      h('h3', null, 'Értékelés — ' + (props.name || 'hallgató')),
      h('div', { style: { fontSize: 11.5, color: 'var(--faint)', margin: '2px 0 10px' } }, (lab.title || 'labor') + ' · beadva: ' + fmtT(sub.submitted_at)),
      h('div', { className: 'form-l' }, 'Beadott munka'),
      sub.body_text ? h('div', { className: 'md', style: { maxHeight: 180, overflow: 'auto' }, dangerouslySetInnerHTML: { __html: mdHtml(sub.body_text) } }) : null,
      sub.link_url ? h('div', { style: { fontSize: 12.5, margin: '4px 0' } }, h('a', { href: sub.link_url, target: '_blank', rel: 'noopener' }, sub.link_url)) : null,
      sub.media_path ? h(MediaBox, { path: sub.media_path, mime: sub.media_mime, height: 180 }) : null,
      h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', margin: '8px 0 4px' } },
        prov ? chip('✓ ' + prov + ' auditált hívás', 'ok', 'p1') : chip('⚠ nincs platform-provenance', 'warn', 'p2'),
        sub.canvas_item_id ? chip('🖼 vászonról beadva', 'acc', 'p3') : null,
        sub.team ? chip('👥 ' + sub.team, '', 'p4') : null),
      h('div', { className: 'form-l' }, rubric ? 'Rubrika' : 'Pontszám'),
      rubric ? rubric.map(function (r) {
        return h('div', { className: 'rub', key: r.key },
          h('span', null, r.label || r.key),
          h('span', { className: 'pts' },
            h('button', { onClick: function () { bump(r, -0.5); }, 'aria-label': 'kevesebb' }, '−'),
            h('b', null, (+scores[r.key] || 0) + ' / ' + (+r.points || 0)),
            h('button', { onClick: function () { bump(r, 0.5); }, 'aria-label': 'több' }, '+')));
      }) : h('input', { className: 'in', type: 'number', min: 0, max: +lab.points_max || 10, step: 0.5, value: pts, onChange: function (e) { setPts(e.target.value); }, style: { width: 110 } }),
      h('textarea', { className: 'in', rows: 3, style: { marginTop: 10 }, placeholder: 'Szöveges visszajelzés (markdown)…', value: fb, onChange: function (e) { setFb(e.target.value); } }),
      h('div', { className: 'gtotal' },
        h('span', null, 'Összpontszám'),
        h('b', null, total + ' / ' + (+lab.points_max || 10))),
      h('div', { style: { display: 'flex', justifyContent: 'flex-end', marginTop: 10 } },
        h('button', { className: 'btn pri', disabled: busy, onClick: save }, busy ? 'Mentés…' : (props.grade ? 'Értékelés frissítése' : 'Értékelés mentése'))));
  }

  function SubmissionsTab(props) {
    var course = props.course;
    var lsS = useState(null), list = lsS[0], setList = lsS[1];
    var grS = useState({}), grades = grS[0], setGrades = grS[1];
    var nmS = useState({}), names = nmS[0], setNames = nmS[1];
    var selS = useState(null), sel = selS[0], setSel = selS[1];
    var labById = {}; (props.labs || []).forEach(function (a) { labById[a.id] = a; });
    var lecById = {}; (props.lectures || []).forEach(function (l) { lecById[l.id] = l; });
    useEffect(function () { load(); }, [course.id]);
    function load() {
      Promise.all([
        sb.from('lab_submissions').select('*').eq('course_id', course.id).order('submitted_at', { ascending: false }),
        sb.from('lab_grades').select('*').eq('course_id', course.id)
      ]).then(function (res) {
        var rows = ((res[0] || {}).data) || [];
        var g = {}; (((res[1] || {}).data) || []).forEach(function (x) { g[x.submission_id] = x; });
        setList(rows); setGrades(g);
        if (sel) { var still = rows.filter(function (r) { return r.id === sel.id; })[0]; setSel(still || null); }
        fetchNames(rows.map(function (r) { return r.user_id; })).then(setNames);
      });
    }
    function labName(aid) {
      var lab = labById[aid]; if (!lab) return '—';
      var lec = lecById[lab.lecture_id];
      return (lec ? lec.ord + '. ea · ' : '') + lab.title;
    }
    if (list === null) return h('div', { className: 'soon' }, 'Beadások betöltése…');
    // team_based labs: one team's submissions form one contiguous, marked block
    var displayRows = [], seenTeam = {};
    list.forEach(function (s) {
      var lb = labById[s.assignment_id];
      var tkey = (lb && lb.team_based && s.team) ? s.team : null;
      if (!tkey) { displayRows.push({ s: s }); return; }
      if (seenTeam[tkey]) return;
      seenTeam[tkey] = true;
      displayRows.push({ teamHeader: tkey });
      list.forEach(function (x) {
        var lx = labById[x.assignment_id];
        if (lx && lx.team_based && x.team === tkey) displayRows.push({ s: x, team: tkey });
      });
    });
    return h('div', { className: 'subgrid' },
      h('div', { className: 'subtable card' }, h('table', null,
        h('thead', null, h('tr', null, ['Hallgató', 'Labor', 'Provenance', 'Státusz', 'Pont', 'Beadva'].map(function (t, i) { return h('th', { key: i }, t); }))),
        h('tbody', null, displayRows.length ? displayRows.map(function (d) {
          if (d.teamHeader) return h('tr', { key: 'team:' + d.teamHeader, className: 'teamrow' },
            h('td', { colSpan: 6, style: { fontSize: 11.5, fontWeight: 600, color: 'var(--muted)' } }, '👥 ' + d.teamHeader + ' — csapatbeadások'));
          var s = d.s, g = grades[s.id], nm = names[s.user_id] || '…', pv = (s.call_log_ids || []).length;
          return h('tr', { key: s.id, className: (sel && sel.id === s.id ? 'sel' : '') + (d.team ? ' inteam' : ''), onClick: function () { setSel(s); } },
            h('td', null, h('span', { className: 'stu' }, d.team ? h('span', { title: 'Csapat: ' + d.team, style: { marginRight: 4 } }, '👥') : null, h('i', null, initials(nm)), nm)),
            h('td', null, labName(s.assignment_id)),
            h('td', null, pv ? chip('✓ ' + pv + ' hívás', 'ok') : chip('⚠ nincs', 'warn')),
            h('td', null, subStatus(s, g)),
            h('td', null, g ? String(+g.points) : '—'),
            h('td', null, fmtT(s.submitted_at)));
        }) : h('tr', null, h('td', { colSpan: 6, style: { color: 'var(--faint)' } }, 'Még nincs beadás ebben a kurzusban.'))))),
      sel ? h(GradePanel, {
        key: sel.id, course: course, sub: sel, lab: labById[sel.assignment_id], grade: grades[sel.id],
        name: names[sel.user_id], meId: props.meId, onSaved: load
      }) : h('div', { className: 'soon' }, 'Válassz egy beadást a listából az értékeléshez.'));
  }

  // ---------- instructor: mcp_call_log audit feed ----------
  function AuditTab(props) {
    var course = props.course;
    var rwS = useState(null), rows = rwS[0], setRows = rwS[1];
    var nmS = useState({}), names = nmS[0], setNames = nmS[1];
    var fS = useState(''), who = fS[0], setWho = fS[1];
    useEffect(function () { load(); }, [course.id]);
    function load() {
      courseOps({ action: 'audit_feed', course_id: course.id, limit: 200 }, function () {
        // direct fallback — the mcl_read policy already lets the instructor read the course log
        return sb.from('mcp_call_log').select('id,user_id,assignment_id,provider,server,tool,model,prompt,credits,status,created_at')
          .eq('course_id', course.id).order('created_at', { ascending: false }).limit(200)
          .then(function (r) { return (r && r.error) ? { error: r.error.message } : { rows: (r && r.data) || [] }; });
      }).then(function (res) {
        if (res && res.error) { setRows([]); toast('Audit-napló nem elérhető: ' + res.error, { kind: 'warn' }); return; }
        var list = (res && (res.calls || res.rows || res.items || res.data)) || (Array.isArray(res) ? res : []);
        setRows(list);
        fetchNames(list.map(function (x) { return x.user_id; })).then(setNames);
      });
    }
    function statusChip(st) {
      if (st === 'ok') return chip('ok', 'ok');
      if (st === 'error') return chip('hiba', 'danger');
      if (st && st.indexOf('denied') === 0) return chip(st === 'denied_quota' ? 'kvóta-tiltás' : 'eszköz-tiltás', 'warn');
      return chip(st || '—');
    }
    if (rows === null) return h('div', { className: 'soon' }, 'Audit-napló betöltése…');
    var uids = []; rows.forEach(function (r) { if (uids.indexOf(r.user_id) < 0) uids.push(r.user_id); });
    var shown = who ? rows.filter(function (r) { return r.user_id === who; }) : rows;
    return h('div', null,
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' } },
        h('span', { style: { fontSize: 12.5, color: 'var(--muted)' } }, 'A napló hamisíthatatlan (service-írás) — a tiltott próbálkozás is esemény.'),
        h('span', { className: 'sp' }),
        h('select', { className: 'in', value: who, onChange: function (e) { setWho(e.target.value); } },
          h('option', { value: '' }, 'Minden hallgató'),
          uids.map(function (u) { return h('option', { key: u, value: u }, names[u] || u.slice(0, 8)); })),
        h('button', { className: 'btn sm', onClick: load }, '↻ Frissítés')),
      h('div', { className: 'subtable card' }, h('table', null,
        h('thead', null, h('tr', null, ['Idő', 'Hallgató', 'Provider', 'Eszköz', 'Modell', 'Kredit', 'Státusz', 'Prompt'].map(function (t, i) { return h('th', { key: i }, t); }))),
        h('tbody', null, shown.length ? shown.map(function (r) {
          return h('tr', { key: r.id, style: { cursor: 'default' } },
            h('td', null, fmtT(r.created_at)),
            h('td', null, names[r.user_id] || '…'),
            h('td', null, PROV_HU[r.provider] || r.provider || '—'),
            h('td', null, (r.server ? r.server + '.' : '') + (r.tool || 'llm')),
            h('td', null, r.model || '—'),
            h('td', null, r.credits != null ? String(+r.credits) : '0'),
            h('td', null, statusChip(r.status)),
            h('td', null, h('div', { className: 'prompt-cell', title: r.prompt || '' }, r.prompt || '—')));
        }) : h('tr', null, h('td', { colSpan: 8, style: { color: 'var(--faint)' } }, 'Még nincs naplózott MCP-hívás.'))))));
  }

  // ---------- instructor: poll admin (course_polls / course_poll_votes, migration-68) ----------
  function PollsTab(props) {
    var course = props.course, lectures = props.lectures || [];
    var plS = useState(null), polls = plS[0], setPolls = plS[1];
    var vcS = useState({}), votes = vcS[0], setVotes = vcS[1];     // poll_id → count
    var rsS = useState({}), results = rsS[0], setResults = rsS[1]; // poll_id → {top:[{votes,title,author}]}
    var fS = useState({ title: '', category: '', lecture_id: '', max: 3 }), f = fS[0], setF = fS[1];
    var bS = useState(false), busy = bS[0], setBusy = bS[1];
    useEffect(function () { load(); }, [course.id]);
    function up(k, v) { setF(function (p) { var n = Object.assign({}, p); n[k] = v; return n; }); }
    function load() {
      sb.from('course_polls').select('*').eq('course_id', course.id).order('created_at', { ascending: false }).then(function (r) {
        if (r && r.error) { setPolls([]); return; }   // table not migrated yet → empty state
        var list = (r && r.data) || []; setPolls(list);
        var ids = list.map(function (p) { return p.id; });
        if (!ids.length) { setVotes({}); return; }
        sb.from('course_poll_votes').select('poll_id').in('poll_id', ids).then(function (vr) {
          var m = {}; (((vr || {}).data) || []).forEach(function (v) { m[v.poll_id] = (m[v.poll_id] || 0) + 1; });
          setVotes(m);
        }, function () { });
      }, function () { setPolls([]); });
    }
    function create() {
      if (!f.title.trim() || busy) return;
      setBusy(true);
      var row = { course_id: course.id, title: f.title.trim(), category: f.category.trim() || null, lecture_id: f.lecture_id || null, max_votes_per_voter: +f.max || 3 };
      // course-ops expects max_votes; the row keeps max_votes_per_voter for the direct-RLS fallback
      courseOps(Object.assign({ action: 'create_poll', max_votes: +f.max || 3 }, row), function () {
        return sb.from('course_polls').insert(Object.assign({ status: 'open' }, row)).then(function (r) { return (r && r.error) ? { error: r.error.message } : { ok: true }; });
      }).then(function (res) {
        setBusy(false);
        if (res && res.error) { toast('A szavazás létrehozása nem sikerült: ' + res.error, { kind: 'error' }); return; }
        toast('Szavazás elindítva 🗳', { kind: 'ok' });
        setF({ title: '', category: '', lecture_id: '', max: 3 });
        load();
      });
    }
    function setStatus(p, st) {
      courseOps({ action: 'set_poll_status', course_id: course.id, poll_id: p.id, status: st }, function () {
        return sb.from('course_polls').update({ status: st }).eq('id', p.id).then(function (r) { return (r && r.error) ? { error: r.error.message } : { ok: true }; });
      }).then(function (res) {
        if (res && res.error) { toast('Nem sikerült: ' + res.error, { kind: 'error' }); return; }
        toast(st === 'open' ? 'Szavazás újranyitva' : 'Szavazás lezárva — eredmény lent', { kind: 'ok' });
        load();
        if (st === 'closed') {
          // prefer the server-computed tally (course-ops returns a results array on close)
          if (res && Array.isArray(res.results)) enrichResults(p.id, res.results.slice(0, 3).map(function (t) { return { item_id: t.item_id, votes: +t.votes || 0 }; }));
          else loadResults(Object.assign({}, p, { status: 'closed' }));
        }
      });
    }
    // decorate a ranked [{item_id, votes}] list with canvas-item titles + author names, then store it
    function enrichResults(pollId, top) {
      function done(list) { setResults(function (m) { var n = Object.assign({}, m); n[pollId] = { top: list }; return n; }); }
      if (!top.length) { done([]); return; }
      sb.from('course_canvas_items').select('id,title,prompt,kind,author_id').in('id', top.map(function (t) { return t.item_id; })).then(function (ir) {
        var by = {}; (((ir || {}).data) || []).forEach(function (i) { by[i.id] = i; });
        fetchNames((((ir || {}).data) || []).map(function (i) { return i.author_id; })).then(function (nm) {
          top.forEach(function (t) {
            var it = by[t.item_id] || {};
            t.title = it.title || (it.prompt || '').slice(0, 60) || 'vászon-elem';
            t.author = nm[it.author_id] || 'hallgató';
          });
          done(top);
        });
      }, function () { done(top); });
    }
    function loadResults(p) {
      sb.from('course_poll_votes').select('item_id').eq('poll_id', p.id).then(function (r) {
        var tally = {}; (((r || {}).data) || []).forEach(function (v) { tally[v.item_id] = (tally[v.item_id] || 0) + 1; });
        var top = Object.keys(tally).map(function (k) { return { item_id: k, votes: tally[k] }; })
          .sort(function (a, b) { return b.votes - a.votes; }).slice(0, 3);
        enrichResults(p.id, top);
      });
    }
    var MEDALS = ['🥇', '🥈', '🥉'];
    return h('div', null,
      h('div', { className: 'co-card card', style: { marginBottom: 12 } },
        h('h3', null, 'Új szavazás'),
        h('div', { style: { fontSize: 12, color: 'var(--muted)', margin: '4px 0 8px' } },
          'Szabályok: csak kurzustag szavazhat, saját munkára nem, fejenként legfeljebb a megadott számú szavazat; a szavazók a társak felé anonimak, te látod őket. A hallgatók az évfolyam-vásznon szavaznak.'),
        h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' } },
          h('div', { style: { flex: 2, minWidth: 200 } }, h('div', { className: 'form-l' }, 'Cím *'),
            h('input', { className: 'in', style: { width: '100%' }, placeholder: 'pl. Prompt-bajnokság — 7. labor', value: f.title, onChange: function (e) { up('title', e.target.value); } })),
          h('div', { style: { flex: 1, minWidth: 140 } }, h('div', { className: 'form-l' }, 'Kategória'),
            h('input', { className: 'in', style: { width: '100%' }, placeholder: 'pl. legjobb kép', value: f.category, onChange: function (e) { up('category', e.target.value); } })),
          h('div', null, h('div', { className: 'form-l' }, 'Előadás-lap'),
            h('select', { className: 'in', value: f.lecture_id, onChange: function (e) { up('lecture_id', e.target.value); } },
              h('option', { value: '' }, 'Egész kurzus'),
              lectures.map(function (l) { return h('option', { key: l.id, value: l.id }, l.ord + ' · ' + l.title); }))),
          h('div', null, h('div', { className: 'form-l' }, 'Max szavazat/fő'),
            h('input', { className: 'in', type: 'number', min: 1, max: 10, style: { width: 90 }, value: f.max, onChange: function (e) { up('max', e.target.value); } })),
          h('button', { className: 'btn pri', disabled: busy || !f.title.trim(), onClick: create }, busy ? 'Indítás…' : '🗳 Indítás'))),
      polls === null ? h('div', { className: 'soon' }, 'Szavazások betöltése…')
        : !polls.length ? h('div', { className: 'soon' }, 'Még nincs szavazás. Indíts egyet fent — pl. a 12. heti díjakhoz vagy egy prompt-bajnoksághoz.')
          : polls.map(function (p) {
            var lec = lectures.filter(function (l) { return l.id === p.lecture_id; })[0];
            var res = results[p.id];
            return h('div', { className: 'co-card card', key: p.id, style: { marginBottom: 10 } },
              h('div', { className: 'lab-h', style: { marginBottom: 4 } },
                h('h3', null, p.title),
                p.category ? chip(p.category, 'acc', 'c') : null,
                chip(lec ? lec.ord + '. előadás' : 'egész kurzus', '', 's'),
                chip('max ' + (p.max_votes_per_voter || 3) + '/fő', '', 'm'),
                p.status === 'open' ? chip('nyitva', 'ok', 'o') : chip('lezárva', 'warn', 'z'),
                h('span', { className: 'sp' }),
                chip((votes[p.id] || 0) + ' szavazat', '', 'v'),
                p.status === 'open'
                  ? h('button', { className: 'btn sm', onClick: function () { setStatus(p, 'closed'); } }, '⏹ Lezárás + eredmény')
                  : h('span', { style: { display: 'flex', gap: 6 } },
                    h('button', { className: 'btn sm', onClick: function () { loadResults(p); } }, '🏆 Eredmény'),
                    h('button', { className: 'btn sm', onClick: function () { setStatus(p, 'open'); } }, '▶ Újranyitás'))),
              res ? (res.top.length ? h('div', { style: { marginTop: 6 } }, res.top.map(function (t, i) {
                return h('div', { key: t.item_id, style: { display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0', fontSize: 13 } },
                  h('span', null, MEDALS[i] || (i + 1) + '.'),
                  h('b', null, t.author),
                  h('span', { style: { color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 } }, t.title),
                  chip(t.votes + ' szavazat', 'acc'));
              })) : h('div', { style: { fontSize: 12.5, color: 'var(--faint)', marginTop: 6 } }, 'Erre a szavazásra nem érkezett szavazat.')) : null);
          }));
  }

  // ---------- instructor: bulk credit grants + usage matrix ----------
  function CreditsTab(props) {
    var course = props.course;
    var gS = useState({ llm: 400, image: 40, video: 6, audio: 20, search: 60 }), grants = gS[0], setGrants = gS[1];
    var rwS = useState(null), rows = rwS[0], setRows = rwS[1];
    var nmS = useState({}), names = nmS[0], setNames = nmS[1];
    var bS = useState(false), busy = bS[0], setBusy = bS[1];
    useEffect(function () { load(); }, [course.id]);
    function load() {
      sb.from('course_credit_budgets').select('*').eq('course_id', course.id).then(function (r) {
        var list = (r && r.data) || [];
        setRows(list);
        fetchNames(list.map(function (x) { return x.user_id; })).then(setNames);
      }, function () { setRows([]); });
    }
    function apply() {
      var doIt = function () {
        setBusy(true);
        courseOps({ action: 'set_budget_bulk', course_id: course.id, budgets: SERVICES.map(function (s) { return { service: s, granted: +grants[s] || 0 }; }) }, function () {
          // direct fallback: instructor may upsert budget rows (ccb_write policy)
          return sb.from('course_enrollments').select('user_id,role,status').eq('course_id', course.id).then(function (r) {
            if (r && r.error) return { error: r.error.message };
            var studs = ((r && r.data) || []).filter(function (e) { return e.status === 'active' && e.role === 'hallgato'; });
            if (!studs.length) return { error: 'nincs aktív hallgató a kurzusban' };
            var up = [];
            studs.forEach(function (e) {
              SERVICES.forEach(function (svc) { up.push({ course_id: course.id, user_id: e.user_id, service: svc, granted: +grants[svc] || 0, updated_at: new Date().toISOString() }); });
            });
            return sb.from('course_credit_budgets').upsert(up, { onConflict: 'course_id,user_id,service' })
              .then(function (rr) { return (rr && rr.error) ? { error: rr.error.message } : { ok: true, count: studs.length }; });
          });
        }).then(function (res) {
          setBusy(false);
          if (res && res.error) { toast('Kreditkiosztás sikertelen: ' + res.error, { kind: 'error' }); return; }
          toast('Kreditkeret kiosztva ✔', { kind: 'ok' });
          load();
        });
      };
      if (window.PRUI && window.PRUI.confirm) {
        window.PRUI.confirm({ title: 'Kreditkeret kiosztása', body: 'Minden aktív hallgató féléves keretét a megadott értékekre állítod (a már felhasznált kredit megmarad).', confirmLabel: 'Kiosztás' })
          .then(function (ok) { if (ok) doIt(); });
      } else doIt();
    }
    // pivot: user → service → {granted, used}
    var byUser = {};
    (rows || []).forEach(function (r) { (byUser[r.user_id] = byUser[r.user_id] || {})[r.service] = r; });
    var uids = Object.keys(byUser);
    return h('div', null,
      h('div', { className: 'co-card card', style: { marginBottom: 12 } },
        h('h3', null, 'Féléves keret (szolgáltatásonként, hallgatónként)'),
        h('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 8 } },
          SERVICES.map(function (svc) {
            return h('div', { key: svc },
              h('div', { className: 'form-l' }, SVC_HU[svc]),
              h('input', { className: 'in', type: 'number', min: 0, style: { width: 90 }, value: grants[svc], onChange: function (e) { var v = e.target.value; setGrants(function (g) { var n = Object.assign({}, g); n[svc] = v; return n; }); } }));
          }),
          h('button', { className: 'btn pri', disabled: busy, onClick: apply }, busy ? 'Kiosztás…' : '💳 Kiosztás minden hallgatónak'))),
      rows === null ? h('div', { className: 'soon' }, 'Keretek betöltése…')
        : !uids.length ? h('div', { className: 'soon' }, 'Még nincs kiosztott kreditkeret — használd a fenti űrlapot.')
          : h('div', { className: 'subtable card' }, h('table', null,
            h('thead', null, h('tr', null, [h('th', { key: 'n' }, 'Hallgató')].concat(SERVICES.map(function (s) { return h('th', { key: s }, SVC_HU[s] + ' (használt/keret)'); })))),
            h('tbody', null, uids.map(function (u) {
              var nm = names[u] || u.slice(0, 8);
              return h('tr', { key: u, style: { cursor: 'default' } },
                h('td', null, h('span', { className: 'stu' }, h('i', null, initials(nm)), nm)),
                SERVICES.map(function (svc) {
                  var b = byUser[u][svc];
                  return h('td', { key: svc }, b ? (+b.used || 0) + ' / ' + (+b.granted || 0) : '—');
                }));
            })))));
  }

  // ---------- instructor console shell ----------
  function TeacherView(props) {
    var tS = useState('sub'), tab = tS[0], setTab = tS[1];
    var TABS = [['sub', '📥 Beadások'], ['audit', '🛡️ Audit'], ['polls', '🗳 Szavazások'], ['credits', '💳 Kreditek']];
    return h('div', { className: 'teach' },
      h('div', null, h('span', { className: 'seg' }, TABS.map(function (t) {
        return h('button', { key: t[0], className: tab === t[0] ? 'on' : '', onClick: function () { setTab(t[0]); } }, t[1]);
      }))),
      tab === 'sub' ? h(SubmissionsTab, props)
        : tab === 'audit' ? h(AuditTab, props)
          : tab === 'polls' ? h(PollsTab, props)
            : h(CreditsTab, props));
  }

  // ---------- course management: create a course, assign people as Előadó / Hallgató ----------
  // Roles are course_enrollments.role: 'oktato' = Előadó (→ course_is_instructor, may manage the course) and
  // 'hallgato' = Hallgató; a legacy 'demonstrator' row is shown but not offered. RLS decides who may do what:
  // only an admin creates a course (courses_insert), an admin or the course's lecturers manage members (ce_write).
  // People search: an admin reads profiles directly (admin policy); a lecturer uses pr_search_users, the
  // isolation-safe RPC (name only) — the migration-31/32/33 profile lockdown stays untouched.
  var ROLE_HU = { oktato: 'Előadó', demonstrator: 'Demonstrátor', hallgato: 'Hallgató' };
  function isAdminUser() {
    var u = BE && BE.user;
    if (u && u.role) return u.role === 'admin';
    try { return !!(window.PREnt && window.PREnt.role && window.PREnt.role() === 'admin'); } catch (e) { return false; }
  }
  function slugify(t) { return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48); }
  function fmtDay(x) { if (!x) return ''; try { var d = new Date(x); return isNaN(d) ? String(x) : d.toLocaleDateString('hu-HU', { year: 'numeric', month: 'short', day: 'numeric' }); } catch (e) { return String(x); } }
  function urlCourse() { try { return new URLSearchParams(location.search).get('course'); } catch (e) { return null; } }

  function CreateCourseModal(props) {
    var fS = useState({ title: '', description: '', semester: '', starts_on: '', ends_on: '' }), f = fS[0], setF = fS[1];
    var bS = useState(false), busy = bS[0], setBusy = bS[1];
    var eS = useState(''), err = eS[0], setErr = eS[1];
    function up(k, v) { setErr(''); setF(function (o) { var n = Object.assign({}, o); n[k] = v; return n; }); }
    useEffect(function () {
      function onKey(e) { if (e.key === 'Escape' && !busy) props.onClose(); }
      window.addEventListener('keydown', onKey);
      return function () { window.removeEventListener('keydown', onKey); };
    });
    function save() {
      var title = f.title.trim();
      if (!title || busy) return;
      if (f.starts_on && f.ends_on && f.ends_on < f.starts_on) { setErr('A befejezés nem lehet korábbi a kezdésnél.'); return; }
      setBusy(true); setErr('');
      var base = slugify(title);
      var row = {
        title: title, slug: base ? base + '-' + Math.random().toString(36).slice(2, 6) : null,
        settings: { description: f.description.trim() || null, semester: f.semester.trim() || null, starts_on: f.starts_on || null, ends_on: f.ends_on || null, locale: 'hu' }
      };
      sb.from('courses').insert(row).select('id').maybeSingle().then(function (r) {
        setBusy(false);
        if (r && r.error) { setErr(/row-level security|permission|policy/i.test(r.error.message) ? 'Kurzust csak adminisztrátor hozhat létre.' : ('Nem sikerült létrehozni: ' + r.error.message)); return; }
        if (!r || !r.data) { setErr('A kurzus létrejött, de nem olvasható vissza — frissítsd az oldalt.'); return; }
        toast('✓ Kurzus létrehozva: ' + title, { kind: 'ok' });
        props.onCreated(r.data.id);
      }, function () { setBusy(false); setErr('Hálózati hiba — próbáld újra.'); });
    }
    return h('div', { className: 'co-scrim', onMouseDown: function (e) { if (e.target === e.currentTarget && !busy) props.onClose(); } },
      h('div', { className: 'co-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'nc-h' },
        h('div', { className: 'co-mh' }, h('b', { id: 'nc-h' }, 'Új kurzus'), h('button', { type: 'button', className: 'co-x', 'aria-label': 'Bezárás', disabled: busy, onClick: props.onClose }, '×')),
        h('div', { className: 'co-mb' },
          h('label', { className: 'form-l', htmlFor: 'nc-title' }, 'Cím *'),
          h('input', { id: 'nc-title', className: 'in', autoFocus: true, value: f.title, placeholder: 'pl. Mesterséges intelligencia alapok — 2026 ősz', onChange: function (e) { up('title', e.target.value); }, onKeyDown: function (e) { if (e.key === 'Enter') save(); } }),
          h('label', { className: 'form-l', htmlFor: 'nc-desc' }, 'Leírás'),
          h('textarea', { id: 'nc-desc', className: 'in', rows: 3, value: f.description, placeholder: 'Rövid leírás a résztvevőknek (nem kötelező)', onChange: function (e) { up('description', e.target.value); } }),
          h('div', { className: 'co-row' },
            h('div', null, h('label', { className: 'form-l', htmlFor: 'nc-sem' }, 'Félév'), h('input', { id: 'nc-sem', className: 'in', value: f.semester, placeholder: '2026/27/1', onChange: function (e) { up('semester', e.target.value); } })),
            h('div', null, h('label', { className: 'form-l', htmlFor: 'nc-start' }, 'Kezdés'), h('input', { id: 'nc-start', type: 'date', className: 'in', value: f.starts_on, onChange: function (e) { up('starts_on', e.target.value); } })),
            h('div', null, h('label', { className: 'form-l', htmlFor: 'nc-end' }, 'Befejezés'), h('input', { id: 'nc-end', type: 'date', className: 'in', value: f.ends_on, onChange: function (e) { up('ends_on', e.target.value); } }))),
          h('p', { className: 'co-note' }, 'Létrehozás után a Résztvevők fülön rendelheted hozzá az előadókat és a hallgatókat. A kurzus csatlakozási kódot is kap, amellyel a hallgatók maguk is beléphetnek.'),
          err ? h('p', { className: 'co-err', role: 'alert' }, err) : null),
        h('div', { className: 'co-mf' },
          h('button', { type: 'button', className: 'btn', disabled: busy, onClick: props.onClose }, 'Mégse'),
          h('button', { type: 'button', className: 'btn pri', disabled: busy || !f.title.trim(), onClick: save }, busy ? 'Létrehozás…' : 'Kurzus létrehozása'))));
  }

  function CourseHome(props) {
    var admin = props.admin, courses = props.courses || [], stats = props.stats || {}, myRoles = props.myRoles || {};
    var cS = useState(''), code = cS[0], setCode = cS[1];
    var jS = useState(false), joining = jS[0], setJoining = jS[1];
    var eS = useState(''), err = eS[0], setErr = eS[1];
    var mS = useState(false), creating = mS[0], setCreating = mS[1];
    function join() {
      var c = code.trim();
      if (!c || joining) return;
      setJoining(true); setErr('');
      sb.rpc('course_join', { p_code: c }).then(function (r) {
        setJoining(false);
        if (r && r.error) { setErr(/eltávolítottak/.test(r.error.message) ? r.error.message : 'Érvénytelen kurzuskód — ellenőrizd, és próbáld újra.'); return; }
        toast('Sikeres csatlakozás a kurzushoz 🎓', { kind: 'ok' });
        setCode(''); props.onJoined(r.data);
      }, function () { setJoining(false); setErr('Hálózati hiba — próbáld újra.'); });
    }
    function card(c) {
      var st = stats[c.id], role = myRoles[c.id], set = c.settings || {};
      function open() { props.onOpen(c.id); }
      return h('div', { key: c.id, className: 'course-card' + (c.active ? '' : ' off'), role: 'button', tabIndex: 0, onClick: open,
        onKeyDown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } } },
        h('div', { className: 'cc-top' },
          role ? chip(ROLE_HU[role] || role, role === 'hallgato' ? '' : 'acc', 'r') : (admin ? chip('Admin', 'warn', 'a') : null),
          c.locked ? chip('🔒 Azonosítás szükséges', 'warn', 'l') : null,
          c.active ? null : chip('Archivált', '', 'x')),
        h('div', { className: 'cc-t' }, c.title),
        set.description ? h('div', { className: 'cc-d' }, set.description) : null,
        h('div', { className: 'cc-meta' },
          set.semester ? h('span', null, '📅 ' + set.semester) : null,
          (set.starts_on || set.ends_on) ? h('span', null, (fmtDay(set.starts_on) || '…') + ' – ' + (fmtDay(set.ends_on) || '…')) : null,
          st ? h('span', null, '👥 ' + st.oktato + ' előadó · ' + st.hallgato + ' hallgató') : null));
    }
    return h('div', { className: 'co-wrap' },
      h('div', { className: 'home-h' },
        h('div', null,
          h('h1', null, '🎓 Kurzusok'),
          h('p', null, admin ? 'Adminisztrátorként minden kurzust látsz, és újat is létrehozhatsz.' : 'A kurzusok, amelyeknek előadója vagy hallgatója vagy.')),
        h('span', { className: 'sp' }),
        admin ? h('button', { type: 'button', className: 'btn pri', onClick: function () { setCreating(true); } }, '+ Új kurzus') : null),
      courses.length ? h('div', { className: 'course-grid' }, courses.map(card))
        : h('div', { className: 'soon' }, admin ? 'Még nincs kurzus. Hozd létre az elsőt a „+ Új kurzus” gombbal.' : 'Még nem vagy tagja egyetlen kurzusnak sem. Ha kaptál kurzuskódot, lent csatlakozhatsz.'),
      h('div', { className: 'co-card join-card' },
        h('h3', null, 'Csatlakozás kurzuskóddal'),
        h('p', { className: 'co-note' }, 'Az előadótól kapott kóddal hallgatóként csatlakozhatsz egy kurzushoz.'),
        h('div', { className: 'join-row' },
          h('input', { className: 'in', placeholder: 'Kurzuskód', value: code, 'aria-label': 'Kurzuskód', onChange: function (e) { setCode(e.target.value); }, onKeyDown: function (e) { if (e.key === 'Enter') join(); } }),
          h('button', { type: 'button', className: 'btn', disabled: joining || !code.trim(), onClick: join }, joining ? 'Csatlakozás…' : 'Csatlakozom')),
        err ? h('p', { className: 'co-err', role: 'alert' }, err) : null),
      creating ? h(CreateCourseModal, { onClose: function () { setCreating(false); }, onCreated: function (id) { setCreating(false); props.onCreated(id); } }) : null);
  }

  function MembersTab(props) {
    var course = props.course, admin = props.admin, meId = props.meId;
    var rS = useState(null), rows = rS[0], setRows = rS[1];                 // course_enrollments of this course
    var pS = useState({}), people = pS[0], setPeople = pS[1];               // user_id → { name, email?, affiliation?, is_student?, is_researcher? }
    var qS = useState(''), q = qS[0], setQ = qS[1];
    var kS = useState('all'), kind = kS[0], setKind = kS[1];                // admin search filter: all | student | researcher
    var resS = useState(null), results = resS[0], setResults = resS[1];
    var pkS = useState({}), pick = pkS[0], setPick = pkS[1];
    var nrS = useState('hallgato'), newRole = nrS[0], setNewRole = nrS[1];
    var bS = useState(false), busy = bS[0], setBusy = bS[1];
    var dS = useState(false), showDropped = dS[0], setShowDropped = dS[1];
    var jcS = useState(course.join_code || ''), joinCode = jcS[0], setJoinCode = jcS[1];
    var seq = useRef(0);

    function personInfo(ids) {
      ids = (ids || []).filter(function (v, i, a) { return v && a.indexOf(v) === i; });
      if (!ids.length) return Promise.resolve({});
      if (admin) return sb.from('profiles').select('id,name,email,affiliation,is_student,is_researcher').in('id', ids).then(function (r) {
        var m = {}; ((r && r.data) || []).forEach(function (p) { m[p.id] = p; }); return m;
      }, function () { return {}; });
      return fetchNames(ids).then(function (nm) { var m = {}; Object.keys(nm).forEach(function (id) { m[id] = { id: id, name: nm[id] }; }); return m; });
    }
    function load() {
      return sb.from('course_enrollments').select('id,user_id,role,status,team,created_at').eq('course_id', course.id).order('created_at', { ascending: true }).then(function (r) {
        if (r && r.error) { toast('A résztvevők nem tölthetők be: ' + r.error.message, { kind: 'error' }); setRows([]); return; }
        var list = (r && r.data) || [];
        setRows(list);
        return personInfo(list.map(function (x) { return x.user_id; })).then(function (m) { setPeople(function (o) { return Object.assign({}, o, m); }); });
      });
    }
    useEffect(function () { setJoinCode(course.join_code || ''); load(); }, [course.id]);

    useEffect(function () {   // debounced people search
      var term = q.trim(), my = ++seq.current;
      if (term.length < 2 && !(admin && kind !== 'all')) { setResults(null); return; }
      var t = setTimeout(function () {
        var p;
        if (admin) {
          var qb = sb.from('profiles').select('id,name,email,affiliation,is_student,is_researcher').eq('status', 'approved').order('name', { ascending: true }).limit(40);
          if (term.length >= 2) { var w = '*' + term.replace(/[*,()]/g, ' ') + '*'; qb = qb.or('name.ilike.' + w + ',email.ilike.' + w + ',affiliation.ilike.' + w); }
          if (kind === 'student') qb = qb.eq('is_student', true);
          if (kind === 'researcher') qb = qb.eq('is_researcher', true);
          p = qb.then(function (r) { if (r && r.error) throw r.error; return (r && r.data) || []; });
        } else {
          p = sb.rpc('pr_search_users', { q: term }).then(function (r) { if (r && r.error) throw r.error; return (r && r.data) || []; });
        }
        p.then(function (list) { if (my === seq.current) setResults(list); }, function () { if (my === seq.current) setResults([]); });
      }, 250);
      return function () { clearTimeout(t); };
    }, [q, kind]);

    function togglePick(id) { setPick(function (o) { var n = Object.assign({}, o); if (n[id]) delete n[id]; else n[id] = true; return n; }); }
    function addPicked() {
      var ids = Object.keys(pick);
      if (!ids.length || busy) return;
      setBusy(true);
      var up = ids.map(function (id) { return { course_id: course.id, user_id: id, role: newRole, status: 'active' }; });
      sb.from('course_enrollments').upsert(up, { onConflict: 'course_id,user_id' }).then(function (r) {
        setBusy(false);
        if (r && r.error) { toast('Nem sikerült hozzáadni: ' + r.error.message, { kind: 'error' }); return; }
        var m = {}; (results || []).forEach(function (p) { if (pick[p.id]) m[p.id] = p; });   // a lecturer cannot re-read profiles → keep the names we found
        setPeople(function (o) { return Object.assign({}, o, m); });
        toast('✓ ' + ids.length + ' résztvevő hozzáadva ' + (newRole === 'oktato' ? 'előadóként' : 'hallgatóként'), { kind: 'ok' });
        setPick({}); load(); if (props.onChanged) props.onChanged();
      }, function () { setBusy(false); toast('Hálózati hiba — próbáld újra.', { kind: 'error' }); });
    }
    function setRole(row, role) {
      if (row.role === role) return;
      function go(ok) {
        if (!ok) return;
        sb.from('course_enrollments').update({ role: role }).eq('id', row.id).then(function (r) {
          if (r && r.error) { toast('Nem sikerült: ' + r.error.message, { kind: 'error' }); return; }
          toast('✓ ' + ((people[row.user_id] || {}).name || 'A résztvevő') + ' mostantól ' + (ROLE_HU[role] || role).toLowerCase(), { kind: 'ok' });
          load(); if (props.onChanged) props.onChanged();
        });
      }
      if (row.user_id === meId && row.role !== 'hallgato' && role === 'hallgato' && !admin) {
        var body = 'Hallgatóként nem kezelheted tovább ezt a kurzust (résztvevők, értékelés).';
        if (window.PRUI && window.PRUI.confirm) window.PRUI.confirm({ title: 'Saját magadat teszed hallgatóvá?', body: body, danger: true, confirmLabel: 'Igen' }).then(go);
        else go(window.confirm(body));
      } else go(true);
    }
    function setStatus(row, status) {
      var nm = (people[row.user_id] || {}).name || 'A résztvevő';
      function go(ok) {
        if (!ok) return;
        sb.from('course_enrollments').update({ status: status }).eq('id', row.id).then(function (r) {
          if (r && r.error) { toast('Nem sikerült: ' + r.error.message, { kind: 'error' }); return; }
          toast(status === 'dropped' ? '✓ ' + nm + ' eltávolítva a kurzusból' : '✓ ' + nm + ' visszavéve', { kind: 'ok' });
          load(); if (props.onChanged) props.onChanged();
        });
      }
      if (status !== 'dropped') { go(true); return; }
      var body = nm + ' nem fér hozzá többé a kurzushoz, és a kurzuskóddal sem tud visszalépni. Az eddigi beadásai megmaradnak, és bármikor visszaveheted.';
      if (window.PRUI && window.PRUI.confirm) window.PRUI.confirm({ title: 'Eltávolítod a kurzusból?', body: body, danger: true, confirmLabel: 'Eltávolítás' }).then(go);
      else go(window.confirm(body));
    }
    function rotate() {
      function go(ok) {
        if (!ok) return;
        sb.rpc('rotate_join_code', { p_course: course.id }).then(function (r) {
          if (r && r.error) { toast('Nem sikerült: ' + r.error.message, { kind: 'error' }); return; }
          setJoinCode(r.data || ''); toast('✓ Új kurzuskód — a régi már nem érvényes', { kind: 'ok' });
          if (props.onChanged) props.onChanged();
        });
      }
      var body = 'A régi kód azonnal érvénytelen lesz; a már csatlakozott résztvevőket ez nem érinti.';
      if (window.PRUI && window.PRUI.confirm) window.PRUI.confirm({ title: 'Új kurzuskódot generálsz?', body: body, confirmLabel: 'Új kód' }).then(go);
      else go(window.confirm(body));
    }
    function copyCode() {
      try { navigator.clipboard.writeText(joinCode).then(function () { toast('Kurzuskód másolva', { kind: 'ok' }); }, function () { }); } catch (e) { }
    }

    var list = rows || [], memberBy = {};
    list.forEach(function (x) { memberBy[x.user_id] = x; });
    var active = list.filter(function (x) { return x.status !== 'dropped'; }), dropped = list.filter(function (x) { return x.status === 'dropped'; });
    var lecturers = active.filter(function (x) { return x.role !== 'hallgato'; }), students = active.filter(function (x) { return x.role === 'hallgato'; });
    function memberRow(x) {
      var p = people[x.user_id] || {}, mine = x.user_id === meId, isDropped = x.status === 'dropped';
      var roles = [['oktato', 'Előadó'], ['hallgato', 'Hallgató']].concat(x.role === 'demonstrator' ? [['demonstrator', 'Demonstrátor']] : []);
      return h('tr', { key: x.id },
        h('td', null, h('span', { className: 'stu' }, h('i', null, initials(p.name)), h('span', null, (p.name || 'ismeretlen') + (mine ? ' (te)' : '')))),
        admin ? h('td', { className: 'muted cell-wrap' }, p.affiliation || '—') : null,
        admin ? h('td', null, p.is_researcher ? chip('kutató', '', 'r') : null, ' ', p.is_student ? chip('hallgató', '', 's') : null) : null,
        h('td', null, isDropped ? chip(ROLE_HU[x.role] || x.role, '', 'd')
          : h('select', { className: 'in sm', value: x.role, 'aria-label': 'Szerep — ' + (p.name || 'résztvevő'), onChange: function (e) { setRole(x, e.target.value); } },
            roles.map(function (o) { return h('option', { key: o[0], value: o[0] }, o[1]); }))),
        h('td', { className: 'muted' }, fmtDay(x.created_at)),
        h('td', { className: 'act' }, isDropped
          ? h('button', { type: 'button', className: 'btn sm', onClick: function () { setStatus(x, 'active'); } }, 'Visszavétel')
          : h('button', { type: 'button', className: 'btn sm danger', onClick: function () { setStatus(x, 'dropped'); } }, 'Eltávolítás')));
    }
    function table(title, arr, empty) {
      return h('div', { className: 'subtable mem-table' },
        h('div', { className: 'mem-h' }, h('b', null, title), h('span', { className: 'chip' }, arr.length)),
        arr.length ? h('table', null,
          h('thead', null, h('tr', null, h('th', null, 'Név'), admin ? h('th', null, 'Egyetem') : null, admin ? h('th', null, 'Profil') : null, h('th', null, 'Szerep'), h('th', null, 'Felvéve'), h('th', null, ''))),
          h('tbody', null, arr.map(memberRow)))
          : h('div', { className: 'mem-empty' }, empty));
    }
    var npick = Object.keys(pick).length, resList = results || [];
    return h('div', { className: 'subgrid members' },
      h('div', { className: 'mem-col' },
        rows === null ? h('div', { className: 'soon' }, 'Betöltés…') : null,
        rows !== null ? table('Előadók', lecturers, 'Még nincs előadó. Adj hozzá valakit jobbra, „Előadó” szereppel.') : null,
        rows !== null ? table('Hallgatók', students, 'Még nincs hallgató. Add hozzá őket jobbra, vagy oszd meg velük a kurzuskódot.') : null,
        dropped.length ? h('div', null,
          h('button', { type: 'button', className: 'btn sm', 'aria-expanded': showDropped ? 'true' : 'false', onClick: function () { setShowDropped(!showDropped); } }, (showDropped ? '▾ ' : '▸ ') + 'Eltávolított résztvevők (' + dropped.length + ')'),
          showDropped ? table('Eltávolítva', dropped, '') : null) : null),
      h('div', { className: 'mem-col' },
        h('div', { className: 'co-card add-card' },
          h('h3', null, 'Résztvevők hozzáadása'),
          h('div', { className: 'add-bar' },
            h('input', { className: 'in', value: q, 'aria-label': 'Keresés', placeholder: admin ? 'Név, e-mail vagy egyetem…' : 'Név vagy e-mail (legalább 2 karakter)…', onChange: function (e) { setQ(e.target.value); } }),
            admin ? h('span', { className: 'seg', role: 'group', 'aria-label': 'Szűrés' }, [['all', 'Mind'], ['student', 'Hallgatók'], ['researcher', 'Kutatók']].map(function (o) {
              return h('button', { key: o[0], type: 'button', className: kind === o[0] ? 'on' : '', 'aria-pressed': kind === o[0] ? 'true' : 'false', onClick: function () { setKind(o[0]); } }, o[1]);
            })) : null),
          results === null ? h('p', { className: 'co-note' }, admin ? 'Kezdj el gépelni, vagy válaszd a Hallgatók / Kutatók szűrőt.' : 'Kezdj el gépelni egy nevet vagy e-mail-címet.')
            : resList.length ? h('div', { className: 'pick-list' }, resList.map(function (p) {
              var mem = memberBy[p.id], isActive = !!(mem && mem.status !== 'dropped'), on = !!pick[p.id];
              return h('label', { key: p.id, className: 'pick-row' + (on ? ' on' : '') + (isActive ? ' dis' : '') },
                h('input', { type: 'checkbox', checked: on || isActive, disabled: isActive, onChange: function () { togglePick(p.id); } }),
                h('span', { className: 'pick-t' },
                  h('b', null, p.name || '—'),
                  admin ? h('span', { className: 'muted' }, [p.affiliation, p.email].filter(Boolean).join(' · ') || '—') : null),
                isActive ? chip('már ' + (ROLE_HU[mem.role] || mem.role).toLowerCase(), 'ok', 'm') : (mem ? chip('eltávolított — újra felvehető', 'warn', 'm') : null));
            })) : h('p', { className: 'co-note' }, 'Nincs találat.'),
          h('div', { className: 'add-foot' },
            h('span', { className: 'muted' }, 'Szerep:'),
            h('span', { className: 'seg', role: 'group', 'aria-label': 'Szerep az új résztvevőknek' }, [['hallgato', 'Hallgató'], ['oktato', 'Előadó']].map(function (o) {
              return h('button', { key: o[0], type: 'button', className: newRole === o[0] ? 'on' : '', 'aria-pressed': newRole === o[0] ? 'true' : 'false', onClick: function () { setNewRole(o[0]); } }, o[1]);
            })),
            h('span', { className: 'sp' }),
            h('button', { type: 'button', className: 'btn pri', disabled: busy || !npick, onClick: addPicked },
              busy ? 'Hozzáadás…' : ('Hozzáadás' + (npick ? ' (' + npick + ')' : '') + (newRole === 'oktato' ? ' előadóként' : ' hallgatóként'))))),
        h('div', { className: 'co-card code-card' },
          h('h3', null, 'Kurzuskód'),
          h('p', { className: 'co-note' }, 'Ezzel a kóddal a hallgatók maguk is csatlakozhatnak (a Kurzusok oldalon). Előadói jogot csak itt, kézzel lehet adni.'),
          h('div', { className: 'join-row' },
            h('code', { className: 'join-code' }, joinCode || '—'),
            h('button', { type: 'button', className: 'btn sm', disabled: !joinCode, onClick: copyCode }, 'Másolás'),
            h('button', { type: 'button', className: 'btn sm', onClick: rotate }, 'Új kód')))));
  }

  // ---------- app ----------
  function App() {
    var phS = useState('loading'), phase = phS[0], setPhase = phS[1];
    var meS = useState(null), me = meS[0], setMe = meS[1];
    var csS = useState([]), courses = csS[0], setCourses = csS[1];
    var enS = useState([]), enrolls = enS[0], setEnrolls = enS[1];
    var cidS = useState(null), courseId = cidS[0], setCourseId = cidS[1];
    var insS = useState(false), isInstr = insS[0], setIsInstr = insS[1];
    var unrS = useState(0), unread = unrS[0], setUnread = unrS[1];   // olvasatlan hírfolyam-bejegyzések (jelvény a fülön)
    var roomS = useState(null), teamRoom = roomS[0], setTeamRoom = roomS[1];   // open team workspace (course-team-room.js)
    var lkdS = useState({}), lockedMap = lkdS[0], setLockedMap = lkdS[1];   // course_id → enrollment still waiting for the Neptun claim
    var lockedRef = useRef({});   // selectCourse runs in the same tick as setLockedMap, so it reads the ref, not the state
    var vwS = useState('lab'), view = vwS[0], setView = vwS[1];
    var lecS = useState([]), lectures = lecS[0], setLectures = lecS[1];
    var slS = useState(null), selLecture = slS[0], setSelLecture = slS[1];
    var lbS = useState([]), labs = lbS[0], setLabs = lbS[1];
    var sbS = useState({}), subs = sbS[0], setSubs = sbS[1];       // my submissions by assignment_id
    var grS = useState({}), grades = grS[0], setGrades = grS[1];   // my grades by submission_id
    var bdS = useState([]), budgets = bdS[0], setBudgets = bdS[1];
    var plS = useState([]), polls = plS[0], setPolls = plS[1];     // open polls (student hint card)
    var mcS = useState(null), mcpLab = mcS[0], setMcpLab = mcS[1];
    var adS = useState(isAdminUser()), admin = adS[0], setAdmin = adS[1];
    var stS = useState({}), stats = stS[0], setStats = stS[1];      // course_id → { oktato, hallgato } (only where the viewer may see all enrollments)
    var lmS = useState(null), liveMode = lmS[0], setLiveMode = lmS[1];   // { kind: 'present'|'student'|'edit'|'browse', deck, session } — course-live.js
    var lkS = useState(0), liveKey = lkS[0], setLiveKey = lkS[1];

    useEffect(function () { boot(); }, []);
    useEffect(function () {   // the admin role arrives after first paint (backend.js → 'pr-profile')
      function onProf() { setAdmin(isAdminUser()); }
      window.addEventListener('pr-profile', onProf);
      return function () { window.removeEventListener('pr-profile', onProf); };
    }, []);
    function boot() {
      if (!BE || !BE.sb) { setPhase('nobackend'); return; }
      if (BE.mode !== 'cloud' || !BE.user) { setPhase('signin'); return; }
      setMe({ id: BE.user.id, name: BE.user.name });
      loadCourses(BE.user.id);
    }
    function loadCourses(uid, openId) {
      Promise.all([
        sb.from('courses').select('id,title,slug,active,settings,join_code,owner_id,created_at').order('created_at', { ascending: false }),
        sb.from('course_enrollments').select('course_id,role,team,status').eq('user_id', uid).eq('status', 'active'),
        sb.rpc('course_my_courses')   // migration-118: a student who has not claimed their roster row cannot read the course row itself
      ]).then(function (res) {
        var cs = ((res[0] || {}).data) || [], ens = ((res[1] || {}).data) || [];
        var locked = {};
        (((res[2] || {}).data) || []).forEach(function (m) {
          if (!m.locked) return;
          locked[m.course_id] = m;
          if (!cs.some(function (c) { return c.id === m.course_id; })) cs.push({ id: m.course_id, title: m.title, active: true, settings: {}, locked: true });
        });
        setLockedMap(locked); lockedRef.current = locked;
        setEnrolls(ens); setCourses(cs);
        loadStats(cs, ens);
        var want = openId || urlCourse();
        if (want && cs.some(function (c) { return c.id === want; })) { selectCourse(want, uid); return; }
        setCourseId(null); setPhase('home');
      }, function () { setPhase('home'); });
    }
    // member counts — only for courses where the viewer may read every enrollment (admin / lecturer), else a student
    // would see a misleading "0 hallgató" (RLS returns only their own row)
    function loadStats(cs, ens) {
      var mine = {}; (ens || []).forEach(function (e) { mine[e.course_id] = e.role; });
      var ids = cs.filter(function (c) { return isAdminUser() || (mine[c.id] && mine[c.id] !== 'hallgato') || c.owner_id === (BE.user && BE.user.id); }).map(function (c) { return c.id; });
      if (!ids.length) { setStats({}); return; }
      sb.from('course_enrollments').select('course_id,role,status').in('course_id', ids).then(function (r) {
        var m = {}; ids.forEach(function (id) { m[id] = { oktato: 0, hallgato: 0 }; });
        ((r && r.data) || []).forEach(function (e) { if (e.status === 'dropped' || !m[e.course_id]) return; if (e.role === 'hallgato') m[e.course_id].hallgato++; else m[e.course_id].oktato++; });
        setStats(m);
      }, function () { });
    }
    // a settings change (e.g. the roster lock) must not bounce the lecturer out of the tab they are on,
    // so this refreshes the single course row instead of reloading and re-selecting the course
    function refreshCourse(cid) {
      sb.from('courses').select('id,title,slug,active,settings,join_code,owner_id,created_at').eq('id', cid).maybeSingle().then(function (r) {
        if (!r || r.error || !r.data) return;
        setCourses(function (cs) { return cs.map(function (c) { return c.id === r.data.id ? Object.assign({}, c, r.data) : c; }); });
      });
    }
    function claimDone() { delete lockedRef.current[courseId]; setPhase('loading'); loadCourses(me.id, courseId); }
    function startPresent(deck) {
      var L = window.PRCourseLive; if (!L || !courseId) return;
      sb.from('course_live_sessions').select('*').eq('course_id', courseId).eq('status', 'live').maybeSingle().then(function (r) {
        var cur = r && r.data;
        if (cur && cur.deck_id === deck.id) { setLiveMode({ kind: 'present', deck: deck, session: cur }); return; }
        var go = function (ok) {
          if (!ok) return;
          L.startSession({ id: courseId }, deck).then(function (s) { setLiveMode({ kind: 'present', deck: deck, session: s }); setLiveKey(function (k) { return k + 1; }); },
            function (e) { toast('Nem sikerült elindítani: ' + ((e && e.message) || e), { kind: 'error' }); });
        };
        if (cur) {
          if (window.PRUI && window.PRUI.confirm) window.PRUI.confirm({ title: 'Már fut egy élő előadás', body: 'Ha elindítod ezt, a másik élő alkalom véget ér.', confirmLabel: 'Indítás' }).then(go);
          else go(window.confirm('Már fut egy élő előadás. Befejezed, és elindítod ezt?'));
        } else go(true);
      }, function () { toast('Hálózati hiba.', { kind: 'error' }); });
    }
    function goHome() {
      try { history.replaceState(null, '', 'Course.html'); } catch (e) { }
      setCourseId(null); setView('lab'); setLiveMode(null); setPhase('home');
      if (me) loadCourses(me.id, null);
    }
    function selectCourse(cid, uid) {
      setCourseId(cid);
      try { history.replaceState(null, '', 'Course.html?course=' + encodeURIComponent(cid)); } catch (e) { }
      if (lockedRef.current[cid] || lockedMap[cid]) { setPhase('claim'); return; }   // the Neptun claim is the only thing an unverified student sees
      Promise.all([
        sb.rpc('course_is_instructor', { cid: cid }),
        sb.from('course_lectures').select('*').eq('course_id', cid).order('ord', { ascending: true }),
        sb.from('lab_assignments').select('*').eq('course_id', cid).order('ord', { ascending: true })
      ]).then(function (res) {
        var instr = !!(res[0] && res[0].data === true);
        setIsInstr(instr);
        var lecs = ((res[1] || {}).data) || [];
        setLiveMode(null);
        setView(lecs.length ? 'lab' : 'live');   // no lab lectures yet → the slide decks / live lectures are the course's main surface
        setLectures(lecs);
        setLabs(((res[2] || {}).data) || []);
        var visible = lecs.filter(function (l) { return l.visible; });
        var cur = visible.length ? visible[visible.length - 1] : lecs[0];   // default: the latest live lecture
        setSelLecture(cur ? cur.id : null);
        setPhase('ready');
        reloadMine(cid, uid);
      }, function () { setPhase('ready'); });
    }
    function reloadMine(cid, uid) {
      cid = cid || courseId; uid = uid || (me && me.id) || (BE.user && BE.user.id);
      if (!cid || !uid) return;
      Promise.all([
        sb.from('lab_submissions').select('*').eq('course_id', cid).eq('user_id', uid),
        sb.from('lab_grades').select('*').eq('course_id', cid),
        sb.from('course_credit_budgets').select('service,granted,used').eq('course_id', cid).eq('user_id', uid),
        sb.from('course_polls').select('*').eq('course_id', cid).eq('status', 'open')
      ]).then(function (res) {
        var m = {}; (((res[0] || {}).data) || []).forEach(function (s) { m[s.assignment_id] = s; }); setSubs(m);
        var g = {}; (((res[1] || {}).data) || []).forEach(function (x) { g[x.submission_id] = x; }); setGrades(g);
        setBudgets(((res[2] || {}).data) || []);
        setPolls(((res[3] || {}).data) || []);   // polls table may be pre-migration → stays empty
      });
    }
    // keep the MCP panel bound to a lab of the selected lecture
    useEffect(function () {
      var cur = labs.filter(function (a) { return a.lecture_id === selLecture; });
      if (!cur.length) { setMcpLab(null); return; }
      if (!mcpLab || mcpLab.lecture_id !== selLecture) setMcpLab(cur[0]);
    }, [selLecture, labs.length]);

    if (phase === 'loading') return h('div', { className: 'center' }, h('div', { className: 'box' }, h('div', { className: 'mk' }, h('span')), h('h1', null, 'Kurzus'), h('p', null, 'Betöltés…')));
    if (phase === 'nobackend') return h('div', { className: 'center' }, h('div', { className: 'box' }, h('div', { className: 'mk' }, h('span')), h('h1', null, 'Kurzus'), h('p', null, 'A felhő-backend nem elérhető.')));
    if (phase === 'signin') return h('div', { className: 'center' }, h('div', { className: 'box' }, h('div', { className: 'mk' }, h('span')), h('h1', null, 'Bejelentkezés'), h('p', null, 'A kurzus-felülethez fiók kell.'), h('a', { className: 'btn pri', href: 'Landing.html' }, 'Bejelentkezés')));
    // cosmetic feature gate (nav.js + the server-side course RLS are the real boundaries)
    if (window.PREnt && window.PREnt.loaded() && !window.PREnt.can('page_course'))
      return h('div', { className: 'center' }, h('div', { className: 'box' }, h('div', { className: 'mk' }, h('span')), h('h1', null, 'Kurzus'), h('p', null, 'Ehhez az oldalhoz nincs hozzáférésed — kérj engedélyt az adminisztrátortól.')));
    if (phase === 'claim' && window.PRCourseRoster)
      return h('div', { className: 'co-wrap' },
        h('div', { className: 'labtop card' }, h('button', { type: 'button', className: 'btn sm', onClick: goHome }, '‹ Kurzusok')),
        h(window.PRCourseRoster.ClaimGate, { courseId: courseId, onVerified: claimDone }));
    if (phase === 'home') {
      var myRoles = {}; enrolls.forEach(function (e) { myRoles[e.course_id] = e.role; });
      return h(CourseHome, {
        admin: admin, courses: courses, stats: stats, myRoles: myRoles,
        onOpen: function (cid) { setPhase('loading'); selectCourse(cid, me.id); },
        onJoined: function (cid) { setPhase('loading'); loadCourses(me.id, cid); },
        onCreated: function (cid) { setPhase('loading'); loadCourses(me.id, cid); }
      });
    }

    var course = courses.filter(function (c) { return c.id === courseId; })[0] || {};
    var myEnr = enrolls.filter(function (e) { return e.course_id === courseId; })[0];
    var myTeam = (myEnr && myEnr.team) || null;
    var lecture = lectures.filter(function (l) { return l.id === selLecture; })[0];
    var curLabs = labs.filter(function (a) { return a.lecture_id === selLecture; });
    var doneMap = {};
    lectures.forEach(function (l) {
      var ls = labs.filter(function (a) { return a.lecture_id === l.id; });
      doneMap[l.id] = ls.length > 0 && ls.every(function (a) { var s = subs[a.id]; return s && s.status !== 'draft'; });
    });

    return h('div', { className: 'co-wrap' },
      h('div', { className: 'labtop card' },
        h('button', { type: 'button', className: 'btn sm', onClick: goHome, title: 'Vissza a kurzuslistához' }, '‹ Kurzusok'),
        courses.length > 1
          ? h('select', { className: 'in', value: courseId || '', onChange: function (e) { setPhase('loading'); selectCourse(e.target.value, me.id); }, 'aria-label': 'Kurzusválasztó' },
            courses.map(function (c) { return h('option', { key: c.id, value: c.id }, c.title); }))
          : h('h2', null, course.title || 'Kurzus'),
        isInstr ? chip(admin && !(myEnr && myEnr.role !== 'hallgato') ? 'Admin' : 'Előadó', 'acc', 'r') : (myEnr ? chip('Hallgató', '', 'r') : null),
        h('a', { className: 'btn sm', href: 'CourseCanvas.html?course=' + (courseId || '') }, '🖼 Évfolyam-vászon'),
        h('span', { className: 'seg' }, (isInstr
          ? [['feed', '📢 Hírfolyam'], ['live', '🎞 Előadások'], ['lab', '🧪 Labor'], ['teams', '👥 Csapatok'], ['members', '👥 Résztvevők'], ['roster', '📋 Névsor és jegyek'], ['activity', '📊 Aktivitás'], ['teach', '🎓 Oktatói pult']]
          : [['feed', '📢 Hírfolyam'], ['live', '🎞 Előadások'], ['lab', '🧪 Labor'], ['teams', '👥 Csapatok']]).map(function (t) {
          return h('button', { key: t[0], className: (view === t[0] && !liveMode) ? 'on' : '', onClick: function () { setLiveMode(null); setTeamRoom(null); setView(t[0]); } },
            t[1], (t[0] === 'feed' && unread && view !== 'feed') ? h('span', { className: 'seg-badge' }, unread) : null);
        })),
        h('span', { className: 'sp' }),
        h(CreditBars, { budgets: budgets })),
      (!isInstr && window.PRCourseRoster && !liveMode && window.PRCourseRoster.ClaimBanner)
        ? h(window.PRCourseRoster.ClaimBanner, { courseId: courseId }) : null,
      (!isInstr && window.PRCourseRoster && !liveMode && view === 'live')
        ? h(window.PRCourseRoster.MyGradeCard, { courseId: courseId }) : null,
      (window.PRCourseLive && !(liveMode && (liveMode.kind === 'present' || liveMode.kind === 'student')))
        ? h(window.PRCourseLive.LiveBanner, { course: course, isInstr: isInstr, refreshKey: liveKey,
          onJoin: function (deck, session) { setLiveMode({ kind: 'student', deck: deck, session: session }); },
          onPresent: function (deck, session) { setLiveMode({ kind: 'present', deck: deck, session: session }); } }) : null,
      (liveMode && window.PRCourseLive) ? (
        liveMode.kind === 'present' ? h(window.PRCourseLive.PresenterView, { key: liveMode.session.id, course: course, deck: liveMode.deck, session: liveMode.session, meId: me.id,
          onEnd: function () { setLiveMode(null); setView('live'); setLiveKey(function (k) { return k + 1; }); },
          onExit: function () { setLiveMode(null); setView('live'); setLiveKey(function (k) { return k + 1; }); } })
        : liveMode.kind === 'student' ? h(window.PRCourseLive.LiveStudentView, { key: liveMode.session.id, course: course, deck: liveMode.deck, session: liveMode.session, meId: me.id,
          onLeave: function () { setLiveMode(null); setView('live'); setLiveKey(function (k) { return k + 1; }); } })
        : liveMode.kind === 'edit' ? h(window.PRCourseLive.DeckEditor, { key: liveMode.deck.id, course: course, deck: liveMode.deck,
          onClose: function () { setLiveMode(null); }, onPresent: function (d) { startPresent(d); } })
        : h(window.PRCourseLive.DeckBrowser, { key: liveMode.deck.id, deck: liveMode.deck, onClose: function () { setLiveMode(null); } }))
      : (view === 'live' && window.PRCourseLive)
        ? h(window.PRCourseLive.DecksTab, { course: course, isInstr: isInstr, meId: me.id,
          onPresent: function (d) { startPresent(d); },
          onEdit: function (d) { setLiveMode({ kind: 'edit', deck: d }); },
          onBrowse: function (d) { setLiveMode({ kind: 'browse', deck: d }); } })
      : (view === 'activity' && isInstr && window.PRCourseLive)
        ? h(window.PRCourseLive.ActivityTab, { course: course })
      : (view === 'feed' && window.PRCourseFeed)
        ? h(window.PRCourseFeed.FeedTab, { course: course, onUnread: setUnread })
      : (view === 'teams' && teamRoom && window.PRTeamRoom)
        ? h(window.PRTeamRoom.TeamRoom, { key: teamRoom, teamId: teamRoom, meId: me.id, onClose: function () { setTeamRoom(null); } })
      : (view === 'teams' && window.PRCourseTeams)
        ? h(window.PRCourseTeams.TeamsTab, { course: course, meId: me.id, onOpenRoom: function (t) { setTeamRoom(t.id); } })
      : (view === 'roster' && isInstr && window.PRCourseRoster)
        ? h(window.PRCourseRoster.RosterTab, { course: course, onCourseChange: function () { refreshCourse(courseId); } })
      : (view === 'members' && isInstr)
        ? h(MembersTab, { course: course, admin: admin, meId: me.id, onChanged: function () { loadStats(courses, enrolls); } })
        : (view === 'teach' && isInstr)
        ? h(TeacherView, { course: course, labs: labs, lectures: lectures, meId: me.id })
        : h('div', { className: 'labgrid' },
          h(LectureRail, { course: course, lectures: lectures, selId: selLecture, doneMap: doneMap, onSelect: setSelLecture }),
          h('div', { className: 'notebook' },
            lecture ? h('div', { className: 'co-card card' },
              h('div', { className: 'lab-h', style: { marginBottom: 4 } },
                h('h3', null, lecture.ord + '. előadás — ' + lecture.title),
                h('span', { className: 'sp' }),
                lecture.held_at ? chip('📅 ' + lecture.held_at, '', 'd') : null,
                (lecture.visible === false && isInstr) ? chip('a hallgatóknak rejtett', 'warn', 'v') : null),
              lecture.summary ? h('div', { style: { fontSize: 13, color: 'var(--muted)' } }, lecture.summary) : null,
              lecture.content_md ? h('div', { className: 'md', dangerouslySetInnerHTML: { __html: mdHtml(lecture.content_md) } }) : null)
              : h('div', { className: 'soon' }, 'Ehhez a kurzushoz még nincs élesített előadás — az oktató az óra elején kapcsolja be.'),
            curLabs.map(function (a) {
              var s = subs[a.id];
              return h(LabCard, {
                key: a.id, lab: a, sub: s, grade: s ? grades[s.id] : null, meId: me.id, team: myTeam,
                active: !!(mcpLab && mcpLab.id === a.id),
                onUse: function () { setMcpLab(a); },
                onSubmitted: function () { reloadMine(); }
              });
            }),
            (lecture && !curLabs.length) ? h('div', { className: 'soon' }, 'Ehhez az előadáshoz még nincs élesített labor.') : null,
            polls.length ? h('div', { className: 'co-card card' },
              h('div', { className: 'lab-h', style: { marginBottom: 4 } },
                h('h3', null, '🗳 Nyitott szavazások'),
                h('span', { className: 'sp' }),
                h('a', { className: 'btn sm', href: 'CourseCanvas.html?course=' + (courseId || '') }, 'Szavazás a vásznon →')),
              polls.map(function (p) {
                return h('div', { key: p.id, style: { fontSize: 12.5, color: 'var(--muted)', padding: '3px 0' } },
                  '• ' + p.title + (p.category ? ' (' + p.category + ')' : '') + ' — fejenként max ' + (p.max_votes_per_voter || 3) + ' szavazat, saját munkára nem szavazhatsz');
              })) : null),
          h(McpPanel, {
            course: course, assignment: mcpLab, meId: me.id, team: myTeam, budgets: budgets,
            onBudgets: function () { reloadMine(); },
            onSubmitted: function () { reloadMine(); }
          })));
  }

  ReactDOM.createRoot(document.getElementById('root')).render(h(App));
})();
