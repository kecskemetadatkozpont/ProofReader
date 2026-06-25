/* Publify — Médialejátszó / Hangoskönyv. Generates ElevenLabs audiobooks from pasted text, uploaded
 * documents (PDF/DOCX/PPTX), or a study's selected publications; optional Claude translation to a target
 * language; saves the final MP3 to Storage + a row in `audiobooks` so it never needs regenerating. No bundler. */
(function () {
  var h = React.createElement;
  var useState = React.useState, useEffect = React.useEffect, useRef = React.useRef;
  var BE = window.PR_BACKEND, sb = BE && BE.sb;
  var CFG = window.PR_CONFIG || {};
  var E = window.PREleven;

  var LANGS = ['Magyar', 'English', 'German', 'French', 'Spanish', 'Italian', 'Portuguese', 'Dutch', 'Polish', 'Romanian', 'Czech', 'Slovak', 'Russian', 'Ukrainian', 'Turkish', 'Arabic', 'Chinese', 'Japanese', 'Korean'];

  function fmtT(sec) { sec = Math.max(0, Math.round(sec || 0)); var m = Math.floor(sec / 60), s = sec % 60; return m + ':' + (s < 10 ? '0' : '') + s; }
  function uuid() { try { return crypto.randomUUID(); } catch (e) { return 'xxxxxxxxxxxx'.replace(/x/g, function () { return (Math.random() * 16 | 0).toString(16); }); } }

  // split raw text into narratable segments (~1–3 sentences, capped) — strips bracketed citations + figure refs
  function toSegments(text) {
    var clean = String(text || '')
      .replace(/\[[0-9,\s\-]+\]/g, ' ')            // [12], [3,4]
      .replace(/\(([A-Z][a-z]+ (?:et al\.?,? )?\d{4}[a-z]?)\)/g, ' ')  // (Smith et al., 2020)
      .replace(/\bFig(?:ure)?\.?\s*\d+/gi, 'az ábra').replace(/\bTable\s*\d+/gi, 'a táblázat')
      .replace(/https?:\/\/\S+/g, ' ').replace(/\s+/g, ' ').trim();
    var sentences = clean.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) || (clean ? [clean] : []);
    var segs = [], cur = '';
    sentences.forEach(function (s) {
      s = s.trim(); if (!s) return;
      if ((cur + ' ' + s).length > 320 && cur) { segs.push(cur.trim()); cur = s; }
      else cur = cur ? cur + ' ' + s : s;
    });
    if (cur.trim()) segs.push(cur.trim());
    return segs.filter(function (s) { return s.replace(/[^A-Za-zÀ-ű0-9]/g, '').length >= 3; });
  }

  // text extraction from an uploaded file (PDF via pdf.js, Office via PROffice, else plain text)
  function extractFile(file) {
    var name = (file.name || '').toLowerCase();
    if (/\.pdf$/.test(name) && window.pdfjsLib) {
      return file.arrayBuffer().then(function (buf) {
        return window.pdfjsLib.getDocument({ data: buf }).promise.then(function (pdf) {
          var pages = []; var chain = Promise.resolve();
          for (var i = 1; i <= pdf.numPages; i++) (function (n) { chain = chain.then(function () { return pdf.getPage(n).then(function (pg) { return pg.getTextContent().then(function (tc) { pages.push(tc.items.map(function (it) { return it.str; }).join(' ')); }); }); }); })(i);
          return chain.then(function () { return pages.join('\n\n'); });
        });
      });
    }
    if (window.PROffice && window.PROffice.isOffice(name)) return window.PROffice.extract(file).then(function (r) { return r.text || ''; });
    return file.text();
  }

  // measure an mp3 blob's duration (seconds) via an <audio> element
  function blobDuration(blob) {
    return new Promise(function (res) {
      var u = URL.createObjectURL(blob); var a = new Audio();
      a.preload = 'metadata';
      a.onloadedmetadata = function () { var d = a.duration; URL.revokeObjectURL(u); res(isFinite(d) ? d : 0); };
      a.onerror = function () { URL.revokeObjectURL(u); res(0); };
      a.src = u;
    });
  }

  function App() {
    var phS = useState('loading'), phase = phS[0], setPhase = phS[1];
    var meS = useState(null), me = meS[0], setMe = meS[1];
    var libS = useState([]), library = libS[0], setLibrary = libS[1];
    var viewS = useState('library'), view = viewS[0], setView = viewS[1];   // library | create | player
    var curS = useState(null), current = curS[0], setCurrent = curS[1];     // audiobook being played {row, url, segments}
    var voicesS = useState([]), voices = voicesS[0], setVoices = voicesS[1];
    var keyS = useState(E ? E.hasKey() : false), hasKey = keyS[0], setHasKey = keyS[1];

    useEffect(function () {
      if (!sb) { setPhase('noauth'); return; }
      sb.auth.getUser().then(function (r) {
        var u = r && r.data && r.data.user;
        if (!u) { setPhase('noauth'); return; }
        setMe(u); setPhase('ready'); loadLibrary(u.id);
        if (E && E.hasKey()) E.listAccountVoices().then(function (vs) { setVoices((E.voices || []).concat(vs || [])); }, function () { setVoices(E.voices || []); });
        else setVoices((E && E.voices) || []);
      });
    }, []);

    function loadLibrary(uid) {
      sb.from('audiobooks').select('id,title,language,translated,voice_name,model,duration_sec,chars,audio_path,segments,settings,status,created_at,source_kind').eq('owner_id', uid).order('created_at', { ascending: false }).then(function (r) { setLibrary((r && r.data) || []); });
    }

    function openAudiobook(row) {
      // signed URL for the saved MP3 → play without regenerating
      sb.storage.from('audiobooks').createSignedUrl(row.audio_path, 3600).then(function (r) {
        var url = r && r.data && r.data.signedUrl; if (!url) { alert('Nem sikerült betölteni a hangfájlt.'); return; }
        setCurrent({ row: row, url: url, segments: row.segments || [] }); setView('player');
      });
    }
    function delAudiobook(row) {
      if (!window.confirm('Törlöd ezt a hangoskönyvet?\n„' + row.title + '"')) return;
      sb.storage.from('audiobooks').remove([row.audio_path]).then(function () { });
      sb.from('audiobooks').delete().eq('id', row.id).then(function () { loadLibrary(me.id); if (current && current.row.id === row.id) { setCurrent(null); setView('library'); } });
    }

    if (phase === 'loading') return h('div', { className: 'mp-wrap' }, h('div', { className: 'mp-empty' }, 'Betöltés…'));
    if (phase === 'noauth') return h('div', { className: 'mp-wrap' }, h('div', { className: 'mp-empty' }, h('h2', null, '🎧 Médialejátszó'), h('p', null, 'Jelentkezz be a hangoskönyvek létrehozásához.'), h('a', { className: 'btn pri', href: 'Profile.html' }, 'Bejelentkezés')));

    return h('div', { className: 'mp-wrap' },
      h('div', { className: 'mp-head' },
        h('h1', null, '🎧 Médialejátszó'),
        h('div', { style: { marginLeft: 'auto', display: 'flex', gap: 8 } },
          h('button', { className: 'btn' + (view === 'library' ? ' pri' : ''), onClick: function () { setView('library'); } }, '📚 Saját hangoskönyvek'),
          h('button', { className: 'btn' + (view === 'create' ? ' pri' : ''), onClick: function () { setView('create'); } }, '＋ Új hangoskönyv'))),
      !hasKey ? h(KeyPanel, { onSaved: function () { setHasKey(true); if (E) E.listAccountVoices().then(function (vs) { setVoices((E.voices || []).concat(vs || [])); }, function () { }); } }) : null,
      view === 'library' ? h(Library, { rows: library, onOpen: openAudiobook, onDelete: delAudiobook, onNew: function () { setView('create'); } }) : null,
      view === 'create' ? h(Creator, { me: me, sb: sb, voices: voices, hasKey: hasKey, onCreated: function (row) { loadLibrary(me.id); openAudiobook(row); } }) : null,
      view === 'player' && current ? h(Player, { item: current, onBack: function () { setView('library'); } }) : null
    );
  }

  function KeyPanel(props) {
    var kS = useState(''), k = kS[0], setK = kS[1];
    return h('div', { className: 'mp-card', style: { borderColor: 'var(--accent)' } },
      h('h3', null, '🔑 ElevenLabs API-kulcs'),
      h('p', { style: { fontSize: 13, color: 'var(--muted)' } }, 'A hangszintézishez a saját ElevenLabs kulcsod kell (csak ebben a böngészőben tárolódik). Szerezd be: elevenlabs.io → Profile → API key.'),
      h('div', { style: { display: 'flex', gap: 8 } },
        h('input', { className: 'field', type: 'password', style: { flex: 1 }, placeholder: 'xi-...', value: k, onChange: function (e) { setK(e.target.value); } }),
        h('button', { className: 'btn pri', onClick: function () { if (k.trim() && E) { E.setKey(k.trim()); props.onSaved(); } } }, 'Mentés')));
  }

  function Library(props) {
    if (!props.rows.length) return h('div', { className: 'mp-empty' }, h('p', null, 'Még nincs hangoskönyved.'), h('button', { className: 'btn pri', onClick: props.onNew }, '＋ Készíts egyet'));
    return h('div', { className: 'mp-grid' }, props.rows.map(function (r) {
      return h('div', { className: 'mp-item', key: r.id },
        h('div', { className: 'mp-cover', onClick: function () { props.onOpen(r); } }, '🎧'),
        h('div', { style: { flex: 1, minWidth: 0 } },
          h('div', { className: 'mp-title', onClick: function () { props.onOpen(r); } }, r.title),
          h('div', { className: 'mp-meta' },
            r.language ? h('span', { className: 'chip' }, (r.translated ? '🌐 ' : '') + r.language) : null,
            r.voice_name ? h('span', { className: 'chip' }, '🗣 ' + r.voice_name) : null,
            h('span', { className: 'chip' }, '⏱ ' + fmtT(r.duration_sec)),
            h('span', { className: 'chip' }, ({ study: 'Tanulmány', upload: 'Feltöltés', text: 'Szöveg' })[r.source_kind] || r.source_kind))),
        h('div', { style: { display: 'flex', gap: 6, flex: 'none' } },
          h('button', { className: 'btn', onClick: function () { props.onOpen(r); } }, '▶ Lejátszás'),
          h('button', { className: 'icon-x', title: 'Törlés', onClick: function () { props.onDelete(r); } }, '✕')));
    }));
  }

  function Creator(props) {
    var srcS = useState('text'), src = srcS[0], setSrc = srcS[1];        // text | upload | study
    var textS = useState(''), text = textS[0], setText = textS[1];
    var titleS = useState(''), title = titleS[0], setTitle = titleS[1];
    var fileNameS = useState(''), fileName = fileNameS[0], setFileName = fileNameS[1];
    var studiesS = useState([]), studies = studiesS[0], setStudies = studiesS[1];
    var studyIdS = useState(''), studyId = studyIdS[0], setStudyId = studyIdS[1];
    var depthS = useState('abstract'), depth = depthS[0], setDepth = depthS[1];   // abstract | summary | fulltext
    var langS = useState('Magyar'), lang = langS[0], setLang = langS[1];
    var translS = useState(true), translate = translS[0], setTranslate = translS[1];
    var voiceS = useState((props.voices[0] && props.voices[0].id) || '21m00Tcm4TlvDq8ikWAM'), voice = voiceS[0], setVoice = voiceS[1];
    var modelS = useState('eleven_multilingual_v2'), model = modelS[0], setModel = modelS[1];
    var rateS = useState(1), rate = rateS[0], setRate = rateS[1];
    var busyS = useState(false), busy = busyS[0], setBusy = busyS[1];
    var progS = useState(''), prog = progS[0], setProg = progS[1];
    var errS = useState(''), err = errS[0], setErr = errS[1];
    var fileRef = useRef(null);

    useEffect(function () {
      props.sb.from('research_studies').select('id,title').order('created_at', { ascending: false }).then(function (r) { setStudies((r && r.data) || []); });
    }, []);

    function onFile(e) {
      var f = e.target.files && e.target.files[0]; if (!f) return;
      setFileName(f.name); setProg('Szöveg kinyerése a fájlból…'); setErr('');
      extractFile(f).then(function (t) { setText(t || ''); if (!title) setTitle(f.name.replace(/\.[^.]+$/, '')); setProg((t || '').length + ' karakter kinyerve.'); }, function () { setErr('Nem sikerült a szöveget kinyerni a fájlból.'); setProg(''); });
    }

    // build the source text for a study (abstracts | Claude summary | full text)
    function studyText() {
      return props.sb.from('research_study_papers').select('source_id,step,decision').eq('study_id', studyId).eq('decision', 'include').then(function (r) {
        var rows = (r && r.data) || [];
        var maxStep = rows.reduce(function (a, b) { return Math.max(a, b.step); }, 0);
        var ids = rows.filter(function (x) { return x.step === maxStep; }).map(function (x) { return x.source_id; });
        if (!ids.length) return { title: '', text: '' };
        return props.sb.from('research_sources').select('title,abstract,authors,year,venue').in('id', ids).then(function (sr) {
          var srcs = (sr && sr.data) || [];
          var st = (studies.filter(function (s) { return s.id === studyId; })[0] || {}).title || 'Tanulmány';
          if (depth === 'summary') {
            // a flowing Hungarian/target overview via the existing study review generator is heavy; for now build a
            // structured spoken overview from the abstracts (translated below if requested)
            var body = srcs.map(function (s, i) { return (i + 1) + '. ' + (s.title || '') + '. ' + (s.abstract || '(nincs absztrakt)'); }).join('\n\n');
            return { title: st + ' — áttekintés', text: 'A következő irodalmi áttekintés ' + srcs.length + ' kiválasztott publikációt foglal össze. ' + body };
          }
          // abstract (and fulltext falls back to abstract — full PDFs are not persisted)
          var body2 = srcs.map(function (s) { return (s.title || '') + '. ' + (s.abstract || '(nincs absztrakt)'); }).join('\n\n');
          return { title: st, text: body2 };
        });
      });
    }

    function generate() {
      if (busy) return; if (!props.hasKey || !E) { setErr('Előbb add meg az ElevenLabs kulcsot (fent).'); return; }
      setErr(''); setBusy(true); setProg('Forrásszöveg előkészítése…');
      var prep = src === 'study' ? studyText() : Promise.resolve({ title: title || (fileName || 'Hangoskönyv'), text: text });
      prep.then(function (s) {
        var srcText = (s.text || '').trim(); var ttl = (title || s.title || 'Hangoskönyv').slice(0, 120);
        if (!srcText) { setBusy(false); setErr('Nincs felolvasandó szöveg.'); return; }
        var segs = toSegments(srcText);
        if (!segs.length) { setBusy(false); setErr('A szövegből nem sikerült mondatokat képezni.'); return; }
        if (segs.length > 400) { setBusy(false); setErr('Túl hosszú (' + segs.length + ' szakasz). Rövidítsd, vagy válassz absztrakt-mélységet.'); return; }
        // optional translation (batched)
        var doTr = translate ? translateSegs(segs, lang) : Promise.resolve(segs);
        doTr.then(function (segs2) { synth(ttl, segs2); }, function (e) { setBusy(false); setErr('Fordítás sikertelen: ' + e); });
      }, function () { setBusy(false); setErr('A forrás betöltése sikertelen.'); });
    }

    function translateSegs(segs, target) {
      setProg('Fordítás ' + target + ' nyelvre (Claude)…');
      var out = []; var i = 0; var BATCH = 25;
      return props.sb.auth.getSession().then(function (s) {
        var tok = (s && s.data && s.data.session && s.data.session.access_token) || CFG.supabaseAnonKey;
        function batch() {
          if (i >= segs.length) return Promise.resolve(out);
          var chunk = segs.slice(i, i + BATCH);
          return fetch(CFG.supabaseUrl + '/functions/v1/tts-translate', { method: 'POST', headers: { 'Content-Type': 'application/json', 'apikey': CFG.supabaseAnonKey, 'Authorization': 'Bearer ' + tok }, body: JSON.stringify({ segments: chunk, target_lang: target }) })
            .then(function (r) { return r.json(); }).then(function (d) {
              if (d.error) throw new Error(d.error);
              out = out.concat(d.segments || chunk); i += BATCH; setProg('Fordítás… ' + Math.min(i, segs.length) + '/' + segs.length);
              return batch();
            });
        }
        return batch();
      });
    }

    function synth(ttl, segs) {
      var cfg = { elevenVoice: voice, model: model, stability: 50, similarity: 75 };
      var blobs = []; var meta = []; var t = 0; var idx = 0;
      function next() {
        if (idx >= segs.length) return finalize(ttl, segs, blobs, meta);
        setProg('Hangszintézis ' + (idx + 1) + '/' + segs.length + '…');
        E.getBlob(segs[idx], cfg, props.me.id, null).then(function (blob) {
          if (!blob) { idx++; return next(); }
          return blobDuration(blob).then(function (d) { blobs.push(blob); meta.push({ text: segs[idx], start: t, dur: d, kind: 'sentence' }); t += d; idx++; return next(); });
        }, function () { setBusy(false); setErr('A hangszintézis hibázott (' + (idx + 1) + '. szakasz). Ellenőrizd az ElevenLabs kulcsot/keretet.'); });
      }
      next();
    }

    function finalize(ttl, segs, blobs, meta) {
      if (!blobs.length) { setBusy(false); setErr('Nem készült hang.'); return; }
      setProg('Hangfájl összeállítása + mentés…');
      var mp3 = E.concatMp3(blobs);
      var path = props.me.id + '/' + uuid() + '.mp3';
      props.sb.storage.from('audiobooks').upload(path, mp3, { contentType: 'audio/mpeg', upsert: false }).then(function (up) {
        if (up && up.error) { setBusy(false); setErr('Mentés sikertelen: ' + up.error.message); return; }
        var chars = segs.reduce(function (a, s) { return a + s.length; }, 0);
        props.sb.from('audiobooks').insert({
          owner_id: props.me.id, project_id: null, title: ttl, source_kind: src, source_ref: src === 'study' ? studyId : (fileName || null),
          language: lang, translated: !!translate, voice_id: voice, voice_name: (props.voices.filter(function (v) { return v.id === voice; })[0] || {}).name || voice,
          model: model, settings: { rate: rate, stability: 50, similarity: 75 }, segments: meta, duration_sec: Math.round(meta.reduce(function (a, m) { return a + (m.dur || 0); }, 0)), chars: chars, status: 'ready'
        }).select('*').maybeSingle().then(function (r) {
          setBusy(false); setProg('');
          if (r && r.error) { setErr('Adatbázis-mentés sikertelen: ' + r.error.message); return; }
          props.onCreated(r.data);
        });
      });
    }

    return h('div', { className: 'mp-card' },
      h('h3', null, 'Új hangoskönyv'),
      h('div', { className: 'mp-row' },
        h('label', null, 'Forrás'),
        h('div', { className: 'seg' }, [['text', '📝 Szöveg'], ['upload', '📄 Feltöltés'], ['study', '🔬 Tanulmány']].map(function (o) { return h('button', { key: o[0], className: src === o[0] ? 'on' : '', onClick: function () { setSrc(o[0]); } }, o[1]); }))),
      src === 'text' ? h('textarea', { className: 'field', rows: 7, style: { width: '100%', boxSizing: 'border-box' }, placeholder: 'Illeszd be a felolvasandó szöveget…', value: text, onChange: function (e) { setText(e.target.value); } }) : null,
      src === 'upload' ? h('div', null,
        h('input', { ref: fileRef, type: 'file', accept: '.pdf,.docx,.pptx,.txt,.md', style: { display: 'none' }, onChange: onFile }),
        h('button', { className: 'btn', onClick: function () { fileRef.current && fileRef.current.click(); } }, '📄 Fájl választása (PDF/DOCX/PPTX/TXT)'),
        fileName ? h('span', { style: { marginLeft: 8, fontSize: 13, color: 'var(--muted)' } }, fileName) : null,
        text ? h('div', { style: { fontSize: 12, color: 'var(--faint)', marginTop: 6 } }, text.length + ' karakter — ' + text.slice(0, 160) + '…') : null) : null,
      src === 'study' ? h('div', null,
        h('div', { className: 'mp-row' }, h('label', null, 'Tanulmány'),
          h('select', { className: 'field', value: studyId, onChange: function (e) { setStudyId(e.target.value); } }, h('option', { value: '' }, '— válassz —'), studies.map(function (s) { return h('option', { key: s.id, value: s.id }, s.title); }))),
        h('div', { className: 'mp-row' }, h('label', null, 'Mélység'),
          h('div', { className: 'seg' }, [['abstract', 'Absztrakt'], ['summary', 'Áttekintés'], ['fulltext', 'Teljes (→ absztrakt)']].map(function (o) { return h('button', { key: o[0], className: depth === o[0] ? 'on' : '', onClick: function () { setDepth(o[0]); } }, o[1]); })))) : null,
      h('div', { className: 'mp-row' }, h('label', null, 'Cím'), h('input', { className: 'field', style: { flex: 1 }, placeholder: '(automatikus, ha üres)', value: title, onChange: function (e) { setTitle(e.target.value); } })),
      h('div', { className: 'mp-row' }, h('label', null, 'Nyelv'),
        h('select', { className: 'field', value: lang, onChange: function (e) { setLang(e.target.value); } }, LANGS.map(function (l) { return h('option', { key: l, value: l }, l); })),
        h('label', { style: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, marginLeft: 6 } }, h('input', { type: 'checkbox', checked: translate, onChange: function (e) { setTranslate(e.target.checked); } }), 'Fordítsd erre a nyelvre (Claude)')),
      h('div', { className: 'mp-row' }, h('label', null, 'Hang'),
        h('select', { className: 'field', value: voice, onChange: function (e) { setVoice(e.target.value); } }, props.voices.map(function (v) { return h('option', { key: v.id, value: v.id }, v.name + (v.mine ? ' (saját)' : '')); })),
        h('label', null, 'Modell'),
        h('select', { className: 'field', value: model, onChange: function (e) { setModel(e.target.value); } }, (E && E.models || []).map(function (m) { return h('option', { key: m.id, value: m.id }, m.name || m.id); }))),
      err ? h('div', { style: { color: 'var(--danger)', fontSize: 13, marginTop: 8 } }, err) : null,
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 } },
        h('button', { className: 'btn pri', disabled: busy, onClick: generate }, busy ? '⏳ Generálás…' : '🎙 Hangoskönyv generálása'),
        prog ? h('span', { style: { fontSize: 13, color: 'var(--muted)' } }, prog) : null),
      h('p', { style: { fontSize: 12, color: 'var(--faint)', marginTop: 8 } }, 'A generálás után a hangoskönyv elmentődik a könyvtáradba — legközelebb azonnal lejátszható, nem kell újragenerálni. (Az ElevenLabs karakter-alapon számláz; a fordítás Claude-ot használ.)'));
  }

  function Player(props) {
    var aRef = useRef(null);
    var playingS = useState(false), playing = playingS[0], setPlaying = playingS[1];
    var tS = useState(0), t = tS[0], setT = tS[1];
    var durS = useState(props.item.row.duration_sec || 0), dur = durS[0], setDur = durS[1];
    var rateS = useState((props.item.row.settings && props.item.row.settings.rate) || 1), rate = rateS[0], setRate = rateS[1];
    var segs = props.item.segments || [];
    var curSeg = -1; for (var i = 0; i < segs.length; i++) { if (t >= segs[i].start && (i === segs.length - 1 || t < segs[i + 1].start)) { curSeg = i; break; } }

    useEffect(function () { if (aRef.current) aRef.current.playbackRate = rate; }, [rate, props.item.url]);

    function toggle() { var a = aRef.current; if (!a) return; if (a.paused) { a.play(); setPlaying(true); } else { a.pause(); setPlaying(false); } }
    function seekTo(sec) { var a = aRef.current; if (a) { a.currentTime = sec; setT(sec); } }
    function dl() { var a = document.createElement('a'); a.href = props.item.url; a.download = (props.item.row.title || 'hangoskonyv') + '.mp3'; a.click(); }

    return h('div', { className: 'mp-card' },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
        h('button', { className: 'btn', onClick: props.onBack }, '← Vissza'),
        h('h3', { style: { margin: 0 } }, props.item.row.title),
        h('button', { className: 'btn', style: { marginLeft: 'auto' }, onClick: dl }, '⬇ Letöltés (MP3)')),
      h('audio', { ref: aRef, src: props.item.url, preload: 'metadata', style: { display: 'none' },
        onLoadedMetadata: function (e) { if (isFinite(e.target.duration)) setDur(e.target.duration); e.target.playbackRate = rate; },
        onTimeUpdate: function (e) { setT(e.target.currentTime); },
        onEnded: function () { setPlaying(false); }, onPlay: function () { setPlaying(true); }, onPause: function () { setPlaying(false); } }),
      h('div', { className: 'mp-player' },
        h('button', { className: 'mp-play', onClick: toggle }, playing ? '❚❚' : '▶'),
        h('span', { className: 'mp-time' }, fmtT(t)),
        h('input', { className: 'mp-seek', type: 'range', min: 0, max: Math.max(1, dur), step: 0.1, value: Math.min(t, dur), onChange: function (e) { seekTo(parseFloat(e.target.value)); } }),
        h('span', { className: 'mp-time' }, fmtT(dur)),
        h('select', { className: 'field', style: { width: 'auto' }, value: rate, onChange: function (e) { setRate(parseFloat(e.target.value)); } }, [0.75, 1, 1.25, 1.5, 1.75, 2].map(function (r) { return h('option', { key: r, value: r }, r + '×'); }))),
      segs.length ? h('div', { className: 'mp-segs' }, segs.map(function (s, i) {
        return h('div', { key: i, className: 'mp-seg' + (i === curSeg ? ' on' : ''), onClick: function () { seekTo(s.start); if (aRef.current && aRef.current.paused) { aRef.current.play(); } } },
          h('span', { className: 'mp-seg-t' }, fmtT(s.start)), h('span', { className: 'mp-seg-x' }, s.text));
      })) : null);
  }

  var root = document.getElementById('root');
  if (root && window.React && window.ReactDOM) ReactDOM.createRoot(root).render(h(App));
})();
