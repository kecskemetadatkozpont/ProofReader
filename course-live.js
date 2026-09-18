/* Publify — Kurzus: élő előadás (course-live.js). Loaded by Course.html before course.jsx; exposes window.PRCourseLive.
 *
 * A lecturer uploads a .pptx (course-media bucket, '<course>/<uploader>/decks/…'), prepares polls per slide, then
 * presents live. Students follow the lecturer's current slide in real time — a Supabase Realtime broadcast channel
 * per session carries slide/poll/end events, course_live_sessions.current_slide serves late joiners, and a slow poll
 * is the fallback — and may browse back on their own ("↩ vissza az élő diához"). Polls are launched as
 * course_poll_runs; answers are one row per student per run (editable while open); results come from the
 * course_poll_results RPC (anonymous, and for students only once the lecturer shows them). Attendance is recorded by
 * the course_session_ping RPC (server-measured active time) → the Aktivitás report. Schema: migration-117.
 *
 * Rendering: pptx-preview (npm, free for commercial use, closed source, loaded unmodified from jsdelivr) draws the deck
 * in the browser; Calibri is aliased to the metric-compatible Carlito so line breaks match PowerPoint. JSZip reads
 * slide titles and speaker notes. UI copy is Hungarian; comments English like the rest of the repo. */
