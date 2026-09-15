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
  function isPdfFile(f) { return /\.pdf$/i.test(f.name || '') || (f.type || '') === 'application/pdf'; }
  // ---- PDF text extraction (pdf.js, lazily loaded from the CDN — no page-level script tag needed) ----
  // Without this an attached paper reached the model as a FILENAME only: readStaged skipped binaries and the
  // chat edge never reads research_files. Extracting here is what makes "attach the PDF" actually work.
  // Postgres/JSON-kompatibilis szöveg. PDF-ből kinyert szövegben rendszeresen van NUL karakter és
  // magányos surrogate (törött font-kódolás, ligatúrák) — mindkettő ELUTASÍTJA az egész mentést:
  //   \u0000        → 22P05 „\u0000 cannot be converted to text"
  //   magányos D800  → PGRST102 „Empty or invalid json"
  // Emiatt bukott el csendben a teljes fájlfeltöltés; a felület csak annyit mondott, hogy „nem sikerült".
  function cleanText(v) {
    var t = String(v == null ? '' : v);
    // gyors út: ha nincs benne se vezérlő, se surrogate, nincs mit tenni
    if (!/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF\uFFFE\uFFFF]/.test(t)) return t;
    t = t.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ');       // vezérlők (tab/újsor marad)
    // Surrogate-ek: az ÉRVÉNYES párok (emoji, ritka írásjelek) maradnak, csak a magányosak esnek ki.
    var out = [], i = 0, n = t.length;
    for (; i < n; i++) {
      var c = t.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF) {
        var d = (i + 1 < n) ? t.charCodeAt(i + 1) : 0;
        if (d >= 0xDC00 && d <= 0xDFFF) { out.push(t.charAt(i), t.charAt(i + 1)); i++; }
        continue;                                                              // magányos magas → el
      }
      if (c >= 0xDC00 && c <= 0xDFFF) continue;                                // magányos alacsony → el
      if (c === 0xFFFE || c === 0xFFFF) continue;
      out.push(t.charAt(i));
    }
    return out.join('');
  }
  var PDF_TEXT_CAP = 200000;   // stored text cap; the conversation seed takes a much smaller excerpt
  function ensurePdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (window._pdfjsLoading) return window._pdfjsLoading;
    window._pdfjsLoading = new Promise(function (res, rej) {
      var sc = document.createElement('script');
      sc.src = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
      sc.onload = function () {
        if (!window.pdfjsLib) { window._pdfjsLoading = null; rej(new Error('A PDF-olvasó nem töltődött be.')); return; }
        try { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js'; } catch (e) { }
        res(window.pdfjsLib);
      };
      sc.onerror = function () { window._pdfjsLoading = null; rej(new Error('A PDF-olvasót nem sikerült betölteni.')); };
      document.head.appendChild(sc);
    });
    return window._pdfjsLoading;
  }
  function pdfTextFromBytes(buf, maxPages) {
    return ensurePdfJs().then(function (lib) { return lib.getDocument({ data: new Uint8Array(buf) }).promise; }).then(function (pdf) {
      var n = Math.min(pdf.numPages, maxPages || 40), text = '', chain = Promise.resolve();
      for (var i = 1; i <= n; i++) (function (k) {
        chain = chain.then(function () { return pdf.getPage(k); }).then(function (pg) { return pg.getTextContent(); })
          .then(function (tc) { text += tc.items.map(function (it) { return it.str; }).join(' ') + '\n'; })
          .catch(function () { });   // one unreadable page must not lose the rest
      })(i);
      return chain.then(function () {
        var full = cleanText(text).replace(/-\s*\n\s*/g, '').replace(/[ \t]+/g, ' ').trim();
        return { text: full.slice(0, PDF_TEXT_CAP), pages: pdf.numPages, read: n, capped: full.length > PDF_TEXT_CAP };
      });
    });
  }
  var PDF_ERR = {
    loader: 'a PDF-olvasó nem töltődött be (hálózati vagy tartalomblokkolási hiba)',
    parse: 'a PDF-et nem sikerült értelmezni (sérült vagy jelszóval védett)',
    read: 'a fájlt nem sikerült beolvasni',
    empty: 'nincs benne szövegréteg (valószínűleg szkennelt / kép alapú)',
    too_large: 'túl nagy a böngészőben történő feldolgozáshoz (40 MB fölött)',
    binary: 'ebből a fájltípusból nem tudok szöveget kinyerni'
  };
  function pdfTextFromFile(f) {
    return new Promise(function (res) {
      var rd = new FileReader();
      rd.onload = function () {
        ensurePdfJs().then(function () {
          return pdfTextFromBytes(rd.result, 40).then(function (r) {
            if (!r || !r.text || r.text.length < 40) { res({ err: 'empty', pages: r && r.pages, read: r && r.read }); return; }
            res(r);
          }, function () { res({ err: 'parse' }); });
        }, function () { res({ err: 'loader' }); });
      };
      rd.onerror = function () { res({ err: 'read' }); };
      rd.readAsArrayBuffer(f);
    });
  }
  function readStaged(fileList) {
    // read text-like files' content (capped); PDFs are text-extracted here so they can serve as real context;
    // other binaries keep name/size only (content extracted later in the workspace)
    var arr = [].slice.call(fileList || []);
    return Promise.all(arr.map(function (f) {
      var base = { name: f.name, size: f.size, mime: f.type || 'application/octet-stream', content: '' };
      if (isPdfFile(f)) {
        base.mime = 'application/pdf';
        if (f.size > 40 * 1024 * 1024) { base.extracted = false; base.skipReason = 'too_large'; return Promise.resolve(base); }
        return pdfTextFromFile(f).then(function (r) {
          if (r && r.text) { base.content = r.text; base.pdfPages = r.pages; base.pdfRead = r.read; base.capped = !!r.capped; base.extracted = true; }
          else { base.extracted = false; base.skipReason = (r && r.err) || 'parse'; base.pdfPages = r && r.pages; }
          return base;
        }, function () { base.extracted = false; base.skipReason = 'parse'; return base; });
      }
      if (!isTextFile(f) || f.size > 400 * 1024) { base.extracted = false; base.skipReason = (isTextFile(f) ? 'too_large' : 'binary'); return Promise.resolve(base); }
      return new Promise(function (res) {
        var rd = new FileReader();
        rd.onload = function () { base.content = cleanText(rd.result).slice(0, 400 * 1024); if (base.mime === 'application/octet-stream') base.mime = 'text/plain'; res(base); };
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
        project_id: pid, path: cleanText(path), content: cleanText(f.content), mime: f.mime || 'text/plain',
        size: f.size || (f.content || '').length, source: 'upload', created_by: u, updated_by: u, updated_at: nowIso()
      }, { onConflict: 'project_id,path' }).then(function (r) { return { name: f.name, size: f.size, path: path, mime: f.mime, ok: !(r && r.error), err: r && r.error && r.error.message }; });
    }));
  }
  // The chat edge reads ONLY the project row + the message history — never research_files. So anything an
  // attachment should contribute has to travel inside a message. Keep it inside the edge's 4000-char task slice.
  var CTX_TOTAL = 3400, CTX_PER_FILE = 2200;
  function stagedContextMsg(staged, lead) {
    var ok = (staged || []).filter(Boolean);
    if (!ok.length) return lead || '';
    var names = ok.map(function (f) { return f.name; }).join(', ');
    var head = (lead || 'Feltöltöttem: ' + names);
    var withText = ok.filter(function (f) { return (f.content || '').trim().length > 40; });
    var unread = ok.filter(function (f) { return !((f.content || '').trim().length > 40); });
    var caveat = unread.length
      ? '\n\n(Amit NEM tudok elolvasni: ' + unread.map(function (f) { return f.name + ' — ' + (PDF_ERR[f.skipReason] || 'ismeretlen ok'); }).join('; ') + '.)'
      : '';
    if (!withText.length) return cleanText(head + caveat);
    var budget = CTX_TOTAL, parts = [];
    withText.forEach(function (f) {
      if (budget <= 200) return;
      var take = Math.min(CTX_PER_FILE, budget);
      var body = String(f.content).slice(0, take);
      budget -= body.length + 60;
      var cov = f.pdfPages ? (' (' + (f.pdfRead && f.pdfRead < f.pdfPages ? 'az első ' + f.pdfRead + ' oldal a(z) ' + f.pdfPages + '-ból' : f.pdfPages + ' oldal') + (f.capped ? ', a szöveg hosszban is vágva' : '') + ')') : '';
      parts.push('--- ' + f.name + cov + ' ---\n' + body + (String(f.content).length > body.length ? '\n…(itt megszakad — a hosszabb szöveg a projekt fájljai között van, de ebben a beszélgetésben csak ez a részlet érhető el)' : ''));
    });
    return cleanText(head + '\n\n' + parts.join('\n\n') + caveat);
  }
  // ===================== KIINDULÁS SAJÁT MTMT-PUBLIKÁCIÓBÓL =====================
  // A felhasználó nem csak fájlt csatolhat: hivatkozhat a saját MTMT-publikációjára. Ilyenkor megpróbáljuk
  // felkutatni az eredeti (nyílt hozzáférésű) PDF-et, kinyerni a szövegét, és ebből indítani a beszélgetést.
  function mtmtGuiUrl(mtid) { return mtid ? 'https://m2.mtmt.hu/gui2/?mode=browse&params=publication;' + mtid : null; }
  function pubAuthors(p) {
    // Nincs strukturált szerzőlista (csak first_author + author_count); a formázott citation elejéből is kinyerhető.
    if (p.first_author) return p.first_author + (p.author_count > 1 ? ' és mtsai (' + p.author_count + ' szerző)' : '');
    var c = String(p.citation || ''); var i = c.indexOf('. ');
    return (i > 0 && i < 120) ? c.slice(0, i) : '';
  }
  function pubRef(p) {
    return [p.title || 'Cím nélkül', p.year ? '(' + p.year + ')' : '', p.journal || '', p.doi ? 'DOI: ' + p.doi : ''].filter(Boolean).join(' · ');
  }
  // Try the resolved candidates in order. A failed download must NEVER be reported as "there is no open-access
  // copy" — that is exactly the bug the Figure Board carries, where any 401/5xx got recorded as no_oa forever.
  function fetchPdfBytes(urls) {
    var list = (urls || []).slice(0, 4);
    if (!list.length) return Promise.resolve(null);
    return sb.auth.getSession().then(function (s) {
      var tok = s && s.data && s.data.session && s.data.session.access_token;
      if (!tok) return null;
      var next = function (i) {
        if (i >= list.length) return Promise.resolve(null);
        return fetch(CFG.supabaseUrl + '/functions/v1/pdf-proxy', {
          method: 'POST', headers: { 'Content-Type': 'application/json', apikey: CFG.supabaseAnonKey, Authorization: 'Bearer ' + tok },
          body: JSON.stringify({ action: 'fetch', url: list[i] })
        }).then(function (r) {
          if (!r.ok) return next(i + 1);                       // landing page / 404 / too large → try the next candidate
          return r.arrayBuffer().then(function (ab) { return ab && ab.byteLength > 1000 ? { buf: ab, url: list[i] } : next(i + 1); });
        }, function () { return next(i + 1); });
      };
      return next(0);
    });
  }
  // Full pipeline for one chosen publication. `onStep` reports progress honestly, including the failure branches.
  function preparePaperStart(pub, onStep) {
    var step = function (t) { try { onStep && onStep(t); } catch (e) { } };
    var out = { pub: pub, pdfText: '', pdfPages: 0, pdfRead: 0, capped: false, pdfUrl: null, abstract: null, why: null, matchedTitle: null, byTitle: false };
    step('Nyílt hozzáférésű PDF keresése…');
    return callEdge('pdf-proxy', { action: 'resolve', doi: pub.doi || '', title: pub.title || '', year: pub.year || undefined })
      .then(function (d) {
        // Only a genuine ok:true answer may be read as "no open-access copy" — an error object must not.
        if (!d || d.error || d.ok !== true) { out.why = 'A PDF-kereső nem válaszolt (' + ((d && d.error) || 'ismeretlen hiba') + ').'; return null; }
        out.abstract = d.abstract || null;
        out.matchedTitle = d.matched_title || null;
        out.byTitle = String(d.source || '').indexOf('title') >= 0 || (!pub.doi && !!d.matched_title);
        var urls = (d.pdf_urls && d.pdf_urls.length) ? d.pdf_urls : (d.pdf_url ? [d.pdf_url] : []);
        if (!urls.length) {
          // The server tells these apart now: a failed lookup is NOT evidence that no open-access copy exists.
          out.why = d.lookup_failed ? 'A keresőszolgáltatás most nem válaszolt — nem tudom, van-e nyilvános PDF.'
            : (pub.doi ? 'Nincs nyilvánosan elérhető (open access) PDF.' : 'Nincs DOI, és cím alapján sem találtam nyilvános PDF-et.');
          return null;
        }
        step('PDF letöltése…');
        return fetchPdfBytes(urls).then(function (got) {
          if (!got) { out.why = 'Találtam PDF-hivatkozást, de a letöltés nem sikerült.'; return null; }
          out.pdfUrl = got.url;
          step('Szöveg kinyerése a PDF-ből…');
          return pdfTextFromBytes(got.buf, 40).then(function (r) {
            if (!r || !r.text || r.text.length < 400) { out.why = 'A letöltött PDF-ben nincs szövegréteg (valószínűleg szkennelt / kép alapú).'; return null; }
            out.pdfText = r.text; out.pdfPages = r.pages; out.pdfRead = r.read; out.capped = !!r.capped; return out;
          }, function () { out.why = 'A PDF-et nem sikerült értelmezni (sérült, védett, vagy nem töltött be az olvasó).'; return null; });
        });
      }, function () { out.why = 'A PDF-kereső nem érhető el.'; return null; })
      .then(function () { return out; });
  }
  // The staged file that carries the paper into the project (visible in the workspace, full text preserved).
  function paperStagedFile(prep) {
    var p = prep.pub;
    var md = '# ' + (p.title || 'Publikáció') + '\n\n'
      + '- **Szerző:** ' + (pubAuthors(p) || '—') + '\n'
      + '- **Év:** ' + (p.year || '—') + '\n'
      + '- **Megjelenés:** ' + (p.journal || '—') + (p.volume ? ', ' + p.volume : '') + (p.issue ? '(' + p.issue + ')' : '') + (p.pages ? ', ' + p.pages : '') + '\n'
      + '- **Típus:** ' + (p.type_hu || p.type || '—') + '\n'
      + (p.doi ? '- **DOI:** https://doi.org/' + p.doi + '\n' : '')
      + (p.mtid ? '- **MTMT:** ' + mtmtGuiUrl(p.mtid) + '\n' : '')
      + (p.citations ? '- **Idézettség:** ' + p.citations + ' (független: ' + (p.indep_citations || 0) + ')\n' : '')
      + '\n> Ez a publikáció az Autopilot-kutatás kiindulási pontja.\n'
      + (prep.abstract ? '\n## Absztrakt\n\n' + prep.abstract + '\n' : '')
      + (prep.byTitle && prep.matchedTitle ? '\n> ⚠ A PDF-et **cím alapján** azonosítottam (nem DOI-val). Talált rekord: _' + prep.matchedTitle + '_ — érdemes ellenőrizni, hogy tényleg ez a cikk.\n' : '')
      + (prep.pdfUrl ? '\n## Forrás-PDF\n\n' + prep.pdfUrl + '\n' : '')
      + (prep.pdfText ? '\n## A cikk kinyert szövege' + (prep.pdfPages ? ' (' + (prep.pdfRead && prep.pdfRead < prep.pdfPages ? 'az első ' + prep.pdfRead + ' oldal a(z) ' + prep.pdfPages + '-ból' : prep.pdfPages + ' oldal') + (prep.capped ? ', hosszban vágva' : '') + ')' : '') + '\n\n' + prep.pdfText + '\n'
        : '\n## A cikk szövege\n\n_Nem sikerült megszerezni: ' + (prep.why || 'ismeretlen ok') + '_\n');
    var name = 'mtmt-' + (p.mtid || (p.id || '').slice(0, 8)) + '.md';   // mtid in the name: 'uploads/'+name is the upsert key
    return { name: name, size: md.length, mime: 'text/markdown', content: md, extracted: !!prep.pdfText };
  }
  // The seed message. The Autopilot chat runs on the multi-agent path, whose synthesiser gets NO instruction
  // about the questions fence — so the format is spelled out here, in the first user message.
  // The chat edge slices the task at 4000 chars. Everything that MUST survive (the instructions, and the
  // "ask me for the PDF" rule) therefore goes BEFORE the article excerpt — truncation may only eat article text.
  var TASK_LIMIT = 4000, SEED_MARGIN = 120;
  function paperSeedMessage(prep, reserved) {
    var p = prep.pub;
    var head = 'Ebből a saját publikációmból szeretnék továbbindulni:\n\n'
      + '**' + (p.title || 'Publikáció') + '**\n'
      + [pubAuthors(p), p.year, p.journal, p.doi ? 'DOI: ' + p.doi : '', p.mtid ? 'MTMT #' + p.mtid : ''].filter(Boolean).join(' · ') + '\n';
    var instr = '\nFeladatod:\n'
      + '1. Foglald össze 3-4 mondatban, mit tett le ez a munka, és hol a folytatás tere.\n'
      + '2. Javasolj 2-3 KONKRÉT továbblépési irányt (mit kutassunk tovább), mindegyiknél egy mondat indoklással.\n'
      + '3. A válasz VÉGÉN kérdezz vissza. A kérdéseket pontosan ebben a formátumban add meg, a válasz legutolsó elemeként:\n'
      + '```publify-questions\n[{"q":"kérdés","options":["opció 1","opció 2"]}]\n```\n';
    if (!prep.pdfText) {
      instr += '4. FONTOS: a legelső kérdésed arra kérjen, hogy töltsem fel a cikk PDF-jét a chat 📎 gombjával, mert enélkül csak a metaadatokból tudsz dolgozni. Példa: {"q":"Fel tudod tölteni a cikk PDF-jét? A 📎 gombbal csatolhatod — enélkül csak a bibliográfiai adatokból és az absztraktból dolgozom.","options":["Feltöltöm most","Nincs meg — dolgozz abból, ami van"]}\n';
    }
    var lead;
    if (prep.pdfText) lead = '\nA cikk szövegéből ennyi fér ide (a teljes kinyert szöveg a projekt fájljai közt van, de EBBEN a beszélgetésben csak az alábbi részlet érhető el):\n\n';
    else if (prep.abstract) lead = '\nAz eredeti PDF nem elérhető (' + (prep.why || '—') + '), de az absztrakt igen:\n\n';
    else lead = '\nAz eredeti PDF-et nem sikerült megszereznem (' + (prep.why || '—') + '), és absztraktot sem találtam — egyelőre csak a bibliográfiai adatok állnak rendelkezésre.\n';
    var fixed = head + instr + lead;
    var room = TASK_LIMIT - SEED_MARGIN - (reserved || 0) - fixed.length;
    var excerpt = '';
    if (room > 250) {
      var src = prep.pdfText || prep.abstract || '';
      if (src) excerpt = src.slice(0, room) + (src.length > room ? '\n…(itt megszakad)' : '');
    }
    return cleanText(fixed + excerpt);
  }
  // Durable context: research-agents passes research_projects.goal UNTRUNCATED into every agent's system prompt
  // on EVERY turn, while the seed message only reaches the model on the first one. Without this the paper fell
  // out of context as soon as the user answered the first clarifying question.
  function paperGoal(prep) {
    var p = prep.pub;
    var src = prep.abstract || prep.pdfText || '';
    return 'Kiindulási publikáció (a kutató sajátja): "' + (p.title || '—') + '" — ' + [pubAuthors(p), p.year, p.journal, p.doi ? 'DOI ' + p.doi : ''].filter(Boolean).join(', ') + '. '
      + 'A kutatás célja: ebből a munkából továbblépni.'
      + (src ? ' A cikk lényege: ' + cleanText(src).slice(0, 2200) : '')
      + (prep.pdfText ? ' (A teljes kinyert szöveg a projekt fájljai közt: uploads/mtmt-' + (p.mtid || '') + '.md)' : '');
  }
  function loadFiles(pid) {
    return sb.from('research_files').select('path,size,mime').eq('project_id', pid).like('path', 'uploads/%').order('path').then(function (r) {
      return ((r && r.data) || []).map(function (x) { return { name: String(x.path).replace(/^uploads\//, ''), size: x.size, path: x.path, mime: x.mime }; });
    });
  }
  function saveFile(pid, path, content, source) {
    var u = uid();
    return sb.from('research_files').upsert({ project_id: pid, path: cleanText(path), content: cleanText(content), mime: /\.tex$/.test(path) ? 'text/x-tex' : 'text/markdown', size: (content || '').length, source: source || 'ai', created_by: u, updated_by: u, updated_at: nowIso() }, { onConflict: 'project_id,path' });
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
  // Flow: Ideas → (Systematic Review = search+screen → library) → (Literature = review) → Kivonatolás → Research Gap → Protocol.
  // The Research Gap phase runs AFTER the whole literature+review is in, so gaps are grounded in the full collected library.
  var AP_PHASES = [
    { key: 'ideas', label: 'Ideas', ic: '💡', sub: 'kutatási ötletek' },
    { key: 'literature', label: 'Systematic Review', ic: '🔬', sub: 'keresés + szűrés → könyvtár' },
    { key: 'sr', label: 'Literature', ic: '📚', sub: 'irodalmi áttekintés' },
    { key: 'extract', label: 'Kivonatolás', ic: '🔎', sub: 'kérdés-alapú kinyerés' },
    { key: 'gap', label: 'Research Gap', ic: '🧭', sub: 'rések az irodalomból' },
    { key: 'protocol', label: 'Protocol', ic: '🧪', sub: 'lépések' },
    { key: 'journal', label: 'Journal', ic: '🎯', sub: 'venue-ajánló' },
    { key: 'writing', label: 'Writing', ic: '✍️', sub: 'draft szekciók' },
    { key: 'submission', label: 'Submission', ic: '📤', sub: 'csomagolás' }
  ];
  var AP_ICON = {}; AP_PHASES.forEach(function (p) { AP_ICON[p.key] = p.ic; });
  // per-phase hue for the process-graph view (each stage owns a colour → the top-to-bottom flow reads as a spectrum)
  var AP_HUE = { ideas: 'var(--h-idea)', literature: 'var(--h-lit)', gap: 'var(--h-gap)', sr: 'var(--h-rev)', extract: 'var(--h-ext)', protocol: 'var(--h-proto)', journal: 'var(--h-jrnl)', writing: 'var(--h-write)', submission: 'var(--h-sub)' };
  function hueOf(k) { return AP_HUE[k] || 'var(--accent)'; }
  // short HU label for a research-gap type slug (from research-ai gap analysis) → shown as a chip on gap cards
  function gapLabel(s) {
    if (!s) return 'Rés';
    var m = { method: 'Módszer-rés', dataset: 'Adat-rés', data: 'Adat-rés', metric: 'Metrika-rés', theory: 'Elméleti rés', theoretical: 'Elméleti rés', application: 'Alkalmazási rés', population: 'Populáció-rés', evaluation: 'Kiértékelési rés', comparison: 'Összevetési rés', temporal: 'Időbeli rés', scale: 'Skála-rés', methodological: 'Módszertani rés', empirical: 'Empirikus rés' };
    var k = String(s).toLowerCase();
    return m[k] || (String(s).charAt(0).toUpperCase() + String(s).slice(1).replace(/_/g, ' '));
  }
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
  var LIT_KIND_LAB = { quick: 'Gyorsszűrés', abstract: 'Absztrakt-szűrés', fulltext: 'Teljes szöveg', review: 'Áttekintés' };
  // protocol-step task type → icon + label; status → short Hungarian label (used by the Protocol task-card modal)
  var PROTO_KIND = { data: { ic: '📊', lab: 'Adat' }, preprocess: { ic: '🧹', lab: 'Előfeldolgozás' }, feature: { ic: '🧩', lab: 'Jellemzők' }, model: { ic: '🧠', lab: 'Modell' }, train: { ic: '🏋️', lab: 'Tanítás' }, eval: { ic: '📈', lab: 'Kiértékelés' }, analysis: { ic: '🔍', lab: 'Elemzés' }, experiment: { ic: '🧪', lab: 'Kísérlet' }, figure: { ic: '📉', lab: 'Ábra' }, write: { ic: '✍️', lab: 'Írás' }, code: { ic: '💻', lab: 'Kód' } };
  var PROTO_ST = { todo: 'todo', pending: 'vár', running: 'fut', done: 'kész', blocked: 'blokkolt', failed: 'hiba', skipped: 'kihagyva' };
  // ── Floating panel: the status/activity surfaces sit ON the board (draggable by their header, collapsible),
  //    so the canvas itself can own the whole page. Position + collapsed state are remembered per panel. ──
  function FloatPanel(props) {
    var KEY = 'ap-fp-' + props.id;
    var pS = useState(function () {
      var v = null; try { v = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { }
      return (v && typeof v === 'object') ? { x: v.x, y: v.y, col: !!v.col } : { x: null, y: null, col: !!props.defaultCollapsed };
    });
    var pos = pS[0], setPos = pS[1];
    var elRef = useRef(null), drag = useRef(null), last = useRef(null);
    function save(o) { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) { } }
    // First paint: place it from the parent's edge (top-right / bottom-right), then it is user-owned.
    useEffect(function () {
      var el = elRef.current, par = el && el.parentNode; if (!el || !par) return;
      var pw = par.clientWidth, ph = par.clientHeight, w = el.offsetWidth || 340, hh = el.offsetHeight || 200;
      if (pos.x == null || pos.y == null) {
        var n = { x: Math.max(8, pw - w - 16), y: props.anchor === 'br' ? Math.max(8, ph - hh - 58) : 14, col: pos.col };
        setPos(n); save(n); return;
      }
      // keep it reachable if the window shrank
      var cx = Math.max(6, Math.min(Math.max(6, pw - 80), pos.x)), cy = Math.max(6, Math.min(Math.max(6, ph - 40), pos.y));
      if (cx !== pos.x || cy !== pos.y) { var c = { x: cx, y: cy, col: pos.col }; setPos(c); save(c); }
    });
    function down(e) {
      try { if (e.target && e.target.closest && e.target.closest('button')) return; } catch (er) { }
      drag.current = { x: e.clientX, y: e.clientY, ox: pos.x || 0, oy: pos.y || 0 };
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch (er) { }
      e.preventDefault(); e.stopPropagation();
    }
    function move(e) {
      var d = drag.current; if (!d) return;
      var el = elRef.current, par = el && el.parentNode; if (!el || !par) return;
      var nx = Math.max(6, Math.min(Math.max(6, par.clientWidth - 80), d.ox + (e.clientX - d.x)));
      var ny = Math.max(6, Math.min(Math.max(6, par.clientHeight - 40), d.oy + (e.clientY - d.y)));
      last.current = { x: nx, y: ny, col: pos.col };
      setPos(function (o) { return { x: nx, y: ny, col: o.col }; });
    }
    function up(e) {
      if (!drag.current) return; drag.current = null;
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (er) { }
      save(last.current || pos);
    }
    function toggle() { setPos(function (o) { var n = { x: o.x, y: o.y, col: !o.col }; save(n); return n; }); }
    return h('div', {
      className: 'ap-fp' + (pos.col ? ' col' : ''), ref: elRef,
      style: { left: (pos.x || 0) + 'px', top: (pos.y || 0) + 'px', width: (props.width || 340) + 'px', visibility: (pos.x == null ? 'hidden' : 'visible') }
    },
      h('div', { className: 'ap-fp-h', onPointerDown: down, onPointerMove: move, onPointerUp: up, onPointerCancel: up, title: 'Húzd a panel áthelyezéséhez' },
        h('span', { className: 'ap-fp-ic' }, props.icon || '▦'),
        h('span', { className: 'ap-fp-t' }, props.title),
        props.badge || null,
        h('button', { className: 'ap-fp-x', 'aria-label': pos.col ? 'Kinyitás' : 'Összecsukás', title: pos.col ? 'Kinyitás' : 'Összecsukás', onClick: toggle }, pos.col ? '▸' : '▾')),
      pos.col ? null : h('div', { className: 'ap-fp-body' }, props.children));
  }
  // ── Task (ToDo) editor: click any protocol task card → edit every field of it, with an AI chat beside the form
  //    that can propose concrete field values (research-protocol · task_assist / refine_step). ──
  var TASK_KINDS = ['data', 'preprocess', 'feature', 'model', 'train', 'eval', 'analysis', 'experiment', 'figure', 'write', 'code', 'custom'];
  var TASK_ST = ['todo', 'pending', 'running', 'done', 'blocked', 'failed', 'skipped'];
  function TaskEdit(props) {
    var st = props.step || {}, sp = st.spec || {};
    var lines = function (a) { return (Array.isArray(a) ? a : []).map(String).filter(Boolean).join('\n'); };
    var toArr = function (t) { return String(t || '').split('\n').map(function (x) { return x.trim(); }).filter(Boolean); };
    var fS = useState({
      title: st.title || '', kind: st.kind || 'custom', status: st.status || 'todo', needs_approval: !!st.needs_approval,
      instruction: sp.instruction || '', inputs: lines(sp.inputs), expected_outputs: lines(sp.expected_outputs),
      acceptance: lines(sp.acceptance), command_hint: sp.command_hint || '', est_minutes: (sp.est_minutes != null ? String(sp.est_minutes) : '')
    });
    var f = fS[0], setF = fS[1];
    var dS = useState(false), dirty = dS[0], setDirty = dS[1];
    var bS = useState(false), busy = bS[0], setBusy = bS[1];
    var mS = useState([]), msgs = mS[0], setMsgs = mS[1];
    var iS = useState(''), input = iS[0], setInput = iS[1];
    var qS = useState([]), questions = qS[0], setQuestions = qS[1];
    var gS = useState(null), sugg = gS[0], setSugg = gS[1];
    var cS = useState(false), chatBusy = cS[0], setChatBusy = cS[1];
    var listRef = useRef(null);
    useEffect(function () { var el = listRef.current; if (el) el.scrollTop = el.scrollHeight; }, [msgs, chatBusy, questions]);
    function set(k, v) { setF(function (o) { var n = Object.assign({}, o); n[k] = v; return n; }); setDirty(true); }
    function taskNow() { return { title: f.title, kind: f.kind, instruction: f.instruction, inputs: toArr(f.inputs), expected_outputs: toArr(f.expected_outputs), acceptance: toArr(f.acceptance), command_hint: f.command_hint }; }
    function send(text) {
      var t = String(text == null ? input : text).trim();
      if (!t || chatBusy) return;
      var hist = msgs.slice(-8);
      setMsgs(msgs.concat([{ role: 'user', content: t }])); setInput(''); setQuestions([]); setChatBusy(true);
      callEdge('research-protocol', { action: 'task_assist', project_id: props.projectId, task: taskNow(), message: t, history: hist }).then(function (d) {
        setChatBusy(false);
        if (!d || d.error) { setMsgs(function (m) { return m.concat([{ role: 'assistant', content: '⚠ ' + ((d && d.error) || 'Az asszisztens nem elérhető.') }]); }); return; }
        setMsgs(function (m) { return m.concat([{ role: 'assistant', content: String(d.reply || '') }]); });
        setQuestions((d.questions || []).slice(0, 3));
        if (d.suggestion) setSugg(d.suggestion);
      }, function () { setChatBusy(false); setMsgs(function (m) { return m.concat([{ role: 'assistant', content: '⚠ Hálózati hiba.' }]); }); });
    }
    function refine() {
      if (busy || chatBusy) return; setChatBusy(true);
      callEdge('research-protocol', { action: 'refine_step', step_id: st.id, hint: input.trim() }).then(function (d) {
        setChatBusy(false);
        if (!d || d.error || !d.step) { toast('A csiszolás nem sikerült' + ((d && d.error) ? ': ' + d.error : ''), false); return; }
        setSugg(d.step);
        setMsgs(function (m) { return m.concat([{ role: 'assistant', content: '✨ Elkészült egy pontosított változat. Nézd át, és ha jó, töltsd be az űrlapba.' }]); });
      }, function () { setChatBusy(false); toast('Hálózati hiba.', false); });
    }
    function applySugg() {
      if (!sugg) return;
      setF(function (o) {
        var n = Object.assign({}, o);
        if (sugg.title) n.title = String(sugg.title);
        if (sugg.kind && TASK_KINDS.indexOf(String(sugg.kind)) >= 0) n.kind = String(sugg.kind);
        if (sugg.instruction) n.instruction = String(sugg.instruction);
        if (Array.isArray(sugg.inputs)) n.inputs = sugg.inputs.map(String).join('\n');
        if (Array.isArray(sugg.expected_outputs)) n.expected_outputs = sugg.expected_outputs.map(String).join('\n');
        if (Array.isArray(sugg.acceptance)) n.acceptance = sugg.acceptance.map(String).join('\n');
        if (sugg.command_hint) n.command_hint = String(sugg.command_hint);
        if (sugg.est_minutes != null && !isNaN(parseInt(sugg.est_minutes, 10))) n.est_minutes = String(parseInt(sugg.est_minutes, 10));
        if (typeof sugg.needs_approval === 'boolean') n.needs_approval = sugg.needs_approval;
        return n;
      });
      setDirty(true); setSugg(null);
      toast('Betöltve az űrlapba — nézd át, majd Mentés.', true);
    }
    function save() {
      if (busy) return; setBusy(true);
      var spec = Object.assign({}, sp, { instruction: f.instruction, inputs: toArr(f.inputs), expected_outputs: toArr(f.expected_outputs), acceptance: toArr(f.acceptance), command_hint: f.command_hint });
      var em = parseInt(f.est_minutes, 10); if (em > 0) spec.est_minutes = em; else delete spec.est_minutes;
      var patch = { title: String(f.title || 'Feladat').slice(0, 300), kind: f.kind, status: f.status, needs_approval: !!f.needs_approval, spec: spec };
      sb.from('research_protocol_steps').update(patch).eq('id', st.id).then(function (r) {
        setBusy(false);
        if (r && r.error) { toast('Mentés hiba: ' + r.error.message, false); return; }
        setDirty(false); toast('✓ A feladat mentve', true);
        if (props.onSaved) props.onSaved(Object.assign({ id: st.id }, patch));
      }, function () { setBusy(false); toast('Hálózati hiba a mentésnél.', false); });
    }
    function close() { if (dirty && !window.confirm('Vannak mentetlen módosítások. Biztosan bezárod?')) return; props.onClose(); }
    var fld = function (label, node, hint) { return h('label', { className: 'ap-te-f' }, h('span', { className: 'ap-te-lab' }, label, hint ? h('i', null, hint) : null), node); };
    return h('div', { className: 'ap-pv-scrim ap-te-scrim', onClick: close },
      h('div', { className: 'ap-te', onClick: function (e) { e.stopPropagation(); } },
        h('div', { className: 'ap-pv-h' },
          h('b', null, '📝 Feladat szerkesztése' + (st.ord ? ' · #' + st.ord : '')),
          dirty ? h('span', { className: 'ap-te-dirty' }, '● mentetlen') : null,
          h('button', { className: 'ap-pv-x', 'aria-label': 'Bezárás', onClick: close }, '×')),
        h('div', { className: 'ap-te-body' },
          h('div', { className: 'ap-te-form' },
            fld('Cím', h('input', { className: 'ap-te-in', value: f.title, onChange: function (e) { set('title', e.target.value); } })),
            h('div', { className: 'ap-te-row' },
              fld('Típus', h('select', { className: 'ap-te-in', value: f.kind, onChange: function (e) { set('kind', e.target.value); } },
                (TASK_KINDS.indexOf(f.kind) >= 0 ? TASK_KINDS : TASK_KINDS.concat([f.kind])).map(function (k) { return h('option', { key: k, value: k }, ((PROTO_KIND[k] || {}).ic || '•') + ' ' + ((PROTO_KIND[k] || {}).lab || k)); }))),
              fld('Állapot', h('select', { className: 'ap-te-in', value: f.status, onChange: function (e) { set('status', e.target.value); } },
                (TASK_ST.indexOf(f.status) >= 0 ? TASK_ST : TASK_ST.concat([f.status])).map(function (k) { return h('option', { key: k, value: k }, PROTO_ST[k] || k); }))),
              fld('Becsült perc', h('input', { className: 'ap-te-in', type: 'number', min: '0', value: f.est_minutes, onChange: function (e) { set('est_minutes', e.target.value); } }))),
            fld('Utasítás', h('textarea', { className: 'ap-te-in ta', rows: 6, value: f.instruction, onChange: function (e) { set('instruction', e.target.value); } }), 'ezt hajtja végre a futtató'),
            fld('Bemenetek', h('textarea', { className: 'ap-te-in ta', rows: 3, value: f.inputs, onChange: function (e) { set('inputs', e.target.value); } }), 'soronként egy'),
            fld('Várt kimenetek', h('textarea', { className: 'ap-te-in ta', rows: 3, value: f.expected_outputs, onChange: function (e) { set('expected_outputs', e.target.value); } }), 'soronként egy'),
            fld('Elfogadási feltételek', h('textarea', { className: 'ap-te-in ta', rows: 3, value: f.acceptance, onChange: function (e) { set('acceptance', e.target.value); } }), 'soronként egy'),
            fld('Parancs-tipp', h('input', { className: 'ap-te-in mono', value: f.command_hint, onChange: function (e) { set('command_hint', e.target.value); } })),
            h('label', { className: 'ap-te-chk' }, h('input', { type: 'checkbox', checked: f.needs_approval, onChange: function (e) { set('needs_approval', e.target.checked); } }), ' Jóváhagyás kell a futtatás előtt')),
          h('div', { className: 'ap-te-chat' },
            h('div', { className: 'ap-te-ch-h' }, '💬 Asszisztens', h('span', null, 'kérd meg, hogy írja át a kártyát')),
            h('div', { className: 'ap-te-ch-list', ref: listRef },
              !msgs.length ? h('div', { className: 'ap-te-ch-empty' }, 'Írd le, mit változtasson — pl. „legyen konkrétabb az utasítás, és adj hozzá elfogadási feltételeket", vagy „ez a lépés a nuScenes adathalmazra vonatkozzon".') : null,
              msgs.map(function (m, i) { return h('div', { className: 'ap-te-msg ' + m.role, key: i }, m.content); }),
              questions.length ? h('div', { className: 'ap-te-qs' }, questions.map(function (q, i) {
                return h('div', { className: 'ap-te-q', key: i }, h('div', { className: 'ap-te-qq' }, q.q),
                  h('div', { className: 'ap-te-qo' }, (q.options || []).map(function (o, k) {
                    return h('button', { className: 'ap-te-qb', key: k, onClick: function () { send(o); } }, o);
                  })));
              })) : null,
              sugg ? h('div', { className: 'ap-te-sugg' },
                h('b', null, '✨ Javaslat a mezőkre'),
                h('div', { className: 'ap-te-sugg-b' }, Object.keys(sugg).slice(0, 8).map(function (k) {
                  var v = sugg[k]; var txt = Array.isArray(v) ? v.map(String).join(' · ') : String(v == null ? '' : v);
                  return h('div', { key: k }, h('i', null, k + ': '), txt.slice(0, 160));
                })),
                h('div', { className: 'ap-te-sugg-a' },
                  h('button', { className: 'btn pri sm', onClick: applySugg }, 'Betöltés az űrlapba'),
                  h('button', { className: 'btn sm', onClick: function () { setSugg(null); } }, 'Elvetés'))) : null,
              chatBusy ? h('div', { className: 'ap-te-msg assistant' }, h('span', { className: 'spin' }), ' gondolkodik…') : null),
            h('div', { className: 'ap-te-ch-in' },
              h('textarea', {
                rows: 2, value: input, placeholder: 'Mit írjon át ezen a kártyán?',
                onChange: function (e) { setInput(e.target.value); },
                onKeyDown: function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }
              }),
              h('div', { className: 'ap-te-ch-acts' },
                h('button', { className: 'btn sm', disabled: chatBusy, title: 'Az AI pontosítja az egész kártyát a jelenlegi tartalom alapján', onClick: refine }, '✨ Csiszolás'),
                h('button', { className: 'btn pri sm', disabled: chatBusy || !input.trim(), onClick: function () { send(); } }, 'Küldés')))))
        ,
        h('div', { className: 'ap-pv-f' },
          h('span', { className: 'ap-te-hint' }, 'A mentés azonnal a protokollba írja a kártyát.'),
          h('button', { className: 'btn sm', onClick: close }, 'Mégse'),
          h('button', { className: 'btn pri sm', disabled: busy || !dirty, onClick: save }, busy ? h('span', { className: 'spin' }) : '💾 Mentés'))));
  }
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
    // Step 2 = plain research IDEAS from the brief/goal (source='idea'). Research GAPS are generated LATER, in the
    // Research Gap phase, grounded in the collected literature. Idempotent: adopt existing candidate ideas on a retry.
    return sb.from('research_ideas').select('id', { count: 'exact', head: true }).eq('project_id', project.id).neq('status', 'rejected').then(function (cr) {
      var existing = (cr && cr.count) || 0;
      if (existing > 0) return apComplete(run, existing + ' meglévő ötlet-jelölt', [{ phase: 'ideas', level: 'sys', message: 'Már vannak ötletek — az ötlet-generálás kimarad' }]);
      return callEdge('research-ai', { action: 'ideas', project_id: project.id }).then(function (d) {
        if (d && d.error) throw new Error('Ideas: ' + d.error);
        var n = (d && d.count) || 0;
        return apComplete(run, n ? (n + ' ötlet-jelölt generálva') : 'Nincs új ötlet', [{ phase: 'ideas', level: 'run', message: 'Kutatási ötletek generálva' }]);
      });
    });
  }
  // The funnel's FINAL output for a study: each source at its DEEPEST screening step, kept only if it survived as an
  // include (or was manually overridden). Every downstream phase must agree on this set — the SR reads it, so the
  // extraction and the gates must too.
  function studyIncludes(sid) {
    if (!sid) return Promise.resolve([]);
    return sb.from('research_study_papers').select('source_id,decision,overridden,step').eq('study_id', sid).then(function (pr) {
      var deepest = {};
      ((pr && pr.data) || []).forEach(function (p) { var c = deepest[p.source_id]; if (!c || (p.step || 0) >= (c.step || 0)) deepest[p.source_id] = p; });
      var inc = [];
      Object.keys(deepest).forEach(function (k) { var p = deepest[k]; if (p.decision === 'include' || (p.overridden && p.decision !== 'exclude')) inc.push(k); });
      return inc;
    }, function () { return []; });
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
          // materialize the extraction questions NOW (study-scoped) so the funnel screening answers them INLINE
          // (research-study reads study-scoped + project-scoped questions during step-2/3 screening). Best-effort.
          var exq = apExtractNorm((run.config && run.config.extract_questions) || []);
          if (exq.length) { try { sb.from('research_extraction_questions').insert(exq.map(function (x, i) { return { project_id: project.id, study_id: sid, text: x.text.slice(0, 300), answer_type: x.answer_type, source_mode: x.source_mode, ord: i, created_by: uid() }; })); } catch (e) { } }
          return sb.from('research_study_steps').insert(rows).then(function (rr) {
            if (rr && rr.error) throw new Error('Literature: study-lépések (' + rr.error.message + ')');
            return callEdge('research-study', { action: 'plan', study_id: sid }).then(function (d) {
              // a failed AI plan is NON-fatal: the study_steps already hold valid client-seeded config, so search on
              var ev = !(d && d.error) ? { phase: 'literature', level: 'sys', message: 'Study létrehozva + keresés megtervezve' }
                : { phase: 'literature', level: 'warn', message: 'Study létrehozva — AI-tervezés kimaradt (' + (d.error || '') + '), a mentett kulcsszavakkal keresek' };
              // Record WHICH idea this thread develops. The ideas are inserted in ONE batch, so "most recent"
              // is not a stable tie-break — without this stamp the graph could only guess, and marked the wrong
              // idea card as being developed.
              var patch = { study_id: sid };
              if (!chosen && idea && idea.id) patch.config = Object.assign({}, run.config || {}, { develop_idea_id: idea.id, develop_auto: true });
              return apStay(run, { stage: 's1', offset: 0, study_id: sid, iter: 0 }, [ev], patch);
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
      return studyIncludes(sid).then(function (inc) {
        // ZERO includes is never something to walk past: the review would be empty and the extraction would have
        // nothing of its own to work on. Stop for a human even when the gates are switched off.
        if (!inc.length) return apGate(run, { phase: 'literature', title: '0 cikk jutott át a szűrésen', detail: 'Ebben a szálban egyetlen cikk sem lett included, így az áttekintésnek és a kivonatolásnak nem lenne mit feldolgoznia. Nyisd meg az Irodalom kártyát („Bírálat ›"), vedd be kézzel a releváns cikkeket, majd hagyd jóvá a folytatást.' }, { stage: 'gated', study_id: sid });
        if (apGatesOn(run)) return apGate(run, { phase: 'literature', title: inc.length + ' included forrás jóváhagyása', detail: inc.length + ' cikk jutott át a szűrésen. Nézd át őket az Irodalom kártya „Bírálat ›" gombjával, majd hagyd jóvá a folytatáshoz.' }, { stage: 'gated', study_id: sid });
        return apComplete(run, 'Irodalom leszűrve (' + inc.length + ' included)', [{ phase: 'literature', level: 'ok', message: r.msg + ' — full-text kész' }]);
      });
    });
    return Promise.resolve(apComplete(run, 'Irodalom jóváhagyva', []));   // stage 'gated' → resumed after approval
  }
  // Research Gap phase (runs AFTER the whole literature+review is collected): generate DEVELOPABLE research gaps grounded
  // in the full library (research-ai gap_analyze → typed, evidence-grounded gaps as research_ideas source='gap'). They are
  // shown as parallel cards; each can be developed into a protocol. Idempotent: adopt existing gaps on a retry.
  function apGap(run, project) {
    var sid = run.study_id || null;   // this thread's systematic review
    // persist the generated gaps as a report + complete the phase
    function finishGaps(gaps) {
      var md = '# Research Gap-ek\n\nA teljes összegyűjtött irodalom + áttekintés alapján azonosított, kidolgozható kutatási rések.\n\n'
        + gaps.map(function (g, i) { return (i + 1) + '. **' + (g.question || 'Rés') + '**' + (g.novelty != null ? ' — újdonság: ' + g.novelty : ''); }).join('\n')
        + '\n\n*A Publify Autopilot Research Gap fázisából.*\n';
      // per-thread file — a single shared autopilot/research-gap.md would be overwritten by every parallel branch
      var gpath = sid ? ('studies/gaps-' + String(sid).slice(0, 8) + '.md') : 'autopilot/research-gap.md';
      return saveFile(project.id, gpath, md, 'ai').then(function () {
        return apComplete(run, gaps.length + ' kutatási rés generálva', [{ phase: 'gap', level: 'run', message: gaps.length + ' kidolgozható research gap generálva az irodalomból' }]);
      });
    }
    // Each parallel thread derives gaps from ITS OWN systematic review, so the check for "already generated" and
    // the generation itself are scoped to this run's study (migration-114). Without the column/study we behave
    // exactly as before: one project-wide set.
    var gq = sb.from('research_ideas').select('id').eq('project_id', project.id).eq('source', 'gap').neq('status', 'rejected').limit(1);
    if (sid) gq = gq.eq('study_id', sid);
    return gq.then(function (gr) {
      if (gr && gr.error) return { data: [] };   // column missing (migration-114 not applied) → treat as "none yet"
      return gr;
    }, function () { return { data: [] }; }).then(function (gr) {
      if (((gr && gr.data) || []).length) return apComplete(run, 'Meglévő kutatási rések', [{ phase: 'gap', level: 'sys', message: 'Már vannak rések ehhez a szálhoz — a gap-generálás kimarad' }]);
      // primary: typed, evidence-grounded gaps from THIS study's screened-in literature
      return callEdge('research-ai', { action: 'gap_analyze', project_id: project.id, study_id: sid || undefined }).then(function (d) {
        if (d && d.error) throw new Error('Gap: ' + d.error);
        var gaps = (d && d.ideas) || [];
        if (gaps.length) return finishGaps(gaps);
        // gap_analyze found nothing (typically: unscreened / heterogeneous library) → fall back to the broader gap generator
        return callEdge('research-ai', { action: 'gap', project_id: project.id }).then(function (d2) {
          if (d2 && d2.error) throw new Error('Gap: ' + d2.error);
          var g2 = (d2 && d2.ideas) || [];
          if (g2.length) return finishGaps(g2);
          return apSkip(run, 'Nem sikerült rést azonosítani — előbb szűrd le az irodalmat (legyenek „included" források a Studies-ban), majd futtasd újra a Gap fázist.');
        });
      });
    });
  }
  function apSR(run, project) {
    if (!run.study_id) return Promise.resolve(apSkip(run, 'Nincs literature-study — az áttekintés kimarad'));
    var srCur = (run.phases[run.phase_index] || {}).cursor || {};
    return callEdge('research-study', { action: 'generate_review', study_id: run.study_id }).then(function (d) {
      if (d && d.error) {
        if (/full-?text|passed/i.test(d.error)) {
          // Offer the manual rescue once; if the user approves without including anything, skip rather than re-gate.
          if (!srCur.rescued) return apGate(run, { phase: 'sr', title: 'Nincs full-text included cikk', detail: 'A szűrés egyetlen cikket sem engedett a full-text szakaszig, így nincs miből áttekintést írni. Az Irodalom kártya „Bírálat ›" gombjával kézzel is beveheted a releváns cikkeket, majd hagyd jóvá a folytatást.' }, { rescued: true });
          return apSkip(run, 'Nincs full-text included cikk — az áttekintés kimarad');
        }
        throw new Error('SR: ' + d.error);
      }
      return apComplete(run, (d && d.words ? ('Áttekintés: ~' + d.words + ' szó') : 'Áttekintés kész'), [{ phase: 'sr', level: 'run', message: 'Systematic review generálva' + (d && d.file_path ? ' → ' + d.file_path : '') }]);
    });
  }
  // Question-based EXTRACTION (Elicit-style): the config's extract_questions become columns; each is answered per
  // included paper by the research-extract edge (OA full-text + figures, verbatim quote / N-A). Bounded + resumable.
  var EXTRACT_MAX_SOURCES = 20;   // cap the matrix rows so the phase converges in the Autopilot (top-cited included)
  var EXTRACT_BATCH = 3;
  var EXTRACT_DEFAULTS = [
    { text: 'Mekkora a minta/adathalmaz mérete?', answer_type: 'number', source_mode: 'fulltext' },
    { text: 'Milyen módszert / modell-architektúrát használ?', answer_type: 'text', source_mode: 'fulltext' },
    { text: 'Mi a fő metrika és annak értéke?', answer_type: 'number', source_mode: 'both' },
    { text: 'Milyen korlátokat / limitációkat említ?', answer_type: 'list', source_mode: 'fulltext' },
  ];
  function apExtractNorm(qdefs) {
    return (qdefs || []).map(function (q) {
      if (typeof q === 'string') return { text: q, answer_type: 'text', source_mode: 'fulltext' };
      return { text: q.text || q.q || '', answer_type: q.answer_type || 'text', source_mode: q.source_mode || 'fulltext' };
    }).filter(function (q) { return q.text; }).slice(0, 12);
  }
  function apExtract(run, project) {
    var cur = (run.phases[run.phase_index] || {}).cursor || {};
    if (!cur.stage) {
      var norm = apExtractNorm((run.config && run.config.extract_questions) || []);
      if (!norm.length) {
        // An EXPLICIT empty list means the user removed every question — honour it. Only legacy runs (whose config
        // never carried the list) fall back to the defaults.
        if (run.config && run.config.extract_q_set) return Promise.resolve(apSkip(run, 'Nincs kivonatolási kérdés — a fázis kimarad'));
        norm = EXTRACT_DEFAULTS;
      }
      var sidMarker = run.study_id || null;
      // Included sources for the matrix (cap to top-cited so the phase converges). BUGFIX: the Autopilot funnel writes its
      // includes to research_study_papers per STUDY (decision='include'), NOT to research_sources.screening — so in study
      // mode read the study's include set (union across steps, honoring overrides), order by citations & cap; only fall
      // back to project-level Library includes (research_sources.screening) when there is no study or it has none.
      var byCite = function (ids) { return ids.length ? sb.from('research_sources').select('id').in('id', ids).order('cited_by', { ascending: false, nullsFirst: false }).limit(EXTRACT_MAX_SOURCES).then(function (r) { return ((r && r.data) || []).map(function (x) { return x.id; }); }) : Promise.resolve([]); };
      var projInc = function () { return sb.from('research_sources').select('id').eq('project_id', project.id).eq('screening', 'include').order('cited_by', { ascending: false, nullsFirst: false }).limit(EXTRACT_MAX_SOURCES).then(function (r) { return ((r && r.data) || []).map(function (x) { return x.id; }); }); };
      var resolveSids = sidMarker
        ? sb.from('research_study_papers').select('source_id,decision,overridden,step').eq('study_id', sidMarker).then(function (pr) {
            // FINAL funnel output, not the union across steps: a paper is extracted only if it SURVIVED to its deepest
            // screening step as an include (matches the SR, which reads the full-text/step-3 includes). The union
            // over-counted papers that were included early but later excluded (e.g. 62 across steps → really ~2 survivors).
            var deepest = {};
            ((pr && pr.data) || []).forEach(function (p) { var c = deepest[p.source_id]; if (!c || (p.step || 0) >= (c.step || 0)) deepest[p.source_id] = p; });
            var inc = {}; Object.keys(deepest).forEach(function (sid) { var p = deepest[sid]; if (p.decision === 'include' || (p.overridden && p.decision !== 'exclude')) inc[sid] = 1; });
            var ids = Object.keys(inc);
            // NO project-wide fallback in study mode: borrowing the project's includes pulled in ANOTHER thread's
            // papers, so a thread with 0 includes "extracted" 28 foreign articles.
            return byCite(ids);
          }, function () { return []; })
        : projInc();
      return resolveSids.then(function (sids) {
        if (!sids.length) {
          if (sidMarker && !cur.rescued) return apGate(run, { phase: 'extract', title: 'Ebben a szálban 0 included cikk van', detail: 'A kivonatoláshoz ennek a szálnak a saját included cikkei kellenek — más szál cikkeit szándékosan nem vesszük át. Nyisd meg az Irodalom kártyát („Bírálat ›"), vedd be a releváns cikkeket, majd hagyd jóvá a folytatást.' }, { rescued: true });
          return apSkip(run, 'Nincs included cikk a kivonatoláshoz — kimarad');
        }
        // idempotent: adopt questions already created for this study (retry-safe), else insert them
        var existQ = sidMarker
          ? sb.from('research_extraction_questions').select('id,ord').eq('project_id', project.id).eq('study_id', sidMarker).order('ord', { ascending: true })
          : Promise.resolve({ data: [] });
        return existQ.then(function (ex) {
          var existing = (ex && ex.data) || [];
          // build the PENDING cell list = pairs the funnel screening did NOT already fill inline (skip done/na) → no re-work
          var stay = function (qids) {
            return sb.from('research_extraction_cells').select('question_id,source_id,status').in('question_id', qids.length ? qids : ['00000000-0000-0000-0000-000000000000']).then(function (cr) {
              var have = {}; ((cr && cr.data) || []).forEach(function (c) { if (c.status === 'done' || c.status === 'na') have[c.question_id + ':' + c.source_id] = 1; });
              var pending = []; qids.forEach(function (qid) { sids.forEach(function (sid) { if (!have[qid + ':' + sid]) pending.push([qid, sid]); }); });
              var already = qids.length * sids.length - pending.length;
              return apStay(run, { stage: 'run', qids: qids, sids: sids, pending: pending, idx: 0, iter: 0 }, [{ phase: 'extract', level: 'sys', message: 'Kivonatolás: ' + qids.length + ' kérdés × ' + sids.length + ' cikk' + (already ? ' (' + already + ' cella már kész a szűréskor)' : '') }]);
            });
          };
          // Respect the user's own extraction questions: if the study ALREADY has ANY question (added in the Studies/Literature
          // extraction UI, or materialized from the launch config), run EXACTLY those — do NOT inject the 4 defaults on top.
          // Only fall back to the defaults when there is literally no question yet (a phase enabled with nothing configured).
          if (existing.length) return stay(existing.map(function (x) { return x.id; }));
          var rows = norm.map(function (q, i) { return { project_id: project.id, study_id: sidMarker, text: q.text.slice(0, 500), answer_type: q.answer_type, source_mode: q.source_mode, ord: i, created_by: uid() }; });
          return sb.from('research_extraction_questions').insert(rows).select('id').then(function (qr) {
            if (qr && qr.error) throw new Error('Extract: kérdések (' + qr.error.message + ')');
            return stay(((qr && qr.data) || []).map(function (x) { return x.id; }));
          });
        });
      });
    }
    var qids = cur.qids || [], sids = cur.sids || [], pending = cur.pending || [], total = pending.length, idx = cur.idx || 0;
    if (idx >= total) {
      // all pending cells filled → save the matrix as a markdown file, then complete
      return Promise.all([
        sb.from('research_extraction_questions').select('id,text,ord').in('id', qids),
        sb.from('research_extraction_cells').select('question_id,source_id,answer,status').in('question_id', qids.length ? qids : ['00000000-0000-0000-0000-000000000000']),
        sb.from('research_sources').select('id,title,year').in('id', sids.length ? sids : ['00000000-0000-0000-0000-000000000000']),
      ]).then(function (res) {
        var qs = (((res[0] && res[0].data) || []).slice()).sort(function (a, b) { return (a.ord || 0) - (b.ord || 0); });
        var cellsArr = (res[1] && res[1].data) || [], srcs = (res[2] && res[2].data) || [];
        var cmap = {}; cellsArr.forEach(function (c) { cmap[c.question_id + ':' + c.source_id] = c; });
        var doneCells = cellsArr.filter(function (c) { return c.status === 'done'; }).length;
        var esc = function (v) { return String(v == null ? '' : v).replace(/\|/g, '/').replace(/\n/g, ' '); };
        var md = '# Kivonatolás\n\n' + qs.length + ' kérdés × ' + srcs.length + ' cikk. Minden cellát a cikk full-textjéből/ábráiból nyertük ki, idézettel alátámasztva (részletek a Kivonatolás nézetben).\n\n';
        md += '| Cikk | Év |' + qs.map(function (q) { return ' ' + esc(q.text) + ' |'; }).join('') + '\n';
        md += '|---|---|' + qs.map(function () { return '---|'; }).join('') + '\n';
        srcs.forEach(function (s) { md += '| ' + esc(s.title) + ' | ' + (s.year || '') + ' |' + qs.map(function (q) { var c = cmap[q.id + ':' + s.id]; return ' ' + (c && c.status === 'done' ? esc(c.answer) : (c && c.status === 'na' ? 'N/A' : '—')) + ' |'; }).join('') + '\n'; });
        md += '\n*A Publify Autopilot Kivonatolás fázisából.*\n';
        return saveFile(project.id, 'autopilot/extraction.md', md, 'ai').then(function () {
          return apComplete(run, qs.length + ' kérdés × ' + srcs.length + ' cikk kivonatolva (' + doneCells + ' cella)', [{ phase: 'extract', level: 'ok', message: 'Kivonatolási mátrix kész: ' + doneCells + ' kitöltött cella' }]);
        });
      });
    }
    // run the next small batch of PENDING cells (the funnel already filled the rest inline), then persist progress
    var batch = pending.slice(idx, idx + EXTRACT_BATCH);
    return Promise.all(batch.map(function (pair) { return callEdge('research-extract', { action: 'run_cell', question_id: pair[0], source_id: pair[1] }).then(function (d) { return d; }, function () { return null; }); })).then(function (res) {
      // Every cell of the batch failed on the AI CALL itself (e.g. "credit balance is too low"): that is not a per-paper
      // result. Throw → the driver retries this same batch, then fails the run with the real message (it used to write
      // "AI nem adott értelmezhető választ" cells and keep going).
      var aiErrs = (res || []).map(function (d) { return d && d.ai_error; }).filter(Boolean);
      if (batch.length && aiErrs.length === batch.length) throw new Error('Kivonatolás: ' + aiErrs[0]);
      var nidx = idx + batch.length;
      return apStay(run, Object.assign({}, cur, { idx: nidx, iter: (cur.iter || 0) + 1 }), [{ phase: 'extract', level: 'run', message: 'Kivonatolás: ' + Math.min(nidx, total) + '/' + total + ' hiányzó cella' }]);
    });
  }
  // The research gaps THIS thread's systematic review revealed, as protocol sources. The gaps — not the raw idea —
  // are what a protocol should develop: they are the evidence-grounded, actionable output of the review.
  // Study-scoped first (migration-114); falls back to the project's gaps for legacy/unmigrated data.
  function threadGapSources(run, project) {
    // A gap thread develops exactly ONE gap — never widen it to the project's other gaps, or the protocol (and its
    // idea_id provenance, which the edge stamps from the first source) would belong to a different gap.
    if ((run.config && run.config.develop_kind) === 'gap' && run.config.develop_idea_id) {
      return Promise.resolve([{ kind: 'gap', id: run.config.develop_idea_id }]);
    }
    var sid = run.study_id || null;
    var q = function (withStudy) {
      var b = sb.from('research_ideas').select('id,novelty').eq('project_id', project.id).eq('source', 'gap').neq('status', 'rejected');
      if (withStudy && sid) b = b.eq('study_id', sid);
      return b.order('novelty', { ascending: false, nullsFirst: false }).limit(6);
    };
    var map = function (r) { return ((r && r.data) || []).map(function (g) { return { kind: 'gap', id: g.id }; }); };
    return q(true).then(function (r) {
      if ((r && r.error) || !((r && r.data) || []).length) return q(false).then(map, function () { return []; });
      return map(r);
    }, function () { return q(false).then(map, function () { return []; }); });
  }
  function apProtocol(run, project) {
    var cur = (run.phases[run.phase_index] || {}).cursor || {};
    if (cur.generated) return Promise.resolve(apComplete(run, 'Protokoll jóváhagyva', []));
    var ideaId = (run.config && run.config.develop_idea_id) || null;   // PER-IDEA: each parallel branch must get its OWN protocol
    // gate on a protocol's needs_approval steps, then complete (stamps protocol_id)
    function finishProtocol(pid, steps, msg, gapIds) {
      // Provenance: the graph must be able to say WHICH research gaps these tasks were planned for.
      var cfg = (gapIds && gapIds.length) ? Object.assign({}, run.config || {}, { protocol_gap_ids: gapIds }) : null;
      return sb.from('research_protocol_steps').select('id', { count: 'exact', head: true }).eq('protocol_id', pid).eq('needs_approval', true).then(function (cr) {
        var na = (cr && cr.count) || 0, evs = [{ phase: 'protocol', level: 'run', message: msg }];
        var gp = cfg ? { protocol_id: pid, config: cfg } : { protocol_id: pid };
        // A kapus ág korábban ELDOBTA az `evs`-t, ezért a naplóból hiányzott, hogy miből készült a protokoll.
        if (na > 0 && apGatesOn(run)) {
          var g = apGate(run, { phase: 'protocol', title: na + ' protokoll-lépés jóváhagyása', detail: na + ' lépés „needs approval". Nézd át a Protocol-fülön, majd hagyd jóvá a futtatáshoz.' }, { generated: true }, gp);
          g.events = (g.events || []).concat(evs);
          return g;
        }
        var res = apComplete(run, msg, evs); res.patch.protocol_id = pid; if (cfg) res.patch.config = cfg; return res;
      });
    }
    // BUGFIX: adopt an existing protocol ONLY if it belongs to THIS idea. The old lookup matched by project_id alone, so a
    // second branch adopted the first branch's protocol → parallel ideas shared identical tasks. Now each idea gets its own.
    // (Any status: a sibling branch's 'generate' may have archived this idea's protocol via the one-active-per-project
    //  constraint, but every run keeps its own protocol_id, so the graph still shows the correct idea-specific steps.)
    var q = ideaId
      ? sb.from('research_protocols').select('id').eq('project_id', project.id).eq('idea_id', ideaId).order('created_at', { ascending: false }).limit(1).maybeSingle()
      : sb.from('research_protocols').select('id').eq('project_id', project.id).neq('status', 'archived').order('created_at', { ascending: false }).limit(1).maybeSingle();
    return q.then(function (ex) {
      var existing = ex && ex.data && ex.data.id;
      if (existing) {
        // Átvett protokollnál is rögzítjük a szál réseit — enélkül a felület csak annyit tudott mondani,
        // hogy „nincs rögzítve", pedig a rések ugyanúgy megvannak.
        return threadGapSources(run, project).then(function (gs) {
          return finishProtocol(existing, null, 'Meglévő protokoll átvéve' + (ideaId ? ' (ehhez az ötlethez)' : '')
            + (gs.length ? ' — a szál ' + gs.length + ' réséhez rendelve' : ''), gs.map(function (g) { return g.id; }));
        }, function () { return finishProtocol(existing, null, 'Meglévő protokoll átvéve'); });
      }
      // generate scoped to THIS idea (idea_id → the edge plans from that idea's question/hypothesis)
      return threadGapSources(run, project).then(function (gaps) {
        var payload = { action: 'generate', project_id: project.id, goal: project.goal || project.title || '' };
        if (gaps.length) {
          // gaps first (they drive the plan), the idea last so the protocol keeps its idea provenance
          payload.sources = gaps.concat(ideaId ? [{ kind: 'idea', id: ideaId }] : []);
          if (ideaId) payload.idea_id = ideaId;
        } else if (ideaId) payload.idea_id = ideaId;   // no gaps yet → plan from the idea, as before
        return callEdge('research-protocol', payload).then(function (d) {
          if (d && d.error) throw new Error('Protocol: ' + d.error);
          var n = (d && d.steps) || 0;
          return finishProtocol(d && d.protocol_id, n, n + ' protokoll-lépés generálva' + (gaps.length ? (' — ' + gaps.length + ' kutatási rés kidolgozására') : (ideaId ? ' (ötlet-specifikus)' : '')), gaps.map(function (g) { return g.id; }));
        });
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
  var AP_STEPPERS = { ideas: apIdeas, literature: apLiterature, gap: apGap, sr: apSR, extract: apExtract, protocol: apProtocol, journal: apJournal, writing: apWriting, submission: apSubmission };
  // Phases still UNDER DEVELOPMENT: the Autopilot currently ends at protocol GENERATION — Journal/Writing/Submission
  // would run prematurely (they need the protocols' execution RESULTS, which don't exist yet), so they never auto-run.
  var AP_WIP = { journal: true, writing: true, submission: true };
  function apStep(run, project) {
    var i = run.phase_index, ph = run.phases[i];
    if (!ph) return Promise.resolve({ patch: { status: 'done', finished_at: nowIso() }, events: [] });
    // reaching a WIP phase = the functional pipeline is complete → end the run here, mark the rest 'fejlesztés alatt'
    if (AP_WIP[ph.key]) {
      var wph = run.phases.slice();
      for (var k = i; k < wph.length; k++) { if (AP_WIP[wph[k].key]) wph[k] = Object.assign({}, wph[k], { status: 'wip', result: 'fejlesztés alatt' }); }
      return Promise.resolve({ patch: { phases: wph, status: 'done', finished_at: nowIso() }, events: [{ level: 'ok', message: '✓ Az Autopilot a protokoll-generálásig lefutott. A Journal / Writing / Submission fázisok fejlesztés alatt állnak (a protokollok tényleges eredménye kell hozzájuk).' }] });
    }
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

    // Kijelölés → ötlet (a Research-chat mintájára): egy buborékban kijelölt részletből ötlet lesz — az AI fogalmaz belőle
    // kutatási ötletet, vagy szó szerint mentjük. Mindkettő a brief oldalsáv „Ötletek" listájára kerül.
    var spS = useState(null), selPop = spS[0], setSelPop = spS[1];   // { text, x, y } — the floating toolbar above the selection
    var sbS = useState(''), selBusy = sbS[0], setSelBusy = sbS[1];   // '' | 'ai' | 'own'
    var selBusyRef = useRef('');
    function onThreadMouseUp() {
      if (!props.onIdeaFromSel || selBusyRef.current) return;
      setTimeout(function () {
        var s = window.getSelection ? window.getSelection() : null, root = scrollRef.current;
        var txt = s ? String(s).trim() : '';
        // only a selection lying wholly inside the thread — a drag that started in the brief panel is not a chat quote
        if (!txt || txt.length < 4 || !root || !s.rangeCount || !root.contains(s.anchorNode) || !root.contains(s.focusNode)) { setSelPop(null); return; }
        try { var rc = s.getRangeAt(0).getBoundingClientRect(); setSelPop({ text: txt, x: rc.left + rc.width / 2, y: rc.top }); } catch (e) { setSelPop(null); }
      }, 1);
    }
    useEffect(function () {   // a click anywhere else dismisses the toolbar (unless it is mid-save)
      if (!selPop) return;
      function away(e) { if (selBusyRef.current) return; if (e.target && e.target.closest && e.target.closest('.ap-selpop')) return; setSelPop(null); }
      document.addEventListener('mousedown', away);
      return function () { document.removeEventListener('mousedown', away); };
    }, [selPop]);
    function ideaFromSel(mode) {
      if (!selPop || selBusyRef.current) return;
      selBusyRef.current = mode; setSelBusy(mode);
      function done() { selBusyRef.current = ''; if (!alive.current) return; setSelBusy(''); setSelPop(null); try { window.getSelection().removeAllRanges(); } catch (e) { } }
      Promise.resolve(props.onIdeaFromSel(selPop.text, mode)).then(done, done);
    }

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
    function onScroll() { var el = scrollRef.current; if (!el) return; atBottom.current = (el.scrollHeight - el.scrollTop - el.clientHeight) < 60; if (selPop && !selBusyRef.current) setSelPop(null); }

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
          if (!resp.ok || !resp.body || !resp.body.getReader) {
            // Show the REAL reason (this branch only fires on a non-200 BEFORE streaming; a credit/overload error arrives as a
            // 200 stream and is shown as chat text). The old message always blamed the edge/key, which is usually wrong.
            resp.text().then(function (t) {
              var detail = ''; try { detail = (JSON.parse(t) || {}).error || t; } catch (e) { detail = t; }
              var s = resp.status, d = String(detail || '');
              var msg = (s === 503 && /ANTHROPIC_API_KEY/i.test(d)) ? 'AI-kapcsolat függőben — az ANTHROPIC_API_KEY nincs beállítva az edge-ben.'
                : (/credit balance is too low|billing/i.test(d)) ? 'Az Anthropic-egyenleg elfogyott — tölts fel kreditet (console.anthropic.com → Plans & Billing).'
                : s === 404 ? 'A beszélgetés nem található vagy nincs hozzáférés — nyiss egy új briefet.'
                : (s === 400 && /no messages/i.test(d)) ? 'Még nincs mit megválaszolni — küldd el az üzenetet újra (lehet, hogy nem mentődött el).'
                : s === 403 ? 'Nincs jogosultságod az AI-chathez (research_chat_ideas) — szólj az adminnak.'
                : s === 429 ? (d && d.trim() ? d : 'Elérted a mai AI-kereted (napi kérés-limit) — holnap újratöltődik. Az admin emelheti a napi keretet.')   // per-user daily AI-request cap (migration-48/101), NOT an Anthropic rate limit
                : s === 529 ? 'Az AI épp túlterhelt — próbáld újra egy pillanat múlva.'
                : 'Az AI most nem válaszolt (' + s + (d ? ' — ' + d.slice(0, 160) : '') + '). Próbáld újra.';
              if (alive.current) setErr(msg);
            }, function () { if (alive.current) setErr('Az AI most nem válaszolt (' + resp.status + '). Próbáld újra.'); });
            endStream(false); return;
          }
          var reader = resp.body.getReader(), dec = new TextDecoder(), acc = '';
          setStreaming({ text: '' });
          (function pump() {
            reader.read().then(function (rr) {
              if (!alive.current) { streamingRef.current = false; return; }
              if (rr.done) { if (props.onReply) props.onReply(); endStream(true); return; }
              acc += dec.decode(rr.value, { stream: true }); setStreaming({ text: acc }); pump();
            }, function () { endStream(true); });
          })();
        }, function () { setErr('Nem sikerült elérni a szervert — hálózati hiba, próbáld újra.'); endStream(false); });
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
          if (!names) {
            setBusy(false);
            var why = (up.filter(function (x) { return x.err; })[0] || {}).err;
            toast('A fájl feltöltése nem sikerült' + (why ? ': ' + String(why).slice(0, 90) : '.'), false);
            return;
          }
          var okNames = {}; okd.forEach(function (x) { okNames[x.name] = 1; });
          var body = stagedContextMsg(staged.filter(function (f) { return okNames[f.name]; }), 'Feltöltöttem: ' + names);
          sb.from('research_messages').insert({ chat_id: props.chatId, role: 'user', content: body }).then(function () {
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
      // Ha az asszisztens a cikk PDF-jét kéri, ne kelljen külön megkeresni a 📎 gombot:
      // a kérdés alatt ott a feltöltés, és a „feltöltöm" opció maga nyitja a fájlválasztót.
      var UP_RE = /pdf|feltölt|csatol|upload|attach/i;
      var wantsFile = showQ && pq.qs.some(function (qq) {
        return UP_RE.test(qq.q || '') || (qq.options || []).some(function (o) { return UP_RE.test(o); });
      });
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
                    var isUp = /feltölt|csatol|upload|attach/i.test(o);
                    return h('button', {
                      className: 'ap-q-opt' + (on ? ' on' : '') + (isUp ? ' up' : ''), key: oi, 'aria-pressed': on,
                      title: isUp ? 'Fájlválasztó megnyitása' : null,
                      onClick: function () { if (isUp) { pickFile(); return; } toggleQ(qk, o, qq.multi); }
                    }, (isUp ? '📎 ' : (on ? '✓ ' : '')) + o);
                  })));
              }),
              wantsFile ? h('div', { className: 'ap-q-up', onClick: pickFile, role: 'button', tabIndex: 0,
                onKeyDown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickFile(); } } },
                h('span', { className: 'ap-q-up-ic' }, '📎'),
                h('span', null, h('b', null, 'Csatold ide a cikk PDF-jét'),
                  h('small', null, 'Kattints a tallózáshoz — a szövegét kinyerem, és onnantól abból dolgozom.'))) : null,
              h('textarea', { className: 'ap-q-note', rows: 1, value: note, placeholder: 'Egyéb / pontosítás (opcionális)…', onChange: function (e) { setNote(m.id, e.target.value); }, onKeyDown: function (e) { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (canSend) sendQBlock(m.id, pq.qs); } } }),
              h('div', { className: 'ap-q-send' },
                h('span', { className: 'ap-q-hint' }, totalSel ? (totalSel + ' kiválasztva') : (note.trim() ? 'saját válasz' : 'Válassz — nyugodtan gondold át')),
                h('button', { className: 'ap-csend', disabled: !canSend, onClick: function () { sendQBlock(m.id, pq.qs); } }, 'Küldés' + (totalSel ? (' (' + totalSel + ')') : ''))));
          })() : null));
    }

    return h('div', { className: 'ap-card ap-chat' },
      h('div', { className: 'ap-chat-h' }, h('span', { className: 'ap-av ai' }, 'AI'), h('b', null, 'Kutatási asszisztens'), h('span', { className: 'prj' }, props.projectTitle || ''),
        props.onDiscard ? h('button', { className: 'ap-discard', title: 'A projekt, a beszélgetés és a fájlok elvetése', onClick: props.onDiscard }, 'Elvetés') : null),
      h('div', { className: 'ap-thread', ref: scrollRef, onScroll: onScroll, onMouseUp: onThreadMouseUp },
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
      selPop ? h('div', { className: 'ap-selpop', role: 'toolbar', 'aria-label': 'Kijelölt szöveg → ötlet', style: { left: Math.max(170, Math.min(window.innerWidth - 170, selPop.x)), top: Math.max(8, selPop.y - 46) }, onMouseDown: function (e) { e.preventDefault(); } },
        h('button', { className: 'ap-selpop-b ai', disabled: !!selBusy, title: 'Az AI a kijelölt részletből 1–3 kutatási ötletet fogalmaz meg (kérdés + hipotézis)', onClick: function () { ideaFromSel('ai'); } }, selBusy === 'ai' ? '⏳ Generálás…' : '✦ Ötlet generálása'),
        h('button', { className: 'ap-selpop-b', disabled: !!selBusy, title: 'A kijelölt szöveg szó szerint kerül az ötletek közé', onClick: function () { ideaFromSel('own'); } }, selBusy === 'own' ? 'Mentés…' : '✚ Mentés ötletként')) : null,
      err ? h('div', { className: 'ap-cerr' },
        h('span', { className: 'ap-cerr-t' }, err),
        h('button', { className: 'ap-cerr-retry', disabled: busy, title: 'Az utolsó üzenet újraküldése', onClick: function () { if (busy) return; setErr(''); replyNow(props.chatId); } }, '↻ Újraküldés')) : null,
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
    var oiS = useState({}), openIds = oiS[0], setOpenIds = oiS[1];   // idea id → expanded (full question + hypothesis + rationale)

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

    var hasGoal = !!(p.goal && p.goal.trim()), hasKw = (p.keywords || []).length > 0, hasFiles = files.length > 0, ideas = props.ideas || [], hasIdeas = ideas.length > 0;
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

    function toggleIdea(id) { setOpenIds(function (m) { var n = Object.assign({}, m); if (n[id]) delete n[id]; else n[id] = 1; return n; }); }
    var SRC_LBL = { own: 'saját szöveg', chat: 'AI · a chatből' };
    function ideaItem(it) {
      var open = !!openIds[it.id], fresh = !!(props.freshIds && props.freshIds[it.id]);
      return h('div', { key: it.id, className: 'ap-idi' + (fresh ? ' fresh' : '') },
        h('div', { className: 'ap-idi-top' },
          h('span', { className: 'ap-idi-src' + (it.source === 'own' ? ' own' : '') }, SRC_LBL[it.source] || 'AI'),
          props.onRemoveIdea ? h('button', { className: 'ap-idi-x', title: 'Eltávolítás az ötletek közül', 'aria-label': 'Ötlet eltávolítása', onClick: function () { props.onRemoveIdea(it); } }, '×') : null),
        h('div', { className: 'ap-idi-q' + (open ? ' open' : ''), role: 'button', tabIndex: 0, title: open ? 'Összecsukás' : 'Teljes leírás', onClick: function () { toggleIdea(it.id); }, onKeyDown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleIdea(it.id); } } }, it.question || '—'),
        it.hypothesis ? h('div', { className: 'ap-idi-h' + (open ? ' open' : '') }, h('b', null, 'Hipotézis: '), it.hypothesis) : null,
        (open && it.rationale) ? h('div', { className: 'ap-idi-r' }, it.rationale) : null);
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

      row('ideas', 'Ötletek' + (hasIdeas ? ' · ' + ideas.length : ''), hasIdeas,
        h('div', null,
          hasIdeas ? h('div', { className: 'ap-idl' }, ideas.map(ideaItem))
            : h('div', { className: 'ap-bfv empty' }, 'Még nincs ötlet. Kérj ötleteket a beszélgetésből, vagy jelölj ki egy részletet a chatben.'),
          h('button', { className: 'ap-bfedit', disabled: sgBusy, onClick: suggest }, sgBusy ? h('span', null, h('span', { className: 'spin' }), ' Generálás…') : '✦ Ötletek a beszélgetésből'),
          h('div', { className: 'ap-bfhint' }, 'Tipp: jelölj ki szöveget a chatben — a felugró gombbal ötletet generálhatsz belőle, vagy szó szerint elmentheted.')),
        null),

      h('div', { className: 'ap-brief-cta' },
        h('button', { className: 'ap-launch', onClick: props.onReview }, '⚡ Áttekintés & indítás →'),
        h('div', { className: 'ap-ctahint' + (filled >= 3 ? ' on' : '') }, filled >= 3 ? '✓ Az irány kikristályosodott' : 'A briefet te töltöd fel a beszélgetésből — bármikor indíthatod.')));
  }

  // ======================================================================= LAUNCH (clarify)
  // 4th element = WIP (under development): shown but not runnable — the Autopilot currently ends at protocol generation.
  // MUST stay index-aligned with AP_PHASES (cfg.phases[i] toggles AP_PHASES[i]).
  var PHASES = [
    ['💡', 'Ideas', 'kutatási ötletek'], ['🔬', 'Systematic Review', 'keresés + szűrés'], ['📚', 'Literature', 'irodalmi áttekintés'],
    ['🔎', 'Kivonatolás', 'kérdés-alapú kinyerés'], ['🧭', 'Research Gap', 'rések az irodalomból'],
    ['🧪', 'Protocol', 'lépések generálása'], ['🎯', 'Journal', 'venue-ajánló', true], ['✍️', 'Writing', 'draft szekciók', true], ['📤', 'Submission', 'csomagolás', true]
  ];
  var TIERS = ['Top-tier (Q1)', 'Open access', 'Gyors döntés'];
  function LaunchView(props) {
    var p = props.project, files = props.files || [], cfg = props.cfg;
    var exInS = useState(''), exIn = exInS[0], setExIn = exInS[1];
    function setTier(t) { props.setCfg(Object.assign({}, cfg, { tier: t })); }
    function togglePhase(i) { var ph = cfg.phases.slice(); ph[i] = !ph[i]; props.setCfg(Object.assign({}, cfg, { phases: ph })); }
    function setMax(v) { props.setCfg(Object.assign({}, cfg, { maxPapers: v.replace(/[^0-9]/g, '').slice(0, 6) })); }
    function addExQ(t) { t = (t || exIn || '').trim(); if (!t) return; props.setCfg(Object.assign({}, cfg, { extractQuestions: (cfg.extractQuestions || []).concat([{ text: t.slice(0, 300), answer_type: 'text', source_mode: 'fulltext' }]) })); setExIn(''); }
    function delExQ(i) { var qs = (cfg.extractQuestions || []).slice(); qs.splice(i, 1); props.setCfg(Object.assign({}, cfg, { extractQuestions: qs })); }
    var extractOn = cfg.phases[(function () { for (var i = 0; i < PHASES.length; i++) if (PHASES[i][1] === 'Kivonatolás') return i; return -1; })()];

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
        h('div', { className: 'ap-clari' }, h('div', { className: 'ap-cl-lbl' }, 'Mely fázisok fussanak automatikusan', h('div', { style: { fontWeight: 400, color: 'var(--muted)', fontSize: 11.5, marginTop: 3 } }, 'A kikapcsolt fázisokat az Autopilot kihagyja. Az Autopilot jelenleg a protokoll-generálásig fut.')),
          PHASES.map(function (ph, i) {
            var wip = !!ph[3];   // under development → shown but not runnable
            return h('div', { className: 'ap-phrow' + (wip ? ' wip' : ''), key: i },
              h('span', { className: 'pi' }, ph[0]),
              h('span', { className: 'pn' }, ph[1], h('small', null, wip ? '🚧 fejlesztés alatt' : ph[2])),
              wip
                ? h('span', { className: 'ap-wipbadge' }, 'hamarosan')
                : h('button', { className: 'ap-sw' + (cfg.phases[i] ? ' on' : ''), role: 'switch', 'aria-checked': cfg.phases[i] ? 'true' : 'false', 'aria-label': ph[1], onClick: function () { togglePhase(i); } }, h('i')));
          })),
        extractOn ? h('div', { className: 'ap-clari' },
          h('div', { className: 'ap-cl-lbl' }, '🔎 Kivonatolási kérdések', h('div', { style: { fontWeight: 400, color: 'var(--muted)', fontSize: 11.5, marginTop: 3 } }, 'A Kivonatolás fázis minden included cikkből kikeresi ezekre a választ (idézettel). Az alábbiak az alapkérdések — bármelyik törölhető az ×-szel. Ha mindet törlöd, a fázis kimarad.')),
          h('div', { className: 'ap-exq-in' },
            h('input', { className: 'ap-exq-input', value: exIn, placeholder: 'pl. Mekkora az adathalmaz mérete?', onChange: function (e) { setExIn(e.target.value); }, onKeyDown: function (e) { if (e.key === 'Enter') addExQ(); } }),
            h('button', { className: 'ap-exq-add', onClick: function () { addExQ(); } }, '＋')),
          (cfg.extractQuestions && cfg.extractQuestions.length) ? h('div', { className: 'ap-exq-tags' }, cfg.extractQuestions.map(function (q, i) { return h('span', { className: 'ap-exq-tag', key: i }, q.text, h('span', { className: 'x', title: 'Törlés', onClick: function () { delExQ(i); } }, '×')); })) : null,
          h('div', { className: 'ap-exq-tpl' },
            EXTRACT_DEFAULTS.filter(function (t) { return !(cfg.extractQuestions || []).some(function (q) { return q.text === t.text; }); })
              .map(function (t, i) { return h('button', { className: 'ap-exq-sug', key: i, onClick: function () { addExQ(t.text); } }, '＋ ' + t.text); }),
            (cfg.extractQuestions || []).length ? null : h('span', { className: 'ap-exq-none' }, 'Nincs kérdés — a Kivonatolás fázis kimarad.'))) : null,
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
    { key: 'upload', si: '📎', b: 'Feltöltésből', s: 'több fájl', ph: 'Tölts fel fájlokat lent, és írd le, mit kezdjünk velük…' },
    { key: 'mtmt', si: '📚', b: 'Publikációmból', s: 'saját MTMT-cikk', ph: 'Válaszd ki a cikket lent — a rendszer felkutatja a PDF-et és abból indul a beszélgetés…' }
  ];
  // ---- picker: the researcher's own MTMT publications ----
  // pub_read RLS is `using(true)` — every signed-in user can read EVERY researcher's rows — so the
  // researcher_id filter here is the actual access control, not a convenience.
  function PubPicker(props) {
    var lS = useState({ loading: true, rows: [], err: null }), st = lS[0], setSt = lS[1];
    var qS = useState(''), q = qS[0], setQ = qS[1];
    var syS = useState(false), syncing = syS[0], setSyncing = syS[1];
    var meS = useState(null), prof = meS[0], setProf = meS[1];
    function load() {
      var u = uid(); if (!u) { setSt({ loading: false, rows: [], err: 'Nincs bejelentkezett felhasználó.' }); return; }
      sb.from('profiles').select('mtmt_id').eq('id', u).maybeSingle().then(function (r) { setProf((r && r.data) || {}); });
      sb.from('publications').select('id,mtid,title,year,journal,doi,type,type_hu,first_author,author_count,citations,indep_citations,volume,issue,pages,citation')
        .eq('researcher_id', u).order('year', { ascending: false, nullsFirst: false }).limit(600)
        .then(function (r) {
          if (r && r.error) { setSt({ loading: false, rows: [], err: r.error.message }); return; }
          setSt({ loading: false, rows: (r && r.data) || [], err: null });
        }, function () { setSt({ loading: false, rows: [], err: 'Hálózati hiba.' }); });
    }
    useEffect(load, []);
    function syncNow() {
      setSyncing(true);
      // invoke() hides the body on non-2xx, so the honest reason (no MTMT id / entitlement) is read via callEdge
      callEdge('mtmt-sync', {}).then(function (d) {
        setSyncing(false);
        if (!d || d.error) { toast(((d && (d.message || d.error)) || 'A szinkron nem futott le.'), false); return; }
        toast('✓ ' + (d.count || 0) + ' publikáció szinkronizálva', true);
        setSt({ loading: true, rows: [], err: null }); load();
      }, function () { setSyncing(false); toast('Hálózati hiba a szinkron közben.', false); });
    }
    var needle = q.trim().toLowerCase();
    var rows = needle ? st.rows.filter(function (p) {
      return (String(p.title || '') + ' ' + String(p.journal || '') + ' ' + String(p.year || '') + ' ' + String(p.doi || '')).toLowerCase().indexOf(needle) >= 0;
    }) : st.rows;
    return h('div', { className: 'ap-pp-scrim', onClick: props.onClose },
      h('div', { className: 'ap-pp', onClick: function (e) { e.stopPropagation(); } },
        h('div', { className: 'ap-pp-h' },
          h('b', null, '📚 Kiindulás a saját publikációdból'),
          h('button', { className: 'ap-pv-x', 'aria-label': 'Bezárás', onClick: props.onClose }, '×')),
        props.busy
          ? h('div', { className: 'ap-pp-busy' }, h('span', { className: 'spin' }), h('div', null, props.busyStep || 'Előkészítés…'),
            h('div', { className: 'ap-pp-busy-s' }, 'Megkeressük a cikk nyilvános PDF-jét, kinyerjük a szövegét, és abból indítjuk a beszélgetést.'))
          : h(React.Fragment, null,
            h('div', { className: 'ap-pp-b' },
              st.loading ? h('div', { className: 'ap-pp-empty' }, h('span', { className: 'spin' }))
                : st.err ? h('div', { className: 'ap-pp-empty' }, 'Nem sikerült betölteni: ' + st.err)
                  : (!st.rows.length && prof === null) ? h('div', { className: 'ap-pp-empty' }, h('span', { className: 'spin' }))
                  : !st.rows.length ? h('div', { className: 'ap-pp-empty' },
                    h('b', null, (prof && prof.mtmt_id) ? 'Még nincs szinkronizálva egyetlen publikáció sem.' : 'Nincs beállítva MTMT azonosítód.'),
                    h('div', { style: { marginTop: 6, lineHeight: 1.5 } }, (prof && prof.mtmt_id)
                      ? 'Az MTMT azonosítód megvan (' + prof.mtmt_id + ') — a szinkron letölti a publikációidat.'
                      : 'Add meg a Profil → Beállítások → Researcher IDs alatt, majd futtasd a szinkront.'),
                    h('div', { style: { marginTop: 10, display: 'flex', gap: 8, justifyContent: 'center' } },
                      (prof && prof.mtmt_id) ? h('button', { className: 'btn pri sm', disabled: syncing, onClick: syncNow }, syncing ? '⏳ Szinkron…' : '⟳ Szinkron most') : null,
                      h('a', { className: 'btn sm', href: 'Profile.html', style: { textDecoration: 'none' } }, 'Profil megnyitása ↗')))
                    : h(React.Fragment, null,
                      h('input', { className: 'ap-pp-search', value: q, placeholder: 'Keresés cím, folyóirat, év vagy DOI szerint…', onChange: function (e) { setQ(e.target.value); } }),
                      h('div', { className: 'ap-pp-list' }, rows.length ? rows.map(function (p) {
                        return h('div', { className: 'ap-pp-row', key: p.id, onClick: function () { props.onPick(p); } },
                          h('div', { className: 'ap-pp-t' }, p.title || 'Cím nélkül'),
                          h('div', { className: 'ap-pp-m' },
                            p.year ? h('span', null, p.year) : null,
                            p.journal ? h('span', null, p.journal) : null,
                            (p.type_hu || p.type) ? h('span', null, p.type_hu || p.type) : null,
                            p.doi ? h('span', { className: 'ok' }, 'DOI') : h('span', { className: 'warn', title: 'DOI nélkül cím alapján keressük a PDF-et' }, 'nincs DOI'),
                            (p.citations ? h('span', null, '★ ' + p.citations) : null)));
                      }) : h('div', { className: 'ap-pp-empty' }, 'Nincs találat erre a keresésre.')))),
            h('div', { className: 'ap-pp-f' },
              h('span', null, st.rows.length ? (rows.length + ' / ' + st.rows.length + ' publikáció') : ''),
              st.rows.length ? h('button', { className: 'btn sm', disabled: syncing, onClick: syncNow }, syncing ? '⏳ Szinkron…' : '⟳ Frissítés MTMT-ből') : null))));
  }
  function Launcher(props) {
    var dS = useState(''), dir = dS[0], setDir = dS[1];
    var stS = useState(''), starter = stS[0], setStarter = stS[1];
    var fS = useState([]), staged = fS[0], setStaged = fS[1];
    var dgS = useState(false), drag = dgS[0], setDrag = dgS[1];
    var ppS = useState(false), pickPub = ppS[0], setPickPub = ppS[1];       // MTMT publication picker open
    var pbS = useState(''), pubStep = pbS[0], setPubStep = pbS[1];          // honest progress while the paper is prepared
    var pbuS = useState(false), pubBusy = pbuS[0], setPubBusy = pbuS[1];
    var taRef = useRef(null), fileRef = useRef(null);
    var ph = (STARTERS.filter(function (x) { return x.key === starter; })[0] || {}).ph || 'Írd le egy mondatban, mit szeretnél kutatni…';

    function pickStarter(k) {
      setStarter(k);
      if (k === 'upload') { if (fileRef.current) fileRef.current.click(); }
      else if (k === 'mtmt') { setPickPub(true); }
      else if (taRef.current) taRef.current.focus();
    }
    // A chosen publication becomes the project's starting point: find the PDF, extract its text, and open the
    // conversation on it. The project cannot exist yet (research_files needs a project), so it travels as a
    // staged file — exactly like an upload.
    function onPickPub(pub) {
      if (pubBusy || props.creating) return;   // a create already in flight would end up as a SECOND project
      setPubBusy(true); setPubStep('Nyílt hozzáférésű PDF keresése…');
      preparePaperStart(pub, setPubStep).then(function (prep) {
        setPubBusy(false); setPickPub(false); setPubStep('');
        // preparing takes 10-20s; the first project may have finished starting in the meantime
        if (props.creating) { toast('Már fut egy projekt létrehozása — próbáld újra utána.', false); return; }
        var file = paperStagedFile(prep);
        var typed = dir.trim();
        var others = staged.slice();
        // reserve room for the typed direction AND the other attachments' names, so the instruction block
        // in the seed can never be the part the 4000-char task slice eats
        var extra = others.length ? '\n\nEmellett feltöltöttem: ' + others.map(function (f) { return f.name; }).join(', ') : '';
        var meta = {
          title: (pub.title || 'Publikáció').slice(0, 70),
          goal: paperGoal(prep),
          seed: paperSeedMessage(prep, typed.length + extra.length + 4) + extra,
          note: prep.pdfText
            ? ('✓ Megvan a cikk szövege' + (prep.pdfRead && prep.pdfPages && prep.pdfRead < prep.pdfPages ? ' (az első ' + prep.pdfRead + ' oldal a(z) ' + prep.pdfPages + '-ból)' : (prep.pdfPages ? ' (' + prep.pdfPages + ' oldal)' : '')))
            : ('⚠ ' + (prep.why || 'A PDF nem érhető el')),
          titleWarn: (prep.byTitle && prep.matchedTitle) ? prep.matchedTitle : null
        };
        toast(meta.note, !!prep.pdfText);
        if (meta.titleWarn) setTimeout(function () { toast('A PDF cím alapján lett azonosítva: „' + String(meta.titleWarn).slice(0, 60) + '…" — ellenőrizd.', false); }, 2800);
        props.onStart(typed, others.concat([file]), meta);
      }, function () {
        setPubBusy(false); setPubStep('');
        toast('A publikáció előkészítése nem sikerült.', false);
      });
    }
    function addFiles(list) { readStaged(list).then(function (arr) { setStaged(function (cur) { return cur.concat(arr); }); }); }
    function onFile(e) { if (e.target.files && e.target.files.length) addFiles(e.target.files); e.target.value = ''; }
    function removeStaged(i) { setStaged(function (cur) { return cur.filter(function (_, j) { return j !== i; }); }); }
    function onDrop(e) { e.preventDefault(); setDrag(false); if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }
    function onTa(e) { setDir(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 180) + 'px'; }
    function onKey(e) { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); start(); } }

    var canStart = !!(dir.trim() || staged.length);
    function start() { if (!canStart || props.creating) return; props.onStart(dir.trim(), staged, null); }

    return h('div', { className: 'ap-launcher' },
      h('div', { className: 'ap-lhead' }, 'Mit szeretnél kutatni?'),
      h('div', { className: 'ap-lsub' }, 'Írd le egy mondatban — vagy indíts egy cikkből, adatból, ötletből. A beszélgetés innen folytatódik, a briefet pedig menet közben te töltöd fel.'),
      h('div', { className: 'ap-inwrap' },
        h('textarea', { ref: taRef, className: 'ap-bigin', rows: 1, value: dir, placeholder: ph, onChange: onTa, onKeyDown: onKey }),
        h('button', { className: 'ap-gobtn', title: 'Indítás (⌘/Ctrl+Enter)', disabled: !canStart || props.creating, onClick: start }, props.creating ? h('span', { className: 'spin' }) : '➤')),
      h('div', { className: 'ap-starters' }, STARTERS.map(function (s) {
        return h('div', { key: s.key, className: 'ap-starter' + (starter === s.key ? ' on' : '') + (props.creating ? ' off' : ''), onClick: function () { if (props.creating) return; pickStarter(s.key); } },
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
      pickPub ? h(PubPicker, { busy: pubBusy, busyStep: pubStep, onClose: function () { if (!pubBusy) { setPickPub(false); setStarter(''); } }, onPick: onPickPub }) : null,
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
  // Publication-level extraction questions INSIDE the Literature-review drawer. Reuses the SAME shared contract as the
  // Studies "Kivonatolás" (research_extraction_questions + research_extraction_cells + research-extract run_cell) — questions
  // are stored study-scoped (study_id), so they ALSO appear in the Studies evidence matrix (reuse, not duplication).
  function LitExtract(props) {
    var pid = props.projectId, sid = props.studyId, incIds = props.includedIds || [], srcMap = props.sources || {}, canEdit = props.canEdit !== false;
    var qS = useState(null), questions = qS[0], setQuestions = qS[1];
    var cS = useState({}), cells = cS[0], setCells = cS[1];
    var rS = useState({}), running = rS[0], setRunning = rS[1];
    var iS = useState(''), input = iS[0], setInput = iS[1];
    var bS = useState(false), busy = bS[0], setBusy = bS[1];
    var oS = useState(null), openCell = oS[0], setOpenCell = oS[1];   // "qid:sid" whose evidence (quote+reference) is expanded
    var alive = useRef(true);
    useEffect(function () { return function () { alive.current = false; }; }, []);
    function K(q, s) { return q + ':' + s; }
    function load() {
      if (!pid || !sid) { setQuestions([]); return; }
      sb.from('research_extraction_questions').select('*').eq('project_id', pid).eq('study_id', sid).order('ord', { ascending: true }).then(function (r) {
        if (!alive.current) return;
        var qs = (r && r.data) || []; setQuestions(qs);
        var qids = qs.map(function (q) { return q.id; });
        if (!qids.length) { setCells({}); return; }
        sb.from('research_extraction_cells').select('*').in('question_id', qids).then(function (cr) {
          if (!alive.current) return;
          var m = {}; ((cr && cr.data) || []).forEach(function (c) { m[K(c.question_id, c.source_id)] = c; }); setCells(m);
        });
      }, function () { if (alive.current) setQuestions([]); });
    }
    useEffect(function () { load(); }, [pid, sid]);
    function runCells(list) {
      list = (list || []).filter(Boolean); if (!list.length) return;
      var queue = list.slice(), active = 0, CONC = 3;
      setBusy(true);
      setRunning(function (m) { var n = Object.assign({}, m); list.forEach(function (c) { n[K(c.qid, c.sid)] = true; }); return n; });
      function fin(c) { if (!alive.current) return; setRunning(function (m) { var n = Object.assign({}, m); delete n[K(c.qid, c.sid)]; return n; }); }
      function pump() {
        if (!queue.length && active === 0) { if (alive.current) setBusy(false); return; }
        while (active < CONC && queue.length) {
          (function (c) {
            active++;
            callEdge('research-extract', { action: 'run_cell', question_id: c.qid, source_id: c.sid }).then(function (d) {
              active--;
              var cell = d && d.cell;
              if (cell && alive.current) setCells(function (m) { var n = Object.assign({}, m); n[K(cell.question_id, cell.source_id)] = cell; return n; });
              else if (alive.current && d && d.error) setCells(function (m) { var n = Object.assign({}, m); n[K(c.qid, c.sid)] = { question_id: c.qid, source_id: c.sid, status: 'error', error: d.error }; return n; });
              fin(c); pump();
            }, function () { active--; fin(c); pump(); });
          })(queue.shift());
        }
      }
      pump();
    }
    function addQ() {
      var t = (input || '').trim(); if (!t || !canEdit) return;
      var ord = (questions || []).length;
      sb.from('research_extraction_questions').insert({ project_id: pid, study_id: sid, text: t.slice(0, 300), answer_type: 'text', source_mode: 'both', ord: ord, created_by: uid() }).select('*').maybeSingle().then(function (r) {
        if (r && r.error) { toast(r.error.message, false); return; }
        var q = r && r.data; if (!alive.current || !q) return;
        setQuestions(function (l) { return (l || []).concat([q]); }); setInput('');
        runCells(incIds.map(function (id) { return { qid: q.id, sid: id }; }));
      });
    }
    function delQ(q) { if (!canEdit) return; sb.from('research_extraction_questions').delete().eq('id', q.id).then(function () { setQuestions(function (l) { return (l || []).filter(function (x) { return x.id !== q.id; }); }); }); }
    function rerunQ(q) { runCells(incIds.map(function (id) { return { qid: q.id, sid: id }; })); }
    function runMissing() {
      var list = []; (questions || []).forEach(function (q) { incIds.forEach(function (id) { var c = cells[K(q.id, id)]; if (!c || c.status === 'pending' || c.status === 'error') list.push({ qid: q.id, sid: id }); }); });
      if (!list.length) { toast('Minden cella kész.'); return; } runCells(list);
    }
    var qs = questions;
    function locStr(c) { var l = (c && c.location) || {}; var b = []; if (l.figure) b.push('🖼️ ' + l.figure); if (l.page != null) b.push('📄 ' + l.page + '. o.'); if (l.section) b.push('§ ' + l.section); if (!b.length) b.push(l.basis === 'abstract' ? 'absztrakt' : 'teljes szöveg'); return b.join(' · '); }
    function cellTd(q, id, s) {
      var kk = K(q.id, id), c = cells[kk], run = running[kk], open = openCell === kk;
      if (run) return h('td', { className: 'ap-ex-c', key: q.id }, h('span', { className: 'ap-ex-na' }, '⏳'));
      if (!c) return h('td', { className: 'ap-ex-c', key: q.id }, canEdit ? h('button', { className: 'ap-ex-run1', title: 'Cella kinyerése', onClick: function () { runCells([{ qid: q.id, sid: id }]); } }, '▷') : h('span', { className: 'ap-ex-na' }, '—'));
      if (c.status === 'error') return h('td', { className: 'ap-ex-c', key: q.id }, h('span', { className: 'ap-ex-na', title: c.error || 'hiba' }, '⚠'), canEdit ? h('button', { className: 'ap-ex-run1', onClick: function () { runCells([{ qid: q.id, sid: id }]); } }, '↻') : null);
      if (c.status === 'na') return h('td', { className: 'ap-ex-c', key: q.id }, h('span', { className: 'ap-ex-na' }, 'N/A'));
      return h('td', { className: 'ap-ex-c' + (open ? ' open' : ''), key: q.id },
        h('button', { className: 'ap-ex-cell', title: 'Idézet / referencia', onClick: function () { setOpenCell(open ? null : kk); } },
          h('span', { className: 'ap-ex-cv' }, c.answer || ''),
          h('span', { className: 'ap-ex-conf ' + (c.confidence === 'high' ? 'hi' : c.confidence === 'mid' ? 'mid' : 'na') })),
        open ? h('div', { className: 'ap-ex-ev' },
          c.quote ? h('div', { className: 'ap-ex-cq2' }, '„' + c.quote + '"') : h('div', { className: 'ap-ex-cq2 m' }, '(nincs idézet)'),
          h('div', { className: 'ap-ex-loc' }, '📍 ' + locStr(c), s.url ? h('a', { className: 'ap-ex-lnk', href: s.url, target: '_blank', rel: 'noopener' }, ' · forrás ↗') : null)) : null);
    }
    return h('div', { className: 'ap-ex' },
      h('div', { className: 'ap-ex-h' },
        h('b', null, '🔎 Kérdések a publikációkhoz'),
        h('span', { className: 'ap-ex-sub' }, incIds.length + ' included cikk · add meg a kérdéseket fent — a válaszok táblázata (cikkek × kérdések) a cikkek mellett épül fel, idézettel; a Studies kivonatolásában is megjelenik')),
      canEdit ? h('div', { className: 'ap-ex-add' },
        h('input', { className: 'ap-ex-in', value: input, placeholder: 'Új kérdés, pl. „Mekkora a minta mérete?"', onKeyDown: function (e) { if (e.key === 'Enter') addQ(); }, onChange: function (e) { setInput(e.target.value); } }),
        h('button', { className: 'btn pri sm', disabled: !input.trim() || !incIds.length, title: incIds.length ? null : 'Előbb jelölj ki legalább egy included cikket', onClick: addQ }, '＋ Kérdés')) : null,
      !incIds.length ? h('div', { className: 'ap-ex-empty' }, 'Nincs included cikk — jelölj ki legalább egyet fent, hogy kérdezhess róluk.')
        : qs === null ? h('div', { className: 'ap-ex-empty' }, h('span', { className: 'spin' }), ' betöltés…')
          : !qs.length ? h('div', { className: 'ap-ex-empty' }, 'Írj be egy kérdést fent — a válaszok táblázata (cikkek × kérdések) itt épül fel, cikkenként idézettel vagy őszinte „N/A"-val.')
            : h('div', { className: 'ap-ex-tscroll' },
              h('table', { className: 'ap-ex-t' },
                h('thead', null, h('tr', null,
                  h('th', { className: 'ap-ex-cpub' }, 'Publikáció (' + incIds.length + ')'),
                  qs.map(function (q) {
                    var done = 0; incIds.forEach(function (id) { var c = cells[K(q.id, id)]; if (c && (c.status === 'done' || c.status === 'na')) done++; });
                    return h('th', { className: 'ap-ex-cq', key: q.id },
                      h('div', { className: 'ap-ex-qhh' },
                        h('span', { className: 'ap-ex-qtt', title: q.text }, q.text),
                        canEdit ? h('span', { className: 'ap-ex-qax' },
                          h('button', { title: 'Oszlop újrafuttatása', onClick: function () { rerunQ(q); } }, '↻'),
                          h('button', { title: 'Kérdés (oszlop) törlése', onClick: function () { delQ(q); } }, '×')) : null),
                      h('span', { className: 'ap-ex-qm' }, done + '/' + incIds.length + ' kész'));
                  }))),
                h('tbody', null, incIds.map(function (id) {
                  var s = srcMap[id] || {};
                  return h('tr', { key: id },
                    h('td', { className: 'ap-ex-cpub' },
                      h('div', { className: 'ap-ex-pt', title: s.title || '' }, s.url ? h('a', { href: s.url, target: '_blank', rel: 'noopener' }, s.title || 'Forrás') : (s.title || 'Forrás')),
                      h('div', { className: 'ap-ex-pm' }, [s.year, s.venue].filter(Boolean).join(' · '))),
                    qs.map(function (q) { return cellTd(q, id, s); }));
                })))),
      (qs && qs.length && incIds.length && canEdit) ? h('button', { className: 'btn sm ap-ex-mm', disabled: busy, onClick: runMissing }, busy ? '⏳ fut…' : '↻ Hiányzók futtatása') : null);
  }

  function Dashboard(props) {
    var rS = useState(null), run = rS[0], setRun = rS[1];
    var pjS = useState(null), project = pjS[0], setProject = pjS[1];
    var evS = useState([]), events = evS[0], setEvents = evS[1];
    var tS = useState(0), tick = tS[0], setTick = tS[1];
    var nfS = useState(false), notFound = nfS[0], setNotFound = nfS[1];
    var opS = useState(null), openPhase = opS[0], setOpenPhase = opS[1];   // which phase card is expanded to show its real artifacts
    var paS = useState({}), phaseArts = paS[0], setPhaseArts = paS[1];     // phase key → { loading, items, total } (lazy-fetched)
    var pvS = useState(null), preview = pvS[0], setPreview = pvS[1];        // { title, content } → the readable review preview modal
    var ppvS = useState(null), protoPv = ppvS[0], setProtoPv = ppvS[1];    // { title, goal, steps:[...] } → the protocol task-cards modal
    var lrS = useState(null), litRev = lrS[0], setLitRev = lrS[1];         // { prun, studyId, loading, order:[srcId], sources, eff:{srcId:decision}, meta, dirty } → the side screening-review drawer
    // resizable review drawer: drag its left edge; the chosen width is remembered across sessions
    var DW_MIN = 380, DW_KEY = 'ap-dw-width';
    var dwS = useState(function () { var v = 0; try { v = parseInt(localStorage.getItem(DW_KEY) || '', 10); } catch (e) { } return (v >= DW_MIN) ? v : 560; });
    var dwW = dwS[0], setDwW = dwS[1];
    var dwDrag = useRef(false), dwLast = useRef(0);   // dwLast: the width actually dragged to (a stale closure must not be persisted)
    function dwMax() { try { return Math.max(DW_MIN, window.innerWidth - 80); } catch (e) { return 1200; } }
    function dwResizeStart(e) {
      e.preventDefault(); e.stopPropagation();
      dwDrag.current = true;
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch (er) { }
      try { document.body.style.userSelect = 'none'; document.body.style.cursor = 'col-resize'; } catch (er) { }
    }
    function dwResizeMove(e) {
      if (!dwDrag.current) return;
      var w = Math.round(window.innerWidth - e.clientX);          // the drawer is anchored to the right edge
      var cl = Math.max(DW_MIN, Math.min(dwMax(), w));
      dwLast.current = cl; setDwW(cl);
    }
    function dwResizeEnd(e) {
      if (!dwDrag.current) return;
      dwDrag.current = false;
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (er) { }
      try { document.body.style.userSelect = ''; document.body.style.cursor = ''; } catch (er) { }
      try { localStorage.setItem(DW_KEY, String(dwLast.current || dwW)); } catch (er) { }
    }
    // ── Canvas: parallel threads grow SIDEWAYS, so the graph is a pannable/zoomable board rather than a column.
    var CZ_KEY = 'ap-canvas-zoom', Z_MIN = 0.4, Z_MAX = 1.4;
    var czS = useState(function () { var v = 0; try { v = parseFloat(localStorage.getItem(CZ_KEY) || ''); } catch (e) { } return (v >= Z_MIN && v <= Z_MAX) ? v : 1; });
    var zoom = czS[0], setZoom = czS[1];
    var cfS = useState(false), cvFull = cfS[0], setCvFull = cfS[1];
    var cvRef = useRef(null), stageRef = useRef(null), sizerRef = useRef(null), panRef = useRef(null), panEat = useRef(false);
    var cvTouched = useRef(false);   // once the user moves the board themselves, stop re-centring it under them
    function setZoomP(z) {
      z = Math.max(Z_MIN, Math.min(Z_MAX, Math.round(z * 100) / 100));
      setZoom(z); try { localStorage.setItem(CZ_KEY, String(z)); } catch (e) { }
    }
    function fitZoom() {
      var cv = cvRef.current, st = stageRef.current; if (!cv || !st) return;
      var w = st.offsetWidth || 1;
      setZoomP(Math.min(1, (cv.clientWidth - 40) / w));
    }
    // The stage is scaled with a transform, which does NOT change its layout box — so the scroll area is sized
    // explicitly from the stage's natural size × zoom, otherwise zooming in would simply clip the graph.
    useEffect(function () {
      var st = stageRef.current, sz = sizerRef.current; if (!st || !sz) return;
      var sync = function () {
        try {
          sz.style.width = Math.ceil(st.offsetWidth * zoom) + 'px';
          sz.style.height = Math.ceil(st.offsetHeight * zoom) + 'px';
          // Threads load in asynchronously, so the board keeps getting wider — keep the flow centred until the
          // user takes the wheel, otherwise a wide board would open scrolled off to one side.
          var cv = cvRef.current;
          if (cv && !cvTouched.current) cv.scrollLeft = Math.max(0, (sz.offsetWidth - cv.clientWidth) / 2);
        } catch (e) { }
      };
      sync();
      var ro = null; try { ro = new ResizeObserver(sync); ro.observe(st); } catch (e) { }
      window.addEventListener('resize', sync);
      return function () { try { ro && ro.disconnect(); } catch (e) { } window.removeEventListener('resize', sync); };
    }, [zoom, cvFull, run && run.id]);
    useEffect(function () {
      if (!cvFull) return;
      var onKey = function (e) { if (e.key === 'Escape') setCvFull(false); };
      window.addEventListener('keydown', onKey);
      return function () { window.removeEventListener('keydown', onKey); };
    }, [cvFull]);
    // Draw the branch connectors in STAGE coordinates (the stage is transform:scale'd, so divide out the zoom).
    useEffect(function () {
      var stage = stageRef.current; if (!stage) return;
      var apply = function () {
        var sr = stage.getBoundingClientRect(), out = [];
        var byIdea = {};
        Array.prototype.forEach.call(stage.querySelectorAll('[data-idea-card]'), function (el) { byIdea[el.getAttribute('data-idea-card')] = el; });
        Array.prototype.forEach.call(stage.querySelectorAll('[data-col-from]'), function (col) {
          var srcId = col.getAttribute('data-col-from'); if (!srcId) return;
          var from = byIdea[srcId]; if (!from) return;
          var a = from.getBoundingClientRect(), b = col.getBoundingClientRect();
          var x1 = (a.left + a.width / 2 - sr.left) / zoom, y1 = (a.bottom - sr.top) / zoom;
          var x2 = (b.left + b.width / 2 - sr.left) / zoom, y2 = (b.top - sr.top) / zoom;
          if (!isFinite(x1) || !isFinite(x2)) return;
          var dy = Math.max(16, (y2 - y1) / 2);
          out.push({ k: srcId + '>' + (col.getAttribute('data-col-id') || ''), live: col.getAttribute('data-col-live') === '1',
            d: 'M' + x1.toFixed(1) + ',' + y1.toFixed(1) + ' C' + x1.toFixed(1) + ',' + (y1 + dy).toFixed(1) + ' ' + x2.toFixed(1) + ',' + (y2 - dy).toFixed(1) + ' ' + x2.toFixed(1) + ',' + y2.toFixed(1) });
        });
        setLinks(function (prev) {
          if (prev.length === out.length && prev.every(function (p, i) { return p.d === out[i].d && p.k === out[i].k && p.live === out[i].live; })) return prev;
          return out;
        });
      };
      apply();
      var ro = null; try { ro = new ResizeObserver(apply); ro.observe(stage); } catch (e) { }
      window.addEventListener('resize', apply);
      return function () { try { ro && ro.disconnect(); } catch (e) { } window.removeEventListener('resize', apply); };
    });
    var PAN_SKIP = 'button, a, input, textarea, select, label, [data-nopan]';
    var PAN_SLOP = 4;   // below this the gesture is a CLICK, not a pan
    function panStart(e) {
      if (e.button !== 0 && e.button !== 1) return;
      try { if (e.target && e.target.closest && e.target.closest(PAN_SKIP)) return; } catch (er) { }
      var el = cvRef.current; if (!el) return;
      // Deliberately NO setPointerCapture here: capturing on pointerdown retargets the follow-up mouse/click
      // events to the canvas, which swallowed every click on a card. The capture is taken only once the
      // gesture actually becomes a drag (below).
      panRef.current = { x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop, moved: 0, active: false, id: e.pointerId };
    }
    function panMove(e) {
      var p = panRef.current, el = cvRef.current; if (!p || !el) return;
      var dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.moved = Math.max(p.moved, Math.abs(dx) + Math.abs(dy));
      if (!p.active) {
        if (p.moved < PAN_SLOP) return;
        p.active = true; cvTouched.current = true;
        try { el.setPointerCapture(p.id); } catch (er) { }
        el.classList.add('panning');
      }
      el.scrollLeft = p.sl - dx; el.scrollTop = p.st - dy;
    }
    function panEnd(e) {
      var p = panRef.current, el = cvRef.current; if (!p) return;
      panRef.current = null;
      if (el && p.active) { el.classList.remove('panning'); try { el.releasePointerCapture(p.id); } catch (er) { } }
      if (p.moved > PAN_SLOP) panEat.current = true;   // a drag must not also "click" the card it started on
    }
    function panClick(e) { if (panEat.current) { panEat.current = false; e.stopPropagation(); e.preventDefault(); } }
    var swS = useState(false), switching = swS[0], setSwitching = swS[1];   // guard while re-targeting the pipeline to a chosen idea
    var brS = useState([]), branchRuns = brS[0], setBranchRuns = brS[1];    // parallel per-idea branch runs (siblings of the primary run in the same group)
    var selS = useState({}), selIdeas = selS[0], setSelIdeas = selS[1];     // idea_id → true : ideas ticked for parallel development
    var sgS = useState({}), selGaps = sgS[0], setSelGaps = sgS[1];          // gap_id → true : research gaps ticked to develop into a protocol
    var gbrS = useState({}), gapsByRun = gbrS[0], setGapsByRun = gbrS[1];   // run_id → that thread's research gaps (its own study's)
    var gbS = useState(false), gapBusy = gbS[0], setGapBusy = gbS[1];       // protocol-from-gaps generation in flight
    var ltS = useState({}), litProg = ltS[0], setLitProg = ltS[1];          // run_id → { study_id, steps:[{step,kind,status,cursor,total,counts}], ts } : LIVE literature screening numbers
    var ptaS = useState({}), protoArts = ptaS[0], setProtoArts = ptaS[1];   // run_id → [protocol steps] : inline task cards shown under the Protocol card in the graph
    var poS = useState({}), protoOpen = poS[0], setProtoOpen = poS[1];       // run_id → false to collapse the inline protocol task cards (default = expanded)
    var rgS = useState({}), regenning = rgS[0], setRegenning = rgS[1];       // run_id → true while its protocol is being regenerated
    var teS = useState(null), taskEd = teS[0], setTaskEd = teS[1];           // the protocol task card opened for editing (ToDo editor + AI chat)
    var lkS = useState([]), links = lkS[0], setLinks = lkS[1];               // SVG connectors: idea card → the column developing it
    var exqS = useState(null), exqMgr = exqS[0], setExqMgr = exqS[1];        // { prun, studyId, loading, items:[], input, busy } → extraction-question manager
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
            sb.from('research_autopilot_runs').select('*').eq('id', props.runId).maybeSingle().order('created_at', { ascending: true }).then(function (x) { if (alive.current && x && x.data) setRun(x.data); });
            return;
          }
          ensureProject(r.project_id).then(function (proj) {
            if (!alive.current || !driving.current) { driving.current = false; return; }
            if (!proj) { driving.current = false; return; }
            // single-shot phases (sr/gap/protocol/journal/submission) otherwise flip wait→done with no interim state →
            // their card never pulses even while a slow edge call runs. Mark the current phase 'running' first so it pulses.
            var cph0 = (r.phases || [])[r.phase_index];
            if (cph0 && cph0.status === 'wait') {
              var php0 = r.phases.slice(); php0[r.phase_index] = Object.assign({}, cph0, { status: 'running' });
              r = Object.assign({}, r, { phases: php0 }); setRun(r);
              sb.from('research_autopilot_runs').update({ phases: php0 }).eq('id', r.id).eq('driver_token', myDriver.current);
            }
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
    // eager-load the research gaps so the fan shows them as developable cards. Gaps are PROJECT-scoped (research_ideas
    // source='gap'), so load them whenever they might exist — NOT gated on the current run's gap phase status (a run whose
    // own gap phase was skipped, e.g. an unscreened first pass, still lives in a project that has gaps from another run).
    // Per-THREAD gaps for the in-flow cards: each column shows the gaps ITS systematic review revealed
    // (migration-114); legacy/unscoped data falls back to the project's gaps.
    useEffect(function () {
      if (!run || !run.project_id) return;
      var pid = run.project_id;
      [run].concat(branchRuns || []).filter(Boolean).forEach(function (rr) {
        var sid = rr.study_id || null;
        var q = function (withStudy) {
          var b = sb.from('research_ideas').select('id,question,hypothesis,novelty,gap_type,rationale,created_at').eq('project_id', pid).eq('source', 'gap').neq('status', 'rejected');
          if (withStudy && sid) b = b.eq('study_id', sid);
          return b.order('created_at', { ascending: false }).limit(8);
        };
        // The cards are NUMBERED and the protocol points back at those numbers, so the order must be identical on
        // every load — a batch insert gives the gaps the same created_at, so tie-break on id.
        var set = function (items) {
          var sorted = (items || []).slice().sort(function (a, b2) {
            var d = String(b2.created_at || '').localeCompare(String(a.created_at || ''));
            return d || String(a.id).localeCompare(String(b2.id));
          });
          if (alive.current) setGapsByRun(function (m) { var n = Object.assign({}, m); n[rr.id] = sorted; return n; });
        };
        // ONLY the primary column may fall back to the project's gaps. A branch showing another thread's gaps would
        // invite the user to develop a gap that its own review never produced.
        var fallback = function () { if (rr.id !== run.id) { set([]); return; } q(false).then(function (r2) { set((r2 && r2.data) || []); }, function () { set([]); }); };
        q(true).then(function (r) {
          if ((r && r.error) || !((r && r.data) || []).length) { fallback(); return; }
          set(r.data);
        }, fallback);
      });
      // deps: EVERY run's own identity + study + gap status — a branch acquires its study_id and finishes its gap
      // phase long after branchRuns.length last changed, and the primary's status never reflects that (litSig pattern).
    }, [run && run.project_id, [run].concat(branchRuns || []).filter(Boolean).map(function (r) {
      var gp = (r.phases || []).filter(function (x) { return x.key === 'gap'; })[0];
      return r.id + ':' + (r.study_id || '') + ':' + ((gp && gp.status) || '');
    }).join('|')]);
    useEffect(function () {
      if (!run || !run.project_id) return;
      loadPhaseArts('gap');
    }, [run && run.project_id, run && (run.phases || []).filter(function (x) { return x.key === 'gap'; }).map(function (x) { return x.status; }).join(''), (branchRuns || []).length]);

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
            var cph0 = (r.phases || [])[r.phase_index];   // pulse single-shot phases while their edge call runs (see drive())
            if (cph0 && cph0.status === 'wait') {
              var php0 = r.phases.slice(); php0[r.phase_index] = Object.assign({}, cph0, { status: 'running' });
              r = Object.assign({}, r, { phases: php0 }); setBranchRow(r);
              sb.from('research_autopilot_runs').update({ phases: php0 }).eq('id', r.id).eq('driver_token', myDriver.current);
            }
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
    // research_autopilot_runs is NOT in the realtime publication → the graph would only reflect runs THIS tab drives.
    // Poll the group runs' state so the cards track real progress even when another tab (or a stale lease) is driving.
    // Skip runs this tab is actively driving (their local optimistic state is fresher mid-tick).
    function refreshRuns() {
      var ids = [props.runId].concat((branchRunsRef.current || []).map(function (b) { return b.id; }).filter(Boolean));
      if (!ids.length) return;
      sb.from('research_autopilot_runs').select('*').in('id', ids).then(function (r) {
        if (!alive.current) return;
        ((r && r.data) || []).forEach(function (row) {
          try {
            if (!row || !Array.isArray(row.phases)) return;   // never feed a malformed row into the render
            if (row.id === props.runId) { if (!driving.current) { setRun(row); ensureDrive(row); } }
            else if (!bDriving.current[row.id]) { setBranchRow(row); ensureBranchDrive(row); }
          } catch (e) { }
        });
      });
    }
    useEffect(function () {
      loadEvents(); refreshRuns();
      var iv = setInterval(function () { if (activeRef.current) { loadEvents(); refreshRuns(); } }, 3000);
      return function () { clearInterval(iv); };
    }, [props.runId, (branchRuns || []).map(function (b) { return b.id; }).join(',')]);

    // LIVE Literature numbers: while a group run's literature phase is running/gated/done, poll its research_study_steps
    // (cursor/total/counts per step) so the graph's Literature card shows the search + screening figures changing live.
    function loadLitProg() {
      var runs = [run].concat(branchRunsRef.current || []).filter(Boolean);
      var sidToRun = {}, sids = [];
      runs.forEach(function (r) {
        var lp = (r.phases || []).filter(function (p) { return p.key === 'literature'; })[0];
        if (r.study_id && lp && (lp.status === 'running' || lp.status === 'gate' || lp.status === 'done')) { sidToRun[r.study_id] = r.id; sids.push(r.study_id); }
      });
      if (!sids.length) return;
      sb.from('research_study_steps').select('study_id,step,kind,status,cursor,total,counts').in('study_id', sids).then(function (res) {
        if (!alive.current) return;
        var byStudy = {}; ((res && res.data) || []).forEach(function (s) { (byStudy[s.study_id] = byStudy[s.study_id] || []).push(s); });
        // the FINAL included count is the source-of-truth from research_study_papers step-3 (reflects MANUAL overrides too,
        // which the step counts do NOT) — so the card's included figure changes after the user rescues papers in the drawer
        sb.from('research_study_papers').select('study_id,decision').in('study_id', sids).eq('step', 3).then(function (pr) {
          if (!alive.current) return;
          var incl3 = {}; ((pr && pr.data) || []).forEach(function (p) { if (p.decision === 'include') incl3[p.study_id] = (incl3[p.study_id] || 0) + 1; });
          setLitProg(function (prev) {
            var next = Object.assign({}, prev);
            Object.keys(sidToRun).forEach(function (sid) { if (byStudy[sid]) next[sidToRun[sid]] = { study_id: sid, steps: byStudy[sid], finalIncluded: (incl3[sid] || 0), ts: Date.now() }; });
            return next;
          });
        });
      });
    }
    // litSig is STABLE during screening (status stays 'running', study_id fixed) → the 2.5s interval is the poller;
    // it re-fires (and fetches once) only when a literature phase flips state (started / gated / done).
    var litSig = [run].concat(branchRuns || []).filter(Boolean).map(function (r) { var lp = (r.phases || []).filter(function (p) { return p.key === 'literature'; })[0]; return r.id + ':' + (r.study_id || '') + ':' + ((lp && lp.status) || ''); }).join('|');
    useEffect(function () {
      loadLitProg();
      var iv = setInterval(function () { if (activeRef.current) loadLitProg(); }, 2500);
      return function () { clearInterval(iv); };
    }, [litSig]);
    // Inline PROTOCOL tasks: once a group run's protocol phase has generated steps, fetch them so the graph shows the
    // task cards directly under the Protocol card (not only in the click-through modal). Loaded once per state change.
    function loadProtoArts() {
      var runs = [run].concat(branchRunsRef.current || []).filter(Boolean);
      var pidToRun = {}, pids = [];
      runs.forEach(function (r) { var pp = (r.phases || []).filter(function (p) { return p.key === 'protocol'; })[0]; if (r.protocol_id && pp && (pp.status === 'done' || pp.status === 'gate' || pp.status === 'running')) { (pidToRun[r.protocol_id] = pidToRun[r.protocol_id] || []).push(r.id); pids.push(r.protocol_id); } });   // several runs can share an ADOPTED protocol — map to ALL of them, else one column renders empty
      if (!pids.length) return;
      sb.from('research_protocol_steps').select('id,protocol_id,ord,title,kind,needs_approval,status,spec').in('protocol_id', pids).order('ord', { ascending: true }).then(function (res) {
        if (!alive.current) return;
        var byProto = {}; ((res && res.data) || []).forEach(function (s) { (byProto[s.protocol_id] = byProto[s.protocol_id] || []).push(s); });
        setProtoArts(function (prev) { var next = Object.assign({}, prev); Object.keys(pidToRun).forEach(function (pid) { if (byProto[pid]) (pidToRun[pid] || []).forEach(function (rid) { next[rid] = byProto[pid]; }); }); return next; });
      });
    }
    var protoSig = [run].concat(branchRuns || []).filter(Boolean).map(function (r) { var pp = (r.phases || []).filter(function (p) { return p.key === 'protocol'; })[0]; return r.id + ':' + (r.protocol_id || '') + ':' + ((pp && pp.status) || ''); }).join('|');
    useEffect(function () { loadProtoArts(); }, [protoSig]);

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
    var DOWN = ['literature', 'sr', 'extract', 'gap', 'protocol', 'journal', 'writing', 'submission'];
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
    function toggleGap(id) { setSelGaps(function (m) { var n = Object.assign({}, m); if (n[id]) delete n[id]; else n[id] = true; return n; }); }
    // BRANCH AGAIN at the Research Gap phase: each ticked gap spawns its OWN parallel sibling run that generates a protocol
    // FOR THAT GAP. The runs start at the PROTOCOL phase (the shared literature/review is already collected) → each gap
    // develops into its own protocol, shown as a parallel column next to the idea branches.
    function startGapBranches(ids, srcRun) {
      ids = (ids && ids.length) ? ids : Object.keys(selGaps).filter(function (id) { return selGaps[id]; });
      // a gap already being developed must not get a SECOND run — its tasks would be paid for but unreachable
      var dup = ids.filter(function (id) { return (branchRuns || []).some(function (rr) { return rr && rr.config && rr.config.develop_idea_id === id && rr.status !== 'cancelled'; }); });
      ids = ids.filter(function (id) { return dup.indexOf(id) < 0; });
      if (dup.length) toast(dup.length + ' rés kidolgozása már fut — kihagyva.', false);
      if (!ids.length || gapBusy || !run) { if (!ids.length) setGapBusy(false); return; }
      setGapBusy(true);
      // clone the phases/config of the column the gaps were ticked in — not always the primary
      var grp = groupOf(run), prev = srcRun || run;
      function spawn() {
        var protoIdx = -1; (prev.phases || []).forEach(function (p, k) { if (p.key === 'protocol' && protoIdx < 0) protoIdx = k; });
        // everything up to (and incl.) the gap phase is shared/done; the protocol phase is the branch's real work
        var mkGapPhases = function () {
          return (prev.phases || []).map(function (p, k) {
            if (AP_WIP[p.key]) return Object.assign({}, p, { status: 'wip', result: 'fejlesztés alatt', cursor: {} });
            if (protoIdx >= 0 && k < protoIdx) return Object.assign({}, p, { status: 'done', cursor: p.cursor || {}, result: p.result || 'kész' });
            return p.enabled ? Object.assign({}, p, { status: 'wait', cursor: null, result: null }) : Object.assign({}, p, { status: 'skipped' });
          });
        };
        var inserts = ids.map(function (gapId) { return { project_id: prev.project_id, owner_id: uid(), status: 'running', started_at: nowIso(), phase_index: protoIdx >= 0 ? protoIdx : 0, phases: mkGapPhases(), config: Object.assign({}, prev.config || {}, { develop_idea_id: gapId, develop_kind: 'gap', group_id: grp, gates: false }) }; });   // develop_kind marks a GAP thread even before its gap row is loaded
        sb.from('research_autopilot_runs').insert(inserts).select('*').then(function (ir) {
          setGapBusy(false); setSelGaps(function (m) { var n = Object.assign({}, m); ids.forEach(function (id) { delete n[id]; }); return n; });   // clear only what we just launched
          var created = (ir && ir.data) || []; setBranchRuns(function (l) { return (l || []).concat(created); }); created.forEach(ensureBranchDrive);
          toast('▶ ' + ids.length + ' kutatási rés párhuzamos kidolgozása (protokoll) elindult.', true);
        }, function () { setGapBusy(false); toast('Nem sikerült elindítani a szálakat.', false); });
      }
      // stamp the primary with a stable group so the branches render as sibling columns
      if (!(run.config && run.config.group_id)) {
        var cfgP = Object.assign({}, run.config || {}, { group_id: grp });
        setRun(Object.assign({}, run, { config: cfgP }));
        sb.from('research_autopilot_runs').update({ config: cfgP }).eq('id', run.id).then(spawn, spawn);
      } else spawn();
    }
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
        // step 2 = plain research ideas only; the research GAPS (source='gap') belong to the Research Gap phase's own fan
        sb.from('research_ideas').select('id,question,hypothesis,novelty,source').eq('project_id', pid).neq('status', 'rejected').neq('source', 'gap').order('created_at', { ascending: false }).limit(15)
          .then(function (r) { if (alive.current) put({ items: (r && r.data) || [] }); }, function () { if (alive.current) put({ items: [] }); });
      } else if (key === 'gap') {
        // developable research-gap cards (grounded in the collected library)
        var gsid = (run && run.study_id) || null;
        var base = function (withStudy) {
          var q = sb.from('research_ideas').select('id,question,hypothesis,novelty,source,gap_type,rationale').eq('project_id', pid).eq('source', 'gap').neq('status', 'rejected');
          if (withStudy && gsid) q = q.eq('study_id', gsid);
          return q.order('created_at', { ascending: false }).limit(20);
        };
        base(true).then(function (r) {
          // no study column yet (migration-114) or no thread-scoped gaps → fall back to the project's gaps
          if ((r && r.error) || !((r && r.data) || []).length) { base(false).then(function (r2) { if (alive.current) put({ items: (r2 && r2.data) || [] }); }, function () { if (alive.current) put({ items: [] }); }); return; }
          if (alive.current) put({ items: r.data });
        }, function () { base(false).then(function (r2) { if (alive.current) put({ items: (r2 && r2.data) || [] }); }, function () { if (alive.current) put({ items: [] }); }); });
      } else if (key === 'literature') {
        Promise.all([
          sb.from('research_sources').select('id', { count: 'exact', head: true }).eq('project_id', pid),
          sb.from('research_sources').select('id,title,year,url,screening').eq('project_id', pid).eq('screening', 'include').order('cited_by', { ascending: false, nullsFirst: false }).limit(15)
        ]).then(function (res) { if (alive.current) put({ total: (res[0] && res[0].count) || 0, items: (res[1] && res[1].data) || [] }); }, function () { if (alive.current) put({ items: [] }); });
      } else if (key === 'sr') {
        // the generated systematic review is a markdown file in research_files (studies/…-review.md)
        var s8 = String((run && run.study_id) || '').slice(0, 8);   // this run's study — not every study in the project
        var fq = sb.from('research_files').select('id,path,content,updated_at').eq('project_id', pid);
        fq = s8 ? fq.ilike('path', 'studies/%-' + s8 + '-review.md') : fq.ilike('path', 'studies/%');
        fq.order('updated_at', { ascending: false }).limit(8)
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
        var developing = {}, autoDev = {};
        [run].concat(branchRuns || []).forEach(function (rr) { var did = rr && rr.config && rr.config.develop_idea_id; if (did) { developing[did] = rr; if (rr.config.develop_auto) autoDev[did] = 1; } });
        // Before the literature phase stamps the real pick there is nothing to read — say so instead of
        // presenting the guess as a fact.
        var guessed = null;
        if (!Object.keys(developing).length && ideas[0]) { developing[ideas[0].id] = run; guessed = ideas[0].id; }
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
            return h('div', { className: 'apg-idea' + (dev ? ' active' : '') + (sel ? ' sel' : ''), key: x.id, 'data-idea-card': x.id, style: { '--hue': hueOf('ideas') }, title: (x.hypothesis || x.question || '') },
              h('span', { className: 'apg-idea-h' }, h('span', { className: 'apg-idea-ic' }, '💡'), (x.novelty != null) ? h('span', { className: 'apg-idea-n' }, '★ ' + x.novelty) : null),
              h('span', { className: 'apg-idea-t' }, x.question || 'Ötlet'),
              dev ? h('span', { className: 'apg-idea-badge' + (x.id === guessed ? ' guess' : ''), title: x.id === guessed ? 'Az Autopilot még nem rögzítette a választását — ez a legfrissebb ötlet.' : (autoDev[x.id] ? 'Az Autopilot automatikusan ezt választotta kidolgozásra.' : 'Te jelölted ki kidolgozásra.') },
                    x.id === guessed ? '◉ Ezt fogja kidolgozni' : (autoDev[x.id] ? '◉ Automatikusan kidolgozás alatt' : '◉ Fejlesztés alatt'))
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
      // The review file is written as studies/<slug>-<studyId8>-review.md, so it MUST be matched on this thread's
      // study — the old query took the project's most recently updated review and therefore showed the same file
      // for every parallel idea.
      var sid8 = String((prun && prun.study_id) || '').slice(0, 8);
      var q = sb.from('research_files').select('path,content').eq('project_id', pid);
      q = sid8 ? q.ilike('path', 'studies/%-' + sid8 + '-review.md') : q.ilike('path', 'studies/%');
      q.order('updated_at', { ascending: false }).limit(8).then(function (r) {
        var f = ((r && r.data) || []).filter(function (x) { return /\.md$/i.test(x.path) && x.content != null; })[0];
        if (f) setPreview({ title: String(f.path).split('/').pop(), content: f.content });
        else toast(sid8 ? 'Ehhez a szálhoz még nincs áttekintés-fájl.' : 'Nincs elérhető áttekintés-fájl.', false);
      });
    }
    function openGapPreview(prun) {   // the Research-gap report is a markdown file → reuse the markdown preview modal
      var pid = (prun && prun.project_id) || run.project_id;
      var gs8 = String((prun && prun.study_id) || '').slice(0, 8);
      var read = function (path) { return sb.from('research_files').select('path,content').eq('project_id', pid).eq('path', path).maybeSingle(); };
      var show = function (r) { var f = r && r.data; if (f && f.content != null) { setPreview({ title: 'Research Gap ellenőrzés', content: f.content }); return true; } return false; };
      // this thread's own report first; older runs wrote one shared file, so fall back to it
      (gs8 ? read('studies/gaps-' + gs8 + '.md') : Promise.resolve(null)).then(function (r) {
        if (show(r)) return;
        read('autopilot/research-gap.md').then(function (r2) { if (!show(r2)) toast('Nincs elérhető gap-jelentés.', false); }, function () { toast('Nincs elérhető gap-jelentés.', false); });
      }, function () { read('autopilot/research-gap.md').then(function (r2) { if (!show(r2)) toast('Nincs elérhető gap-jelentés.', false); }, function () { toast('Nincs elérhető gap-jelentés.', false); }); });
    }
    // ── Extraction QUESTIONS of this thread: list / add / delete. The questions live in the database from the
    //    moment the study is created, so the launch-time list is not enough — they must be editable here too.
    function openExq(prun) {
      var sid = prun && prun.study_id;
      if (!sid) { toast('Ehhez a szálhoz még nincs literatúra-study.', false); return; }
      setExqMgr({ prun: prun, studyId: sid, loading: true, items: [], input: '', busy: false });
      sb.from('research_extraction_questions').select('id,text,answer_type,source_mode,ord').eq('study_id', sid).order('ord', { ascending: true }).then(function (r) {
        setExqMgr(function (m) { return m && m.studyId === sid ? Object.assign({}, m, { loading: false, items: (r && r.data) || [] }) : m; });
      }, function () { setExqMgr(function (m) { return m ? Object.assign({}, m, { loading: false }) : m; }); });
    }
    function exqDel(q) {
      if (!window.confirm('Törlöd ezt a kérdést?\n\n„' + String(q.text || '').slice(0, 120) + '"\n\nA hozzá tartozó kivonatolt válaszok is eltűnnek.')) return;
      setExqMgr(function (m) { return m ? Object.assign({}, m, { busy: true }) : m; });
      sb.from('research_extraction_cells').delete().eq('question_id', q.id).then(function () {
        return sb.from('research_extraction_questions').delete().eq('id', q.id);
      }).then(function (r) {
        if (r && r.error) { toast('Törlés hiba: ' + r.error.message, false); setExqMgr(function (m) { return m ? Object.assign({}, m, { busy: false }) : m; }); return; }
        setExqMgr(function (m) { return m ? Object.assign({}, m, { busy: false, items: (m.items || []).filter(function (x) { return x.id !== q.id; }) }) : m; });
        toast('✓ Kérdés törölve', true);
      }, function () { toast('Hálózati hiba.', false); setExqMgr(function (m) { return m ? Object.assign({}, m, { busy: false }) : m; }); });
    }
    function exqAdd() {
      var m0 = exqMgr; if (!m0) return;
      var t = String(m0.input || '').trim(); if (!t) return;
      setExqMgr(function (m) { return m ? Object.assign({}, m, { busy: true }) : m; });
      var ord = (m0.items || []).length;
      sb.from('research_extraction_questions').insert({ project_id: (m0.prun.project_id || run.project_id), study_id: m0.studyId, text: t.slice(0, 300), answer_type: 'text', source_mode: 'fulltext', ord: ord, created_by: uid() }).select('*').maybeSingle().then(function (r) {
        if (!r || r.error) { toast('Hozzáadás hiba' + ((r && r.error) ? ': ' + r.error.message : ''), false); setExqMgr(function (m) { return m ? Object.assign({}, m, { busy: false }) : m; }); return; }
        setExqMgr(function (m) { return m ? Object.assign({}, m, { busy: false, input: '', items: (m.items || []).concat([r.data]) }) : m; });
      }, function () { toast('Hálózati hiba.', false); setExqMgr(function (m) { return m ? Object.assign({}, m, { busy: false }) : m; }); });
    }
    // ── Screening-review DRAWER: reopen a study's screened papers, override the AI decisions (e.g. rescue papers when
    //    a step excluded everything, or push "maybe" papers through), then continue the run with the chosen set.
    var SR_STEP = 3;   // generate_review (the SR phase) reads step-3 includes → every manual include is written here so it reaches the review
    function openLitReview(prun) {
      var sid = prun && prun.study_id;
      if (!sid) { toast('Ehhez a szálhoz még nincs literatúra-study.', false); return; }
      setLitRev({ prun: prun, studyId: sid, loading: true, order: [], sources: {}, eff: {}, meta: {}, dirty: false });
      sb.from('research_study_papers').select('source_id,step,decision,reason,score,signals,overridden').eq('study_id', sid).then(function (pr) {
        var rows = (pr && pr.data) || [];
        // meaningful set = papers that reached step ≥2 (passed the quick triage); show each source at its DEEPEST decision
        var deepest = {};
        rows.forEach(function (r) { if ((r.step || 0) < 2) return; var c = deepest[r.source_id]; if (!c || (r.step || 0) > (c.step || 0)) deepest[r.source_id] = r; });
        var ids = Object.keys(deepest);
        var eff = {}, meta = {};
        ids.forEach(function (id) { var r = deepest[id]; eff[id] = r.decision; meta[id] = { reason: r.reason, score: r.score, step: r.step, signals: r.signals, overridden: r.overridden }; });
        if (!ids.length) { if (alive.current) setLitRev(function (p) { return p && Object.assign({}, p, { loading: false, order: [], sources: {}, eff: {}, meta: {} }); }); return; }
        sb.from('research_sources').select('id,title,year,url,cited_by,venue').in('id', ids).then(function (sr) {
          if (!alive.current) return;
          var sources = {}; ((sr && sr.data) || []).forEach(function (s) { sources[s.id] = s; });
          // order: include → maybe → exclude, then by score desc
          var DORD = { include: 0, maybe: 1, exclude: 2, unscreened: 3 };
          ids.sort(function (a, b) { return (DORD[eff[a]] - DORD[eff[b]]) || ((meta[b].score || 0) - (meta[a].score || 0)); });
          setLitRev(function (p) { return p && Object.assign({}, p, { loading: false, order: ids, sources: sources, eff: eff, meta: meta }); });
        });
      });
    }
    function overrideDec(srcId, dec) {   // write the override at the SR-feeding step (3) with overridden=true so the pipeline keeps it
      var lr = litRev; if (!lr) return;
      var eff = Object.assign({}, lr.eff); eff[srcId] = dec;
      setLitRev(function (p) { return p && Object.assign({}, p, { eff: eff, dirty: true }); });
      // reflect the new included count on the graph's Literature card immediately (before any poll)
      var inc = Object.keys(eff).filter(function (id) { return eff[id] === 'include'; }).length;
      setLitProg(function (prev) { var lp = prev[lr.prun.id]; if (!lp) return prev; var n = Object.assign({}, prev); n[lr.prun.id] = Object.assign({}, lp, { finalIncluded: inc }); return n; });
      sb.from('research_study_papers').upsert({ study_id: lr.studyId, source_id: srcId, step: SR_STEP, decision: dec, overridden: true }, { onConflict: 'study_id,source_id,step' }).then(function (r) { if (r && r.error) toast('Mentés hiba: ' + r.error.message, false); });
    }
    function bulkPromote(fromDec) {   // promote every paper currently in `fromDec` → include
      var lr = litRev; if (!lr) return;
      lr.order.forEach(function (id) { if (lr.eff[id] === fromDec) overrideDec(id, 'include'); });
    }
    function continueLitReview() {   // "only overridden stays": advance the run to the phase after literature with the chosen includes
      var lr = litRev; if (!lr) return;
      var prun = lr.prun, incl = lr.order.filter(function (id) { return lr.eff[id] === 'include'; });
      if (!incl.length) { toast('Jelölj ki legalább egy included cikket a folytatáshoz.', false); return; }
      var phases = (prun.phases || []).slice(), litIdx = -1;
      for (var i = 0; i < phases.length; i++) { if (phases[i].key === 'literature') { litIdx = i; break; } }
      if (litIdx < 0) { toast('Nincs literature-fázis ebben a futásban.', false); return; }
      phases[litIdx] = Object.assign({}, phases[litIdx], { status: 'done', result: incl.length + ' included (kézi felülbírálás)' });
      for (var j = litIdx + 1; j < phases.length; j++) { if (phases[j].enabled) phases[j] = Object.assign({}, phases[j], { status: 'wait', cursor: null, result: null }); }
      var ni = apNextIndex(phases, litIdx); if (ni === -1) ni = litIdx;
      var nextLabel = (phases[ni] && phases[ni].label) || 'a következő fázis';
      var patch = { phases: phases, phase_index: ni, status: 'running', gate: null, error: null, study_id: lr.studyId };
      retryRef.current[prun.id] = 0;
      // visible confirmation in the Activity feed (the advancing phase also pulses yellow now)
      emit(prun, [{ phase: 'literature', level: 'ok', message: '✅ ' + incl.length + ' cikk kézzel included — folytatás: ' + nextLabel }]);
      if (prun.id === run.id) { setStatus(patch); }
      else { var nx = Object.assign({}, prun, patch); setBranchRow(nx); sb.from('research_autopilot_runs').update(Object.assign({ updated_at: nowIso() }, patch)).eq('id', prun.id).then(function (r) { if (r && r.error) { toast('Nem sikerült: ' + r.error.message, false); return; } ensureBranchDrive(nx); }); }
      setLitRev(null);
      toast('▶ Folytatás ' + incl.length + ' included cikkel → ' + nextLabel, true);
    }
    function openProtocolPreview(prun) {   // load the generated protocol's steps → the task-card modal
      var pid = (prun && prun.project_id) || run.project_id, pidProto = prun && prun.protocol_id;
      setProtoPv({ loading: true, title: 'Protokoll-feladatok', steps: [] });
      var q = pidProto
        ? sb.from('research_protocols').select('id,title,goal,status').eq('id', pidProto).maybeSingle()
        : sb.from('research_protocols').select('id,title,goal,status').eq('project_id', pid).neq('status', 'archived').order('created_at', { ascending: false }).limit(1).maybeSingle();
      q.then(function (pr) {
        var proto = pr && pr.data;
        if (!proto) { setProtoPv(null); toast('Nincs elérhető protokoll.', false); return; }
        sb.from('research_protocol_steps').select('id,ord,title,kind,spec,depends_on,needs_approval,status').eq('protocol_id', proto.id).order('ord', { ascending: true }).then(function (sr) {
          if (!alive.current) return;
          setProtoPv({ title: proto.title || 'Protokoll-feladatok', goal: proto.goal || '', steps: (sr && sr.data) || [] });
        });
      });
    }
    // Live literature figures under the Literature card. While a screening step runs: its label + cursor/total bar +
    // its live include/maybe/exclude tallies. When done: the final funnel — search hits + the deepest step's included count.
    function litMini(prun, st) {
      var lp = litProg[prun.id];
      if (!lp || !lp.steps || !lp.steps.length) return null;
      var steps = lp.steps.slice().sort(function (a, b) { return (a.step || 0) - (b.step || 0); });
      var s1 = steps.filter(function (s) { return s.step === 1; })[0] || steps[0];
      var found = (s1 && (s1.total || s1.cursor)) || 0;   // papers the search returned (step-1 corpus size)
      var act = steps.filter(function (s) { return s.status === 'running'; })[0];   // the step being screened right now (if any)
      // deepest screening step (1–3) already done → its include count is the current funnel result to show when idle/done
      var doneScreen = steps.filter(function (s) { return s.step <= 3 && s.status === 'done' && s.counts && s.counts.include != null; });
      var deepest = doneScreen.length ? doneScreen[doneScreen.length - 1] : null;
      var c = (act && act.counts) || {}, cur = (act && act.cursor) || 0, tot = (act && act.total) || 0;
      var pctB = tot ? Math.round(cur / tot * 100) : 0;
      // idle/done → prefer finalIncluded (step-3 includes incl. manual overrides); while a step runs → its live include count
      var inclNow = (act && c.include != null) ? c.include : (lp.finalIncluded != null ? lp.finalIncluded : (deepest ? deepest.counts.include : null));
      return h('div', { className: 'apg-lit' + (act ? ' live' : '') },
        act ? h('div', { className: 'apg-lit-top' },
          h('span', { className: 'apg-lit-step' }, h('span', { className: 'apg-lit-dot' }), LIT_KIND_LAB[act.kind] || 'Szűrés'),
          tot ? h('span', { className: 'apg-lit-frac mono' }, cur + ' / ' + tot) : null) : null,
        (act && tot) ? h('div', { className: 'apg-lit-bar' }, h('i', { style: { width: pctB + '%' } })) : null,
        h('div', { className: 'apg-lit-chips' },
          found ? h('span', { className: 'apg-lit-chip find', title: 'Keresési találatok' }, '🔎 ' + found) : null,
          (inclNow != null) ? h('span', { className: 'apg-lit-chip inc', title: 'Beválasztva' }, '✓ ' + inclNow) : null,
          (act && c.maybe != null) ? h('span', { className: 'apg-lit-chip may', title: 'Bizonytalan' }, '~ ' + c.maybe) : null,
          (act && c.exclude != null) ? h('span', { className: 'apg-lit-chip exc', title: 'Kizárva' }, '✕ ' + c.exclude) : null));
    }
    // One full protocol-task card (shared by the inline graph view AND the modal): title, status, type, minutes,
    // approval, dependencies, the instruction, acceptance criteria and expected outputs.
    // Applying a saved task everywhere it is on screen (graph column, protocol modal, the open editor).
    function applyStepUpdate(upd) {
      setProtoArts(function (m) {
        var n = {}; Object.keys(m).forEach(function (k) { n[k] = (m[k] || []).map(function (x) { return x.id === upd.id ? Object.assign({}, x, upd) : x; }); });
        return n;
      });
      setProtoPv(function (pv) { return (pv && pv.steps) ? Object.assign({}, pv, { steps: pv.steps.map(function (x) { return x.id === upd.id ? Object.assign({}, x, upd) : x; }) }) : pv; });
      setTaskEd(function (t) { return (t && t.id === upd.id) ? Object.assign({}, t, upd) : t; });
    }
    function protoCard(s) {
      var spec = s.spec || {}, kd = PROTO_KIND[s.kind] || { ic: '•', lab: s.kind || 'lépés' }, instr = spec.instruction || '';
      return h('div', { className: 'apg-tcard clickable', key: s.id, title: 'Kattints a szerkesztéshez', role: 'button', tabIndex: 0,
        onClick: function () { setTaskEd(s); },
        onKeyDown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setTaskEd(s); } } },
        h('div', { className: 'apg-tcard-h' },
          h('span', { className: 'apg-tcard-ord' }, s.ord),
          h('span', { className: 'apg-tcard-t' }, s.title || 'Feladat'),
          h('span', { className: 'apg-tcard-st ' + (s.status || 'todo') }, PROTO_ST[s.status] || s.status || 'todo')),
        h('div', { className: 'apg-tcard-tags' },
          h('span', { className: 'apg-tag kind' }, kd.ic + ' ' + kd.lab),
          (spec.est_minutes != null) ? h('span', { className: 'apg-tag' }, '⏱ ' + spec.est_minutes + ' perc') : null,
          s.needs_approval ? h('span', { className: 'apg-tag appr' }, '⏸ jóváhagyás kell') : null,
          (Array.isArray(s.depends_on) && s.depends_on.length) ? h('span', { className: 'apg-tag dep' }, '⇠ függ: ' + s.depends_on.map(String).join(', ')) : null),
        instr ? h('div', { className: 'apg-tcard-desc' }, String(instr).slice(0, 400) + (String(instr).length > 400 ? '…' : '')) : null,
        // NOTE: coerce every array element to String before rendering — AI-generated specs occasionally contain objects,
        // and rendering an object as a React child throws ("Objects are not valid as a React child") → blanks the page.
        (Array.isArray(spec.acceptance) && spec.acceptance.length) ? h('div', { className: 'apg-tcard-acc' }, h('b', null, '✔ Elfogadás: '), spec.acceptance.slice(0, 4).map(String).join(' · ')) : null,
        (Array.isArray(spec.expected_outputs) && spec.expected_outputs.length) ? h('div', { className: 'apg-tcard-out' }, h('b', null, '⤷ Kimenet: '), spec.expected_outputs.slice(0, 4).map(function (o, k) { return h('code', { key: k }, String(o)); })) : null);
    }
    // Regenerate a run's protocol scoped to ITS idea (fixes a mis-linked / shared protocol; each idea gets its own steps).
    function regenProtocol(prun) {
      if (regenning[prun.id]) return;
      var ideaId = prun.config && prun.config.develop_idea_id, proj = projRef.current || project;
      if (!proj) { toast('A projekt még tölt — próbáld újra.', false); return; }
      setRegenning(function (m) { var n = Object.assign({}, m); n[prun.id] = true; return n; });
      var clear = function () { setRegenning(function (m) { var n = Object.assign({}, m); delete n[prun.id]; return n; }); };
      var gapIds = [];
      threadGapSources(prun, proj).then(function (gaps) {
        gapIds = gaps.map(function (g) { return g.id; });
        var payload = { action: 'generate', project_id: proj.id, goal: proj.goal || proj.title || '' };
        if (gaps.length) { payload.sources = gaps.concat(ideaId ? [{ kind: 'idea', id: ideaId }] : []); if (ideaId) payload.idea_id = ideaId; }
        else if (ideaId) payload.idea_id = ideaId;
        return callEdge('research-protocol', payload);
      }).then(function (d) {
        if (d && d.error) { clear(); toast('Hiba: ' + d.error, false); return; }
        var pid = d && d.protocol_id;
        if (!pid) { clear(); toast('Nem jött létre protokoll.', false); return; }
        var cfg = gapIds.length ? Object.assign({}, prun.config || {}, { protocol_gap_ids: gapIds }) : null;
        var upd = { protocol_id: pid, updated_at: nowIso() }; if (cfg) upd.config = cfg;
        sb.from('research_autopilot_runs').update(upd).eq('id', prun.id).then(function () {
          var extra = cfg ? { protocol_id: pid, config: cfg } : { protocol_id: pid };
          if (prun.id === run.id) setRun(function (r) { return Object.assign({}, r, extra); });
          else setBranchRow(Object.assign({}, prun, extra));
          sb.from('research_protocol_steps').select('id,protocol_id,ord,title,kind,needs_approval,status,spec').eq('protocol_id', pid).order('ord', { ascending: true }).then(function (res) {
            if (!alive.current) { clear(); return; }
            setProtoArts(function (m) { var n = Object.assign({}, m); n[prun.id] = (res && res.data) || []; return n; });
            clear(); toast('✓ ' + ((d && d.steps) || 0) + ' új, ötlet-specifikus feladat.', true);
          });
        });
      }, function () { clear(); toast('Hálózati hiba — próbáld újra.', false); });
    }
    // Inline protocol tasks under the Protocol card: FULL cards stacked vertically, collapsible (default expanded).
    // Every gap the UI knows about, from any thread — used to name a protocol's source gaps.
    function gapById(gid) {
      if (!gid) return null;
      var hit = null;
      Object.keys(gapsByRun || {}).forEach(function (k) { (gapsByRun[k] || []).forEach(function (g) { if (g.id === gid && !hit) hit = g; }); });
      if (!hit) hit = (((phaseArts.gap && phaseArts.gap.items) || []).filter(function (g) { return g.id === gid; })[0]) || null;
      return hit;
    }
    // WHICH research gap(s) these tasks were planned for. Stamped at generation (config.protocol_gap_ids);
    // protocols generated before that was recorded say so rather than guessing.
    function protoSourceLine(prun) {
      var isGapThread = (prun.config && prun.config.develop_kind) === 'gap';
      if (isGapThread) {
        var one = gapById(prun.config.develop_idea_id);
        return h('div', { className: 'apg-ptasks-src' },
          h('span', { className: 'apg-ptasks-src-l' }, '🧭 Ebből az EGY résből (te jelölted ki):'),
          h('span', { className: 'apg-ptasks-srcc', title: (one && one.question) || '' }, (one && one.question) ? String(one.question).slice(0, 70) : 'kutatási rés'));
      }
      var ids = (prun.config && prun.config.protocol_gap_ids) || [];
      var gaps = gapsByRun[prun.id] || [];
      var numOf = {}; gaps.forEach(function (g, i) { numOf[g.id] = i + 1; });
      // A választás szabálya, kimondva: az automatikus ágon NEM a felhasználó dönt.
      var rule = h('div', { className: 'apg-ptasks-rule' },
        'Az automatikus ágon a rendszer választ: a szál réseit újdonság-pontszám szerint rangsorolja, és a legjobb hatból tervez. ',
        h('b', null, 'Egy konkrét réshez'), ' jelöld ki a rés-kártyát („Kidolgozásra jelöl") — ahhoz külön protokoll készül.');
      if (ids.length) {
        return h(React.Fragment, null,
          h('div', { className: 'apg-ptasks-src' },
            h('span', { className: 'apg-ptasks-src-l' }, '🧭 ' + ids.length + ' rés kidolgozására — a rendszer választotta:'),
            ids.map(function (gid) {
              var g = gapById(gid), n = numOf[gid];
              return h('span', { className: 'apg-ptasks-srcc', key: gid, title: (g && g.question) || 'Kutatási rés' },
                n ? h('b', null, n) : null, (g && g.question) ? String(g.question).slice(0, 54) : 'kutatási rés');
            })),
          rule);
      }
      if (!gaps.length) {
        return h('div', { className: 'apg-ptasks-src none' },
          '🧭 Nem résből készült: ehhez a szálhoz nem született kutatási rés, ezért a protokoll közvetlenül az ötletből lett megtervezve.');
      }
      return h(React.Fragment, null,
        h('div', { className: 'apg-ptasks-src none' },
          '🧭 A szál ' + gaps.length + ' rése közül készült, de ennél a futásnál a pontos hozzárendelés nincs rögzítve (régebbi generálás). Az ↻ Újragenerálás rögzíti.'),
        rule);
    }
    function protoMini(prun) {
      var steps = protoArts[prun.id];
      if (!steps || !steps.length) return null;
      var open = protoOpen[prun.id] !== false;   // default expanded; the user can collapse to just the Protocol card
      var busy = !!regenning[prun.id];
      return h('div', { className: 'apg-ptasks' },
        h('div', { className: 'apg-ptasks-hrow' },
          h('button', { className: 'apg-ptasks-h', onClick: function () { setProtoOpen(function (m) { var n = Object.assign({}, m); n[prun.id] = (m[prun.id] === false); return n; }); } },
            h('span', null, '🧪 ' + steps.length + ' feladat'),
            h('span', { className: 'apg-ptasks-caret' }, open ? '▾ összecsuk' : '▸ kibont')),
          h('button', { className: 'apg-ptasks-regen', disabled: busy, title: 'Új, ehhez az ötlethez tervezett protokoll generálása (a mostanit lecseréli)', onClick: function () { regenProtocol(prun); } },
            busy ? h('span', { className: 'spin' }) : '↻ Újragenerálás')),
        protoSourceLine(prun),
        open ? h('div', { className: 'apg-tcards-col' }, steps.map(protoCard)) : null);
    }
    function downMini(prun, p, last) {
      var st = p.status;
      var bd = st === 'done' ? '✓' : st === 'running' ? 'fut' : st === 'gate' ? '⏸' : st === 'skipped' ? '–' : '·';
      var conn = last ? null : h('div', { className: 'apg-conn' + (st === 'done' ? ' done' : (st === 'running' || st === 'gate') ? ' run' : '') });
      // WIP phases (journal/writing/submission) — under development: shown but never active
      if (AP_WIP[p.key]) {
        return h('div', { className: 'apg-mini-wrap', key: p.key },
          h('div', { className: 'apg-mini wip', style: { '--hue': hueOf(p.key) }, title: 'Ez a fázis még fejlesztés alatt áll' },
            h('span', { className: 'apg-mini-ic' }, AP_ICON[p.key] || '•'),
            h('span', { className: 'apg-mini-lab' }, p.label),
            h('span', { className: 'apg-mini-wipb' }, '🚧 kidolgozás alatt')),
          conn);
      }
      // Literature card is CLICKABLE → the screening-review drawer (override decisions / push maybe forward / continue)
      if (p.key === 'literature') {
        var clickable = !!prun.study_id;
        return h('div', { className: 'apg-mini-wrap', key: p.key },
          h('div', { className: 'apg-mini ' + st + (clickable ? ' clickable' : ''), style: { '--hue': hueOf(p.key) }, onClick: clickable ? function () { openLitReview(prun); } : null, title: clickable ? 'Bírálatok megnyitása és felülbírálása' : null },
            h('span', { className: 'apg-mini-ic' }, AP_ICON[p.key] || '•'),
            h('span', { className: 'apg-mini-lab' }, p.label),
            clickable ? h('span', { className: 'apg-mini-open' }, 'Bírálat ›') : h('span', { className: 'apg-mini-badge ' + (st === 'gate' ? 'gate' : st) }, bd)),
          litMini(prun, st),
          conn);
      }
      var action;   // some phases expose a preview affordance once they have output; others just show a status badge
      if (p.key === 'extract') action = h('span', { className: 'apg-mini-acts' },
        prun.study_id ? h('button', { className: 'apg-mini-read', title: 'A szál kivonatolási kérdései — hozzáadás / törlés', onClick: function () { openExq(prun); } }, 'Kérdések') : null,
        (st === 'done' || st === 'running') ? h('a', { className: 'apg-mini-read ext', href: 'Research.html?project=' + encodeURIComponent(prun.project_id || run.project_id) + '&tab=extract', target: '_blank', rel: 'noopener' }, 'Mátrix ↗') : null);
      else if (p.key === 'sr' && st === 'done') action = h('button', { className: 'apg-mini-read', onClick: function () { openReviewPreview(prun); } }, 'Olvasás');
      else if (p.key === 'gap' && st === 'done') action = h('button', { className: 'apg-mini-read gap', onClick: function () { openGapPreview(prun); } }, 'Rések');
      else if (p.key === 'protocol' && (st === 'done' || st === 'gate')) action = h('button', { className: 'apg-mini-read proto', onClick: function () { openProtocolPreview(prun); } }, 'Feladatok');
      else action = h('span', { className: 'apg-mini-badge ' + (st === 'gate' ? 'gate' : st) }, bd);
      return h('div', { className: 'apg-mini-wrap', key: p.key },
        h('div', { className: 'apg-mini ' + st, style: { '--hue': hueOf(p.key) } },
          h('span', { className: 'apg-mini-ic' }, AP_ICON[p.key] || '•'),
          h('span', { className: 'apg-mini-lab' }, p.label),
          action),
        (p.key === 'protocol' && !hasGapProtocols(prun)) ? protoMini(prun) : null,
        (p.key === 'protocol' && hasGapProtocols(prun)) ? h('div', { className: 'apg-proto-note' }, '↑ A feladatok résenként, a rés-kártyák alatt') : null,
        conn);
    }
    // The research gaps sit IN the flow, right after Kivonatolás where the Research Gap phase card is — that is the
    // branching point: SR → these gaps → a protocol per gap. (They used to hang at the very bottom of the graph.)
    function gapFanInline(prun) {
      var gaps = columnGaps(prun);
      if (!gaps.length) return null;
      var devGap = {}; (branchRuns || []).forEach(function (rr) { var did = rr && rr.config && rr.config.develop_idea_id; if (did) devGap[did] = rr; });
      // selGaps is one map; the count and the launch must cover only THIS column's gaps, otherwise every column
      // shows the same count and any button launches another thread's ticks.
      var mine = gaps.filter(function (x) { return !!selGaps[x.id]; });
      // every developed gap gets its OWN task column below, tied to its card by the same number
      var developed = gaps.filter(function (x) { return !!devGap[x.id]; });
      // Number EVERY card (not just the developed ones) so the thread protocol can point back at them by number.
      var numOf = {}; gaps.forEach(function (x, i) { numOf[x.id] = i + 1; });
      var fed = {}; ((prun.config && prun.config.protocol_gap_ids) || []).forEach(function (id) { fed[id] = 1; });
      return h('div', { className: 'apg-gapsi' },
        h('div', { className: 'apg-gapsi-h' }, '🧭 ' + gaps.length + ' kutatási rés — a fenti review-ból; ezekből készül a protokoll'),
        h('div', { className: 'apg-gapc-list' }, gaps.map(function (x) {
          var sel = !!selGaps[x.id], dev = !!devGap[x.id];
          return h('div', { className: 'apg-gapc' + (dev ? ' active' : '') + (sel ? ' sel' : ''), key: x.id, 'data-idea-card': x.id, title: (x.hypothesis || x.rationale || x.question || '') },
            h('div', { className: 'apg-gapc-h' },
              numOf[x.id] ? h('span', { className: 'apg-gapc-num' }, numOf[x.id]) : null,
              h('span', { className: 'apg-gapc-chip' }, gapLabel(x.gap_type)),
              (x.novelty != null) ? h('span', { className: 'apg-gapc-n' }, '★ ' + x.novelty) : null),
            h('div', { className: 'apg-gapc-t' }, x.question || 'Kutatási rés'),
            // this gap fed the THREAD-level protocol (the automatic run plans from several gaps at once)
            (fed[x.id] && !dev) ? h('span', { className: 'apg-gapc-fed', title: 'Az alábbi Protokoll-kártya feladatai ebből (és a többi megjelölt résből) készültek.' }, '↓ a szál protokolljában') : null,
            // the protocol built FROM THIS GAP hangs off the card itself — that is where it came from
            dev ? (function () {
              var gr = devGap[x.id], pp = ((gr.phases || []).filter(function (q) { return q.key === 'protocol'; })[0]) || {}, steps = protoArts[gr.id] || [];
              return h('div', { className: 'apg-gapc-proto' },
                h('span', { className: 'apg-gapc-arrow', 'aria-hidden': 'true' }, '↳'),
                steps.length ? h('button', { className: 'apg-gapc-tasks', title: 'A résből generált feladatok', onClick: function () { openProtocolPreview(gr); } }, '🧪 ' + steps.length + ' feladat ›')
                  : gr.status === 'failed' ? h('button', { className: 'apg-gapc-tasks err', title: (gr.error || 'Hiba') + ' — folytatás', onClick: function () { resumeBranch(gr.id); } }, '↻ Újra')
                    : pp.status === 'gate' ? h('button', { className: 'apg-gapc-tasks', onClick: function () { openProtocolPreview(gr); } }, '⏸ Jóváhagyásra vár')
                      // TERMINAL states must never keep spinning: the phase was switched off, or the run finished
                      // without steps (empty generation / adopted empty protocol / failed step fetch).
                      : pp.status === 'skipped' ? h('span', { className: 'apg-gapc-run' }, '– Protokoll kihagyva')
                        : (gr.status === 'done' || gr.status === 'cancelled') ? h('button', { className: 'apg-gapc-tasks', disabled: !!regenning[gr.id], title: 'Nincs betöltött feladat — protokoll újragenerálása ebből a résből', onClick: function () { regenProtocol(gr); } }, regenning[gr.id] ? '⏳ Generálás…' : '↻ Protokoll újra')
                          : h('span', { className: 'apg-gapc-run' }, h('span', { className: 'spin' }), ' Protokoll készül…'));
            })()
              : h('label', { className: 'apg-gapc-pick' }, h('input', { type: 'checkbox', checked: sel, disabled: gapBusy, onChange: function () { toggleGap(x.id); } }), ' Kidolgozásra jelöl'));
        })),
        mine.length ? h('button', { className: 'btn pri sm', style: { marginTop: 4, alignSelf: 'stretch', height: 'auto', whiteSpace: 'normal', lineHeight: 1.3, padding: '6px 10px' }, disabled: gapBusy, onClick: function () { startGapBranches(mine.map(function (x) { return x.id; }), prun); } }, gapBusy ? '⏳ Indítás…' : ('▶ Kidolgozás — ' + mine.length + ' rés párhuzamosan')) : null,
        // ONE task column per developed gap — as many columns as gaps ticked, each labelled with its gap
        developed.length ? h('div', { className: 'apg-gaptasks' }, developed.map(function (x) {
          var gr = devGap[x.id], steps = protoArts[gr.id] || [];
          var pp = ((gr.phases || []).filter(function (q) { return q.key === 'protocol'; })[0]) || {};
          var open = (protoOpen[gr.id] !== undefined) ? protoOpen[gr.id] : (developed.length <= 1);
          return h('div', { className: 'apg-gaptcol', key: gr.id },
            h('div', { className: 'apg-gaptcol-h' },
              h('span', { className: 'apg-gapc-num' }, numOf[x.id]),
              h('span', { className: 'apg-gaptcol-t', title: 'Ennek a résnek a kidolgozására: ' + (x.question || '') }, gapLabel(x.gap_type) + ' · ' + String(x.question || 'Kutatási rés')),
              steps.length ? h('button', { className: 'apg-gaptcol-regen', disabled: !!regenning[gr.id], title: 'Protokoll újragenerálása ebből a résből', onClick: function () { regenProtocol(gr); } }, regenning[gr.id] ? h('span', { className: 'spin' }) : '↻') : null),
            // a full task card is tall; with several gaps developed the columns start collapsed (same idiom as protoMini)
            steps.length ? h('button', { className: 'apg-gaptcol-toggle', onClick: function () { setProtoOpen(function (m) { var n = Object.assign({}, m); n[gr.id] = !open; return n; }); } },
              h('span', null, '🧪 ' + steps.length + ' feladat'), h('span', { className: 'apg-ptasks-caret' }, open ? '▾ összecsuk' : '▸ kibont')) : null,
            (steps.length && open) ? h('div', { className: 'apg-tcards-col' }, steps.map(protoCard))
              : steps.length ? null : h('div', { className: 'apg-gaptcol-empty' },
                pp.status === 'skipped' ? '– Protokoll kihagyva'
                  : gr.status === 'failed' ? h('button', { className: 'apg-gapc-tasks err', onClick: function () { resumeBranch(gr.id); } }, '↻ Újra')
                    : (gr.status === 'done' || gr.status === 'cancelled') ? h('button', { className: 'apg-gapc-tasks', disabled: !!regenning[gr.id], onClick: function () { regenProtocol(gr); } }, regenning[gr.id] ? '⏳ Generálás…' : '↻ Protokoll újra')
                      : h('span', null, h('span', { className: 'spin' }), ' Protokoll készül…')));
        })) : null);
    }
    // Which gap cards a column actually renders. Used by BOTH branchColumn and branchesRow so a gap thread can never
    // fall between them: if its card is not rendered anywhere, the thread gets its own column back.
    function columnGaps(prun) {
      if (!prun || ((prun.config && prun.config.develop_kind) === 'gap')) return [];
      var gs = gapsByRun[prun.id] || [];
      if (!gs.length) return [];
      var ph = prun.phases || [];
      var gapDone = ph.some(function (p) { return p.key === 'gap' && p.status === 'done'; });
      var hasGapPhase = ph.some(function (p) { return p.key === 'gap' && (p.enabled || AP_WIP[p.key]); });
      var devHere = gs.some(function (g) { return (branchRuns || []).some(function (rr) { return rr && rr.config && rr.config.develop_idea_id === g.id; }); });
      // show once this thread's gap phase produced them, while any of them is being developed (so a re-run of the
      // upstream phases cannot hide a running gap thread), or when the phase was switched off (primary only)
      return (gapDone || devHere || (!hasGapPhase && prun.id === run.id)) ? gs : [];
    }
    // True when this column already shows a protocol PER GAP under the gap cards — then the thread-level Protocol
    // card must not repeat a big task list of its own (that is the duplication the gap columns replaced).
    function hasGapProtocols(prun) {
      return columnGaps(prun).some(function (g) { return (branchRuns || []).some(function (rr) { return rr && rr.config && rr.config.develop_idea_id === g.id; }); });
    }
    function branchColumn(prun) {
      var isPrimary = prun.id === run.id;
      var ideas0 = (phaseArts.ideas && phaseArts.ideas.items) || [];
      var pool = ideas0.concat((phaseArts.gap && phaseArts.gap.items) || []);   // a branch may develop an IDEA or a research GAP
      var ideaId = (prun.config && prun.config.develop_idea_id) || (isPrimary && ideas0[0] ? ideas0[0].id : null);
      var idea = pool.filter(function (x) { return x.id === ideaId; })[0];
      var isGapCol = ((prun.config && prun.config.develop_kind) === 'gap') || !!(idea && idea.source === 'gap');   // stamped at insert, so it holds before the gap row loads
      var down = (prun.phases || []).filter(function (p) { return DOWN.indexOf(p.key) >= 0 && (p.enabled || AP_WIP[p.key]); });   // WIP phases stay visible (as „kidolgozás alatt")
      var failed = prun.status === 'failed';
      // a column showing the gap fan needs the full row: the cards sit SIDE BY SIDE, each with its own protocol
      var showsGaps = columnGaps(prun).length > 0;
      return h('div', { className: 'apg-col' + (isPrimary ? ' primary' : '') + (failed ? ' failed' : '') + (showsGaps ? ' wide' : ''), key: prun.id,
        'data-col-id': prun.id, 'data-col-from': ideaId || '', 'data-col-live': (prun.status === 'running' ? '1' : '0') },
        h('div', { className: 'apg-col-h' },
          h('span', { className: 'apg-col-ic' }, failed ? '✕' : (isGapCol ? '🧭' : '💡')),
          h('span', { className: 'apg-col-t', title: (idea && idea.question) || '' }, (idea && idea.question) || (isPrimary ? 'Fő szál' : (isGapCol ? 'Kutatási rés' : 'Ötlet'))),
          isPrimary ? h('span', { className: 'apg-col-tag' }, 'fő') : null,
          (prun.config && prun.config.develop_auto) ? h('span', { className: 'apg-col-tag auto', title: 'Az Autopilot automatikusan ezt az ötletet választotta kidolgozásra.' }, 'auto') : null,
          (prun.config && prun.config.develop_kind === 'gap') ? h('span', { className: 'apg-col-tag gap', title: 'Ez a szál egy kutatási rés kidolgozása.' }, 'rés') : null,
          failed ? h('button', { className: 'apg-col-retry', title: (prun.error ? ('Hiba: ' + prun.error + ' — ') : '') + 'A szál folytatása onnan, ahol elakadt', onClick: function () { isPrimary ? resume() : resumeBranch(prun.id); } }, '↻ Újra') : null),
        h('div', { className: 'apg-fan-conn' }),
        h('div', { className: 'apg-col-chain' }, (function () {
          var chain = down.map(function (p, i) {
            var mini = downMini(prun, p, i === down.length - 1);
            // a gap-thread column develops ONE gap — no fan inside it; and only show gaps once this thread's own
            // gap phase actually produced them (otherwise the card would advertise another run's gaps)
            if (p.key !== 'gap' || !showsGaps) return mini;
            var fan = gapFanInline(prun);
            // keep the column's spine unbroken: the phase connector sits INSIDE downMini, above the fan
            return fan ? h(React.Fragment, { key: p.key }, mini, fan, h('div', { className: 'apg-conn done' })) : mini;
          });
          // the Research Gap phase can be switched OFF at launch — the project's gaps must still be reachable
          if (showsGaps && !down.some(function (p) { return p.key === 'gap'; })) {
            var f2 = gapFanInline(prun);
            if (f2) chain.push(h('div', { key: 'gapfan-off', style: { width: '100%' } }, f2));
          }
          return chain;
        })()));
    }
    function branchesRow() {
      // A gap thread belongs UNDER the gap card it develops (that is where it came from), NOT beside the ideas as if
      // it were a new idea. But it must never become invisible: if no rendered card carries it (upstream phases
      // re-running, the dashboard opened ON a gap run, a stale cache), it gets its own column back.
      var ideaCols = [run].concat((branchRuns || []).filter(function (r) { return r && r.config && r.config.develop_kind !== 'gap' && r.id !== run.id; }));
      var shown = {};
      ideaCols.forEach(function (c) { columnGaps(c).forEach(function (g) { shown[g.id] = 1; }); });
      var orphanGaps = (branchRuns || []).filter(function (r) { return r && r.config && r.config.develop_kind === 'gap' && r.id !== run.id && !shown[r.config.develop_idea_id]; });
      var cols = ideaCols.concat(orphanGaps);
      return h('div', { className: 'apg-branches' + (cols.length > 1 ? ' multi' : '') }, cols.map(branchColumn));
    }
    // Research Gap fan: once the pipeline has generated the research gaps, show them side-by-side (like the ideas fan) →
    // tick some → each spawns a parallel gap→protocol branch (startGapBranches). Rendered in the flow after the branch columns.
    // which thread (idea) an activity event belongs to → shown as a chip in the feed when parallel threads run
    function threadLabel(runId) {
      var rr = ([run].concat(branchRuns || [])).filter(function (x) { return x && x.id === runId; })[0];
      if (!rr) return null;
      var did = rr.config && rr.config.develop_idea_id;
      var idea = ((phaseArts.ideas && phaseArts.ideas.items) || []).concat((phaseArts.gap && phaseArts.gap.items) || []).filter(function (x) { return x.id === did; })[0];
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

    return h('div', { className: 'ap-wrap dash' },
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
      // ── The whole page IS the board: the graph lives on a pannable CANVAS and the status/activity surfaces
      //    float ON it as draggable, collapsible panels. Every new idea/gap thread opens a column to the RIGHT,
      //    joined to the card it came from by a drawn connector.
      h('div', { className: 'apg-cwrap' + (cvFull ? ' full' : '') },
        h('div', {
          className: 'apg-canvas', ref: cvRef, onWheel: function () { cvTouched.current = true; },
          onPointerDown: panStart, onPointerMove: panMove, onPointerUp: panEnd, onPointerCancel: panEnd, onClickCapture: panClick
        },
          h('div', { className: 'apg-canvas-sizer', ref: sizerRef },
            h('div', { className: 'apg-stage', ref: stageRef, style: { transform: 'scale(' + zoom + ')' } },
              h('svg', { className: 'apg-links', 'aria-hidden': 'true' },
                links.map(function (l) { return h('path', { key: l.k, className: 'apg-link' + (l.live ? ' live' : ''), d: l.d }); })),
              h('div', { className: 'apg-flow' }, briefNode(),
                phaseNode((phases.filter(function (p) { return p.key === 'ideas'; })[0]) || phases[0], 0, false),   // ideas fan (multi-select)
                branchesRow())))),   // parallel downstream columns — each carries its own gap cards in the flow (gapFanInline)
        h('div', { className: 'apg-hint' }, '✥ Húzd a hátteret a mozgatáshoz'),
        h('div', { className: 'apg-zoom', 'data-nopan': '1' },
          h('button', { onClick: function () { setZoomP(zoom - 0.1); }, title: 'Kicsinyítés', 'aria-label': 'Kicsinyítés' }, '−'),
          h('button', { className: 'z-val', onClick: function () { setZoomP(1); }, title: '100%-ra vissza' }, Math.round(zoom * 100) + '%'),
          h('button', { onClick: function () { setZoomP(zoom + 0.1); }, title: 'Nagyítás', 'aria-label': 'Nagyítás' }, '+'),
          h('button', { onClick: fitZoom, title: 'Illesztés a szélességhez' }, '⤡'),
          h('button', { onClick: function () { setCvFull(!cvFull); }, title: cvFull ? 'Kilépés a teljes nézetből (Esc)' : 'Teljes nézet' }, cvFull ? '✕' : '⤢')),
        h(FloatPanel, { id: 'focus', icon: '🎯', title: 'Állapot', anchor: 'tr', width: 344 }, focusPanel()),
        h(FloatPanel, { id: 'feed', icon: '📡', title: 'Activity', anchor: 'br', width: 344,
          badge: (branchRuns || []).length ? h('span', { className: 'ap-feed-live' }, '● ' + (1 + (branchRuns || []).length) + ' szál') : null },
          h('div', { className: 'ap-feed-list', ref: feedRef }, events.length ? events.map(function (e) {
            var multi = (branchRuns || []).length > 0, tag = multi ? threadLabel(e.run_id) : null;
            return h('div', { className: 'ap-feed-row ' + (e.level || 'run'), key: e.id },
              h('span', { className: 'ap-fi' }, EV_ICON[e.level] || '•'),
              h('span', { className: 'ap-ft' }, tag ? h('span', { className: 'ap-fthread', title: tag }, tag.length > 24 ? tag.slice(0, 24) + '…' : tag) : null, e.message));
          }) : h('div', { className: 'ap-feed-empty' }, 'Még nincs esemény…')))),
      h('div', { className: 'ap-dacts' },
        h('a', { className: 'btn sm', href: 'Research.html?project=' + encodeURIComponent(run.project_id) }, 'Megnyitás a Research-ben ↗'),
        h('button', { className: 'btn sm', onClick: props.onExit }, '‹ Új kutatás')),
      preview ? h('div', { className: 'ap-pv-scrim', onClick: function () { setPreview(null); } },
        h('div', { className: 'ap-pv', onClick: function (e) { e.stopPropagation(); } },
          h('div', { className: 'ap-pv-h' }, h('b', null, '🔬 ' + (preview.title || 'Áttekintés')), h('button', { className: 'ap-pv-x', 'aria-label': 'Bezárás', onClick: function () { setPreview(null); } }, '×')),
          h('div', { className: 'ap-pv-b report-doc', dangerouslySetInnerHTML: { __html: mdSafe(preview.content || '') } }),
          h('div', { className: 'ap-pv-f' },
            h('button', { className: 'btn sm', onClick: function () { try { navigator.clipboard.writeText(preview.content || ''); toast('Vágólapra másolva', true); } catch (e) { } } }, 'Másolás (Markdown)'),
            h('button', { className: 'btn pri sm', onClick: function () { setPreview(null); } }, 'Bezárás')))) : null,
      // Protocol task-cards modal: every generated protocol step as its own card with its main metadata.
      protoPv ? h('div', { className: 'ap-pv-scrim', onClick: function () { setProtoPv(null); } },
        h('div', { className: 'ap-pv proto', onClick: function (e) { e.stopPropagation(); } },
          h('div', { className: 'ap-pv-h' }, h('b', null, '🧪 ' + (protoPv.title || 'Protokoll-feladatok')), h('button', { className: 'ap-pv-x', 'aria-label': 'Bezárás', onClick: function () { setProtoPv(null); } }, '×')),
          protoPv.loading
            ? h('div', { className: 'ap-pv-b', style: { textAlign: 'center', padding: '30px' } }, h('span', { className: 'spin' }))
            : h('div', { className: 'ap-pv-b' },
              protoPv.goal ? h('div', { className: 'apg-proto-goal' }, protoPv.goal) : null,
              h('div', { className: 'apg-proto-meta' }, (protoPv.steps || []).length + ' feladat generálva'),
              (protoPv.steps || []).length
                ? h('div', { className: 'apg-proto-grid' }, protoPv.steps.map(protoCard))
                : h('div', { className: 'ap-pc-dempty' }, 'Ehhez a szálhoz még nincs generált protokoll-feladat.')),
          h('div', { className: 'ap-pv-f' },
            h('a', { className: 'btn sm', href: 'Research.html?project=' + encodeURIComponent(run.project_id), target: '_blank', rel: 'noopener' }, 'Protocol-fül megnyitása ↗'),
            h('button', { className: 'btn pri sm', onClick: function () { setProtoPv(null); } }, 'Bezárás')))) : null,
      // Screening-review DRAWER (right side): override the AI screening decisions, then continue the run.
      exqMgr ? h('div', { className: 'ap-pv-scrim ap-te-scrim', onClick: function () { setExqMgr(null); } },
        h('div', { className: 'ap-pv', style: { width: '620px' }, onClick: function (e) { e.stopPropagation(); } },
          h('div', { className: 'ap-pv-h' }, h('b', null, '🔎 Kivonatolási kérdések'), h('button', { className: 'ap-pv-x', style: { marginLeft: 'auto' }, 'aria-label': 'Bezárás', onClick: function () { setExqMgr(null); } }, '×')),
          h('div', { className: 'ap-pv-b' },
            h('div', { className: 'ap-exq-note' }, 'Ennek a szálnak a kérdései. A Kivonatolás fázis minden included cikkből ezekre keresi a választ — a törlés a hozzájuk tartozó válaszokat is eltávolítja.'),
            exqMgr.loading ? h('div', { style: { textAlign: 'center', padding: '18px' } }, h('span', { className: 'spin' }))
              : h('div', { className: 'ap-exq-list' }, (exqMgr.items || []).length
                ? exqMgr.items.map(function (q, i) {
                  return h('div', { className: 'ap-exq-row', key: q.id },
                    h('span', { className: 'ap-exq-n' }, i + 1),
                    h('span', { className: 'ap-exq-t' }, q.text),
                    h('button', { className: 'ap-exq-del', disabled: !!exqMgr.busy, title: 'Kérdés törlése', onClick: function () { exqDel(q); } }, '×'));
                })
                : h('div', { className: 'ap-pc-dempty' }, 'Nincs kérdés ehhez a szálhoz — a Kivonatolás fázis kimarad.')),
            h('div', { className: 'ap-exq-in', style: { marginTop: 10 } },
              h('input', {
                className: 'ap-exq-input', value: exqMgr.input || '', placeholder: 'Új kérdés — pl. Milyen adathalmazon mérték?',
                onChange: function (e) { var v = e.target.value; setExqMgr(function (m) { return m ? Object.assign({}, m, { input: v }) : m; }); },
                onKeyDown: function (e) { if (e.key === 'Enter') exqAdd(); }
              }),
              h('button', { className: 'ap-exq-add', disabled: !!exqMgr.busy, onClick: exqAdd }, '＋'))),
          h('div', { className: 'ap-pv-f' }, h('button', { className: 'btn pri sm', onClick: function () { setExqMgr(null); } }, 'Kész')))) : null,
      // rendered LAST so it stacks above the task-list modal it is usually opened from
      taskEd ? h(TaskEdit, { step: taskEd, projectId: run.project_id, onClose: function () { setTaskEd(null); }, onSaved: applyStepUpdate }) : null,
      litRev ? (function () {
        var cnt = { include: 0, maybe: 0, exclude: 0 };
        (litRev.order || []).forEach(function (id) { var d = litRev.eff[id]; if (cnt[d] != null) cnt[d]++; });
        var exIncIds = (litRev.order || []).filter(function (id) { return litRev.eff[id] === 'include'; });   // the currently-included set → extraction row set
        var exPid = (litRev.prun && litRev.prun.project_id) || (run && run.project_id) || null;
        return h('div', { className: 'ap-dw-scrim', onClick: function () { if (dwDrag.current) return; setLitRev(null); } },
          h('div', { className: 'ap-dw', style: { width: Math.max(DW_MIN, Math.min(dwMax(), dwW)) + 'px' }, onClick: function (e) { e.stopPropagation(); } },
            h('div', { className: 'ap-dw-grip', title: 'Húzd a szélesség állításához', role: 'separator', 'aria-orientation': 'vertical', 'aria-label': 'Panel szélessége',
              onPointerDown: dwResizeStart, onPointerMove: dwResizeMove, onPointerUp: dwResizeEnd, onPointerCancel: dwResizeEnd,
              onDoubleClick: function () { setDwW(560); try { localStorage.setItem(DW_KEY, '560'); } catch (e) { } } }),
            h('div', { className: 'ap-dw-h' },
              h('div', null, h('b', null, '📚 Bírálat felülbírálása'), h('div', { className: 'ap-dw-sub' }, 'A szűrés döntéseit itt kézzel átírhatod, majd folytathatod a folyamatot.')),
              h('button', { className: 'ap-pv-x', 'aria-label': 'Bezárás', onClick: function () { setLitRev(null); } }, '×')),
            litRev.loading
              ? h('div', { className: 'ap-dw-b', style: { textAlign: 'center', padding: '40px' } }, h('span', { className: 'spin' }))
              : h('div', { className: 'ap-dw-b' },
                h('div', { className: 'ap-dw-summ' },
                  h('span', { className: 'ap-dw-cc inc' }, '✓ ' + cnt.include + ' included'),
                  h('span', { className: 'ap-dw-cc may' }, '? ' + cnt.maybe + ' maybe'),
                  h('span', { className: 'ap-dw-cc exc' }, '✕ ' + cnt.exclude + ' kizárt')),
                (cnt.maybe || cnt.exclude) ? h('div', { className: 'ap-dw-bulk' },
                  cnt.maybe ? h('button', { className: 'btn sm', onClick: function () { bulkPromote('maybe'); } }, '↑ Összes maybe → included') : null,
                  cnt.exclude ? h('button', { className: 'btn sm', onClick: function () { bulkPromote('exclude'); } }, '↑ Összes kizárt → included') : null) : null,
                // publication-level extraction questions — placed ABOVE the publication list so it's reachable without scrolling
                h(LitExtract, { projectId: exPid, studyId: litRev.studyId, includedIds: exIncIds, sources: litRev.sources, canEdit: true }),
                (litRev.order || []).length
                  ? h('div', { className: 'ap-dw-list' }, litRev.order.map(function (id) {
                    var s = litRev.sources[id] || {}, m = litRev.meta[id] || {}, dec = litRev.eff[id];
                    var sig = m.signals || {};
                    return h('div', { className: 'ap-dw-row ' + dec, key: id },
                      h('div', { className: 'ap-dw-main' },
                        h('div', { className: 'ap-dw-t' }, s.url ? h('a', { href: s.url, target: '_blank', rel: 'noopener' }, s.title || 'Forrás') : (s.title || 'Forrás')),
                        h('div', { className: 'ap-dw-rmeta' },
                          s.year ? h('span', null, String(s.year)) : null,
                          s.venue ? h('span', { className: 'ap-dw-venue', title: s.venue }, s.venue) : null,
                          (m.score != null) ? h('span', { className: 'ap-dw-score' }, 'score ' + m.score) : null,
                          sig.has_github ? h('span', { className: 'ap-dw-sig' }, '⌥ kód') : null,
                          sig.has_dataset ? h('span', { className: 'ap-dw-sig' }, '⛁ adat') : null,
                          m.overridden ? h('span', { className: 'ap-dw-man' }, 'kézi') : null),
                        m.reason ? h('div', { className: 'ap-dw-reason' }, m.reason) : null),
                      h('div', { className: 'ap-dw-seg', role: 'group', 'aria-label': 'Döntés felülbírálása' }, ['include', 'maybe', 'exclude'].map(function (v) {
                        return h('button', { key: v, className: (dec === v ? 'on ' + v : ''), title: v, 'aria-pressed': dec === v, onClick: function () { overrideDec(id, v); } }, v === 'include' ? '✓' : v === 'maybe' ? '?' : '✕');
                      })));
                  }))
                  : h('div', { className: 'ap-pc-dempty', style: { padding: '30px 0' } }, 'Ehhez a szálhoz még nincs leszűrt (step ≥ 2) publikáció. Előbb fusson le a Literature keresés + absztrakt-szűrés.')),
            h('div', { className: 'ap-dw-f' },
              h('div', { className: 'ap-dw-fnote' }, cnt.include ? (cnt.include + ' included cikkel folytatódik a folyamat') : 'Jelölj ki legalább egy included cikket.'),
              h('div', { style: { display: 'flex', gap: 8 } },
                h('button', { className: 'btn sm', onClick: function () { setLitRev(null); } }, 'Mégse'),
                h('button', { className: 'btn pri sm', disabled: !cnt.include, onClick: continueLitReview }, '▶ Folytatás')))));
      })() : null);
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
    // delete a whole Autopilot project + ALL its data (research_projects FK cascade removes runs/events/ideas/sources/studies/
    // protocols/files/gap-matrix/extraction). Owner-scoped by RLS. Confirms first — irreversible.
    function delProject(row) {
      var go = function (ok) {
        if (!ok) return;
        sb.from('research_projects').delete().eq('id', row.pid).then(function (r) {
          if (r && r.error) { toast('Nem sikerült törölni: ' + r.error.message, false); return; }
          if (alive.current) setRows(function (list) { return (list || []).filter(function (x) { return x.pid !== row.pid; }); });
          toast('Projekt törölve.', true);
        }, function () { toast('Nem sikerült törölni — próbáld újra.', false); });
      };
      var body = '„' + (row.title || 'Projekt') + '" és MINDEN hozzá tartozó adat (futások, ötletek, rések, források, study-k, protokollok, fájlok) VÉGLEGESEN törlődik — nem vonható vissza.';
      if (window.PRUI && window.PRUI.confirm) window.PRUI.confirm({ title: 'Autopilot-projekt törlése?', body: body, danger: true, confirmLabel: 'Végleges törlés' }).then(go);
      else if (window.confirm('Törlöd a(z) „' + (row.title || 'Projekt') + '" projektet és minden adatát? Nem vonható vissza.')) go(true);
    }
    return h('aside', { className: 'ap-side' },
      h('div', { className: 'ap-side-h' }, 'Projektjeim', rows && rows.length ? h('span', { className: 'ap-side-c' }, rows.length) : null),
      rows === null ? h('div', { className: 'ap-side-empty' }, h('span', { className: 'spin' })) :
      !rows.length ? h('div', { className: 'ap-side-empty' }, 'Még nincs megkezdett projekt. Indíts egy beszélgetést jobbra →') :
      h('div', { className: 'ap-side-list' }, rows.map(function (row) {
        var run = row.run, eff = run ? apEffectiveStatus(run) : null, st = run ? (AP_STATUS[eff] || AP_STATUS.queued) : null, pr = run ? apProgress(run) : null;
        return h('div', { key: row.pid, className: 'ap-side-rowwrap' },
          h('button', { className: 'ap-side-row', title: row.goal || row.title,
            onClick: function () { if (run) props.onOpenRun(run.id); else props.onOpenBrief(row.pid, row.chatId); } },
            h('div', { className: 'ap-side-t' }, row.title),
            row.goal ? h('div', { className: 'ap-side-g' }, row.goal) : null,
            h('div', { className: 'ap-side-meta' },
              run ? h('span', { className: 'ap-pill ' + st.cls }, h('span', { className: 'ap-sdot' }), st.t)
                  : h('span', { className: 'ap-pill ap-pill-brief' }, '📝 Piszkozat'),
              run && pr ? h('span', { className: 'ap-side-pr mono' }, pr.done + '/' + pr.enabled) : null,
              row.ts ? h('span', { className: 'ap-side-ts' }, rel(row.ts)) : null)),
          h('button', { className: 'ap-side-del', title: 'Projekt törlése', 'aria-label': 'Projekt törlése', onClick: function (e) { e.stopPropagation(); delProject(row); } }, '🗑'));
      })));
  }

  // ======================================================================= HEADLESS DRIVER (admin: central resume)
  // The same loop as Dashboard.drive() — lease → apStep → events → patch, 3 transient retries — without any UI, so the
  // admin's "Elakadt folyamatok" page can carry several runs at once. The lease is the SAME one the owner's dashboard
  // uses: if the owner opens the run meanwhile, exactly one of the two tabs advances it (the other stops cleanly).
  function apEmit(r, evs) {
    if (!evs || !evs.length) return Promise.resolve();
    return sb.from('research_autopilot_events').insert(evs.map(function (e) { return { run_id: r.id, project_id: r.project_id, phase: e.phase || null, level: e.level || 'run', message: String(e.message || '').slice(0, 500) }; }));
  }
  function apNewToken() { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : ('00000000-0000-4000-8000-' + String(Date.now() + Math.floor(Math.random() * 1e6)).slice(-12).padStart(12, '0')); }
  function apHeadlessDriver(runId, hooks) {
    hooks = hooks || {};
    var token = apNewToken(), on = true, retries = 0, net = 0, projCache = null;
    function end(row, why) { if (!on) return; on = false; if (hooks.onEnd) hooks.onEnd(row || null, why || null); }
    function netRetry(msg) { if (!on) return; net++; if (net > 5) { end(null, msg); return; } setTimeout(tick, 3000 * net); }
    function tick() {
      if (!on) return;
      var stale = new Date(Date.now() - 30000).toISOString();
      sb.from('research_autopilot_runs').update({ driver_token: token, driver_beat: nowIso() })
        .eq('id', runId).eq('status', 'running')
        .or('driver_token.is.null,driver_token.eq.' + token + ',driver_beat.lt.' + stale)
        .select('*').then(function (rr) {
          if (!on) return;
          if (rr && rr.error) { netRetry('Lease: ' + rr.error.message); return; }
          var r = rr && rr.data && rr.data[0];
          if (!r) {   // no longer 'running' (done / gate / failed / paused) or another tab holds a live lease
            sb.from('research_autopilot_runs').select('*').eq('id', runId).maybeSingle().then(function (x) {
              var row = x && x.data;
              end(row, row && row.status === 'running' ? 'Egy másik lap viszi tovább (pl. a kutató megnyitotta a dashboardját)' : null);
            }, function () { end(null, 'Az állapot nem olvasható'); });
            return;
          }
          net = 0;
          if (hooks.onRow) hooks.onRow(r);
          (projCache ? Promise.resolve(projCache) : sb.from('research_projects').select('id,title,goal,keywords,student_id').eq('id', r.project_id).maybeSingle().then(function (pr) { projCache = pr && pr.data; return projCache; }))
            .then(function (proj) {
              if (!on) return;
              if (!proj) { end(r, 'A projekt nem olvasható'); return; }
              var cph0 = (r.phases || [])[r.phase_index];
              if (cph0 && cph0.status === 'wait') {   // single-shot phases: show them as working while the edge call runs
                var php0 = r.phases.slice(); php0[r.phase_index] = Object.assign({}, cph0, { status: 'running' });
                r = Object.assign({}, r, { phases: php0 });
                sb.from('research_autopilot_runs').update({ phases: php0 }).eq('id', r.id).eq('driver_token', token).then(function () { }, function () { });
                if (hooks.onRow) hooks.onRow(r);
              }
              apStep(r, proj).then(function (res) {
                if (!on) return;
                retries = 0;
                apEmit(r, res.events).then(function () {
                  var patch = Object.assign({ updated_at: nowIso(), driver_beat: nowIso() }, res.patch || {});
                  sb.from('research_autopilot_runs').update(patch).eq('id', r.id).eq('driver_token', token).then(function () {
                    if (hooks.onEvents && res.events && res.events.length) hooks.onEvents(res.events);
                    if (hooks.onRow) hooks.onRow(Object.assign({}, r, patch));
                    setTimeout(tick, 950);
                  }, function () { netRetry('A lépés mentése nem sikerült'); });
                }, function () { setTimeout(tick, 3000); });
              }, function (err) { fail(r, err); });
            }, function () { netRetry('A projekt betöltése nem sikerült'); });
        }, function () { netRetry('Hálózati hiba'); });
    }
    function fail(r, err) {
      if (!on) return;
      var pk = (r.phases[r.phase_index] || {}).key, msg = (err && err.message) || String(err);
      if (retries < 3) {   // transient failure → retry the SAME step (its cursor is persisted) with backoff
        retries++;
        var ev = { phase: pk, level: 'warn', message: 'Átmeneti hiba: ' + msg + ' — újrapróbálás ' + retries + '/3…' };
        apEmit(r, [ev]).then(function () {
          if (hooks.onEvents) hooks.onEvents([ev]);
          sb.from('research_autopilot_runs').update({ driver_beat: nowIso() }).eq('id', r.id).then(function () { setTimeout(tick, 3000 * retries); }, function () { setTimeout(tick, 3000 * retries); });
        });
        return;
      }
      apEmit(r, [{ phase: pk, level: 'error', message: 'Hiba (3 újrapróbálás után): ' + msg }]).then(function () {
        sb.from('research_autopilot_runs').update({ status: 'failed', error: String(msg), updated_at: nowIso() }).eq('id', r.id).then(function () {
          end(Object.assign({}, r, { status: 'failed', error: String(msg) }), null);
        }, function () { end(null, msg); });
      });
    }
    tick();
    return { stop: function () { on = false; } };
  }

  // ======================================================================= ADMIN: ELAKADT FOLYAMATOK (Autopilot.html?view=stuck)
  // Every Autopilot run that cannot move on its own, across all users, in one list — and resumable from here. The
  // pipeline is client-driven, so a resumed run is carried by THIS tab (apHeadlessDriver) with the admin's session:
  // RLS lets an admin write any project (research_can_write_project → is_admin) and every feature gate lets an admin
  // through (is_feature_enabled_for), while the daily AI call cap still applies to the admin.
  var STUCK_STALE_MS = 3 * 60 * 1000;   // a 'running' run with no driver heartbeat for 3 min has nobody carrying it
  var STUCK_MAX_PARALLEL = 3;           // runs carried at once from one tab (daily AI cap + API rate)
  function apIsAdmin() {
    var u = BE && BE.user;
    if (u && u.role) return u.role === 'admin';
    try { return !!(window.PREnt && window.PREnt.role && window.PREnt.role() === 'admin'); } catch (e) { return false; }
  }
  function stuckKind(r, now) {
    if (!r) return null;
    if (r.status === 'failed') return 'failed';
    if (r.status === 'paused') return 'paused';
    if (r.status === 'awaiting_approval') return 'gate';
    if (r.status === 'running') { var b = Date.parse(r.driver_beat || r.updated_at || 0); return (!b || now - b > STUCK_STALE_MS) ? 'orphan' : 'live'; }
    return null;
  }
  var STUCK_META = {
    failed: { lab: 'Hibára futott', cls: 'bad', act: '↻ Folytatás' },
    orphan: { lab: 'Senki nem futtatja', cls: 'warn', act: '▶ Folytatás' },
    gate: { lab: 'Jóváhagyásra vár', cls: 'gate', act: '✓ Jóváhagyás + folytatás' },
    paused: { lab: 'Szüneteltetve', cls: 'mute', act: '▶ Folytatás' },
    live: { lab: 'Fut — valaki viszi', cls: 'ok', act: null }
  };
  function agoHu(iso) {
    var t = Date.parse(iso || 0); if (!t) return '—';
    var sec = Math.max(0, (Date.now() - t) / 1000);
    if (sec < 90) return 'most'; if (sec < 3600) return Math.round(sec / 60) + ' perce'; if (sec < 172800) return Math.round(sec / 3600) + ' órája';
    return Math.round(sec / 86400) + ' napja';
  }
  // ---- Folyamat-naptár helpers ----
  var HU_MONTHS = ['január', 'február', 'március', 'április', 'május', 'június', 'július', 'augusztus', 'szeptember', 'október', 'november', 'december'];
  var HU_WD = ['H', 'K', 'Sze', 'Cs', 'P', 'Szo', 'V'];
  var KIND_ORDER = ['failed', 'orphan', 'gate', 'paused', 'live', 'done', 'cancel'];
  var KIND_LAB = { failed: 'Hibára futott', orphan: 'Senki nem futtatja', gate: 'Jóváhagyásra vár', paused: 'Szüneteltetve', live: 'Fut', done: 'Végzett', cancel: 'Leállítva' };
  function apDay(x) { var d = x instanceof Date ? x : new Date(x); return isNaN(d) ? '' : d.toLocaleDateString('sv-SE'); }   // LOCAL YYYY-MM-DD
  function nowKind(r, now) { var k = stuckKind(r, now); return k || (r.status === 'done' ? 'done' : 'cancel'); }
  function timeOf(x) { try { return new Date(x).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }
  // affiliation is free text ("Széchenyi István University, Hungary" / "Széchenyi István Egyetem (SZE)" …) → one key per school
  function canonUni(a) {
    var s = String(a || '').trim(); if (!s) return '— nincs megadva —';
    var f = s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    if (f.indexOf('szechenyi') >= 0) return 'Széchenyi István Egyetem (SZE)';
    if (f.indexOf('neumann') >= 0) return 'Neumann János Egyetem (NJE)';
    return s.replace(/\s+[—–-]\s+dem[oó].*$/i, '').replace(/,\s*(hungary|magyarország)\s*$/i, '').trim() || s;
  }
  function apFetchAll(mk) {   // PostgREST caps a response at 1000 rows → page until a short page
    var out = [];
    function page(from) { return mk().range(from, from + 999).then(function (r) { if (r && r.error) throw r.error; var d = (r && r.data) || []; out = out.concat(d); return d.length === 1000 ? page(from + 1000) : out; }); }
    return page(0);
  }

  // ======================================================================= AGENT PACKAGE (admin → another agent)
  // One researcher's day in ONE markdown file: every run that was active that day with its full context (project, chosen
  // idea, gaps, included literature with abstracts, the review, the extraction matrix, the protocol with specs and results
  // so far) plus a brief that tells an agent to (A) execute the protocol with evidence, (B) pick a journal by its KPIs,
  // (C) write the manuscript for that journal from verified results only.
  function apDownload(name, text) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }
  function apSlug(x) { return String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'kutato'; }
  function mdCell(v) { return String(v == null ? '' : v).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' '); }
  function mdOne(v, cap) { var t = String(v || '').trim().replace(/\s*\n+\s*/g, ' '); return cap && t.length > cap ? t.slice(0, cap) + '…' : t; }
  var PACK_BRIEF = [
    '## 1. Megbízás az agentnek',
    '',
    'Kutatási agent vagy. Ez a csomag {NAME} Publify-projektjeinek a(z) {DAY} napon aktív futásait tartalmazza, teljes kontextussal: a kutatási célt, a kidolgozott ötletet és a kutatási réseket, a beválasztott irodalmat (absztraktokkal), a szisztematikus áttekintést, a kivonatolt adatokat és a végrehajtandó protokollt, a már elkészült eredményekkel együtt.',
    '',
    'A feladatod három részből áll, ebben a sorrendben.',
    '',
    '### A) Hajtsd végre a protokollt',
    '1. Minden projektnél először olvasd el a kontextust, a kidolgozott ötletet és a réseket. A lépések csak ebben a keretben értelmezhetők.',
    '2. A lépéseket a „Függ” mező szerinti sorrendben hajtsd végre. A kész lépések eredményét használd fel, ne ismételd meg őket — de ellenőrizd az artefaktumaikat: a futtató önbevallása („sikeres”) önmagában nem bizonyíték.',
    '3. Egy lépés akkor kész, ha teljesülnek az **Elfogadási kritériumai**. Kritériumonként mutass konkrét bizonyítékot (fájl, szám, ábra, log). Ami nem teljesül, azt írd le, és ne jelentsd késznek.',
    '4. **Ne találj ki adatot, eredményt vagy hivatkozást.** Ha egy bemenet (adat, fájl, hozzáférés) hiányzik, a lépés *blokkolt*: írd le, mi kell hozzá, és haladj tovább azokkal a lépésekkel, amelyek nem függenek tőle.',
    '5. A „Jóváhagyást kér” jelölésű lépések előtt állj meg, és kérj jóváhagyást. A „Human” felelősű lépéseket ne szimuláld: készítsd elő mindazt, amire a kutatónak szüksége lesz.',
    '',
    '### B) Válassz folyóiratot a KPI-ok alapján',
    '1. A **ténylegesen elért** eredmények és a téma alapján állíts össze 3–5 jelöltet. A csomagban szereplő folyóirat-jelölteket is értékeld.',
    '2. Minden jelöltnél gyűjtsd össze, és forrással igazold (a folyóirat honlapja, Scimago/SJR, Scopus CiteScore, Clarivate JCR, DOAJ) a KPI-okat: kvartilis (SJR és JCR), impakt faktor, CiteScore, elfogadási arány, az első döntésig eltelt idő, a megjelenésig eltelt idő, APC és open access modell, indexelés, valamint a scope-illeszkedés (aims & scope).',
    '3. Válaszd ki a legjobbat, és indokold egy táblázatban. Ne a legmagasabb impaktot hajszold: olyan folyóiratot válassz, amely a témához illik, és ahol az eredmények erőssége és újdonsága alapján reális az elfogadás. Ha az eredmények gyengék vagy hiányosak, ezt mondd ki, és ennek megfelelő szintet javasolj.',
    '',
    '### C) Írd meg a kéziratot a kiválasztott folyóiratnak',
    '1. Keresd meg és kövesd a folyóirat aktuális szerzői útmutatóját: cikktípus, szerkezet, terjedelmi és absztrakt-korlátok, hivatkozási stílus, ábrák és táblázatok formai követelményei, kötelező nyilatkozatok (adat-elérhetőség, érdekütközés, finanszírozás, generatív AI használata), highlights és graphical abstract, ha kérik.',
    '2. **Kizárólag az A) részben igazolt eredményekre építs.** Minden szám, ábra és állítás legyen visszavezethető egy protokoll-lépés kimenetére. Ami blokkolt maradt, az korlát vagy jövőbeli munka, nem eredmény.',
    '3. A hivatkozásokat a csomag forráslistájából vedd ([S#] azonosítók), a DOI-t ellenőrizve. Új forrást csak ellenőrizhető DOI-val adj hozzá.',
    '4. A kutatási rést és az újdonságot a csomag rés-kártyái és a szisztematikus áttekintés alapján fogalmazd meg, és jelöld, mit tesz hozzá a munka az irodalomhoz.',
    '5. A kézirat nyelve a folyóirat nyelve (jellemzően angol). A szerzőket, affiliációkat és a finanszírozást ne találd ki: hagyj helyőrzőt, és vedd fel a nyitott kérdések közé.',
    '',
    '### Leadandó',
    '1. `01_protokoll_jelentes.md` — lépésenként: állapot (kész / részben kész / blokkolt), mit csináltál, bizonyíték kritériumonként, eltérések, blokkolók.',
    '2. `02_folyoirat_valasztas.md` — a jelöltek KPI-táblázata forrásokkal, a választás indoklása és a kizárt jelöltek oka.',
    '3. `03_kezirat/` — a kézirat a folyóirat formátumában (a folyóirat LaTeX- vagy Word-sablonjával), ábrák, táblázatok, hivatkozáslista.',
    '4. `04_cover_letter.md` — kísérőlevél a szerkesztőnek.',
    '5. `05_reprodukcio/` — kód, környezet, futtatási parancsok, és hogy melyik eredmény melyik lépésből származik.',
    '6. `06_nyitott_kerdesek.md` — amit a kutatónak kell eldöntenie vagy pótolnia (adat, jóváhagyás, szerzők, finanszírozás, etikai engedély).'
  ].join('\n');
  function packResultMd(res) {
    if (!res || typeof res !== 'object') return '';
    var o = [];
    if (res.summary) o.push(String(res.summary).trim());
    if (res.metrics && typeof res.metrics === 'object' && Object.keys(res.metrics).length) o.push('- Metrikák: `' + JSON.stringify(res.metrics).slice(0, 1500) + '`');
    if (res.acceptance_check) o.push('- Kritérium-ellenőrzés: ' + (typeof res.acceptance_check === 'string' ? res.acceptance_check : '`' + JSON.stringify(res.acceptance_check).slice(0, 1500) + '`'));
    if (res.deviations && (typeof res.deviations === 'string' ? res.deviations.trim() : rdList(res.deviations).length)) o.push('- Eltérések: ' + (typeof res.deviations === 'string' ? res.deviations : rdList(res.deviations).join('; ')));
    if (rdList(res.artifacts).length) o.push('- Artefaktumok: ' + rdList(res.artifacts).slice(0, 30).join(', '));
    if (rdList(res.figures).length) o.push('- Ábrák: ' + rdList(res.figures).slice(0, 20).join(', '));
    if (res.verdict && res.verdict.verdict) o.push('- Független ellenőrzés (bíró-modell): ' + res.verdict.verdict + (res.verdict.total != null ? ' (' + res.verdict.total + '/100)' : ''));
    if (res.error) o.push('- Hiba: ' + String(res.error).slice(0, 600));
    if (res.report) o.push('', '<details><summary>Futtatói jelentés</summary>', '', String(res.report).slice(0, 5000), '', '</details>');
    // an empty / bookkeeping-only result object must NOT read as "this step already has a result"
    if (!o.length) return '';
    return ['', '**Eddigi eredmény' + (res.ok === true ? ' (a futtató szerint sikeres — ellenőrizendő)' : res.ok === false ? ' (a futtató szerint sikertelen)' : '') + ':**'].concat(o).join('\n');
  }
  function apLoadPack(o) {
    function P(q) { return q ? Promise.resolve(q).then(function (v) { return v; }, function () { return null; }) : Promise.resolve(null); }
    var dp = o.day.split('-'), d0 = new Date(+dp[0], +dp[1] - 1, +dp[2]), d1 = new Date(+dp[0], +dp[1] - 1, +dp[2] + 1);
    var runs = o.runs.slice().sort(function (a, b) { return String(a.project_id).localeCompare(String(b.project_id)) || String(a.created_at || '').localeCompare(String(b.created_at || '')); });
    var pids = runs.map(function (r) { return r.project_id; }).filter(function (x, i, a) { return x && a.indexOf(x) === i; });
    return Promise.all([
      P(sb.from('research_projects').select('*').in('id', pids)),
      P(sb.from('research_journal_picks').select('*').in('project_id', pids))
    ]).then(function (base) {
      var projects = {}; ((base[0] && base[0].data) || []).forEach(function (p) { projects[p.id] = p; });
      var picks = (base[1] && base[1].data) || [];
      return Promise.all(runs.map(function (r) {
        var sid = r.study_id, s8 = String(sid || '').slice(0, 8);
        return Promise.all([
          P(sb.from('research_autopilot_events').select('created_at,phase,level,message').eq('run_id', r.id).gte('created_at', d0.toISOString()).lt('created_at', d1.toISOString()).order('id', { ascending: true }).limit(500)),
          P(sb.from('research_ideas').select('id,question,hypothesis,rationale,novelty,source,gap_type,study_id').eq('project_id', r.project_id).neq('status', 'rejected').order('created_at', { ascending: true }).limit(200)),
          sid ? apFetchAll(function () { return sb.from('research_study_papers').select('id,source_id,step,decision,overridden').eq('study_id', sid).order('id', { ascending: true }); }).then(null, function () { return []; }) : Promise.resolve([]),
          P(sid ? sb.from('research_files').select('path,content,updated_at').eq('project_id', r.project_id).ilike('path', 'studies/%-' + s8 + '-review.md').order('updated_at', { ascending: false }).limit(1) : null),
          P(sid ? sb.from('research_extraction_questions').select('id,text,ord').eq('study_id', sid).order('ord', { ascending: true }) : null),
          P(r.protocol_id ? sb.from('research_protocols').select('id,title,goal,status').eq('id', r.protocol_id).maybeSingle() : null),
          P(r.protocol_id ? sb.from('research_protocol_steps').select('id,ord,title,kind,status,assignee,needs_approval,depends_on,spec,result').eq('protocol_id', r.protocol_id).order('ord', { ascending: true }) : null)
        ]).then(function (x) {
          var deep = {};
          (x[2] || []).forEach(function (p) { var c = deep[p.source_id]; if (!c || (p.step || 0) >= (c.step || 0)) deep[p.source_id] = p; });
          var inc = Object.keys(deep).map(function (k) { return deep[k]; }).filter(function (p) { return p.decision === 'include' || (p.overridden && p.decision !== 'exclude'); });
          var ids = inc.map(function (p) { return p.source_id; }), exq = (x[4] && x[4].data) || [], jobs = [];
          for (var i = 0; i < ids.length; i += 100) jobs.push(P(sb.from('research_sources').select('id,title,authors,year,venue,doi,url,abstract,cited_by').in('id', ids.slice(i, i + 100))));
          var cq = exq.length ? P(sb.from('research_extraction_cells').select('question_id,source_id,status,answer,quote,location').in('question_id', exq.map(function (q) { return q.id; }))) : Promise.resolve(null);
          return Promise.all([Promise.all(jobs), cq]).then(function (y) {
            var srcs = {}; y[0].forEach(function (res) { ((res && res.data) || []).forEach(function (sr) { srcs[sr.id] = sr; }); });
            return { run: r, events: (x[0] && x[0].data) || [], ideas: (x[1] && x[1].data) || [], inc: inc, screened: Object.keys(deep).length, srcs: srcs,
              review: ((x[3] && x[3].data) || [])[0] || null, exq: exq, cells: (y[1] && y[1].data) || [], prot: x[5] && x[5].data, steps: (x[6] && x[6].data) || [] };
          });
        });
      })).then(function (packs) { return { owner: o.owner, uni: o.uni, projects: projects, picks: picks, packs: packs }; });
    });
  }
  // groups: [{ owner, uni, runs }] — one or more researchers of the same day, rendered into ONE file
  function apBuildAgentPack(groups, day) {
    return Promise.all(groups.map(function (g) { return apLoadPack({ owner: g.owner, uni: g.uni, day: day, runs: g.runs }); }))
      .then(function (loaded) { return packRenderAll(loaded, day); });
  }
  function packRenderAll(groups, day) {
    var DONE = { done: 1, skipped: 1 }, sNum = {}, sN = 0, now = Date.now(), multi = groups.length > 1;
    function hd(n) { return new Array(Math.min(6, n + (multi ? 1 : 0)) + 1).join('#') + ' '; }   // one level deeper per researcher when several
    function sref(id) { if (!sNum[id]) sNum[id] = 'S' + (++sN); return sNum[id]; }
    groups.forEach(function (g) { g.packs.forEach(function (pk) { pk.inc.forEach(function (p) { sref(p.source_id); }); }); });
    var nSteps = 0, nOpen = 0, nRuns = 0, nProj = 0;
    groups.forEach(function (g) { nRuns += g.packs.length; nProj += Object.keys(g.projects).length; g.packs.forEach(function (pk) { pk.steps.forEach(function (st) { nSteps++; if (!DONE[st.status]) nOpen++; }); }); });
    var dp = day.split('-'), dayLong = new Date(+dp[0], +dp[1] - 1, +dp[2]).toLocaleDateString('hu-HU', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
    var names = groups.map(function (g) { return (g.owner && g.owner.name) || 'ismeretlen kutató'; });
    var L = [];
    L.push('# Publify — agent-csomag: ' + (multi ? names.length + ' kutató' : names[0]), '');
    L.push('> Kutató' + (multi ? 'k' : '') + ': ' + groups.map(function (g, i) { return '**' + names[i] + '** (' + (g.uni || '—') + ')'; }).join(', ') + '  ',
      '> Nap: **' + dayLong + '** · Készült: ' + new Date().toLocaleString('hu-HU') + '  ',
      '> Tartalom: ' + nRuns + ' Autopilot-futás · ' + nProj + ' projekt · ' + nSteps + ' protokoll-lépés (' + nOpen + ' nyitott) · ' + sN + ' beválasztott forrás', '');
    var brief = PACK_BRIEF.replace('{NAME}', multi ? ('a kiválasztott kutatók (' + names.join(', ') + ')') : names[0]).replace('{DAY}', dayLong);
    if (multi) brief = brief.replace('A feladatod három részből áll, ebben a sorrendben.',
      '**A csomag ' + names.length + ' kutató anyagát tartalmazza — mindegyiküket külön kezeld.** Kutatónként (és azon belül projektenként) külön protokoll-jelentés, folyóirat-választás és kézirat készüljön; a leadandókat kutatónként külön mappába tedd (`<kutató-név>/01_…`). Különböző kutatók eredményeit ne vond össze egy cikkbe, és ne használd fel egymás adatait. Az irodalmi azonosítók ([S#]) a teljes csomagban egyediek, ezért a forrásokat szabadon hivatkozhatod.\n\nA feladatod — kutatónként — három részből áll, ebben a sorrendben.');
    L.push(brief, '');
    L.push('## 2. Összesítő', '', '| ' + (multi ? 'Kutató | ' : '') + 'Projekt | Futás | Állapot most | Fázis most | Beválasztott forrás | Protokoll-lépés (nyitott / összes) |', '|' + (multi ? '---|' : '') + '---|---|---|---|---:|---:|');
    groups.forEach(function (g, gi) {
      g.packs.forEach(function (pk) {
        var r = pk.run, ph = (r.phases || [])[r.phase_index] || {}, open = pk.steps.filter(function (st) { return !DONE[st.status]; }).length;
        L.push('| ' + (multi ? mdCell(names[gi]) + ' | ' : '') + mdCell((g.projects[r.project_id] || {}).title || 'Projekt') + ' | ' + r.id.slice(0, 8) + ' | ' + KIND_LAB[nowKind(r, now)] + ' | ' + mdCell(ph.label || ph.key || '—') + ' | ' + pk.inc.length + ' | ' + open + ' / ' + pk.steps.length + ' |');
      });
    });
    L.push('');
    var secN = 2;
    groups.forEach(function (g, gi) {
      var projects = g.projects, picks = g.picks, curProj = null;
      if (multi) { secN++; L.push('---', '', '## ' + secN + '. Kutató: ' + names[gi] + ' (' + (g.uni || '—') + ')', ''); }
      g.packs.forEach(function (pk) {
        var r = pk.run, proj = projects[r.project_id] || {};
        if (r.project_id !== curProj) {
          curProj = r.project_id;
          if (!multi) secN++;
          L.push(multi ? '' : '---', '', hd(2) + (multi ? '' : secN + '. ') + 'Projekt: ' + (mdOne(proj.title) || 'Projekt'), '');
          if (proj.goal) L.push('- **Cél / kutatási irány:** ' + mdOne(proj.goal, 4000));
          if (proj.field) L.push('- **Terület:** ' + mdOne(proj.field));
          if (proj.keywords && proj.keywords.length) L.push('- **Kulcsszavak:** ' + proj.keywords.join(', '));
          if (proj.language) L.push('- **Projekt nyelve:** ' + proj.language);
          L.push('- **Publify:** ' + location.href.replace(/[?#].*$/, '').replace(/[^/]*$/, '') + 'Research.html?project=' + proj.id);
          var jp = picks.filter(function (x) { return x.project_id === r.project_id; });
          if (jp.length) {
            L.push('', '**A projektben már felmerült folyóirat-jelöltek** (értékeld őket a B) részben):');
            jp.forEach(function (x) { L.push('- ' + mdOne(x.title || x.name || x.journal_title || x.journal || JSON.stringify(x).slice(0, 200)) + (x.issn ? ' (ISSN ' + x.issn + ')' : '') + (x.note || x.reason ? ' — ' + mdOne(x.note || x.reason, 300) : '')); });
          }
          L.push('');
        }
        var ph = (r.phases || [])[r.phase_index] || {};
        L.push(hd(3) + 'Autopilot-futás ' + r.id.slice(0, 8) + ' — ' + KIND_LAB[nowKind(r, now)] + ' (' + (ph.label || ph.key || '—') + ')', '');
        if (r.status === 'failed' && r.error) L.push('> Hiba: ' + mdOne(r.error, 500), '');
        if (r.status === 'awaiting_approval' && r.gate) L.push('> Döntésre vár: **' + mdOne(r.gate.title) + '** — ' + mdOne(r.gate.detail, 400), '');
        L.push('**Fázisok:**');
        (r.phases || []).filter(function (x) { return x.enabled !== false && x.status !== 'wip'; }).forEach(function (x) { L.push('- ' + (x.label || x.key) + ': ' + (PH_ST[x.status] || x.status) + (x.result ? ' — ' + mdOne(x.result, 300) : '')); });
        L.push('');
        if (pk.events.length) {
          L.push('**Aznap történt (' + pk.events.length + ' esemény):**');
          pk.events.slice(-60).forEach(function (e) { L.push('- ' + timeOf(e.created_at) + (e.phase ? ' · ' + e.phase : '') + (e.level === 'error' ? ' · HIBA' : '') + ' — ' + mdOne(e.message, 300)); });
          L.push('');
        }
        var dev = r.config && r.config.develop_idea_id, idea = pk.ideas.filter(function (i) { return i.id === dev; })[0];
        if (idea) {
          L.push(hd(4) + 'Kidolgozott kutatási ötlet', '', '- **Kérdés:** ' + mdOne(idea.question, 2000));
          if (idea.hypothesis) L.push('- **Hipotézis:** ' + mdOne(idea.hypothesis, 2000));
          if (idea.rationale) L.push('- **Indoklás:** ' + mdOne(idea.rationale, 2000));
          L.push('');
        } else {
          // older runs did not record which idea they develop → give the agent the project's ideas instead of nothing
          var plain = pk.ideas.filter(function (i) { return i.source !== 'gap'; });
          if (plain.length) {
            L.push(hd(4) + 'A projekt kutatási ötletei (a futás nem rögzítette, melyiket dolgozza ki)', '');
            plain.slice(0, 8).forEach(function (i, ii) { L.push((ii + 1) + '. **' + mdOne(i.question, 600) + '**' + (i.hypothesis ? '  \n   Hipotézis: ' + mdOne(i.hypothesis, 600) : '')); });
            L.push('');
          }
        }
        var gapsAll = pk.ideas.filter(function (i) { return i.source === 'gap'; }), gapsMine = gapsAll.filter(function (i) { return r.study_id && i.study_id === r.study_id; });
        var gaps = gapsMine.length ? gapsMine : gapsAll;
        if (gaps.length) {
          L.push(hd(4) + 'Kutatási rések (' + gaps.length + ')', '');
          gaps.forEach(function (gp, gpi) { L.push((gpi + 1) + '. **' + mdOne(gp.question, 600) + '**' + (gp.gap_type ? ' `' + gp.gap_type + '`' : '') + (gp.novelty != null ? ' · újdonság ' + gp.novelty + '/100' : '') + (gp.rationale ? '  \n   ' + mdOne(gp.rationale, 900) : '')); });
          L.push('');
        }
        if (pk.inc.length) {
          L.push(hd(4) + 'Beválasztott irodalom (' + pk.inc.length + ' / ' + pk.screened + ' átszűrt)', '');
          pk.inc.forEach(function (p) {
            var sr = pk.srcs[p.source_id] || {};
            var au = Array.isArray(sr.authors) ? sr.authors.map(rdText).slice(0, 6).join(', ') + (sr.authors.length > 6 ? ' et al.' : '') : (sr.authors ? mdOne(sr.authors, 200) : '');
            L.push('- **[' + sref(p.source_id) + ']** ' + (au ? au + ' ' : '') + (sr.year ? '(' + sr.year + '). ' : '') + '*' + mdOne(sr.title || 'Cím nélkül') + '*' + (sr.venue ? '. ' + mdOne(sr.venue) : '') + (sr.doi ? '. https://doi.org/' + String(sr.doi).replace(/^https?:\/\/(dx\.)?doi\.org\//, '') : (sr.url ? '. ' + sr.url : '')) + (sr.cited_by != null ? ' · ' + sr.cited_by + ' hivatkozás' : ''));
            if (sr.abstract) L.push('  > ' + mdOne(sr.abstract, 900));
          });
          L.push('');
        }
        if (pk.review && pk.review.content) {
          L.push(hd(4) + 'Szisztematikus áttekintés (' + String(pk.review.path || '').split('/').pop() + ')', '');
          var shift = multi ? 5 : 4;
          L.push(String(pk.review.content).replace(/^(#{1,6})\s/gm, function (m, gg) { return new Array(Math.min(6, gg.length + shift) + 1).join('#') + ' '; }).trim(), '');
        }
        if (pk.exq.length) {
          L.push(hd(4) + 'Kivonatolt adatok (' + pk.exq.length + ' kérdés)', '');
          pk.exq.forEach(function (q) {
            var cs = pk.cells.filter(function (c) { return c.question_id === q.id; });
            var done = cs.filter(function (c) { return c.status === 'done'; }), na = cs.filter(function (c) { return c.status === 'na'; }).length, err = cs.filter(function (c) { return c.status === 'error'; }).length;
            L.push('**' + mdOne(q.text) + '** — ' + done.length + ' válasz' + (na ? ' · ' + na + ' cikkben nincs adat' : '') + (err ? ' · ' + err + ' hibás cella' : ''));
            done.forEach(function (c) { L.push('- [' + sref(c.source_id) + '] ' + mdOne(c.answer, 600) + (c.quote ? ' — „' + mdOne(c.quote, 300) + '”' : '') + (c.location && (c.location.page || c.location.section || c.location.figure) ? ' (' + [c.location.page ? 'o. ' + c.location.page : '', c.location.section || '', c.location.figure || ''].filter(Boolean).join(', ') + ')' : '')); });
            L.push('');
          });
        }
        if (pk.steps.length) {
          var ordToTitle = {}; pk.steps.forEach(function (st) { ordToTitle[st.ord] = st.title; });
          L.push(hd(4) + 'Protokoll: ' + (mdOne(pk.prot && pk.prot.title) || '—') + ' (' + pk.steps.length + ' lépés, ' + pk.steps.filter(function (st) { return !DONE[st.status]; }).length + ' nyitott)', '');
          if (pk.prot && pk.prot.goal) L.push('**Cél:** ' + mdOne(pk.prot.goal, 3000), '');
          pk.steps.forEach(function (st) {
            var sp = st.spec || {};
            L.push(hd(5) + st.ord + '. ' + (mdOne(st.title) || 'Lépés'), '');
            L.push('`' + (st.kind || 'lépés') + ' · ' + (st.assignee === 'human' ? 'Human' : 'AI') + ' · ' + (st.status || '—') + '`' + (sp.est_minutes ? ' · becsült idő: ' + sp.est_minutes + ' perc' : '') + (st.needs_approval ? ' · ⚠ **Jóváhagyást kér**' : ''));
            var deps = (st.depends_on || []).map(function (dd) { return dd + '. ' + mdOne(ordToTitle[dd] || '', 60); });
            if (deps.length) L.push('', '- Függ: ' + deps.join('; '));
            if (sp.instruction) L.push('', '**Utasítás:**', String(sp.instruction).trim());
            if (rdList(sp.inputs).length) L.push('', '**Bemenetek:**', rdList(sp.inputs).map(function (t) { return '- ' + t; }).join('\n'));
            if (rdList(sp.expected_outputs).length) L.push('', '**Elvárt kimenetek:**', rdList(sp.expected_outputs).map(function (t) { return '- ' + t; }).join('\n'));
            if (rdList(sp.acceptance).length) L.push('', '**Elfogadási kritériumok:**', rdList(sp.acceptance).map(function (t) { return '- ' + t; }).join('\n'));
            if (sp.command_hint) L.push('', '**Javasolt parancs:**', '```bash', String(sp.command_hint).trim(), '```');
            var rm = packResultMd(st.result); if (rm) L.push(rm);
            L.push('');
          });
        }
      });
    });
    return L.join('\n');
  }

  // ---- Admin run detail: what the run produced so far, and — at a gate — EXACTLY what an approval signs off ----
  var PH_ST = { done: '✓ kész', running: '⟳ fut', gate: '⏸ döntésre vár', wait: 'vár', pending: 'vár', skipped: 'kihagyva', failed: '✕ hiba' };
  function rdText(x) { return (x && typeof x === 'object') ? (x.name || x.title || x.text || x.path || x.file || JSON.stringify(x)) : String(x == null ? '' : x); }
  function rdList(v) { return (Array.isArray(v) ? v : (v ? [v] : [])).map(rdText).filter(function (x) { return x.trim(); }); }
  function RunDetail(props) {
    var r = props.run, u = props.user || {}, p = props.project || {};
    var dS = useState(null), d = dS[0], setD = dS[1];
    var rvS = useState(false), showRev = rvS[0], setShowRev = rvS[1];
    var closeRef = useRef(null);
    useEffect(function () {
      function onKey(e) { if (e.key === 'Escape') props.onClose(); }
      window.addEventListener('keydown', onKey);
      try { if (closeRef.current) closeRef.current.focus(); } catch (e) { }
      return function () { window.removeEventListener('keydown', onKey); };
    }, []);
    useEffect(function () {
      var live = true, sid = r.study_id, pid = r.project_id, s8 = String(sid || '').slice(0, 8);
      function P(q) { return q ? Promise.resolve(q).then(function (v) { return v; }, function () { return null; }) : Promise.resolve(null); }
      function merge(patch) { if (live) setD(function (old) { return Object.assign({}, (old && !old.err) ? old : {}, patch); }); }
      // 1) the fast part first — protocol steps, events, review, ideas — so a protocol gate is readable at once
      Promise.all([
        P(sb.from('research_autopilot_events').select('id,created_at,phase,level,message').eq('run_id', r.id).order('id', { ascending: false }).limit(60)),
        P(r.protocol_id ? sb.from('research_protocol_steps').select('id,ord,title,kind,status,assignee,needs_approval,spec').eq('protocol_id', r.protocol_id).order('ord', { ascending: true }) : null),
        P(r.protocol_id ? sb.from('research_protocols').select('id,title,goal,status').eq('id', r.protocol_id).maybeSingle() : null),
        P(sid ? sb.from('research_files').select('id,path,content,updated_at').eq('project_id', pid).ilike('path', 'studies/%-' + s8 + '-review.md').order('updated_at', { ascending: false }).limit(1) : null),
        P(sb.from('research_ideas').select('id,question,novelty,source,study_id,created_at').eq('project_id', pid).neq('status', 'rejected').order('created_at', { ascending: false }).limit(80)),
        P(sid ? sb.from('research_extraction_questions').select('id,text').eq('study_id', sid) : null)
      ]).then(function (res) {
        var exq = (res[5] && res[5].data) || [];
        merge({ events: (res[0] && res[0].data) || [], steps: (res[1] && res[1].data) || [], prot: res[2] && res[2].data, review: ((res[3] && res[3].data) || [])[0] || null,
          ideas: (res[4] && res[4].data) || [], exq: exq, papersLoading: !!sid, inc: [], maybe: [], exc: 0, screened: 0, srcs: {}, cells: {} });
        // 2) the heavy part — every screening decision of the study (can be thousands of rows) + titles + extraction cells
        return Promise.all([
          sid ? apFetchAll(function () { return sb.from('research_study_papers').select('id,source_id,step,decision,overridden,reason,score').eq('study_id', sid).order('id', { ascending: true }); }).then(null, function () { return []; }) : Promise.resolve([]),
          exq.length ? P(sb.from('research_extraction_cells').select('status').in('question_id', exq.map(function (q) { return q.id; }))) : Promise.resolve(null)
        ]).then(function (r2) {
          // the SAME include rule the pipeline uses: a paper counts by its DEEPEST screening step (override wins unless excluded)
          var deep = {};
          (r2[0] || []).forEach(function (x) { var c = deep[x.source_id]; if (!c || (x.step || 0) >= (c.step || 0)) deep[x.source_id] = x; });
          var inc = [], maybe = [], exc = 0;
          Object.keys(deep).forEach(function (k) { var x = deep[k]; if (x.decision === 'include' || (x.overridden && x.decision !== 'exclude')) inc.push(x); else if (x.decision === 'maybe') maybe.push(x); else exc++; });
          maybe.sort(function (a, b) { return (b.score || 0) - (a.score || 0); });
          var cc = {}; ((r2[1] && r2[1].data) || []).forEach(function (c) { cc[c.status] = (cc[c.status] || 0) + 1; });
          var want = inc.slice(0, 40).concat(maybe.slice(0, 8)).map(function (x) { return x.source_id; });
          return (want.length ? P(sb.from('research_sources').select('id,title,year,venue,url').in('id', want)) : Promise.resolve(null)).then(function (r3) {
            var srcs = {}; ((r3 && r3.data) || []).forEach(function (x) { srcs[x.id] = x; });
            merge({ inc: inc, maybe: maybe, exc: exc, screened: Object.keys(deep).length, srcs: srcs, cells: cc, papersLoading: false });
          });
        });
      }).then(null, function (e) { if (live) setD({ err: (e && e.message) || String(e) }); });
      return function () { live = false; };
    }, [r.id, r.status, r.phase_index, r.protocol_id, r.study_id]);

    var k = stuckKind(r, Date.now()), meta = STUCK_META[k] || null;
    var ph = (r.phases || [])[r.phase_index] || {}, gate = r.status === 'awaiting_approval' ? (r.gate || {}) : null;
    var ok = d && !d.err;
    function srcLi(x) {
      var sr = (d.srcs || {})[x.source_id] || {};
      return h('li', { key: x.source_id, className: 'rd-src' },
        sr.url ? h('a', { href: sr.url, target: '_blank', rel: 'noopener' }, sr.title || 'Forrás') : h('b', null, sr.title || 'Forrás'),
        [sr.year, sr.venue].filter(Boolean).length ? h('span', { className: 'rd-sub' }, [sr.year, sr.venue].filter(Boolean).join(' · ')) : null,
        x.reason ? h('span', { className: 'rd-why' }, String(x.reason).slice(0, 240)) : null);
    }
    function kv(label, items) { return items.length ? h('div', { className: 'rd-kv' }, h('span', null, label), h('ul', null, items.map(function (t, i) { return h('li', { key: i }, t); }))) : null; }
    function stepCard(st, open) {
      var sp = st.spec || {};
      return h('details', { key: st.id, className: 'rd-step' + (st.needs_approval ? ' need' : ''), open: open },
        h('summary', null,
          h('span', { className: 'rd-ord' }, st.ord + '.'), h('b', null, st.title || 'Lépés'),
          st.needs_approval ? h('span', { className: 'st-pill gate' }, 'Jóváhagyást kér') : null,
          h('span', { className: 'rd-sub' }, [st.kind, st.assignee === 'human' ? 'Human' : 'AI', sp.est_minutes ? sp.est_minutes + ' perc' : null, st.status].filter(Boolean).join(' · '))),
        sp.instruction ? h('p', { className: 'rd-p' }, String(sp.instruction)) : null,
        kv('Bemenetek', rdList(sp.inputs)), kv('Elvárt kimenetek', rdList(sp.expected_outputs)), kv('Elfogadási kritériumok', rdList(sp.acceptance)),
        sp.command_hint ? h('div', { className: 'rd-kv' }, h('span', null, 'Javasolt parancs'), h('code', { className: 'rd-code' }, String(sp.command_hint))) : null);
    }
    function approvalNote() {
      if (!ok || !gate) return '';
      if (gate.phase === 'protocol') return d.steps.filter(function (x) { return x.needs_approval; }).slice(0, 3).map(function (x) { return x.ord + '. ' + x.title; }).join('; ');
      return d.inc.length + ' beválasztott cikkel';
    }
    function decision() {
      if (!gate) return null;
      var body, canApprove = true, why = null;
      if (!d) body = h('div', { className: 'rd-load' }, h('span', { className: 'spin' }), ' A döntés tárgyának betöltése…');
      else if (d.err) { body = h('div', { className: 'rd-err' }, 'Nem sikerült betölteni: ' + d.err); canApprove = false; }
      else if (gate.phase === 'protocol') {
        var need = d.steps.filter(function (x) { return x.needs_approval; }), rest = d.steps.filter(function (x) { return !x.needs_approval; });
        body = h('div', { className: 'rd-col' },
          d.prot ? h('div', { className: 'rd-sub' }, 'Protokoll: ', h('b', null, d.prot.title || '—'), ' · ' + d.steps.length + ' lépés') : null,
          need.length ? h('div', { className: 'rd-steps' }, need.map(function (x) { return stepCard(x, true); }))
            : h('div', { className: 'rd-sub' }, 'Nem található jóváhagyást kérő lépés — lehet, hogy közben valaki jóváhagyta.'),
          rest.length ? h('details', { className: 'rd-more' }, h('summary', null, 'A protokoll többi lépése (' + rest.length + ')'), h('div', { className: 'rd-steps' }, rest.map(function (x) { return stepCard(x, false); }))) : null);
      } else if ((gate.phase === 'literature' || gate.phase === 'sr' || gate.phase === 'extract') && d.papersLoading) {
        body = h('div', { className: 'rd-load' }, h('span', { className: 'spin' }), ' A szűrési döntések betöltése…'); canApprove = false;
      } else if (gate.phase === 'literature' || gate.phase === 'sr' || gate.phase === 'extract') {
        canApprove = d.inc.length > 0;
        if (!canApprove) why = 'Nincs beválasztott cikk, így jóváhagyás után a futás ugyanitt újra megállna. Előbb a projekt Irodalom kártyáján („Bírálat ›”) kell kézzel bevenni cikkeket.';
        body = h('div', { className: 'rd-col' },
          h('div', { className: 'rd-counts' }, h('span', null, h('b', null, d.inc.length), ' beválasztva'), h('span', null, h('b', null, d.maybe.length), ' talán'), h('span', null, h('b', null, d.exc), ' kizárva'), h('span', null, h('b', null, d.screened), ' átszűrve')),
          d.inc.length ? h('div', null, h('div', { className: 'rd-lab' }, 'Jóváhagyással ezekkel a cikkekkel megy tovább'), h('ol', { className: 'rd-srcs' }, d.inc.slice(0, 40).map(srcLi)), d.inc.length > 40 ? h('div', { className: 'rd-sub' }, '…és még ' + (d.inc.length - 40)) : null)
            : d.maybe.length ? h('div', null, h('div', { className: 'rd-lab' }, 'A legesélyesebb „talán” jelöltek — ezek közül lehet kézzel bevenni'), h('ol', { className: 'rd-srcs' }, d.maybe.slice(0, 8).map(srcLi))) : null);
      } else body = h('div', { className: 'rd-sub' }, 'Ehhez a döntési ponthoz nincs részletező nézet — nézd meg a futás dashboardján.');
      return h('section', { className: 'rd-card decide', 'aria-label': 'Erről döntesz' },
        h('div', { className: 'rd-lab' }, 'Erről döntesz'),
        h('h3', null, gate.title || 'Jóváhagyás'),
        gate.detail ? h('p', { className: 'rd-sub' }, gate.detail) : null,
        body,
        why ? h('div', { className: 'rd-warn' }, why) : null,
        h('div', { className: 'rd-acts' },
          h('button', { type: 'button', className: 'btn pri sm', disabled: !ok || !canApprove || props.busy, onClick: function () { props.onResume(r, approvalNote()); } }, '✓ Jóváhagyom és folytatom'),
          h('a', { className: 'btn sm', href: 'Research.html?project=' + encodeURIComponent(r.project_id), target: '_blank', rel: 'noopener' }, 'Megnyitás a Research-ben ↗')));
    }
    function stalled() {
      if (!meta || !meta.act || k === 'gate') return null;
      var lastEv = ok && d.events[0];
      return h('section', { className: 'rd-card' },
        h('div', { className: 'rd-lab' }, 'Miért áll'),
        h('p', { className: 'rd-p' }, k === 'failed' ? (r.error || 'Ismeretlen hiba')
          : k === 'orphan' ? ('Utolsó életjel: ' + agoHu(r.driver_beat || r.updated_at) + '. A futás „fut” állapotú, de a tulajdonos lapja nincs nyitva, így senki nem viszi tovább.')
            : 'A tulajdonos szüneteltette.'),
        lastEv ? h('div', { className: 'rd-sub' }, 'Utolsó esemény (' + timeOf(lastEv.created_at) + '): ' + lastEv.message) : null,
        h('div', { className: 'rd-acts' }, h('button', { type: 'button', className: 'btn pri sm', disabled: props.busy, onClick: function () { props.onResume(r, ''); } }, meta.act)));
    }
    function phaseExtra(key) {
      if (!ok) return null;
      if (key === 'ideas') {
        var dev = r.config && r.config.develop_idea_id, idea = d.ideas.filter(function (i) { return i.id === dev; })[0];
        return h('div', { className: 'rd-sub' }, d.ideas.filter(function (i) { return i.source !== 'gap'; }).length + ' ötlet a projektben' + (idea ? ' · kidolgozásra kiválasztva: „' + String(idea.question || '').slice(0, 200) + '”' : ''));
      }
      if (key === 'literature' && d.papersLoading) return h('div', { className: 'rd-sub' }, 'Szűrési adatok betöltése…');
      if (key === 'literature') return d.screened ? h('div', { className: 'rd-sub' }, d.screened + ' cikk átszűrve · ' + d.inc.length + ' beválasztva' + (d.inc.length ? ': ' + d.inc.slice(0, 3).map(function (x) { return '„' + String(((d.srcs[x.source_id] || {}).title) || '').slice(0, 70) + '”'; }).join(', ') + (d.inc.length > 3 ? '…' : '') : '')) : null;
      if (key === 'sr') return d.review ? h('div', null,
        h('button', { type: 'button', className: 'rd-link', 'aria-expanded': showRev ? 'true' : 'false', onClick: function () { setShowRev(!showRev); } }, (showRev ? '▾ ' : '▸ ') + 'Az áttekintés szövege (' + String(d.review.content || '').split(/\s+/).filter(Boolean).length + ' szó)'),
        showRev ? h('div', { className: 'rd-rev report-doc', dangerouslySetInnerHTML: { __html: mdSafe(d.review.content || '') } }) : null) : null;
      if (key === 'extract') return d.exq.length ? h('div', { className: 'rd-sub' }, d.exq.length + ' kérdés · ' + (d.cells.done || 0) + ' kitöltött · ' + (d.cells.na || 0) + ' nincs adat · ' + (d.cells.error || 0) + ' hibás cella') : null;
      if (key === 'gap') {
        var all = d.ideas.filter(function (i) { return i.source === 'gap'; }), mine = all.filter(function (i) { return r.study_id && i.study_id === r.study_id; });
        var gaps = mine.length ? mine : all;
        return gaps.length ? h('ul', { className: 'rd-mini' }, gaps.slice(0, 6).map(function (g) { return h('li', { key: g.id }, String(g.question || '').slice(0, 200)); })) : null;
      }
      if (key === 'protocol' && d.steps.length) {
        var na = d.steps.filter(function (x) { return x.needs_approval; }).length;
        return h('div', null,
          h('div', { className: 'rd-sub' }, (d.prot && d.prot.title ? '„' + d.prot.title + '” · ' : '') + d.steps.length + ' lépés' + (na ? ' · ' + na + ' jóváhagyást kér' : '')),
          (gate && gate.phase === 'protocol') ? null : h('details', { className: 'rd-more' }, h('summary', null, 'Lépések megnyitása'), h('div', { className: 'rd-steps' }, d.steps.map(function (x) { return stepCard(x, false); }))));
      }
      return null;
    }
    function results() {
      var phs = (r.phases || []).filter(function (x) { return x.enabled !== false && x.status !== 'wip'; });
      return h('section', { className: 'rd-card' },
        h('div', { className: 'rd-lab' }, 'Eredmények fázisonként'),
        !d ? h('div', { className: 'rd-load' }, h('span', { className: 'spin' }), ' Betöltés…') : null,
        h('ol', { className: 'rd-phases' }, phs.map(function (x) {
          return h('li', { key: x.key, className: 'rd-ph s-' + x.status },
            h('div', { className: 'rd-ph-h' }, h('span', null, AP_ICON[x.key] || '•'), h('b', null, x.label || x.key), h('span', { className: 'rd-ph-st' }, PH_ST[x.status] || x.status)),
            x.result ? h('div', { className: 'rd-sub' }, String(x.result)) : null,
            (x.status === 'done' || x.status === 'gate' || x.status === 'running') ? phaseExtra(x.key) : null);
        })));
    }
    function events() {
      var ev = ok ? d.events : [];
      return h('section', { className: 'rd-card' },
        h('div', { className: 'rd-lab' }, 'Eseménynapló' + (ev.length ? ' — legutóbbi ' + ev.length : '')),
        !d ? h('div', { className: 'rd-load' }, h('span', { className: 'spin' })) : ev.length ? h('ol', { className: 'rd-evs' }, ev.map(function (e) {
          return h('li', { key: e.id, className: 'lv-' + e.level },
            h('time', null, new Date(e.created_at).toLocaleString('hu-HU', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })),
            h('span', null, (e.phase ? (AP_ICON[e.phase] || '') + ' ' : '') + e.message));
        })) : h('div', { className: 'rd-sub' }, 'Nincs esemény.'));
    }
    var c = props.carry;
    return h('div', { className: 'rd-scrim', onMouseDown: function (e) { if (e.target === e.currentTarget) props.onClose(); } },
      h('aside', { className: 'rd-drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'A futás részletei' },
        h('div', { className: 'rd-head' },
          h('div', { className: 'rd-hl' },
            meta ? h('span', { className: 'st-pill ' + meta.cls }, meta.lab) : h('span', { className: 'st-pill ' + (r.status === 'done' ? 'ok' : 'mute') }, r.status === 'done' ? '✓ Végzett' : r.status === 'cancelled' ? 'Leállítva' : r.status),
            h('h2', null, p.title || 'Projekt'),
            h('div', { className: 'rd-sub' }, (u.name || '—') + ' · ' + canonUni(u.affiliation) + ' · most: ' + (AP_ICON[ph.key] || '') + ' ' + (ph.label || ph.key || '—'))),
          h('button', { type: 'button', className: 'rd-x', ref: closeRef, 'aria-label': 'Bezárás', onClick: props.onClose }, '×')),
        h('div', { className: 'rd-body' },
          c ? h('div', { className: 'st-live' + (c.state === 'ended' ? ' end' : ''), role: 'status' }, c.state !== 'ended' ? h('span', { className: 'spin' }) : null, c.label ? h('b', null, c.label) : null, h('span', null, c.msg || '')) : null,
          decision(), stalled(), results(), events(),
          h('div', { className: 'rd-foot' }, h('a', { className: 'btn sm', href: 'Autopilot.html?run=' + encodeURIComponent(r.id), target: '_blank', rel: 'noopener' }, 'A futás dashboardja ↗')))));
  }

  // Calendar view of the Autopilot: a day cell = the runs that had ACTIVITY that day (their event log — not created/updated
  // spans, which would paint idle days between a stall and a resume), coloured by each run's state NOW; a red badge marks
  // runs that stalled that day. The day panel lists those runs with what happened that day, and resumes the stuck ones.
  function StuckCenter() {
    var t0 = new Date();
    var mS = useState({ y: t0.getFullYear(), m: t0.getMonth() }), mon = mS[0], setMonRaw = mS[1];
    var sdS = useState(apDay(t0)), selDay = sdS[0], setSelDay = sdS[1];   // 'YYYY-MM-DD' | 'stuck' (every stuck run, any day)
    var dS = useState(null), data = dS[0], setData = dS[1];             // null | {err} | {runs, users, projects, byDay}
    var fS = useState('all'), filt = fS[0], setFilt = fS[1];
    var unS = useState(''), uni = unS[0], setUni = unS[1];
    var qS = useState(''), q = qS[0], setQ = qS[1];
    var slS = useState({}), sel = slS[0], setSel = slS[1];
    var cS = useState({}), carry = cS[0], setCarry = cS[1];             // run_id → { state:'queued'|'running'|'ended', label, msg }
    var orS = useState(null), openRun = orS[0], setOpenRun = orS[1];    // run id shown in the detail drawer
    var pkS = useState(null), packSel = pkS[0], setPackSel = pkS[1];    // agent package: null = every researcher of the day, else {owner_id: true}
    var pbS = useState(false), packBusy = pbS[0], setPackBusy = pbS[1];
    var tS = useState(0), setTick = tS[1];
    var drivers = useRef({}), queue = useRef([]), alive = useRef(true), carryRef = useRef({}), dataRef = useRef(null), monRef = useRef(mon), loadSeq = useRef(0), notesRef = useRef({});
    function patchCarry(id, p) { setCarry(function (m) { var n = Object.assign({}, m); n[id] = Object.assign({}, n[id] || {}, p); carryRef.current = n; return n; }); }
    function adminName() { return (BE && BE.user && (BE.user.name || BE.user.email)) || 'admin'; }
    function carrying() { return Object.keys(carryRef.current).filter(function (id) { var c = carryRef.current[id]; return c && c.state !== 'ended'; }).length; }

    function load() {
      var seq = ++loadSeq.current, y = monRef.current.y, m = monRef.current.m;
      var fromD = new Date(y, m, 1), toD = new Date(y, m + 1, 1), from = fromD.toISOString(), to = toD.toISOString();
      var keepIds = Object.keys(carryRef.current);
      return Promise.all([
        apFetchAll(function () { return sb.from('research_autopilot_events').select('id,run_id,created_at,phase,level,message').gte('created_at', from).lt('created_at', to).order('id', { ascending: true }); }),
        sb.from('research_autopilot_runs').select('*').in('status', ['running', 'failed', 'paused', 'awaiting_approval']).limit(500),
        sb.from('research_autopilot_runs').select('*').gte('created_at', from).lt('created_at', to).limit(1000)
      ]).then(function (res) {
        if (res[1] && res[1].error) throw res[1].error;
        var evs = res[0] || [], runs = {};
        ((res[1] && res[1].data) || []).concat((res[2] && res[2].data) || []).forEach(function (r) { runs[r.id] = r; });
        var need = {};
        evs.forEach(function (e) { if (!runs[e.run_id]) need[e.run_id] = 1; });
        keepIds.forEach(function (id) { if (!runs[id]) need[id] = 1; });
        var ids = Object.keys(need), jobs = [];
        for (var i = 0; i < ids.length; i += 100) jobs.push(sb.from('research_autopilot_runs').select('*').in('id', ids.slice(i, i + 100)));
        return Promise.all(jobs).then(function (more) {
          more.forEach(function (x) { ((x && x.data) || []).forEach(function (r) { runs[r.id] = r; }); });
          var oids = {}, pids = {};
          Object.keys(runs).forEach(function (id) { oids[runs[id].owner_id] = 1; pids[runs[id].project_id] = 1; });
          var ol = Object.keys(oids), pl = Object.keys(pids), pj = [];
          for (var k = 0; k < pl.length; k += 100) pj.push(sb.from('research_projects').select('id,title').in('id', pl.slice(k, k + 100)));
          return Promise.all([ol.length ? sb.from('profiles').select('id,name,email,affiliation').in('id', ol) : { data: [] }].concat(pj)).then(function (r2) {
            if (seq !== loadSeq.current || !alive.current) return;   // a newer load (e.g. month switch) owns the view
            var users = {}, projects = {};
            ((r2[0] && r2[0].data) || []).forEach(function (u) { users[u.id] = u; });
            r2.slice(1).forEach(function (x) { ((x && x.data) || []).forEach(function (p) { projects[p.id] = p; }); });
            var byDay = {}, fromT = fromD.getTime(), toT = toD.getTime();
            evs.forEach(function (e) {
              if (!runs[e.run_id]) return;   // the run was deleted since
              var d = apDay(e.created_at), b = byDay[d] || (byDay[d] = {});
              var a = b[e.run_id] || (b[e.run_id] = { n: 0, first: e.created_at, last: e.created_at, errs: 0, phases: [], lastMsg: '' });
              a.n++; a.last = e.created_at; if (e.message) a.lastMsg = e.message;
              if (e.level === 'error') a.errs++;
              if (e.phase && a.phases.indexOf(e.phase) < 0) a.phases.push(e.phase);
            });
            Object.keys(runs).forEach(function (id) {   // a run started this month but with no event yet still belongs to its start day
              var r = runs[id], ct = Date.parse(r.created_at || 0);
              if (ct >= fromT && ct < toT) { var d = apDay(r.created_at), b = byDay[d] || (byDay[d] = {}); if (!b[id]) b[id] = { n: 0, first: r.created_at, last: r.created_at, errs: 0, phases: [], lastMsg: '' }; }
            });
            dataRef.current = { runs: runs, users: users, projects: projects, byDay: byDay };
            setData(dataRef.current);
          });
        });
      }).then(null, function (e) { if (seq === loadSeq.current && alive.current) setData({ err: (e && e.message) || String(e) }); });
    }
    function setMon(y, m) {
      var d = new Date(y, m, 1), nm = { y: d.getFullYear(), m: d.getMonth() }, n = new Date();
      monRef.current = nm; setMonRaw(nm); setSel({}); setFilt('all'); setPackSel(null);
      setSelDay(n.getFullYear() === nm.y && n.getMonth() === nm.m ? apDay(n) : apDay(d));
      load();
    }
    useEffect(function () {
      load();
      var iv = setInterval(function () { if (!alive.current) return; setTick(function (x) { return x + 1; }); load(); }, 15000);
      function onProf() { setTick(function (x) { return x + 1; }); }
      function onUnload(e) { if (carrying()) { e.preventDefault(); e.returnValue = ''; return ''; } }
      window.addEventListener('pr-profile', onProf);
      window.addEventListener('beforeunload', onUnload);
      return function () {
        alive.current = false; clearInterval(iv);
        window.removeEventListener('pr-profile', onProf); window.removeEventListener('beforeunload', onUnload);
        Object.keys(drivers.current).forEach(function (id) { try { drivers.current[id].stop(); } catch (e) { } });
      };
    }, []);

    // ---- resume machinery (unchanged behaviour: lease-sharing headless drivers, 3 at a time) ----
    function rowById(id) { var d = dataRef.current; return d && d.runs ? d.runs[id] : null; }
    function updateRow(row) {
      if (!row || !alive.current) return;
      setData(function (d) {
        if (!d || !d.runs) return d;
        var runs = Object.assign({}, d.runs); runs[row.id] = Object.assign({}, runs[row.id] || {}, row);
        dataRef.current = Object.assign({}, d, { runs: runs });
        return dataRef.current;
      });
    }
    function confirmFor(list) {
      var gates = list.filter(function (r) { return r.status === 'awaiting_approval'; }), paused = list.filter(function (r) { return r.status === 'paused'; });
      var body = [list.length + ' futás folytatása a te fiókoddal. Ne zárd be ezt a lapot, amíg dolgoznak.'];
      if (gates.length) body.push(gates.length + ' futás emberi döntésre vár — a folytatás a kutató helyett hagyja jóvá: ' + gates.slice(0, 3).map(function (r) { return '„' + ((r.gate && r.gate.title) || 'jóváhagyás') + '”'; }).join(', ') + (gates.length > 3 ? '…' : '') + '. Ha a döntéshez hiányzik valami (pl. nincs beválasztott cikk), a futás újra megáll.');
      if (paused.length) body.push(paused.length + ' futást a tulajdonosa szüneteltette.');
      if (window.PRUI && window.PRUI.confirm) return window.PRUI.confirm({ title: 'Folytatod a kijelölt futásokat?', body: body.join(' '), confirmLabel: 'Folytatás' });
      return Promise.resolve(window.confirm(body.join('\n\n')));
    }
    function resumeRuns(list, onOk) {
      var now = Date.now();
      list = list.filter(function (r) { var k = stuckKind(r, now), c = carryRef.current[r.id]; return k && k !== 'live' && !(c && c.state !== 'ended'); });
      if (!list.length) return;
      confirmFor(list).then(function (ok) {
        if (!ok) return;
        if (onOk) onOk();
        list.forEach(function (r) { patchCarry(r.id, { state: 'queued', msg: 'Sorra vár (egyszerre ' + STUCK_MAX_PARALLEL + ' futás halad)…', label: null }); queue.current.push(r); });
        setSel({});
        pump();
      });
    }
    function pump() { while (Object.keys(drivers.current).length < STUCK_MAX_PARALLEL && queue.current.length) startOne(queue.current.shift()); }
    function startOne(r) {
      var kind = stuckKind(r, Date.now()), ph = (r.phases || [])[r.phase_index] || {};
      var patch = { status: 'running', error: null, updated_at: nowIso(), driver_token: null, driver_beat: null };
      if (kind === 'gate') patch.gate = null;
      if (!r.started_at) patch.started_at = nowIso();
      drivers.current[r.id] = { stop: function () { } };   // hold the slot while the status update is in flight
      patchCarry(r.id, { state: 'running', label: (AP_ICON[ph.key] || '') + ' ' + (ph.label || ph.key || ''), msg: 'Indítás…' });
      sb.from('research_autopilot_runs').update(patch).eq('id', r.id).eq('status', r.status).select('id').then(function (u) {
        if (u && u.error) { finish(r.id, null, 'Nem sikerült elindítani: ' + u.error.message); return; }
        if (!u || !u.data || !u.data.length) { finish(r.id, null, 'Közben megváltozott az állapota — frissítsd a nézetet'); return; }
        // supabase-js builders are lazy — without .then() the insert never leaves the browser
        apEmit(r, [{ phase: ph.key || null, level: 'sys', message: '▶ Admin-folytatás: ' + adminName() + (kind === 'gate' ? ' — jóváhagyva: ' + ((r.gate && r.gate.title) || '') + (notesRef.current[r.id] ? ' (' + notesRef.current[r.id] + ')' : '') : '') }]).then(function () { }, function () { });
        if (!alive.current) { delete drivers.current[r.id]; return; }
        drivers.current[r.id] = apHeadlessDriver(r.id, {
          onRow: function (row) {
            if (!alive.current) return;
            var p2 = (row.phases || [])[row.phase_index] || {};
            patchCarry(row.id, { label: (AP_ICON[p2.key] || '') + ' ' + (p2.label || p2.key || '') });
            updateRow(row);
          },
          onEvents: function (evs) { if (alive.current && evs.length) patchCarry(r.id, { msg: evs[evs.length - 1].message }); },
          onEnd: function (row, why) { finish(r.id, row, why); }
        });
      }, function () { finish(r.id, null, 'Hálózati hiba az indításkor'); });
    }
    function endMsg(row, why) {
      if (why) return why;
      if (!row) return 'Leállt';
      if (row.status === 'done') return '✓ Végzett — minden bekapcsolt fázis lefutott';
      if (row.status === 'awaiting_approval') return '⏸ Újra jóváhagyásra vár: ' + ((row.gate && row.gate.title) || '');
      if (row.status === 'failed') return '✕ Hiba: ' + String(row.error || '').slice(0, 200);
      if (row.status === 'paused') return '⏸ Szüneteltetve';
      if (row.status === 'cancelled') return '⏹ Leállítva';
      return row.status;
    }
    function finish(id, row, why) {
      delete drivers.current[id];
      if (alive.current) { patchCarry(id, { state: 'ended', msg: endMsg(row, why) }); if (row) updateRow(row); }
      pump();
      if (alive.current) load();
    }
    function pauseOne(id) {
      var d = drivers.current[id]; if (d) { try { d.stop(); } catch (e) { } }
      delete drivers.current[id];
      queue.current = queue.current.filter(function (r) { return r.id !== id; });
      patchCarry(id, { state: 'ended', msg: '⏸ Szüneteltetve (innen)' });
      sb.from('research_autopilot_runs').update({ status: 'paused', updated_at: nowIso(), driver_token: null }).eq('id', id).eq('status', 'running').then(function () {
        var r = rowById(id); if (r) apEmit(r, [{ level: 'sys', message: '⏸ Admin szüneteltette: ' + adminName() }]).then(function () { }, function () { });
        load();
      });
      pump();
    }

    if (!apIsAdmin()) return h('div', { className: 'st-wrap' }, h('div', { className: 'st-empty' }, h('b', null, 'Ez a felület csak adminisztrátoroknak érhető el.'), h('div', { style: { marginTop: 10 } }, h('a', { className: 'btn sm', href: 'Autopilot.html' }, '‹ Vissza az Autopilothoz'))));

    // ---- derive ----
    var now = Date.now(), D = (data && data.runs) ? data : null;
    var runs = D ? D.runs : {}, users = D ? D.users : {}, projects = D ? D.projects : {}, byDay = D ? D.byDay : {};
    var qq = q.trim().toLowerCase();
    function uniOfRun(r) { return canonUni((users[r.owner_id] || {}).affiliation); }
    function passBase(r) {
      if (!r) return false;
      if (uni && uniOfRun(r) !== uni) return false;
      if (qq) { var u = users[r.owner_id] || {}, p = projects[r.project_id] || {}; if ((String(u.name || '') + ' ' + String(u.affiliation || '') + ' ' + String(p.title || '')).toLowerCase().indexOf(qq) < 0) return false; }
      return true;
    }
    var uniCount = {};
    Object.keys(runs).forEach(function (id) { var k = uniOfRun(runs[id]); uniCount[k] = (uniCount[k] || 0) + 1; });
    var uniList = Object.keys(uniCount).sort(function (a, b) { return (uniCount[b] - uniCount[a]) || a.localeCompare(b, 'hu'); });
    var stuckC = { failed: 0, orphan: 0, gate: 0, paused: 0 }, stuckRuns = [], flagDay = {};
    Object.keys(runs).forEach(function (id) {
      var r = runs[id], k = stuckKind(r, now);
      if (!k || k === 'live' || !passBase(r)) return;
      stuckC[k]++; stuckRuns.push(r);
      var d = apDay(r.driver_beat || r.updated_at || r.created_at); flagDay[d] = (flagDay[d] || 0) + 1;   // the day it stalled
    });
    var active = carrying();

    // calendar grid (Monday first)
    var first = new Date(mon.y, mon.m, 1), lead = (first.getDay() + 6) % 7, dim = new Date(mon.y, mon.m + 1, 0).getDate(), todayKey = apDay(new Date());
    var cells = [], ci;
    for (ci = 0; ci < lead; ci++) cells.push(null);
    for (ci = 1; ci <= dim; ci++) cells.push(ci);
    while (cells.length % 7) cells.push(null);
    function dayCell(dn, idx) {
      if (!dn) return h('span', { key: 'e' + idx, className: 'pc-day empty', 'aria-hidden': 'true' });
      var key = apDay(new Date(mon.y, mon.m, dn)), acts = byDay[key] || {}, cnt = {}, tot = 0;
      Object.keys(acts).forEach(function (rid) { var r = runs[rid]; if (!passBase(r)) return; var k = nowKind(r, now); cnt[k] = (cnt[k] || 0) + 1; tot++; });
      var flag = flagDay[key] || 0, isSel = selDay === key;
      var label = HU_MONTHS[mon.m] + ' ' + dn + '.: ' + (tot ? tot + ' futás volt aktív' : 'nem volt aktivitás') + (flag ? ', ' + flag + ' itt akadt el' : '');
      return h('button', { key: key, type: 'button', 'data-day': key, className: 'pc-day' + (tot ? '' : ' none') + (isSel ? ' sel' : '') + (key === todayKey ? ' today' : ''), 'aria-pressed': isSel ? 'true' : 'false', 'aria-label': label, title: label,
        onClick: function () { setSelDay(key); setSel({}); setFilt('all'); setPackSel(null); } },
        h('span', { className: 'pc-dn' }, dn),
        flag ? h('span', { className: 'pc-flag', 'aria-hidden': 'true' }, flag) : null,
        tot ? h('span', { className: 'pc-cnt' }, tot + ' futás') : null,
        h('span', { className: 'pc-bar' + (tot ? '' : ' ghost') }, KIND_ORDER.filter(function (k) { return cnt[k]; }).map(function (k) { return h('i', { key: k, className: 'k-' + k, style: { flexGrow: cnt[k] } }); })));
    }

    // day panel
    var isStuckView = selDay === 'stuck';
    var dayActs = isStuckView ? {} : (byDay[selDay] || {});
    var items = isStuckView ? stuckRuns.slice() : Object.keys(dayActs).map(function (rid) { return runs[rid]; }).filter(passBase);
    if (isStuckView) Object.keys(carry).forEach(function (id) { var r = runs[id]; if (r && items.indexOf(r) < 0 && passBase(r)) items.push(r); });   // runs carried from here stay listed
    var pc = { all: items.length, stuck: 0, gate: 0, live: 0, done: 0, cancel: 0 };
    items.forEach(function (r) { var k = nowKind(r, now); if (k === 'failed' || k === 'orphan' || k === 'paused') pc.stuck++; else pc[k] = (pc[k] || 0) + 1; });
    function passFilt(r) { if (filt === 'all') return true; var k = nowKind(r, now); return filt === 'stuck' ? (k === 'failed' || k === 'orphan' || k === 'paused') : k === filt; }
    var shown = items.filter(passFilt).sort(function (a, b) {
      var ca = carry[a.id] ? (carry[a.id].state === 'ended' ? 1 : 0) : 2, cb = carry[b.id] ? (carry[b.id].state === 'ended' ? 1 : 0) : 2;
      return (ca - cb) || (KIND_ORDER.indexOf(nowKind(a, now)) - KIND_ORDER.indexOf(nowKind(b, now)))
        || String((dayActs[b.id] || {}).last || b.updated_at || '').localeCompare(String((dayActs[a.id] || {}).last || a.updated_at || ''));
    });
    var selectable = shown.filter(function (r) { var k = stuckKind(r, now), c = carry[r.id]; return k && k !== 'live' && k !== 'gate' && !(c && c.state !== 'ended'); });   // gates: one by one, after reading them
    var selList = selectable.filter(function (r) { return sel[r.id]; });
    var allOn = selectable.length > 0 && selList.length === selectable.length;
    // agent package: one researcher's whole day (every run of theirs that was active that day)
    var dayOwners = {};
    if (!isStuckView) items.forEach(function (r) { dayOwners[r.owner_id] = (dayOwners[r.owner_id] || 0) + 1; });
    function ownerName(id) { var uu = users[id] || {}; return uu.name || (uu.email ? String(uu.email).split('@')[0] : 'ismeretlen'); }
    var ownerIds = Object.keys(dayOwners).sort(function (a, b) { return ownerName(a).localeCompare(ownerName(b), 'hu'); });
    var selOwners = ownerIds.filter(function (id) { return packSel === null || !!packSel[id]; });
    var allPack = selOwners.length === ownerIds.length;
    function togglePack(id) {
      setPackSel(function (cur) {
        var n = {}; ownerIds.forEach(function (x) { if (cur === null || cur[x]) n[x] = true; });
        if (n[id]) delete n[id]; else n[id] = true;
        return n;
      });
    }
    function downloadPack() {
      if (!selOwners.length || packBusy) return;
      var groups = selOwners.map(function (id) { var uu = users[id] || {}; return { owner: uu, uni: canonUni(uu.affiliation), runs: items.filter(function (r) { return r.owner_id === id; }) }; });
      var nRuns = groups.reduce(function (a, g) { return a + g.runs.length; }, 0);
      setPackBusy(true);
      apBuildAgentPack(groups, selDay).then(function (md) {
        var who = selOwners.length === 1 ? apSlug(ownerName(selOwners[0])) : (selOwners.length + '-kutato');
        var fname = 'publify-agent-csomag_' + who + '_' + selDay + '.md';
        apDownload(fname, md);
        toast('⬇ ' + fname + ' — ' + selOwners.length + ' kutató, ' + nRuns + ' futás, ' + Math.round(md.length / 1024) + ' KB');
        if (alive.current) setPackBusy(false);
      }, function (e) { toast('A csomag összeállítása nem sikerült: ' + ((e && e.message) || e), false); if (alive.current) setPackBusy(false); });
    }
    var dayTitle = isStuckView ? 'Most elakadt futások' : (function () { var p = selDay.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString('hu-HU', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }); })();

    function chip(key, lab) {
      return h('button', { key: key, type: 'button', className: 'st-chip' + (filt === key ? ' on' : ''), 'aria-pressed': filt === key ? 'true' : 'false', onClick: function () { setFilt(key); setSel({}); } }, lab, h('span', { className: 'n' }, pc[key] || 0));
    }
    function phaseName(k) { var p = AP_PHASES.filter(function (x) { return x.key === k; })[0]; return (p && p.label) || k; }
    function row(r) {
      var k = stuckKind(r, now), meta = STUCK_META[k] || null, c = carry[r.id], u = users[r.owner_id] || {}, p = projects[r.project_id] || {};
      var ph = (r.phases || [])[r.phase_index] || {}, act = isStuckView ? null : dayActs[r.id];
      var detail = r.status === 'failed' ? (r.error || 'Ismeretlen hiba')
        : r.status === 'awaiting_approval' ? (((r.gate && r.gate.title) || 'Jóváhagyás') + (r.gate && r.gate.detail ? ' — ' + r.gate.detail : '')) : null;
      var busy = c && c.state !== 'ended', canSel = k && k !== 'live' && k !== 'gate' && !busy;
      var pill = meta ? h('span', { className: 'st-pill ' + meta.cls }, meta.lab)
        : h('span', { className: 'st-pill ' + (r.status === 'done' ? 'ok' : 'mute') }, r.status === 'done' ? '✓ Végzett' : r.status === 'cancelled' ? 'Leállítva' : r.status);
      return h('div', { key: r.id, className: 'st-row' + (busy ? ' carry' : '') },
        h('input', { type: 'checkbox', checked: !!sel[r.id], disabled: !canSel, 'aria-label': 'Kijelölés: ' + (p.title || 'futás'), onChange: function (e) { var on = e.target.checked; setSel(function (m) { var n = Object.assign({}, m); if (on) n[r.id] = 1; else delete n[r.id]; return n; }); } }),
        h('div', { className: 'st-who' }, pill,
          h('b', null, u.name || (u.email ? String(u.email).split('@')[0] : 'ismeretlen')),
          h('span', null, uniOfRun(r))),
        h('div', { className: 'st-proj' },
          h('a', { href: 'Autopilot.html?run=' + encodeURIComponent(r.id), target: '_blank', rel: 'noopener', title: 'A futás dashboardja új lapon' }, (p.title || 'Projekt') + ' ↗'),
          detail ? h('div', { className: 'st-det', title: detail }, 'Most: ' + detail) : null),
        h('div', { className: 'st-meta' },
          h('div', null, (AP_ICON[ph.key] || '') + ' ' + (ph.label || ph.key || '—')),
          h('div', null, 'utolsó jel: ' + agoHu(r.driver_beat || r.updated_at))),
        h('div', { className: 'st-act' },
          busy ? h('button', { type: 'button', className: 'btn sm', onClick: function () { pauseOne(r.id); } }, '⏸ Szüneteltetés')
            : k === 'gate' ? h('button', { type: 'button', className: 'btn pri sm', onClick: function () { setOpenRun(r.id); } }, '🔎 Megnézem és döntök')
              : (meta && meta.act) ? h('button', { type: 'button', className: 'btn pri sm', onClick: function () { resumeRuns([r]); } }, meta.act) : null,
          (k === 'gate' && !busy) ? null : h('button', { type: 'button', className: 'btn sm', onClick: function () { setOpenRun(r.id); } }, '🔎 Részletek')),
        act ? h('div', { className: 'st-day' },
          h('span', null, h('b', null, 'Aznap '), act.n ? (timeOf(act.first) + (timeOf(act.last) !== timeOf(act.first) ? '–' + timeOf(act.last) : '')) : ('indítva ' + timeOf(act.first))),
          act.n ? h('span', null, act.n + ' esemény') : null,
          act.phases.length ? h('span', { title: act.phases.map(phaseName).join(' → ') }, act.phases.map(function (x) { return (AP_ICON[x] || '•') + ' ' + phaseName(x); }).join(' → ')) : null,
          act.errs ? h('span', { className: 'err' }, '⚠ ' + act.errs + ' hiba') : null,
          act.lastMsg ? h('span', { className: 'msg', title: act.lastMsg }, '„' + String(act.lastMsg).slice(0, 160) + '”') : null) : null,
        c ? h('div', { className: 'st-live' + (c.state === 'ended' ? ' end' : ''), role: 'status', 'aria-live': 'polite' },
          c.state !== 'ended' ? h('span', { className: 'spin' }) : null,
          c.label ? h('b', null, c.label) : null,
          h('span', null, c.msg || '')) : null);
    }

    var drawerRun = openRun ? runs[openRun] : null;
    return h(React.Fragment, null,
      drawerRun ? h(RunDetail, { key: drawerRun.id, run: drawerRun, user: users[drawerRun.owner_id], project: projects[drawerRun.project_id], carry: carry[drawerRun.id],
        busy: !!(carry[drawerRun.id] && carry[drawerRun.id].state !== 'ended'), onClose: function () { setOpenRun(null); },
        onResume: function (run, note) { notesRef.current[run.id] = note || ''; resumeRuns([run], function () { setOpenRun(null); }); } }) : null,
      h('div', { className: 'st-wrap pc-wrap' },
      h('div', { className: 'st-head' },
        h('div', null,
          h('h1', null, '🛡 Folyamat-naptár'),
          h('div', { className: 'st-sub' }, 'Az Autopilot-futások napról napra: mi történt velük az adott napon, és hol tartanak most. Ami elakadt, innen folytatható — a folytatott futásokat ez a lap viszi a te fiókoddal (egyszerre ' + STUCK_MAX_PARALLEL + '), ezért amíg dolgoznak, ne zárd be.')),
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
          h('button', { type: 'button', className: 'btn sm', onClick: load }, '↻ Frissítés'),
          h('a', { className: 'btn sm', href: 'Autopilot.html' }, '‹ Autopilot'))),
      h('div', { className: 'pc-strip', role: 'region', 'aria-label': 'Most elakadt futások' },
        h('b', { className: 'pc-strip-t' }, stuckTotal() ),
        ['failed', 'orphan', 'gate', 'paused'].map(function (k) { return stuckC[k] ? h('span', { key: k, className: 'st-pill ' + STUCK_META[k].cls }, STUCK_META[k].lab + ' · ' + stuckC[k]) : null; }),
        stuckRuns.length ? h('button', { type: 'button', className: 'btn sm' + (isStuckView ? ' pri' : ''), onClick: function () { setSelDay('stuck'); setFilt('all'); setSel({}); } }, 'Mind listázása →') : null,
        active ? h('span', { className: 'st-active' }, '⟳ ' + active + ' futás halad innen') : null,
        h('div', { className: 'pc-tools' },
          h('select', { className: 'pc-sel', value: uni, 'aria-label': 'Egyetem', onChange: function (e) { setUni(e.target.value); setSel({}); } },
            h('option', { value: '' }, 'Minden egyetem'),
            uniList.map(function (x) { return h('option', { key: x, value: x }, x); })),
          h('input', { className: 'st-q', value: q, placeholder: '🔍 Kutató, projekt…', 'aria-label': 'Keresés', onChange: function (e) { setQ(e.target.value); } }))),
      h('div', { className: 'pc-top' },
        h('div', { className: 'pc-cal' },
          h('div', { className: 'pc-calh' },
            h('button', { type: 'button', className: 'pc-nav', 'aria-label': 'Előző hónap', onClick: function () { setMon(mon.y, mon.m - 1); } }, '‹'),
            h('b', null, mon.y + '. ' + HU_MONTHS[mon.m]),
            h('button', { type: 'button', className: 'pc-nav', 'aria-label': 'Következő hónap', onClick: function () { setMon(mon.y, mon.m + 1); } }, '›'),
            h('button', { type: 'button', className: 'btn sm', onClick: function () { var n = new Date(); setMon(n.getFullYear(), n.getMonth()); } }, 'Ma')),
          h('div', { className: 'pc-wd', 'aria-hidden': 'true' }, HU_WD.map(function (w) { return h('span', { key: w }, w); })),
          h('div', { className: 'pc-grid' }, cells.map(dayCell)),
          h('div', { className: 'pc-legend' },
            KIND_ORDER.map(function (k) { return h('span', { key: k }, h('i', { className: 'k-' + k }), KIND_LAB[k]); }),
            h('span', null, h('em', { className: 'pc-flag inline' }, '2'), 'ennyi futás akadt el aznap')),
          data && data.err ? h('div', { className: 'pc-err' }, 'Nem sikerült betölteni: ' + data.err) : null),
        h('div', { className: 'pc-panel' },
          h('div', { className: 'pc-ph' }, h('h2', null, dayTitle), D ? h('span', { className: 'pc-phn' }, items.length + ' futás') : null),
          (!isStuckView && ownerIds.length) ? h('div', { className: 'pc-pack' },
            h('div', { className: 'pc-pack-top' },
              h('span', { className: 'pc-pack-l' }, '🤖 Agent-csomag'),
              h('span', { className: 'pc-pack-n' }, selOwners.length + ' / ' + ownerIds.length + ' kutató kiválasztva'),
              ownerIds.length > 1 ? h('button', { type: 'button', className: 'rd-link', onClick: function () { setPackSel(allPack ? {} : null); } }, allPack ? 'Egyik sem' : 'Mind') : null,
              h('button', { type: 'button', className: 'btn pri sm', disabled: packBusy || !selOwners.length, onClick: downloadPack,
                title: 'A kiválasztott kutatók aznap aktív futásainak teljes kontextusa, protokollja és eredményei egy .md fájlban, agent-megbízással' },
                packBusy ? '⏳ Összeállítás…' : ('⬇ Letöltés (.md)' + (selOwners.length > 1 ? ' — ' + selOwners.length + ' kutató' : '')))),
            h('div', { className: 'pc-pack-users', role: 'group', 'aria-label': 'Kutatók a csomagban' },
              ownerIds.map(function (id) {
                var on = selOwners.indexOf(id) >= 0;
                return h('label', { key: id, className: 'pc-pu' + (on ? ' on' : '') },
                  h('input', { type: 'checkbox', checked: on, onChange: function () { togglePack(id); } }),
                  h('span', null, ownerName(id)),
                  h('em', null, canonUni((users[id] || {}).affiliation) + ' · ' + dayOwners[id] + ' futás'));
              })),
            h('span', { className: 'pc-pack-hint' }, 'A kiválasztott kutatók anyaga egy fájlba kerül, kutatónként külön fejezetben: kontextus, irodalom, áttekintés, kivonatolt adatok és protokoll — megbízással: végrehajtás → folyóirat-választás KPI-ok alapján → kézirat, kutatónként külön.')) : null,
          items.length ? h('div', { className: 'st-bar' }, chip('all', 'Mind'), chip('stuck', 'Elakadt'), chip('gate', 'Jóváhagyásra vár'), chip('live', 'Fut'), chip('done', 'Végzett'), pc.cancel ? chip('cancel', 'Leállítva') : null) : null,
          selectable.length ? h('div', { className: 'st-bulk' },
            h('label', { className: 'st-all' }, h('input', { type: 'checkbox', checked: allOn, onChange: function () { if (allOn) setSel({}); else { var n = {}; selectable.forEach(function (r) { n[r.id] = 1; }); setSel(n); } } }), ' Elakadtak (' + selectable.length + ')'),
            selList.length ? h('span', null, selList.length + ' kijelölve') : h('span', { className: 'st-hint' }, 'Jelöld ki, amelyeket együtt folytatnál — a jóváhagyásra várókat egyenként, a részletek megnézése után'),
            selList.length ? h('button', { type: 'button', className: 'btn pri sm', onClick: function () { resumeRuns(selList); } }, '▶ Kijelöltek folytatása (' + selList.length + ')') : null) : null,
          !D ? h('div', { className: 'st-empty' }, data && data.err ? ('Nem sikerült betölteni: ' + data.err) : h('span', null, h('span', { className: 'spin' }), ' Betöltés…'))
            : shown.length ? h('div', { className: 'st-list' }, shown.map(row))
              : h('div', { className: 'st-empty' }, isStuckView ? '✓ Nincs elakadt futás.' : (items.length ? 'Ebben a csoportban nincs futás ezen a napon.' : 'Ezen a napon nem volt Autopilot-aktivitás' + ((uni || qq) ? ' a szűrőknek megfelelően' : '') + '.'))))));

    function stuckTotal() { return stuckRuns.length ? ('Most elakadt: ' + stuckRuns.length + ' futás') : '✓ Most nincs elakadt futás'; }
  }

  function App() {
    function initRun() { try { return new URLSearchParams(location.search).get('run'); } catch (e) { return null; } }
    var vS = useState(initRun() ? 'dashboard' : 'launcher'), view = vS[0], setView = vS[1];   // ?run=<id> deep-links straight to the dashboard (resume)
    var riS = useState(initRun()), runId = riS[0], setRunId = riS[1];
    var pS = useState(null), project = pS[0], setProject = pS[1];
    var cS = useState(null), chatId = cS[0], setChatId = cS[1];
    var fS = useState([]), files = fS[0], setFiles = fS[1];
    var idlS = useState([]), ideas = idlS[0], setIdeas = idlS[1];   // the brief's idea list — the side panel shows the ideas themselves, not a count
    var frS = useState({}), freshIds = frS[0], setFreshIds = frS[1];  // just-added idea ids → flashed once so the user sees where they landed
    var ideasPid = useRef(null);
    var crS = useState(false), creating = crS[0], setCreating = crS[1];
    var lS = useState(false), launching = lS[0], setLaunching = lS[1];
    // The default extraction questions are PRE-FILLED as real, removable entries — they used to be invisible
    // defaults injected at runtime, which is why they could not be deleted.
    var cfgS = useState({ tier: TIERS[0], maxPapers: '500', phases: PHASES.map(function (ph) { return !ph[3]; }), extractQuestions: EXTRACT_DEFAULTS.map(function (q) { return { text: q.text, answer_type: q.answer_type, source_mode: q.source_mode }; }) }), cfg = cfgS[0], setCfg = cfgS[1];   // WIP phases default OFF

    // The admin role arrives AFTER first paint (backend.js fetches the profile, then fires 'pr-profile'). Re-render on it,
    // or admin-only entry points (the "🛡 Elakadt folyamatok" link) never appear for an admin.
    var atS = useState(0), setAppTick = atS[1];
    useEffect(function () {
      function onProf() { setAppTick(function (x) { return x + 1; }); }
      window.addEventListener('pr-profile', onProf);
      return function () { window.removeEventListener('pr-profile', onProf); };
    }, []);

    function refreshIdeas(pid, markIds) {
      ideasPid.current = pid;
      // the brief lists the CANDIDATE ideas: gaps (source='gap') belong to the Research Gap phase, rejected ones are gone
      return sb.from('research_ideas').select('id,question,hypothesis,rationale,source,status,created_at').eq('project_id', pid)
        .neq('status', 'rejected').or('source.is.null,source.neq.gap').order('created_at', { ascending: false }).limit(60).then(function (r) {
          if (ideasPid.current !== pid) return;   // the user switched project meanwhile
          setIdeas((r && r.data) || []);
          if (markIds && markIds.length) {
            var m = {}; markIds.forEach(function (id) { m[id] = 1; }); setFreshIds(m);
            setTimeout(function () { setFreshIds({}); }, 4500);
          }
        });
    }
    function refreshFiles(pid) { loadFiles(pid).then(setFiles); }
    // a partial create failed after the project row existed → delete it so abandonment never orphans a project
    function abortCreate(pid, msg) { if (pid) sb.from('research_projects').delete().eq('id', pid); setCreating(false); toast(msg, false); }

    function startProject(dir, staged, meta) {
      setCreating(true);
      var u = uid();
      meta = meta || {};
      // student_id is deliberately NOT stamped here — it's set at launch (doLaunch), so abandoned exploration
      // never reaches the supervisor. The project is created now only because the live AI chat needs a real row.
      // deriveTitle truncates at 70 chars, so the FULL reference lives in `goal` — that is what the chat edge reads.
      var payload = { owner_id: u, title: meta.title || deriveTitle(dir || (staged[0] && staged[0].name) || ''), field: null, keywords: null, goal: meta.goal || dir || null, stage: 0, status: 'active' };
      sb.from('research_projects').insert(payload).select().maybeSingle().then(function (r) {
        if (!r || r.error || !r.data) { setCreating(false); toast('Nem sikerült létrehozni: ' + ((r && r.error && r.error.message) || 'ismeretlen hiba'), false); return; }
        var proj = r.data;
        sb.from('research_chats').insert({ project_id: proj.id, title: 'Publify chat', owner_id: u, surface: 'autopilot' }).select('id').maybeSingle().then(function (cr) {   // surface tag → the launcher sidebar can list + reopen started briefs
          var cid = cr && cr.data && cr.data.id;
          if (!cr || cr.error || !cid) { abortCreate(proj.id, 'Nem sikerült elindítani a beszélgetést' + ((cr && cr.error) ? ': ' + cr.error.message : '.')); return; }
          uploadFiles(proj.id, staged).then(function (up) {
            var okd = up.filter(function (x) { return x.ok; });
            var okNames = {}; okd.forEach(function (x) { okNames[x.name] = 1; });
            // A paper start brings its own seed (bibliography + extracted text + what to ask); otherwise build
            // the seed from the staged files. Either way the LAST row must be role='user' or the chat stays silent.
            var seed = meta.seed || stagedContextMsg(staged.filter(function (f) { return okNames[f.name]; }),
              (dir || '(fájl-alapú indítás)') + (okd.length ? '\n\nFeltöltött fájlok: ' + okd.map(function (x) { return x.name; }).join(', ') : ''));
            if (meta.seed && dir) seed = dir + '\n\n' + seed;
            // Hard guard: the chat edge slices the first message at 4000 chars. paperSeedMessage already budgeted
            // for `dir`, but a file-based start (or a future caller) could still overflow — trim the MIDDLE, never
            // the tail, so nothing that instructs the model is lost.
            if (seed.length > 3980) seed = seed.slice(0, 3000) + '\n…(a részlet itt megszakad)\n' + seed.slice(-900);
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
        setProject(null); setChatId(null); setFiles([]); setIdeas([]); setView('launcher');
      }
      if (window.PRUI && window.PRUI.confirm) window.PRUI.confirm({ title: 'Elveted ezt a projektet?', confirmLabel: 'Elvetés', danger: true }).then(go);
      else go(window.confirm('Elveted ezt a projektet? A beszélgetés és a feltöltött fájlok törlődnek.'));
    }

    // ✦ ideas from the whole conversation (brief panel) OR from one selected passage (chat toolbar) — the same
    // research-ai 'suggest' action, which dedups against the existing ideas and returns the inserted rows.
    function suggestIdeas(selText) {
      if (!project) return Promise.resolve();
      var pid = project.id;
      function run(transcript) {
        return sb.functions.invoke('research-ai', { body: { action: 'suggest', project_id: pid, text: transcript } }).then(function (res) {
          if (res && res.error) {
            var st = res.error.context && res.error.context.status;
            toast(st === 429 ? 'Elérted a napi AI-keretet — holnap újra próbálhatod.' : st === 403 ? 'Ehhez az AI-funkcióhoz nincs jogosultságod — szólj az adminnak.' : 'Az ötlet-generálás nem sikerült' + (st ? ' (' + st + ')' : '') + '.', false);
            return;
          }
          var d = res && res.data;
          if (d && d.count) { toast('✓ ' + d.count + ' új ötlet — oldalt, az Ötletek alatt'); refreshIdeas(pid, (d.ideas || []).map(function (x) { return x.id; })); }
          else toast(selText ? 'Ebből a részletből nem született új ötlet (lehet, hogy már szerepel a listán).' : 'Ebből a beszélgetésből nem született új ötlet.');
        }, function () { toast('Az AI-hívás nem sikerült.', false); });
      }
      // a selection travels on its own: the model grounds its ideas in "what was discussed", so here the quoted
      // passage IS the discussion (the project goal still goes along inside research-ai)
      if (selText) return run('User (a beszélgetésből kijelölt részlet — ebből fogalmazz meg kutatási ötletet):\n' + String(selText).slice(0, 8000));
      return sb.from('research_messages').select('role,content').eq('chat_id', chatId).order('created_at', { ascending: true }).then(function (r) {
        var m = (r && r.data) || [];
        if (!m.length) { toast('Beszélgess előbb a projektről — abból javaslok ötleteket.'); return; }
        return run(m.slice(-16).map(function (x) { return (x.role === 'assistant' ? 'AI: ' : 'User: ') + String(x.content || ''); }).join('\n\n').slice(0, 12000));
      });
    }
    // ✚ the selected passage verbatim (same row shape as the Research chat's "To idea")
    function addIdeaText(text) {
      if (!project) return Promise.resolve();
      var pid = project.id, q = String(text || '').trim().slice(0, 8000);
      if (!q) return Promise.resolve();
      return sb.from('research_ideas').insert({ project_id: pid, source: 'own', question: q, created_by: uid(), status: 'candidate' }).select('id').maybeSingle().then(function (r) {
        if (r && r.error) { toast('Nem sikerült menteni: ' + r.error.message, false); return; }
        toast('✓ Ötlet mentve — oldalt, az Ötletek alatt'); refreshIdeas(pid, (r && r.data) ? [r.data.id] : []);
      }, function () { toast('Nem sikerült menteni.', false); });
    }
    function removeIdea(it) {
      if (!project || !it) return;
      var pid = project.id, q = String(it.question || '').slice(0, 70);
      function go(ok) {
        if (!ok) return;
        setIdeas(function (a) { return a.filter(function (x) { return x.id !== it.id; }); });   // optimistic; the refresh reconciles
        sb.from('research_ideas').delete().eq('id', it.id).eq('project_id', pid).then(function (r) {
          if (r && r.error) toast('Nem sikerült eltávolítani: ' + r.error.message, false);
          refreshIdeas(pid);
        }, function () { refreshIdeas(pid); });
      }
      var title = 'Eltávolítod ezt az ötletet? „' + q + (String(it.question || '').length > 70 ? '…' : '') + '"';
      if (window.PRUI && window.PRUI.confirm) window.PRUI.confirm({ title: title, confirmLabel: 'Eltávolítás', danger: true }).then(go);
      else go(window.confirm(title));
    }

    function doLaunch() {
      if (!project) return;
      var firstIdx = -1; for (var i = 0; i < cfg.phases.length; i++) { if (cfg.phases[i]) { firstIdx = i; break; } }
      if (firstIdx === -1) { toast('Válassz legalább egy fázist.', false); return; }
      setLaunching(true);
      var u = uid();
      var phases = AP_PHASES.map(function (p, i) {
        if (AP_WIP[p.key]) return { key: p.key, label: p.label, enabled: false, status: 'wip', result: 'fejlesztés alatt', cursor: {} };   // under development → never auto-runs; Autopilot ends at protocol
        return { key: p.key, label: p.label, enabled: !!cfg.phases[i], status: cfg.phases[i] ? 'pending' : 'skipped', result: '', cursor: {} };
      });
      var md = '# Autopilot brief\n\n**Cél:** ' + (project.goal || '—') + '\n\n**Kulcsszavak:** ' + ((project.keywords || []).join(', ') || '—')
        + '\n\n**Adat:** ' + (files.length ? files.map(function (f) { return f.name; }).join(', ') : '—')
        + '\n\n**Cél-venue:** ' + cfg.tier + '\n\n**Max. átvizsgált cikk:** ' + (cfg.maxPapers || '—')
        + '\n\n**Bekapcsolt fázisok:** ' + AP_PHASES.filter(function (_, i) { return cfg.phases[i]; }).map(function (ph) { return ph.label; }).join(', ')
        + '\n\n**Emberi jóváhagyás:** bekapcsolva (included források · protokoll-lépések · végső beküldés).\n\n---\n*A Publify Autopilot elindítva.*\n';
      function fail(msg) { setLaunching(false); toast(msg, false); }
      function createRun() {
        sb.from('research_autopilot_runs').insert({ project_id: project.id, owner_id: u, status: 'running', started_at: nowIso(), phase_index: firstIdx, phases: phases, config: { tier: cfg.tier, max_papers: parseInt(cfg.maxPapers, 10) || null, gates: true, extract_questions: (cfg.extractQuestions || []), extract_q_set: true } }).select('id').maybeSingle().then(function (rr) {
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
      setRunId(null); setProject(null); setChatId(null); setFiles([]); setIdeas([]); setView('launcher');
    }
    function openRun(rid) { try { history.replaceState(null, '', 'Autopilot.html?run=' + encodeURIComponent(rid)); } catch (e) { } setRunId(rid); setView('dashboard'); }
    // reopen a started-but-not-launched brief from the sidebar: load the project + its brief chat back into the brief step
    function openBrief(pid, cid) {
      if (!pid) return;
      setChatId(cid || null); setFiles([]); setIdeas([]);
      sb.from('research_projects').select('id,title,goal,keywords,student_id,field,status,stage').eq('id', pid).maybeSingle().then(function (r) {
        var p = r && r.data; if (!p) { toast('A projekt nem elérhető.', false); return; }
        setProject(p); setView('brief'); refreshFiles(pid); refreshIdeas(pid);
        if (!cid) sb.from('research_chats').select('id').eq('project_id', pid).eq('surface', 'autopilot').order('created_at', { ascending: false }).limit(1).maybeSingle().then(function (cr) { if (cr && cr.data) setChatId(cr.data.id); });
      });
    }
    // back to the launcher list WITHOUT discarding the current brief (distinct from Discard, which deletes)
    function backToList() { try { history.replaceState(null, '', 'Autopilot.html'); } catch (e) { } setRunId(null); setProject(null); setChatId(null); setFiles([]); setIdeas([]); setView('launcher'); }
    // the dashboard is a full-screen surface (own header + controls) — resumable via ?run=<id>
    // ?view=stuck → the admin's central list of stuck runs (all users), resumable from one place
    if (/[?&]view=stuck\b/.test(location.search)) return h('div', { className: 'ap-wrap' }, h(StuckCenter, null));
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
      h('div', { className: 'ap-launch-main' },
        apIsAdmin() ? h('a', { className: 'ap-admin-link', href: 'Autopilot.html?view=stuck' }, '🛡 Elakadt folyamatok', h('span', null, 'admin · minden kutató futásai')) : null,
        h(Launcher, { creating: creating, onStart: startProject })));
    else if (view === 'brief') body = h('div', { className: 'ap-split' },
      h(Chat, { projectId: project.id, chatId: chatId, projectTitle: project.title, onReply: function () { }, onFilesChanged: function () { refreshFiles(project.id); }, onDiscard: discardProject,
        onIdeaFromSel: function (t, mode) { return mode === 'ai' ? suggestIdeas(t) : addIdeaText(t); } }),
      h(BriefPanel, {
        project: project, files: files, ideas: ideas, freshIds: freshIds, onRemoveIdea: removeIdea,
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

  // A render error anywhere below must NOT blank the whole page (leaving only the purple body). This boundary catches it,
  // shows a recoverable panel, and auto-retries a few times (transient poll-state crashes self-heal on the next tick).
  function EB(props) { React.Component.call(this, props); this.state = { err: null }; this._resets = 0; }
  EB.prototype = Object.create(React.Component.prototype);
  EB.prototype.constructor = EB;
  EB.prototype.componentDidCatch = function (err, info) {
    try { console.error('[Autopilot] render crash — recovered by boundary:', err, info && info.componentStack); } catch (e) { }
    var self = this;
    if (this._resets < 5) { this._resets++; setTimeout(function () { try { self.setState({ err: null }); } catch (e) { } }, 900); }
  };
  EB.prototype.render = function () {
    if (this.state.err) return h('div', { className: 'ap-wrap' }, h('div', { className: 'center' }, h('div', { className: 'box' },
      h('div', { className: 'mk' }, h('i')),
      h('h1', null, 'Egy pillanat — újratöltés'),
      h('p', null, 'Átmeneti megjelenítési hiba történt; a nézet magától helyreáll. Ha nem, töltsd újra az oldalt.'),
      h('button', { className: 'btn', onClick: function () { try { location.reload(); } catch (e) { } } }, '↻ Oldal újratöltése'))));
    return this.props.children;
  };
  EB.getDerivedStateFromError = function (err) { return { err: err || true }; };

  // ---- boot ----
  if (!BE || !BE.sb) { root.innerHTML = '<div class="center"><div class="box"><h1>A backend nem elérhető</h1></div></div>'; return; }
  if (BE.mode !== 'cloud' || !BE.user) { root.innerHTML = '<div class="center"><div class="box"><div class="mk"><i></i></div><h1>Jelentkezz be</h1><p>Az Autopilot bejelentkezést igényel.</p><a class="btn" href="Landing.html">Bejelentkezés</a></div></div>'; return; }
  ReactDOM.createRoot(root).render(h(EB, null, h(App)));
})();
