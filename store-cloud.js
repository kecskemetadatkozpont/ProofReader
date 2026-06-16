/* Aloud — cloud-backed store. Loads AFTER store.js and backend.js.
 * Only takes over window.PRStore in 'cloud' mode; otherwise the local store
 * from store.js stays in place (demo mode), so the app never breaks.
 *
 * Model: each project is one nested object stored in projects.data (jsonb).
 * Reads are synchronous from an in-memory CACHE (warm-seeded from localStorage,
 * refreshed from Supabase). Writes update CACHE + warm copy + notify, then push
 * to Supabase in the background. Realtime + window-focus keep collaborators in
 * sync. This preserves the exact PRStore surface the app already calls. */
(function () {
  'use strict';
  var BE = window.PR_BACKEND;
  if (!BE || BE.mode !== 'cloud') return;           // demo/sign-in → keep local store
  var sb = BE.sb, me = BE.user;

  var PLAN = { free: { storage: 50 * 1024 * 1024, chars: 10000, label: 'Free' }, pro: { storage: 1024 * 1024 * 1024, chars: 200000, label: 'Pro' } };
  var TRASH_TTL = 7 * 24 * 60 * 60 * 1000; // trashed projects restorable for 7 days, then auto-purged
  var WARM = 'proofreader:cloud:' + me.id + ':projects';
  var PREFS = 'proofreader:cloud:' + me.id + ':prefs';
  var USAGE = 'proofreader:cloud:' + me.id + ':usage';
  var TTS = 'proofreader:cloud:' + me.id + ':tts';
  var READING = 'proofreader:cloud:' + me.id + ':reading';

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function uuid() { try { return crypto.randomUUID(); } catch (e) { return 'xxxxxxxx-xxxx-4xxx-axxx-xxxxxxxxxxxx'.replace(/[x]/g, function () { return (Math.random() * 16 | 0).toString(16); }); } }
  function detUuid(seed) { var h = 0x811c9dc5, b = []; for (var i = 0; i < 16; i++) { for (var j = 0; j < seed.length; j++) { h ^= seed.charCodeAt(j) + i * 131; h = Math.imul(h, 16777619); } b.push((h >>> 0) & 0xff); } var x = b.map(function (n) { return ('0' + n.toString(16)).slice(-2); }).join(''); return x.slice(0, 8) + '-' + x.slice(8, 12) + '-4' + x.slice(13, 16) + '-a' + x.slice(17, 20) + '-' + x.slice(20, 32); }
  function sid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function nowISO() { return new Date().toISOString(); }

  /* ---- cache ---- */
  var CACHE = [];
  (function warm() { try { CACHE = JSON.parse(localStorage.getItem(WARM) || '[]') || []; } catch (e) { CACHE = []; } })();
  function persistWarm() { try { localStorage.setItem(WARM, JSON.stringify(CACHE)); } catch (e) { } }

  function normalize(p) {
    if (!p) return p;
    if (!p.ownerId) p.ownerId = me.id;
    if (!p.members) p.members = [];
    if (!p.link) p.link = { enabled: false, role: 'viewer' };
    if (!p.activity) p.activity = [];
    if (!p.versions) p.versions = [];
    if (!p.annotations) p.annotations = [];
    if (!p.folders) p.folders = [];
    // --- structural integrity: the editor needs a valid active tex file ---
    if (!p.files || typeof p.files !== 'object') p.files = {};
    if (!Array.isArray(p.order)) p.order = Object.keys(p.files);
    var texKeys = Object.keys(p.files).filter(function (k) { return p.files[k] && p.files[k].type === 'tex'; });
    if (!texKeys.length) { var b = blankFiles(p.title); p.files = b.files; p.order = b.order; p.active = b.active; p.folders = b.folders || []; }
    else if (!p.active || !p.files[p.active] || p.files[p.active].type !== 'tex') { p.active = texKeys[0]; }
    Object.keys(p.files).forEach(function (k) { if (p.order.indexOf(k) < 0) p.order.push(k); });
    return p;
  }
  function idx(id) { for (var i = 0; i < CACHE.length; i++) if (CACHE[i].id === id) return i; return -1; }

  function blankFiles(title) {
    var tex = '\\documentclass[11pt]{article}\n\\usepackage{amsmath}\n\\usepackage{graphicx}\n\n' +
      '\\title{' + (title || 'Untitled') + '}\n\\author{Your Name}\n\\date{\\today}\n\n' +
      '\\begin{document}\n\\maketitle\n\n\\section{Introduction}\n' +
      'Start writing here. Press play in the toolbar to hear this sentence read aloud. ' +
      'Click any sentence in the editor to set where reading begins.\n\n' +
      '\\section{Background}\nAdd your content, equations, figures and tables.\n\n\\end{document}\n';
    return { active: 'main.tex', order: ['main.tex'], folders: [], files: { 'main.tex': { type: 'tex', content: tex } } };
  }
  function sampleFiles() { var s = window.PR_SAMPLE; return s ? { active: s.active, order: s.order.slice(), files: clone(s.files), folders: (s.folders || []).slice() } : blankFiles('Sample'); }

  /* ---- realtime notify ---- */
  var subs = [];
  function notify() { subs.forEach(function (cb) { try { cb(); } catch (e) { } }); }
  function subscribe(cb) { subs.push(cb); return function () { subs = subs.filter(function (x) { return x !== cb; }); }; }

  /* ---- server push (debounced per project) ---- */
  var pending = {}, timers = {};
  function pushProject(p) {
    pending[p.id] = p;
    clearTimeout(timers[p.id]);
    timers[p.id] = setTimeout(function () { flush(p.id); }, 500);
  }
  function flush(id) {
    var p = pending[id]; if (!p) return; delete pending[id];
    // deleted_at is a timestamptz column — serialise the epoch-ms flag as ISO, NOT a raw
    // number (a bare integer fails the timestamptz cast and rejects the whole upsert, which
    // is why soft-deletes used to vanish on reload).
    var delAt = p.deletedAt ? new Date(p.deletedAt).toISOString() : null;
    var row = { id: p.id, owner_id: p.ownerId || me.id, title: p.title || 'Untitled project', data: p, deleted_at: delAt, updated_at: nowISO() };
    sb.from('projects').upsert(row).then(function (r) {
      if (r.error) { console.warn('[PR] save failed, will retry', r.error.message); pending[id] = p; clearTimeout(timers[id]); timers[id] = setTimeout(function () { flush(id); }, 4000); return; }
      syncMembers(p);
    }).catch(function (e) { console.warn('[PR] save error', e); });
  }
  function syncMembers(p) {
    try {
      var rows = (p.members || []).filter(function (m) { return m.userId && m.userId !== p.ownerId; }).map(function (m) { return { project_id: p.id, user_id: m.userId, role: m.role }; });
      if (rows.length) sb.from('project_members').upsert(rows).then(function () { }).catch(function () { });
    } catch (e) { }
  }
  function hardDelete(id) { sb.from('projects').update({ deleted_at: nowISO() }).eq('id', id).then(function () { }).catch(function () { }); }

  /* ---- hydrate from server ---- */
  function mergeRow(p) { if (!p || !p.id) return; var i = idx(p.id); if (i >= 0) CACHE[i] = normalize(p); else CACHE.push(normalize(p)); }
  function hydrate() {
    // Scope the editor's project list to what THIS user owns or is a member of
    // (explicit, not RLS-implicit) so an admin's own editor isn't flooded with
    // every project the admin can read via admin RLS.
    // include trashed (deleted_at not null) for the OWNER so the Trash view can list/restore them;
    // shared projects below stay deleted_at-null so collaborators never see an owner's trash.
    var ownedQ = sb.from('projects').select('id,data,updated_at,deleted_at').eq('owner_id', me.id);
    var memQ = sb.from('project_members').select('project_id').eq('user_id', me.id);
    return Promise.all([ownedQ, memQ]).then(function (res) {
      var owned = res[0], mem = res[1];
      if (owned.error) { console.warn('[PR] hydrate failed', owned.error.message); return; }
      var rows = (owned.data || []).slice();
      var memIds = (mem && mem.data ? mem.data.map(function (m) { return m.project_id; }) : []);
      function finish(sharedRows) {
        var all = rows.concat(sharedRows || []);
        var seen = {};
        all.forEach(function (row) {
          var p = (row.data && typeof row.data === 'object' && row.data.files) ? row.data
            : { id: row.id, title: (row.data && row.data.title) || 'Untitled project', ownerId: me.id };
          p.id = row.id;
          // reconcile the deleted_at column with the embedded flag (column is source of truth)
          if (row.deleted_at) { if (!p.deletedAt) p.deletedAt = Date.parse(row.deleted_at) || Date.now(); }
          else if (p.deletedAt) { delete p.deletedAt; }
          seen[row.id] = 1; mergeRow(p);
        });
        CACHE = CACHE.filter(function (p) { return seen[p.id] || pending[p.id]; });
        persistWarm(); notify(); loadProfilesFor(CACHE);
      }
      if (memIds.length) {
        sb.from('projects').select('id,data,updated_at,deleted_at').in('id', memIds).is('deleted_at', null)
          .then(function (sr) { finish(sr.data || []); }, function () { finish([]); });
      } else { finish([]); }
    }).catch(function (e) { console.warn('[PR] hydrate error', e); });
  }
  function loadProfilesFor(projects) {
    var ids = {}; projects.forEach(function (p) { (p.members || []).forEach(function (m) { if (m.userId) ids[m.userId] = 1; }); if (p.ownerId) ids[p.ownerId] = 1; });
    var need = Object.keys(ids).filter(function (id) { return !BE.profiles[id]; });
    if (!need.length) return;
    sb.from('profiles').select('id,name,email,avatar_url,color,plan').in('id', need).then(function (r) {
      if (r && r.data) { r.data.forEach(function (u) { BE.profiles[u.id] = { id: u.id, name: u.name, email: u.email, avatar: u.avatar_url, color: u.color || BE.colorFor(u.id), plan: u.plan || 'free' }; }); BE.cacheProfiles(); notify(); }
    }).catch(function () { });
  }

  // initial hydrate + realtime + focus refresh
  hydrate();
  try {
    sb.channel('projects-feed').on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, function () { hydrate(); }).subscribe();
  } catch (e) { }
  window.addEventListener('focus', function () { hydrate(); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) hydrate(); });

  /* ---- helpers reused by the app ---- */
  function countSentences(project) { try { var f = project.files[project.active]; if (!f || f.type !== 'tex' || !window.LatexEngine) return null; return window.LatexEngine.process(f.content, project.files).sentences.length; } catch (e) { return null; } }
  function titleGuess(project) { var f = project.files[project.active]; if (f && f.type === 'tex') { var m = /\\title\{([\s\S]*?)\}/.exec(f.content); if (m) { var t = m[1].replace(/\\\\/g, ' ').replace(/\\[a-zA-Z]+\{?|[{}~]/g, '').replace(/\s+/g, ' ').trim(); if (t) return t; } } return project.title; }
  function bytesOf(project) {
    try {
      var meta = new Blob([JSON.stringify({ f: project.files, v: project.versions })]).size;
      var media = 0; var f = project.files || {};
      Object.keys(f).forEach(function (k) { if (f[k] && typeof f[k].size === 'number') media += f[k].size; }); // images live in Supabase Storage; count their byte size
      return meta + media;
    } catch (e) { return JSON.stringify(project.files || {}).length; }
  }

  function readJSON(k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } }
  function writeJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }

  /* ---- AI-review import helpers (mirror store.js) ---- */
  function baseName(x) { return (x || '').split('/').pop(); }
  function locateQuote(content, quote) {
    if (!content || !quote) return -1;
    var i = content.indexOf(quote); if (i >= 0) return i;
    var nq = quote.replace(/\s+/g, ' ').trim();
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
  function importReviewInto(p, findings) {
    var files = p.files || {}, imported = 0, unanchored = 0, now = Date.now();
    (findings || []).forEach(function (f, idx) {
      if (!f || !f.comment) return;
      var path = reviewTargetFile(p, f.file), content = (files[path] && files[path].content) || '', q = f.quote || '';
      var at = locateQuote(content, q);
      var ann = {
        id: sid(), kind: 'review', category: f.category || 'style', severity: f.severity || 'minor',
        comment: f.comment, body: f.comment, suggestion: f.suggestion || '', confidence: f.confidence || 'medium',
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
    _notify: notify,
    _hydrate: hydrate,

    raw: function () { return CACHE.map(normalize); },
    list: function () { return this.raw().filter(function (p) { return !p.deletedAt; }).slice().sort(function (a, b) { return (b.updated || 0) - (a.updated || 0); }); },
    listFor: function (userId) { this.purgeExpired(); return this.list().filter(function (p) { return p.ownerId === userId || p.members.some(function (m) { return m.userId === userId; }); }).map(function (p) { p._shared = p.ownerId !== userId; return p; }); },
    listTrashedFor: function (userId) { this.purgeExpired(); return this.raw().filter(function (p) { return p.deletedAt && p.ownerId === userId; }).sort(function (a, b) { return (b.deletedAt || 0) - (a.deletedAt || 0); }); },
    trashTtl: TRASH_TTL,
    get: function (id) { var i = idx(id); return i >= 0 ? normalize(CACHE[i]) : null; },

    roleOf: function (project, userId) { if (!project) return null; if (project.ownerId === userId) return 'owner'; var m = (project.members || []).filter(function (m) { return m.userId === userId; })[0]; if (m) return m.role; if (project.link && project.link.enabled) return project.link.role; return null; },
    canEdit: function (project, userId) { var r = this.roleOf(project, userId); return r === 'owner' || r === 'editor'; },
    canComment: function (project, userId) { var r = this.roleOf(project, userId); return r === 'owner' || r === 'editor' || r === 'commenter'; },

    save: function (project) {
      normalize(project); project.updated = Date.now();
      var i = idx(project.id); if (i >= 0) CACHE[i] = project; else CACHE.push(project);
      persistWarm(); pushProject(project); notify(); return project;
    },
    create: function (title, template, opts) {
      opts = opts || {};
      var reg = window.PR_TEMPLATES && window.PR_TEMPLATES.byId ? window.PR_TEMPLATES.byId(template) : null;
      var base = reg && window.PR_TEMPLATES.filesFor(template, { title: title });
      if (!base) base = template === 'sample' ? sampleFiles() : blankFiles(title);
      var journal = (opts.journal || (reg && reg.journalMeta ? reg.name : '') || '').trim();
      var p = normalize({ id: uuid(), title: title || 'Untitled project', created: Date.now(), updated: Date.now(), idx: 0, ownerId: me.id, files: base.files, order: base.order, folders: base.folders || [], active: base.active, journal: journal });
      if (reg) { p.templateId = reg.id; if (reg.journalMeta) p.journalMeta = clone(reg.journalMeta); if (reg.limits) p.limits = clone(reg.limits); }
      if (opts.members && opts.members.length) {
        p.members = opts.members.filter(function (m) { return m && m.userId && m.userId !== me.id; })
          .map(function (m) { return { userId: m.userId, role: m.role || 'editor', invitedAt: Date.now() }; });
      }
      this.save(p); this.logActivity(p.id, me.id, 'created', p.title);
      (p.members || []).forEach(function (m) { Store.logActivity(p.id, me.id, 'shared with', (window.PRAuth && window.PRAuth.byId(m.userId) || {}).name || m.userId); });
      return p;
    },
    duplicate: function (id) { var s = this.get(id); if (!s) return null; var p = clone(s); p.id = uuid(); p.title = s.title + ' (copy)'; p.created = p.updated = Date.now(); p.ownerId = me.id; p.members = []; p.activity = []; delete p.deletedAt; return this.save(p); },
    rename: function (id, title) { var p = this.get(id); if (!p) return; p.title = title; this.save(p); },
    setJournal: function (id, journal) { var p = this.get(id); if (!p) return; p.journal = (journal || '').trim(); this.save(p); },
    /* ---- trash (soft-delete, 7-day retention, restorable) ---- */
    // The save() debounce (500ms) + the deleted_at column both matter here, so we also
    // push the deleted_at flag DIRECTLY and immediately — a fast reload after delete/restore
    // must not lose the state if the debounced upsert hasn't fired yet.
    remove: function (id) { var p = this.get(id); if (!p) return; p.deletedAt = Date.now(); this.save(p); this.logActivity(id, me.id, 'moved to trash', p.title); try { sb.from('projects').update({ deleted_at: new Date(p.deletedAt).toISOString() }).eq('id', id).then(function () {}, function () {}); } catch (e) {} },
    restore: function (id) { var p = this.get(id); if (!p) return; delete p.deletedAt; this.save(p); this.logActivity(id, me.id, 'restored', p.title); try { sb.from('projects').update({ deleted_at: null }).eq('id', id).then(function () {}, function () {}); } catch (e) {} },
    purge: function (id) { var i = idx(id); if (i >= 0) CACHE.splice(i, 1); persistWarm(); delete pending[id]; try { sb.from('projects').delete().eq('id', id).then(function (r) { if (r && r.error) hardDelete(id); }, function () { hardDelete(id); }); } catch (e) { hardDelete(id); } notify(); },
    purgeExpired: function () {
      var now = Date.now(), self = this;
      CACHE.filter(function (p) { return p.deletedAt && (now - p.deletedAt) > TRASH_TTL; }).forEach(function (p) { self.purge(p.id); });
    },

    /* sharing */
    addMember: function (id, userId, role) { var p = this.get(id); if (!p) return; if (userId === p.ownerId) return; var m = p.members.filter(function (x) { return x.userId === userId; })[0]; if (m) m.role = role; else p.members.push({ userId: userId, role: role, invitedAt: Date.now() }); this.save(p); this.logActivity(id, me.id, 'shared with', (window.PRAuth.byId(userId) || {}).name || userId); },
    setRole: function (id, userId, role) { this.addMember(id, userId, role); },
    removeMember: function (id, userId) { var p = this.get(id); if (!p) return; p.members = p.members.filter(function (m) { return m.userId !== userId; }); this.save(p); try { sb.from('project_members').delete().eq('project_id', id).eq('user_id', userId).then(function () { }); } catch (e) { } },
    setLink: function (id, enabled, role) { var p = this.get(id); if (!p) return; p.link = { enabled: enabled, role: role || p.link.role || 'viewer' }; this.save(p); },

    /* activity */
    logActivity: function (id, actorId, verb, target) { var p = this.get(id); if (!p) return; p.activity = p.activity || []; p.activity.unshift({ id: sid(), actorId: actorId, verb: verb, target: target || '', at: Date.now() }); p.activity = p.activity.slice(0, 80); this.save(p); },

    /* versions */
    addVersion: function (id, label, authorId, named) {
      var p = this.get(id); if (!p) return null;
      var snap = {}; Object.keys(p.files).forEach(function (k) { var f = p.files[k]; if (f && f.content != null && f.dataURL == null) snap[k] = { type: f.type, content: f.content }; });
      var last = p.versions[0]; if (last && !named && JSON.stringify(last.files) === JSON.stringify(snap)) return null;
      var v = { id: sid(), label: label, authorId: authorId, createdAt: Date.now(), files: snap, named: !!named };
      p.versions.unshift(v); var autos = 0; p.versions = p.versions.filter(function (x) { if (x.named) return true; autos++; return autos <= 15; });
      this.save(p); if (named) this.logActivity(id, authorId, 'saved version', label); return v;
    },
    listVersions: function (id) { var p = this.get(id); return p ? p.versions : []; },
    restoreVersion: function (id, versionId) {
      var p = this.get(id); if (!p) return; var v = p.versions.filter(function (x) { return x.id === versionId; })[0]; if (!v) return;
      this.addVersion(id, 'Before restore', me.id, true); p = this.get(id);
      var restored = {}; Object.keys(p.files).forEach(function (k) { if (p.files[k] && (p.files[k].dataURL != null || p.files[k].storagePath != null)) restored[k] = p.files[k]; });
      Object.keys(v.files).forEach(function (k) { restored[k] = clone(v.files[k]); });
      p.files = restored; p.order = (p.order || []).filter(function (k) { return restored[k]; });
      Object.keys(restored).forEach(function (k) { if (p.order.indexOf(k) < 0) p.order.push(k); });
      if (!p.files[p.active]) p.active = p.order[0] || '';
      this.save(p); this.logActivity(id, me.id, 'restored', v.label); return p;
    },

    /* annotations */
    listAnnotations: function (id) { var p = this.get(id); return p ? p.annotations : []; },
    addAnnotation: function (id, ann) { var p = this.get(id); if (!p) return null; ann.id = sid(); ann.createdAt = Date.now(); ann.replies = ann.replies || []; ann.status = ann.status || 'open'; p.annotations.push(ann); this.save(p); this.logActivity(id, ann.authorId, ann.kind === 'todo' ? 'added a to-do' : 'commented', ann.anchor && ann.anchor.quote ? '“' + ann.anchor.quote.slice(0, 40) + '”' : ''); return ann; },
    updateAnnotation: function (id, annId, patch) { var p = this.get(id); if (!p) return; var a = p.annotations.filter(function (x) { return x.id === annId; })[0]; if (!a) return; Object.assign(a, patch); this.save(p); },
    replyAnnotation: function (id, annId, authorId, body, extra) { var p = this.get(id); if (!p) return; var a = p.annotations.filter(function (x) { return x.id === annId; })[0]; if (!a) return; extra = extra || {}; a.replies.push({ id: sid(), authorId: authorId, body: body, at: Date.now(), mentions: extra.mentions || [], attachments: extra.attachments || [] }); this.save(p); },
    deleteAnnotation: function (id, annId) { var p = this.get(id); if (!p) return; p.annotations = p.annotations.filter(function (x) { return x.id !== annId; }); this.save(p); },
    listReview: function (id) { var p = this.get(id); return (p && p.annotations || []).filter(function (a) { return a.kind === 'review'; }); },
    clearReview: function (id) { var p = this.get(id); if (!p) return; p.annotations = (p.annotations || []).filter(function (a) { return a.kind !== 'review'; }); this.save(p); },
    importReview: function (id, findings, opts) {
      var p = this.get(id); if (!p) return { imported: 0, unanchored: 0, total: 0 };
      opts = opts || {}; p.annotations = p.annotations || [];
      if (!opts.append) p.annotations = p.annotations.filter(function (a) { return a.kind !== 'review'; });
      var r = importReviewInto(p, findings); this.save(p);
      this.logActivity(id, opts.actorId || me.id, 'imported AI review', r.imported + ' notes');
      return r;
    },

    /* usage / metering (local per user for now; server metering arrives with voice) */
    month: function () { var d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1); },
    addTts: function (userId, chars, opts) {
      opts = opts || {};
      var u = readJSON(USAGE, {}); var m = this.month(); var rec = u[userId]; if (!rec || rec.month !== m) rec = { month: m, chars: 0, requests: 0 }; rec.chars += chars; rec.requests += 1; u[userId] = rec; writeJSON(USAGE, u);
      if (opts.projectId) {
        var t = readJSON(TTS, {}); var pk = userId + ':' + opts.projectId;
        var pr = t[pk] || { chars: 0, credits: 0, requests: 0 };
        pr.chars += chars; pr.credits += (opts.credits != null ? opts.credits : chars); pr.requests += 1; pr.lastAt = Date.now();
        t[pk] = pr; writeJSON(TTS, t);
      }
      notify();
    },
    ttsForProject: function (userId, projectId) { var t = readJSON(TTS, {}); return t[userId + ':' + projectId] || { chars: 0, credits: 0, requests: 0 }; },
    usage: function (userId) { var u = readJSON(USAGE, {}); var rec = u[userId] && u[userId].month === this.month() ? u[userId] : { chars: 0, requests: 0 }; var bytes = 0; this.raw().forEach(function (p) { if (p.ownerId === userId && !p.deletedAt) bytes += bytesOf(p); }); var user = (window.PRAuth.byId(userId)) || { plan: 'free' }; var plan = PLAN[user.plan] || PLAN.free; return { storageBytes: bytes, storageLimit: plan.storage, chars: rec.chars, charLimit: plan.chars, requests: rec.requests, planLabel: plan.label }; },

    /* reading sessions */
    getReading: function (userId, projectId) { var r = readJSON(READING, {}); return r[userId + ':' + projectId] || null; },
    setReading: function (userId, projectId, i) { var r = readJSON(READING, {}); r[userId + ':' + projectId] = { idx: i, at: Date.now() }; writeJSON(READING, r); },

    /* prefs */
    prefs: function () { return readJSON(PREFS, {}); },
    setPrefs: function (p) { writeJSON(PREFS, Object.assign(this.prefs(), p)); },

    countSentences: countSentences, titleGuess: titleGuess, bytesOf: bytesOf,
    seedIfEmpty: function () {
      if (CACHE.length) return;
      var s = sampleFiles();
      var p = normalize({ id: detUuid('starter:' + me.id), title: 'Welcome — your first Aloud project', created: Date.now(), updated: Date.now(), idx: 0, ownerId: me.id, files: s.files, order: s.order, folders: s.folders || [], active: s.active });
      this.save(p);
    }
  };

  window.PRStore = Store;
  console.info('[PR] cloud store active for', me.email || me.id);
})();
