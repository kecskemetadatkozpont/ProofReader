/* ProofReader — ElevenLabs voice integration (bring-your-own-key, browser-side).
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

  // Models — selectable dynamically in the voice panel.
  var MODELS = [
    { id: 'eleven_multilingual_v2', name: 'Multilingual v2 — best quality' },
    { id: 'eleven_turbo_v2_5', name: 'Turbo v2.5 — low latency' },
    { id: 'eleven_flash_v2_5', name: 'Flash v2.5 — fastest & cheapest' },
    { id: 'eleven_monolingual_v1', name: 'English v1 — legacy' }
  ];

  function hash(s) {
    var h = 0, i, c;
    for (i = 0; i < s.length; i++) { c = s.charCodeAt(i); h = ((h << 5) - h) + c; h |= 0; }
    return (h >>> 0).toString(36);
  }
  function cfgKey(text, cfg) {
    return hash([text, cfg.elevenVoice, cfg.model, cfg.stability, cfg.similarity].join('\u0001'));
  }
  function settings(cfg) {
    return {
      stability: (cfg.stability != null ? cfg.stability : 50) / 100,
      similarity_boost: (cfg.similarity != null ? cfg.similarity : 75) / 100,
      use_speaker_boost: true
    };
  }

  var PREleven = {
    voices: VOICES,
    models: MODELS,

    getKey: function () { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } },
    setKey: function (k) {
      try { if (k) localStorage.setItem(KEY, k.trim()); else localStorage.removeItem(KEY); } catch (e) { }
    },
    hasKey: function () { return !!this.getKey(); },

    cached: function (text, cfg) { return !!cache[cfgKey(text, cfg)]; },

    getAudio: function (text, cfg, userId) {
      var k = cfgKey(text, cfg);
      if (cache[k]) return Promise.resolve(cache[k].url);
      if (inflight[k]) return inflight[k];

      var key = this.getKey();
      if (!key) return Promise.reject(new Error('no-key'));

      var url = ENDPOINT + '/text-to-speech/' + encodeURIComponent(cfg.elevenVoice) +
        '?output_format=mp3_44100_128';
      var body = {
        text: text,
        model_id: cfg.model || 'eleven_multilingual_v2',
        voice_settings: settings(cfg)
      };

      var p = fetch(url, {
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
      }).then(function (blob) {
        var u = URL.createObjectURL(blob);
        cache[k] = { url: u, blob: blob };
        delete inflight[k];
        // Meter only real synthesis — cache hits cost nothing.
        if (userId && window.PRStore) window.PRStore.addTts(userId, text.length);
        return u;
      }).catch(function (e) { delete inflight[k]; throw e; });

      inflight[k] = p;
      return p;
    },

    prefetch: function (items, cfg, userId) {
      var self = this;
      if (!self.hasKey()) return;
      (items || []).forEach(function (it) {
        if (it && it.text) self.getAudio(it.text, cfg, userId).catch(function () { });
      });
    },

    listAccountVoices: function () {
      var key = this.getKey();
      if (!key) return Promise.reject(new Error('no-key'));
      return fetch(ENDPOINT + '/voices', { headers: { 'xi-api-key': key } })
        .then(function (r) { if (!r.ok) throw new Error('Could not load voices (' + r.status + ')'); return r.json(); })
        .then(function (j) {
          return (j.voices || []).map(function (v) {
            return { id: v.voice_id, name: v.name + (v.category && v.category !== 'premade' ? ' · ' + v.category : '') };
          });
        });
    },

    test: function (cfg) {
      return this.getAudio('This is how I sound. ProofReader will read your document in this voice.', cfg, null);
    },

    clearCache: function () {
      Object.keys(cache).forEach(function (k) { try { URL.revokeObjectURL(cache[k].url); } catch (e) { } delete cache[k]; });
    }
  };

  window.PREleven = PREleven;
})();
