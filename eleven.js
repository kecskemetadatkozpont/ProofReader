/* Aloud — ElevenLabs voice integration (bring-your-own-key, browser-side).
 *
 * window.PREleven
 *   getKey()/setKey(k)/hasKey()            — API key, stored in localStorage (this browser only)
 *   voices / models                        — default stock catalog (real ElevenLabs IDs)
 *   getAudio(text, cfg, userId) -> Promise<objectURL>
 *                                          — synth one sentence; cached by (text+voice+model+settings)
 *                                            so re-reads are free; meters real (cache-miss) requests
 *   prefetch(items, cfg, userId)           — warm the next 1–2 sentences for gapless playback
 *   cached(text, cfg) -> bool              — is this sentence already in the audio cache
 *   listAccountVoices() -> Promise<[{id,name}]> — pull the user's real voice library
 *   test(cfg) -> Promise<objectURL>        — short sample for the "Test voice" button
 *
 * The key lives in the browser. Fine for a personal prototype; production should
 * proxy through a backend so the key never reaches the client (see Feature Plan §8).
 */
(function () {
  var KEY = 'pr.eleven.key';
  var ENDPOINT = 'https://api.elevenlabs.io/v1';

  var cache = {};      // hashKey -> { url, blob }
  var inflight = {};   // hashKey -> Promise

  // A few ElevenLabs stock voices (real premade voice IDs).
  var VOICES = [
    { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel — calm narration' },
    { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam — deep, neutral' },
    { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah — soft, warm' },
    { id: 'ErXwobaYiN019PkySvjV', name: 'Antoni — crisp, clear' },
    { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel — news presenter' },
    { id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily — warm British' }
  ];

  // Models — selectable dynamically in the voice panel. Eleven v3 first (default, most expressive).
  var MODELS = [
    { id: 'eleven_v3', name: 'Eleven v3 — most expressive (default)' },
    { id: 'eleven_multilingual_v2', name: 'Multilingual v2 — robust quality' },
    { id: 'eleven_turbo_v2_5', name: 'Turbo v2.5 — low latency' },
    { id: 'eleven_flash_v2_5', name: 'Flash v2.5 — fastest & cheapest' },
    { id: 'eleven_monolingual_v1', name: 'English v1 — legacy' }
  ];
  var DEFAULT_MODEL = 'eleven_v3';

  // Approximate credits charged per character, by model (ElevenLabs bills per character;
  // Flash/Turbo are half-price). Used only to ESTIMATE credits for the per-thesis counter —
  // the exact charge is the character count, surfaced alongside.
  var CREDIT_MULT = {
    eleven_v3: 1,
    eleven_multilingual_v2: 1,
    eleven_monolingual_v1: 1,
    eleven_turbo_v2_5: 0.5,
    eleven_flash_v2_5: 0.5
  };

  function hash(s) {
    var h = 0, i, c;
    for (i = 0; i < s.length; i++) { c = s.charCodeAt(i); h = ((h << 5) - h) + c; h |= 0; }
    return (h >>> 0).toString(36);
  }
  /* ---- pronunciation dictionary: spoken-form substitutions applied just before synthesis ---- */
  // A user list of { from, to } (e.g. "LiDAR"->"lie-dar", "OOD"->"oh oh dee"). Applied centrally so the
  // cache key, cloud key, the synthesized text and the "is voiced" highlight all stay consistent. An empty
  // list means spoken(text) === text (byte-identical to the previous behaviour - a true no-op when unused).
  var pron = [];
  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function spoken(text) {
    if (!pron.length || !text) return text;
    var t = text;
    for (var i = 0; i < pron.length; i++) {
      var e = pron[i]; if (!e || !e.from) continue;
      try { t = t.replace(new RegExp('(^|[^\\p{L}\\p{N}])(' + escRe(e.from) + ')(?![\\p{L}\\p{N}])', 'giu'), function (m, pre) { return pre + (e.to || ''); }); } catch (_) { }
    }
    return t;
  }
  function cfgKey(text, cfg) {
    return hash([spoken(text), cfg.elevenVoice, cfg.model, cfg.stability, cfg.similarity].join('\u0001'));
  }
  function settings(cfg) {
    return {
      stability: (cfg.stability != null ? cfg.stability : 50) / 100,
      similarity_boost: (cfg.similarity != null ? cfg.similarity : 75) / 100,
      use_speaker_boost: true
    };
  }

  /* ---- persistent audio cache: IndexedDB (this browser) ---- */
  var IDB_NAME = 'pr_tts', IDB_STORE = 'audio', _dbp = null;
  function openDB() {
    if (_dbp) return _dbp;
    _dbp = new Promise(function (res) {
      try {
        if (!window.indexedDB) return res(null);
        var req = indexedDB.open(IDB_NAME, 1);
        req.onupgradeneeded = function () { try { req.result.createObjectStore(IDB_STORE); } catch (e) { } };
        req.onsuccess = function () { res(req.result); };
        req.onerror = function () { res(null); };
      } catch (e) { res(null); }
    });
    return _dbp;
  }
  function idbGet(k) {
    return openDB().then(function (db) {
      if (!db) return null;
      return new Promise(function (res) {
        try { var r = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(k);
          r.onsuccess = function () { res(r.result || null); }; r.onerror = function () { res(null); };
        } catch (e) { res(null); }
      });
    }).catch(function () { return null; });
  }
  // resolves true only once the transaction durably commits (so a quota/abort failure is observable)
  function idbPut(k, blob) {
    return openDB().then(function (db) {
      if (!db) return false;
      return new Promise(function (res) {
        try {
          var tx = db.transaction(IDB_STORE, 'readwrite');
          tx.objectStore(IDB_STORE).put(blob, k);
          tx.oncomplete = function () { res(true); };
          tx.onerror = tx.onabort = function () { res(false); };
        } catch (e) { res(false); }
      });
    }).catch(function () { return false; });
  }
  function idbAllKeys() {
    return openDB().then(function (db) {
      if (!db || !db.transaction) return [];
      return new Promise(function (res) {
        try { var r = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).getAllKeys();
          r.onsuccess = function () { res(r.result || []); }; r.onerror = function () { res([]); };
        } catch (e) { res([]); }
      });
    }).catch(function () { return []; });
  }

  /* ---- shared audio cache: Supabase Storage (so re-listens and SHARED projects don't re-charge) ----
   * Objects are content-addressed by a SHA-256 of (text, voice, model, settings), so the key is not
   * enumerable and a user can only reach audio whose exact source text they already hold (i.e. a
   * project they have access to). Writes are first-writer-wins (upsert:false) so the immutable,
   * content-addressed object can't be poisoned. Best-effort: a missing 'tts-cache' bucket or absent
   * policies trips _cloudOff for the session and playback falls back to direct synthesis. */
  var CLOUD_BUCKET = 'tts-cache', _cloudOff = false;
  function sbClient() { var BE = window.PR_BACKEND; return (BE && BE.mode === 'cloud' && BE.sb) ? BE.sb : null; }
  function cloudKey(text, cfg) {
    var s = [spoken(text), cfg.elevenVoice, cfg.model, cfg.stability, cfg.similarity].join('');
    try {
      if (window.crypto && crypto.subtle && window.TextEncoder) {
        return crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)).then(function (buf) {
          var b = new Uint8Array(buf), h = ''; for (var i = 0; i < b.length; i++) h += ('0' + b[i].toString(16)).slice(-2); return h;
        }).catch(function () { return hash(s); });
      }
    } catch (e) { }
    return Promise.resolve(hash(s));
  }
  function isDup(err) { return !!err && (/duplicate|already exists|resource already/i.test(err.message || '') || String(err.statusCode || err.status || '') === '409'); }
  // a missing OBJECT is a normal cache miss; a missing BUCKET / policy / auth error means cloud is unusable
  function tripOn(err) {
    if (!err || isDup(err)) return false;
    var m = err.message || '', sc = String(err.statusCode || err.status || '');
    if (/object not found/i.test(m)) return false;
    return /bucket|row-level|policy|denied|unauthor|permission/i.test(m) || sc === '400' || sc === '403';
  }
  function cloudGet(text, cfg) {
    if (_cloudOff) return Promise.resolve(null);
    var sb = sbClient(); if (!sb || !sb.storage) return Promise.resolve(null);
    return cloudKey(text, cfg).then(function (name) {
      return sb.storage.from(CLOUD_BUCKET).download(name + '.mp3').then(function (r) {
        if (r && r.data) return r.data;
        if (r && tripOn(r.error)) _cloudOff = true;
        return null;
      });
    }).catch(function () { return null; });
  }
  function cloudPut(text, cfg, blob) {
    if (_cloudOff) return Promise.resolve();
    var sb = sbClient(); if (!sb || !sb.storage) return Promise.resolve();
    return cloudKey(text, cfg).then(function (name) {
      return sb.storage.from(CLOUD_BUCKET).upload(name + '.mp3', blob, { contentType: 'audio/mpeg', upsert: false }).then(function (r) {
        if (r && tripOn(r.error)) _cloudOff = true; // Duplicate (already cached) is benign, handled by tripOn/isDup
      });
    }).catch(function () { });
  }

  function multFor(model) { return CREDIT_MULT[model] != null ? CREDIT_MULT[model] : 1; }
  // record a REAL charge (cache miss only) against the user's monthly meter and the per-thesis counter
  function meter(userId, projectId, text, cfg) {
    if (!userId || !window.PRStore || !window.PRStore.addTts) return;
    var chars = (text || '').length;
    var credits = Math.round(chars * multFor(cfg.model || DEFAULT_MODEL));
    try { window.PRStore.addTts(userId, chars, { projectId: projectId, credits: credits, model: cfg.model || DEFAULT_MODEL }); } catch (e) { }
    // local notify() doesn't reach same-tab subscribers, so signal the live counter directly
    try { window.dispatchEvent(new CustomEvent('pr-tts', { detail: { projectId: projectId } })); } catch (e) { }
  }

  // Turn a non-OK ElevenLabs response into an actionable Error (reads the JSON detail).
  function apiError(r, what) {
    return r.text().then(function (t) {
      var detail = '';
      try { var j = JSON.parse(t); detail = (j.detail && (j.detail.message || j.detail.status)) || (typeof j.detail === 'string' ? j.detail : ''); } catch (e) { }
      if (r.status === 401 || r.status === 403) {
        return new Error('ElevenLabs rejected your API key (' + r.status + ')' + (detail ? ' — ' + detail : '') +
          '. Check the key is correct and not expired, and that it has the “Voices” (read) permission in ElevenLabs → Profile → API keys. Then re-enter it.');
      }
      return new Error((what || 'Request failed') + ' (' + r.status + ')' + (detail ? ' — ' + String(detail).slice(0, 160) : ''));
    }, function () { return new Error((what || 'Request failed') + ' (' + r.status + ')'); });
  }

  var PREleven = {
    voices: VOICES,
    models: MODELS,

    getKey: function () { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } },
    setKey: function (k) {
      // tolerate pasted surrounding quotes / whitespace
      k = (k || '').trim().replace(/^["'`]+|["'`]+$/g, '').trim();
      try { if (k) localStorage.setItem(KEY, k); else localStorage.removeItem(KEY); } catch (e) { }
    },
    hasKey: function () { return !!this.getKey(); },

    cached: function (text, cfg) { return !!cache[cfgKey(text, cfg)]; },
    keyFor: function (text, cfg) { return cfgKey(text, cfg); },
    // pronunciation dictionary — list of { from, to }; applied to every text before keying/synthesis
    setPron: function (list) { pron = (list || []).filter(function (e) { return e && e.from; }); },
    spoken: spoken,
    // Resolve the raw MP3 Blob for a sentence (for narration export).
    // noSynth=true ⇒ NEVER synthesize/charge: return the cached blob (memory or IndexedDB) or null. Used by
    // "Download voiced" so it is provably free even if an IndexedDB entry was evicted since the snapshot.
    getBlob: function (text, cfg, userId, projectId, noSynth) {
      var k = cfgKey(text, cfg);
      if (cache[k] && cache[k].blob) return Promise.resolve(cache[k].blob);
      if (noSynth) return idbGet(k).then(function (b) { if (b && !cache[k]) cache[k] = { url: URL.createObjectURL(b), blob: b }; return b || null; });
      return this.getAudio(text, cfg, userId, projectId).then(function () { return (cache[k] && cache[k].blob) || idbGet(k); }); // re-read IDB if evicted from memory between finalize and here
    },
    // Concatenate per-sentence MP3 clips into one downloadable file. Strips any leading ID3v2 tag from each
    // clip so mid-stream metadata doesn't confuse players (frame-level joins are left as-is — CBR clips play
    // back fine; a tiny boundary artifact is acceptable for a v1 audiobook).
    concatMp3: function (blobs) {
      function stripId3(u8) {
        if (u8.length > 10 && u8[0] === 0x49 && u8[1] === 0x44 && u8[2] === 0x33) { // "ID3"
          var size = ((u8[6] & 0x7f) << 21) | ((u8[7] & 0x7f) << 14) | ((u8[8] & 0x7f) << 7) | (u8[9] & 0x7f);
          var end = 10 + size; if (end > 0 && end < u8.length) return u8.subarray(end);
        }
        return u8;
      }
      return Promise.all((blobs || []).map(function (b) { return b.arrayBuffer ? b.arrayBuffer() : new Response(b).arrayBuffer(); }))
        .then(function (bufs) { return new Blob(bufs.map(function (buf) { return stripId3(new Uint8Array(buf)); }), { type: 'audio/mpeg' }); });
    },
    // Set of cache keys with already-generated audio (memory + IndexedDB) — used to flag
    // which sentences will replay for free (no extra ElevenLabs credit).
    cachedKeys: function () {
      var mem = Object.keys(cache);
      return idbAllKeys().then(function (ks) { var s = {}; mem.forEach(function (k) { s[k] = 1; }); (ks || []).forEach(function (k) { s[k] = 1; }); return s; });
    },

    // One real synthesis call (cache miss) — returns an MP3 Blob.
    _synth: function (text, cfg, key) {
      var url = ENDPOINT + '/text-to-speech/' + encodeURIComponent(cfg.elevenVoice) + '?output_format=mp3_44100_128';
      var body = { text: text, model_id: cfg.model || DEFAULT_MODEL, voice_settings: settings(cfg) };
      return fetch(url, {
        method: 'POST',
        headers: { 'xi-api-key': key, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
        body: JSON.stringify(body)
      }).then(function (r) {
        if (!r.ok) {
          return r.text().then(function (t) {
            var msg = t;
            try { var j = JSON.parse(t); msg = (j.detail && (j.detail.message || j.detail.status)) || JSON.stringify(j.detail || j); } catch (e) { }
            throw new Error('ElevenLabs ' + r.status + ': ' + String(msg).slice(0, 220));
          });
        }
        return r.blob();
      });
    },

    // Resolve audio for one sentence, charging ONLY on a true cache miss.
    // Lookup order: in-memory → IndexedDB (this browser) → Supabase Storage (shared) → synthesize.
    getAudio: function (text, cfg, userId, projectId) {
      var self = this, k = cfgKey(text, cfg);
      if (cache[k]) return Promise.resolve(cache[k].url);
      if (inflight[k]) return inflight[k];
      function finalize(blob) { var u = URL.createObjectURL(blob); cache[k] = { url: u, blob: blob }; return u; }

      var p = idbGet(k).then(function (b) {
        if (b) { return finalize(b); }                                 // local persistent hit (free)
        return cloudGet(text, cfg).then(function (cb) {
          if (cb) { idbPut(k, cb); return finalize(cb); }               // shared cloud hit (free)
          var key = self.getKey();
          if (!key) throw new Error('no-key');
          return self._synth(spoken(text), cfg, key).then(function (blob) {     // real synthesis (charged once)
            idbPut(k, blob); cloudPut(text, cfg, blob);
            meter(userId, projectId, spoken(text), cfg);
            return finalize(blob);
          });
        });
      }).then(function (u) { delete inflight[k]; return u; }, function (e) { delete inflight[k]; throw e; });

      inflight[k] = p;
      return p;
    },

    prefetch: function (items, cfg, userId, projectId) {
      var self = this;
      if (!self.hasKey()) return;
      (items || []).forEach(function (it) {
        if (it && it.text) self.getAudio(it.text, cfg, userId, projectId).catch(function () { });
      });
    },

    // Real account-level usage straight from ElevenLabs (characters used / limit this period).
    accountUsage: function () {
      var key = this.getKey();
      if (!key) return Promise.reject(new Error('no-key'));
      return fetch(ENDPOINT + '/user/subscription', { headers: { 'xi-api-key': key } })
        .then(function (r) { if (!r.ok) return apiError(r, 'Could not read usage').then(function (e) { throw e; }); return r.json(); })
        .then(function (j) { return { used: j.character_count, limit: j.character_limit, tier: j.tier || j.character_limit }; });
    },

    // Pull the account's full voice list (the ElevenLabs "My Voices" library + premade).
    // Each result carries its category so the UI can group the user's own voices
    // (cloned / generated / professional / cloned-from-library) under "My Voices".
    listAccountVoices: function () {
      var key = this.getKey();
      if (!key) return Promise.reject(new Error('no-key'));
      return fetch(ENDPOINT + '/voices', { headers: { 'xi-api-key': key } })
        .then(function (r) { if (!r.ok) return apiError(r, 'Could not load voices').then(function (e) { throw e; }); return r.json(); })
        .then(function (j) {
          return (j.voices || []).map(function (v) {
            var cat = v.category || 'premade';
            var labels = v.labels || {};
            var desc = [labels.accent, labels.gender, labels.description, labels.age].filter(Boolean).join(', ');
            return { id: v.voice_id, name: v.name, category: cat, mine: cat !== 'premade', desc: desc };
          });
        });
    },

    test: function (cfg) {
      return this.getAudio('This is how I sound. Aloud will read your document in this voice.', cfg, null);
    },

    clearCache: function () {
      Object.keys(cache).forEach(function (k) { try { URL.revokeObjectURL(cache[k].url); } catch (e) { } delete cache[k]; });
      // also drop the persistent IndexedDB audio store, so "clear audio cache" actually frees space + forgets audio
      return openDB().then(function (db) {
        if (!db) return false;
        return new Promise(function (res) {
          try { var tx = db.transaction(IDB_STORE, 'readwrite'); tx.objectStore(IDB_STORE).clear(); tx.oncomplete = function () { res(true); }; tx.onerror = tx.onabort = function () { res(false); }; } catch (e) { res(false); }
        });
      }).catch(function () { return false; });
    }
  };

  window.PREleven = PREleven;
})();
