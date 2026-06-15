/* Aloud TeX compile module — hybrid Version B.
 *
 *  window.AloudTeX.compile({ mainFile, files, passes, onProgress })
 *      -> in-browser pdfTeX (SwiftLaTeX WASM) + TeXlyre on-demand package server.
 *         Fast, GitHub-Pages-native. pdfTeX 1.40.21 → visually ~identical, NOT byte-identical
 *         to a TeX Live 2026 reference (pagination may drift a little).
 *
 *  window.AloudTeX.compileExact({ mainFile, files }, endpoint?)
 *      -> POSTs the project to an external TeX Live 2026 compile API for a byte-identical PDF.
 *         endpoint defaults to window.ALOUD_TEX_EXACT_ENDPOINT.
 *
 *  files: Array<{ path:string, text?:string, bytes?:Uint8Array }>
 *  returns: { ok:boolean, pdf:Uint8Array|null, log:string, pages:number|null, status:number, ms:number, engine:string }
 *
 *  Requires vendor/swiftlatex/PdfTeXEngine.js to be loaded first (ProofReader.html does this).
 */
(function () {
  'use strict';

  var ENGINE_SCRIPT = 'vendor/swiftlatex/PdfTeXEngine.js';
  var enginePromise = null;   // singleton load
  var engine = null;
  var busy = false;

  function loadScriptOnce(src) {
    return new Promise(function (res, rej) {
      if (document.querySelector('script[data-aloudtex="' + src + '"]')) return res();
      var s = document.createElement('script');
      s.src = src; s.async = true; s.dataset.aloudtex = src;
      s.onload = function () { res(); };
      s.onerror = function () { rej(new Error('Failed to load ' + src)); };
      document.head.appendChild(s);
    });
  }

  function PdfTeXEngineCtor() {
    return (window.exports && window.exports.PdfTeXEngine) || window.PdfTeXEngine || null;
  }

  async function getEngine(onProgress) {
    if (engine) return engine;
    if (!enginePromise) {
      enginePromise = (async function () {
        if (!PdfTeXEngineCtor()) {
          if (onProgress) onProgress('engine betöltése…');
          await loadScriptOnce(ENGINE_SCRIPT);
        }
        var Ctor = PdfTeXEngineCtor();
        if (!Ctor) throw new Error('PdfTeXEngine not available (vendor/swiftlatex/PdfTeXEngine.js)');
        var e = new Ctor();
        await e.loadEngine();
        engine = e;
        return e;
      })();
    }
    return enginePromise;
  }

  function dirsOf(paths) {
    var set = {};
    paths.forEach(function (p) {
      var parts = p.split('/'); parts.pop();
      var acc = '';
      parts.forEach(function (d) { acc = acc ? acc + '/' + d : d; if (acc) set[acc] = 1; });
    });
    return Object.keys(set).sort(function (a, b) { return a.split('/').length - b.split('/').length; });
  }

  function parsePages(log) {
    var m = /Output written on [^()]*\((\d+)\s+pages?/.exec(log || '');
    return m ? parseInt(m[1], 10) : null;
  }

  async function compile(opts) {
    opts = opts || {};
    var files = opts.files || [];
    var mainFile = opts.mainFile;
    var passes = opts.passes || 3;
    var onProgress = opts.onProgress || function () {};
    if (!mainFile) throw new Error('compile: mainFile required');
    if (busy) throw new Error('compile: another compilation is in progress');
    busy = true;
    var t0 = (window.performance || Date).now ? performance.now() : Date.now();
    try {
      var eng = await getEngine(onProgress);

      // create folders, then write every file
      dirsOf(files.map(function (f) { return f.path; })).forEach(function (d) { eng.makeMemFSFolder(d); });
      onProgress('fájlok írása (' + files.length + ')…');
      files.forEach(function (f) {
        if (f.bytes != null) eng.writeMemFSFile(f.path, f.bytes);
        else eng.writeMemFSFile(f.path, f.text != null ? f.text : '');
      });

      eng.setEngineMainFile(mainFile);

      var r = null;
      for (var i = 1; i <= passes; i++) {
        onProgress('fordítás ' + i + '/' + passes + '…');
        r = await eng.compileLaTeX();
        // if a pass yields no pdf and a fatal status, stop early
        if (r && r.status !== 0 && !r.pdf) break;
      }
      var ms = ((window.performance || Date).now ? performance.now() : Date.now()) - t0;
      return {
        ok: !!(r && r.pdf), pdf: r ? r.pdf || null : null, log: r ? r.log || '' : '',
        pages: parsePages(r && r.log), status: r ? r.status : -1, ms: Math.round(ms),
        engine: 'browser:swiftlatex-pdftex-1.40.21',
      };
    } finally { busy = false; }
  }

  // External TeX Live API (byte-identical). Contract: POST JSON
  //   { mainFile, files:[{path, text?} | {path, b64?}] }  ->  application/pdf
  async function compileExact(opts, endpoint) {
    opts = opts || {};
    endpoint = endpoint || window.ALOUD_TEX_EXACT_ENDPOINT;
    if (!endpoint) throw new Error('compileExact: nincs beállítva endpoint (window.ALOUD_TEX_EXACT_ENDPOINT)');
    var t0 = Date.now();
    var payloadFiles = (opts.files || []).map(function (f) {
      if (f.bytes != null) {
        var bin = ''; for (var i = 0; i < f.bytes.length; i++) bin += String.fromCharCode(f.bytes[i]);
        return { path: f.path, b64: btoa(bin) };
      }
      return { path: f.path, text: f.text != null ? f.text : '' };
    });
    var resp = await fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mainFile: opts.mainFile, files: payloadFiles }),
    });
    if (!resp.ok) {
      var msg = await resp.text().catch(function () { return ''; });
      throw new Error('compileExact: API ' + resp.status + ' ' + (msg || '').slice(0, 300));
    }
    var buf = new Uint8Array(await resp.arrayBuffer());
    return { ok: buf.length > 0, pdf: buf, log: '(external)', pages: null, status: 0,
             ms: Date.now() - t0, engine: 'external:texlive2026' };
  }

  // debounce helper for auto-recompile
  function debounce(fn, wait) {
    var t = null;
    return function () {
      var args = arguments, ctx = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, wait);
    };
  }

  window.AloudTeX = {
    compile: compile,
    compileExact: compileExact,
    debounce: debounce,
    isBusy: function () { return busy; },
    parsePages: parsePages,
  };
})();