(function () {
  'use strict';
  var h = React.createElement;
  var useState = React.useState, useEffect = React.useEffect, useRef = React.useRef;
  var BE = window.PR_BACKEND, sb = BE && BE.sb;

  function toast(m, o) { try { window.PRUI && window.PRUI.toast(m, o); } catch (e) { } }
  function confirmBox(title, body, label, danger) {
    if (window.PRUI && window.PRUI.confirm) return window.PRUI.confirm({ title: title, body: body, confirmLabel: label, danger: !!danger });
    return Promise.resolve(window.confirm(title + (body ? '\n\n' + body : '')));
  }
  function fmtDate(x) { try { return new Date(x).toLocaleString('hu-HU', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }
  function missingSchema(err) { return !!(err && (err.code === 'PGRST205' || err.code === '42P01' || /course_decks|course_live_sessions|does not exist|Could not find the table/i.test(err.message || ''))); }
  function uuid() { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : ('x' + Date.now() + Math.random().toString(36).slice(2)); }
  function initials(n) { return String(n || '?').split(/\s+/).map(function (w) { return w.charAt(0); }).join('').slice(0, 2).toUpperCase() || '?'; }

  // ---------- library loading ----------
  var PPTX_URL = 'https://cdn.jsdelivr.net/npm/pptx-preview@1.0.7/dist/pptx-preview.umd.js';
  var JSZIP_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
  var scriptP = {};
  function loadScript(src, globalName) {
    if (window[globalName]) return Promise.resolve(window[globalName]);
    if (!scriptP[src]) scriptP[src] = new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = src; s.async = true;
      s.onload = function () { window[globalName] ? res(window[globalName]) : rej(new Error(globalName + ' nem töltődött be')); };
      s.onerror = function () { delete scriptP[src]; rej(new Error('Nem sikerült betölteni: ' + src)); };
      document.head.appendChild(s);
    });
    return scriptP[src];
  }
  var fontsP = null;
  function ensureFonts() {   // Calibri → Carlito (metric-compatible): same widths, so text wraps where PowerPoint wraps it
    if (fontsP) return fontsP;
    fontsP = fetch('https://fonts.googleapis.com/css2?family=Carlito:ital,wght@0,400;0,700;1,400;1,700&display=swap')
      .then(function (r) { return r.text(); })
      .then(function (css) { var st = document.createElement('style'); st.textContent = css.replace(/font-family:\s*'Carlito'/g, "font-family: 'Calibri'"); document.head.appendChild(st); })
      .catch(function () { });
    return fontsP;
  }

  // ---------- deck file + metadata ----------
  var bufCache = {};
  function loadDeckBuf(deck) {
    if (!bufCache[deck.id]) bufCache[deck.id] = sb.storage.from('course-media').download(deck.storage_path).then(function (r) {
      if (r.error) throw r.error; return r.data.arrayBuffer();
    }).catch(function (e) { delete bufCache[deck.id]; throw e; });
    return bufCache[deck.id];
  }
  function xmlText(s) { return String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'); }
  function attr(tag, name) { var m = new RegExp('\\s' + name.replace(':', '\\:') + '="([^"]*)"').exec(tag); return m ? m[1] : null; }
  function shapes(x) { return String(x || '').match(/<p:sp>[\s\S]*?<\/p:sp>/g) || []; }
  function paras(block) { return (block.match(/<a:p>[\s\S]*?<\/a:p>/g) || []).map(function (p) { return xmlText((p.match(/<a:t>([^<]*)<\/a:t>/g) || []).map(function (t) { return t.replace(/<\/?a:t>/g, ''); }).join('')); }).filter(function (t) { return t.trim(); }); }
  function slideTitle(x) {
    var sp = shapes(x).filter(function (b) { return /<p:ph\b[^>]*type="(title|ctrTitle)"/.test(b); })[0];
    var t = sp ? paras(sp).join(' ') : '';
    if (!t) {   // decks built from plain text boxes have no title placeholder → the paragraph with the largest font is the title
      var best = '', bestSz = -1;
      (String(x || '').match(/<a:p>[\s\S]*?<\/a:p>/g) || []).forEach(function (p) {
        var txt = xmlText((p.match(/<a:t>([^<]*)<\/a:t>/g) || []).map(function (q) { return q.replace(/<\/?a:t>/g, ''); }).join('')).trim();
        if (txt.length < 2) return;
        var sz = Math.max.apply(null, (p.match(/<a:rPr\b[^>]*\ssz="(\d+)"/g) || []).map(function (q) { return +(/sz="(\d+)"/.exec(q)[1]); }).concat([0]));
        if (sz > bestSz) { bestSz = sz; best = txt; }
      });
      t = best;
    }
    return t.trim().slice(0, 140);
  }
  function notesText(x) {
    return shapes(x).filter(function (b) { return !/<p:ph\b[^>]*type="(sldNum|sldImg|hdr|ftr|dt)"/.test(b); })
      .map(function (b) { return paras(b).join('\n'); }).filter(Boolean).join('\n\n').trim();
  }
  var metaCache = {};
  // ---------- pptx slimming ----------
  // A legnagyobb .pptx fájlokat szinte mindig a beágyazott képek fújják fel: a diákra illesztett
  // fotók gyakran eredeti, 4000 pixeles méretben utaznak. Feltöltés előtt ezeket átméretezzük és
  // újratömörítjük — a dia látványa nem változik, mert a vetítés úgyis 1920 pixel széles.
  // A videókat és hangokat NEM bántjuk: azokat a böngészőben nem lehet átkódolni.
  var MAX_DECK = 50 * 1024 * 1024;    // a tároló fájlonkénti korlátja
  var SLIM_TRIGGER = 12 * 1024 * 1024;  // efölött megpróbáljuk tömöríteni
  function fmtMB(n) { return n > 1073741824 ? (n / 1073741824).toFixed(2) + ' GB' : (n / 1048576).toFixed(1) + ' MB'; }
  var SLIM_MAX_W = 1920;        // ennél szélesebb képet nincs értelme megtartani
  var SLIM_QUALITY = 0.82;
  var SLIM_MIN_BYTES = 120 * 1024;   // ekkora kép alatt nem éri meg dolgozni

  function hasAlpha(ctx, w, h) {
    try {
      var d = ctx.getImageData(0, 0, w, h).data;
      for (var i = 3; i < d.length; i += 4 * 97) if (d[i] < 250) return true;   // ritkítva mintázunk
      return false;
    } catch (e) { return true; }
  }
  function shrinkImage(blob, name) {
    return createImageBitmap(blob).then(function (bm) {
      var scale = Math.min(1, SLIM_MAX_W / bm.width);
      var w = Math.max(1, Math.round(bm.width * scale)), hh = Math.max(1, Math.round(bm.height * scale));
      var cv = document.createElement('canvas'); cv.width = w; cv.height = hh;
      var ctx = cv.getContext('2d');
      ctx.drawImage(bm, 0, 0, w, hh);
      try { bm.close(); } catch (e) { }
      var png = /\.png$/i.test(name) && hasAlpha(ctx, w, hh);
      return new Promise(function (res) {
        cv.toBlob(function (out) { res(out || blob); }, png ? 'image/png' : 'image/jpeg', png ? undefined : SLIM_QUALITY);
      });
    }).catch(function () { return blob; });
  }
  // → { blob, before, after, images, media, skipped }
  function slimPptx(file, onProgress) {
    return loadScript(JSZIP_URL, 'JSZip').then(function (JSZip) {
      return JSZip.loadAsync(file).then(function (zip) {
        var media = [], bytesMedia = 0, imgs = [];
        zip.forEach(function (path, entry) {
          if (!/^ppt\/media\//i.test(path) || entry.dir) return;
          if (/\.(png|jpe?g|gif|bmp|tiff?)$/i.test(path)) imgs.push(path);
          else media.push(path);
        });
        var done = 0, saved = 0, touched = 0;
        return imgs.reduce(function (p, path) {
          return p.then(function () {
            var entry = zip.file(path);
            return entry.async('blob').then(function (b) {
              done++;
              if (onProgress) onProgress('Képek tömörítése… ' + done + ' / ' + imgs.length);
              if (b.size < SLIM_MIN_BYTES) return;
              return shrinkImage(b, path).then(function (out) {
                if (out && out.size < b.size * 0.92) {
                  saved += b.size - out.size; touched++;
                  // a kiterjesztés marad: a pptx a kapcsolatokban név szerint hivatkozik a fájlra,
                  // a PowerPoint és a megjelenítők a tartalom alapján ismerik fel a formátumot
                  zip.file(path, out);
                }
              });
            });
          });
        }, Promise.resolve()).then(function () {
          media.forEach(function (path) { var f = zip.file(path); if (f && f._data && f._data.uncompressedSize) bytesMedia += f._data.uncompressedSize; });
          if (onProgress) onProgress('Fájl összeállítása…');
          return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
        }).then(function (blob) {
          return { blob: blob, before: file.size, after: blob.size, images: touched, total: imgs.length,
                   mediaBytes: bytesMedia, mediaCount: media.length, saved: saved };
        });
      });
    });
  }

  function parsePptx(buf, cacheKey) {
    if (cacheKey && metaCache[cacheKey]) return metaCache[cacheKey];
    var p = loadScript(JSZIP_URL, 'JSZip').then(function (JSZip) { return JSZip.loadAsync(buf); }).then(function (z) {
      var pres = z.file('ppt/presentation.xml'), rels = z.file('ppt/_rels/presentation.xml.rels');
      if (!pres || !rels) throw new Error('Ez nem PowerPoint (.pptx) fájl.');
      return Promise.all([pres.async('string'), rels.async('string')]).then(function (pr) {
        var map = {}; (pr[1].match(/<Relationship\b[^>]*>/g) || []).forEach(function (tag) { map[attr(tag, 'Id')] = attr(tag, 'Target'); });
        var order = []; (pr[0].match(/<p:sldId\b[^>]*>/g) || []).forEach(function (tag) { var t = map[attr(tag, 'r:id')]; if (t) order.push('ppt/' + t.replace(/^\/?(ppt\/)?/, '')); });
        return Promise.all(order.map(function (path) {
          var relPath = path.replace(/slides\/(slide\d+\.xml)$/, 'slides/_rels/$1.rels');
          return Promise.all([z.file(path) ? z.file(path).async('string') : '', z.file(relPath) ? z.file(relPath).async('string') : '']).then(function (xs) {
            var nm = /Target="\.\.\/notesSlides\/(notesSlide\d+\.xml)"/.exec(xs[1]), nf = nm && z.file('ppt/notesSlides/' + nm[1]);
            return (nf ? nf.async('string') : Promise.resolve('')).then(function (nx) { return { title: slideTitle(xs[0]), notes: notesText(nx) }; });
          });
        }));
      });
    });
    if (cacheKey) { metaCache[cacheKey] = p; p.catch(function () { delete metaCache[cacheKey]; }); }
    return p;
  }

  // ---------- slide stage: renders the whole deck once, shows one slide, scales to its box ----------
  function SlideStage(props) {
    var hostRef = useRef(null), innerRef = useRef(null), wrapsRef = useRef([]);
    var sS = useState('loading'), st = sS[0], setSt = sS[1];
    function show() {
      var ws = wrapsRef.current, n = props.slide || 1;
      ws.forEach(function (w, i) {
        var on = i === n - 1;
        w.style.display = on ? '' : 'none';
        if (!on) Array.prototype.forEach.call(w.querySelectorAll('audio,video'), function (m) { try { m.pause(); } catch (e) { } });
      });
    }
    function fit() {
      var host = hostRef.current, inner = innerRef.current; if (!host || !inner) return;
      var W = host.clientWidth || 960, H = props.contain ? (host.clientHeight || 540) : Infinity;
      var sc = Math.min(W / 960, H / 540);
      inner.style.transform = 'scale(' + sc + ')';
      if (!props.contain) host.style.height = Math.round(540 * sc) + 'px';
    }
    useEffect(function () {
      if (!props.buf) return;
      var alive = true; setSt('loading');
      Promise.all([loadScript(PPTX_URL, 'pptxPreview'), ensureFonts()]).then(function (libs) {
        if (!alive || !innerRef.current) return;
        innerRef.current.innerHTML = '';
        var viewer = libs[0].init(innerRef.current, { width: 960, height: 540 });
        return viewer.preview(props.buf.slice(0)).then(function () {
          if (!alive || !innerRef.current) return;
          wrapsRef.current = Array.prototype.slice.call(innerRef.current.querySelectorAll('.pptx-preview-slide-wrapper'));
          setSt('ready'); show(); fit();
          if (props.onReady) props.onReady(wrapsRef.current.length);
        });
      }).catch(function (e) { if (alive) setSt('error:' + ((e && e.message) || e)); });
      return function () { alive = false; };
    }, [props.buf]);
    useEffect(function () { if (st === 'ready') show(); }, [props.slide, st]);
    useEffect(function () {
      fit();
      if (!window.ResizeObserver || !hostRef.current) return;
      var ro = new ResizeObserver(function () { fit(); }); ro.observe(hostRef.current);
      return function () { ro.disconnect(); };
    }, [props.contain]);
    return h('div', { ref: hostRef, className: 'cl-stage' + (props.contain ? ' contain' : ''), 'aria-label': 'Dia ' + (props.slide || 1) },
      h('div', { ref: innerRef, className: 'cl-stage-inner' }),
      st === 'loading' ? h('div', { className: 'cl-stage-msg' }, h('span', { className: 'cl-spin' }), ' Diák betöltése…') : null,
      st.indexOf('error:') === 0 ? h('div', { className: 'cl-stage-msg err' }, 'A diák nem jeleníthetők meg: ' + st.slice(6)) : null,
      props.children);
  }

  // ---------- poll types ----------
  var TYPES = [
    { k: 'single', ic: '🔘', t: 'Egy választás', d: 'Egy opció jelölhető' },
    { k: 'multi', ic: '☑️', t: 'Több választás', d: 'Több opció is jelölhető' },
    { k: 'quiz', ic: '🏆', t: 'Kvíz', d: 'Van helyes válasz — a végén felfeded' },
    { k: 'scale', ic: '📏', t: 'Skála', d: 'Pl. 1–5: mennyire értesz egyet?' },
    { k: 'wordcloud', ic: '☁️', t: 'Szófelhő', d: '1–3 szavas válaszok felhőben' },
    { k: 'open', ic: '💬', t: 'Nyílt kérdés', d: 'Szabad szöveges válaszok, névtelenül' }
  ];
  var TYPE_BY = {}; TYPES.forEach(function (t) { TYPE_BY[t.k] = t; });
  function hasOptions(type) { return type === 'single' || type === 'multi' || type === 'quiz'; }
  function studentSettings(p) { var s = Object.assign({}, p.settings || {}); delete s.correct; return s; }

  function PollForm(props) {
    var init = props.poll || {};
    var tS = useState(init.type || null), type = tS[0], setType = tS[1];
    var qS = useState(init.question || ''), q = qS[0], setQ = qS[1];
    var oS = useState((init.options && init.options.length) ? init.options.slice() : ['', '']), opts = oS[0], setOpts = oS[1];
    var sS = useState(Object.assign({ max_words: 1, min: 1, max: 5, min_label: '', max_label: '' }, init.settings || {})), set = sS[0], setSet = sS[1];
    var eS = useState(''), err = eS[0], setErr = eS[1];
    function up(k, v) { setSet(function (o) { var n = Object.assign({}, o); n[k] = v; return n; }); setErr(''); }
    function save() {
      var question = q.trim();
      if (!question) { setErr('Írd be a kérdést.'); return; }
      var options = hasOptions(type) ? opts.map(function (o) { return o.trim(); }).filter(Boolean) : [];
      if (hasOptions(type) && options.length < 2) { setErr('Legalább két válaszlehetőség kell.'); return; }
      var settings = {};
      if (type === 'multi') settings.max_choices = Math.max(1, Math.min(options.length, parseInt(set.max_choices, 10) || options.length));
      if (type === 'quiz') { var c = parseInt(set.correct, 10); if (!(c >= 0 && c < options.length)) { setErr('Jelöld meg a helyes választ.'); return; } settings.correct = c; }
      if (type === 'wordcloud') settings.max_words = Math.max(1, Math.min(3, parseInt(set.max_words, 10) || 1));
      if (type === 'scale') {
        var mn = parseInt(set.min, 10), mx = parseInt(set.max, 10);
        if (!(mn >= 0 && mx > mn && mx - mn <= 10)) { setErr('A skála legyen pl. 1–5 vagy 1–10 (legfeljebb 11 fok).'); return; }
        settings.min = mn; settings.max = mx; settings.min_label = String(set.min_label || '').slice(0, 40); settings.max_label = String(set.max_label || '').slice(0, 40);
      }
      props.onSave({ type: type, question: question.slice(0, 500), options: options, settings: settings });
    }
    if (!type) return h('div', { className: 'cl-form' },
      h('div', { className: 'cl-form-h' }, h('b', null, 'Milyen szavazást indítasz?'), h('button', { type: 'button', className: 'btn sm', onClick: props.onCancel }, 'Mégse')),
      h('div', { className: 'cl-types' }, TYPES.map(function (t) {
        return h('button', { key: t.k, type: 'button', className: 'cl-type', onClick: function () { setType(t.k); } }, h('span', { className: 'ic' }, t.ic), h('b', null, t.t), h('span', null, t.d));
      })));
    return h('div', { className: 'cl-form' },
      h('div', { className: 'cl-form-h' },
        h('b', null, TYPE_BY[type].ic + ' ' + TYPE_BY[type].t),
        props.poll ? null : h('button', { type: 'button', className: 'btn sm', onClick: function () { setType(null); } }, 'Más típus')),
      h('label', { className: 'form-l' }, 'Kérdés'),
      h('textarea', { className: 'in', rows: 2, value: q, autoFocus: true, placeholder: 'pl. Melyik szöveget írta ember?', onChange: function (e) { setQ(e.target.value); setErr(''); } }),
      hasOptions(type) ? h('div', null,
        h('label', { className: 'form-l' }, type === 'quiz' ? 'Válaszok (jelöld a helyeset)' : 'Válaszlehetőségek'),
        opts.map(function (o, i) {
          return h('div', { key: i, className: 'cl-opt' },
            type === 'quiz' ? h('input', { type: 'radio', name: 'quiz-correct', checked: String(set.correct) === String(i), 'aria-label': 'Helyes válasz: ' + (i + 1) + '.', onChange: function () { up('correct', i); } }) : h('span', { className: 'cl-opt-n' }, String.fromCharCode(65 + i)),
            h('input', { className: 'in', value: o, placeholder: 'Válasz ' + (i + 1), onChange: function (e) { var v = e.target.value; setOpts(function (a) { var n = a.slice(); n[i] = v; return n; }); setErr(''); } }),
            opts.length > 2 ? h('button', { type: 'button', className: 'btn sm', 'aria-label': 'Válasz törlése', onClick: function () { setOpts(function (a) { return a.filter(function (_, j) { return j !== i; }); }); } }, '×') : null);
        }),
        opts.length < 8 ? h('button', { type: 'button', className: 'btn sm', onClick: function () { setOpts(function (a) { return a.concat(['']); }); } }, '+ Válasz') : null,
        type === 'multi' ? h('div', { className: 'cl-inline' }, h('span', null, 'Legfeljebb ennyi jelölhető:'), h('input', { className: 'in sm', type: 'number', min: 1, max: opts.length, value: set.max_choices || opts.length, onChange: function (e) { up('max_choices', e.target.value); } })) : null) : null,
      type === 'wordcloud' ? h('div', { className: 'cl-inline' }, h('span', null, 'Szavak száma diákonként:'),
        h('span', { className: 'seg' }, [1, 2, 3].map(function (n) { return h('button', { key: n, type: 'button', className: +set.max_words === n ? 'on' : '', onClick: function () { up('max_words', n); } }, n); }))) : null,
      type === 'scale' ? h('div', { className: 'cl-scale-set' },
        h('div', null, h('label', { className: 'form-l' }, 'Alsó érték'), h('input', { className: 'in', type: 'number', value: set.min, onChange: function (e) { up('min', e.target.value); } })),
        h('div', null, h('label', { className: 'form-l' }, 'Felső érték'), h('input', { className: 'in', type: 'number', value: set.max, onChange: function (e) { up('max', e.target.value); } })),
        h('div', null, h('label', { className: 'form-l' }, 'Alsó címke'), h('input', { className: 'in', value: set.min_label, placeholder: 'egyáltalán nem', onChange: function (e) { up('min_label', e.target.value); } })),
        h('div', null, h('label', { className: 'form-l' }, 'Felső címke'), h('input', { className: 'in', value: set.max_label, placeholder: 'teljesen', onChange: function (e) { up('max_label', e.target.value); } }))) : null,
      err ? h('p', { className: 'co-err', role: 'alert' }, err) : null,
      h('div', { className: 'cl-form-f' },
        h('button', { type: 'button', className: 'btn', onClick: props.onCancel }, 'Mégse'),
        h('button', { type: 'button', className: 'btn pri', onClick: save }, props.saveLabel || 'Mentés')));
  }

  // ---------- results ----------
  function PollResults(props) {
    var run = props.run, res = props.res, big = !!props.big;
    if (!res) return h('div', { className: 'cl-res-empty' }, 'Eredmény betöltése…');
    var total = res.total || 0, data = res.data || {};
    var correct = run.correct && run.correct.choice != null ? +run.correct.choice : null;
    if (run.type === 'single' || run.type === 'multi' || run.type === 'quiz') {
      var max = Math.max.apply(null, (run.options || []).map(function (_, i) { return +(data[i] || 0); }).concat([1]));
      return h('div', { className: 'cl-bars' + (big ? ' big' : '') },
        (run.options || []).map(function (o, i) {
          var c = +(data[i] || 0), pct = total ? Math.round(c / total * 100) : 0, ok = correct === i;
          return h('div', { key: i, className: 'cl-bar' + (ok ? ' ok' : '') + (correct != null && !ok ? ' dim' : '') },
            h('div', { className: 'cl-bar-l' }, h('span', { className: 'cl-opt-n' }, String.fromCharCode(65 + i)), h('span', { className: 'txt' }, o), ok ? h('b', { className: 'cl-ok' }, '✓ helyes') : null),
            h('div', { className: 'cl-bar-t' }, h('i', { style: { width: (c / max * 100) + '%' } })),
            h('div', { className: 'cl-bar-n' }, c + ' · ' + pct + '%'));
        }),
        h('div', { className: 'cl-res-total' }, total + ' válasz'));
    }
    if (run.type === 'scale') {
      var s = run.settings || {}, mn = s.min != null ? s.min : 1, mx = s.max != null ? s.max : 5, keys = [], sum = 0, peak = 1;
      for (var v = mn; v <= mx; v++) { keys.push(v); sum += v * (+(data[v] || 0)); peak = Math.max(peak, +(data[v] || 0)); }
      return h('div', { className: 'cl-scale-res' + (big ? ' big' : '') },
        h('div', { className: 'cl-scale-avg' }, h('b', null, total ? (sum / total).toFixed(1).replace('.', ',') : '—'), h('span', null, 'átlag · ' + total + ' válasz')),
        h('div', { className: 'cl-hist' }, keys.map(function (k) {
          var c = +(data[k] || 0);
          return h('div', { key: k, className: 'cl-hist-c' }, h('span', { className: 'n' }, c), h('i', { style: { height: (c / peak * 100) + '%' } }), h('span', { className: 'k' }, k));
        })),
        (s.min_label || s.max_label) ? h('div', { className: 'cl-scale-lab' }, h('span', null, s.min_label || ''), h('span', null, s.max_label || '')) : null);
    }
    if (run.type === 'wordcloud') {
      var words = Object.keys(data).map(function (w) { return [w, +data[w]]; }).sort(function (a, b) { return b[1] - a[1]; });
      var top = words.length ? words[0][1] : 1;
      return h('div', { className: 'cl-cloud' + (big ? ' big' : '') },
        words.length ? words.map(function (w, i) { return h('span', { key: w[0], style: { fontSize: (big ? 18 : 12) + Math.round((w[1] / top) * (big ? 44 : 22)) + 'px', opacity: 0.55 + 0.45 * (w[1] / top) }, className: 'w' + (i % 4) }, w[0]); })
          : h('div', { className: 'cl-res-empty' }, 'Még nincs válasz.'),
        h('div', { className: 'cl-res-total' }, total + ' válaszadó'));
    }
    var list = Array.isArray(data) ? data : [];
    return h('div', { className: 'cl-open' + (big ? ' big' : '') },
      list.length ? list.slice(0, big ? 24 : 60).map(function (t, i) { return h('div', { key: i, className: 'cl-open-card' }, t); }) : h('div', { className: 'cl-res-empty' }, 'Még nincs válasz.'),
      h('div', { className: 'cl-res-total' }, total + ' válasz'));
  }

  // ---------- answering (student) ----------
  function AnswerForm(props) {
    var run = props.run, mine = props.mine;
    var init = (mine && mine.answer) || {};
    var cS = useState(init.choice != null ? init.choice : null), choice = cS[0], setChoice = cS[1];
    var mS = useState(init.choices || []), choices = mS[0], setChoices = mS[1];
    var vS = useState(init.value != null ? init.value : null), value = vS[0], setValue = vS[1];
    var wS = useState((init.words || []).concat(['', '', '']).slice(0, Math.max(1, (run.settings && run.settings.max_words) || 1))), words = wS[0], setWords = wS[1];
    var tS = useState(init.text || ''), text = tS[0], setText = tS[1];
    var bS = useState(false), busy = bS[0], setBusy = bS[1];
    var set = run.settings || {};
    function answer() {
      if (run.type === 'single' || run.type === 'quiz') return choice == null ? null : { choice: +choice };
      if (run.type === 'multi') return choices.length ? { choices: choices.slice().sort() } : null;
      if (run.type === 'scale') return value == null ? null : { value: +value };
      if (run.type === 'wordcloud') { var ws = words.map(function (w) { return w.trim().slice(0, 40); }).filter(Boolean); return ws.length ? { words: ws } : null; }
      var t = text.trim(); return t ? { text: t.slice(0, 500) } : null;
    }
    function submit() {
      var a = answer(); if (!a || busy) return;
      setBusy(true);
      sb.from('course_poll_answers').upsert({ run_id: run.id, course_id: run.course_id, user_id: props.meId, answer: a, updated_at: new Date().toISOString() }, { onConflict: 'run_id,user_id' }).then(function (r) {
        setBusy(false);
        if (r && r.error) { toast(/row-level|policy/i.test(r.error.message) ? 'A szavazás már lezárult.' : ('Nem sikerült elküldeni: ' + r.error.message), { kind: 'error' }); return; }
        toast('✓ Válasz elküldve', { kind: 'ok' }); if (props.onSent) props.onSent();
      }, function () { setBusy(false); toast('Hálózati hiba — próbáld újra.', { kind: 'error' }); });
    }
    var body;
    if (run.type === 'single' || run.type === 'quiz') body = h('div', { className: 'cl-choices', role: 'radiogroup', 'aria-label': run.question }, (run.options || []).map(function (o, i) {
      return h('button', { key: i, type: 'button', role: 'radio', 'aria-checked': +choice === i ? 'true' : 'false', className: 'cl-choice' + (+choice === i && choice != null ? ' on' : ''), onClick: function () { setChoice(i); } }, h('span', { className: 'cl-opt-n' }, String.fromCharCode(65 + i)), h('span', null, o));
    }));
    else if (run.type === 'multi') body = h('div', { className: 'cl-choices', role: 'group', 'aria-label': run.question },
      h('div', { className: 'cl-hint' }, 'Legfeljebb ' + (set.max_choices || (run.options || []).length) + ' jelölhető'),
      (run.options || []).map(function (o, i) {
        var on = choices.indexOf(i) >= 0;
        return h('button', { key: i, type: 'button', role: 'checkbox', 'aria-checked': on ? 'true' : 'false', className: 'cl-choice' + (on ? ' on' : ''),
          onClick: function () { setChoices(function (a) { if (a.indexOf(i) >= 0) return a.filter(function (x) { return x !== i; }); if (a.length >= (set.max_choices || 99)) return a; return a.concat([i]); }); } },
          h('span', { className: 'cl-opt-n' }, on ? '✓' : String.fromCharCode(65 + i)), h('span', null, o));
      }));
    else if (run.type === 'scale') {
      var ks = []; for (var v = (set.min != null ? set.min : 1); v <= (set.max != null ? set.max : 5); v++) ks.push(v);
      body = h('div', null, h('div', { className: 'cl-scale', role: 'radiogroup', 'aria-label': run.question }, ks.map(function (k) {
        return h('button', { key: k, type: 'button', role: 'radio', 'aria-checked': +value === k ? 'true' : 'false', className: 'cl-scale-b' + (+value === k && value != null ? ' on' : ''), onClick: function () { setValue(k); } }, k);
      })), (set.min_label || set.max_label) ? h('div', { className: 'cl-scale-lab' }, h('span', null, set.min_label || ''), h('span', null, set.max_label || '')) : null);
    }
    else if (run.type === 'wordcloud') body = h('div', { className: 'cl-words' }, words.map(function (w, i) {
      return h('input', { key: i, className: 'in', value: w, maxLength: 40, placeholder: (i + 1) + '. szó', 'aria-label': (i + 1) + '. szó', onChange: function (e) { var val = e.target.value; setWords(function (a) { var n = a.slice(); n[i] = val; return n; }); } });
    }));
    else body = h('textarea', { className: 'in', rows: 3, maxLength: 500, value: text, placeholder: 'A válaszod (névtelenül jelenik meg)…', 'aria-label': run.question, onChange: function (e) { setText(e.target.value); } });
    return h('div', { className: 'cl-answer' },
      body,
      h('div', { className: 'cl-answer-f' },
        mine ? h('span', { className: 'chip ok' }, '✓ Elküldve — amíg nyitva van, módosíthatod') : h('span', { className: 'cl-hint' }, run.type === 'open' ? 'A válaszok névtelenül jelennek meg.' : ''),
        h('span', { className: 'sp' }),
        h('button', { type: 'button', className: 'btn pri', disabled: busy || !answer(), onClick: submit }, busy ? 'Küldés…' : (mine ? 'Módosítás' : 'Küldés'))));
  }

  // ---------- live session channel ----------
  function useLiveChannel(sessionId, meId, role, handlers) {
    var hRef = useRef(handlers); hRef.current = handlers;
    var chRef = useRef(null);
    var aS = useState(0), audience = aS[0], setAudience = aS[1];
    useEffect(function () {
      if (!sessionId || !sb || !sb.channel) return;
      var ch = sb.channel('course-live:' + sessionId, { config: { broadcast: { self: false }, presence: { key: meId + ':' + role } } });
      ['slide', 'poll', 'end'].forEach(function (ev) { ch.on('broadcast', { event: ev }, function (m) { var f = hRef.current[ev]; if (f) f(m.payload || {}); }); });
      ch.on('presence', { event: 'sync' }, function () {
        var st = ch.presenceState(), n = 0;
        Object.keys(st).forEach(function (k) { if (/:student$/.test(k)) n++; });
        setAudience(n);
      });
      ch.subscribe(function (status) { if (status === 'SUBSCRIBED') { try { ch.track({ id: meId, role: role, at: Date.now() }); } catch (e) { } } });
      chRef.current = ch;
      return function () { try { sb.removeChannel(ch); } catch (e) { } chRef.current = null; };
    }, [sessionId]);
    function send(event, payload) { var ch = chRef.current; if (ch) { try { ch.send({ type: 'broadcast', event: event, payload: payload || {} }); } catch (e) { } } }
    return { send: send, audience: audience };
  }
  // course-wide channel: tells every open course page that a lecture went live / ended
  function announce(courseId, event, payload) {
    if (!sb || !sb.channel) return;
    var ch = sb.channel('course-live-index:' + courseId, { config: { broadcast: { self: false } } });
    ch.subscribe(function (status) {
      if (status !== 'SUBSCRIBED') return;
      try { ch.send({ type: 'broadcast', event: event, payload: payload || {} }); } catch (e) { }
      setTimeout(function () { try { sb.removeChannel(ch); } catch (e) { } }, 1500);
    });
  }

  // ---------- decks tab ----------
  function DecksTab(props) {
    // Előadások (alkalmak) és a hozzájuk tartozó diasorok. Egy előadás alá egy aktuális diasor
    // tartozik: azt frissíteni lehet (a szavazások és a korábbi alkalmak a helyükön maradnak),
    // nem kell újat feltölteni. A besorolatlan diasorok külön szakaszban, utólag beköthetők.
    var course = props.course, isInstr = props.isInstr;
    var dS = useState(null), decks = dS[0], setDecks = dS[1];
    var lS = useState([]), lectures = lS[0], setLectures = lS[1];
    var pS = useState({}), pollCounts = pS[0], setPollCounts = pS[1];
    var uS = useState(null), up = uS[0], setUp = uS[1];     // { file, title, meta, busy, msg, lecture, replace }
    var nS = useState(null), newLec = nS[0], setNewLec = nS[1];   // { title, held_at }
    var eS = useState(''), schemaErr = eS[0], setSchemaErr = eS[1];
    var fileRef = useRef(null);

    function load() {
      sb.from('course_decks').select('*').eq('course_id', course.id).order('created_at', { ascending: false }).then(function (r) {
        if (r && r.error) { if (missingSchema(r.error)) setSchemaErr('missing'); else toast('A diasorok nem tölthetők be: ' + r.error.message, { kind: 'error' }); setDecks([]); return; }
        setSchemaErr(''); setDecks((r && r.data) || []);
        if (isInstr) sb.from('course_slide_polls').select('deck_id').eq('course_id', course.id).then(function (p) {
          var m = {}; ((p && p.data) || []).forEach(function (x) { m[x.deck_id] = (m[x.deck_id] || 0) + 1; }); setPollCounts(m);
        });
      });
      sb.from('course_lectures').select('*').eq('course_id', course.id).order('ord', { ascending: true }).then(function (r) {
        setLectures((r && r.data) || []);
      });
    }
    useEffect(function () { load(); }, [course.id]);

    // ---- előadás (alkalom) ----
    function createLecture() {
      var t = (newLec && newLec.title || '').trim();
      if (t.length < 2) { toast('Adj címet az előadásnak.', { kind: 'error' }); return; }
      var ord = lectures.reduce(function (m, l) { return Math.max(m, l.ord || 0); }, 0) + 1;
      sb.from('course_lectures').insert({ course_id: course.id, ord: ord, title: t.slice(0, 200),
        held_at: (newLec.held_at || null), visible: true }).select('*').maybeSingle().then(function (r) {
        if (r && r.error) { toast('Nem sikerült: ' + r.error.message, { kind: 'error' }); return; }
        setNewLec(null); toast('✓ Előadás létrehozva', { kind: 'ok' }); load();
      });
    }
    function renameLecture(l) {
      var t = window.prompt('Az előadás címe:', l.title);
      if (t === null) return;
      sb.from('course_lectures').update({ title: t.trim().slice(0, 200) }).eq('id', l.id).then(function (r) {
        if (r && r.error) { toast(r.error.message, { kind: 'error' }); return; }
        load();
      });
    }
    function setLectureDate(l, d) {
      sb.from('course_lectures').update({ held_at: d || null }).eq('id', l.id).then(function () { load(); });
    }
    function toggleVisible(l) {
      sb.from('course_lectures').update({ visible: !l.visible }).eq('id', l.id).then(function (r) {
        if (r && r.error) { toast(r.error.message, { kind: 'error' }); return; }
        load();
      });
    }
    function delLecture(l) {
      var mine = (decks || []).filter(function (d) { return d.lecture_id === l.id; });
      confirmBox('Törlöd az előadást?', '„' + l.title + '” törlődik.' + (mine.length ? ' A hozzá tartozó ' + mine.length + ' diasor megmarad, csak besorolatlan lesz.' : ''), 'Törlés', true).then(function (ok) {
        if (!ok) return;
        sb.from('course_lectures').delete().eq('id', l.id).then(function (r) {
          if (r && r.error) { toast(r.error.message, { kind: 'error' }); return; }
          load();
        });
      });
    }
    function attach(deck, lectureId) {
      sb.from('course_decks').update({ lecture_id: lectureId || null }).eq('id', deck.id).then(function (r) {
        if (r && r.error) { toast(r.error.message, { kind: 'error' }); return; }
        load();
      });
    }

    // ---- diasor feltöltése / frissítése ----
    function pick(e) {
      var f = e.target.files && e.target.files[0]; e.target.value = '';
      if (!f) return;
      if (!/\.pptx$/i.test(f.name)) { toast('.pptx fájlt várok (a régi .ppt formátumot nem tudom megnyitni).', { kind: 'error' }); return; }
      var target = up || {};
      setUp({ file: f, title: target.replace ? target.replace.title : '', meta: null, busy: true, msg: 'A diák beolvasása…',
        lecture: target.lecture || null, replace: target.replace || null, orig: f.size });
      // a tárhely 50 MB-ot enged fájlonként: a nagyobb diasorok képeit feltöltés előtt tömörítjük
      var prep = f.size > SLIM_TRIGGER
        ? (setUp(function (u) { return u ? Object.assign({}, u, { msg: 'Nagy fájl (' + fmtMB(f.size) + ') — tömörítés…' }) : u; }),
           slimPptx(f, function (m) { setUp(function (u) { return u ? Object.assign({}, u, { msg: m }) : u; }); })
             .then(function (res) {
               var use = res.after < f.size * 0.95 ? new File([res.blob], f.name, { type: f.type }) : f;
               setUp(function (u) { return u ? Object.assign({}, u, { file: use, slim: res, msg: 'A diák beolvasása…' }) : u; });
               return use;
             }, function () { return f; }))
        : Promise.resolve(f);
      prep.then(function (use) { return use.arrayBuffer(); }).then(function (buf) { return parsePptx(buf); }).then(function (meta) {
        var first = meta[0] && meta[0].title;
        setUp(function (u) {
          if (!u) return u;
          return Object.assign({}, u, { meta: meta, busy: false, msg: '',
            title: u.replace ? u.replace.title : (first ? String(first).slice(0, 200) : f.name.replace(/\.pptx$/i, '')) });
        });
      }, function (err) { setUp(null); toast('A fájl nem olvasható: ' + ((err && err.message) || err), { kind: 'error' }); });
    }
    function startUpload(lecture, replaceDeck) {
      setUp({ file: null, meta: null, busy: false, msg: '', lecture: lecture || null, replace: replaceDeck || null });
      setTimeout(function () { fileRef.current && fileRef.current.click(); }, 0);
    }
    function upload() {
      if (!up || up.busy || !up.meta || !up.file) return;
      if (up.file.size > MAX_DECK) {
        toast('A fájl tömörítve is ' + fmtMB(up.file.size) + ' — a tárhely fájlonként 50 MB-ot enged. '
          + 'Tipp: PowerPointban Fájl → Tömörítés (képek és média), vagy bontsd szét alkalmakra.', { kind: 'error' });
        return;
      }
      var id = up.replace ? up.replace.id : uuid();
      var path = course.id + '/' + props.meId + '/decks/' + uuid() + '.pptx';
      setUp(function (u) { return Object.assign({}, u, { busy: true, msg: 'Feltöltés…' }); });
      sb.storage.from('course-media').upload(path, up.file, { upsert: false }).then(function (r) {
        if (r && r.error) { setUp(function (u) { return Object.assign({}, u, { busy: false, msg: '' }); }); toast('A feltöltés nem sikerült: ' + r.error.message, { kind: 'error' }); return; }
        var row = { title: (up.title || 'Előadás').trim().slice(0, 200), storage_path: path, file_size: up.file.size,
          slide_count: up.meta.length, slide_titles: up.meta.map(function (s) { return s.title; }) };
        var q = up.replace
          ? sb.from('course_decks').update(Object.assign({ updated_at: new Date().toISOString() }, row)).eq('id', id).select('*').maybeSingle()
          : sb.from('course_decks').insert(Object.assign({ id: id, course_id: course.id, created_by: props.meId,
              lecture_id: up.lecture ? up.lecture.id : null }, row)).select('*').maybeSingle();
        q.then(function (r2) {
          if (r2 && r2.error) { setUp(function (u) { return Object.assign({}, u, { busy: false, msg: '' }); }); toast('Nem sikerült menteni: ' + r2.error.message, { kind: 'error' }); return; }
          if (up.replace && up.replace.storage_path) sb.storage.from('course-media').remove([up.replace.storage_path]);
          delete bufCache[id];
          setUp(null); toast(up.replace ? '✓ A diasor frissítve' : '✓ Diasor feltöltve', { kind: 'ok' }); load();
        });
      });
    }
    function del(d) {
      confirmBox('Törlöd a diasort?', '„' + d.title + '” és a hozzá tartozó szavazások törlődnek. A korábbi élő alkalmak eredményei is elvesznek.', 'Törlés', true).then(function (ok) {
        if (!ok) return;
        sb.from('course_decks').delete().eq('id', d.id).then(function (r) {
          if (r && r.error) { toast('Nem sikerült: ' + r.error.message, { kind: 'error' }); return; }
          sb.storage.from('course-media').remove([d.storage_path]); delete bufCache[d.id]; load();
        });
      });
    }
    function askReplace(d) {
      var polls = pollCounts[d.id] || 0;
      confirmBox('Frissíted a diasort?', 'Az új fájl lecseréli a mostanit — a szavazások, a korábbi alkalmak és a linkek megmaradnak.'
        + (polls ? ' Figyelem: ' + polls + ' szavazás dia-sorszámhoz van kötve, ezért ha a diák sorrendje változik, nézd át őket.' : ''),
        'Fájl kiválasztása', false).then(function (ok) { if (ok) startUpload(null, d); });
    }

    if (schemaErr === 'missing') return h('div', { className: 'soon' }, h('b', null, 'Az élő előadás funkció még nincs bekapcsolva az adatbázisban. '), 'Az adminisztrátornak le kell futtatnia a ', h('code', null, 'backend/migration-117-course-live.sql'), ' fájlt a Supabase SQL-szerkesztőjében.');
    if (decks === null) return h('div', { className: 'soon' }, 'Betöltés…');

    var byLecture = {};
    decks.forEach(function (d) { (byLecture[d.lecture_id || '-'] || (byLecture[d.lecture_id || '-'] = [])).push(d); });
    var loose = byLecture['-'] || [];

    function deckCard(d, lecture) {
      return h('div', { key: d.id, className: 'co-card cl-deck' },
        h('div', { className: 'cl-deck-t' }, d.title),
        h('div', { className: 'cl-deck-m' }, d.slide_count + ' dia',
          isInstr ? ' · ' + (pollCounts[d.id] || 0) + ' szavazás' : '',
          ' · ' + fmtDate(d.updated_at || d.created_at),
          (d.updated_at && d.updated_at !== d.created_at) ? ' · frissítve' : ''),
        (d.slide_titles || []).length ? h('div', { className: 'cl-deck-first' }, d.slide_titles[0]) : null,
        h('div', { className: 'cl-deck-a' },
          isInstr ? h('button', { type: 'button', className: 'btn pri sm', onClick: function () { props.onPresent(d); } }, '▶ Élő vetítés') : null,
          isInstr ? h('button', { type: 'button', className: 'btn sm', onClick: function () { props.onEdit(d); } }, '🗳 Szavazások') : null,
          h('button', { type: 'button', className: 'btn sm', onClick: function () { props.onBrowse(d); } }, '👁 Megnézem'),
          isInstr ? h('button', { type: 'button', className: 'btn sm', onClick: function () { askReplace(d); } }, '⟳ Frissítés') : null,
          h('span', { className: 'sp' }),
          (isInstr && !lecture && lectures.length) ? h('select', { className: 'in sm', value: '', 'aria-label': 'Előadáshoz rendelés',
            onChange: function (e) { if (e.target.value) attach(d, e.target.value); } },
            h('option', { value: '' }, 'Előadáshoz…'),
            lectures.map(function (l) { return h('option', { key: l.id, value: l.id }, l.ord + '. ' + l.title); })) : null,
          (isInstr && lecture) ? h('button', { type: 'button', className: 'btn sm', title: 'Leválasztás az előadásról', onClick: function () { attach(d, null); } }, '⇱') : null,
          isInstr ? h('button', { type: 'button', className: 'btn sm danger', 'aria-label': 'Diasor törlése', onClick: function () { del(d); } }, '🗑') : null));
    }

    return h('div', { className: 'cl-decks' },
      h('div', { className: 'cl-decks-h' },
        h('div', null, h('h3', null, '🎞 Előadások'),
          h('p', { className: 'co-note' }, isInstr
            ? 'Hozz létre alkalmakat, és tölts fel hozzájuk egy-egy diasort. A meglévő diasort bármikor frissítheted — a szavazások és a korábbi alkalmak megmaradnak.'
            : 'Az alkalmak és a hozzájuk tartozó diák. Élő előadáskor fent megjelenik a csatlakozás gomb.')),
        h('span', { className: 'sp' }),
        isInstr ? h('button', { type: 'button', className: 'btn pri', onClick: function () { setNewLec({ title: '', held_at: '' }); } }, '＋ Új előadás') : null,
        isInstr ? h('button', { type: 'button', className: 'btn', disabled: !!up, onClick: function () { startUpload(null, null); } }, '⬆ Diasor feltöltése') : null,
        h('input', { ref: fileRef, type: 'file', accept: '.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation', style: { display: 'none' }, onChange: pick })),

      newLec ? h('div', { className: 'co-card cl-newlec' },
        h('b', null, '＋ Új előadás'),
        h('div', { className: 'cl-newlec-row' },
          h('input', { className: 'in', autoFocus: true, value: newLec.title, maxLength: 200, placeholder: 'Az alkalom címe — pl. 2. alkalom: Gépi tanulás alapjai',
            onChange: function (e) { var v = e.target.value; setNewLec(function (s) { return Object.assign({}, s, { title: v }); }); },
            onKeyDown: function (e) { if (e.key === 'Enter') createLecture(); } }),
          h('input', { className: 'in sm', type: 'date', value: newLec.held_at || '', 'aria-label': 'Az alkalom napja',
            onChange: function (e) { var v = e.target.value; setNewLec(function (s) { return Object.assign({}, s, { held_at: v }); }); } }),
          h('button', { type: 'button', className: 'btn', onClick: function () { setNewLec(null); } }, 'Mégse'),
          h('button', { type: 'button', className: 'btn pri', onClick: createLecture }, 'Létrehozom'))) : null,

      up ? h('div', { className: 'co-card cl-upload' },
        h('b', null, up.replace ? '⟳ Diasor frissítése — ' + up.replace.title : (up.lecture ? '⬆ Diasor a(z) „' + up.lecture.title + '” előadáshoz' : '⬆ Új diasor')),
        up.file ? h('p', { className: 'co-note' }, up.file.name + ' · ' + fmtMB(up.file.size)) : h('p', { className: 'co-note' }, 'Válaszd ki a .pptx fájlt.'),
        up.slim ? h('p', { className: 'cl-slim' + (up.file && up.file.size > MAX_DECK ? ' bad' : '') },
          up.slim.after < up.slim.before
            ? '🗜 Tömörítve: ' + fmtMB(up.slim.before) + ' → ' + fmtMB(up.slim.after)
              + ' (' + up.slim.images + ' kép a ' + up.slim.total + '-ból/ből)'
              + (up.slim.mediaCount ? ' · ' + up.slim.mediaCount + ' hang/videó érintetlen (' + fmtMB(up.slim.mediaBytes) + ')' : '')
            : 'A fájlon már nem tudtam érdemben tömöríteni.',
          (up.file && up.file.size > MAX_DECK)
            ? ' — ez még mindig több a megengedett 50 MB-nál. Tömörítsd PowerPointban (Fájl → Információ → Médiaméret és teljesítmény), vagy bontsd szét alkalmakra.' : '') : null,
        up.meta ? h('div', null,
          h('p', { className: 'co-note' }, up.meta.length + ' dia · ' + up.meta.filter(function (s) { return s.notes; }).length + ' dián előadói jegyzet'),
          h('label', { className: 'form-l' }, 'Cím'),
          h('input', { className: 'in', value: up.title, onChange: function (e) { var v = e.target.value; setUp(function (u) { return Object.assign({}, u, { title: v }); }); } })) : null,
        up.msg ? h('p', { className: 'co-note' }, h('span', { className: 'cl-spin' }), ' ' + up.msg) : null,
        h('div', { className: 'cl-form-f' },
          h('button', { type: 'button', className: 'btn', disabled: up.busy && !!up.meta, onClick: function () { setUp(null); } }, 'Mégse'),
          h('button', { type: 'button', className: 'btn pri', disabled: up.busy || !up.meta, onClick: upload }, up.replace ? 'Frissítem' : 'Feltöltés'))) : null,

      lectures.length ? h('div', { className: 'cl-lectures' }, lectures.map(function (l) {
        var mine = byLecture[l.id] || [];
        return h('div', { key: l.id, className: 'cl-lec' + (l.visible ? '' : ' hidden') },
          h('div', { className: 'cl-lec-h' },
            h('span', { className: 'cl-lec-n' }, l.ord + '.'),
            h('b', null, l.title),
            l.held_at ? h('span', { className: 'chip' }, fmtDate(l.held_at).replace(/,.*$/, '')) : null,
            !l.visible ? h('span', { className: 'chip' }, 'rejtve') : null,
            h('span', { className: 'sp' }),
            isInstr ? h('input', { className: 'in sm', type: 'date', value: l.held_at || '', 'aria-label': 'Az alkalom napja',
              onChange: function (e) { setLectureDate(l, e.target.value); } }) : null,
            isInstr ? h('button', { type: 'button', className: 'btn sm', onClick: function () { toggleVisible(l); } }, l.visible ? 'Elrejtem' : 'Láthatóvá teszem') : null,
            isInstr ? h('button', { type: 'button', className: 'btn sm', onClick: function () { renameLecture(l); } }, '✎') : null,
            isInstr ? h('button', { type: 'button', className: 'btn sm danger', onClick: function () { delLecture(l); } }, '🗑') : null),
          mine.length ? h('div', { className: 'cl-deck-grid' }, mine.map(function (d) { return deckCard(d, l); }))
            : h('div', { className: 'cl-lec-empty' },
              h('span', { className: 'co-note' }, 'Ehhez az alkalomhoz még nincs diasor.'),
              isInstr ? h('button', { type: 'button', className: 'btn pri sm', disabled: !!up, onClick: function () { startUpload(l, null); } }, '⬆ Diasor feltöltése') : null));
      })) : null,

      loose.length ? h('div', { className: 'cl-loose' },
        lectures.length ? h('div', { className: 'cl-lec-h' }, h('b', null, 'Besorolatlan diasorok'),
          h('span', { className: 'co-note' }, 'rendeld őket egy alkalomhoz')) : null,
        h('div', { className: 'cl-deck-grid' }, loose.map(function (d) { return deckCard(d, null); }))) : null,

      (!lectures.length && !loose.length) ? h('div', { className: 'soon' }, isInstr
        ? 'Még nincs előadás. Hozd létre az elsőt a „＋ Új előadás” gombbal, majd tölts fel hozzá egy diasort.'
        : 'Még nincs feltöltött előadás.') : null);
  }

  // ---------- slide rail ----------
  function SlideRail(props) {
    var titles = props.titles || [], n = props.count || titles.length;
    var items = []; for (var i = 1; i <= n; i++) items.push(i);
    var curRef = useRef(null);
    useEffect(function () { try { curRef.current && curRef.current.scrollIntoView({ block: 'nearest' }); } catch (e) { } }, [props.slide]);
    return h('div', { className: 'cl-rail', role: 'listbox', 'aria-label': 'Diák' }, items.map(function (i) {
      var on = i === props.slide, cnt = props.badges && props.badges[i];
      return h('button', { key: i, ref: on ? curRef : null, type: 'button', role: 'option', 'aria-selected': on ? 'true' : 'false', className: 'cl-rail-i' + (on ? ' on' : '') + (props.live === i ? ' live' : ''), onClick: function () { props.onPick(i); } },
        h('span', { className: 'n' }, i), h('span', { className: 't' }, titles[i - 1] || ('Dia ' + i)),
        cnt ? h('span', { className: 'b' }, '🗳 ' + cnt) : null,
        props.live === i ? h('span', { className: 'lv' }, 'élő') : null);
    }));
  }
  function useDeck(deck) {
    var bS = useState(null), buf = bS[0], setBuf = bS[1];
    var eS = useState(''), err = eS[0], setErr = eS[1];
    var mS = useState(null), meta = mS[0], setMeta = mS[1];
    useEffect(function () {
      var alive = true; setBuf(null); setErr(''); setMeta(null);
      loadDeckBuf(deck).then(function (b) {
        if (!alive) return; setBuf(b);
        parsePptx(b, deck.id).then(function (m) { if (alive) setMeta(m); }, function () { });
      }, function (e) { if (alive) setErr((e && e.message) || String(e)); });
      return function () { alive = false; };
    }, [deck.id]);
    return { buf: buf, err: err, meta: meta };
  }
  function keyNav(onPrev, onNext) {
    return function (e) {
      var t = e.target && e.target.tagName;
      if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || (e.target && e.target.isContentEditable)) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); onNext(); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); onPrev(); }
    };
  }

  // ---------- poll editor (per slide) ----------
  function DeckEditor(props) {
    var deck = props.deck, course = props.course;
    var D = useDeck(deck);
    var sS = useState(1), slide = sS[0], setSlide = sS[1];
    var pS = useState([]), polls = pS[0], setPolls = pS[1];
    var fS = useState(null), form = fS[0], setForm = fS[1];     // null | {poll?}
    var count = deck.slide_count || (deck.slide_titles || []).length;
    function load() { sb.from('course_slide_polls').select('*').eq('deck_id', deck.id).order('slide_no').order('ord').then(function (r) { setPolls((r && r.data) || []); }); }
    useEffect(function () { load(); }, [deck.id]);
    function go(n) { setSlide(Math.max(1, Math.min(count, n))); setForm(null); }
    useEffect(function () { var f = keyNav(function () { go(slide - 1); }, function () { go(slide + 1); }); window.addEventListener('keydown', f); return function () { window.removeEventListener('keydown', f); }; });
    var here = polls.filter(function (p) { return p.slide_no === slide; }), badges = {};
    polls.forEach(function (p) { badges[p.slide_no] = (badges[p.slide_no] || 0) + 1; });
    function save(row) {
      var q = form && form.poll
        ? sb.from('course_slide_polls').update(Object.assign({ updated_at: new Date().toISOString() }, row)).eq('id', form.poll.id)
        : sb.from('course_slide_polls').insert(Object.assign({ course_id: course.id, deck_id: deck.id, slide_no: slide, ord: here.length + 1 }, row));
      q.then(function (r) { if (r && r.error) { toast('Nem sikerült menteni: ' + r.error.message, { kind: 'error' }); return; } toast('✓ Szavazás mentve', { kind: 'ok' }); setForm(null); load(); });
    }
    function del(p) { confirmBox('Törlöd a szavazást?', p.question, 'Törlés', true).then(function (ok) { if (ok) sb.from('course_slide_polls').delete().eq('id', p.id).then(function () { load(); }); }); }
    var notes = D.meta && D.meta[slide - 1] ? D.meta[slide - 1].notes : '';
    return h('div', { className: 'cl-editor' },
      h('div', { className: 'cl-bar-top' },
        h('button', { type: 'button', className: 'btn sm', onClick: props.onClose }, '‹ Előadások'),
        h('b', null, deck.title), h('span', { className: 'chip' }, '🗳 Szavazások szerkesztése'),
        h('span', { className: 'sp' }),
        h('button', { type: 'button', className: 'btn pri sm', onClick: function () { props.onPresent(deck); } }, '▶ Élő vetítés')),
      h('div', { className: 'cl-3col' },
        h(SlideRail, { titles: deck.slide_titles, count: count, slide: slide, badges: badges, onPick: go }),
        h('div', { className: 'cl-center' },
          D.err ? h('div', { className: 'soon' }, 'A diasor nem tölthető le: ' + D.err) : h(SlideStage, { buf: D.buf, slide: slide }),
          h('div', { className: 'cl-nav' },
            h('button', { type: 'button', className: 'btn', disabled: slide <= 1, onClick: function () { go(slide - 1); } }, '‹ Előző'),
            h('span', { className: 'cl-nav-n' }, slide + ' / ' + count),
            h('button', { type: 'button', className: 'btn', disabled: slide >= count, onClick: function () { go(slide + 1); } }, 'Következő ›')),
          notes ? h('div', { className: 'co-card cl-notes' }, h('b', null, 'Előadói jegyzet'), h('div', null, notes)) : null),
        h('div', { className: 'cl-side' },
          h('div', { className: 'co-card' },
            h('div', { className: 'cl-side-h' }, h('b', null, slide + '. dia szavazásai'), h('span', { className: 'chip' }, here.length)),
            here.map(function (p) {
              return h('div', { key: p.id, className: 'cl-poll-i' },
                h('div', { className: 'cl-poll-t' }, h('span', null, (TYPE_BY[p.type] || {}).ic), h('b', null, p.question)),
                h('div', { className: 'cl-poll-m' }, (TYPE_BY[p.type] || {}).t + (p.options && p.options.length ? ' · ' + p.options.length + ' válasz' : '') + (p.type === 'quiz' && p.settings && p.settings.correct != null ? ' · helyes: ' + String.fromCharCode(65 + p.settings.correct) : '')),
                h('div', { className: 'cl-poll-a' },
                  h('button', { type: 'button', className: 'btn sm', onClick: function () { setForm({ poll: p }); } }, 'Szerkesztés'),
                  h('button', { type: 'button', className: 'btn sm danger', onClick: function () { del(p); } }, 'Törlés')));
            }),
            form ? h(PollForm, { key: form.poll ? form.poll.id : 'new-' + slide, poll: form.poll, onSave: save, onCancel: function () { setForm(null); } })
              : h('button', { type: 'button', className: 'btn pri', style: { width: '100%', justifyContent: 'center' }, onClick: function () { setForm({}); } }, '+ Szavazás ehhez a diához')))));
  }

  // ---------- presenter (lecturer, live) ----------
  function PresenterView(props) {
    var course = props.course, deck = props.deck, meId = props.meId;
    var sessS = useState(props.session), session = sessS[0], setSession = sessS[1];
    var D = useDeck(deck);
    var count = deck.slide_count || (deck.slide_titles || []).length;
    var slS = useState(props.session.current_slide || 1), slide = slS[0], setSlide = slS[1];
    var pS = useState([]), polls = pS[0], setPolls = pS[1];
    var rS = useState([]), runs = rS[0], setRuns = rS[1];
    var resS = useState({}), results = resS[0], setResults = resS[1];
    var fS = useState(false), adhoc = fS[0], setAdhoc = fS[1];
    var prS = useState(false), projector = prS[0], setProjector = prS[1];
    var stageBox = useRef(null), saveT = useRef(null);
    var live = useLiveChannel(session.id, meId, 'lecturer', {});
    function loadRuns() { return sb.from('course_poll_runs').select('*').eq('session_id', session.id).order('opened_at').then(function (r) { setRuns((r && r.data) || []); return (r && r.data) || []; }); }
    useEffect(function () {
      sb.from('course_slide_polls').select('*').eq('deck_id', deck.id).order('slide_no').order('ord').then(function (r) { setPolls((r && r.data) || []); });
      loadRuns();
    }, [session.id]);
    function go(n) {
      n = Math.max(1, Math.min(count, n)); if (n === slide) return;
      setSlide(n); setAdhoc(false);
      live.send('slide', { n: n });
      clearTimeout(saveT.current);
      saveT.current = setTimeout(function () { sb.from('course_live_sessions').update({ current_slide: n, updated_at: new Date().toISOString() }).eq('id', session.id).then(function () { }, function () { }); }, 250);
    }
    useEffect(function () { var f = keyNav(function () { go(slide - 1); }, function () { go(slide + 1); }); window.addEventListener('keydown', f); return function () { window.removeEventListener('keydown', f); }; });
    // live results for open / shown runs of this session
    useEffect(function () {
      var alive = true;
      function tick() {
        var watch = runs.filter(function (r) { return r.status === 'open' || r.show_results; });
        watch.forEach(function (r) { sb.rpc('course_poll_results', { p_run: r.id }).then(function (x) { if (alive && x && !x.error) setResults(function (m) { var n = Object.assign({}, m); n[r.id] = x.data; return n; }); }); });
      }
      tick(); var iv = setInterval(tick, 2000);
      return function () { alive = false; clearInterval(iv); };
    }, [runs]);
    function launch(src, slideNo) {
      var row = { session_id: session.id, course_id: course.id, poll_id: src.id || null, slide_no: slideNo || slide, type: src.type, question: src.question, options: src.options || [], settings: studentSettings(src) };
      // one open poll at a time keeps the students' screen simple: close whatever is still open
      var open = runs.filter(function (r) { return r.status === 'open'; }).map(function (r) { return r.id; });
      (open.length ? sb.from('course_poll_runs').update({ status: 'closed', closed_at: new Date().toISOString() }).in('id', open) : Promise.resolve()).then(function () {
        return sb.from('course_poll_runs').insert(row).select('*').maybeSingle();
      }).then(function (r) {
        if (r && r.error) { toast('Nem sikerült elindítani: ' + r.error.message, { kind: 'error' }); return; }
        setAdhoc(false); loadRuns().then(function () { live.send('poll', { run: r.data.id }); });
      });
    }
    function patchRun(run, patch, msg) {
      sb.from('course_poll_runs').update(patch).eq('id', run.id).then(function (r) {
        if (r && r.error) { toast('Nem sikerült: ' + r.error.message, { kind: 'error' }); return; }
        if (msg) toast(msg, { kind: 'ok' });
        loadRuns().then(function () { live.send('poll', { run: run.id }); });
      });
    }
    function end() {
      confirmBox('Befejezed az élő előadást?', 'A hallgatók értesítést kapnak; a diák és az eredmények megmaradnak.', 'Befejezés', false).then(function (ok) {
        if (!ok) return;
        var open = runs.filter(function (r) { return r.status === 'open'; }).map(function (r) { return r.id; });
        (open.length ? sb.from('course_poll_runs').update({ status: 'closed', closed_at: new Date().toISOString() }).in('id', open) : Promise.resolve()).then(function () {
          return sb.from('course_live_sessions').update({ status: 'ended', ended_at: new Date().toISOString(), current_slide: slide }).eq('id', session.id);
        }).then(function (r) {
          if (r && r.error) { toast('Nem sikerült: ' + r.error.message, { kind: 'error' }); return; }
          live.send('end', {}); announce(course.id, 'end', { session: session.id });
          toast('✓ Az előadás véget ért', { kind: 'ok' }); props.onEnd();
        });
      });
    }
    function toggleProjector() {
      var next = !projector; setProjector(next);
      try { if (next && stageBox.current && stageBox.current.requestFullscreen) stageBox.current.requestFullscreen(); else if (!next && document.fullscreenElement) document.exitFullscreen(); } catch (e) { }
    }
    useEffect(function () { function f() { if (!document.fullscreenElement) setProjector(false); } document.addEventListener('fullscreenchange', f); return function () { document.removeEventListener('fullscreenchange', f); }; }, []);
    var here = polls.filter(function (p) { return p.slide_no === slide; });
    var openRun = runs.filter(function (r) { return r.status === 'open'; }).slice(-1)[0];
    var shownRun = openRun || runs.filter(function (r) { return r.show_results && r.slide_no === slide; }).slice(-1)[0];
    var notes = D.meta && D.meta[slide - 1] ? D.meta[slide - 1].notes : '';
    var badges = {}; polls.forEach(function (p) { badges[p.slide_no] = (badges[p.slide_no] || 0) + 1; });
    function runCard(run) {
      var res = results[run.id], tmpl = polls.filter(function (p) { return p.id === run.poll_id; })[0];
      return h('div', { key: run.id, className: 'cl-run' + (run.status === 'open' ? ' open' : '') },
        h('div', { className: 'cl-poll-t' }, h('span', null, (TYPE_BY[run.type] || {}).ic), h('b', null, run.question)),
        h('div', { className: 'cl-poll-m' }, run.status === 'open' ? h('span', { className: 'chip ok' }, '● nyitva') : h('span', { className: 'chip' }, 'lezárva'), ' ', run.show_results ? h('span', { className: 'chip acc' }, 'eredmény látható') : null, ' ', (res ? res.total : 0) + ' válasz'),
        h(PollResults, { run: run, res: res }),
        h('div', { className: 'cl-poll-a' },
          run.status === 'open' ? h('button', { type: 'button', className: 'btn sm', onClick: function () { patchRun(run, { status: 'closed', closed_at: new Date().toISOString() }, 'Szavazás lezárva'); } }, '■ Lezárás') : null,
          !run.show_results ? h('button', { type: 'button', className: 'btn sm', onClick: function () { patchRun(run, { show_results: true }, 'Az eredmény látható a hallgatóknak'); } }, '📊 Eredmény mutatása') : h('button', { type: 'button', className: 'btn sm', onClick: function () { patchRun(run, { show_results: false }); } }, 'Eredmény elrejtése'),
          (run.type === 'quiz' && !run.correct && tmpl && tmpl.settings && tmpl.settings.correct != null) ? h('button', { type: 'button', className: 'btn sm pri', onClick: function () { patchRun(run, { correct: { choice: tmpl.settings.correct }, show_results: true, status: 'closed', closed_at: run.closed_at || new Date().toISOString() }, 'Helyes válasz felfedve'); } }, '🏆 Helyes válasz felfedése') : null));
    }
    return h('div', { className: 'cl-presenter' },
      h('div', { className: 'cl-bar-top' },
        h('span', { className: 'cl-live-dot', 'aria-hidden': 'true' }), h('b', null, 'ÉLŐ'),
        h('b', { className: 'cl-title' }, deck.title),
        h('span', { className: 'chip' }, '👥 ' + live.audience + ' hallgató figyel'),
        h('span', { className: 'sp' }),
        h('button', { type: 'button', className: 'btn sm', onClick: toggleProjector, title: 'Teljes képernyős vetítés (Esc: kilépés)' }, '⛶ Vetítő mód'),
        h('button', { type: 'button', className: 'btn sm', onClick: props.onExit, title: 'A vetítés fut tovább; bármikor visszatérhetsz' }, '‹ Kilépés a vetítőből'),
        h('button', { type: 'button', className: 'btn sm danger', onClick: end }, '■ Előadás befejezése')),
      h('div', { className: 'cl-pgrid' },
        h(SlideRail, { titles: deck.slide_titles, count: count, slide: slide, badges: badges, onPick: go }),
        h('div', { className: 'cl-center' },
          h('div', { ref: stageBox, className: 'cl-projbox' + (projector ? ' on' : '') },
            D.err ? h('div', { className: 'soon' }, 'A diasor nem tölthető le: ' + D.err) : h(SlideStage, { buf: D.buf, slide: slide, contain: projector },
              (projector && shownRun) ? h('div', { className: 'cl-overlay' }, h('div', { className: 'cl-ov-q' }, shownRun.question), shownRun.show_results ? h(PollResults, { run: shownRun, res: results[shownRun.id], big: true }) : h('div', { className: 'cl-ov-hint' }, 'Szavazz a saját gépeden a Kurzus oldalon · ' + ((results[shownRun.id] || {}).total || 0) + ' válasz')) : null),
            projector ? h('div', { className: 'cl-proj-nav' }, h('button', { type: 'button', onClick: function () { go(slide - 1); }, 'aria-label': 'Előző dia' }, '‹'), h('span', null, slide + ' / ' + count), h('button', { type: 'button', onClick: function () { go(slide + 1); }, 'aria-label': 'Következő dia' }, '›')) : null),
          h('div', { className: 'cl-nav' },
            h('button', { type: 'button', className: 'btn', disabled: slide <= 1, onClick: function () { go(slide - 1); } }, '‹ Előző'),
            h('span', { className: 'cl-nav-n' }, slide + ' / ' + count),
            h('button', { type: 'button', className: 'btn pri', disabled: slide >= count, onClick: function () { go(slide + 1); } }, 'Következő ›')),
          notes ? h('div', { className: 'co-card cl-notes' }, h('b', null, 'Előadói jegyzet'), h('div', null, notes)) : null),
        h('div', { className: 'cl-side' },
          h('div', { className: 'co-card' },
            h('div', { className: 'cl-side-h' }, h('b', null, 'Szavazás ezen a dián')),
            here.length ? here.map(function (p) {
              var launched = runs.filter(function (r) { return r.poll_id === p.id; }).slice(-1)[0];
              return h('div', { key: p.id, className: 'cl-poll-i' },
                h('div', { className: 'cl-poll-t' }, h('span', null, (TYPE_BY[p.type] || {}).ic), h('b', null, p.question)),
                h('div', { className: 'cl-poll-a' }, h('button', { type: 'button', className: 'btn pri sm', onClick: function () { launch(p); } }, launched ? '↻ Újraindítás' : '▶ Indítás')));
            }) : h('p', { className: 'co-note' }, 'Ehhez a diához nincs előkészített szavazás.'),
            adhoc ? h(PollForm, { onSave: function (row) { launch(row); }, onCancel: function () { setAdhoc(false); }, saveLabel: '▶ Indítás most' })
              : h('button', { type: 'button', className: 'btn sm', onClick: function () { setAdhoc(true); } }, '⚡ Gyors szavazás most')),
          runs.length ? h('div', { className: 'cl-runs' }, runs.slice().reverse().map(runCard)) : null)));
  }

  // ---------- student live view ----------
  function LiveStudentView(props) {
    var course = props.course, deck = props.deck, meId = props.meId;
    var D = useDeck(deck);
    var count = deck.slide_count || (deck.slide_titles || []).length;
    var lS = useState(props.session.current_slide || 1), liveSlide = lS[0], setLiveSlide = lS[1];
    var vS = useState(props.session.current_slide || 1), view = vS[0], setView = vS[1];
    var fS = useState(true), following = fS[0], setFollowing = fS[1];
    var eS = useState(props.session.status === 'ended'), ended = eS[0], setEnded = eS[1];
    var rS = useState([]), runs = rS[0], setRuns = rS[1];
    var mS = useState({}), mine = mS[0], setMine = mS[1];
    var resS = useState({}), results = resS[0], setResults = resS[1];
    var followRef = useRef(true); followRef.current = following;
    var sid = props.session.id;
    function loadRuns() {
      return sb.from('course_poll_runs').select('*').eq('session_id', sid).order('opened_at').then(function (r) {
        var list = (r && r.data) || []; setRuns(list);
        var ids = list.map(function (x) { return x.id; });
        if (ids.length) sb.from('course_poll_answers').select('run_id,answer').in('run_id', ids).eq('user_id', meId).then(function (a) {
          var m = {}; ((a && a.data) || []).forEach(function (x) { m[x.run_id] = x; }); setMine(m);
        });
        list.filter(function (x) { return x.show_results; }).forEach(function (x) {
          sb.rpc('course_poll_results', { p_run: x.id }).then(function (res) { if (res && !res.error) setResults(function (m0) { var n = Object.assign({}, m0); n[x.id] = res.data; return n; }); });
        });
        return list;
      });
    }
    function onLive(n) { setLiveSlide(n); if (followRef.current) setView(n); }
    var live = useLiveChannel(sid, meId, 'student', {
      slide: function (p) { if (p && p.n) onLive(+p.n); },
      poll: function () { loadRuns(); },
      end: function () { setEnded(true); loadRuns(); }
    });
    useEffect(function () {   // fallback sync for missed broadcasts + late joiners
      loadRuns();
      var iv = setInterval(function () {
        sb.from('course_live_sessions').select('current_slide,status').eq('id', sid).maybeSingle().then(function (r) {
          var s = r && r.data; if (!s) return;
          if (s.status === 'ended') setEnded(true);
          onLive(s.current_slide);
        });
        loadRuns();
      }, 8000);
      return function () { clearInterval(iv); };
    }, [sid]);
    useEffect(function () {   // attendance heartbeat (the server measures the time)
      if (ended) return;
      function ping() { sb.rpc('course_session_ping', { p_session: sid, p_slide: view }).then(function () { }, function () { }); }
      ping(); var iv = setInterval(ping, 30000);
      return function () { clearInterval(iv); };
    }, [sid, ended, view]);
    function go(n) { n = Math.max(1, Math.min(count, n)); setView(n); setFollowing(n === liveSlide); }
    function backToLive() { setFollowing(true); setView(liveSlide); }
    useEffect(function () { var f = keyNav(function () { go(view - 1); }, function () { go(view + 1); }); window.addEventListener('keydown', f); return function () { window.removeEventListener('keydown', f); }; });
    var openRuns = runs.filter(function (r) { return r.status === 'open'; });
    var shown = runs.filter(function (r) { return r.status !== 'open' && r.show_results; }).slice(-2).reverse();
    return h('div', { className: 'cl-student' },
      h('div', { className: 'cl-bar-top' },
        ended ? h('span', { className: 'chip' }, 'Az előadás véget ért') : h('span', null, h('span', { className: 'cl-live-dot', 'aria-hidden': 'true' }), h('b', null, ' ÉLŐ')),
        h('b', { className: 'cl-title' }, deck.title),
        h('span', { className: 'sp' }),
        h('button', { type: 'button', className: 'btn sm', onClick: props.onLeave }, '‹ Kilépés')),
      (!ended && !following) ? h('div', { className: 'cl-follow' }, h('span', null, 'Saját tempóban nézed a diákat — az előadó a ', h('b', null, liveSlide + '.'), ' dián tart.'), h('button', { type: 'button', className: 'btn pri sm', onClick: backToLive }, '↩ Vissza az élő diához')) : null,
      h('div', { className: 'cl-sgrid' },
        h('div', { className: 'cl-center' },
          D.err ? h('div', { className: 'soon' }, 'A diasor nem tölthető le: ' + D.err) : h(SlideStage, { buf: D.buf, slide: view }),
          h('div', { className: 'cl-nav' },
            h('button', { type: 'button', className: 'btn', disabled: view <= 1, onClick: function () { go(view - 1); } }, '‹ Előző'),
            h('span', { className: 'cl-nav-n' }, view + ' / ' + count + (!ended && view !== liveSlide ? ' · élő: ' + liveSlide : '')),
            h('button', { type: 'button', className: 'btn', disabled: view >= count, onClick: function () { go(view + 1); } }, 'Következő ›'))),
        h('div', { className: 'cl-side' },
          openRuns.length ? openRuns.map(function (run) {
            return h('div', { key: run.id, className: 'co-card cl-live-poll', role: 'region', 'aria-label': 'Szavazás' },
              h('div', { className: 'cl-side-h' }, h('span', { className: 'chip ok' }, '● Szavazás'), h('span', { className: 'cl-hint' }, (TYPE_BY[run.type] || {}).t)),
              h('div', { className: 'cl-q' }, run.question),
              h(AnswerForm, { key: run.id + ':' + (mine[run.id] ? 'a' : 'n'), run: run, mine: mine[run.id], meId: meId, onSent: loadRuns }));
          }) : h('div', { className: 'co-card cl-wait' }, ended ? 'Az előadás véget ért. A diákat továbbra is lapozhatod.' : 'Ha az előadó szavazást indít, itt jelenik meg.'),
          shown.map(function (run) {
            return h('div', { key: run.id, className: 'co-card' }, h('div', { className: 'cl-q' }, run.question), h(PollResults, { run: run, res: results[run.id] }),
              mine[run.id] && run.correct && run.correct.choice != null ? h('div', { className: 'cl-hint' }, (+mine[run.id].answer.choice === +run.correct.choice) ? '🎉 Eltaláltad!' : 'Most nem talált — a helyes válasz: ' + String.fromCharCode(65 + (+run.correct.choice))) : null);
          }))));
  }

  // ---------- self-paced browsing ----------
  function DeckBrowser(props) {
    var deck = props.deck, D = useDeck(deck), count = deck.slide_count || (deck.slide_titles || []).length;
    var sS = useState(1), slide = sS[0], setSlide = sS[1];
    function go(n) { setSlide(Math.max(1, Math.min(count, n))); }
    useEffect(function () { var f = keyNav(function () { go(slide - 1); }, function () { go(slide + 1); }); window.addEventListener('keydown', f); return function () { window.removeEventListener('keydown', f); }; });
    return h('div', { className: 'cl-editor' },
      h('div', { className: 'cl-bar-top' }, h('button', { type: 'button', className: 'btn sm', onClick: props.onClose }, '‹ Előadások'), h('b', null, deck.title)),
      h('div', { className: 'cl-bgrid' },
        h(SlideRail, { titles: deck.slide_titles, count: count, slide: slide, onPick: go }),
        h('div', { className: 'cl-center' },
          D.err ? h('div', { className: 'soon' }, 'A diasor nem tölthető le: ' + D.err) : h(SlideStage, { buf: D.buf, slide: slide }),
          h('div', { className: 'cl-nav' },
            h('button', { type: 'button', className: 'btn', disabled: slide <= 1, onClick: function () { go(slide - 1); } }, '‹ Előző'),
            h('span', { className: 'cl-nav-n' }, slide + ' / ' + count),
            h('button', { type: 'button', className: 'btn', disabled: slide >= count, onClick: function () { go(slide + 1); } }, 'Következő ›')))));
  }

  // ---------- live banner (course header) ----------
  function LiveBanner(props) {
    var course = props.course;
    var sS = useState(null), sess = sS[0], setSess = sS[1];
    function check() {
      sb.from('course_live_sessions').select('*').eq('course_id', course.id).eq('status', 'live').maybeSingle().then(function (r) {
        if (r && r.error) { setSess(null); return; }
        var s = r && r.data; if (!s) { setSess(null); if (props.onLive) props.onLive(null); return; }
        sb.from('course_decks').select('*').eq('id', s.deck_id).maybeSingle().then(function (d) { var v = { session: s, deck: d && d.data }; setSess(v); if (props.onLive) props.onLive(v); });
      });
    }
    useEffect(function () {
      check();
      var iv = setInterval(check, 20000), ch = null;
      if (sb && sb.channel) {
        ch = sb.channel('course-live-index:' + course.id, { config: { broadcast: { self: false } } });
        ch.on('broadcast', { event: 'live' }, check).on('broadcast', { event: 'end' }, check).subscribe();
      }
      return function () { clearInterval(iv); if (ch) try { sb.removeChannel(ch); } catch (e) { } };
    }, [course.id, props.refreshKey]);
    if (!sess || !sess.deck || props.hidden) return null;
    return h('div', { className: 'cl-banner', role: 'status' },
      h('span', { className: 'cl-live-dot', 'aria-hidden': 'true' }),
      h('span', null, h('b', null, 'Élő előadás: '), sess.deck.title, ' · ' + sess.session.current_slide + '. dia'),
      h('span', { className: 'sp' }),
      props.isInstr ? h('button', { type: 'button', className: 'btn pri sm', onClick: function () { props.onPresent(sess.deck, sess.session); } }, '▶ Vissza a vetítőbe')
        : h('button', { type: 'button', className: 'btn pri sm', onClick: function () { props.onJoin(sess.deck, sess.session); } }, 'Csatlakozom'));
  }
  function startSession(course, deck) {
    // a course has one live lecture at a time: end any other first
    return sb.from('course_live_sessions').update({ status: 'ended', ended_at: new Date().toISOString() }).eq('course_id', course.id).eq('status', 'live').then(function () {
      return sb.from('course_live_sessions').insert({ course_id: course.id, deck_id: deck.id, current_slide: 1 }).select('*').maybeSingle();
    }).then(function (r) {
      if (r && r.error) throw r.error;
      announce(course.id, 'live', { session: r.data.id });
      return r.data;
    });
  }

  // ---------- activity report (lecturer) ----------
  function ActivityTab(props) {
    var course = props.course;
    var dS = useState(null), data = dS[0], setData = dS[1];
    useEffect(function () {
      var alive = true;
      Promise.all([
        sb.from('course_live_sessions').select('id,deck_id,status,started_at,ended_at').eq('course_id', course.id).order('started_at', { ascending: false }),
        sb.from('course_decks').select('id,title').eq('course_id', course.id),
        sb.from('course_session_attendance').select('session_id,user_id,active_seconds,slides_seen,last_seen_at').eq('course_id', course.id),
        sb.from('course_poll_runs').select('id,session_id').eq('course_id', course.id),
        sb.from('course_poll_answers').select('run_id,user_id').eq('course_id', course.id),
        sb.from('course_enrollments').select('user_id,role,status').eq('course_id', course.id)
      ]).then(function (res) {
        var err = res.filter(function (x) { return x && x.error; })[0];
        if (err) { if (alive) setData({ err: missingSchema(err.error) ? 'missing' : err.error.message }); return; }
        var ens = (res[5].data || []).filter(function (e) { return e.status !== 'dropped'; });
        var ids = ens.map(function (e) { return e.user_id; });
        return (ids.length ? sb.from('profiles_public').select('id,name').in('id', ids) : Promise.resolve({ data: [] })).then(function (pr) {
          if (!alive) return;
          var names = {}; ((pr && pr.data) || []).forEach(function (p) { names[p.id] = p.name; });
          setData({ sessions: res[0].data || [], decks: res[1].data || [], att: res[2].data || [], runs: res[3].data || [], answers: res[4].data || [], ens: ens, names: names });
        });
      });
      return function () { alive = false; };
    }, [course.id]);
    if (!data) return h('div', { className: 'soon' }, 'Betöltés…');
    if (data.err === 'missing') return h('div', { className: 'soon' }, 'Az aktivitás-kimutatáshoz le kell futtatni a migration-117-et.');
    if (data.err) return h('div', { className: 'soon' }, 'Nem sikerült betölteni: ' + data.err);
    var deckT = {}; data.decks.forEach(function (d) { deckT[d.id] = d.title; });
    var runsBySess = {}; data.runs.forEach(function (r) { (runsBySess[r.session_id] = runsBySess[r.session_id] || []).push(r.id); });
    var runSess = {}; data.runs.forEach(function (r) { runSess[r.id] = r.session_id; });
    var nSess = data.sessions.length;
    var students = data.ens.filter(function (e) { return e.role === 'hallgato'; });
    var rows = students.map(function (e) {
      var att = data.att.filter(function (a) { return a.user_id === e.user_id; });
      var attended = {}; att.forEach(function (a) { attended[a.session_id] = 1; });
      var possible = 0; Object.keys(attended).forEach(function (s) { possible += (runsBySess[s] || []).length; });
      var answered = data.answers.filter(function (a) { return a.user_id === e.user_id; }).length;
      var secs = att.reduce(function (s, a) { return s + (a.active_seconds || 0); }, 0);
      var slides = att.reduce(function (s, a) { return s + ((a.slides_seen || []).length); }, 0);
      var last = att.reduce(function (m, a) { return a.last_seen_at > m ? a.last_seen_at : m; }, '');
      return { id: e.user_id, name: data.names[e.user_id] || 'ismeretlen', sessions: Object.keys(attended).length, minutes: Math.round(secs / 60), slides: slides, answered: answered, possible: possible, rate: possible ? Math.round(answered / possible * 100) : null, last: last };
    }).sort(function (a, b) { return (b.rate == null ? -1 : b.rate) - (a.rate == null ? -1 : a.rate) || b.minutes - a.minutes; });
    function csv() {
      var lines = [['Hallgató', 'Részvétel (alkalom)', 'Összes alkalom', 'Aktív perc', 'Megnézett diák', 'Megválaszolt szavazás', 'Elérhető szavazás', 'Szavazási részvétel %', 'Utoljára aktív']].concat(rows.map(function (r) { return [r.name, r.sessions, nSess, r.minutes, r.slides, r.answered, r.possible, r.rate == null ? '' : r.rate, r.last ? fmtDate(r.last) : '']; }));
      var text = '﻿' + lines.map(function (l) { return l.map(function (c) { var s = String(c); return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(';'); }).join('\n');
      var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' })); a.download = 'aktivitas_' + (course.title || 'kurzus').replace(/[^\wÀ-ž]+/g, '_').slice(0, 40) + '.csv';
      document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    }
    return h('div', { className: 'cl-activity' },
      h('div', { className: 'cl-decks-h' },
        h('div', null, h('h3', null, '📊 Aktivitás az élő előadásokon'), h('p', { className: 'co-note' }, nSess + ' élő alkalom · ' + students.length + ' hallgató. A részvétel azt mutatja, a hallgató a jelen lévő alkalmain elindított szavazások hány százalékára válaszolt. Az aktív időt a szerver méri.')),
        h('span', { className: 'sp' }),
        h('button', { type: 'button', className: 'btn sm', disabled: !rows.length, onClick: csv }, '⬇ CSV')),
      h('div', { className: 'subtable' }, rows.length ? h('table', null,
        h('thead', null, h('tr', null, ['Hallgató', 'Alkalmak', 'Aktív perc', 'Diák', 'Szavazatok', 'Részvétel', 'Utoljára'].map(function (t) { return h('th', { key: t }, t); }))),
        h('tbody', null, rows.map(function (r) {
          return h('tr', { key: r.id },
            h('td', null, h('span', { className: 'stu' }, h('i', null, initials(r.name)), r.name)),
            h('td', null, r.sessions + ' / ' + nSess),
            h('td', null, r.minutes),
            h('td', null, r.slides),
            h('td', null, r.answered + ' / ' + r.possible),
            h('td', null, r.rate == null ? '—' : h('span', { className: 'cl-rate' }, h('i', { style: { width: r.rate + '%' } }), h('b', null, r.rate + '%'))),
            h('td', { className: 'muted' }, r.last ? fmtDate(r.last) : '—'));
        }))) : h('div', { className: 'mem-empty' }, 'Még nincs hallgató a kurzuson.')),
      data.sessions.length ? h('div', { className: 'subtable' }, h('table', null,
        h('thead', null, h('tr', null, ['Alkalom', 'Diasor', 'Jelen volt', 'Szavazás', 'Válasz'].map(function (t) { return h('th', { key: t }, t); }))),
        h('tbody', null, data.sessions.map(function (s) {
          var present = data.att.filter(function (a) { return a.session_id === s.id; }).length, rids = runsBySess[s.id] || [];
          var ans = data.answers.filter(function (a) { return runSess[a.run_id] === s.id; }).length;
          return h('tr', { key: s.id }, h('td', null, fmtDate(s.started_at) + (s.status === 'live' ? ' · 🔴 élő' : '')), h('td', null, deckT[s.deck_id] || '—'), h('td', null, present), h('td', null, rids.length), h('td', null, ans));
        })))) : null);
  }

  window.__slim = slimPptx; window.__parse = parsePptx;   // teszt-horog (harness)
  window.PRCourseLive = { DecksTab: DecksTab, DeckEditor: DeckEditor, DeckBrowser: DeckBrowser, PresenterView: PresenterView, LiveStudentView: LiveStudentView, LiveBanner: LiveBanner, ActivityTab: ActivityTab, startSession: startSession,
    // internals exposed for the test harness only
    _parsePptx: parsePptx, _SlideStage: SlideStage, _PollForm: PollForm, _PollResults: PollResults, _AnswerForm: AnswerForm };
})();
