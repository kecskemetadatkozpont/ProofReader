/* Publify — Autopilot orchestrator CORE (window.PRAutopilotCore).
 * Client-driven, tick-based, resumable phase engine. Each apStep(run, project) does ONE bounded unit of work
 * (usually one edge call) and returns a { patch, events } that the caller persists to research_autopilot_runs/_events.
 * Reusable so BOTH the Autopilot dashboard (autopilot.js) and the Pipeline Canvas driver (research.jsx) can drive a run.
 * NOTE: autopilot.js currently keeps its own in-file copy of this same orchestrator for the dashboard — if you change
 * a stepper here, mirror it there (and vice-versa) until the dashboard is migrated onto this core. */
(function () {
  'use strict';
  var BE = window.PR_BACKEND, sb = BE && BE.sb, CFG = window.PR_CONFIG || {};
  if (!sb) return;
  function uid() { return (BE.user && BE.user.id) || null; }
  function nowIso() { return new Date().toISOString(); }

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
  // a 'running' run that no browser tab has driven for >60s reads as 'stalled' (honest: nothing is advancing it)
  function apEffectiveStatus(run) {
    if (run && run.status === 'running') { var u = run.updated_at ? new Date(run.updated_at).getTime() : 0; if (u && (Date.now() - u) > 60000) return 'stalled'; }
    return run && run.status;
  }
  function apProgress(run) {
    var ph = (run && run.phases) || [];
    var enabled = ph.filter(function (p) { return p.enabled; }).length || 1;
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
    function finishProtocol(pid, steps, msg) {
      return sb.from('research_protocol_steps').select('id', { count: 'exact', head: true }).eq('protocol_id', pid).eq('needs_approval', true).then(function (cr) {
        var na = (cr && cr.count) || 0, evs = [{ phase: 'protocol', level: 'run', message: msg }];
        if (na > 0 && apGatesOn(run)) return apGate(run, { phase: 'protocol', title: na + ' protokoll-lépés jóváhagyása', detail: na + ' lépés „needs approval". Nézd át a Protocol-fülön, majd hagyd jóvá a futtatáshoz.' }, { generated: true }, { protocol_id: pid });
        var res = apComplete(run, msg, evs); res.patch.protocol_id = pid; return res;
      });
    }
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

  window.PRAutopilotCore = {
    AP_PHASES: AP_PHASES, AP_ICON: AP_ICON,
    apEffectiveStatus: apEffectiveStatus, apProgress: apProgress,
    apStep: apStep, callEdge: callEdge, saveFile: saveFile
  };
})();
