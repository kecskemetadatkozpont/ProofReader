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
  // Feleletválasztós tisztázó kérdések. The model may emit them as a ```publify-questions fence OR (as the Autopilot
  // brief model often does) a BARE JSON array [{q, options[], multi}]. Parse either, render as pills, hide the raw JSON.
  function apParseQuestions(text) {
    if (!text) return { qs: [], clean: text || '' };
    var raw = String(text), jsonStr = null, fence = false;
    var mf = /```publify-questions\s*([\s\S]*?)```/i.exec(raw);
    if (mf) { jsonStr = mf[1].trim(); fence = true; }
    else {
      var whole = raw.trim();
      if (/^\[\s*\{[\s\S]*\}\s*\]$/.test(whole) && whole.indexOf('"options"') >= 0) jsonStr = whole;   // the whole message IS the JSON
      else { var mb = /\[\s*\{[\s\S]*?"options"[\s\S]*\}\s*\]/.exec(raw); if (mb) jsonStr = mb[0]; }     // an embedded array
    }
    if (!jsonStr) return { qs: [], clean: raw.trim() };
    var arr; try { arr = JSON.parse(jsonStr); } catch (e) { return { qs: [], clean: raw.trim() }; }
    if (!Array.isArray(arr)) return { qs: [], clean: raw.trim() };
    var qs = arr.filter(function (x) { return x && x.q && Array.isArray(x.options) && x.options.length; }).slice(0, 5).map(function (x) {
      return { q: String(x.q).slice(0, 400), options: x.options.map(String).map(function (s) { return s.slice(0, 220); }).slice(0, 8), multi: !!x.multi };
    });
    if (!qs.length) return { qs: [], clean: raw.trim() };
    var clean = fence
      ? raw.replace(/```publify-questions[\s\S]*?```/gi, '').replace(/```publify-questions[\s\S]*$/i, '').trim()
      : raw.split(jsonStr).join('').trim();
    return { qs: qs, clean: clean };
  }
  // hide a (partial or complete) bare questions JSON array from the LIVE stream so the raw JSON never flashes mid-answer
  function apHideJson(text) { var t = String(text || ''); var i = t.search(/```publify-questions|\[\s*\{[\s\S]*?"q"\s*:/); return i >= 0 ? t.slice(0, i).trim() : t; }
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
  // per-phase hue for the process-graph view (each stage owns a colour → the top-to-bottom flow reads as a spectrum)
  var AP_HUE = { ideas: 'var(--h-idea)', literature: 'var(--h-lit)', sr: 'var(--h-rev)', protocol: 'var(--h-proto)', journal: 'var(--h-jrnl)', writing: 'var(--h-write)', submission: 'var(--h-sub)' };
  function hueOf(k) { return AP_HUE[k] || 'var(--accent)'; }
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
      // the user picks WHICH idea to develop (config.develop_idea_id from the graph); default = most recent
      var chosen = run.config && run.config.develop_idea_id;
      var ideaQ = chosen
        ? sb.from('research_ideas').select('id,question,hypothesis').eq('id', chosen).maybeSingle()
        : sb.from('research_ideas').select('id,question,hypothesis').eq('project_id', project.id).neq('status', 'rejected').order('created_at', { ascending: false }).limit(1).maybeSingle();
      return ideaQ.then(function (ir) {
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
    // 🌐 web search + 🤖 multi-agent mode are ALWAYS ON in the Autopilot chat (no toggle) — a single-agent fallback runs if research-agents is unavailable.
    var qsS = useState({}), qSel = qsS[0], setQSel = qsS[1];   // (msgId:qIdx) → [selected options]
    var qnS = useState({}), qNote = qnS[0], setQNote = qnS[1]; // (msgId) → optional free-text note
    function toggleQ(key, o, multi) {
      setQSel(function (p) { var n = Object.assign({}, p); var cur = (n[key] || []).slice(); var ix = cur.indexOf(o);
        if (multi) { if (ix >= 0) cur.splice(ix, 1); else cur.push(o); } else { cur = (ix >= 0) ? [] : [o]; }   // single-choice = replace
        n[key] = cur; return n; });
    }
    function setNote(mid, v) { setQNote(function (p) { var n = Object.assign({}, p); n[mid] = v; return n; }); }
    // gather ALL of a message's picks (+ any note) and send them back as ONE user turn
    function sendQBlock(mid, qlist) {
      var lines = [];
      qlist.forEach(function (qq, qi) { var sel = qSel[mid + ':' + qi] || []; if (sel.length) lines.push(qq.q + ' → ' + sel.join('; ')); });
      var note = (qNote[mid] || '').trim(); if (note) lines.push('Egyéb: ' + note);
      if (!lines.length) return;
      sendText(lines.join('\n'));
      setQSel(function (p) { var n = Object.assign({}, p); Object.keys(n).forEach(function (k) { if (k.indexOf(mid + ':') === 0) delete n[k]; }); return n; });
      setNote(mid, '');
    }
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
        if (!autoStreamed.current && last && last.role === 'user') { autoStreamed.current = true; replyNow(props.chatId); }
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
          body: JSON.stringify({ chat_id: cid, stream: true, web: true })   // 🌐 web search always on
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
    // 🤖 Multi-agent mode: several parallel agents (Kutató/Reviewer/Szintetizáló) via research-agents (NDJSON events);
    // each shows a live lane, the synthesizer's answer streams into the bubble. Ported from the Ideas ChatPanel.
    function streamAgents(cid) {
      if (streamingRef.current) return;
      if (!CFG.supabaseUrl) { setErr('Hiányzó backend konfiguráció.'); return; }
      streamingRef.current = true; setBusy(true); setErr(''); atBottom.current = true;
      function endStream(reload) { streamingRef.current = false; if (!alive.current) return; setBusy(false); if (reload) loadMsgs(cid).then(function () { if (alive.current) setStreaming(null); }); else setStreaming(null); }
      sb.auth.getSession().then(function (s) {
        var token = (s && s.data && s.data.session && s.data.session.access_token) || CFG.supabaseAnonKey;
        fetch(CFG.supabaseUrl + '/functions/v1/research-agents', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'apikey': CFG.supabaseAnonKey, 'Authorization': 'Bearer ' + token },
          body: JSON.stringify({ chat_id: cid, web: true })
        }).then(function (resp) {
          if (!resp.ok || !resp.body || !resp.body.getReader) { endStream(false); streamReply(cid); return; }   // agents unavailable → graceful single-agent (web) fallback, not an error
          var reader = resp.body.getReader(), dec = new TextDecoder(), buf = '', answer = '';
          var lanes = [{ id: 'plan', role: 'planner', label: 'Tervezés', state: 'run', status: '' }], laneById = { plan: lanes[0] };
          function upd() { setStreaming({ text: answer, lanes: lanes.slice() }); }
          upd();
          (function pump() {
            reader.read().then(function (rr) {
              if (!alive.current) { streamingRef.current = false; return; }
              if (rr.done) { if (props.onReply) props.onReply(); endStream(true); return; }
              buf += dec.decode(rr.value, { stream: true });
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
                else if (ev.t === 'err') { setErr('Ágens-hiba: ' + (ev.m || 'ismeretlen')); }
              }
              pump();
            }, function () { endStream(true); });
          })();
        }, function () { endStream(false); streamReply(cid); });   // network error on agents → single-agent fallback
      }, function () { setErr('Nem sikerült a munkamenet lekérése.'); endStream(false); });
    }
    function replyNow(cid) { streamAgents(cid); }   // Autopilot chat = multi-agent + web ALWAYS (streamAgents falls back to single-agent if unavailable)
    function sendText(raw) {
      var txt = (raw || '').trim(); if (!txt || busy) return;
      setBusy(true); setErr(''); setInput(''); if (taRef.current) taRef.current.style.height = 'auto';
      sb.from('research_messages').insert({ chat_id: props.chatId, role: 'user', content: txt }).then(function (ins) {
        if (ins && ins.error) { setBusy(false); setErr(ins.error.message); return; }
        loadMsgs(props.chatId); replyNow(props.chatId);
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
            loadMsgs(props.chatId); replyNow(props.chatId);
          });
        });
      });
      e.target.value = '';
    }

    function turn(m, isLast) {
      var isAI = m.role === 'assistant';
      if (!isAI) return h('div', { key: m.id, className: 'ap-turn me' }, h('span', { className: 'ap-av me' }, 'Te'), h('div', { className: 'ap-bub' }, String(m.content || '')));
      // multiple-choice clarifying questions: parse (fence OR bare JSON), render as pills on the LAST assistant turn
      var pq = apParseQuestions(m.content);
      var showQ = isLast && !busy && pq.qs.length;
      var bodyHtml = mdSafe(pq.clean || (pq.qs.length ? '' : m.content));
      return h('div', { key: m.id, className: 'ap-turn ai' },
        h('span', { className: 'ap-av ai' }, 'AI'),
        h('div', { style: { minWidth: 0, flex: 1 } },
          (pq.clean || !pq.qs.length) ? h('div', { className: 'ap-bub', dangerouslySetInnerHTML: { __html: bodyHtml } }) : null,
          showQ ? (function () {
            var totalSel = pq.qs.reduce(function (a, qq, qi) { return a + (qSel[m.id + ':' + qi] || []).length; }, 0);
            var note = qNote[m.id] || '';
            var canSend = totalSel > 0 || note.trim().length > 0;
            return h('div', { className: 'ap-qs' },
              pq.qs.map(function (qq, qi) {
                var qk = m.id + ':' + qi, sel = qSel[qk] || [];
                return h('div', { className: 'ap-q', key: qi },
                  h('div', { className: 'ap-q-label' }, (pq.qs.length > 1 ? ((qi + 1) + '. ') : '') + qq.q, qq.multi ? h('span', { className: 'ap-q-multi' }, 'több is választható') : null),
                  h('div', { className: 'ap-q-opts' }, qq.options.map(function (o, oi) {
                    var on = sel.indexOf(o) >= 0;
                    return h('button', { className: 'ap-q-opt' + (on ? ' on' : ''), key: oi, 'aria-pressed': on, onClick: function () { toggleQ(qk, o, qq.multi); } }, (on ? '✓ ' : '') + o);
                  })));
              }),
              h('textarea', { className: 'ap-q-note', rows: 1, value: note, placeholder: 'Egyéb / pontosítás (opcionális)…', onChange: function (e) { setNote(m.id, e.target.value); }, onKeyDown: function (e) { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (canSend) sendQBlock(m.id, pq.qs); } } }),
              h('div', { className: 'ap-q-send' },
                h('span', { className: 'ap-q-hint' }, totalSel ? (totalSel + ' kiválasztva') : (note.trim() ? 'saját válasz' : 'Válassz — nyugodtan gondold át')),
                h('button', { className: 'ap-csend', disabled: !canSend, onClick: function () { sendQBlock(m.id, pq.qs); } }, 'Küldés' + (totalSel ? (' (' + totalSel + ')') : ''))));
          })() : null));
    }

    return h('div', { className: 'ap-card ap-chat' },
      h('div', { className: 'ap-chat-h' }, h('span', { className: 'ap-av ai' }, 'AI'), h('b', null, 'Kutatási asszisztens'), h('span', { className: 'prj' }, props.projectTitle || ''),
        props.onDiscard ? h('button', { className: 'ap-discard', title: 'A projekt, a beszélgetés és a fájlok elvetése', onClick: props.onDiscard }, 'Elvetés') : null),
      h('div', { className: 'ap-thread', ref: scrollRef, onScroll: onScroll },
        msgs.map(function (m, i) { return turn(m, i === msgs.length - 1); }),
        streaming ? h('div', { className: 'ap-turn ai', key: 'stream' }, h('span', { className: 'ap-av ai' }, 'AI'),
          h('div', { style: { minWidth: 0, flex: 1 } },
            (streaming.lanes && streaming.lanes.length) ? h('div', { className: 'ap-agents' }, streaming.lanes.map(function (l) {
              var ic = l.role === 'researcher' ? '🔬' : l.role === 'reviewer' ? '🧐' : l.role === 'synth' ? '🧩' : l.role === 'planner' ? '🧭' : '•';
              return h('div', { key: l.id, className: 'ap-lane ' + l.state },
                h('span', { className: 'ap-lane-ic' }, ic),
                h('span', { className: 'ap-lane-lab' }, l.label),
                l.state === 'run' ? h('span', { className: 'spin', style: { width: 12, height: 12 } }) : l.state === 'done' ? h('span', { className: 'ap-lane-ok' }, '✓') : h('span', { className: 'ap-lane-wait' }, '…'),
                l.status ? h('span', { className: 'ap-lane-st' }, l.status) : null);
            })) : null,
            (streaming.text || !(streaming.lanes && streaming.lanes.length)) ? h('div', { className: 'ap-bub', dangerouslySetInnerHTML: { __html: mdSafe(apHideJson(streaming.text || '')) } }) : null)) : null,
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
    var opS = useState(null), openPhase = opS[0], setOpenPhase = opS[1];   // which phase card is expanded to show its real artifacts
    var paS = useState({}), phaseArts = paS[0], setPhaseArts = paS[1];     // phase key → { loading, items, total } (lazy-fetched)
    var pvS = useState(null), preview = pvS[0], setPreview = pvS[1];        // { title, content } → the readable review preview modal
    var swS = useState(false), switching = swS[0], setSwitching = swS[1];   // guard while re-targeting the pipeline to a chosen idea
    var brS = useState([]), branchRuns = brS[0], setBranchRuns = brS[1];    // parallel per-idea branch runs (siblings of the primary run in the same group)
    var selS = useState({}), selIdeas = selS[0], setSelIdeas = selS[1];     // idea_id → true : ideas ticked for parallel development
    var driving = useRef(false), alive = useRef(true), projRef = useRef(null), feedRef = useRef(null), myDriver = useRef(null);
    var bDriving = useRef({});   // per-branch-run driving flags (additive; the primary driver above is untouched)
    var branchRunsRef = useRef([]), activeRef = useRef(false);   // live mirrors for the event poller (avoids stale closures)
    var retryRef = useRef({});   // run_id → consecutive transient-error retries (a single network blip must not kill a run)
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
              retryRef.current[r.id] = 0;   // a successful step clears the transient-error counter
              emit(r, res.events).then(function () {
                sb.from('research_autopilot_runs').update(Object.assign({ updated_at: nowIso(), driver_beat: nowIso() }, res.patch || {})).eq('id', r.id).eq('driver_token', myDriver.current).then(function () { setTimeout(drive, 950); });
              });
            }, function (err) {
              var pk = (r.phases[r.phase_index] || {}).key, msg = (err && err.message) || String(err), rc = retryRef.current[r.id] || 0;
              if (rc < 3) {   // transient failure (e.g. a network blip mid-screening) → retry the SAME step (cursor is persisted) with backoff, don't kill the run
                retryRef.current[r.id] = rc + 1;
                emit(r, [{ phase: pk, level: 'warn', message: 'Átmeneti hiba: ' + msg + ' — újrapróbálás ' + (rc + 1) + '/3…' }]).then(function () {
                  sb.from('research_autopilot_runs').update({ driver_beat: nowIso() }).eq('id', r.id).then(function () { setTimeout(drive, 3000 * (rc + 1)); });
                });
                return;
              }
              emit(r, [{ phase: pk, level: 'error', message: 'Hiba (3 újrapróbálás után): ' + msg }]).then(function () {
                sb.from('research_autopilot_runs').update({ status: 'failed', error: String(msg), updated_at: nowIso() }).eq('id', r.id).then(function () { driving.current = false; });
              });
            });
          });
        }, function () { driving.current = false; });
    }
    useEffect(function () {
      sb.from('research_autopilot_runs').select('*').eq('id', props.runId).maybeSingle().then(function (rr) { var r = rr && rr.data; if (!alive.current) return; if (!r) { setNotFound(true); return; } setRun(r); ensureProject(r.project_id); ensureDrive(r); });
      var ch = sb.channel('ap:' + props.runId)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'research_autopilot_runs', filter: 'id=eq.' + props.runId }, function (p) { if (!alive.current) return; setRun(p.new); ensureDrive(p.new); })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'research_autopilot_events', filter: 'run_id=eq.' + props.runId }, function (p) { if (!alive.current) return; setEvents(function (e) { return e.some(function (x) { return x.id === p.new.id; }) ? e : e.concat([p.new]); }); })
        .subscribe();
      return function () { try { sb.removeChannel(ch); } catch (e) { } };
    }, [props.runId]);
    useEffect(function () { var el = feedRef.current; if (el) el.scrollTop = el.scrollHeight; }, [events.length]);
    // eager-load the ideas so the graph can FAN them out as parallel branches (not hidden behind a click)
    useEffect(function () {
      if (!run || !run.project_id) return;
      var ip = (run.phases || []).filter(function (x) { return x.key === 'ideas'; })[0];
      if (ip && (ip.status === 'done' || ip.status === 'running' || ip.status === 'gate')) loadPhaseArts('ideas');
    }, [run && run.project_id, run && (run.phases || []).filter(function (x) { return x.key === 'ideas'; }).map(function (x) { return x.status; }).join('')]);

    // ── PARALLEL BRANCHES: each extra chosen idea is a sibling run in the same group, driven ADDITIVELY (the primary
    //    driver above is untouched). Branch runs auto-run (gates:false) so several ideas develop at once.
    function groupOf(r) { return (r && r.config && r.config.group_id) || (r && r.id); }
    function setBranchRow(row) { if (!row) return; setBranchRuns(function (list) { var found = false, out = (list || []).map(function (x) { if (x.id === row.id) { found = true; return row; } return x; }); if (!found) out.push(row); return out; }); }
    function ensureBranchDrive(r) { if (r && r.status === 'running' && r.owner_id === uid() && !bDriving.current[r.id]) { bDriving.current[r.id] = true; driveBranch(r.id); } }
    function driveBranch(rid) {
      if (!alive.current || !bDriving.current[rid]) { bDriving.current[rid] = false; return; }
      var stale = new Date(Date.now() - 30000).toISOString();
      sb.from('research_autopilot_runs').update({ driver_token: myDriver.current, driver_beat: nowIso() }).eq('id', rid).eq('status', 'running')
        .or('driver_token.is.null,driver_token.eq.' + myDriver.current + ',driver_beat.lt.' + stale).select('*').then(function (rr) {
          var r = rr && rr.data && rr.data[0];
          if (!alive.current || !bDriving.current[rid]) { bDriving.current[rid] = false; return; }
          if (!r) { bDriving.current[rid] = false; sb.from('research_autopilot_runs').select('*').eq('id', rid).maybeSingle().then(function (x) { if (alive.current && x && x.data) setBranchRow(x.data); }); return; }
          ensureProject(r.project_id).then(function (proj) {
            if (!alive.current || !bDriving.current[rid]) { bDriving.current[rid] = false; return; }
            if (!proj) { bDriving.current[rid] = false; return; }
            apStep(r, proj).then(function (res) {
              if (!alive.current) { bDriving.current[rid] = false; return; }
              retryRef.current[r.id] = 0;   // successful step → clear the retry counter for this branch
              setBranchRow(Object.assign({}, r, res.patch || {}));   // reflect progress in the branch column
              emit(r, res.events).then(function () {
                sb.from('research_autopilot_runs').update(Object.assign({ updated_at: nowIso(), driver_beat: nowIso() }, res.patch || {})).eq('id', r.id).eq('driver_token', myDriver.current).then(function () {
                  if (res.patch && res.patch.status && res.patch.status !== 'running') bDriving.current[rid] = false;   // done/failed/gate → stop this branch loop
                  else setTimeout(function () { driveBranch(rid); }, 1100);
                });
              });
            }, function (err) {
              var msg = (err && err.message) || String(err), rc = retryRef.current[r.id] || 0;
              if (rc < 3) {   // transient failure → retry the SAME step (cursor persisted) with backoff instead of killing the branch
                retryRef.current[r.id] = rc + 1;
                emit(r, [{ phase: (r.phases[r.phase_index] || {}).key, level: 'warn', message: 'Átmeneti hiba: ' + msg + ' — újrapróbálás ' + (rc + 1) + '/3…' }]).then(function () {
                  sb.from('research_autopilot_runs').update({ driver_beat: nowIso() }).eq('id', r.id).then(function () { setTimeout(function () { driveBranch(rid); }, 3000 * (rc + 1)); });
                });
                return;
              }
              emit(r, [{ phase: (r.phases[r.phase_index] || {}).key, level: 'error', message: 'Hiba (3 újrapróbálás után): ' + msg }]).then(function () {
                sb.from('research_autopilot_runs').update({ status: 'failed', error: String(msg), updated_at: nowIso() }).eq('id', r.id).then(function () { bDriving.current[rid] = false; setBranchRow(Object.assign({}, r, { status: 'failed' })); });
              });
            });
          });
        }, function () { bDriving.current[rid] = false; });
    }
    function resumeBranch(rid) {   // restart a failed branch from where it stalled (the study cursor is persisted)
      retryRef.current[rid] = 0;
      var next = null;
      setBranchRuns(function (list) { return (list || []).map(function (x) { if (x.id === rid) { next = Object.assign({}, x, { status: 'running', error: null }); return next; } return x; }); });
      sb.from('research_autopilot_runs').update({ status: 'running', error: null, updated_at: nowIso() }).eq('id', rid).then(function (r) { if (r && r.error) { toast('Nem sikerült: ' + r.error.message, false); return; } if (next) ensureBranchDrive(next); toast('↻ A szál folytatódik…', true); }, function () { toast('Hálózati hiba.', false); });
    }
    function loadBranches(primary) {
      if (!primary || !primary.project_id) return;
      var grp = groupOf(primary);
      sb.from('research_autopilot_runs').select('*').eq('project_id', primary.project_id).eq('owner_id', uid()).neq('status', 'cancelled').then(function (r) {
        if (!alive.current) return;
        var sibs = ((r && r.data) || []).filter(function (x) { return x.id !== primary.id && groupOf(x) === grp; });
        setBranchRuns(sibs); sibs.forEach(ensureBranchDrive);
      });
    }
    useEffect(function () { if (run && run.id) loadBranches(run); }, [run && run.id, run && groupOf(run)]);
    // live mirrors (read by the interval poller below without re-subscribing)
    branchRunsRef.current = branchRuns;
    activeRef.current = !!((run && run.status === 'running') || (branchRuns || []).some(function (b) { return b && b.status === 'running'; }));
    // Activity across ALL parallel threads: load every group run's events (primary + branches) and POLL, since Realtime
    // isn't wired — so the feed shows, continuously, what each thread is doing right now.
    function loadEvents() {
      var ids = [props.runId].concat((branchRunsRef.current || []).map(function (b) { return b.id; }).filter(Boolean));
      sb.from('research_autopilot_events').select('*').in('run_id', ids).order('id', { ascending: true }).limit(700).then(function (r) { if (alive.current) setEvents((r && r.data) || []); });
    }
    useEffect(function () {
      loadEvents();
      var iv = setInterval(function () { if (activeRef.current) loadEvents(); }, 3000);
      return function () { clearInterval(iv); };
    }, [props.runId, (branchRuns || []).map(function (b) { return b.id; }).join(',')]);

    // approve/resume/pause must NOT depend on Realtime (research_autopilot_runs isn't in the supabase_realtime publication →
    // postgres_changes never fires). So update the LOCAL run optimistically (UI reacts instantly) and, after the DB write
    // confirms, restart the driver locally — otherwise pressing „Jóváhagyás" did nothing (DB changed, nothing reacted).
    function setStatus(patch) {
      if (!run) return;
      var prev = run, next = Object.assign({}, run, { updated_at: nowIso() }, patch);
      setRun(next);
      sb.from('research_autopilot_runs').update(Object.assign({ updated_at: nowIso() }, patch)).eq('id', run.id).then(function (r) {
        if (r && r.error) { if (alive.current) setRun(prev); toast('Nem sikerült: ' + r.error.message, false); return; }
        ensureDrive(next);   // resume the pipeline after approve/resume (Realtime won't call ensureDrive for us)
      }, function () { if (alive.current) setRun(prev); toast('Hálózati hiba — próbáld újra.', false); });
    }
    function pause() { setStatus({ status: 'paused' }); }
    function resume() { setStatus({ status: 'running', started_at: (run && run.started_at) || nowIso() }); }
    function stop() {
      function go(ok) { if (ok) setStatus({ status: 'cancelled', finished_at: nowIso() }); }
      if (window.PRUI && window.PRUI.confirm) window.PRUI.confirm({ title: 'Leállítod az Autopilotot?', confirmLabel: 'Leállítás', danger: true }).then(go);
      else go(window.confirm('Leállítod az Autopilotot? A már elkészült eredmények megmaradnak.'));
    }
    function approve() { setStatus({ status: 'running', gate: null }); }
    // Re-target the pipeline to a chosen idea: the downstream phases (literature → …) restart for THAT idea.
    var DOWN = ['literature', 'sr', 'protocol', 'journal', 'writing', 'submission'];
    function switchIdea(ideaId) {
      if (switching || !ideaId || !run) return;
      setSwitching(true);
      var ph = (run.phases || []).map(function (p) { return DOWN.indexOf(p.key) >= 0 ? Object.assign({}, p, { status: p.enabled ? 'wait' : 'skipped', cursor: null, result: null }) : p; });
      var litIdx = -1; ph.forEach(function (p, k) { if (p.key === 'literature' && litIdx < 0) litIdx = k; });
      var cfg = Object.assign({}, run.config || {}, { develop_idea_id: ideaId });
      var patch = { config: cfg, phases: ph, phase_index: litIdx >= 0 ? litIdx : run.phase_index, status: 'running', gate: null };
      var prev = run, next = Object.assign({}, run, { updated_at: nowIso() }, patch);
      setRun(next); setOpenPhase(null);
      sb.from('research_autopilot_runs').update(Object.assign({ updated_at: nowIso() }, patch)).eq('id', run.id).then(function (r) {
        setSwitching(false);
        if (r && r.error) { if (alive.current) setRun(prev); toast('Nem sikerült: ' + r.error.message, false); return; }
        setPhaseArts(function (m) { var n = Object.assign({}, m); DOWN.forEach(function (k) { delete n[k]; }); return n; });   // stale downstream artifacts → reload for the new idea
        ensureDrive(next);
        toast('▶ Átváltva erre az ötletre — az irodalom újraindul.', true);
      }, function () { setSwitching(false); if (alive.current) setRun(prev); toast('Hálózati hiba — próbáld újra.', false); });
    }
    function toggleSel(id) { setSelIdeas(function (m) { var n = Object.assign({}, m); if (n[id]) delete n[id]; else n[id] = true; return n; }); }
    // ADD the ticked ideas as PARALLEL branch runs (non-destructive): the primary keeps developing its idea, and each
    // ticked idea spawns its own sibling run (gates off) that auto-runs its downstream (literature → review → …).
    function startBranches() {
      var ids = Object.keys(selIdeas).filter(function (id) { return selIdeas[id]; });
      if (!ids.length || switching || !run) return;
      setSwitching(true);
      var grp = groupOf(run), prev = run;
      var ideas0 = (phaseArts.ideas && phaseArts.ideas.items) || [];
      function spawn() {
        var litIdx = -1; (prev.phases || []).forEach(function (p, k) { if (p.key === 'literature' && litIdx < 0) litIdx = k; });
        var mkPhases = function () { return (prev.phases || []).map(function (p) { return p.key === 'ideas' ? Object.assign({}, p, { status: 'done', result: 'kiválasztva' }) : (p.enabled ? Object.assign({}, p, { status: 'wait', cursor: null, result: null }) : Object.assign({}, p, { status: 'skipped' })); }); };
        var inserts = ids.map(function (ideaId) { return { project_id: prev.project_id, owner_id: uid(), status: 'running', started_at: nowIso(), phase_index: litIdx >= 0 ? litIdx : 0, phases: mkPhases(), config: Object.assign({}, prev.config || {}, { develop_idea_id: ideaId, group_id: grp, gates: false }) }; });
        sb.from('research_autopilot_runs').insert(inserts).select('*').then(function (ir) {
          setSwitching(false); setSelIdeas({});
          var created = (ir && ir.data) || []; setBranchRuns(function (l) { return (l || []).concat(created); }); created.forEach(ensureBranchDrive);
          toast('▶ ' + ids.length + ' ötlet párhuzamos kidolgozása elindult.', true);
        }, function () { setSwitching(false); toast('Nem sikerült elindítani a szálakat.', false); });
      }
      // stamp the primary with a stable group + its own idea (default = most recent) so it renders as a proper column
      if (!(run.config && run.config.group_id)) {
        var cfgP = Object.assign({}, run.config || {}, { group_id: grp, develop_idea_id: (run.config && run.config.develop_idea_id) || (ideas0[0] && ideas0[0].id) || null });
        setRun(Object.assign({}, run, { config: cfgP }));
        sb.from('research_autopilot_runs').update({ config: cfgP }).eq('id', run.id).then(spawn, spawn);
      } else spawn();
    }

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

    // lazy per-phase artifacts → the phase card expands to show what was actually produced (ideas list, included sources, …)
    function loadPhaseArts(key) {
      if (phaseArts[key] && !phaseArts[key].loading) return;   // cached
      var pid = run.project_id;
      function put(v) { setPhaseArts(function (m) { var n = Object.assign({}, m); n[key] = v; return n; }); }
      put({ loading: true });
      if (key === 'ideas') {
        sb.from('research_ideas').select('id,question,hypothesis,novelty,source').eq('project_id', pid).neq('status', 'rejected').order('created_at', { ascending: false }).limit(15)
          .then(function (r) { if (alive.current) put({ items: (r && r.data) || [] }); }, function () { if (alive.current) put({ items: [] }); });
      } else if (key === 'literature') {
        Promise.all([
          sb.from('research_sources').select('id', { count: 'exact', head: true }).eq('project_id', pid),
          sb.from('research_sources').select('id,title,year,url,screening').eq('project_id', pid).eq('screening', 'include').order('cited_by', { ascending: false, nullsFirst: false }).limit(15)
        ]).then(function (res) { if (alive.current) put({ total: (res[0] && res[0].count) || 0, items: (res[1] && res[1].data) || [] }); }, function () { if (alive.current) put({ items: [] }); });
      } else if (key === 'sr') {
        // the generated systematic review is a markdown file in research_files (studies/…-review.md)
        sb.from('research_files').select('id,path,content,updated_at').eq('project_id', pid).ilike('path', 'studies/%').order('updated_at', { ascending: false }).limit(8)
          .then(function (r) { if (alive.current) put({ files: ((r && r.data) || []).filter(function (f) { return /\.md$/i.test(f.path); }) }); }, function () { if (alive.current) put({ files: [] }); });
      } else { put({ items: [] }); }   // other phases: the detail shows a Research deep-link instead of a list
    }
    function togglePhase(p) { if (openPhase === p.key) { setOpenPhase(null); return; } setOpenPhase(p.key); loadPhaseArts(p.key); }
    function phaseDetail(p) {
      var a = phaseArts[p.key];
      if (!a || a.loading) return h('div', { className: 'ap-pc-dempty' }, h('span', { className: 'spin' }));
      if (p.key === 'ideas') {
        var items = a.items || [];
        return items.length ? h('div', { className: 'ap-pc-list' }, items.map(function (x) {
          return h('div', { className: 'ap-pc-li', key: x.id }, h('span', { className: 'ap-pc-li-t' }, x.question || 'Ötlet'), (x.novelty != null) ? h('span', { className: 'ap-pc-li-n' }, '★ ' + x.novelty) : null);
        })) : h('div', { className: 'ap-pc-dempty' }, 'Még nincs ötlet.');
      }
      if (p.key === 'literature') {
        var its = a.items || [];
        return h('div', null,
          (a.total != null) ? h('div', { className: 'ap-pc-dmeta' }, a.total + ' forrás · ' + its.length + ' included (top)') : null,
          its.length ? h('div', { className: 'ap-pc-list' }, its.map(function (x) {
            return h('div', { className: 'ap-pc-li', key: x.id }, x.url ? h('a', { className: 'ap-pc-li-t', href: x.url, target: '_blank', rel: 'noopener' }, x.title || 'Forrás') : h('span', { className: 'ap-pc-li-t' }, x.title || 'Forrás'), x.year ? h('span', { className: 'ap-pc-li-n' }, String(x.year)) : null);
          })) : h('div', { className: 'ap-pc-dempty' }, 'Nincs included forrás.'));
      }
      if (p.key === 'sr') {
        var files = a.files || [];
        if (!files.length) return h('div', { className: 'ap-pc-dempty' }, 'Még nincs elkészült áttekintés.');
        return h('div', { className: 'ap-pc-list' }, files.map(function (f) {
          var name = String(f.path || '').split('/').pop();
          return h('div', { className: 'ap-pc-li', key: f.id },
            h('span', { className: 'ap-pc-li-t' }, '📄 ' + name),
            (f.content != null)
              ? h('button', { className: 'btn sm', onClick: function () { setPreview({ title: name, content: f.content }); } }, 'Olvasás →')
              : h('a', { className: 'btn sm', href: 'Research.html?project=' + encodeURIComponent(run.project_id), target: '_blank', rel: 'noopener' }, 'Megnyitás ↗'));
        }));
      }
      return h('a', { className: 'btn sm', href: 'Research.html?project=' + encodeURIComponent(run.project_id), target: '_blank', rel: 'noopener' }, 'Megnyitás a Research-ben ↗');
    }
    // ── Process-graph node (top-to-bottom flow) — the seed brief, then one node per phase, joined by hued connectors.
    // Each node shows its status (vár/fut/kész) and expands to its real partial results (ideas list, sources, review).
    function briefNode() {
      return h('div', { className: 'apg-step', key: '__brief' },
        h('div', { className: 'apg-node brief', style: { '--hue': 'var(--h-brief)' } },
          h('div', { className: 'apg-hd static' },
            h('span', { className: 'apg-ic' }, '🎯'),
            h('span', { className: 'apg-tx' }, h('span', { className: 'apg-lab' }, 'Brief'), h('span', { className: 'apg-sub' }, (project && (project.goal || project.title)) || '…')))),
        h('div', { className: 'apg-conn done' }));
    }
    function phaseNode(p, i, last) {
      var badge = p.status === 'done' ? '✓ Kész' : p.status === 'running' ? 'Fut…' : p.status === 'gate' ? '⏸ Jóváhagyás' : p.status === 'skipped' ? 'Kihagyva' : 'Vár';
      var sub = p.status === 'done' ? (p.result || 'kész') : p.status === 'running' ? 'dolgozik…' : p.status === 'gate' ? 'jóváhagyásra vár' : p.status === 'skipped' ? (p.result || 'kihagyva') : (p.enabled ? '—' : 'letiltva');
      var open = openPhase === p.key, active = (p.status === 'running' || p.status === 'gate');
      var conn = last ? null : h('div', { className: 'apg-conn' + (p.status === 'done' ? ' done' : active ? ' run' : '') });
      // IDEAS phase = parallel columns; the user PICKS which idea the pipeline develops (config.develop_idea_id).
      // The active idea flows down into the shared downstream (literature → review → …); the others offer „Ezt dolgozd ki".
      if (p.key === 'ideas') {
        var ia = phaseArts.ideas, ideas = (ia && !ia.loading && ia.items) || [];
        var developing = {}; [run].concat(branchRuns || []).forEach(function (rr) { var did = rr && rr.config && rr.config.develop_idea_id; if (did) developing[did] = rr; });
        if (!Object.keys(developing).length && ideas[0]) developing[ideas[0].id] = run;   // default: primary develops the most recent
        var selCount = Object.keys(selIdeas).filter(function (id) { return selIdeas[id]; }).length;
        return h('div', { className: 'apg-step apg-step-wide', key: p.key },
          h('div', { className: 'apg-node ' + p.status + (p.enabled ? '' : ' off'), style: { '--hue': hueOf('ideas') } },
            h('div', { className: 'apg-hd static' },
              h('span', { className: 'apg-ic' }, AP_ICON.ideas || '💡'),
              h('span', { className: 'apg-tx' }, h('span', { className: 'apg-lab' }, p.label + (ideas.length ? ' · ' + ideas.length : '')), h('span', { className: 'apg-sub' }, ideas.length ? 'pipáld ki, melyeket dolgozzon ki párhuzamosan az Autopilot' : sub)),
              h('span', { className: 'apg-badge ' + (p.status === 'gate' ? 'gate' : p.status) }, badge))),
          ideas.length ? h('div', { className: 'apg-fan-conn' }) : null,
          ideas.length ? h('div', { className: 'apg-fan' }, ideas.map(function (x) {
            var dev = !!developing[x.id], sel = !!selIdeas[x.id];
            return h('div', { className: 'apg-idea' + (dev ? ' active' : '') + (sel ? ' sel' : ''), key: x.id, style: { '--hue': hueOf('ideas') }, title: (x.hypothesis || x.question || '') },
              h('span', { className: 'apg-idea-h' }, h('span', { className: 'apg-idea-ic' }, '💡'), (x.novelty != null) ? h('span', { className: 'apg-idea-n' }, '★ ' + x.novelty) : null),
              h('span', { className: 'apg-idea-t' }, x.question || 'Ötlet'),
              dev ? h('span', { className: 'apg-idea-badge' }, '◉ Fejlesztés alatt')
                  : h('label', { className: 'apg-idea-pick' }, h('input', { type: 'checkbox', checked: sel, disabled: switching, onChange: function () { toggleSel(x.id); } }), ' Kidolgozásra jelöl'));
          })) : null,
          (ia && ia.loading) ? h('div', { className: 'ap-pc-dempty' }, h('span', { className: 'spin' })) : null,
          selCount ? h('div', { className: 'apg-develop' }, h('button', { className: 'btn pri sm', disabled: switching, onClick: startBranches }, switching ? '⏳ Indítás…' : ('▶ Kidolgozás — ' + selCount + ' szál párhuzamosan'))) : null,
          conn);
      }
      return h('div', { className: 'apg-step', key: p.key },
        h('div', { className: 'apg-node ' + p.status + (p.enabled ? '' : ' off') + (open ? ' open' : ''), style: { '--hue': hueOf(p.key) } },
          h('button', { className: 'apg-hd', onClick: function () { togglePhase(p); }, title: 'Részeredmények' },
            h('span', { className: 'apg-ic' }, AP_ICON[p.key] || '•'),
            h('span', { className: 'apg-tx' }, h('span', { className: 'apg-lab' }, p.label), h('span', { className: 'apg-sub' }, sub)),
            h('span', { className: 'apg-badge ' + (p.status === 'gate' ? 'gate' : p.status) }, badge),
            h('span', { className: 'apg-caret' }, open ? '▾' : '▸')),
          open ? h('div', { className: 'apg-detail' }, phaseDetail(p)) : null),
        conn);
    }
    // ── Parallel branch columns: one compact downstream mini-chain per developing idea (primary + branch runs).
    function openReviewPreview(prun) {
      var pid = (prun && prun.project_id) || run.project_id;
      sb.from('research_files').select('path,content').eq('project_id', pid).ilike('path', 'studies/%').order('updated_at', { ascending: false }).limit(8).then(function (r) {
        var f = ((r && r.data) || []).filter(function (x) { return /\.md$/i.test(x.path) && x.content != null; })[0];
        if (f) setPreview({ title: String(f.path).split('/').pop(), content: f.content }); else toast('Nincs elérhető áttekintés-fájl.', false);
      });
    }
    function downMini(prun, p, last) {
      var st = p.status, isRev = p.key === 'sr', revDone = isRev && st === 'done';
      var bd = st === 'done' ? '✓' : st === 'running' ? 'fut' : st === 'gate' ? '⏸' : st === 'skipped' ? '–' : '·';
      return h('div', { className: 'apg-mini-wrap', key: p.key },
        h('div', { className: 'apg-mini ' + st, style: { '--hue': hueOf(p.key) } },
          h('span', { className: 'apg-mini-ic' }, AP_ICON[p.key] || '•'),
          h('span', { className: 'apg-mini-lab' }, p.label),
          revDone ? h('button', { className: 'apg-mini-read', onClick: function () { openReviewPreview(prun); } }, 'Olvasás') : h('span', { className: 'apg-mini-badge ' + (st === 'gate' ? 'gate' : st) }, bd)),
        last ? null : h('div', { className: 'apg-conn' + (st === 'done' ? ' done' : (st === 'running' || st === 'gate') ? ' run' : '') }));
    }
    function branchColumn(prun) {
      var isPrimary = prun.id === run.id;
      var ideas0 = (phaseArts.ideas && phaseArts.ideas.items) || [];
      var ideaId = (prun.config && prun.config.develop_idea_id) || (isPrimary && ideas0[0] ? ideas0[0].id : null);
      var idea = ideas0.filter(function (x) { return x.id === ideaId; })[0];
      var down = (prun.phases || []).filter(function (p) { return DOWN.indexOf(p.key) >= 0 && p.enabled; });
      var failed = prun.status === 'failed';
      return h('div', { className: 'apg-col' + (isPrimary ? ' primary' : '') + (failed ? ' failed' : ''), key: prun.id },
        h('div', { className: 'apg-col-h' },
          h('span', { className: 'apg-col-ic' }, failed ? '✕' : '💡'),
          h('span', { className: 'apg-col-t', title: (idea && idea.question) || '' }, (idea && idea.question) || (isPrimary ? 'Fő szál' : 'Ötlet')),
          isPrimary ? h('span', { className: 'apg-col-tag' }, 'fő') : null,
          failed ? h('button', { className: 'apg-col-retry', title: (prun.error ? ('Hiba: ' + prun.error + ' — ') : '') + 'A szál folytatása onnan, ahol elakadt', onClick: function () { isPrimary ? resume() : resumeBranch(prun.id); } }, '↻ Újra') : null),
        h('div', { className: 'apg-fan-conn' }),
        h('div', { className: 'apg-col-chain' }, down.map(function (p, i) { return downMini(prun, p, i === down.length - 1); })));
    }
    function branchesRow() {
      var cols = [run].concat((branchRuns || []).filter(function (r) { return r && r.config && r.config.develop_idea_id; }));   // primary always + each branch
      return h('div', { className: 'apg-branches' + (cols.length > 1 ? ' multi' : '') }, cols.map(branchColumn));
    }
    // which thread (idea) an activity event belongs to → shown as a chip in the feed when parallel threads run
    function threadLabel(runId) {
      var rr = ([run].concat(branchRuns || [])).filter(function (x) { return x && x.id === runId; })[0];
      if (!rr) return null;
      var did = rr.config && rr.config.develop_idea_id;
      var idea = ((phaseArts.ideas && phaseArts.ideas.items) || []).filter(function (x) { return x.id === did; })[0];
      return (idea && idea.question) ? idea.question : (rr.id === run.id ? 'Fő szál' : 'Ág');
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
        h('div', { className: 'apg-flow' }, briefNode(),
          phaseNode((phases.filter(function (p) { return p.key === 'ideas'; })[0]) || phases[0], 0, false),   // ideas fan (multi-select)
          branchesRow()),   // parallel downstream columns — one per developing idea (primary + branches)
        h('div', { className: 'ap-dside' },
          focusPanel(),
          h('div', { className: 'ap-card ap-feed' }, h('h3', null, 'Activity', ((branchRuns || []).length ? h('span', { className: 'ap-feed-live' }, '● ' + (1 + (branchRuns || []).length) + ' szál') : null)),
            h('div', { className: 'ap-feed-list', ref: feedRef }, events.length ? events.map(function (e) {
              var multi = (branchRuns || []).length > 0, tag = multi ? threadLabel(e.run_id) : null;
              return h('div', { className: 'ap-feed-row ' + (e.level || 'run'), key: e.id },
                h('span', { className: 'ap-fi' }, EV_ICON[e.level] || '•'),
                h('span', { className: 'ap-ft' }, tag ? h('span', { className: 'ap-fthread', title: tag }, tag.length > 24 ? tag.slice(0, 24) + '…' : tag) : null, e.message));
            }) : h('div', { className: 'ap-feed-empty' }, 'Még nincs esemény…'))))),
      h('div', { className: 'ap-dacts' },
        h('a', { className: 'btn sm', href: 'Research.html?project=' + encodeURIComponent(run.project_id) }, 'Megnyitás a Research-ben ↗'),
        h('button', { className: 'btn sm', onClick: props.onExit }, '‹ Új kutatás')),
      preview ? h('div', { className: 'ap-pv-scrim', onClick: function () { setPreview(null); } },
        h('div', { className: 'ap-pv', onClick: function (e) { e.stopPropagation(); } },
          h('div', { className: 'ap-pv-h' }, h('b', null, '🔬 ' + (preview.title || 'Áttekintés')), h('button', { className: 'ap-pv-x', 'aria-label': 'Bezárás', onClick: function () { setPreview(null); } }, '×')),
          h('div', { className: 'ap-pv-b report-doc', dangerouslySetInnerHTML: { __html: mdSafe(preview.content || '') } }),
          h('div', { className: 'ap-pv-f' },
            h('button', { className: 'btn sm', onClick: function () { try { navigator.clipboard.writeText(preview.content || ''); toast('Vágólapra másolva', true); } catch (e) { } } }, 'Másolás (Markdown)'),
            h('button', { className: 'btn pri sm', onClick: function () { setPreview(null); } }, 'Bezárás')))) : null);
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

  // Left sidebar: every Autopilot project I started — briefs (surface='autopilot' chats, reopen into the brief step) AND
  // launched runs (research_autopilot_runs, reopen the dashboard). This is how a started conversation is recalled.
  function SideProjects(props) {
    var rS = useState(null), rows = rS[0], setRows = rS[1];   // null = loading; [] = none
    var alive = useRef(true);
    useEffect(function () { return function () { alive.current = false; }; }, []);
    useEffect(function () {
      var u = uid();
      Promise.all([
        // 'autopilot' (new, marked) OR null-surface (old briefs: startProject used to create a chat with no surface).
        // Research/Map chats always set surface, so a null-surface chat in MY project = an Autopilot brief. RLS scopes to readable projects.
        sb.from('research_chats').select('id,project_id,created_at,surface,title').or('surface.eq.autopilot,surface.is.null').order('created_at', { ascending: false }).limit(160),
        sb.from('research_autopilot_runs').select('id,project_id,status,phase_index,phases,updated_at,started_at').eq('owner_id', u).neq('status', 'cancelled').order('updated_at', { ascending: false }).limit(60)
      ]).then(function (res) {
        if (!alive.current) return;
        // keep autopilot-marked chats + legacy briefs (null surface AND the 'Publify chat' title — the Canvas dock fallback uses a different title)
        var chats = ((res[0] && res[0].data) || []).filter(function (c) { return c.surface === 'autopilot' || (c.surface == null && c.title === 'Publify chat'); });
        var runs = (res[1] && res[1].data) || [];
        var pids = {}; chats.forEach(function (c) { pids[c.project_id] = 1; }); runs.forEach(function (r) { pids[r.project_id] = 1; });
        var idl = Object.keys(pids); if (!idl.length) { setRows([]); return; }
        // keep ONLY my own projects (drops null-surface chats living in projects shared with me)
        sb.from('research_projects').select('id,title,goal,updated_at').eq('owner_id', u).in('id', idl).then(function (pr) {
          if (!alive.current) return;
          var pm = {}; ((pr && pr.data) || []).forEach(function (p) { pm[p.id] = p; });
          var chatBy = {}; chats.forEach(function (c) { if (!chatBy[c.project_id]) chatBy[c.project_id] = c; });   // newest chat per project
          var runBy = {}; runs.forEach(function (r) { if (!runBy[r.project_id]) runBy[r.project_id] = r; });
          var list = Object.keys(pm).map(function (pid) {
            var p = pm[pid], run = runBy[pid] || null, chat = chatBy[pid] || null;
            return { pid: pid, title: (p.title || 'Névtelen projekt'), goal: (p.goal || ''), chatId: chat ? chat.id : null, run: run,
              ts: (run && (run.updated_at || run.started_at)) || (p.updated_at) || (chat && chat.created_at) || '' };
          }).sort(function (a, b) { return String(b.ts || '').localeCompare(String(a.ts || '')); });
          setRows(list);
        }, function () { if (alive.current) setRows([]); });
      }, function () { if (alive.current) setRows([]); });
    }, [props.reloadKey]);
    function rel(ts) { if (!ts) return ''; var d = (Date.now() - Date.parse(ts)) / 1000; if (d < 3600) return Math.max(1, Math.round(d / 60)) + ' perce'; if (d < 86400) return Math.round(d / 3600) + ' órája'; if (d < 2592000) return Math.round(d / 86400) + ' napja'; try { return new Date(ts).toLocaleDateString('hu-HU'); } catch (e) { return ''; } }
    return h('aside', { className: 'ap-side' },
      h('div', { className: 'ap-side-h' }, 'Projektjeim', rows && rows.length ? h('span', { className: 'ap-side-c' }, rows.length) : null),
      rows === null ? h('div', { className: 'ap-side-empty' }, h('span', { className: 'spin' })) :
      !rows.length ? h('div', { className: 'ap-side-empty' }, 'Még nincs megkezdett projekt. Indíts egy beszélgetést jobbra →') :
      h('div', { className: 'ap-side-list' }, rows.map(function (row) {
        var run = row.run, eff = run ? apEffectiveStatus(run) : null, st = run ? (AP_STATUS[eff] || AP_STATUS.queued) : null, pr = run ? apProgress(run) : null;
        return h('button', { key: row.pid, className: 'ap-side-row', title: row.goal || row.title,
          onClick: function () { if (run) props.onOpenRun(run.id); else props.onOpenBrief(row.pid, row.chatId); } },
          h('div', { className: 'ap-side-t' }, row.title),
          row.goal ? h('div', { className: 'ap-side-g' }, row.goal) : null,
          h('div', { className: 'ap-side-meta' },
            run ? h('span', { className: 'ap-pill ' + st.cls }, h('span', { className: 'ap-sdot' }), st.t)
                : h('span', { className: 'ap-pill ap-pill-brief' }, '📝 Piszkozat'),
            run && pr ? h('span', { className: 'ap-side-pr mono' }, pr.done + '/' + pr.enabled) : null,
            row.ts ? h('span', { className: 'ap-side-ts' }, rel(row.ts)) : null));
      })));
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
        sb.from('research_chats').insert({ project_id: proj.id, title: 'Publify chat', owner_id: u, surface: 'autopilot' }).select('id').maybeSingle().then(function (cr) {   // surface tag → the launcher sidebar can list + reopen started briefs
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
    // reopen a started-but-not-launched brief from the sidebar: load the project + its brief chat back into the brief step
    function openBrief(pid, cid) {
      if (!pid) return;
      setChatId(cid || null); setFiles([]); setIdeasCount(0);
      sb.from('research_projects').select('id,title,goal,keywords,student_id,field,status,stage').eq('id', pid).maybeSingle().then(function (r) {
        var p = r && r.data; if (!p) { toast('A projekt nem elérhető.', false); return; }
        setProject(p); setView('brief'); refreshFiles(pid); refreshIdeas(pid);
        if (!cid) sb.from('research_chats').select('id').eq('project_id', pid).eq('surface', 'autopilot').order('created_at', { ascending: false }).limit(1).maybeSingle().then(function (cr) { if (cr && cr.data) setChatId(cr.data.id); });
      });
    }
    // back to the launcher list WITHOUT discarding the current brief (distinct from Discard, which deletes)
    function backToList() { try { history.replaceState(null, '', 'Autopilot.html'); } catch (e) { } setRunId(null); setProject(null); setChatId(null); setFiles([]); setIdeasCount(0); setView('launcher'); }
    // the dashboard is a full-screen surface (own header + controls) — resumable via ?run=<id>
    if (view === 'dashboard') return h(Dashboard, { runId: runId, onExit: exitToLauncher });

    // stepper (only on launcher/brief/launch)
    var STEP = view === 'launcher' || view === 'brief' ? 1 : view === 'launch' ? 2 : 3;
    function stepBtn(n, label, vgo, disabled) {
      var cls = 'ap-st' + (STEP === n ? ' on' : STEP > n ? ' done' : '');
      return h('button', { className: cls, disabled: disabled || !project, onClick: function () { if (!disabled && project) setView(vgo); } }, h('span', { className: 'n' }, n), label);
    }

    var body;
    if (view === 'launcher') body = h('div', { className: 'ap-launch-2col' },
      h(SideProjects, { onOpenBrief: openBrief, onOpenRun: openRun }),
      h('div', { className: 'ap-launch-main' }, h(Launcher, { creating: creating, onStart: startProject })));
    else if (view === 'brief') body = h('div', { className: 'ap-split' },
      h(Chat, { projectId: project.id, chatId: chatId, projectTitle: project.title, onReply: function () { }, onFilesChanged: function () { refreshFiles(project.id); }, onDiscard: discardProject }),
      h(BriefPanel, {
        project: project, files: files, ideasCount: ideasCount,
        onPatched: function (patch) { setProject(Object.assign({}, project, patch)); },
        onSuggestIdeas: suggestIdeas, onReview: function () { setView('launch'); }
      }));
    else body = h(LaunchView, { project: project, files: files, cfg: cfg, setCfg: setCfg, launching: launching, onBack: function () { setView('brief'); }, onLaunch: doLaunch });

    return h('div', { className: 'ap-wrap' + (view === 'brief' ? ' ap-full' : '') },   // brief step = full-screen split (chat + brief fill the viewport)
      h('div', { className: 'ap-steps' },
        view !== 'launcher' ? h('button', { className: 'ap-backlist', title: 'Vissza a projektjeimhez (nem veti el a beszélgetést)', onClick: backToList }, '‹ Projektjeim') : null,
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
