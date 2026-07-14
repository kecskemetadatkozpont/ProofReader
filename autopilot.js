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
  function saveFile(pid, path, content, source) {
    var u = uid();
    return sb.from('research_files').upsert({ project_id: pid, path: path, content: content || '', mime: /\.tex$/.test(path) ? 'text/x-tex' : 'text/markdown', size: (content || '').length, source: source || 'ai', created_by: u, updated_by: u, updated_at: nowIso() }, { onConflict: 'project_id,path' });
  }
  // every research-* edge REQUIRES the caller's user JWT (auth.uid() gates entitlement) — a service role cannot
  // stand in, so the orchestrator runs in the browser under the user's session and forwards the access token.
  function callEdge(fn, body) {
    return sb.auth.getSession().then(function (s) {
      var token = (s && s.data && s.data.session && s.data.session.access_token) || CFG.supabaseAnonKey;
      return fetch(CFG.supabaseUrl + '/functions/v1/' + fn, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'apikey': CFG.supabaseAnonKey, 'Authorization': 'Bearer ' + token },
        body: JSON.stringify(body)
      }).then(function (r) { return r.json().catch(function () { return { error: 'A szerver válasza nem értelmezhető (időtúllépés?).' }; }); }, function () { return { error: 'network' }; });
    });
  }

  // ======================================================================= AUTOPILOT ORCHESTRATOR
  // Client-driven, tick-based, resumable. Each apStep() does ONE bounded unit of work (usually one edge call),
  // returns a { patch, events } that the driver persists to research_autopilot_runs/_events. State (phase index +
  // per-phase cursor) lives entirely in the run row, so a refresh/re-open resumes exactly where it left off.
  var AP_PHASES = [
    { key: 'ideas', label: 'Ideas', ic: '💡', sub: 'ötletek + gap' },
    { key: 'literature', label: 'Literature', ic: '📚', sub: 'keresés + screening' },
    { key: 'sr', label: 'Systematic review', ic: '🔬', sub: 'áttekintés' },
    { key: 'protocol', label: 'Protocol', ic: '🧪', sub: 'lépések' },
    { key: 'journal', label: 'Journal', ic: '🎯', sub: 'venue-ajánló' },
    { key: 'writing', label: 'Writing', ic: '✍️', sub: 'draft szekciók' },
    { key: 'submission', label: 'Submission', ic: '📤', sub: 'csomagolás' }
  ];
  var AP_ICON = {}; AP_PHASES.forEach(function (p) { AP_ICON[p.key] = p.ic; });
  // a 'running' run that no browser tab has driven for >60s reads as 'stalled' (honest: nothing is advancing it) — resume to continue
  function apEffectiveStatus(run) {
    if (run && run.status === 'running') { var u = run.updated_at ? new Date(run.updated_at).getTime() : 0; if (u && (Date.now() - u) > 60000) return 'stalled'; }
    return run && run.status;
  }
  function apProgress(run) {
    var ph = (run && run.phases) || [];
    var enabled = ph.filter(function (p) { return p.enabled; }).length || 1;
    // count ONLY enabled phases as progress — disabled phases start 'skipped' and must not inflate the count past 100%
    var done = ph.filter(function (p) { return p.enabled && (p.status === 'done' || p.status === 'skipped'); }).length;
    return { done: done, enabled: enabled, pct: Math.round(done / enabled * 100) };
  }
  var LS_STEPS_AP = [{ step: 1, kind: 'quick' }, { step: 2, kind: 'abstract' }, { step: 3, kind: 'fulltext' }, { step: 4, kind: 'review' }];
  function lsCfg(step, project, idea, maxResults) {
    if (step !== 1) return { keywords: [], include: [], exclude: [], filters: {}, signals: ['has_github', 'has_dataset'] };
    var sq = (idea && String((idea.question || '') + (idea.hypothesis ? '\n\nHypothesis: ' + idea.hypothesis : '')).trim()) || (project && (project.goal || project.title)) || '';
    return { keywords: (project && project.keywords) || [], include: [], exclude: [], filters: { fromYear: '', minCites: '', oa: false, journals: true }, signals: ['has_github', 'has_dataset'], source_adapter: 'openalex', max_results: maxResults || 150, semantic_query: String(sq).slice(0, 350) };
  }

  // ---- run-state transition helpers (pure: given a run, return {patch, events}) ----
  function apNextIndex(phases, from) { for (var j = from + 1; j < phases.length; j++) { if (phases[j].enabled) return j; } return -1; }
  function apComplete(run, resultText, events) {
    var i = run.phase_index, ph = run.phases.slice();
    ph[i] = Object.assign({}, ph[i], { status: 'done', result: resultText });
    var ev = (events || []).concat([{ phase: ph[i].key, level: 'ok', message: resultText }]);
    var ni = apNextIndex(ph, i);
    if (ni === -1) return { patch: { phases: ph, status: 'done', finished_at: nowIso() }, events: ev.concat([{ level: 'ok', message: '✓ Az Autopilot végzett.' }]) };
    return { patch: { phases: ph, phase_index: ni }, events: ev };
  }
  function apSkip(run, msg) {
    var i = run.phase_index, ph = run.phases.slice();
    ph[i] = Object.assign({}, ph[i], { status: 'skipped', result: msg });
    var ni = apNextIndex(ph, i);
    var ev = [{ phase: ph[i].key, level: 'sys', message: msg }];
    if (ni === -1) return { patch: { phases: ph, status: 'done', finished_at: nowIso() }, events: ev.concat([{ level: 'ok', message: '✓ Az Autopilot végzett.' }]) };
    return { patch: { phases: ph, phase_index: ni }, events: ev };
  }
  function apStay(run, cursor, events, extraPatch) {
    var i = run.phase_index, ph = run.phases.slice();
    ph[i] = Object.assign({}, ph[i], { status: 'running', cursor: cursor });
    return { patch: Object.assign({ phases: ph }, extraPatch || {}), events: events || [] };
  }
  function apGate(run, gate, cursor, extraPatch) {
    var i = run.phase_index, ph = run.phases.slice();
    ph[i] = Object.assign({}, ph[i], { status: 'gate', cursor: cursor || ph[i].cursor });
    return { patch: Object.assign({ phases: ph, status: 'awaiting_approval', gate: gate }, extraPatch || {}), events: [{ phase: gate.phase, level: 'warn', message: '⏸ ' + gate.title + ' — jóváhagyásra vár' }] };
  }
  function apGatesOn(run) { return !run.config || run.config.gates !== false; }

  // ---- the 7 phase steppers (each returns Promise<{patch, events}>) ----
  function apIdeas(run, project) {
    // idempotent: the 'gap' edge path does NOT dedup, so a retry would duplicate up to 8 ideas. If the project already
    // has candidate ideas (from the brief step or a prior tick), adopt them instead of regenerating.
    return sb.from('research_ideas').select('id', { count: 'exact', head: true }).eq('project_id', project.id).neq('status', 'rejected').then(function (cr) {
      var existing = (cr && cr.count) || 0;
      if (existing > 0) return apComplete(run, existing + ' meglévő ötlet-jelölt', [{ phase: 'ideas', level: 'sys', message: 'Már vannak ötletek — a gap-generálás kimarad' }]);
      return callEdge('research-ai', { action: 'gap', project_id: project.id }).then(function (d) {
        if (d && d.error) throw new Error('Ideas: ' + d.error);
        var n = (d && d.count) || 0;
        return apComplete(run, n ? (n + ' ötlet-jelölt generálva') : 'Nincs új ötlet', [{ phase: 'ideas', level: 'run', message: 'Gap-elemzés lefutott' }]);
      });
    });
  }
  function apLiterature(run, project) {
    var cur = (run.phases[run.phase_index] || {}).cursor || {};
    var maxP = parseInt(run.config && run.config.max_papers, 10) || 150;
    if (!cur.stage) {
      return sb.from('research_ideas').select('id,question,hypothesis').eq('project_id', project.id).neq('status', 'rejected').order('created_at', { ascending: false }).limit(1).maybeSingle().then(function (ir) {
        var idea = ir && ir.data;
        var q = (idea && idea.question) || project.goal || project.title || 'literature';
        var title = String((idea && idea.question) || (project.title + ' — literature')).slice(0, 80);
        return sb.from('research_studies').insert({ project_id: project.id, idea_id: idea ? idea.id : null, title: title, question: String(q).slice(0, 4000), created_by: uid() }).select('id').maybeSingle().then(function (sr) {
          var sid = sr && sr.data && sr.data.id;
          if (!sid) throw new Error('Literature: a study nem jött létre' + (sr && sr.error ? ' (' + sr.error.message + ')' : ''));
          var rows = LS_STEPS_AP.map(function (s) { return { study_id: sid, step: s.step, kind: s.kind, config: lsCfg(s.step, project, idea, maxP) }; });
          return sb.from('research_study_steps').insert(rows).then(function (rr) {
            if (rr && rr.error) throw new Error('Literature: study-lépések (' + rr.error.message + ')');
            return callEdge('research-study', { action: 'plan', study_id: sid }).then(function (d) {
              // a failed AI plan is NON-fatal: the study_steps already hold valid client-seeded config, so search on
              var ev = !(d && d.error) ? { phase: 'literature', level: 'sys', message: 'Study létrehozva + keresés megtervezve' }
                : { phase: 'literature', level: 'warn', message: 'Study létrehozva — AI-tervezés kimaradt (' + (d.error || '') + '), a mentett kulcsszavakkal keresek' };
              return apStay(run, { stage: 's1', offset: 0, study_id: sid, iter: 0 }, [ev], { study_id: sid });
            });
          });
        });
      });
    }
    var sid = cur.study_id;
    function litScreen(step, nextStage, dflt, label) {
      return callEdge('research-study', { action: (step === 1 ? 'search_step1' : 'screen_batch'), study_id: sid, step: step, offset: cur.offset || 0 }).then(function (d) {
        if (d && d.error) throw new Error('Literature/' + label + ': ' + d.error);
        var iter = (cur.iter || 0) + 1;
        var c = d.counts || {};
        var msg = label + ': ' + (d.counts ? ('include ' + (c.include || 0) + ' · maybe ' + (c.maybe || 0)) : ('offset ' + (cur.offset || 0)));
        if (d.done || iter > 40) return { advance: true, msg: msg };
        return apStay(run, { stage: cur.stage, offset: (d.next_offset != null ? d.next_offset : (cur.offset || 0) + dflt), study_id: sid, iter: iter }, [{ phase: 'literature', level: 'run', message: msg }]);
      });
    }
    if (cur.stage === 's1') return litScreen(1, 's2', 20, 'Keresés/triage').then(function (r) { return r.advance ? apStay(run, { stage: 's2', offset: 0, study_id: sid, iter: 0 }, [{ phase: 'literature', level: 'ok', message: r.msg + ' — step 1 kész' }]) : r; });
    if (cur.stage === 's2') return litScreen(2, 's3', 8, 'Absztrakt').then(function (r) { return r.advance ? apStay(run, { stage: 's3', offset: 0, study_id: sid, iter: 0 }, [{ phase: 'literature', level: 'ok', message: r.msg + ' — absztrakt kész' }]) : r; });
    if (cur.stage === 's3') return litScreen(3, 'gated', 3, 'Full-text').then(function (r) {
      if (!r.advance) return r;
      if (apGatesOn(run)) return apGate(run, { phase: 'literature', title: 'Included források jóváhagyása', detail: 'Az AI leszűrte az irodalmat. Nézd át az included forrásokat a Studies-ban, majd hagyd jóvá a folytatáshoz.' }, { stage: 'gated', study_id: sid });
      return apComplete(run, 'Irodalom leszűrve (included kész)', [{ phase: 'literature', level: 'ok', message: r.msg + ' — full-text kész' }]);
    });
    return Promise.resolve(apComplete(run, 'Irodalom jóváhagyva', []));   // stage 'gated' → resumed after approval
  }
  function apSR(run, project) {
    if (!run.study_id) return Promise.resolve(apSkip(run, 'Nincs literature-study — az áttekintés kimarad'));
    return callEdge('research-study', { action: 'generate_review', study_id: run.study_id }).then(function (d) {
      if (d && d.error) {
        if (/full-?text|passed/i.test(d.error)) return apSkip(run, 'Nincs full-text included cikk — az áttekintés kimarad');
        throw new Error('SR: ' + d.error);
      }
      return apComplete(run, (d && d.words ? ('Áttekintés: ~' + d.words + ' szó') : 'Áttekintés kész'), [{ phase: 'sr', level: 'run', message: 'Systematic review generálva' + (d && d.file_path ? ' → ' + d.file_path : '') }]);
    });
  }
  function apProtocol(run, project) {
    var cur = (run.phases[run.phase_index] || {}).cursor || {};
    if (cur.generated) return Promise.resolve(apComplete(run, 'Protokoll jóváhagyva', []));
    // gate on a protocol's needs_approval steps, then complete (stamps protocol_id)
    function finishProtocol(pid, steps, msg) {
      return sb.from('research_protocol_steps').select('id', { count: 'exact', head: true }).eq('protocol_id', pid).eq('needs_approval', true).then(function (cr) {
        var na = (cr && cr.count) || 0, evs = [{ phase: 'protocol', level: 'run', message: msg }];
        if (na > 0 && apGatesOn(run)) return apGate(run, { phase: 'protocol', title: na + ' protokoll-lépés jóváhagyása', detail: na + ' lépés „needs approval". Nézd át a Protocol-fülön, majd hagyd jóvá a futtatáshoz.' }, { generated: true }, { protocol_id: pid });
        var res = apComplete(run, msg, evs); res.patch.protocol_id = pid; return res;
      });
    }
    // idempotent + non-destructive: 'generate' ARCHIVES any active protocol, so a retry would archive-and-recreate.
    // If a non-archived protocol already exists (retry, or the user made one), adopt it instead of regenerating.
    return sb.from('research_protocols').select('id').eq('project_id', project.id).neq('status', 'archived').order('created_at', { ascending: false }).limit(1).maybeSingle().then(function (ex) {
      var existing = ex && ex.data && ex.data.id;
      if (existing) return finishProtocol(existing, null, 'Meglévő protokoll átvéve');
      return callEdge('research-protocol', { action: 'generate', project_id: project.id, goal: project.goal || project.title || '' }).then(function (d) {
        if (d && d.error) throw new Error('Protocol: ' + d.error);
        return finishProtocol(d && d.protocol_id, (d && d.steps) || 0, ((d && d.steps) || 0) + ' protokoll-lépés generálva');
      });
    });
  }
  function apJournal(run, project) {
    return callEdge('research-journals', { action: 'recommend', project_id: project.id, hint: (run.config && run.config.tier) || '' }).then(function (d) {
      if (d && d.error) throw new Error('Journal: ' + d.error);
      var js = (d && d.journals) || [], top = js[0] || null;
      var md = '# Venue-ajánlás\n\n' + (js.length ? js.slice(0, 5).map(function (j, k) { return (k + 1) + '. **' + (j.title || '?') + '**' + (j.npi_level ? ' — ' + j.npi_level : '') + (j.field ? ' · ' + j.field : ''); }).join('\n') : '_Nincs találat._') + '\n\n*A Publify Autopilot Journal-fázisából.*\n';
      return saveFile(project.id, 'autopilot/journals.md', md, 'ai').then(function () {
        return apComplete(run, top ? ('Top venue: ' + (top.title || '?') + (top.npi_level ? ' (' + top.npi_level + ')' : '')) : 'Venue-ajánlás kész', [{ phase: 'journal', level: 'run', message: 'Venue-rangsor generálva' }]);
      });
    });
  }
  function apWriting(run, project) {
    var cur = (run.phases[run.phase_index] || {}).cursor || {};
    if (!cur.outline) {
      return callEdge('research-writing', { action: 'outline', project_id: project.id }).then(function (d) {
        if (d && d.error) throw new Error('Writing/outline: ' + d.error);
        var outline = d && d.outline, ctx = (d && d.context) || {};
        if (!outline || !outline.sections || !outline.sections.length) throw new Error('Writing: üres vázlat');
        var md = '# ' + (outline.title || project.title) + '\n\n' + (outline.abstract || '') + '\n\n## Szekciók\n' + outline.sections.map(function (s) { return '- ' + (s.heading || s.key); }).join('\n');
        return saveFile(project.id, 'writing/outline.md', md, 'ai').then(function () {
          return apStay(run, { outline: true, ctx: ctx, si: 0, sections: outline.sections }, [{ phase: 'writing', level: 'run', message: 'Vázlat kész: ' + outline.sections.length + ' szekció' }]);
        });
      });
    }
    var si = cur.si || 0, sections = cur.sections || [];
    if (si >= sections.length) return Promise.resolve(apComplete(run, (sections.length || 0) + ' szekció megírva', []));
    var section = sections[si];
    return callEdge('research-writing', { action: 'section', project_id: project.id, context: cur.ctx, section: section }).then(function (d) {
      if (d && d.error) throw new Error('Writing/section: ' + d.error);
      return saveFile(project.id, 'writing/' + (section.key || ('section-' + (si + 1))) + '.tex', (d && d.latex) || '', 'ai').then(function () {
        var evs = [{ phase: 'writing', level: 'run', message: 'Szekció megírva: ' + (section.heading || section.key) }];
        if (si + 1 >= sections.length) return apComplete(run, sections.length + ' szekció megírva', evs);
        return apStay(run, Object.assign({}, cur, { si: si + 1 }), evs);
      });
    });
  }
  function apSubmission(run, project) {
    var cur = (run.phases[run.phase_index] || {}).cursor || {};
    if (cur.built) return Promise.resolve(apComplete(run, 'Beküldés jóváhagyva', []));
    return callEdge('research-journals', { action: 'dossier', project_id: project.id }).then(function (d) {
      var jr = (d && !d.error && d.journal) || null, oa = (d && d.openalex) || null;
      var md = '# Beküldési dosszié\n\n' + (jr ? ('**Venue:** ' + (jr.title || '?') + '\n\n') : '_A célfolyóiratot a Journal-fázis ajánlásából válaszd ki._\n\n') + (oa && oa.homepage_url ? ('Homepage: ' + oa.homepage_url + '\n\n') : '') + 'A kézirat szekciói a `writing/` mappában. A tényleges beküldés a Submissions munkafolyamatban történik.\n\n*A Publify Autopilot Submission-fázisából.*\n';
      return saveFile(project.id, 'submission/dossier.md', md, 'ai').then(function () {
        if (apGatesOn(run)) return apGate(run, { phase: 'submission', title: 'Végső beküldési sign-off', detail: 'A kézirat + dosszié összeállt. Hagyd jóvá a beküldést (a tényleges beküldés a Submissions munkafolyamatban történik).' }, { built: true });
        return apComplete(run, 'Beküldésre kész', [{ phase: 'submission', level: 'ok', message: 'Dosszié összeállítva' }]);
      });
    });
  }
  var AP_STEPPERS = { ideas: apIdeas, literature: apLiterature, sr: apSR, protocol: apProtocol, journal: apJournal, writing: apWriting, submission: apSubmission };
  function apStep(run, project) {
    var i = run.phase_index, ph = run.phases[i];
    if (!ph) return Promise.resolve({ patch: { status: 'done', finished_at: nowIso() }, events: [] });
    if (!ph.enabled) return Promise.resolve(apSkip(run, ph.label + ' kihagyva (letiltva)'));
    var fn = AP_STEPPERS[ph.key];
    if (!fn) return Promise.resolve(apSkip(run, 'ismeretlen fázis: ' + ph.key));
    return fn(run, project);
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
        h('div', { className: 'ap-clari' }, h('div', { className: 'ap-cl-lbl' }, 'Mely fázisok fussanak automatikusan', h('div', { style: { fontWeight: 400, color: 'var(--muted)', fontSize: 11.5, marginTop: 3 } }, 'A kikapcsolt fázisokat az Autopilot kihagyja.')),
          PHASES.map(function (ph, i) {
            return h('div', { className: 'ap-phrow', key: i },
              h('span', { className: 'pi' }, ph[0]),
              h('span', { className: 'pn' }, ph[1], h('small', null, ph[2])),
              h('button', { className: 'ap-sw' + (cfg.phases[i] ? ' on' : ''), role: 'switch', 'aria-checked': cfg.phases[i] ? 'true' : 'false', 'aria-label': ph[1], onClick: function () { togglePhase(i); } }, h('i')));
          })),
        h('div', { className: 'ap-gatehint' }, '⏸ ', h('b', null, 'Emberi jóváhagyás bekapcsolva.'), ' Az Autopilot megáll a kulcs-döntéseknél (included források · protokoll-lépések · végső beküldés), és a jóváhagyásodra vár.'),
        h('div', { style: { marginTop: 16 } },
          h('button', { className: 'ap-launch', disabled: props.launching, onClick: props.onLaunch }, props.launching ? h('span', null, h('span', { className: 'spin' }), ' Indítás…') : '⚡ Autopilot indítása →')),
        h('div', { className: 'ap-ctahint' }, 'A bekapcsolt fázisok automatikusan lefutnak (a dashboard-fület nyitva tartva), a kulcs-döntéseknél a jóváhagyásodra várva. Élőben követheted a dashboardon.')));
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
  // ======================================================================= DASHBOARD (P2/P3)
  var AP_STATUS = {
    running: { t: 'Fut', cls: 'run' }, paused: { t: 'Szünet', cls: 'pause' }, awaiting_approval: { t: 'Jóváhagyásra vár', cls: 'gate' },
    stalled: { t: 'Megszakadt', cls: 'stall' }, done: { t: 'Kész', cls: 'done' }, failed: { t: 'Hiba', cls: 'fail' },
    cancelled: { t: 'Leállítva', cls: 'pause' }, queued: { t: 'Sorban', cls: 'pause' }
  };
  var EV_ICON = { run: '•', ok: '✓', warn: '⏸', sys: '⚙', error: '✕' };
  function Dashboard(props) {
    var rS = useState(null), run = rS[0], setRun = rS[1];
    var pjS = useState(null), project = pjS[0], setProject = pjS[1];
    var evS = useState([]), events = evS[0], setEvents = evS[1];
    var tS = useState(0), tick = tS[0], setTick = tS[1];
    var nfS = useState(false), notFound = nfS[0], setNotFound = nfS[1];
    var driving = useRef(false), alive = useRef(true), projRef = useRef(null), feedRef = useRef(null), myDriver = useRef(null);
    if (!myDriver.current) myDriver.current = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : ('00000000-0000-4000-8000-' + String(Date.now()).slice(-12).padStart(12, '0'));   // per-tab lease id
    useEffect(function () { return function () { alive.current = false; driving.current = false; }; }, []);
    // live clock while running
    useEffect(function () { var iv = setInterval(function () { if (alive.current) setTick(function (x) { return x + 1; }); }, 1000); return function () { clearInterval(iv); }; }, []);

    function ensureProject(pid) {
      if (projRef.current) return Promise.resolve(projRef.current);
      return sb.from('research_projects').select('id,title,goal,keywords,student_id').eq('id', pid).maybeSingle().then(function (pr) { projRef.current = pr && pr.data; if (alive.current) setProject(projRef.current); return projRef.current; });
    }
    function emit(r, evs) {
      if (!evs || !evs.length) return Promise.resolve();
      return sb.from('research_autopilot_events').insert(evs.map(function (e) { return { run_id: r.id, project_id: r.project_id, phase: e.phase || null, level: e.level || 'run', message: String(e.message || '').slice(0, 500) }; }));
    }
    // ONLY the project owner ever drives (a supervisor/reader would have every write RLS-denied → a silent AI-burning loop)
    function ensureDrive(r) { if (r && r.status === 'running' && r.owner_id === uid() && !driving.current) { driving.current = true; drive(); } }
    function drive() {
      if (!alive.current || !driving.current) { driving.current = false; return; }
      // Claim/renew the single-driver LEASE: this conditional UPDATE returns the row ONLY if we hold it or can steal a stale one.
      // Guarantees just one tab advances a run even with multiple dashboards open on the same owner session.
      var stale = new Date(Date.now() - 30000).toISOString();
      sb.from('research_autopilot_runs')
        .update({ driver_token: myDriver.current, driver_beat: nowIso() })
        .eq('id', props.runId).eq('status', 'running')
        .or('driver_token.is.null,driver_token.eq.' + myDriver.current + ',driver_beat.lt.' + stale)
        .select('*').then(function (rr) {
          var r = rr && rr.data && rr.data[0];
          if (!alive.current || !driving.current) { driving.current = false; return; }
          if (!r) {   // another tab holds a live lease OR the run is no longer 'running' → stop driving; live view keeps flowing via Realtime
            driving.current = false;
            sb.from('research_autopilot_runs').select('*').eq('id', props.runId).maybeSingle().then(function (x) { if (alive.current && x && x.data) setRun(x.data); });
            return;
          }
          ensureProject(r.project_id).then(function (proj) {
            if (!alive.current || !driving.current) { driving.current = false; return; }
            if (!proj) { driving.current = false; return; }
            apStep(r, proj).then(function (res) {
              if (!alive.current) { driving.current = false; return; }
              emit(r, res.events).then(function () {
                sb.from('research_autopilot_runs').update(Object.assign({ updated_at: nowIso(), driver_beat: nowIso() }, res.patch || {})).eq('id', r.id).eq('driver_token', myDriver.current).then(function () { setTimeout(drive, 950); });
              });
            }, function (err) {
              var pk = (r.phases[r.phase_index] || {}).key;
              emit(r, [{ phase: pk, level: 'error', message: 'Hiba: ' + ((err && err.message) || err) }]).then(function () {
                sb.from('research_autopilot_runs').update({ status: 'failed', error: String((err && err.message) || err), updated_at: nowIso() }).eq('id', r.id).then(function () { driving.current = false; });
              });
            });
          });
        }, function () { driving.current = false; });
    }
    useEffect(function () {
      sb.from('research_autopilot_runs').select('*').eq('id', props.runId).maybeSingle().then(function (rr) { var r = rr && rr.data; if (!alive.current) return; if (!r) { setNotFound(true); return; } setRun(r); ensureProject(r.project_id); ensureDrive(r); });
      sb.from('research_autopilot_events').select('*').eq('run_id', props.runId).order('id', { ascending: true }).limit(400).then(function (r) { if (alive.current) setEvents((r && r.data) || []); });
      var ch = sb.channel('ap:' + props.runId)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'research_autopilot_runs', filter: 'id=eq.' + props.runId }, function (p) { if (!alive.current) return; setRun(p.new); ensureDrive(p.new); })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'research_autopilot_events', filter: 'run_id=eq.' + props.runId }, function (p) { if (!alive.current) return; setEvents(function (e) { return e.some(function (x) { return x.id === p.new.id; }) ? e : e.concat([p.new]); }); })
        .subscribe();
      return function () { try { sb.removeChannel(ch); } catch (e) { } };
    }, [props.runId]);
    useEffect(function () { var el = feedRef.current; if (el) el.scrollTop = el.scrollHeight; }, [events.length]);

    function setStatus(patch) { if (!run) return; sb.from('research_autopilot_runs').update(Object.assign({ updated_at: nowIso() }, patch)).eq('id', run.id); }
    function pause() { setStatus({ status: 'paused' }); }
    function resume() { setStatus({ status: 'running', started_at: (run && run.started_at) || nowIso() }); }
    function stop() {
      function go(ok) { if (ok) setStatus({ status: 'cancelled', finished_at: nowIso() }); }
      if (window.PRUI && window.PRUI.confirm) window.PRUI.confirm({ title: 'Leállítod az Autopilotot?', confirmLabel: 'Leállítás', danger: true }).then(go);
      else go(window.confirm('Leállítod az Autopilotot? A már elkészült eredmények megmaradnak.'));
    }
    function approve() { setStatus({ status: 'running', gate: null }); }

    if (notFound) return h('div', { className: 'ap-wrap' }, h('div', { className: 'center' }, h('div', { className: 'box' }, h('div', { className: 'mk' }, h('i')), h('h1', null, 'Nincs ilyen futás'), h('p', null, 'Ez az Autopilot-futás nem létezik, vagy nincs hozzáférésed.'), h('button', { className: 'btn', onClick: props.onExit }, '‹ Vissza az Autopilothoz'))));
    if (!run) return h('div', { className: 'ap-wrap' }, h('div', { className: 'center' }, h('div', { className: 'box' }, h('span', { className: 'spin' }), h('p', null, 'Autopilot betöltése…'))));

    var phases = run.phases || [];
    var effStatus = apEffectiveStatus(run);
    var enabledN = phases.filter(function (p) { return p.enabled; }).length || 1;
    // count ONLY enabled phases (disabled ones start 'skipped' and must not inflate progress past 100%)
    var doneN = phases.filter(function (p) { return p.enabled && (p.status === 'done' || p.status === 'skipped'); }).length;
    var pct = Math.round(doneN / enabledN * 100);
    var st = AP_STATUS[effStatus] || AP_STATUS.queued;
    var AP_TERMINAL = { done: 1, failed: 1, cancelled: 1 };
    var endMs = AP_TERMINAL[run.status] ? new Date(run.finished_at || run.updated_at || Date.now()).getTime() : Date.now();
    var elapsed = run.started_at ? Math.max(0, Math.floor((endMs - new Date(run.started_at).getTime()) / 1000)) : 0;
    var elMin = Math.floor(elapsed / 60), elSec = elapsed % 60;
    var runningIdx = phases.findIndex ? phases.findIndex(function (p) { return p.status === 'running'; }) : -1;

    function phaseCard(p, i) {
      var badge = p.status === 'done' ? '✓ Kész' : p.status === 'running' ? 'Fut…' : p.status === 'gate' ? '⏸ Jóváhagyás' : p.status === 'skipped' ? 'Kihagyva' : 'Vár';
      var sub = p.status === 'done' ? (p.result || 'kész') : p.status === 'running' ? 'dolgozik…' : p.status === 'gate' ? 'jóváhagyásra vár' : p.status === 'skipped' ? (p.result || 'kihagyva') : (p.enabled ? '—' : 'letiltva');
      return h('div', { key: p.key, className: 'ap-pcard ' + p.status + (p.enabled ? '' : ' off') },
        h('div', { className: 'ap-pc-ic' }, AP_ICON[p.key] || '•'),
        h('div', { className: 'ap-pc-b' },
          h('div', { className: 'ap-pc-top' }, h('span', { className: 'ap-pc-n' }, p.label), h('span', { className: 'ap-pc-badge ' + p.status }, badge)),
          h('div', { className: 'ap-pc-sub' }, sub),
          p.status === 'running' ? h('div', { className: 'ap-pc-mini' }, h('i')) : null));
    }
    function focusPanel() {
      if (run.status === 'awaiting_approval' && run.gate) {
        return h('div', { className: 'ap-focus gate' },
          h('div', { className: 'ap-focus-h' }, '⏸ ', h('b', null, run.gate.title)),
          h('div', { className: 'ap-focus-d' }, run.gate.detail),
          h('div', { className: 'ap-focus-acts' },
            h('button', { className: 'btn pri sm', onClick: approve }, '✓ Jóváhagyás — folytatás'),
            h('a', { className: 'btn sm', href: 'Research.html?project=' + encodeURIComponent(run.project_id), target: '_blank', rel: 'noopener' }, 'Áttekintés a munkaterületen ↗'),
            h('button', { className: 'btn sm', onClick: pause }, '⏸ Később')));
      }
      if (run.status === 'failed') return h('div', { className: 'ap-focus fail' }, h('div', { className: 'ap-focus-h' }, '✕ ', h('b', null, 'Az Autopilot hibába ütközött')), h('div', { className: 'ap-focus-d' }, run.error || 'Ismeretlen hiba. Nézd meg az activity-listát.'), h('div', { className: 'ap-focus-acts' }, h('button', { className: 'btn sm', onClick: resume }, '↻ Újrapróbálás')));
      if (run.status === 'done') return h('div', { className: 'ap-focus done' }, h('div', { className: 'ap-focus-h' }, '✓ ', h('b', null, 'Az Autopilot végzett')), h('div', { className: 'ap-focus-d' }, 'Minden bekapcsolt fázis lefutott. Az eredmények a projekt munkaterületén (Ideas, Studies, Protocol, Writing, fájlok).'), h('div', { className: 'ap-focus-acts' }, h('a', { className: 'btn pri sm', href: 'Research.html?project=' + encodeURIComponent(run.project_id) }, 'Megnyitás a Research-ben →')));
      if (run.status === 'cancelled') return h('div', { className: 'ap-focus' }, h('div', { className: 'ap-focus-h' }, '⏹ ', h('b', null, 'Az Autopilot leállítva')), h('div', { className: 'ap-focus-d' }, 'A már elkészült részeredmények megmaradtak a projekt munkaterületén.'), h('div', { className: 'ap-focus-acts' }, h('a', { className: 'btn sm', href: 'Research.html?project=' + encodeURIComponent(run.project_id) }, 'Megnyitás a Research-ben →')));
      var rp = runningIdx >= 0 ? phases[runningIdx] : null;
      return h('div', { className: 'ap-focus' }, h('div', { className: 'ap-focus-h' }, rp ? (AP_ICON[rp.key] + ' ') : '', h('b', null, rp ? rp.label : 'Autopilot')), h('div', { className: 'ap-focus-d' }, rp ? 'Ez a fázis épp dolgozik. A részletek az activity-listában frissülnek élőben.' : (run.status === 'paused' ? 'Szüneteltetve — a „Folytatás" gombbal indíthatod újra.' : 'Indul…')));
    }

    return h('div', { className: 'ap-wrap' },
      h('div', { className: 'ap-dhead' },
        h('div', { className: 'mk' }, '⚡'),
        h('div', { className: 'ap-dt' }, h('h2', null, 'Autopilot'), h('div', { className: 'ap-dp' }, (project && project.title) || '…')),
        h('span', { className: 'ap-pill ' + st.cls }, h('span', { className: 'ap-sdot' }), st.t),
        h('span', { className: 'ap-dp mono', style: { color: 'var(--muted)' } }, '⏱ ', h('b', { style: { color: 'var(--ink)' } }, elMin + ':' + (elSec < 10 ? '0' : '') + elSec)),
        h('div', { style: { display: 'flex', gap: 8, marginLeft: 'auto' } },
          run.status === 'running' ? h('button', { className: 'btn sm', onClick: pause }, '⏸ Szünet') : null,
          run.status === 'paused' ? h('button', { className: 'btn pri sm', onClick: resume }, '▶ Folytatás') : null,
          (run.status === 'running' || run.status === 'paused' || run.status === 'awaiting_approval') ? h('button', { className: 'btn sm', onClick: stop }, '⏹ Leállítás') : null)),
      h('div', { className: 'ap-card ap-dov' }, h('div', { className: 'ap-dl' }, 'Fázis ', h('b', null, Math.min(enabledN, doneN + (run.status === 'done' ? 0 : 1))), ' / ', h('b', null, enabledN)), h('div', { className: 'ap-dtrack' }, h('i', { style: { width: pct + '%' } })), h('div', { className: 'ap-dpct mono' }, pct + '%')),
      h('div', { className: 'ap-dgrid' },
        h('div', { className: 'ap-pcards' }, phases.map(phaseCard)),
        h('div', { className: 'ap-dside' },
          focusPanel(),
          h('div', { className: 'ap-card ap-feed' }, h('h3', null, 'Activity'),
            h('div', { className: 'ap-feed-list', ref: feedRef }, events.length ? events.map(function (e) {
              return h('div', { className: 'ap-feed-row ' + (e.level || 'run'), key: e.id }, h('span', { className: 'ap-fi' }, EV_ICON[e.level] || '•'), h('span', { className: 'ap-ft' }, e.message));
            }) : h('div', { className: 'ap-feed-empty' }, 'Még nincs esemény…'))))),
      h('div', { className: 'ap-dacts' },
        h('a', { className: 'btn sm', href: 'Research.html?project=' + encodeURIComponent(run.project_id) }, 'Megnyitás a Research-ben ↗'),
        h('button', { className: 'btn sm', onClick: props.onExit }, '‹ Új kutatás')));
  }

  // (A) the user's running + previous Autopilots — surfaced above the Launcher so a closed run is always findable
  function RunsList(props) {
    var rS = useState(null), rows = rS[0], setRows = rS[1];   // null = loading; [] = none
    var alive = useRef(true);
    useEffect(function () { return function () { alive.current = false; }; }, []);
    useEffect(function () {
      sb.from('research_autopilot_runs').select('id,project_id,status,phase_index,phases,updated_at,started_at').eq('owner_id', uid()).neq('status', 'cancelled').order('updated_at', { ascending: false }).limit(8).then(function (r) {
        var runs = (r && r.data) || [];
        if (!runs.length) { if (alive.current) setRows([]); return; }
        var ids = runs.map(function (x) { return x.project_id; });
        sb.from('research_projects').select('id,title').in('id', ids).then(function (pr) {
          var tmap = {}; ((pr && pr.data) || []).forEach(function (p) { tmap[p.id] = p.title; });
          if (alive.current) setRows(runs.map(function (x) { return Object.assign({}, x, { title: tmap[x.project_id] || 'Névtelen projekt' }); }));
        });
      }, function () { if (alive.current) setRows([]); });
    }, []);
    if (!rows || !rows.length) return null;
    return h('div', { className: 'ap-runs' },
      h('div', { className: 'ap-runs-h' }, '⚡ Folytatható Autopilotok'),
      rows.map(function (run) {
        var eff = apEffectiveStatus(run), st = AP_STATUS[eff] || AP_STATUS.queued, pr = apProgress(run);
        return h('button', { key: run.id, className: 'ap-run-row', onClick: function () { props.onOpen(run.id); } },
          h('span', { className: 'ap-run-t' }, run.title),
          h('span', { className: 'ap-pill ' + st.cls }, h('span', { className: 'ap-sdot' }), st.t),
          h('span', { className: 'ap-run-pr mono' }, pr.done + '/' + pr.enabled + ' fázis'),
          h('span', { className: 'ap-run-go' }, (eff === 'done' || eff === 'failed') ? 'Megnyitás →' : 'Folytatás →'));
      }));
  }

  function App() {
    function initRun() { try { return new URLSearchParams(location.search).get('run'); } catch (e) { return null; } }
    var vS = useState(initRun() ? 'dashboard' : 'launcher'), view = vS[0], setView = vS[1];   // ?run=<id> deep-links straight to the dashboard (resume)
    var riS = useState(initRun()), runId = riS[0], setRunId = riS[1];
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
      if (!project) return;
      var firstIdx = -1; for (var i = 0; i < cfg.phases.length; i++) { if (cfg.phases[i]) { firstIdx = i; break; } }
      if (firstIdx === -1) { toast('Válassz legalább egy fázist.', false); return; }
      setLaunching(true);
      var u = uid();
      var phases = AP_PHASES.map(function (p, i) { return { key: p.key, label: p.label, enabled: !!cfg.phases[i], status: cfg.phases[i] ? 'pending' : 'skipped', result: '', cursor: {} }; });
      var md = '# Autopilot brief\n\n**Cél:** ' + (project.goal || '—') + '\n\n**Kulcsszavak:** ' + ((project.keywords || []).join(', ') || '—')
        + '\n\n**Adat:** ' + (files.length ? files.map(function (f) { return f.name; }).join(', ') : '—')
        + '\n\n**Cél-venue:** ' + cfg.tier + '\n\n**Max. átvizsgált cikk:** ' + (cfg.maxPapers || '—')
        + '\n\n**Bekapcsolt fázisok:** ' + AP_PHASES.filter(function (_, i) { return cfg.phases[i]; }).map(function (ph) { return ph.label; }).join(', ')
        + '\n\n**Emberi jóváhagyás:** bekapcsolva (included források · protokoll-lépések · végső beküldés).\n\n---\n*A Publify Autopilot elindítva.*\n';
      function fail(msg) { setLaunching(false); toast(msg, false); }
      function createRun() {
        sb.from('research_autopilot_runs').insert({ project_id: project.id, owner_id: u, status: 'running', started_at: nowIso(), phase_index: firstIdx, phases: phases, config: { tier: cfg.tier, max_papers: parseInt(cfg.maxPapers, 10) || null, gates: true } }).select('id').maybeSingle().then(function (rr) {
          setLaunching(false);
          if (!rr || rr.error || !rr.data) { fail('Nem sikerült elindítani az Autopilotot' + (rr && rr.error ? ': ' + rr.error.message : '.')); return; }
          var rid = rr.data.id;
          try { history.replaceState(null, '', 'Autopilot.html?run=' + encodeURIComponent(rid)); } catch (e) { }
          setRunId(rid); setView('dashboard');
        });
      }
      // persist the brief + stamp student_id (deferred from creation, so the LAUNCHED project reaches the supervisor), then start the run
      saveFile(project.id, 'autopilot/brief.md', md, 'ai').then(function () {
        sb.from('phd_students').select('id').eq('profile_id', u).maybeSingle().then(function (sr) {
          var sid = sr && sr.data && sr.data.id;
          if (sid && !project.student_id) sb.from('research_projects').update({ student_id: sid }).eq('id', project.id).then(createRun, createRun);
          else createRun();
        }, createRun);
      }, createRun);
    }

    function exitToLauncher() {
      try { history.replaceState(null, '', 'Autopilot.html'); } catch (e) { }
      setRunId(null); setProject(null); setChatId(null); setFiles([]); setIdeasCount(0); setView('launcher');
    }
    function openRun(rid) { try { history.replaceState(null, '', 'Autopilot.html?run=' + encodeURIComponent(rid)); } catch (e) { } setRunId(rid); setView('dashboard'); }
    // the dashboard is a full-screen surface (own header + controls) — resumable via ?run=<id>
    if (view === 'dashboard') return h(Dashboard, { runId: runId, onExit: exitToLauncher });

    // stepper (only on launcher/brief/launch)
    var STEP = view === 'launcher' || view === 'brief' ? 1 : view === 'launch' ? 2 : 3;
    function stepBtn(n, label, vgo, disabled) {
      var cls = 'ap-st' + (STEP === n ? ' on' : STEP > n ? ' done' : '');
      return h('button', { className: cls, disabled: disabled || !project, onClick: function () { if (!disabled && project) setView(vgo); } }, h('span', { className: 'n' }, n), label);
    }

    var body;
    if (view === 'launcher') body = h('div', null, h(RunsList, { onOpen: openRun }), h(Launcher, { creating: creating, onStart: startProject }));
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
        h('button', { className: 'ap-st', disabled: true, title: 'Az indítás után jelenik meg' }, h('span', { className: 'n' }, '3'), 'Autopilot dashboard')),
      body);
  }

  // ---- boot ----
  if (!BE || !BE.sb) { root.innerHTML = '<div class="center"><div class="box"><h1>A backend nem elérhető</h1></div></div>'; return; }
  if (BE.mode !== 'cloud' || !BE.user) { root.innerHTML = '<div class="center"><div class="box"><div class="mk"><i></i></div><h1>Jelentkezz be</h1><p>Az Autopilot bejelentkezést igényel.</p><a class="btn" href="Landing.html">Bejelentkezés</a></div></div>'; return; }
  ReactDOM.createRoot(root).render(h(App));
})();
