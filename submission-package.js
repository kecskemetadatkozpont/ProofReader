/* Publify — beküldési csomagok (submission package): séma, beolvasás, összehasonlítás.
 *
 * Miért van külön modul: egy folyóirat-beküldés nem egy fájl, hanem egy MEGHATÁROZOTT
 * fájlkészlet (kézirat, jelölt kézirat, kísérőlevél, bírálói válaszok, forrás, melléklet).
 * Ugyanahhoz a publikációhoz több verzió készül egymás után, és a kérdés mindig ugyanaz:
 * mi változott a két csomag között — nem bájtszinten, hanem TARTALOMBAN.
 *
 * A modul három dolgot ad:
 *   ROLES        — mi tartozik egy csomagba (ez a „mit kérünk a felhasználótól” séma)
 *   readArchive  — a ZIP beolvasása manifestté: szerep, méret, ujjlenyomat, és a diffhez
 *                  szükséges SZÖVEG (LaTeX-forrás, illetve a PDF-ekből kinyert szöveg)
 *   compare      — két manifest összehasonlítása: hiányzó szerepek, új/törölt/átnevezett
 *                  fájlok, és a kéziratok tartalmi különbsége (bekezdés + szó + szám szinten)
 *
 * Szándékosan függőség-injektált (JSZip, sha256, pdfText), hogy böngészőben és Node-ból
 * futtatott teszteknél is ugyanez a kód fusson.
 */
