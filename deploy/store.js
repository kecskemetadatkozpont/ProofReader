/* Shared project store for ProofReader (localStorage-backed, Phase 1 prototype).
 * Requires sample.js and auth.js. Adds collaboration: members/roles, share links,
 * activity log, versions, annotations (comments + to-dos), usage metering,
 * reading sessions, and cross-tab realtime notifications. */
(function () {
  'use strict';
  var KEY = 'proofreader:projects';
  var PREFS = 'proofreader:prefs';
  var USAGE = 'proofreader:usage';
  var READING = 'proofreader:reading';
  var TICK = 'proofreader:tick';

  var PLAN = {
    free: { storage: 50 * 1024 * 1024, chars: 10000, label: 'Free' },
    pro: { storage: 1024 * 1024 * 1024, chars: 200000, label: 'Pro' }
  };

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function read(k, d) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return d; } }
  function readAll() { return read(KEY, []) || []; }
  function trySet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function storageFull() { try { window.dispatchEvent(new CustomEvent('pr-storage-full')); } catch (e) { } console.warn('[ProofReader] localStorage is full — save could not complete.'); }
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
  function bytesOf(project) { try { return new Blob([JSON.stringify({ f: project.files, v: project.versions })]).size; } catch (e) { return JSON.stringify(project.files || {}).length; } }

  var Store = {
    PLAN: PLAN,
    subscribe: subscribe,

    raw: function () { return readAll().map(normalize); },
    list: function () { return this.raw().sort(function (a, b) { return (b.updated || 0) - (a.updated || 0); }); },
    listFor: function (userId) {
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
    create: function (title, template) {
      var base = template === 'sample' ? sampleFiles() : blankFiles(title);
      var owner = curId();
      var p = normalize({ id: uid(), title: title || 'Untitled project', created: Date.now(), updated: Date.now(), idx: 0, ownerId: owner, files: base.files, order: base.order, folders: base.folders || [], active: base.active });
      this.save(p);
      this.logActivity(p.id, owner, 'created', p.title);
      return p;
    },
    duplicate: function (id) { var s = this.get(id); if (!s) return null; var p = clone(s); p.id = uid(); p.title = s.title + ' (copy)'; p.created = p.updated = Date.now(); p.ownerId = curId(); p.members = []; p.activity = []; return this.save(p); },
    rename: function (id, title) { var p = this.get(id); if (!p) return; p.title = title; this.save(p); },
    remove: function (id) { writeAll(readAll().filter(function (p) { return p.id !== id; })); },

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
      var snap = {}; Object.keys(p.files).forEach(function (k) { var f = p.files[k]; if (f && f.content != null && f.dataURL == null) snap[k] = { type: f.type, content: f.content }; });
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
      Object.keys(v.files).forEach(function (k) { restored[k] = clone(v.files[k]); });
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

    /* ---- usage / metering ---- */
    month: function () { var d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1); },
    addTts: function (userId, chars) {
      var u = read(USAGE, {}) || {}; var m = this.month();
      var rec = u[userId]; if (!rec || rec.month !== m) rec = { month: m, chars: 0, requests: 0 };
      rec.chars += chars; rec.requests += 1; u[userId] = rec;
      try { localStorage.setItem(USAGE, JSON.stringify(u)); } catch (e) { } notify();
    },
    usage: function (userId) {
      var u = read(USAGE, {}) || {}; var rec = u[userId] && u[userId].month === this.month() ? u[userId] : { chars: 0, requests: 0 };
      var bytes = 0; this.raw().forEach(function (p) { if (p.ownerId === userId) bytes += bytesOf(p); });
      var user = window.PRAuth.byId(userId) || { plan: 'free' };
      var plan = PLAN[user.plan] || PLAN.free;
      return { storageBytes: bytes, storageLimit: plan.storage, chars: rec.chars, charLimit: plan.chars, requests: rec.requests, planLabel: plan.label };
    },

    /* ---- reading sessions ---- */
    getReading: function (userId, projectId) { var r = read(READING, {}) || {}; return r[userId + ':' + projectId] || null; },
    setReading: function (userId, projectId, idx) { var r = read(READING, {}) || {}; r[userId + ':' + projectId] = { idx: idx, at: Date.now() }; try { localStorage.setItem(READING, JSON.stringify(r)); } catch (e) { } },

    /* ---- prefs ---- */
    prefs: function () { return read(PREFS, {}) || {}; },
    setPrefs: function (p) { try { localStorage.setItem(PREFS, JSON.stringify(Object.assign(this.prefs(), p))); } catch (e) { } },

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
