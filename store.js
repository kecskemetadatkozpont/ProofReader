/* Shared project store for Aloud (localStorage-backed, Phase 1 prototype).
 * Requires sample.js and auth.js. Adds collaboration: members/roles, share links,
 * activity log, versions, annotations (comments + to-dos), usage metering,
 * reading sessions, and cross-tab realtime notifications. */
(function () {
  'use strict';
  var KEY = 'proofreader:projects';
  var PREFS = 'proofreader:prefs';
  var USAGE = 'proofreader:usage';
  var TTS = 'proofreader:tts';
  var READING = 'proofreader:reading';
  var TICK = 'proofreader:tick';
  var TRASH_TTL = 7 * 24 * 60 * 60 * 1000; // deleted projects are kept (restorable) for 7 days, then auto-purged

  var PLAN = {
    free: { storage: 50 * 1024 * 1024, chars: 10000, label: 'Free' },
    pro: { storage: 1024 * 1024 * 1024, chars: 200000, label: 'Pro' }
  };

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function read(k, d) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return d; } }
  function readAll() { return read(KEY, []) || []; }
  function trySet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function storageFull() { try { window.dispatchEvent(new CustomEvent('pr-storage-full')); } catch (e) { } console.warn('[Aloud] localStorage is full — save could not complete.'); }
  function trimVersions(arr, keepAutos) {
    return arr.map(function (p) {
      if (!p.versions || !p.versions.length) return p;
      var named = p.versions.filter(function (v) { return v.named; });
      var autos = p.versions.filter(function (v) { return !v.named; }).slice(0, keepAutos);
      var c = Object.assign({}, p); c.versions = named.concat(autos); return c;
    });
  }
  // returns true on success; on quota failure trims version history and retries, else warns
  function writeAll(arr) {
    if (trySet(KEY, JSON.stringify(arr))) { notify(); return true; }
    if (trySet(KEY, JSON.stringify(trimVersions(arr, 5)))) { notify(); return true; }
    if (trySet(KEY, JSON.stringify(trimVersions(arr, 0)))) { notify(); return true; }
    storageFull(); return false;
  }

  /* ---- realtime ---- */
  var subs = [];
  var bc = null; try { bc = new BroadcastChannel('proofreader-data'); } catch (e) { }
  if (bc) bc.onmessage = function () { subs.forEach(function (cb) { cb(); }); };
  window.addEventListener('storage', function (e) {
    if (!e.key || e.key.indexOf('proofreader:') !== 0) return;
    subs.forEach(function (cb) { cb(); });
  });
  function notify() { trySet(TICK, String(Date.now())); if (bc) bc.postMessage(1); }
  function subscribe(cb) { subs.push(cb); return function () { subs = subs.filter(function (x) { return x !== cb; }); }; }

  function curId() { var u = window.PRAuth && window.PRAuth.current(); return u ? u.id : 'u_anna'; }
  // for per-user prefs: a signed-out session gets its OWN namespace ('__anon'), not a real user's blob
  function prefUid() { var u = window.PRAuth && window.PRAuth.current(); return u ? u.id : '__anon'; }

  function normalize(p) {
    if (!p) return p;
    if (!p.ownerId) p.ownerId = 'u_anna';
    if (!p.members) p.members = [];
    if (!p.link) p.link = { enabled: false, role: 'viewer' };
    if (!p.activity) p.activity = [];
    if (!p.versions) p.versions = [];
    if (!p.annotations) p.annotations = [];
    if (!p.folders) p.folders = [];
    return p;
  }

  function blankFiles(title) {
    var tex = '\\documentclass[11pt]{article}\n\\usepackage{amsmath}\n\\usepackage{graphicx}\n\n' +
      '\\title{' + (title || 'Untitled') + '}\n\\author{Your Name}\n\\date{\\today}\n\n' +
      '\\begin{document}\n\\maketitle\n\n\\section{Introduction}\n' +
      'Start writing here. Press play in the toolbar to hear this sentence read aloud. ' +
      'Click any sentence in the editor to set where reading begins.\n\n' +
      '\\section{Background}\nAdd your content, equations, figures and tables. ' +
      'When you spot a mistake, pause, fix it, and continue listening.\n\n\\end{document}\n';
    return { active: 'main.tex', order: ['main.tex'], folders: [], files: { 'main.tex': { type: 'tex', content: tex } } };
  }
  function sampleFiles() {
    var s = window.PR_SAMPLE;
    return { active: s.active, order: s.order.slice(), files: clone(s.files), folders: (s.folders || []).slice() };
  }

  function countSentences(project) {
    try { var f = project.files[project.active]; if (!f || f.type !== 'tex' || !window.LatexEngine) return null; return window.LatexEngine.process(f.content, project.files).sentences.length; }
    catch (e) { return null; }
  }
  function titleGuess(project) {
    var f = project.files[project.active];
    if (f && f.type === 'tex') { var m = /\\title\{([\s\S]*?)\}/.exec(f.content); if (m) { var t = m[1].replace(/\\\\/g, ' ').replace(/\\[a-zA-Z]+\{?|[{}~]/g, '').replace(/\s+/g, ' ').trim(); if (t) return t; } }
    return project.title;
  }
  function bytesOf(project) {
    try {
      var meta = new Blob([JSON.stringify({ f: project.files, v: project.versions })]).size;
      var media = 0; var f = project.files || {};
      Object.keys(f).forEach(function (k) { if (f[k] && typeof f[k].size === 'number') media += f[k].size; }); // externally stored media (size in bytes)
      return meta + media;
    } catch (e) { return JSON.stringify(project.files || {}).length; }
  }

  /* ---- AI-review import helpers (locate a finding's quote in the source → anchored 'review' annotation) ---- */
  function baseName(x) { return (x || '').split('/').pop(); }
  function locateQuote(content, quote) {
    if (!content || !quote) return -1;
    var i = content.indexOf(quote); if (i >= 0) return i;
    var nq = quote.replace(/\s+/g, ' ').trim(); // whitespace-tolerant fallback
    try { var esc = nq.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'); var m = new RegExp(esc).exec(content); if (m) return m.index; } catch (e) { }
    return -1;
  }
  function reviewTargetFile(p, fname) {
    var files = p.files || {}, b = baseName(fname), keys = Object.keys(files);
    var hit = keys.filter(function (k) { return files[k] && files[k].type === 'tex' && baseName(k) === b; })[0];
    if (hit) return hit;
    hit = keys.filter(function (k) { return files[k] && files[k].type === 'tex' && /\\documentclass/.test(files[k].content || ''); })[0];
    return hit || p.active;
  }
  function importReviewInto(p, findings, mkid) {
    var files = p.files || {}, imported = 0, unanchored = 0, now = Date.now();
    (findings || []).forEach(function (f, idx) {
      if (!f || !f.comment) return;
      var path = reviewTargetFile(p, f.file);
      var content = (files[path] && files[path].content) || '';
      var q = f.quote || '';
      var at = locateQuote(content, q);
      var ann = {
        id: mkid(), kind: 'review', category: f.category || 'style', severity: f.severity || 'minor',
        comment: f.comment, body: f.comment, suggestion: f.suggestion || '', replacement: f.replacement || '', confidence: f.confidence || 'medium',
        authorId: 'ai-review', createdAt: now + idx, status: 'open', replies: [],
        anchor: { file: path, start: at >= 0 ? at : 0, end: at >= 0 ? at + q.length : 0, quote: q }
      };
      if (at >= 0) imported++; else { unanchored++; ann._unanchored = true; }
      p.annotations.push(ann);
    });
    return { imported: imported, unanchored: unanchored, total: (findings || []).length };
  }

  var Store = {
    PLAN: PLAN,
    subscribe: subscribe,

    raw: function () { return readAll().map(normalize); },
    list: function () { return this.raw().filter(function (p) { return !p.deletedAt; }).sort(function (a, b) { return (b.updated || 0) - (a.updated || 0); }); },
    listFor: function (userId) {
      this.purgeExpired();
      return this.list().filter(function (p) {
        return p.ownerId === userId || p.members.some(function (m) { return m.userId === userId; });
      }).map(function (p) { p._shared = p.ownerId !== userId; return p; });
    },
    get: function (id) { var p = readAll().filter(function (p) { return p.id === id; })[0]; return p ? normalize(p) : null; },
    roleOf: function (project, userId) {
      if (!project) return null;
      if (project.ownerId === userId) return 'owner';
      var m = project.members.filter(function (m) { return m.userId === userId; })[0];
      if (m) return m.role;
      if (project.link && project.link.enabled) return project.link.role;
      return null;
    },
    canEdit: function (project, userId) { var r = this.roleOf(project, userId); return r === 'owner' || r === 'editor'; },
    canComment: function (project, userId) { var r = this.roleOf(project, userId); return r === 'owner' || r === 'editor' || r === 'commenter'; },

    save: function (project) {
      normalize(project); project.updated = Date.now();
      var arr = readAll(); var i = arr.findIndex(function (p) { return p.id === project.id; });
      if (i >= 0) arr[i] = project; else arr.push(project);
      writeAll(arr); return project;
    },
    create: function (title, template, opts) {
      opts = opts || {};
      var owner = curId();
      // resolve a publication template (templates.js registry) → skeleton + format limits + bibliometrics
      var reg = window.PR_TEMPLATES && window.PR_TEMPLATES.byId ? window.PR_TEMPLATES.byId(template) : null;
      var base = reg && window.PR_TEMPLATES.filesFor(template, { title: title });
      if (!base) base = template === 'sample' ? sampleFiles() : blankFiles(title);
      var journal = (opts.journal || (reg && reg.journalMeta ? reg.name : '') || '').trim();
      var p = normalize({ id: uid(), title: title || 'Untitled project', created: Date.now(), updated: Date.now(), idx: 0, ownerId: owner, files: base.files, order: base.order, folders: base.folders || [], active: base.active, journal: journal });
      if (reg) { p.templateId = reg.id; if (reg.journalMeta) p.journalMeta = clone(reg.journalMeta); if (reg.limits) p.limits = clone(reg.limits); }
      if (opts.members && opts.members.length) {
        p.members = opts.members.filter(function (m) { return m && m.userId && m.userId !== owner; })
          .map(function (m) { return { userId: m.userId, role: m.role || 'editor', invitedAt: Date.now() }; });
      }
      this.save(p);
      this.logActivity(p.id, owner, 'created', p.title);
      (p.members || []).forEach(function (m) { var u = window.PRAuth && window.PRAuth.byId(m.userId); Store.logActivity(p.id, owner, 'shared with', (u || {}).name || m.userId); });
      return p;
    },
    duplicate: function (id) { var s = this.get(id); if (!s) return null; var p = clone(s); p.id = uid(); p.title = s.title + ' (copy)'; p.created = p.updated = Date.now(); p.ownerId = curId(); p.members = []; p.activity = []; delete p.deletedAt; return this.save(p); },
    rename: function (id, title) { var p = this.get(id); if (!p) return; p.title = title; this.save(p); },
    setJournal: function (id, journal) { var p = this.get(id); if (!p) return; p.journal = (journal || '').trim(); this.save(p); },
    /* ---- trash (soft-delete, 7-day retention, restorable) ---- */
    remove: function (id) { var p = this.get(id); if (!p) return; p.deletedAt = Date.now(); this.save(p); this.logActivity(id, curId(), 'moved to trash', p.title); },
    restore: function (id) { var p = this.get(id); if (!p) return; delete p.deletedAt; this.save(p); this.logActivity(id, curId(), 'restored', p.title); },
    purge: function (id) { writeAll(readAll().filter(function (p) { return p.id !== id; })); },
    purgeExpired: function () {
      var now = Date.now(), arr = readAll();
      var kept = arr.filter(function (p) { return !(p.deletedAt && (now - p.deletedAt) > TRASH_TTL); });
      if (kept.length !== arr.length) writeAll(kept);
    },
    listTrashedFor: function (userId) {
      this.purgeExpired();
      return this.raw().filter(function (p) { return p.deletedAt && p.ownerId === userId; })
        .sort(function (a, b) { return (b.deletedAt || 0) - (a.deletedAt || 0); });
    },
    trashTtl: TRASH_TTL,

    /* ---- sharing ---- */
    addMember: function (id, userId, role) {
      var p = this.get(id); if (!p) return; if (userId === p.ownerId) return;
      var m = p.members.filter(function (x) { return x.userId === userId; })[0];
      if (m) m.role = role; else p.members.push({ userId: userId, role: role, invitedAt: Date.now() });
      this.save(p); this.logActivity(id, curId(), 'shared with', (window.PRAuth.byId(userId) || {}).name || userId);
    },
    setRole: function (id, userId, role) { this.addMember(id, userId, role); },
    removeMember: function (id, userId) { var p = this.get(id); if (!p) return; p.members = p.members.filter(function (m) { return m.userId !== userId; }); this.save(p); },
    setLink: function (id, enabled, role) { var p = this.get(id); if (!p) return; p.link = { enabled: enabled, role: role || p.link.role || 'viewer' }; this.save(p); },

    /* ---- activity ---- */
    logActivity: function (id, actorId, verb, target) {
      var p = this.get(id); if (!p) return; p.activity = p.activity || [];
      p.activity.unshift({ id: uid(), actorId: actorId, verb: verb, target: target || '', at: Date.now() });
      p.activity = p.activity.slice(0, 80);
      var arr = readAll(); var i = arr.findIndex(function (x) { return x.id === id; }); if (i >= 0) { arr[i] = p; writeAll(arr); }
    },

    /* ---- versions (text files only — images aren't versioned, to keep storage small) ---- */
    addVersion: function (id, label, authorId, named) {
      var p = this.get(id); if (!p) return null;
      var snap = {}; Object.keys(p.files).forEach(function (k) { var f = p.files[k]; if (f && f.content != null && f.dataURL == null) { snap[k] = { type: f.type, content: f.content }; if (f.note != null) snap[k].note = f.note; } });
      var last = p.versions[0];
      if (last && !named && JSON.stringify(last.files) === JSON.stringify(snap)) return null; // no change
      var v = { id: uid(), label: label, authorId: authorId, createdAt: Date.now(), files: snap, named: !!named };
      p.versions.unshift(v);
      // thin autosaves: keep all named + last 15 autosaves
      var autos = 0; p.versions = p.versions.filter(function (x) { if (x.named) return true; autos++; return autos <= 15; });
      this.save(p);
      if (named) this.logActivity(id, authorId, 'saved version', label);
      return v;
    },
    listVersions: function (id) { var p = this.get(id); return p ? p.versions : []; },
    restoreVersion: function (id, versionId) {
      var p = this.get(id); if (!p) return; var v = p.versions.filter(function (x) { return x.id === versionId; })[0]; if (!v) return;
      // snapshot current first, then restore (keep images, overlay versioned text files)
      this.addVersion(id, 'Before restore', curId(), true);
      p = this.get(id);
      var restored = {};
      Object.keys(p.files).forEach(function (k) { if (p.files[k] && p.files[k].dataURL != null) restored[k] = p.files[k]; });
      Object.keys(v.files).forEach(function (k) { restored[k] = clone(v.files[k]); if (restored[k].note == null && p.files[k] && p.files[k].note != null) restored[k].note = p.files[k].note; });
      p.files = restored;
      p.order = (p.order || []).filter(function (k) { return restored[k]; });
      Object.keys(restored).forEach(function (k) { if (p.order.indexOf(k) < 0) p.order.push(k); });
      if (!p.files[p.active]) p.active = p.order[0] || '';
      this.save(p); this.logActivity(id, curId(), 'restored', v.label);
      return p;
    },

    /* ---- annotations (comments + todos) ---- */
    listAnnotations: function (id) { var p = this.get(id); return p ? p.annotations : []; },
    addAnnotation: function (id, ann) {
      var p = this.get(id); if (!p) return null;
      ann.id = uid(); ann.createdAt = Date.now(); ann.replies = ann.replies || []; ann.status = ann.status || 'open';
      p.annotations.push(ann); this.save(p);
      this.logActivity(id, ann.authorId, ann.kind === 'todo' ? 'added a to-do' : 'commented', ann.anchor && ann.anchor.quote ? '“' + ann.anchor.quote.slice(0, 40) + '”' : '');
      return ann;
    },
    updateAnnotation: function (id, annId, patch) {
      var p = this.get(id); if (!p) return; var a = p.annotations.filter(function (x) { return x.id === annId; })[0]; if (!a) return;
      Object.assign(a, patch); this.save(p);
    },
    replyAnnotation: function (id, annId, authorId, body, extra) {
      var p = this.get(id); if (!p) return; var a = p.annotations.filter(function (x) { return x.id === annId; })[0]; if (!a) return;
      extra = extra || {};
      a.replies.push({ id: uid(), authorId: authorId, body: body, at: Date.now(), mentions: extra.mentions || [], attachments: extra.attachments || [] }); this.save(p);
    },
    deleteAnnotation: function (id, annId) { var p = this.get(id); if (!p) return; p.annotations = p.annotations.filter(function (x) { return x.id !== annId; }); this.save(p); },

    /* ---- AI review import (turns workflow findings into anchored 'review' annotations) ---- */
    listReview: function (id) { var p = this.get(id); return (p && p.annotations || []).filter(function (a) { return a.kind === 'review'; }); },
    clearReview: function (id) { var p = this.get(id); if (!p) return; p.annotations = (p.annotations || []).filter(function (a) { return a.kind !== 'review'; }); this.save(p); },
    importReview: function (id, findings, opts) {
      var p = this.get(id); if (!p) return { imported: 0, unanchored: 0, total: 0 };
      opts = opts || {}; p.annotations = p.annotations || [];
      if (!opts.append) p.annotations = p.annotations.filter(function (a) { return a.kind !== 'review'; });
      var r = importReviewInto(p, findings, uid);
      this.save(p);
      this.logActivity(id, opts.actorId || 'ai-review', 'imported AI review', r.imported + ' notes');
      return r;
    },

    /* ---- usage / metering ---- */
    month: function () { var d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1); },
    addTts: function (userId, chars, opts) {
      opts = opts || {};
      var u = read(USAGE, {}) || {}; var m = this.month();
      var rec = u[userId]; if (!rec || rec.month !== m) rec = { month: m, chars: 0, requests: 0 };
      rec.chars += chars; rec.requests += 1; u[userId] = rec;
      try { localStorage.setItem(USAGE, JSON.stringify(u)); } catch (e) { }
      // per-thesis real-charge counter (only cache misses reach here)
      if (opts.projectId) {
        var t = read(TTS, {}) || {}; var pk = userId + ':' + opts.projectId;
        var pr = t[pk] || { chars: 0, credits: 0, requests: 0 };
        pr.chars += chars; pr.credits += (opts.credits != null ? opts.credits : chars); pr.requests += 1; pr.lastAt = Date.now();
        t[pk] = pr; try { localStorage.setItem(TTS, JSON.stringify(t)); } catch (e) { }
      }
      notify();
    },
    ttsForProject: function (userId, projectId) {
      var t = read(TTS, {}) || {}; return t[userId + ':' + projectId] || { chars: 0, credits: 0, requests: 0 };
    },
    usage: function (userId) {
      var u = read(USAGE, {}) || {}; var rec = u[userId] && u[userId].month === this.month() ? u[userId] : { chars: 0, requests: 0 };
      var bytes = 0; this.raw().forEach(function (p) { if (p.ownerId === userId && !p.deletedAt) bytes += bytesOf(p); });
      var user = window.PRAuth.byId(userId) || { plan: 'free' };
      var plan = PLAN[user.plan] || PLAN.free;
      return { storageBytes: bytes, storageLimit: plan.storage, chars: rec.chars, charLimit: plan.chars, requests: rec.requests, planLabel: plan.label };
    },

    /* ---- reading sessions ---- */
    getReading: function (userId, projectId) { var r = read(READING, {}) || {}; return r[userId + ':' + projectId] || null; },
    setReading: function (userId, projectId, idx) { var r = read(READING, {}) || {}; r[userId + ':' + projectId] = { idx: idx, at: Date.now() }; try { localStorage.setItem(READING, JSON.stringify(r)); } catch (e) { } },

    /* ---- prefs (per-user-in-this-browser, so the 4 seeded demo users don't share one voice/spell/pron blob;
       first read for a user inherits the legacy shared blob so no existing settings are lost on upgrade) ---- */
    prefs: function () {
      var k = PREFS + ':' + prefUid();
      var v = read(k, null);
      if (v == null) { var legacy = read(PREFS, null); v = legacy || {}; if (legacy) { try { localStorage.setItem(k, JSON.stringify(legacy)); } catch (e) { } } }
      return v || {};
    },
    setPrefs: function (p) { try { localStorage.setItem(PREFS + ':' + prefUid(), JSON.stringify(Object.assign(this.prefs(), p))); } catch (e) { } },

    countSentences: countSentences, titleGuess: titleGuess, bytesOf: bytesOf,
    seedIfEmpty: function () {
      if (readAll().length === 0) {
        var s = sampleFiles();
        this.save(normalize({ id: 'sample', title: 'Sample — Attention-Guided Proofreading', created: Date.now(), updated: Date.now(), idx: 0, ownerId: 'u_anna', files: s.files, order: s.order, folders: s.folders || [], active: s.active,
          members: [{ userId: 'u_bela', role: 'editor', invitedAt: Date.now() }, { userId: 'u_cili', role: 'commenter', invitedAt: Date.now() }],
          activity: [{ id: uid(), actorId: 'u_anna', verb: 'created', target: 'Sample paper', at: Date.now() - 86400000 }] }));
      }
    }
  };

  window.PRStore = Store;
})();