(function (root, factory) {
  var mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  if (root) root.PRPackage = mod;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  /* ---------------------------------------------------------------- 1. SÉMA */
  // req: 'always' = minden beküldéshez kell | 'revision' = revízióhoz kell | 'optional'
  var ROLES = [
    { id: 'manuscript', label: 'Kézirat (PDF)', portal: 'Manuscript File', req: 'always',
      hint: 'A beküldendő kézirat véglegesen fordított PDF-je.',
      re: [/(^|\/)(\d+[a-z]?[_-])?(manuscript|paper|article|kezirat|kézirat)(_(final|clean|revised))?\.pdf$/i] },
    // A sorrend számít: a felismerés az ELSŐ illeszkedő szerepet adja vissza, ezért a
    // szűkebb minta (…_vs_original) előbb áll, mint a tágabb (…marked).
    { id: 'manuscript_marked_original', label: 'Jelölt kézirat (az eredetihez képest)', portal: 'opcionális', req: 'optional',
      hint: 'Kumulatív jelölés az eredetileg beküldött kézirathoz képest.',
      re: [/(vs[_-]?original|against[_-]?original|cumulative|kumulativ)/i] },
    { id: 'manuscript_marked', label: 'Jelölt kézirat (az előző körhöz képest)', portal: 'Manuscript File (marked-up)', req: 'revision',
      hint: 'Amit EBBEN a körben változtattál, színezve — a bíráló ezen látja a változást.',
      re: [/(marked|tracked|changes|jelolt|jelölt)/i] },
    { id: 'cover_letter', label: 'Kísérőlevél', portal: 'Cover Letter', req: 'always',
      hint: 'A szerkesztőnek szóló levél ebben a körben.',
      re: [/cover[_-]?letter|kiserolevel|kísérőlevél/i] },
    { id: 'previous_responses', label: 'Korábbi körök válaszai', portal: 'Response to Reviewer', req: 'optional',
      hint: 'Az előző kör válaszdokumentumai, ha a portál a teljes választörténetet kéri.',
      re: [/previous[_-]?(round|response)|round[_-]?1[_-]|korabbi|korábbi/i] },
    { id: 'response', label: 'Válasz a bírálóknak', portal: 'Response to Reviewer', req: 'revision',
      hint: 'Bírálónként egy válaszdokumentum a folyóirat űrlapján.',
      re: [/response|reply|rebuttal|valasz|válasz/i] },
    { id: 'source', label: 'Kézirat forrása', portal: 'LaTeX Source Files', req: 'always',
      hint: '.tex/.bbl/.bib + ábrák + osztályfájl (vagy a .docx forrás).',
      re: [/(manuscript[_-]?)?source|latex|tex[_-]?src|forras|forrás/i] },
    { id: 'supplementary', label: 'Kiegészítő anyag', portal: 'Supplementary File', req: 'optional',
      hint: 'S1…Sn, reprodukciós scriptek — amit a kézirat hivatkozik.',
      re: [/supplement|kiegeszito|kiegészítő|appendix|\bSI\b/i] },
    { id: 'graphical_abstract', label: 'Grafikus absztrakt', portal: 'Graphical Abstract', req: 'optional',
      re: [/graphical[_-]?abstract|grafikus/i] },
    { id: 'highlights', label: 'Kiemelések', portal: 'Highlights', req: 'optional', re: [/highlights/i] },
    { id: 'statement', label: 'Nyilatkozatok', portal: 'Statement', req: 'optional',
      hint: 'Etikai, érdekütközési, szerzői hozzájárulási nyilatkozat.',
      re: [/ethic|conflict|coi\b|authorship|funding|declaration|nyilatkozat/i] },
    { id: 'data', label: 'Adat / reprodukció', portal: 'Data', req: 'optional',
      re: [/(^|\/)(data|dataset|reproduc|adat)/i] },
    { id: 'contents', label: 'Csomagleírás', portal: '—', req: 'optional',
      hint: 'Mi van a csomagban és miért — a Publify generálni is tudja.',
      re: [/(^|\/)(contents|manifest|readme|olvass)/i] },
  ];
  var ROLE_BY_ID = {}; ROLES.forEach(function (r) { ROLE_BY_ID[r.id] = r; });

  function detectRole(path) {
    var p = String(path || '');
    for (var i = 0; i < ROLES.length; i++) {
      var r = ROLES[i];
      for (var j = 0; j < r.re.length; j++) if (r.re[j].test(p)) return r.id;
    }
    return 'other';
  }

  /* --------------------------------------------------------- 2. BEOLVASÁS */
  var deps = { JSZip: null, sha256: null, pdfText: null };
  function configure(d) { Object.keys(d || {}).forEach(function (k) { deps[k] = d[k]; }); }

  var TEXT_RE = /\.(tex|bib|bbl|cls|sty|md|markdown|txt|csv|tsv|json|ya?ml|log)$/i;
  var TEXT_CAP = 512 * 1024;        // ennél nagyobb szövegfájlt nem tárolunk a manifestben
  var PDF_TEXT_CAP = 400 * 1024;    // PDF-ből kinyert szöveg felső határa
  var JUNK_RE = /(^|\/)(\._[^/]*|\.DS_Store|Thumbs\.db|desktop\.ini)$|(^|\/)__MACOSX(\/|$)/i;
  // Ezeknél a szerepeknél a PDF SZÖVEGE kell, mert ezeket hasonlítjuk össze tartalmilag.
  var PDF_TEXT_ROLES = { manuscript: 1, manuscript_marked: 1, manuscript_marked_original: 1, cover_letter: 1, response: 1 };

  function kindOf(path) {
    var p = String(path || '').toLowerCase();
    if (/\.pdf$/.test(p)) return 'pdf';
    if (/\.tex$/.test(p)) return 'tex';
    if (/\.(bib|bbl)$/.test(p)) return 'bib';
    if (/\.zip$/.test(p)) return 'zip';
    if (/\.(docx?|odt|rtf)$/.test(p)) return 'doc';
    if (/\.(png|jpe?g|gif|svg|webp|eps|tiff?)$/.test(p)) return 'image';
    if (/\.(csv|tsv|json|ya?ml|xlsx?)$/.test(p)) return 'data';
    if (TEXT_RE.test(p)) return 'text';
    return 'other';
  }

  // A csomagok gyökérmappája verziónként más lehet (P2_submission/ vs P2_submission_v2/),
  // ezért a közös előtagot levágjuk — különben minden fájl „új”-nak látszana.
  function commonPrefix(paths) {
    if (!paths.length) return '';
    var first = paths[0].split('/');
    if (first.length < 2) return '';
    var pre = first[0] + '/';
    for (var i = 1; i < paths.length; i++) if (paths[i].indexOf(pre) !== 0) return '';
    return pre;
  }

  function decodeText(bytes) {
    try { return new TextDecoder('utf-8', { fatal: false }).decode(bytes); }
    catch (e) { var s = ''; for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return s; }
  }

  /* Egy ZIP → manifest. A beágyazott ZIP-eket EGY szinttel kibontjuk, mert a tartalmi
     különbség jellemzően ott van (a LaTeX-forrás a source.zip-ben ül). */
  async function readArchive(input, opts) {
    opts = opts || {};
    var onProgress = opts.onProgress || function () { };
    if (!deps.JSZip) throw new Error('JSZip nincs beállítva (PRPackage.configure)');
    var zip = await deps.JSZip.loadAsync(input);
    var names = Object.keys(zip.files).filter(function (n) { return !zip.files[n].dir && !JUNK_RE.test(n); });
    var pre = commonPrefix(names);
    var entries = [];
    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      var path = pre && name.indexOf(pre) === 0 ? name.slice(pre.length) : name;
      onProgress(i + 1, names.length, path);
      var bytes = await zip.files[name].async('uint8array');
      var role = detectRole(path), kind = kindOf(path);
      var e = { path: path, size: bytes.length, sha: await deps.sha256(bytes), role: role, kind: kind };
      if ((kind === 'tex' || kind === 'bib' || kind === 'text' || kind === 'data') && bytes.length <= TEXT_CAP) e.text = decodeText(bytes);
      if (kind === 'pdf' && PDF_TEXT_ROLES[role] && deps.pdfText) {
        try { e.text = String(await deps.pdfText(bytes) || '').slice(0, PDF_TEXT_CAP); } catch (er) { e.textErr = String(er && er.message || er); }
      }
      if (kind === 'zip' && !opts.noNested) {
        // Szöveget CSAK a forrás-zipből viszünk tovább: ott van a tartalmi diff (a .tex),
        // míg egy 238 fájlos melléklet-zip szövegei csak hizlalnák a manifestet.
        try { e.nested = await readNested(bytes, role === 'source'); } catch (er) { e.nestedErr = String(er && er.message || er); }
      }
      entries.push(e);
      bytes = null;
    }
    entries.sort(function (a, b) { return a.path < b.path ? -1 : a.path > b.path ? 1 : 0; });
    return trimManifest({
      root: pre.replace(/\/$/, ''),
      files: entries,
      bytes: entries.reduce(function (s, e) { return s + e.size; }, 0),
      roles: rolesPresent(entries),
    });
  }

  async function readNested(bytes, keepText) {
    var zip = await deps.JSZip.loadAsync(bytes);
    var names = Object.keys(zip.files).filter(function (n) { return !zip.files[n].dir && !JUNK_RE.test(n); });
    var out = [];
    for (var i = 0; i < names.length; i++) {
      var f = zip.files[names[i]];
      var b = await f.async('uint8array');
      var kind = kindOf(names[i]);
      var e = { path: names[i], size: b.length, sha: await deps.sha256(b), kind: kind };
      if (keepText && (kind === 'tex' || kind === 'bib' || kind === 'text') && b.length <= TEXT_CAP) e.text = decodeText(b);
      out.push(e);
    }
    out.sort(function (a, b) { return a.path < b.path ? -1 : a.path > b.path ? 1 : 0; });
    return out;
  }

  /* A manifest az adatbázisba megy, ezért van felső mérethatára. Ha túllépjük, a
     szövegeket fontossági sorrendben dobjuk el: előbb a beágyazottakét, aztán a
     nem-kézirat szerepekét. A kézirat szövegét őrizzük a legtovább — az kell a diffhez. */
  var MANIFEST_CAP = 3 * 1024 * 1024;
  function trimManifest(m) {
    var size = function () { try { return JSON.stringify(m).length; } catch (e) { return 0; } };
    if (size() <= MANIFEST_CAP) return m;
    (m.files || []).forEach(function (e) { if (e.nested) e.nested.forEach(function (n) { if (n.kind !== 'tex') delete n.text; }); });
    if (size() <= MANIFEST_CAP) return m;
    (m.files || []).forEach(function (e) { if (e.nested) e.nested.forEach(function (n) { delete n.text; }); });
    if (size() <= MANIFEST_CAP) return m;
    var keep = { manuscript: 1, manuscript_marked: 1 };
    (m.files || []).forEach(function (e) { if (!keep[e.role]) delete e.text; });
    if (size() <= MANIFEST_CAP) return m;
    (m.files || []).forEach(function (e) { if (e.text && e.text.length > 200 * 1024) e.text = e.text.slice(0, 200 * 1024); });
    m.trimmed = true;
    return m;
  }

  function rolesPresent(entries) {
    var m = {};
    entries.forEach(function (e) { if (e.role && e.role !== 'other') (m[e.role] = m[e.role] || []).push(e.path); });
    return m;
  }

  /* A séma szerinti hiánylista. `revision`: revíziós körnél a jelölt kézirat és a
     bírálói válasz is kötelező, első beküldésnél nem. */
  function checklist(manifest, isRevision) {
    var have = manifest && manifest.roles || {};
    return ROLES.map(function (r) {
      var req = r.req === 'always' || (r.req === 'revision' && isRevision);
      return { id: r.id, label: r.label, portal: r.portal, hint: r.hint || '', required: req,
        present: !!(have[r.id] && have[r.id].length), files: have[r.id] || [] };
    });
  }

  /* ----------------------------------------------------- 3. ÖSSZEHASONLÍTÁS */
  // LCS token-sorozatokon (bekezdés-ujjlenyomat vagy szó). A mátrixot csak akkor
  // építjük fel, ha a méret biztonságos — a szó-szintű diff mindig egy bekezdéspáron fut.
  function lcsOps(a, b, cap) {
    cap = cap || 4000;
    if (a.length > cap || b.length > cap) return null;          // túl nagy — a hívó egyszerűbb mérésre vált
    var n = a.length, m = b.length;
    var dp = []; for (var i = 0; i <= n; i++) dp.push(new Uint32Array(m + 1));
    for (var i2 = n - 1; i2 >= 0; i2--)
      for (var j2 = m - 1; j2 >= 0; j2--)
        dp[i2][j2] = a[i2] === b[j2] ? dp[i2 + 1][j2 + 1] + 1 : Math.max(dp[i2 + 1][j2], dp[i2][j2 + 1]);
    var ops = [], i3 = 0, j3 = 0;
    while (i3 < n && j3 < m) {
      if (a[i3] === b[j3]) { ops.push({ t: 'eq', a: i3, b: j3 }); i3++; j3++; }
      else if (dp[i3 + 1][j3] >= dp[i3][j3 + 1]) { ops.push({ t: 'del', a: i3 }); i3++; }
      else { ops.push({ t: 'add', b: j3 }); j3++; }
    }
    while (i3 < n) { ops.push({ t: 'del', a: i3 }); i3++; }
    while (j3 < m) { ops.push({ t: 'add', b: j3 }); j3++; }
    return ops;
  }

  function normSpace(s) { return String(s || '').replace(/­/g, '').replace(/\s+/g, ' ').trim(); }
  function words(s) { return normSpace(s).split(' ').filter(Boolean); }

  /* A PDF-ből kinyert szöveget SOROKRA bontjuk, és a sor a diff egysége. Ez azért kell, mert
     a bekezdéshatár se a pdftotext, se a pdf.js kimenetében nem megbízható, a sor viszont igen.
     A futó élőfej/élőláb (pl. „Sensors 2026, 19, x FOR PEER REVIEW 7”) minden oldalon szerepel,
     csak az oldalszám más — ezek szűrése nélkül egy puszta újrafordítás is 25 „változásnak”
     látszik. Ezért a számjegyekre maszkolt alakjukban ismétlődő rövid sorokat eldobjuk. */
  function lineModel(text) {
    var raw = String(text || '').replace(/\r/g, '').split('\n');
    var norm = [], masked = [], cnt = {};
    for (var i = 0; i < raw.length; i++) {
      var n = normSpace(raw[i]);
      if (!n) continue;
      var mk = n.replace(/\d+/g, '#');
      norm.push(n); masked.push(mk);
      if (n.split(' ').length <= 12) cnt[mk] = (cnt[mk] || 0) + 1;
    }
    var out = [];
    for (var j = 0; j < norm.length; j++) {
      if (cnt[masked[j]] >= 3) continue;          // futó élőfej/élőláb, oldalszám
      if (/^\d{1,4}$/.test(norm[j])) continue;    // magában álló oldalszám
      out.push(norm[j]);
    }
    return out;
  }
  var HEAD_RE = /^(\d+(?:\.\d+)*)\.?\s+([A-ZÁÉÍÓÖŐÚÜŰ][^.]{2,70})$/;
  function headingBefore(arr, idx) {
    for (var i = Math.min(idx, arr.length - 1); i >= 0; i--) { var m = HEAD_RE.exec(arr[i]); if (m) return m[1] + ' ' + m[2].trim(); }
    return null;
  }
  function numbersIn(s) {
    var out = [], re = /-?\d+(?:[.,]\d+)?(?:[eE][-+]?\d+)?%?/g, m;
    while ((m = re.exec(s))) out.push(m[0]);
    return out;
  }

  /* Két szöveg tartalmi különbsége: azonos-e, mennyi változott, és MELY fejezetekben. */
  function diffText(aText, bText, opts) {
    opts = opts || {};
    var A = lineModel(aText), B = lineModel(bText);
    var aw = A.join(' ').split(' ').filter(Boolean).length;
    var bw = B.join(' ').split(' ').filter(Boolean).length;
    if (A.join('\n') === B.join('\n')) {
      return { same: true, wordsA: aw, wordsB: bw, changedPct: 0, blocks: [], numbers: [] };
    }
    var ops = lcsOps(A, B, 12000);
    if (!ops) return { same: false, wordsA: aw, wordsB: bw, changedPct: null, blocks: [], tooBig: true, numbers: [] };
    var blocks = [], changedWords = 0, i = 0, lastA = 0, lastB = 0;
    while (i < ops.length) {
      if (ops[i].t === 'eq') { lastA = ops[i].a; lastB = ops[i].b; i++; continue; }
      var dels = [], adds = [];
      while (i < ops.length && ops[i].t === 'del') { dels.push(A[ops[i].a]); lastA = ops[i].a; i++; }
      while (i < ops.length && ops[i].t === 'add') { adds.push(B[ops[i].b]); lastB = ops[i].b; i++; }
      var oldT = dels.join(' '), newT = adds.join(' ');
      var wOld = words(oldT).length, wNew = words(newT).length;
      changedWords += Math.max(wOld, wNew);   // a refineBlock után pontosítjuk
      var blk = {
        kind: !dels.length ? 'add' : !adds.length ? 'del' : 'replace',
        heading: headingBefore(A, lastA) || headingBefore(B, lastB),
        wordsOld: wOld, wordsNew: wNew,
        old: oldT.slice(0, opts.excerpt || 600), new: newT.slice(0, opts.excerpt || 600),
        numbersChanged: diffNumbers(numbersIn(oldT), numbersIn(newT)),
      };
      if (blk.kind === 'replace') refineBlock(blk, oldT, newT);
      blocks.push(blk);
    }
    var base = Math.max(aw, 1);
    var refined = blocks.reduce(function (s, b) { return s + (b.wordsChanged != null ? b.wordsChanged : Math.max(b.wordsOld, b.wordsNew)); }, 0);
    return {
      same: false, wordsA: aw, wordsB: bw,
      changedWords: refined,
      changedPct: Math.round(refined / base * 1000) / 10,
      blocks: blocks,
      numbers: blocks.reduce(function (acc, b) { return acc.concat(b.numbersChanged.map(function (n) { return Object.assign({ heading: b.heading }, n); })); }, []),
    };
  }

  /* Egy „lecserélt” blokkon belül HOL a változás. A LaTeX-forrásban egy bekezdés gyakran
     EGY hosszú sor, így a sor-szintű diff egy szónyi javítást is teljes bekezdés-cserének
     mutat. Ezért a blokkon belül szó-szintű diffet futtatunk, és a megváltozott futamokat
     szövegkörnyezettel adjuk vissza — ez az, amit a felhasználó valójában látni akar. */
  function refineBlock(blk, oldT, newT, max) {
    var a = words(oldT), b = words(newT);
    var ops = lcsOps(a, b, 4000);
    if (!ops) return;
    var runs = [], i = 0;
    while (i < ops.length) {
      if (ops[i].t === 'eq') { i++; continue; }
      var d = [], ad = [], at = ops[i].a != null ? ops[i].a : null, bt = ops[i].b != null ? ops[i].b : null;
      while (i < ops.length && ops[i].t === 'del') { d.push(a[ops[i].a]); if (at == null) at = ops[i].a; i++; }
      while (i < ops.length && ops[i].t === 'add') { ad.push(b[ops[i].b]); if (bt == null) bt = ops[i].b; i++; }
      var ctxFrom = at != null ? Math.max(0, at - 7) : 0;
      runs.push({
        context: at != null ? a.slice(ctxFrom, at).join(' ') : '',
        removed: d.join(' '), added: ad.join(' '),
        numbers: diffNumbers(numbersIn(d.join(' ')), numbersIn(ad.join(' '))),
      });
    }
    blk.wordsChanged = runs.reduce(function (s, r) { return s + Math.max(words(r.removed).length, words(r.added).length); }, 0);
    blk.changes = runs.slice(0, max || 8);
    blk.moreChanges = Math.max(0, runs.length - (max || 8));
    // a pontos, futam-szintű számváltozás felülírja a durva blokk-szintűt
    blk.numbersChanged = runs.reduce(function (acc, r) { return acc.concat(r.numbers); }, []);
  }

  // Mely SZÁMOK tűntek el / jelentek meg. Ez a legfontosabb jelzés: a szöveg átírható,
  // de ha egy mért érték változik, azt látni kell.
  function diffNumbers(a, b) {
    var cnt = {}, out = [];
    a.forEach(function (x) { cnt[x] = (cnt[x] || 0) + 1; });
    b.forEach(function (x) { cnt[x] = (cnt[x] || 0) - 1; });
    Object.keys(cnt).forEach(function (k) { if (cnt[k] > 0) out.push({ value: k, side: 'removed' }); else if (cnt[k] < 0) out.push({ value: k, side: 'added' }); });
    return out;
  }

  /* Két manifest összehasonlítása. Az összepárosítás először ÚTVONAL, aztán SZEREP
     alapján megy — így a „04_response_reviewer_1_round2.docx” → „…_round3.docx”
     átnevezés nem két különálló fájlnak, hanem egy módosításnak látszik. */
  function compare(mA, mB, opts) {
    opts = opts || {};
    var A = (mA && mA.files) || [], B = (mB && mB.files) || [];
    var byPathA = {}, byPathB = {};
    A.forEach(function (e) { byPathA[e.path] = e; });
    B.forEach(function (e) { byPathB[e.path] = e; });
    var pairs = [], usedA = {}, usedB = {};
    A.forEach(function (e) { if (byPathB[e.path]) { pairs.push({ a: e, b: byPathB[e.path], how: 'path' }); usedA[e.path] = 1; usedB[e.path] = 1; } });
    // szerep szerinti párosítás a maradékra (csak ha mindkét oldalon EGY ilyen szerep maradt)
    var leftA = A.filter(function (e) { return !usedA[e.path]; });
    var leftB = B.filter(function (e) { return !usedB[e.path]; });
    ROLES.forEach(function (r) {
      var ra = leftA.filter(function (e) { return e.role === r.id && !usedA[e.path]; });
      var rb = leftB.filter(function (e) { return e.role === r.id && !usedB[e.path]; });
      if (ra.length === 1 && rb.length === 1) { pairs.push({ a: ra[0], b: rb[0], how: 'role' }); usedA[ra[0].path] = 1; usedB[rb[0].path] = 1; }
    });
    var removed = A.filter(function (e) { return !usedA[e.path]; });
    var added = B.filter(function (e) { return !usedB[e.path]; });

    var changed = [], same = [], renamed = [];
    pairs.forEach(function (p) {
      var rec = {
        path: p.b.path, oldPath: p.a.path, role: p.b.role, kind: p.b.kind,
        sizeA: p.a.size, sizeB: p.b.size, shaSame: p.a.sha === p.b.sha, how: p.how,
      };
      if (p.how === 'role' && p.a.path !== p.b.path) renamed.push(rec);
      if (rec.shaSame) { same.push(rec); return; }
      // bájtban más — de ugyanaz-e a TARTALOM?
      if (p.a.text != null && p.b.text != null) {
        rec.text = diffText(p.a.text, p.b.text, opts);
        rec.contentSame = rec.text.same;
      } else if (p.a.nested && p.b.nested) {
        rec.nested = compareNested(p.a.nested, p.b.nested, opts);
        rec.contentSame = !rec.nested.added.length && !rec.nested.removed.length && !rec.nested.changed.length;
      } else {
        rec.contentSame = null;   // nem tudjuk megmondani (nincs kinyert szöveg)
      }
      changed.push(rec);
    });

    var cl = checklist(mB, !!opts.isRevision);
    return {
      roles: cl,
      missing: cl.filter(function (r) { return r.required && !r.present; }),
      added: added.map(lite), removed: removed.map(lite), renamed: renamed, changed: changed, same: same,
      bytesA: mA && mA.bytes || 0, bytesB: mB && mB.bytes || 0,
      summary: summarize(added, removed, changed, same),
    };
  }
  function lite(e) { return { path: e.path, role: e.role, kind: e.kind, size: e.size }; }

  function compareNested(a, b, opts) {
    var byA = {}, byB = {};
    a.forEach(function (e) { byA[e.path] = e; }); b.forEach(function (e) { byB[e.path] = e; });
    var added = [], removed = [], changed = [], same = [];
    b.forEach(function (e) { if (!byA[e.path]) added.push(lite(e)); });
    a.forEach(function (e) { if (!byB[e.path]) removed.push(lite(e)); });
    a.forEach(function (e) {
      var o = byB[e.path]; if (!o) return;
      if (o.sha === e.sha) { same.push(lite(e)); return; }
      var rec = { path: e.path, kind: e.kind, sizeA: e.size, sizeB: o.size };
      if (e.text != null && o.text != null) { rec.text = diffText(e.text, o.text, opts); rec.contentSame = rec.text.same; }
      changed.push(rec);
    });
    return { added: added, removed: removed, changed: changed, same: same };
  }

  function summarize(added, removed, changed, same) {
    var recompiledOnly = changed.filter(function (c) { return c.contentSame === true; }).length;
    var realChanged = changed.filter(function (c) { return c.contentSame !== true; }).length;
    return {
      added: added.length, removed: removed.length, changed: changed.length,
      same: same.length, recompiledOnly: recompiledOnly, contentChanged: realChanged,
    };
  }

  /* A csomag „tartalomjegyzéke” Markdownban — ugyanabban a formában, ahogy a
     kézzel írt CONTENTS.md-k készültek, hogy a portálra feltöltéskor legyen mihez nyúlni. */
  function contentsMarkdown(manifest, opts) {
    opts = opts || {};
    var lines = ['# Beküldési csomag — ' + (opts.title || '') , ''];
    if (opts.note) lines.push(opts.note, '');
    lines.push('| # | Fájl | Portál-típus | Szerep |', '|---|---|---|---|');
    (manifest.files || []).forEach(function (e, i) {
      var r = ROLE_BY_ID[e.role];
      lines.push('| ' + (i + 1) + ' | `' + e.path + '` | ' + (r ? r.portal : '—') + ' | ' + (r ? r.label : 'egyéb') + ' |');
    });
    return lines.join('\n') + '\n';
  }

  return {
    ROLES: ROLES, ROLE_BY_ID: ROLE_BY_ID, detectRole: detectRole, kindOf: kindOf,
    configure: configure, readArchive: readArchive, checklist: checklist,
    compare: compare, diffText: diffText, contentsMarkdown: contentsMarkdown, trimManifest: trimManifest,
    TEXT_CAP: TEXT_CAP, PDF_TEXT_CAP: PDF_TEXT_CAP,
  };
});
