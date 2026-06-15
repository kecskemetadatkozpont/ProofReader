/* Aloud "Pontos PDF" exact-compile server — real TeX Live (= Overleaf-grade, byte-identical output).
 *
 * Implements the window.AloudTeX.compileExact() contract (tex-compile.js):
 *   POST {endpoint}            Content-Type: application/json
 *     body: { mainFile: "Doctoral_Thesis_v18_3_HU.tex",
 *             files: [ {path, text} | {path, b64}, ... ] }
 *     200 → application/pdf (the compiled bytes)
 *     4xx/5xx → text/plain error (+ compile log tail)
 *   GET /health → 200 "ok"
 *
 * Pure Node (no npm deps). Run inside the TeX Live Docker image (see Dockerfile).
 * Env: PORT (default 8080), TEX_ENGINE ("latexmk"|"pdflatex", default latexmk),
 *      MAX_BODY_MB (default 200), COMPILE_TIMEOUT_MS (default 180000),
 *      ALLOW_ORIGIN (default "*").
 */
'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const PORT = parseInt(process.env.PORT || '8080', 10);
const ENGINE = process.env.TEX_ENGINE || 'latexmk';
const MAX_BODY = (parseInt(process.env.MAX_BODY_MB || '200', 10)) * 1024 * 1024;
const TIMEOUT = parseInt(process.env.COMPILE_TIMEOUT_MS || '180000', 10);
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}
function fail(res, code, msg) { cors(res); res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(msg); }

// reject path traversal / absolute paths
function safeRel(p) {
  p = String(p || '').replace(/\\/g, '/');
  if (!p || p[0] === '/' || p.indexOf('..') >= 0 || /^[a-zA-Z]:/.test(p)) return null;
  return p;
}

function runEngine(workdir, mainFile, cb) {
  const jobNoExt = mainFile.replace(/\.tex$/i, '');
  const common = ['-interaction=nonstopmode', '-halt-on-error=false'];
  let cmd, args;
  if (ENGINE === 'pdflatex') { cmd = 'pdflatex'; args = ['-no-shell-escape', ...common, mainFile]; }
  else { cmd = 'latexmk'; args = ['-pdf', '-no-shell-escape', '-interaction=nonstopmode', mainFile]; }
  const env = Object.assign({}, process.env, { openin_any: 'p', openout_any: 'p', TEXMFHOME: workdir + '/.texmf' });
  const opts = { cwd: workdir, env: env, timeout: TIMEOUT, maxBuffer: 64 * 1024 * 1024 };

  const passes = ENGINE === 'pdflatex' ? 3 : 1; // latexmk handles its own passes
  let i = 0;
  const step = () => {
    i++;
    execFile(cmd, args, opts, (err, stdout, stderr) => {
      const pdf = path.join(workdir, jobNoExt + '.pdf');
      const done = (i >= passes) || (ENGINE === 'latexmk');
      if (done || !fs.existsSync(pdf)) {
        const log = (() => { try { return fs.readFileSync(path.join(workdir, jobNoExt + '.log'), 'utf8'); } catch (e) { return (stdout || '') + '\n' + (stderr || ''); } })();
        cb(fs.existsSync(pdf) ? null : (err || new Error('no PDF produced')), pdf, log);
      } else step();
    });
  };
  step();
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); return res.end(); }
  if (req.method === 'GET' && (req.url === '/health' || req.url === '/')) { cors(res); res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
  if (req.method !== 'POST') return fail(res, 405, 'POST {mainFile, files} to compile');

  let size = 0; const chunks = [];
  req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { fail(res, 413, 'payload too large'); req.destroy(); } else chunks.push(c); });
  req.on('end', () => {
    let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { return fail(res, 400, 'invalid JSON'); }
    const mainFile = safeRel(body.mainFile);
    if (!mainFile || !/\.tex$/i.test(mainFile)) return fail(res, 400, 'mainFile must be a .tex path');
    if (!Array.isArray(body.files) || !body.files.length) return fail(res, 400, 'files[] required');

    let workdir;
    try { workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'aloudtex-')); } catch (e) { return fail(res, 500, 'workdir error'); }
    const cleanup = () => { try { fs.rmSync(workdir, { recursive: true, force: true }); } catch (e) { } };

    try {
      for (const f of body.files) {
        const rel = safeRel(f.path); if (!rel) continue;
        const dest = path.join(workdir, rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        if (f.b64 != null) fs.writeFileSync(dest, Buffer.from(f.b64, 'base64'));
        else fs.writeFileSync(dest, String(f.text != null ? f.text : ''), 'utf8');
      }
    } catch (e) { cleanup(); return fail(res, 500, 'write error: ' + e.message); }

    runEngine(workdir, mainFile, (err, pdfPath, log) => {
      if (err) { const tail = String(log || '').split('\n').filter((l) => /^!|Error|Fatal|Undefined|not found/.test(l)).slice(-15).join('\n'); cleanup(); return fail(res, 422, 'compile failed:\n' + tail); }
      let bytes; try { bytes = fs.readFileSync(pdfPath); } catch (e) { cleanup(); return fail(res, 500, 'read PDF error'); }
      cors(res); res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': bytes.length });
      res.end(bytes); cleanup();
    });
  });
});

server.listen(PORT, () => console.log('aloud exact-compile (' + ENGINE + ') listening on :' + PORT));
