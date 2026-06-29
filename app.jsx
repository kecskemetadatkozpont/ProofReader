/* Aloud app */
(function () {
  const { useState, useEffect, useRef, useMemo, useLayoutEffect, useCallback } = React;
  const { useTweaks, TweaksPanel, TweakSection, TweakSlider, TweakRadio, TweakSelect, TweakColor, TweakToggle } = window;
  const Collab = window.Collab;

  // Importable text formats (LaTeX sources + build artifacts like .bbl + Markdown notes).
  const TEXT_EXT_RE = /\.(tex|bib|cls|sty|txt|bbl|bst|md|markdown)$/i;
  // Map a filename to its editor doc-type. .tex/.txt stay 'tex' (full LaTeX pipeline);
  // the rest are plain-text docs we display and edit but never feed to the LaTeX engine.
  function fileTypeOf(name) {
    const ext = ((name || '').split('.').pop() || '').toLowerCase();
    if (ext === 'bib') return 'bib';
    if (ext === 'bbl') return 'bbl';
    if (ext === 'bst') return 'bst';
    if (ext === 'cls') return 'cls';
    if (ext === 'sty') return 'sty';
    if (ext === 'md' || ext === 'markdown') return 'md';
    return 'tex';
  }
  const TEXT_TYPES = { tex: 1, bib: 1, bbl: 1, bst: 1, cls: 1, sty: 1, md: 1 };

  const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
    "theme": "paper",
    "reading": "#ffe08a",
    "serifSize": 17,
    "monoSize": 13.5,
    "paperWidth": 720,
    "dimInactive": true,
    "renderMode": "auto",
    "numberSections": true,
    "citeStyle": "numeric"
  }/*EDITMODE-END*/;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const PROJECT_ID = new URLSearchParams(location.search).get('p');
  if (typeof window !== 'undefined' && !window.PR_RENDEROPTS) window.PR_RENDEROPTS = { numberSections: true, citeStyle: 'numeric' };
  // Standalone (e.g. GitHub Pages, no host toolbar) → show our own Tweaks button.
  const PR_STANDALONE = (() => { try { return window.top === window.self; } catch (e) { return true; } })();

  /* data: URLs don't render reliably for PDFs inside iframes/objects (Chrome blocks them),
     so convert to a same-origin Blob URL which the built-in PDF viewer accepts. */
  function dataURLToBlob(dataURL) {
    const i = dataURL.indexOf(','); const header = dataURL.slice(0, i);
    const mime = (header.match(/data:([^;]+)/) || [])[1] || 'application/octet-stream';
    const isB64 = /;base64/i.test(header);
    const data = dataURL.slice(i + 1);
    let bytes;
    if (isB64) { const bin = atob(data); bytes = new Uint8Array(bin.length); for (let j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j); }
    else { const dec = decodeURIComponent(data); bytes = new Uint8Array(dec.length); for (let j = 0; j < dec.length; j++) bytes[j] = dec.charCodeAt(j); }
    return new Blob([bytes], { type: mime });
  }
  function dataURLToBytes(dataURL) {
    const i = dataURL.indexOf(','); const head = dataURL.slice(0, i); const body = dataURL.slice(i + 1);
    if (/;base64/i.test(head)) { const bin = atob(body); const b = new Uint8Array(bin.length); for (let j = 0; j < bin.length; j++) b[j] = bin.charCodeAt(j); return b; }
    const dec = decodeURIComponent(body); const b = new Uint8Array(dec.length); for (let j = 0; j < dec.length; j++) b[j] = dec.charCodeAt(j); return b;
  }

  /* ---- path helpers ---- */
  const dn = (p) => { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); };
  const bn = (p) => { const i = p.lastIndexOf('/'); return i < 0 ? p : p.slice(i + 1); };
  const pjoin = (d, n) => d ? d + '/' + n : n;
  function uniquePath(taken, path) {
    if (!taken(path)) return path;
    const dir = dn(path), base = bn(path), dot = base.lastIndexOf('.');
    const stem = dot > 0 ? base.slice(0, dot) : base, ext = dot > 0 ? base.slice(dot) : '';
    let n = 2, np;
    do { np = pjoin(dir, stem + ' ' + n + ext); n++; } while (taken(np));
    return np;
  }

  function buildInitial() {
    const prefs = (window.PRStore && window.PRStore.prefs()) || {};
    const cloud = !!(window.PR_BACKEND && window.PR_BACKEND.mode === 'cloud');
    let project = PROJECT_ID && window.PRStore ? window.PRStore.get(PROJECT_ID) : null;
    if (project && PROJECT_ID) { try { sessionStorage.removeItem('pr_await_' + PROJECT_ID); } catch (e) { } }
    // A SHARED project opened by direct link is often not in the warm cache yet (a collaborator's first visit).
    // Hydrate and reload once it arrives — instead of dropping the user onto a Sample and overwriting the URL,
    // which is why a collaborator could see a stale "Sample" instead of the shared project. Reload-loop guarded.
    if (!project && PROJECT_ID && cloud && window.PRStore && window.PRStore._hydrate) {
      const awKey = 'pr_await_' + PROJECT_ID;
      let awaited = false; try { awaited = !!sessionStorage.getItem(awKey); } catch (e) { }
      if (!awaited) {
        try {
          const off = window.PRStore.subscribe(function () {
            if (window.PRStore.get(PROJECT_ID)) { try { off(); } catch (e) { } try { sessionStorage.setItem(awKey, '1'); } catch (e) { } location.reload(); }
          });
          window.PRStore._hydrate();
          setTimeout(function () { try { off(); } catch (e) { } }, 12000);   // give up after 12s (invalid / no-access id)
        } catch (e) { }
      }
    }
    if (!project && window.PRStore) {
      // No (or not-yet-loaded) project: fall back to the persistent sample project so the editor still works.
      window.PRStore.seedIfEmpty();
      project = window.PRStore.get('sample') || (window.PRStore.list()[0]);
      // only rewrite the URL when NO explicit project was requested — never clobber a direct link we're still loading
      if (project && !PROJECT_ID) { try { history.replaceState(null, '', location.pathname + '?p=' + project.id); } catch (e) { } }
    }
    if (!project) {
      const seed = window.PR_SAMPLE;
      project = { id: null, title: 'Sample paper', files: JSON.parse(JSON.stringify(seed.files)), order: seed.order.slice(), active: seed.active, folders: (seed.folders || []).slice(), idx: 0 };
    }
    // Defensive: guarantee a valid active tex file so the editor can never
    // hard-fail (e.g. a cloud project whose data was empty/malformed).
    if (!project.files || typeof project.files !== 'object') project.files = {};
    if (!project.files[project.active] || project.files[project.active].type !== 'tex') {
      const texKey = Object.keys(project.files).find((k) => project.files[k] && project.files[k].type === 'tex');
      if (texKey) { project.active = texKey; }
      else {
        const seed = window.PR_SAMPLE;
        project.files = JSON.parse(JSON.stringify(seed.files)); project.order = seed.order.slice(); project.active = seed.active; project.folders = (seed.folders || []).slice();
      }
    }
    if (!Array.isArray(project.order) || !project.order.length) project.order = Object.keys(project.files);
    return {
      projectId: project.id, title: project.title, ownerId: project.ownerId,
      files: project.files, order: project.order, active: project.active, folders: project.folders || [],
      idx: project.idx || 0, rate: prefs.rate || 1, voiceURI: prefs.voiceURI || ''
    };
  }

  // AI figure generation (PaperBanana). Calls the paper-figure Edge fn (placeholder until PAPERBANANA_ENDPOINT
  // is set), shows candidates, and hands the chosen one (as a PNG blob) back to the editor to insert.
  function FigureGenModal({ open, defaultCaption, defaultMethod, onPick, onClose }) {
    const [method, setMethod] = useState('');
    const [caption, setCaption] = useState('');
    const [n, setN] = useState(4);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');
    const [cands, setCands] = useState(null);
    const [mode, setMode] = useState('');
    useEffect(() => { if (open) { setCaption(defaultCaption || ''); setMethod(defaultMethod || ''); setCands(null); setErr(''); } }, [open]);
    if (!open) return null;
    const CFG = window.PR_CONFIG || {};
    function rasterize(dataUrl) {
      return new Promise((res) => {
        if (/^data:image\/(png|jpe?g)/i.test(dataUrl)) { fetch(dataUrl).then((r) => r.blob()).then(res, () => res(null)); return; }
        const img = new Image();
        img.onload = () => { const c = document.createElement('canvas'); c.width = img.naturalWidth || 520; c.height = img.naturalHeight || 360; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0); c.toBlob(res, 'image/png'); };
        img.onerror = () => res(null); img.src = dataUrl;
      });
    }
    function generate() {
      if (!caption.trim() && !method.trim()) { setErr('Enter at least a caption.'); return; }
      setBusy(true); setErr(''); setCands(null);
      (window.PR_SB ? window.PR_SB.auth.getSession() : Promise.resolve({})).then((s) => {
        const token = (s && s.data && s.data.session && s.data.session.access_token) || CFG.supabaseAnonKey;
        fetch(CFG.supabaseUrl + '/functions/v1/paper-figure', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: CFG.supabaseAnonKey, Authorization: 'Bearer ' + token }, body: JSON.stringify({ method: method, caption: caption, task: 'diagram', n: n }) })
          .then((r) => r.json()).then((out) => { setBusy(false); if (!out || out.error) { setErr((out && out.error) || 'Error.'); return; } setCands(out.candidates || []); setMode(out.mode || ''); }, () => { setBusy(false); setErr('Generation failed (is the paper-figure Edge function available?).'); });
      });
    }
    function pick(c) { rasterize(c.dataUrl).then((blob) => { if (!blob) { setErr('Image processing failed.'); return; } onPick(blob, caption); }); }
    return <div className="overlay" onClick={onClose} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div className="fig-modal" role="dialog" aria-modal="true" aria-label="Generate figure (AI)" onClick={(e) => e.stopPropagation()}>
        <div className="fig-h"><b><span aria-hidden="true">✨</span> Generate figure (AI)</b><button className="fig-x" aria-label="Close" onClick={onClose}>✕</button></div>
        <label className="fig-l">Caption</label>
        <input className="fig-in" value={caption} placeholder="E.g. The architecture of the Fisher Fusion pipeline." onChange={(e) => setCaption(e.target.value)} />
        <label className="fig-l">Method text — optional, for a better figure</label>
        <textarea className="fig-ta" value={method} placeholder="Paste the relevant part of the method section (markdown recommended)…" onChange={(e) => setMethod(e.target.value)} />
        <div className="fig-row">
          <span className="fig-l" style={{ margin: 0 }}>Candidates: {n}</span>
          <input type="range" min="1" max="8" value={n} onChange={(e) => setN(+e.target.value)} />
          <button className="fig-gen" disabled={busy} onClick={generate}>{busy ? 'Generating…' : 'Generate'}</button>
        </div>
        {err ? <div className="fig-err">{err}</div> : null}
        {mode === 'placeholder' && cands ? <div className="fig-note">Placeholder figures — set the <code>PAPERBANANA_ENDPOINT</code> secret for real generation.</div> : null}
        {busy ? <div className="fig-busy">The AI is working on the candidates… (the real pipeline is multi-step and may take a while)</div> : null}
        {cands ? <div className="fig-grid">{cands.map((c, i) => <button className="fig-cand" key={i} title="Insert into the document" onClick={() => pick(c)}><img src={c.dataUrl} alt={c.label || ('cand ' + i)} /><span>{c.label || ('Candidate ' + (i + 1))}</span></button>)}</div> : null}
      </div>
    </div>;
  }

  function App() {
    const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
    const [, bumpTheme] = useState(0);
    useEffect(() => { const h = () => bumpTheme((n) => n + 1); window.addEventListener('pr-theme', h); return () => window.removeEventListener('pr-theme', h); }, []); // re-render the editor when the global dark toggle flips
    const init = useMemo(buildInitial, []);

    const [files, setFiles] = useState(init.files);
    const [order, setOrder] = useState(init.order);
    const [active, setActive] = useState(init.active);
    const [compiled, setCompiled] = useState(() => window.LatexEngine.process((init.files[init.active] && init.files[init.active].content) || '', init.files));
    const [signTick, setSignTick] = useState(0);
    const SIZE_LIMIT = 50 * 1024 * 1024;
    const [uploads, setUploads] = useState([]);
    const uploadSeq = useRef(0);
    const [renderStale, setRenderStale] = useState(false);

    const [idx, setIdxState] = useState(init.idx);
    const [status, setStatusState] = useState('idle'); // idle | playing | paused
    const [rate, setRate] = useState(init.rate);
    const [voiceURI, setVoiceURI] = useState(init.voiceURI);
    const [voices, setVoices] = useState([]);
    const [folders, setFolders] = useState(init.folders);
    const [currentDir, setCurrentDir] = useState('');
    const [expanded, setExpanded] = useState(() => new Set(init.folders));
    const [renaming, setRenaming] = useState(null); // {type:'file'|'folder', path}

    /* ---- dynamic window management ---- */
    const projectId0 = init.projectId;
    const defaultLayout = () => ({ id: window.WS.nid(), type: 'split', dir: 'row', ratio: 0.5, a: window.WS.mkPane('source', init.active), b: window.WS.mkPane('preview', init.active) });
    const [layout, setLayoutState] = useState(() => {
      const saved = window.PRStore && projectId0 ? (window.PRStore.prefs()['layout:' + projectId0]) : null;
      if (saved && window.WS.firstPane(saved)) {
        // every doc-bound pane must point at an existing CURRENT-PROJECT tex file.
        // external '@' references can't be revived on reload (their content isn't persisted), so any
        // layout containing one is discarded back to the default split.
        const ok = window.WS.allPanes(saved).every((p) => {
          if (p.kind !== 'source' && p.kind !== 'preview') return true;
          return p.docId && p.docId[0] !== '@' && init.files[p.docId] && init.files[p.docId].type === 'tex';
        });
        if (ok) return saved;
      }
      return defaultLayout();
    });
    const layoutRef = useRef(layout); layoutRef.current = layout;
    const setLayout = (l) => { const nl = typeof l === 'function' ? l(layoutRef.current) : l; layoutRef.current = nl; setLayoutState(nl); };
    const [focusedPaneId, setFocusedPaneId] = useState(() => { const fp = window.WS.firstPane(layout); return fp ? fp.id : null; });
    const [soloPaneId, setSoloPaneId] = useState(null);
    const [dragId, setDragId] = useState(null);
    const [addOpen, setAddOpen] = useState(false);
    const [preset, setPreset] = useState('split');
    const [extTick, setExtTick] = useState(0);
    const extDocs = useRef({});          // '@pid/file' -> { source, files, label, projTitle }
    const idxByDoc = useRef({});         // docId -> last reading idx
    const previewEls = useRef({});       // paneId -> DOM node
    const [selPaneId, setSelPaneId] = useState(null);
    const [selPos, setSelPos] = useState(null);
    const selDocRef = useRef(null);

    // resizable file-browser width (no divider existed between .filepanel and .ws-area)
    const [fileW, setFileW] = useState(() => { try { const v = parseInt(localStorage.getItem('pr.fileW'), 10); return v ? Math.max(160, Math.min(560, v)) : 226; } catch (_) { return 226; } });
    const startFileDrag = (e) => {
      e.preventDefault();
      const startX = e.clientX, startW = fileW; let lastW = startW;
      const mv = (ev) => { lastW = Math.max(160, Math.min(560, startW + (ev.clientX - startX))); setFileW(lastW); };
      const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); document.body.style.cursor = ''; document.body.style.userSelect = ''; try { localStorage.setItem('pr.fileW', String(lastW)); } catch (_) { } };
      window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
      document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none';
    };

    /* ---- collaboration state ---- */
    const projectId = init.projectId;
    const me = useMemo(() => (window.PRAuth && (window.PRAuth.current() || window.PRAuth.byId(init.ownerId) || (window.PRAuth.demoUsers ? window.PRAuth.demoUsers() : window.PRAuth.users())[0])) || { id: 'u_anna', name: 'You', color: '#4f46e5' }, []);
    const meRef = useRef(me); meRef.current = me;
    const [annotations, setAnnotations] = useState(() => projectId && window.PRStore ? window.PRStore.listAnnotations(projectId) : []);
    const [versions, setVersions] = useState(() => projectId && window.PRStore ? window.PRStore.listVersions(projectId) : []);
    const [dlBusy, setDlBusy] = useState(false);
    const [projMeta, setProjMeta] = useState(() => { const p = projectId && window.PRStore ? window.PRStore.get(projectId) : null; const tts = (window.PRStore && window.PRStore.ttsForProject && projectId) ? window.PRStore.ttsForProject(me.id, projectId) : null; return p ? { members: p.members, ownerId: p.ownerId, link: p.link, activity: p.activity, templateId: p.templateId, journalMeta: p.journalMeta, limits: p.limits, journal: p.journal, submission: p.submission, tts: tts } : { members: [], ownerId: me.id, link: { enabled: false, role: 'viewer' }, tts: tts }; });
    const [drawer, setDrawer] = useState({ open: false, tab: 'comments' });
    const [draft, setDraft] = useState(null);
    const [selQuote, setSelQuote] = useState('');
    const selRange = useRef({ start: 0, end: 0 });
    const [previewSel, setPreviewSel] = useState(null); // {top,left} when selection made in preview
    const [shareOpen, setShareOpen] = useState(false);
    const [pdfWantDl, setPdfWantDl] = useState(false);   // "Download PDF" pressed before a compile finished
    // admin role (cloud only) — drives the top-bar Admin link (replaces the old bottom-right floating button)
    const [isAdmin, setIsAdmin] = useState(() => !!(window.PR_BACKEND && window.PR_BACKEND.user && window.PR_BACKEND.user.role === 'admin'));
    const [canFigures, setCanFigures] = useState(false);   // admin-granted AI figure generation (PaperBanana)
    const [figOpen, setFigOpen] = useState(false);
    useEffect(() => { try { if (window.PR_SB && me && me.id) window.PR_SB.from('profiles').select('can_figures').eq('id', me.id).maybeSingle().then((r) => { if (r && r.data) setCanFigures(!!r.data.can_figures); }, function () { }); } catch (e) { } }, []);
    useEffect(() => { const h = (e) => setIsAdmin(!!(e.detail && e.detail.role === 'admin')); window.addEventListener('pr-profile', h); return () => window.removeEventListener('pr-profile', h); }, []);
    const [voiceOpen, setVoiceOpen] = useState(false);
    const [acctOpen, setAcctOpen] = useState(false);
    const [diffVersion, setDiffVersion] = useState(null);
    const [peers, setPeers] = useState([]);
    const [resume, setResume] = useState(null);
    const [editPaused, setEditPaused] = useState(false); // auto-paused because the user started editing while reading
    const [cmdk, setCmdk] = useState(false); // command palette (⌘K)
    const [writeMode, setWriteMode] = useState(false); // WYSIWYG editing in the preview
    const [savedFlash, setSavedFlash] = useState(false);
    const [storageWarn, setStorageWarn] = useState(false);
    useEffect(() => { const h = () => { setStorageWarn(true); setTimeout(() => setStorageWarn(false), 6000); }; window.addEventListener('pr-storage-full', h); return () => window.removeEventListener('pr-storage-full', h); }, []);
    const [selectReq, setSelectReq] = useState(null);
    const [diagOpen, setDiagOpen] = useState(false);
    const pf0 = window.PRStore ? window.PRStore.prefs() : {};
    const [voice, setVoice] = useState({
      engine: pf0.engine || 'eleven',
      elevenVoice: (pf0.elevenVoice && pf0.elevenVoice.length > 12) ? pf0.elevenVoice : '21m00Tcm4TlvDq8ikWAM',
      model: pf0.model || 'eleven_v3',
      stability: pf0.stability == null ? 50 : pf0.stability,
      similarity: pf0.similarity == null ? 75 : pf0.similarity
    });
    const voiceCfgRef = useRef(voice); voiceCfgRef.current = voice;
    const audioRef = useRef(null);                 // current ElevenLabs <audio> element
    const [elevenBusy, setElevenBusy] = useState(false); // synthesizing current sentence
    const [elevenErr, setElevenErr] = useState(null);
    const [voicedKeys, setVoicedKeys] = useState({}); // cache keys with already-generated audio (free to replay)
    const [reviewFocus, setReviewFocus] = useState(null); // review annotation id to focus in the Review drawer
    const [showVoiced, setShowVoiced] = useState(pf0.showVoiced !== false); // ♪ voiced-highlight layer toggle
    const [showReview, setShowReview] = useState(pf0.showReview !== false); // ✦ review-marker layer toggle
    const [spellOn, setSpellOn] = useState(!!pf0.spellOn);                  // spell-check (off by default — downloads a dictionary)
    const [spellLangPref, setSpellLangPref] = useState(pf0.spellLang || ''); // '' = auto-detect per document
    const [hlShow, setHlShow] = useState(() => Object.assign({ comment: true, todo: true, spell: true }, pf0.hlShow || {})); // per-category code-editor highlight toggles
    useEffect(() => { if (window.PRStore) window.PRStore.setPrefs({ showVoiced, showReview, spellOn, spellLang: spellLangPref, hlShow }); }, [showVoiced, showReview, spellOn, spellLangPref, hlShow]);
    const [spellResult, setSpellResult] = useState(null);
    const [spellBusy, setSpellBusy] = useState(false);
    const [spellErr, setSpellErr] = useState(null);
    const [spellPersonal, setSpellPersonal] = useState(() => { try { return (window.PRStore && window.PRStore.prefs().spellDict) || []; } catch (e) { return []; } });
    const [spellIgnore, setSpellIgnore] = useState([]); // session-only "ignore once"
    const [pronDict, setPronDict] = useState(() => { try { return (window.PRStore && window.PRStore.prefs().ttsDict) || []; } catch (e) { return []; } }); // pronunciation overrides for TTS
    // install the dictionary into the TTS engine synchronously (during render, before any play/keyFor handler
    // can fire this cycle) — a post-render effect would leave a first-paint window keyed against un-pronounced text.
    if (window.PREleven && window.PREleven.setPron) window.PREleven.setPron(pronDict);
    const setPronAndSave = useCallback((list) => { setPronDict(list); try { window.PRStore.setPrefs({ ttsDict: list }); } catch (e) { } }, []);
    // narration (audiobook) export — concatenate the per-sentence MP3 clips of the active doc into one file
    const [narr, setNarr] = useState(null); // { busy, done, total, fails } | { err } | { doneFlag }
    const narrCancelRef = useRef(false);
    useEffect(() => { setNarr(null); }, [active]); // clear a stale "Saved"/error message when the document changes
    const narrationStats = useCallback(() => {
      const sents = (sentsRef.current || []).filter((s) => s && s.text);
      const cfg = voiceCfgRef.current || {};
      let cached = 0; const E = window.PREleven;
      if (E) sents.forEach((s) => { if (voicedKeys[E.keyFor(s.text, cfg)]) cached++; });
      return { total: sents.length, cached: cached, missing: sents.length - cached };
    }, [voicedKeys]);
    const cancelNarration = useCallback(() => { narrCancelRef.current = true; }, []);
    const downloadNarration = useCallback((synthMissing) => {
      const E = window.PREleven; if (!E) return;
      const cfg = voiceCfgRef.current || {};
      if (cfg.engine !== 'eleven') { setNarr({ err: 'Switch the voice engine to ElevenLabs to export narration audio.' }); return; }
      if (!E.hasKey()) { setNarr({ err: 'Add your ElevenLabs API key in Voice settings first.' }); return; }
      // drop sentences that have no speakable text (e.g. a pronunciation entry mapping the whole sentence to "")
      const sents = (sentsRef.current || []).filter((s) => s && s.text && (!E.spoken || E.spoken(s.text).trim()));
      const items = synthMissing ? sents : sents.filter((s) => voicedKeys[E.keyFor(s.text, cfg)]);
      if (!items.length) { setNarr({ err: synthMissing ? 'Nothing to narrate — compile the document first.' : 'No audio cached yet. Read the document aloud once, or synthesize the rest.' }); return; }
      narrCancelRef.current = false;
      setNarr({ busy: true, done: 0, total: items.length, fails: 0 });
      const blobs = []; let fails = 0, chain = Promise.resolve();
      items.forEach((s, i) => {
        chain = chain.then(() => {
          if (narrCancelRef.current) return null;
          // noSynth on the "voiced only" path so it can never trigger a paid synthesis; tolerate per-item
          // failures so one bad sentence doesn't discard the clips already produced (and already charged).
          return E.getBlob(s.text, cfg, meRef.current.id, projectId, !synthMissing).then((b) => { if (b) blobs.push(b); else fails++; }, () => { fails++; });
        }).then(() => { if (!narrCancelRef.current) setNarr({ busy: true, done: i + 1, total: items.length, fails: fails }); });
      });
      chain.then(() => {
        if (narrCancelRef.current) { setNarr(null); return; }
        if (!blobs.length) { setNarr({ err: 'No audio could be produced — try “synthesize”, or check your API key.' }); return; }
        return E.concatMp3(blobs).then((file) => {
          const url = URL.createObjectURL(file);
          const a = document.createElement('a'); a.href = url; a.download = (active.split('/').pop() || 'narration').replace(/\.[^.]+$/, '') + '.mp3';
          document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
          setNarr({ doneFlag: true, total: blobs.length, fails: fails });
        });
      }).catch((e) => { if (!narrCancelRef.current) setNarr({ err: (e && e.message) || 'Export failed.' }); });
    }, [active, projectId, voicedKeys]);
    // Download the whole project as a .zip: every source file (preserving folder paths) — INCLUDING images that
    // live as bundled assets (.src) or cloud uploads (.storagePath, signed-URL fetched), not just inline dataURLs
    // — plus a publify-data/ database (annotations.json + a readable .md) and the comment/to-do image attachments.
    async function downloadProject() {
      if (!window.JSZip) { window.PRUI.toast('The download engine (JSZip) is unavailable — refresh the page.', { kind: 'error' }); return; }
      setDlBusy(true);
      try {
        const zip = new window.JSZip();
        const urlForFile = async (f) => {
          if (f.src) return f.src;
          if (f.storagePath) {
            if (window.PR_SIGNED && window.PR_SIGNED[f.storagePath]) return window.PR_SIGNED[f.storagePath];
            if (window.PRUploads && window.PRUploads.signedUrl) { try { const u = await window.PRUploads.signedUrl(f.storagePath); if (typeof u === 'string' && u) return u; return (window.PR_SIGNED && window.PR_SIGNED[f.storagePath]) || null; } catch (e) { } }
          }
          return null;
        };
        const seen = {}; const paths = [];
        (order && order.length ? order : []).forEach((p) => { if (files[p]) { seen[p] = 1; paths.push(p); } });
        Object.keys(files).forEach((p) => { if (!seen[p] && files[p]) paths.push(p); });
        await Promise.all(paths.map(async (p) => {
          const f = files[p]; if (!f) return;
          if (f.dataURL) { try { zip.file(p, dataURLToBlob(f.dataURL)); return; } catch (e) { } }
          if (f.content != null) { zip.file(p, f.content); return; }
          const u = await urlForFile(f);
          if (u) { try { const r = await fetch(u); zip.file(p, await r.blob()); return; } catch (e) { } }
        }));
        const anns = annotations || [];
        const byKind = (k) => anns.filter((a) => (a.kind || 'comment') === k);
        const members = (projMeta && projMeta.members) || [];
        const nm = (id) => { const m = members.filter((x) => x.id === id)[0]; return (m && (m.name || m.email)) || id || '—'; };
        const db = {
          format: 1, app: 'Publify', exportedAt: new Date().toISOString(),
          project: { id: projectId || null, title: init.title || 'project', ownerId: projMeta && projMeta.ownerId, members: members },
          counts: { comments: byKind('comment').length, todos: byKind('todo').length, review: byKind('review').length, total: anns.length },
          annotations: anns, versions: versions || [], activity: (projMeta && projMeta.activity) || []
        };
        zip.file('publify-data/annotations.json', JSON.stringify(db, null, 2));
        // comment / to-do image (and file) attachments → publify-data/attachments/
        anns.forEach((a) => {
          const atts = (a.attachments || []).slice(); (a.replies || []).forEach((r) => { (r.attachments || []).forEach((x) => atts.push(x)); });
          atts.forEach((att, i) => { if (att && att.dataURL) { try { zip.file('publify-data/attachments/' + a.id + '-' + (att.name || ('attachment-' + (i + 1))), dataURLToBlob(att.dataURL)); } catch (e) { } } });
        });
        const fmtA = (a) => { const where = a.anchor ? (a.anchor.file + (a.anchor.quote ? ' — „' + String(a.anchor.quote).slice(0, 90) + '"' : '')) : ''; let s = '- **' + nm(a.authorId) + '**' + (a.status ? ' _(' + a.status + ')_' : '') + ': ' + String(a.body || a.comment || '').replace(/\n+/g, ' ') + (where ? '\n  - ' + where : ''); (a.replies || []).forEach((r) => { s += '\n  - ↳ **' + nm(r.authorId) + '**: ' + String(r.body || '').replace(/\n+/g, ' '); }); return s; };
        let md = '# ' + (init.title || 'Project') + ' — annotations\n\nExported: ' + db.exportedAt + '\n\n';
        md += '## Comments (' + byKind('comment').length + ')\n\n' + (byKind('comment').map(fmtA).join('\n') || '_none_') + '\n\n';
        md += '## To-dos (' + byKind('todo').length + ')\n\n' + (byKind('todo').map((a) => '- [' + (a.status === 'done' ? 'x' : ' ') + '] ' + String(a.body || '').replace(/\n+/g, ' ') + (a.assignee ? ' (assignee: ' + nm(a.assignee) + ')' : '') + (a.due ? ' — ' + a.due : '')).join('\n') || '_none_') + '\n\n';
        md += '## AI review (' + byKind('review').length + ')\n\n' + (byKind('review').map(fmtA).join('\n') || '_none_') + '\n';
        zip.file('publify-data/ANNOTATIONS.md', md);
        const blob = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url;
        a.download = ((init.title || 'project').replace(/[^\w\s-]+/g, '').trim().replace(/\s+/g, '-') || 'project') + '-export.zip';
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
      } catch (e) { window.PRUI.toast('Download failed: ' + ((e && e.message) || e), { kind: 'error' }); }
      finally { setDlBusy(false); }
    }
    const refreshVoiced = useCallback(() => { if (window.PREleven && window.PREleven.cachedKeys) window.PREleven.cachedKeys().then(setVoicedKeys).catch(() => {}); }, []);
    useEffect(() => { refreshVoiced(); const h = () => refreshVoiced(); window.addEventListener('pr-tts', h); return () => window.removeEventListener('pr-tts', h); }, [refreshVoiced]);

    const editedRef = useRef(false);
    const myRole = window.PRStore ? (window.PRStore.roleOf({ ownerId: projMeta.ownerId, members: projMeta.members, link: projMeta.link }, me.id) || 'viewer') : 'owner';
    const canEdit = myRole === 'owner' || myRole === 'editor';
    const canComment = canEdit || myRole === 'commenter';

    const idxRef = useRef(idx), statusRef = useRef(status), seqRef = useRef(0);
    const userScrolledRef = useRef(0), progScrollRef = useRef(0);   // read-aloud: don't fight a manual scroll
    const onPreviewScroll = useCallback(() => { if (Date.now() > progScrollRef.current) userScrolledRef.current = Date.now(); }, []);
    const sentsRef = useRef(compiled.sentences), rateRef = useRef(rate), voiceRef = useRef(voiceURI), filesRef = useRef(files);
    const setIdx = (v) => { idxRef.current = v; setIdxState(v); };
    const setStatus = (v) => { statusRef.current = v; setStatusState(v); };
    sentsRef.current = compiled.sentences; rateRef.current = rate; voiceRef.current = voiceURI; filesRef.current = files;

    const source = files[active] && files[active].type === 'tex' ? files[active].content : '';
    const previewRef = useRef(null);

    /* ---- document helpers (docId = current-project file path, or '@pid/file' for an external reference) ---- */
    const isCurProj = useCallback((docId) => !!docId && docId[0] !== '@', []);
    // text-like files that can be shown/edited in the editor (.tex drives the compile;
    // .bib/.cls/.sty/.bbl/.bst/.md are plain-text docs we display and edit too)
    const isTextDoc = (docId) => { const f = files[docId]; return !!f && !!TEXT_TYPES[f.type]; };
    const docExists = useCallback((docId) => !docId ? false : (docId[0] === '@' ? !!extDocs.current[docId] : isTextDoc(docId)), [files]);
    // any text file in the current project is editable; external (@) and binary docs are read-only
    const readOnlyDoc = useCallback((docId) => !isCurProj(docId) || !isTextDoc(docId), [isCurProj, files]);
    const getSource = useCallback((docId) => {
      if (!docId) return '';
      if (docId[0] === '@') return (extDocs.current[docId] || {}).source || '';
      return isTextDoc(docId) ? (files[docId].content || '') : '';
    }, [files]);
    const docLabel = useCallback((docId) => {
      if (!docId) return 'Empty';
      if (docId[0] === '@') { const d = extDocs.current[docId]; return d ? (d.projTitle + ' · ' + bn(d.file)) : 'reference'; }
      return bn(docId);
    }, []);
    const DOC_COLORS = ['#4f46e5', '#0e9f6e', '#d9760b', '#db2777', '#0891b2', '#7c3aed'];
    const docColor = useCallback((docId) => {
      const docs = window.WS.collectDocs(layoutRef.current);
      const i = docs.indexOf(docId);
      return DOC_COLORS[(i < 0 ? 0 : i) % DOC_COLORS.length];
    }, [layout]);

    /* compile every OPEN document except the active one (active uses the debounced `compiled`) */
    const openDocIds = useMemo(() => window.WS.collectDocs(layout), [layout]);
    const otherCompiled = useMemo(() => {
      const out = {};
      openDocIds.forEach((docId) => {
        if (docId === active) return;
        try {
          if (docId[0] === '@') { const d = extDocs.current[docId]; if (d && (d.source || '').length < 600000) out[docId] = window.LatexEngine.process(d.source, d.files || {}); }
          else if (files[docId] && files[docId].type === 'tex' && (files[docId].content || '').length < 600000) out[docId] = window.LatexEngine.process(files[docId].content, files);
        } catch (e) { }
      });
      return out;
    }, [openDocIds, files, extTick, active]);
    const getCompiled = useCallback((docId) => docId === active ? compiled : otherCompiled[docId], [active, compiled, otherCompiled]);

    /* ---- real-TeX compile (in-browser pdfTeX → PDF) for 'compiled' panes — hybrid Version B ----
       Default: window.AloudTeX.compile() (SwiftLaTeX WASM + TeXlyre packages, GitHub-Pages-native).
       Exact:   window.AloudTeX.compileExact() → external TeX Live 2026 API (byte-identical). */
    const [pdfCompiled, setPdfCompiled] = useState({});
    const pdfCompiledRef = useRef(pdfCompiled); pdfCompiledRef.current = pdfCompiled;
    const pdfCompileTimers = useRef({});
    const assembleTexFiles = useCallback(async (docId) => {
      let main = (docId && docId[0] !== '@' && files[docId] && files[docId].type === 'tex') ? docId : active;
      // Compile the real ROOT document (the one with \documentclass) even if the pane is bound to a
      // chapter/fragment — a fragment alone produces "No pages of output" (status -253) in real pdfTeX.
      const roots = Object.keys(files).filter((p) => files[p] && files[p].type === 'tex' && /\\documentclass/.test(files[p].content || ''));
      if (roots.length && roots.indexOf(main) < 0) main = (roots.indexOf(active) >= 0 ? active : roots[0]);
      // Rebase to the main file's directory so the engine compiles from the root: the SwiftLaTeX worker
      // chdir's to /work and reads "<mainfile-without-.tex>.pdf", so a main .tex inside a subfolder (e.g.
      // an uploaded "Overleaf bundle" under a prefix) yields status -253 even for a valid document.
      const mainDir = main.indexOf('/') >= 0 ? main.slice(0, main.lastIndexOf('/') + 1) : '';
      const rebase = (p) => (mainDir && p.indexOf(mainDir) === 0) ? p.slice(mainDir.length) : p;
      const out = [];
      try { if (window.PRUploads && window.PRUploads.ensureSigned) await window.PRUploads.ensureSigned(files); } catch (e) { }
      // collect image paths the .tex actually references (so MemFS paths match \includegraphics)
      const mainText = (files[main] && files[main].content) || '';
      const refPaths = []; let mm; const reGI = /\\includegraphics\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g;
      while ((mm = reGI.exec(mainText))) refPaths.push(mm[1].trim());
      const baseNoExt = (p) => { const b = (p || '').split('/').pop(); return b.replace(/\.[^.]+$/, ''); };
      const targetsFor = (keyPath) => {
        const targets = [keyPath]; const kb = baseNoExt(keyPath);
        const ext = (keyPath.match(/\.[a-z0-9]+$/i) || [''])[0];
        refPaths.forEach((rp) => {
          let t = rp; if (!/\.[a-z0-9]+$/i.test(t)) t = t + ext;   // graphicx may omit the extension
          if (t !== keyPath && baseNoExt(t) === kb && targets.indexOf(t) < 0) targets.push(t);
        });
        return targets;
      };
      const pushBinary = (path, bytes) => { targetsFor(path).forEach((t) => out.push({ path: t, bytes: bytes })); };

      Object.keys(files).forEach((path) => {
        const f = files[path]; if (!f) return;
        const isText = f.type === 'tex' || f.type === 'bib' || /\.(bbl|cls|sty|def|clo|cfg|tex|bib|ltx)$/i.test(path);
        if (isText) { out.push({ path: rebase(path), text: f.content != null ? f.content : '' }); return; }
        if ((f.type === 'image' || f.type === 'pdf') && f.dataURL) {
          try { pushBinary(rebase(path), dataURLToBytes(f.dataURL)); } catch (e) { }
        }
      });
      // binaries that need fetching: bundled assets (.src), or cloud signed URLs (.storagePath)
      const toFetch = Object.keys(files).filter((p) => {
        const f = files[p]; if (!f || (f.type !== 'image' && f.type !== 'pdf') || f.dataURL) return false;
        return f.src || (f.storagePath && window.PR_SIGNED && window.PR_SIGNED[f.storagePath]);
      });
      await Promise.all(toFetch.map(async (p) => {
        const f = files[p]; const u = f.src || (window.PR_SIGNED && window.PR_SIGNED[f.storagePath]);
        try { const r = await fetch(u); pushBinary(rebase(p), new Uint8Array(await r.arrayBuffer())); } catch (e) { }
      }));
      return { mainFile: rebase(main), files: out };
    }, [files, active]);

    const requestCompile = useCallback((docId, force) => {
      docId = docId || active;
      if (!docId || !window.AloudTeX) return;
      const first = force || !pdfCompiledRef.current[docId];
      clearTimeout(pdfCompileTimers.current[docId]);
      // Flip the UI synchronously the instant this runs — otherwise busy is only set deep inside run()
      // (after the setTimeout + await assembleTexFiles), so the button felt inert for hundreds of ms.
      setPdfCompiled((s) => ({ ...s, [docId]: { ...(s[docId] || {}), err: null, pending: !force, busy: force ? true : (s[docId] || {}).busy, phase: force ? 'waiting to compile…' : (s[docId] || {}).phase } }));
      const run = async () => {
        if (window.AloudTeX.isBusy && window.AloudTeX.isBusy()) { pdfCompileTimers.current[docId] = setTimeout(run, 700); return; }
        let input;
        try { input = await assembleTexFiles(docId); }
        catch (e) { setPdfCompiled((s) => ({ ...s, [docId]: { ...(s[docId] || {}), busy: false, pending: false, phase: null, err: String((e && e.message) || e), mode: 'browser', ts: Date.now() } })); return; }
        const C = window.PRPdfCache;
        const hash = C ? C.hashOf(input, 'browser') : null;
        const cur = pdfCompiledRef.current[docId];
        // (1) content unchanged since the last browser compile → keep the current PDF, skip recompiling
        if (!force && hash && cur && cur.hash === hash && cur.pdf) { setPdfCompiled((s) => ({ ...s, [docId]: { ...(s[docId] || {}), busy: false, pending: false, phase: null } })); return; }
        setPdfCompiled((s) => ({ ...s, [docId]: { ...(s[docId] || {}), busy: true, pending: false, phase: 'preparing compile…', err: null } }));
        // (2) persistent cache hit → load the stored PDF instantly, no compile (but never replace a
        // current exact-mode "Pontos PDF" with a cached browser PDF unless the user forced it)
        if (!force && hash && C && !(cur && cur.mode === 'exact')) {
          try { const cached = await C.get(hash); if (cached && cached.pdf) { setPdfCompiled((s) => ({ ...s, [docId]: { busy: false, pending: false, phase: null, pdf: cached.pdf, pages: cached.pages, status: 0, mode: 'browser', err: null, hash: hash, cached: true, ts: Date.now() } })); return; } } catch (e) { }
        }
        // (3) compile, then remember the result by content hash
        try {
          // Draft mode: a quick 1-pass redraw while typing (reuses the .aux the singleton engine kept from the
          // last full compile this session, so cross-refs stay correct); first compile + explicit Recompile run
          // the full 3 passes. `compiledInEngine` guards the page-refresh case (cache-loaded PDF, fresh engine,
          // no .aux yet) — a draft is only safe once a full compile has actually run in this engine session.
          const draft = !force && !!(cur && cur.pdf && cur.compiledInEngine);
          const r = await window.AloudTeX.compile({ mainFile: input.mainFile, files: input.files, passes: draft ? 1 : 3, onProgress: (m) => setPdfCompiled((s) => ({ ...s, [docId]: { ...(s[docId] || {}), phase: (draft ? 'draft · ' : '') + m } })) });
          if (r.ok && hash && C && !draft) { try { C.put(hash, { pdf: r.pdf, pages: r.pages, ts: Date.now() }); } catch (e) { } }   // only cache full-quality compiles
          setPdfCompiled((s) => ({ ...s, [docId]: { busy: false, pending: false, phase: null, pdf: r.ok ? r.pdf : ((s[docId] || {}).pdf || null), log: r.log, pages: r.pages, status: r.status, mode: 'browser', draft: r.ok ? draft : ((s[docId] || {}).draft), compiledInEngine: r.ok ? true : ((s[docId] || {}).compiledInEngine), err: r.ok ? null : (r.reason || ('Compile failed (status ' + r.status + ')')), ms: r.ms, hash: r.ok ? hash : ((s[docId] || {}).hash), ts: Date.now() } }));
        } catch (e) {
          setPdfCompiled((s) => ({ ...s, [docId]: { ...(s[docId] || {}), busy: false, pending: false, phase: null, err: String((e && e.message) || e), mode: 'browser', ts: Date.now() } }));
        }
      };
      pdfCompileTimers.current[docId] = setTimeout(run, first ? 0 : 1300);
    }, [assembleTexFiles, active]);

    const onCompileExact = useCallback(async (docId) => {
      docId = docId || active;
      if (!window.AloudTeX) return;
      if (!window.ALOUD_TEX_EXACT_ENDPOINT) { window.PRUI.toast('The byte-identical "Exact PDF" needs an external TeX Live 2026 compile API.\nSet: window.ALOUD_TEX_EXACT_ENDPOINT = "https://…".', { kind: 'error' }); return; }
      setPdfCompiled((s) => ({ ...s, [docId]: { ...(s[docId] || {}), busy: true, err: null } }));
      try {
        const input = await assembleTexFiles(docId);
        const r = await window.AloudTeX.compileExact({ mainFile: input.mainFile, files: input.files });
        setPdfCompiled((s) => ({ ...s, [docId]: { busy: false, pdf: r.pdf, pages: r.pages, status: 0, mode: 'exact', err: null, ts: Date.now() } }));
      } catch (e) {
        setPdfCompiled((s) => ({ ...s, [docId]: { ...(s[docId] || {}), busy: false, err: String((e && e.message) || e), ts: Date.now() } }));
      }
    }, [assembleTexFiles, active]);

    const getCompiledPdf = useCallback((docId) => pdfCompiled[docId] || null, [pdfCompiled]);

    // ── download the rendered (real TeX → PDF) document ──
    const doDownloadPdf = (bytes, name) => {
      try {
        const blob = new Blob([bytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      } catch (e) { window.PRUI.toast('Could not download the PDF: ' + e, { kind: 'error' }); }
    };
    const pdfName = useCallback((docId) => ((bn(docId) || 'document').replace(/\.[^.]+$/, '') || 'document') + '.pdf', []);
    const downloadPdf = useCallback(() => {
      const st = pdfCompiledRef.current[active];
      if (st && st.pdf) { doDownloadPdf(st.pdf, pdfName(active)); return; }   // already compiled → instant
      if (!window.AloudTeX) { window.PRUI.toast('The PDF engine is still loading — try again in a moment.', { kind: 'error' }); return; }
      window.PRUI.toast('Compiling the rendered PDF — the download starts when it is ready…');
      setPdfWantDl(true);
      requestCompile(active, true);
    }, [active, requestCompile, pdfName]);
    // once a pending "download" compile lands, push the file
    useEffect(() => {
      if (!pdfWantDl) return;
      const st = pdfCompiled[active];
      if (st && st.pdf && !st.busy && !st.pending) { setPdfWantDl(false); doDownloadPdf(st.pdf, pdfName(active)); }
      else if (st && st.err && !st.busy) { setPdfWantDl(false); window.PRUI.toast('Compile failed: ' + st.err, { kind: 'error' }); }
    }, [pdfCompiled, active, pdfWantDl, pdfName]);

    /* ---- live manuscript KPIs (auto-tracked format compliance vs the template's limits) ---- */
    const kpiPages = (pdfCompiled[active] && pdfCompiled[active].pages) || null;
    const kpiMetrics = useMemo(() => {
      if (!window.PRMetrics) return null;
      try { return window.PRMetrics.compute(source, files, { pages: kpiPages, limits: projMeta.limits }); } catch (e) { return null; }
    }, [source, files, kpiPages, projMeta.limits]);
    const setSubmissionStatus = useCallback((status) => {
      if (!projectId || !window.PRStore) return;
      const sub = Object.assign({}, projMeta.submission || {}, { status: status, updatedAt: Date.now() });
      if (status === 'submitted' && !sub.submittedAt) sub.submittedAt = Date.now();
      const p = window.PRStore.get(projectId); if (p) { p.submission = sub; window.PRStore.save(p); }
      setProjMeta((m) => Object.assign({}, m, { submission: sub }));
    }, [projectId, projMeta.submission]);

    /* ---- voices ---- */
    useEffect(() => {
      function refresh() {
        const v = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
        setVoices(v);
        if (!voiceRef.current && v.length) {
          const en = v.find((x) => /en[-_]/i.test(x.lang) && /female|samantha|google us|zira|jenny|aria/i.test(x.name)) || v.find((x) => /en[-_]/i.test(x.lang)) || v[0];
          if (en) { setVoiceURI(en.voiceURI); voiceRef.current = en.voiceURI; }
        }
      }
      refresh();
      if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = refresh;
      return () => { if (window.speechSynthesis) window.speechSynthesis.cancel(); };
    }, []);

    /* ---- sign cloud-stored binaries, then recompile so images resolve ---- */
    useEffect(() => {
      if (window.PRUploads && window.PRUploads.enabled) {
        window.PRUploads.ensureSigned(files).then((changed) => {
          if (changed) { setSignTick((t) => t + 1); try { setCompiled(window.LatexEngine.process((files[active] && files[active].content) || '', files)); } catch (e) { } }
        });
      }
    }, [files, active]);

    /* ---- debounced recompile (gated to manual mode) ---- */
    const compileTimer = useRef(null);
    useEffect(() => {
      if (t.renderMode === 'manual') { setRenderStale(true); return; }
      clearTimeout(compileTimer.current);
      compileTimer.current = setTimeout(() => {
        const c = window.LatexEngine.process(source, files);
        setCompiled(c);
        setIdx(clamp(idxRef.current || 0, 0, Math.max(0, c.sentences.length - 1)));
      }, 220);
      return () => clearTimeout(compileTimer.current);
    }, [source, t.renderMode]);

    /* ---- render options (section numbering + citation style) ---- */
    useEffect(() => {
      window.PR_RENDEROPTS = { numberSections: t.numberSections !== false, citeStyle: (t.citeStyle === 'author-year' ? 'authoryear' : 'numeric') };
      try { setCompiled(window.LatexEngine.process(source, files)); } catch (e) { }
    }, [t.numberSections, t.citeStyle]);

    /* ---- manual render (Cmd/Ctrl+Enter or the Render button) ---- */
    const renderNow = () => { try { const c = window.LatexEngine.process(source, files); setCompiled(c); setRenderStale(false); setIdx(clamp(idxRef.current || 0, 0, Math.max(0, c.sentences.length - 1))); } catch (e) { } };
    useEffect(() => {
      const onKey = (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); renderNow(); } };
      window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
    }, [source, files]);

    /* recompile immediately when switching files; restore that document's reading position */
    useEffect(() => {
      const c = window.LatexEngine.process(source, files); setCompiled(c);
      const saved = clamp(idxByDoc.current[active] || 0, 0, Math.max(0, c.sentences.length - 1));
      if (window.speechSynthesis) window.speechSynthesis.cancel();
      setIdx(saved); setStatus('idle');
    }, [active]);
    useEffect(() => { idxByDoc.current[active] = idx; }, [idx]);
    /* persist layout per user+project */
    useEffect(() => { if (window.PRStore && projectId0) window.PRStore.setPrefs({ ['layout:' + projectId0]: layout }); }, [layout]);

    /* ---- persistence ---- */
    useEffect(() => {
      if (window.PRStore) window.PRStore.setPrefs({ rate, voiceURI, engine: voice.engine, elevenVoice: voice.elevenVoice, model: voice.model, stability: voice.stability, similarity: voice.similarity });
      if (init.projectId && window.PRStore) {
        const p = window.PRStore.get(init.projectId);
        if (p) { p.files = files; p.order = order; p.active = active; p.folders = folders; p.idx = idx; window.PRStore.save(p); }
      }
    }, [files, order, active, folders, idx, rate, voiceURI, voice]);

    /* ---- collaboration effects ---- */
    const collabSigRef = useRef('');
    const refreshCollab = useCallback(() => {
      if (!projectId || !window.PRStore) return;
      const p = window.PRStore.get(projectId); if (!p) return;
      // a hydrate/poll fires refreshCollab even with no remote change — skip the state update (and the
      // annotation DOM rebuild) unless something the collab UI shows actually changed.
      const sig = JSON.stringify(p.annotations || []) + '|' + ((p.versions || []).length) + '|' + JSON.stringify(p.members || []) + '|' + ((p.activity || []).length) + '|' + JSON.stringify(p.link || null) + '|' + JSON.stringify(p.submission || null);
      if (sig === collabSigRef.current) return;
      collabSigRef.current = sig;
      setAnnotations(p.annotations); setVersions(p.versions);
      setProjMeta({ members: p.members, ownerId: p.ownerId, link: p.link, activity: p.activity, templateId: p.templateId, journalMeta: p.journalMeta, limits: p.limits, journal: p.journal, submission: p.submission, tts: window.PRStore.ttsForProject ? window.PRStore.ttsForProject(me.id, projectId) : null });
    }, [projectId]);
    useEffect(() => { if (window.PRStore) return window.PRStore.subscribe(refreshCollab); }, [refreshCollab]);
    useEffect(() => { refreshCollab(); }, []); // re-sync annotations/versions from storage after mount
    // live per-thesis narration counter: a real ElevenLabs charge fires 'pr-tts' (same-tab notify() doesn't)
    useEffect(() => {
      const h = () => { if (window.PRStore && window.PRStore.ttsForProject) setProjMeta((m) => Object.assign({}, m, { tts: window.PRStore.ttsForProject(me.id, projectId) })); };
      window.addEventListener('pr-tts', h); return () => window.removeEventListener('pr-tts', h);
    }, []);
    useEffect(() => {
      if (!projectId || !window.PRAuth) return;
      const pr = window.PRAuth.startPresence(projectId, me.id); pr.on(setPeers); return pr.stop;
    }, [projectId]);
    useEffect(() => {
      if (!projectId || !window.PRStore) return;
      const r = window.PRStore.getReading(me.id, projectId);
      if (r && r.idx > 0) setResume(r.idx + 1);
    }, []);
    useEffect(() => { if (projectId && window.PRStore) window.PRStore.setReading(me.id, projectId, idx); }, [idx]);
    useEffect(() => { const c = () => { setAcctOpen(false); setVoiceOpen(false); setDiagOpen(false); }; window.addEventListener('click', c); return () => window.removeEventListener('click', c); }, []);

    /* ---- speech ---- */
    const stopAudio = useCallback(() => {
      if (audioRef.current) { try { audioRef.current.pause(); } catch (e) { } audioRef.current.onended = null; audioRef.current.onerror = null; audioRef.current = null; }
    }, []);

    const speakIndex = useCallback((i) => {
      const sents = sentsRef.current;
      const cfg = voiceCfgRef.current || {};
      if (window.speechSynthesis) window.speechSynthesis.cancel();
      stopAudio();
      if (i < 0) i = 0;
      if (i >= sents.length) { setIdx(sents.length ? sents.length - 1 : 0); setStatus('idle'); return; }
      setIdx(i); setStatus('playing');
      const mySeq = ++seqRef.current;

      /* ElevenLabs selected but no API key yet — guide the user to add it instead of silently
         falling back to the browser voice. The key is entered once in Voice settings (per browser). */
      if (cfg.engine === 'eleven' && (!window.PREleven || !window.PREleven.hasKey())) {
        setElevenBusy(false);
        setElevenErr('Add your ElevenLabs API key in Voice settings (the gear ▾) to read aloud with ElevenLabs.');
        setVoiceOpen(true); setStatus('paused');
        return;
      }

      /* ElevenLabs path — fetch (or reuse cached) audio for this sentence, then play it. */
      if (cfg.engine === 'eleven' && window.PREleven && window.PREleven.hasKey()) {
        setElevenErr(null);
        if (!window.PREleven.cached(sents[i].text, cfg)) setElevenBusy(true);
        window.PREleven.getAudio(sents[i].text, cfg, meRef.current.id, projectId).then((url) => {
          if (seqRef.current !== mySeq) return;
          setElevenBusy(false);
          if (statusRef.current !== 'playing') return;
          const a = new Audio(url); audioRef.current = a;
          a.playbackRate = rateRef.current || 1;
          a.onended = () => { if (seqRef.current !== mySeq || statusRef.current !== 'playing') return; speakIndex(idxRef.current + 1); };
          a.onerror = () => { if (seqRef.current === mySeq) { setElevenErr('Playback failed.'); setStatus('paused'); } };
          a.play().catch(() => { });
          /* prefetch the next 1–2 sentences for gapless playback */
          window.PREleven.prefetch([sents[i + 1], sents[i + 2]], cfg, meRef.current.id, projectId);
        }).catch((err) => {
          if (seqRef.current !== mySeq) return;
          setElevenBusy(false);
          setElevenErr((err && err.message) || 'Synthesis failed.');
          setStatus('paused');
        });
        return;
      }

      /* Browser speech-synthesis path. */
      const synth = window.speechSynthesis; if (!synth) return;
      const u = new SpeechSynthesisUtterance(window.PREleven && window.PREleven.spoken ? window.PREleven.spoken(sents[i].text) : sents[i].text);
      u.rate = rateRef.current; u.pitch = 1;
      if (voiceRef.current) { const v = synth.getVoices().find((x) => x.voiceURI === voiceRef.current); if (v) { u.voice = v; u.lang = v.lang; } }
      u.onend = () => { if (seqRef.current !== mySeq || statusRef.current !== 'playing') return; speakIndex(idxRef.current + 1); };
      u.onerror = () => { };
      synth.speak(u);
    }, [stopAudio]);

    useEffect(() => () => stopAudio(), [stopAudio]);

    const play = useCallback(() => {
      setEditPaused(false);
      if (statusRef.current === 'playing') {
        if (window.speechSynthesis) window.speechSynthesis.cancel();
        if (audioRef.current) { try { audioRef.current.pause(); } catch (e) { } }
        setStatus('paused'); return;
      }
      /* resume a paused ElevenLabs sentence from where it stopped */
      if (statusRef.current === 'paused' && audioRef.current && voiceCfgRef.current.engine === 'eleven') {
        setStatus('playing'); audioRef.current.play().catch(() => { }); return;
      }
      speakIndex(idxRef.current || 0);
    }, [speakIndex]);
    const stop = useCallback(() => {
      setEditPaused(false);
      if (window.speechSynthesis) window.speechSynthesis.cancel();
      seqRef.current++; stopAudio(); setElevenBusy(false); setElevenErr(null);
      setStatus('idle'); setIdx(0);
    }, [stopAudio]);
    const step = useCallback((d) => {
      const ni = clamp(idxRef.current + d, 0, Math.max(0, sentsRef.current.length - 1));
      if (statusRef.current === 'playing') speakIndex(ni); else setIdx(ni);
    }, [speakIndex]);
    const seekTo = useCallback((i) => {
      const ni = clamp(i, 0, Math.max(0, sentsRef.current.length - 1));
      if (statusRef.current === 'playing') speakIndex(ni); else setIdx(ni);
    }, [speakIndex]);

    // apply rate live to ElevenLabs audio; restart browser utterance on rate/voice change mid-play
    useEffect(() => {
      if (audioRef.current) audioRef.current.playbackRate = rate;
      if (statusRef.current === 'playing' && voiceCfgRef.current.engine !== 'eleven') speakIndex(idxRef.current);
    }, [rate]);
    useEffect(() => { if (statusRef.current === 'playing' && voiceCfgRef.current.engine !== 'eleven') speakIndex(idxRef.current); }, [voiceURI]);
    // restart current sentence when the engine or ElevenLabs voice/model changes mid-play
    useEffect(() => { if (statusRef.current === 'playing') speakIndex(idxRef.current); }, [voice.engine]);
    useEffect(() => { if (statusRef.current === 'playing' && voiceCfgRef.current.engine === 'eleven') speakIndex(idxRef.current); }, [voice.elevenVoice, voice.model]);

    /* keyboard: space = play/pause when not typing in editor */
    useEffect(() => {
      function onKey(e) {
        if (e.target && (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
        if (e.code === 'Space') { e.preventDefault(); play(); }
        else if (e.key === 'ArrowRight' && e.altKey) { e.preventDefault(); step(1); }
        else if (e.key === 'ArrowLeft' && e.altKey) { e.preventDefault(); step(-1); }
      }
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [play, step]);

    /* keyboard: Cmd/Ctrl+K toggles the command palette */
    useEffect(() => {
      function onKey(e) {
        if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); setCmdk((o) => !o); }
      }
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, []);

    /* ---- caret in editor -> set/seek sentence ---- */
    const sentAt = useCallback((off) => {
      const sents = sentsRef.current; if (!sents.length) return -1;
      let found = -1;
      for (let k = 0; k < sents.length; k++) { if (off >= sents[k].start && off <= sents[k].end) { found = k; break; } if (sents[k].start > off) { found = Math.max(0, k - 1); break; } }
      return found < 0 ? sents.length - 1 : found;
    }, []);
    const onCaret = useCallback((off) => { const k = sentAt(off); if (k >= 0) seekTo(k); }, [seekTo, sentAt]);

    // imperative preview scroll (used on an explicit editor click) — scrolls every preview of the active doc
    const scrollPreviewTo = useCallback((sentId) => {
      Array.from(document.querySelectorAll('.preview-scroll')).filter((r) => r.getAttribute('data-doc') === active).forEach((root) => {
        const el = root.querySelector('.sent[data-sid="' + sentId + '"]'); if (!el) return;
        const cr = root.getBoundingClientRect(), er = el.getBoundingClientRect();
        const target = root.scrollTop + (er.top - cr.top) - root.clientHeight / 2 + er.height / 2;
        progScrollRef.current = Date.now() + 900;
        root.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
      });
    }, [active]);
    // briefly pulse a sentence (used by the Review "Jump" so the target is clearly visible)
    const flashSentence = useCallback((docId, sentId) => {
      if (sentId == null) return;
      setTimeout(() => {
        document.querySelectorAll('.preview-scroll[data-doc="' + docId + '"] .sent[data-sid="' + sentId + '"]').forEach((el) => {
          el.classList.remove('sent-flash'); void el.offsetWidth; el.classList.add('sent-flash');
          setTimeout(() => el.classList.remove('sent-flash'), 1700);
        });
      }, 70);
    }, []);
    // editor click -> sync the preview to the clicked sentence
    const onEditorJump = useCallback((off) => {
      const k = sentAt(off); if (k < 0) return;
      seekTo(k);
      const sents = sentsRef.current;
      if (sents[k]) requestAnimationFrame(() => scrollPreviewTo(sents[k].id));
    }, [seekTo, sentAt, scrollPreviewTo]);

    // jump the source caret + reading + preview to a source offset (used by the command palette / outline)
    // forward-preferring resolution: when off lands in a gap (e.g. a \section{} heading, which is not a
    // body sentence), target the FIRST sentence after it — the section's content — not the tail of the
    // previous section. When off is inside a sentence (consistency-occurrence jumps), the container wins.
    const gotoOffset = useCallback((off) => {
      if (files[active] && files[active].type === 'tex') setSelectReq({ start: off, end: off, nonce: Date.now() });
      const sents = sentsRef.current; if (!sents.length) return;
      let k = -1;
      for (let i = 0; i < sents.length; i++) { if (off >= sents[i].start && off <= sents[i].end) { k = i; break; } if (sents[i].start > off) { k = i; break; } }
      if (k < 0) k = sents.length - 1;
      seekTo(k); const s = sents[k]; if (s) requestAnimationFrame(() => scrollPreviewTo(s.id));
    }, [active, files, seekTo, scrollPreviewTo]);

    // open a document in the editor: rebind the source/preview/compiled panes that currently follow the
    // active doc to the new one, then make it active (same logic the FilePanel uses on click).
    const openDoc = useCallback((p) => {
      if (!p || !docExists(p) || p === active) return;
      const old = active, W = window.WS;
      setLayout((lay) => {
        const SK = { source: 1, preview: 1, compiled: 1 };
        const followers = W.allPanes(lay).filter((pane) => SK[pane.kind] && pane.docId === old);
        let r = lay;
        if (followers.length) followers.forEach((pane) => { r = W.patchPane(r, pane.id, { docId: p }); });
        else { const fp = W.allPanes(lay).find((pane) => SK[pane.kind]); if (fp) r = W.patchPane(r, fp.id, { docId: p }); }
        return r;
      });
      setActive(p);
    }, [active, docExists]);

    // jump to a (file, offset) — like gotoOffset but cross-file aware (a reference hit may live in another
    // .tex chapter or in a .bib/.bbl that isn't the open doc). Rebinds the editor pane then selects.
    const gotoRef = useCallback((file, off) => {
      if (!file || !files[file]) return;
      if (file === active) {
        if (files[active].type === 'tex') return gotoOffset(off);
        setSelectReq({ start: off, end: off, nonce: Date.now() }); return;                // active .bib/.bbl: select in code only
      }
      if (files[file].type === 'tex') {
        try {
          const comp = window.LatexEngine.process(getSource(file), files); const sents = comp.sentences || [];
          let k = -1; for (let i = 0; i < sents.length; i++) { if (off >= sents[i].start && off <= sents[i].end) { k = i; break; } if (sents[i].start > off) { k = i; break; } }
          idxByDoc.current[file] = Math.max(0, k < 0 ? sents.length - 1 : k);
        } catch (e) { }
      }
      openDoc(file); setSelectReq({ start: off, end: off, nonce: Date.now() });
    }, [active, files, gotoOffset, getSource, openDoc]);

    // DOI → BibTeX: fetch via Crossref (cached), dedup the key against existing .bib content, append to the
    // chosen (or first / new) .bib file. Returns {key,path,title,year}. Throws an actionable Error on failure.
    const onAddDoi = useCallback((rawDoi) => {
      if (!canEdit) return Promise.reject(new Error('You have read-only access to this project.'));
      if (!window.PRDoi) return Promise.reject(new Error('DOI lookup is unavailable.'));
      const esc = (k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const suf = (n) => { let s = ''; n--; do { s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0); return s; }; // a..z, aa, ab… (never a non-letter)
      return window.PRDoi.get(rawDoi).then((res) => {
        // dedup against the freshest committed files (read from the store, which the autosave keeps current)
        // rather than this callback's closure, so a concurrent edit during the fetch can't cause a duplicate
        // @key. Disambiguate with an alphabetic suffix that always stays in [a-z].
        let cur = {}; try { cur = (window.PRStore.get(projectId) || {}).files || {}; } catch (e) { }
        const bibOf = (mp) => Object.keys(mp).filter((p) => mp[p] && mp[p].type === 'bib');
        const allBib = bibOf(cur).map((p) => cur[p].content || '').join('\n');
        const base = res.key || 'ref'; let k = base, n = 0;
        while (new RegExp('@\\w+\\s*\\{\\s*' + esc(k) + '\\s*,').test(allBib)) { n++; k = base + suf(n); }
        let entry = res.bibtex; if (k !== base) entry = entry.replace('{' + base + ',', '{' + k + ',');
        const path = bibOf(cur)[0] || 'references.bib';
        setFiles((f) => { const tgt = f[path] || { type: 'bib', content: '' }; const ex = tgt.content || ''; const sep = ex ? (/\n\s*$/.test(ex) ? '\n' : '\n\n') : ''; return { ...f, [path]: { ...tgt, type: 'bib', content: ex + sep + entry } }; });
        setOrder((o) => o.includes(path) ? o : [...o, path]);
        try { window.PRStore.logActivity && window.PRStore.logActivity(projectId, me.id, 'added reference', k); } catch (e) { }
        return { key: k, path, title: res.title, year: res.year, renamed: k !== base };
      });
    }, [canEdit, projectId, me]);

    // document outline (chapters/sections + figures/tables) parsed from the active source
    const outline = useMemo(() => {
      const v = source || '', items = [];
      let m, re = /\\(part|chapter|section|subsection|subsubsection)\*?\s*\{/g;
      while ((m = re.exec(v))) {
        let i = m.index + m[0].length, depth = 1, title = '';
        for (; i < v.length && depth > 0; i++) { const c = v[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (!depth) break; } if (depth > 0) title += c; }
        items.push({ kind: m[1], title: title.replace(/\\[a-zA-Z]+/g, '').replace(/[{}]/g, '').trim() || '(untitled)', off: m.index });
      }
      let re2 = /\\begin\{(figure|table)\*?\}/g;
      while ((m = re2.exec(v))) {
        const seg = v.slice(m.index, m.index + 500);
        const cap = (seg.match(/\\caption\{([^}]*)\}/) || [])[1];
        const lab = (seg.match(/\\label\{([^}]*)\}/) || [])[1];
        items.push({ kind: m[1], title: (cap || lab || m[1]).trim(), off: m.index });
      }
      return items.sort((a, b) => a.off - b.off);
    }, [source]);

    // number/claims consistency: metric-like labels that appear with >1 distinct value (audit candidates)
    const consistency = useMemo(() => { try { return window.PRConsistency ? window.PRConsistency.scan(source) : []; } catch (e) { return []; } }, [source]);
    const consistencyConflicts = useMemo(() => consistency.filter((g) => g.distinct > 1).length, [consistency]);

    /* ---- spell check (Hunspell WASM in a worker; HU+EN, LaTeX-aware) ---- */
    // detectLang only runs while spell-check is on (it's off by default) — saves a regex sweep per keystroke.
    const spellLang = useMemo(() => spellLangPref || ((spellOn && window.PRSpell) ? window.PRSpell.detectLang(source) : 'en'), [spellLangPref, source, spellOn]);
    const spellAvailable = !!window.PRSpell;
    const [spellRetry, setSpellRetry] = useState(0);
    useEffect(() => { setSpellResult(null); }, [active]); // drop another doc's misspellings instantly on switch (don't paint them while the new scan is pending)
    // re-scan the active doc (debounced) whenever it, the language, or the dictionaries change
    useEffect(() => {
      if (!spellOn || !window.PRSpell || !(files[active] && files[active].type === 'tex')) { setSpellResult(null); setSpellErr(null); setSpellBusy(false); return; }
      let dead = false; setSpellBusy(true); const doc = active;
      const h = setTimeout(() => {
        window.PRSpell.scan(source, spellLang, { personal: spellPersonal, ignore: spellIgnore })
          .then((r) => { if (!dead) { r.doc = doc; setSpellResult(r); setSpellErr(null); setSpellBusy(false); } })
          .catch((e) => { if (!dead) { setSpellErr(String((e && e.message) || e)); setSpellResult(null); setSpellBusy(false); } });
      }, 650);
      return () => { dead = true; clearTimeout(h); };
    }, [spellOn, source, active, spellLang, spellPersonal, spellIgnore, spellRetry]);
    const spellCount = (spellResult && spellResult.misspelled.length) || 0;
    // squiggle marks for the active doc (capped per word so a 99× proper noun doesn't flood the layer).
    // gated on spellResult.doc so a stale scan for a different document can never paint onto this one.
    const spellMarksFor = useCallback((docId) => {
      if (!spellOn || !spellResult || docId !== active || spellResult.doc !== active) return null;
      const out = [];
      spellResult.misspelled.forEach((m) => m.offsets.slice(0, 8).forEach((o) => out.push({ s: o.start, e: o.end, cls: 'sp-err' })));
      return out;
    }, [spellOn, spellResult, active]);
    const onSpellSuggest = useCallback((word) => (window.PRSpell ? window.PRSpell.suggest(spellLang, word) : Promise.resolve([])), [spellLang]);
    const onSpellAddDict = useCallback((word) => {
      if (!word) return; const lw = String(word);
      setSpellPersonal((p) => { if (p.indexOf(lw) >= 0) return p; const np = p.concat([lw]); try { window.PRStore.setPrefs({ spellDict: np }); } catch (e) { } return np; });
    }, []);
    const onSpellIgnore = useCallback((word) => { if (word) setSpellIgnore((g) => g.indexOf(word) >= 0 ? g : g.concat([word])); }, []);
    const onSpellUndoDict = useCallback((word) => {
      setSpellPersonal((p) => { const np = p.filter((w) => w !== word); try { window.PRStore.setPrefs({ spellDict: np }); } catch (e) { } return np; });
    }, []);
    // replace every detected occurrence of a misspelled word with a chosen suggestion. Applies only at the
    // offsets the scan found (and re-verifies the slice), so it never touches a same-looking token in a command.
    const onSpellReplaceAll = useCallback((word, replacement) => {
      if (!canEdit || replacement == null || !spellResult) return;
      const m = spellResult.misspelled.find((x) => x.word === word); if (!m) return;
      setFiles((f) => {
        const cur = f[active]; if (!cur || typeof cur.content !== 'string') return f;
        let nv = cur.content;
        m.offsets.slice().sort((a, b) => b.start - a.start).forEach((o) => { if (nv.slice(o.start, o.end) === word) nv = nv.slice(0, o.start) + replacement + nv.slice(o.end); });
        if (nv === cur.content) return f;
        editedRef.current = true;
        return { ...f, [active]: { ...cur, content: nv } };
      });
    }, [canEdit, active, spellResult]);

    // reference / citation manager: cross-checks \cite usage vs .bib entries vs .bbl (whole project, all files)
    const refs = useMemo(() => { try { return window.PRRefs ? window.PRRefs.scan(files) : null; } catch (e) { return null; } }, [files]);
    const refsIssues = useMemo(() => { try { return window.PRRefs ? window.PRRefs.issueCount(refs) : 0; } catch (e) { return 0; } }, [refs]);
    // .bib-only derivations for autocomplete (keys + "Title (Year)" hints): keyed on a signature of just the
    // .bib files so editing prose in a .tex does NOT re-run them or churn the editor's props every keystroke.
    const bibSig = useMemo(() => Object.keys(files).filter((p) => files[p] && files[p].type === 'bib').sort().map((p) => p + '␟' + (files[p].content || '')).join('␞'), [files]);
    const bibEntries = useMemo(() => { try { return window.PRRefs ? window.PRRefs.entries(files) : []; } catch (e) { return []; } }, [bibSig]); // eslint-disable-line react-hooks/exhaustive-deps
    const bibKeys = useMemo(() => bibEntries.map((e) => e.key), [bibEntries]);
    const bibMeta = useMemo(() => { const m = {}; bibEntries.forEach((e) => { if (!m[e.key] && (e.title || e.year)) m[e.key] = (e.title ? e.title.slice(0, 52) : '') + (e.year ? '  (' + e.year + ')' : ''); }); return m; }, [bibEntries]);
    const bibPaths = useMemo(() => Object.keys(files).filter((p) => files[p] && files[p].type === 'bib'), [bibSig]); // eslint-disable-line react-hooks/exhaustive-deps

    /* ---- preview highlight + scroll (across every preview pane bound to the active document) ---- */
    useLayoutEffect(() => {
      const roots = Array.from(document.querySelectorAll('.preview-scroll'));
      roots.forEach((root) => root.querySelectorAll('.sent.reading, .sent.cursor').forEach((el) => el.classList.remove('reading', 'cursor')));
      const sent = compiled.sentences[idx];
      if (!sent) return;
      roots.filter((r) => r.getAttribute('data-doc') === active).forEach((root) => {
        const el = root.querySelector('.sent[data-sid="' + sent.id + '"]');
        if (!el) return;
        el.classList.add(status === 'idle' ? 'cursor' : 'reading');
        // Auto-follow the read sentence — but NOT while the user is manually scrolling (let reading
        // continue in the background for ~5s after a manual scroll instead of yanking them back).
        if (status !== 'idle' && Date.now() - userScrolledRef.current >= 5000) {
          const cr = root.getBoundingClientRect(), er = el.getBoundingClientRect();
          const target = root.scrollTop + (er.top - cr.top) - root.clientHeight / 2 + er.height / 2;
          progScrollRef.current = Date.now() + 900;   // mark this as OUR scroll, not the user's
          root.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
        }
      });
    }, [idx, status, compiled, layout, soloPaneId]);

    /* preview click -> focus its document, then seek to the clicked sentence */
    const onPreviewClick = useCallback((pane, e) => {
      if (e.target.closest('.anno-tag')) return;
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.toString().trim()) return;
      const s = e.target.closest('.sent'); if (!s) return;
      const id = parseInt(s.getAttribute('data-sid'), 10);
      const comp = getCompiled(pane.docId); if (!comp) return;
      const k = comp.sentences.findIndex((x) => x.id === id); if (k < 0) return;
      if (isCurProj(pane.docId) && pane.docId !== active) { idxByDoc.current[pane.docId] = k; setActive(pane.docId); return; }
      if (isCurProj(pane.docId)) {
        if (k !== idxRef.current) seekTo(k);   // clicking the already-current sentence must not restart playback
        const sent = comp.sentences[k];
        // Jump to the EXACT clicked WORD, not just the sentence start. Use the caret position AT the click point
        // (caretRangeFromPoint) so it works in BOTH the preview — where .sent wraps the whole sentence — and the
        // compiled PDF, where .sent is a single word. Then locate that word's occurrence in the sentence's source.
        let off = sent.start;
        if (sent.end > sent.start) {
          const src = getSource(active) || ''; const root = e.target.closest('.ct-scroll, .preview-scroll');
          let cn = null, co = 0;
          try {
            const cr = document.caretRangeFromPoint ? document.caretRangeFromPoint(e.clientX, e.clientY) : null;
            if (cr) { cn = cr.startContainer; co = cr.startOffset; }
            else if (document.caretPositionFromPoint) { const cp = document.caretPositionFromPoint(e.clientX, e.clientY); if (cp) { cn = cp.offsetNode; co = cp.offset; } }
          } catch (_) { }
          if (cn && cn.nodeType === 3 && root && src) {
            const tx = cn.textContent || ''; const isW = (ch) => ch && /[0-9A-Za-zÀ-ɏ]/.test(ch);
            let a = co, b = co; while (a > 0 && isW(tx[a - 1])) a--; while (b < tx.length && isW(tx[b])) b++;
            const word = tx.slice(a, b);
            if (word.length >= 2) {
              // occurrence index: count the word in the sentence's rendered text BEFORE the clicked one
              const spans = root.querySelectorAll('[data-sid="' + id + '"]'); let occ = 1;
              if (spans.length) { try { const rng = document.createRange(); rng.setStartBefore(spans[0]); rng.setEnd(cn, a); const pre = rng.toString().toLowerCase(); const wl0 = word.toLowerCase(); let c = 0, ix = 0; while ((ix = pre.indexOf(wl0, ix)) >= 0) { c++; ix += wl0.length; } occ = c + 1; } catch (_) { } }
              const seg = src.slice(sent.start, sent.end).toLowerCase(); const wl = word.toLowerCase();
              let p = -1, from = 0, found = 0; while (found < occ) { p = seg.indexOf(wl, from); if (p < 0) break; found++; from = p + 1; }
              if (p >= 0) off = sent.start + p;
            }
          }
        }
        if (files[active] && files[active].type === 'tex') setSelectReq({ start: off, end: off, nonce: Date.now() });
      }
    }, [getCompiled, isCurProj, active, files, seekTo, getSource]);

    const onPreviewMouseUp = useCallback((pane, e) => {
      // only a deliberate drag-selection pops the comment/to-do toolbar — not a double/triple-click word select
      if (e && e.detail >= 2) { setSelPaneId(null); setSelQuote(''); return; }
      const root = previewElByPane(pane.id); if (!root) { setSelPaneId(null); return; }
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !sel.toString().trim()) { setSelPaneId(null); setSelQuote(''); return; }
      const range = sel.getRangeAt(0);
      if (!root.contains(range.commonAncestorContainer)) return;
      const comp = getCompiled(pane.docId); if (!comp || !isCurProj(pane.docId)) return;
      const sents = comp.sentences.filter((s) => { const el = root.querySelector('.sent[data-sid="' + s.id + '"]'); return el && range.intersectsNode(el); });
      if (!sents.length) { setSelPaneId(null); return; }
      const spanStart = Math.min.apply(null, sents.map((s) => s.start));
      const spanEnd = Math.max.apply(null, sents.map((s) => s.end));
      // Narrow the anchor to the EXACT selected text so a comment covers ONLY what was selected — not the whole
      // sentence(s) the selection happens to touch. Locate the selection's text inside the source span,
      // whitespace-tolerantly; fall back to the full sentence span only when it can't be located (e.g. the
      // selection spans LaTeX commands / math where rendered text ≠ source).
      const src = getSource(pane.docId);
      const selText = sel.toString().trim();
      let start = spanStart, end = spanEnd;
      if (selText && selText.length >= 2) {
        const esc = selText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
        try { const m = new RegExp(esc).exec(src.slice(spanStart, spanEnd)); if (m && m[0]) { start = spanStart + m.index; end = start + m[0].length; } } catch (e) { }
      }
      selRange.current = { start: start, end: end }; selDocRef.current = pane.docId;
      setSelQuote(src.slice(start, end).trim() || selText);
      const rr = range.getBoundingClientRect();
      const top = rr.top > 64 ? rr.top - 46 : rr.bottom + 8;
      setSelPos({ top: top, left: Math.max(130, Math.min(window.innerWidth - 130, rr.left + rr.width / 2)) });
      setSelPaneId(pane.id);
    }, [getCompiled, isCurProj, getSource]);
    const previewElByPane = (pid) => previewEls.current[pid] || null;

    /* ---- file upload (into the selected folder) ---- */
    const fileInput = useRef(null);
    function uAdd(name, size, status, reason) { const id = 'u' + (++uploadSeq.current); setUploads((l) => [...l, { id: id, name: name, size: size || 0, status: status || 'queued', reason: reason || '' }]); return id; }
    function uSet(id, patch) { setUploads((l) => l.map((it) => it.id === id ? { ...it, ...patch } : it)); }

    function putBinary(path, blob, type, name, after, uid) {
      if (uid == null) uid = uAdd(name || bn(path), blob && blob.size, 'uploading'); else uSet(uid, { status: 'uploading' });
      if (window.PRUploads && window.PRUploads.enabled && projectId) {
        window.PRUploads.put(projectId, name || bn(path), blob).then((meta) => {
          setFiles((f) => ({ ...f, [path]: { type: type, storagePath: meta.storagePath, name: meta.name, size: meta.size, mime: meta.mime } }));
          setOrder((o) => o.includes(path) ? o : [...o, path]);
          window.PRUploads.signedUrl(meta.storagePath).then(() => setSignTick((t) => t + 1));
          uSet(uid, { status: 'done' });
          if (after) after(bn(path));
        }, (err) => { try { const c = { ...filesRef.current }; delete c[path]; filesRef.current = c; } catch (e) { } uSet(uid, { status: 'error', reason: (err && err.message) || String(err) }); });
      } else {
        const r = new FileReader();
        r.onload = () => {
          setFiles((f) => ({ ...f, [path]: { type: type, dataURL: String(r.result) } }));
          setOrder((o) => o.includes(path) ? o : [...o, path]);
          uSet(uid, { status: 'done' });
          if (after) after(bn(path));
        };
        r.onerror = () => uSet(uid, { status: 'error', reason: 'Could not read file' });
        r.readAsDataURL(blob);
      }
    }

    // Office (Word/Excel/PowerPoint) → an editable .md file in the project (shared PROffice util, lazy CDN libs)
    const importOfficeFile = (file, dir) => {
      const uid = uAdd(file.name, file.size, 'uploading');
      window.PROffice.extract(file).then((r) => {
        const base = file.name.replace(/\.(docx|xlsx|xlsm|xls|pptx)$/i, '') + '.md';
        const path = uniquePath((p) => !!filesRef.current[p], pjoin(dir, base));
        filesRef.current = { ...filesRef.current, [path]: {} };
        setFiles((f) => ({ ...f, [path]: { type: fileTypeOf(base), content: r.text || '' } }));
        setOrder((o) => o.includes(path) ? o : [...o, path]);
        uSet(uid, { status: 'done' });
        if (dir) setExpanded((s) => new Set(s).add(dir));
      }, (er) => uSet(uid, { status: 'error', reason: 'Office: ' + ((er && er.message) || er) }));
    };
    function onUpload(e) {
      const list = Array.from(e.target.files || []);
      const dir = currentDir;
      list.forEach((file) => {
        if (window.PROffice && window.PROffice.isOffice(file.name)) { importOfficeFile(file, dir); return; }
        const isText = TEXT_EXT_RE.test(file.name);
        const isImg = /\.(png|jpe?g|gif|svg|webp|pdf)$/i.test(file.name);
        const isPdf = /\.pdf$/i.test(file.name);
        if (!isText && !isImg) { uAdd(file.name, file.size, 'skipped', 'Unsupported format'); return; }
        if (!isText && file.size > SIZE_LIMIT) { uAdd(file.name, file.size, 'skipped', 'Larger than 50 MB'); return; }
        const path = uniquePath((p) => !!filesRef.current[p], pjoin(dir, file.name));
        filesRef.current = { ...filesRef.current, [path]: {} }; // reserve to avoid same-batch collisions
        if (isText) {
          const uid = uAdd(file.name, file.size, 'uploading');
          const r = new FileReader();
          r.onload = () => {
            setFiles((f) => ({ ...f, [path]: { type: fileTypeOf(file.name), content: String(r.result) } }));
            setOrder((o) => o.includes(path) ? o : [...o, path]);
            if (/\.tex$/i.test(file.name)) setActive(path);
            uSet(uid, { status: 'done' });
          };
          r.onerror = () => uSet(uid, { status: 'error', reason: 'Could not read file' });
          r.readAsText(file);
        } else {
          putBinary(path, file, isPdf ? 'pdf' : 'image', file.name);
        }
        if (dir) setExpanded((s) => new Set(s).add(dir));
      });
      e.target.value = '';
    }

    /* ---- folder upload (preserves subfolder structure) ---- */
    const dirInput = useRef(null);
    useEffect(() => {
      const el = dirInput.current;
      if (el) { el.setAttribute('webkitdirectory', ''); el.setAttribute('directory', ''); el.setAttribute('mozdirectory', ''); }
    }, []);
    function onUploadFolder(e) {
      const list = Array.from(e.target.files || []);
      const dir = currentDir;
      e.target.value = '';
      if (!list.length) return;
      const newFolders = new Set();
      const reserved = {};
      let skipped = 0, firstTex = null;
      const items = [];
      list.forEach((file) => {
        const rel = (file.webkitRelativePath || file.name).replace(/\\/g, '/');
        const isText = TEXT_EXT_RE.test(file.name);
        const isImg = /\.(png|jpe?g|gif|svg|pdf)$/i.test(file.name);
        if (!isText && !isImg) { uAdd(file.name, file.size, 'skipped', 'Unsupported format'); return; }
        if (file.size > SIZE_LIMIT) { uAdd(file.name, file.size, 'skipped', 'Larger than 50 MB'); return; }
        const path = uniquePath((p) => !!filesRef.current[p] || reserved[p], dir ? dir + '/' + rel : rel);
        reserved[path] = 1; filesRef.current = { ...filesRef.current, [path]: {} };
        const segs = path.split('/'); segs.pop();
        let acc = '';
        segs.forEach((s) => { acc = acc ? acc + '/' + s : s; if (!folders.includes(acc)) newFolders.add(acc); });
        const makeActive = isText && /\.tex$/i.test(file.name) && !firstTex;
        if (makeActive) firstTex = path;
        items.push({ file, path, isText, makeActive });
      });
      const note = (n) => window.PRUI.toast(n + ' file' + (n === 1 ? '' : 's') + ' skipped — only .tex, .bib, .bbl, .bst, .cls, .sty, .txt, .md, images and PDFs under 50 MB are imported.');
      if (!items.length) { if (skipped) note(skipped); return; }
      if (newFolders.size) setFolders((fs) => { const set = new Set(fs); newFolders.forEach((f) => set.add(f)); return Array.from(set); });
      setExpanded((s) => { const n = new Set(s); if (dir) n.add(dir); newFolders.forEach((f) => n.add(f)); return n; });
      items.forEach((it) => {
        if (it.isText) {
          const uid = uAdd(bn(it.path), it.file.size, 'uploading');
          const r = new FileReader();
          r.onload = () => {
            setFiles((f) => ({ ...f, [it.path]: { type: fileTypeOf(it.file.name), content: String(r.result) } }));
            setOrder((o) => o.includes(it.path) ? o : [...o, it.path]);
            if (it.makeActive) setActive(it.path);
            uSet(uid, { status: 'done' });
          };
          r.onerror = () => uSet(uid, { status: 'error', reason: 'Could not read file' });
          r.readAsText(it.file);
        } else {
          putBinary(it.path, it.file, /\.pdf$/i.test(it.file.name) ? 'pdf' : 'image', it.file.name);
        }
      });
      if (skipped) setTimeout(() => note(skipped), 120);
    }

    /* ---- file/folder tree ops ---- */
    const fileTaken = (p) => !!files[p];
    const toggleExpand = (path) => setExpanded((s) => { const n = new Set(s); n.has(path) ? n.delete(path) : n.add(path); return n; });
    const addFolder = (dir = currentDir) => {
      const path = uniquePath((p) => folders.includes(p), pjoin(dir, 'New folder'));
      setFolders([...folders, path]);
      setExpanded((s) => { const n = new Set(s); if (dir) n.add(dir); n.add(path); return n; });
      setRenaming({ type: 'folder', path });
    };
    const addFile = (dir = currentDir) => {
      const path = uniquePath(fileTaken, pjoin(dir, 'untitled.tex'));
      setFiles({ ...files, [path]: { type: 'tex', content: '\\section{New section}\nStart writing here.\n' } });
      setOrder([...order, path]);
      if (dir) setExpanded((s) => new Set(s).add(dir));
      setActive(path);
      setRenaming({ type: 'file', path });
    };
    const commitRename = (raw) => {
      if (!renaming) return;
      const { type, path } = renaming; setRenaming(null);
      const name = (raw || '').trim().replace(/\//g, '-');
      if (!name || name === bn(path)) return;
      if (type === 'file') {
        const np = uniquePath(fileTaken, pjoin(dn(path), name));
        const nf = { ...files }; const cur = nf[path];
        // re-derive the doc-type from the new extension for text files (so untitled.tex → notes.md
        // becomes a markdown doc, not a compiled .tex); never touch image/pdf types
        nf[np] = (cur && TEXT_TYPES[cur.type]) ? { ...cur, type: fileTypeOf(name) } : cur;
        delete nf[path]; setFiles(nf);
        setOrder(order.map((p) => p === path ? np : p));
        if (active === path) setActive(np);
      } else {
        const newBase = uniquePath((p) => folders.includes(p) && p !== path, pjoin(dn(path), name));
        const pref = path + '/';
        const remap = (p) => p === path ? newBase : (p.indexOf(pref) === 0 ? newBase + '/' + p.slice(pref.length) : p);
        setFolders(folders.map(remap));
        const nf = {}; Object.keys(files).forEach((k) => { nf[remap(k)] = files[k]; }); setFiles(nf);
        setOrder(order.map(remap));
        setExpanded((s) => { const n = new Set(); s.forEach((p) => n.add(remap(p))); return n; });
        if (active) setActive(remap(active));
        if (currentDir) setCurrentDir(remap(currentDir));
      }
    };
    const deleteFile = (path) => {
      const nf = { ...files }; delete nf[path]; setFiles(nf);
      const no = order.filter((p) => p !== path); setOrder(no);
      if (active === path) { const nx = no.find((p) => nf[p] && nf[p].type === 'tex'); setActive(nx || ''); }
    };
    const deleteFolder = (path) => {
      const pref = path + '/'; const inside = (p) => p === path || p.indexOf(pref) === 0;
      setFolders(folders.filter((p) => !inside(p)));
      const nf = {}; Object.keys(files).forEach((k) => { if (!inside(k)) nf[k] = files[k]; }); setFiles(nf);
      const no = order.filter((p) => !inside(p)); setOrder(no);
      setExpanded((s) => { const n = new Set(); s.forEach((p) => { if (!inside(p)) n.add(p); }); return n; });
      if (active && inside(active)) { const nx = no.find((p) => nf[p] && nf[p].type === 'tex'); setActive(nx || ''); }
      if (currentDir && inside(currentDir)) setCurrentDir('');
    };
    const moveFile = (path, destDir) => {
      if (dn(path) === destDir) return;
      const np = uniquePath(fileTaken, pjoin(destDir, bn(path)));
      const nf = { ...files }; nf[np] = nf[path]; delete nf[path]; setFiles(nf);
      setOrder(order.map((p) => p === path ? np : p));
      if (active === path) setActive(np);
      if (destDir) setExpanded((s) => new Set(s).add(destDir));
    };
    const moveFolder = (path, destDir) => {
      if (destDir === path || (destDir + '/').indexOf(path + '/') === 0) return; // can't drop into self/descendant
      if (dn(path) === destDir) return; // already here
      const newBase = uniquePath((p) => folders.includes(p), pjoin(destDir, bn(path)));
      const pref = path + '/';
      const remap = (p) => p === path ? newBase : (p.indexOf(pref) === 0 ? newBase + '/' + p.slice(pref.length) : p);
      setFolders(folders.map(remap));
      const nf = {}; Object.keys(files).forEach((k) => { nf[remap(k)] = files[k]; }); setFiles(nf);
      setOrder(order.map(remap));
      setExpanded((s) => { const n = new Set(); s.forEach((p) => n.add(remap(p))); if (destDir) n.add(destDir); return n; });
      if (active) setActive(remap(active));
      if (currentDir) setCurrentDir(remap(currentDir));
    };
    const moveItem = (path, destDir) => { if (folders.includes(path)) moveFolder(path, destDir); else moveFile(path, destDir); };

    /* ---- collaboration handlers ---- */
    const handleEdit = (v) => {
      editedRef.current = true;
      // edit-while-reading: typing while narration plays auto-pauses, then offers “resume from here”
      if (statusRef.current === 'playing') {
        if (window.speechSynthesis) window.speechSynthesis.cancel();
        stopAudio(); seqRef.current++;
        setStatus('paused'); setEditPaused(true); setResume(null);
      }
      setFiles((f) => ({ ...f, [active]: { ...f[active], content: v } }));
    };

    // Quick-fix: compute a safe source edit for an auto-fixable diagnostic, else null.
    function fixForDiag(d, src) {
      if (!d || d.kind !== 'env' || typeof src !== 'string') return null;
      // missing \end{document}
      if (/no\b.*end\{document\}/i.test(d.message)) {
        const ins = (src.endsWith('\n') ? '' : '\n') + '\\end{document}\n';
        return { newSrc: src + ins, caret: src.length + (src.endsWith('\n') ? 0 : 1), label: 'Insert \\end{document}' };
      }
      // unclosed environment → insert the matching \end{env}
      const m = /\\begin\{([^}]+)\}/.exec(d.message);
      if (m) {
        const endTag = '\\end{' + m[1] + '}';
        const docEnd = src.indexOf('\\end{document}');
        if (docEnd >= 0) {
          const newSrc = src.slice(0, docEnd) + endTag + '\n' + src.slice(docEnd);
          return { newSrc: newSrc, caret: docEnd, label: 'Insert ' + endTag };
        }
        const ins = (src.endsWith('\n') ? '' : '\n') + endTag + '\n';
        return { newSrc: src + ins, caret: src.length + (src.endsWith('\n') ? 0 : 1), label: 'Insert ' + endTag };
      }
      return null;
    }
    const applyFix = (fix) => { if (!fix) return; handleEdit(fix.newSrc); setDiagOpen(false); setSelectReq({ start: fix.caret, end: fix.caret, nonce: Date.now() }); };

    // Write mode: round-trip an inline preview edit of a sentence back to its source range.
    // isLatex=true → `text` is already serialized LaTeX (from the DOM serializer); don't escape it again.
    const onPreviewEdit = (docId, sent, text, isLatex) => {
      if (docId !== active || !sent || sent.start == null) return;
      const src = getSource(docId);
      const slice = src.slice(sent.start, sent.end);
      const lead = (slice.match(/^\s*/) || [''])[0];
      const trail = (slice.match(/\s*$/) || [''])[0];
      let t = (text || '').replace(/\u00a0/g, ' ');
      if (!isLatex) {
        // smart punctuation → LaTeX source so the re-render is identical
        t = t.replace(/\u2014/g, '---').replace(/\u2013/g, '--')
          .replace(/\u201c/g, '``').replace(/\u201d/g, "''").replace(/\u2018/g, '`').replace(/\u2019/g, "'");
        // escape specials a non-LaTeX author might type
        t = t.replace(/\\/g, '\\textbackslash{}').replace(/([&%#_${}])/g, '\\$1')
          .replace(/~/g, '\\textasciitilde{}').replace(/\^/g, '\\textasciicircum{}');
      }
      t = t.replace(/\s+/g, ' ').trim();
      const replacement = lead + t + trail;
      if (replacement === slice) return;
      handleEdit(src.slice(0, sent.start) + replacement + src.slice(sent.end));
    };

    // Write mode: block-level transforms (headings, lists). `block` = { kind, sids } from the preview DOM.
    const onBlockTransform = (block, action) => {
      if (!block || !block.sids || !block.sids.length) return;
      const src = source;
      const sents = block.sids.map((id) => compiled.sentences.find((s) => s.id === id)).filter(Boolean);
      if (!sents.length) return;
      const bStart = Math.min.apply(null, sents.map((s) => s.start));
      const bEnd = Math.max.apply(null, sents.map((s) => s.end));
      if (action.type === 'style') {
        const hm = /\\(section|subsection|subsubsection)\*?\s*\{\s*$/.exec(src.slice(0, bStart));
        if (hm) { // already a heading → relevel or revert to body
          const inner = src.slice(bStart, bEnd);
          const repl = action.level === 'body' ? inner : '\\' + action.level + '{' + inner + '}';
          const close = src[bEnd] === '}' ? bEnd + 1 : bEnd;
          handleEdit(src.slice(0, hm.index) + repl + src.slice(close));
        } else { // paragraph → heading
          if (action.level === 'body') return;
          const text = src.slice(bStart, bEnd).trim();
          handleEdit(src.slice(0, bStart) + '\\' + action.level + '{' + text + '}' + src.slice(bEnd));
        }
      } else if (action.type === 'list') {
        if (block.kind === 'list') { // unwrap back to paragraphs
          const b1 = src.lastIndexOf('\\begin{itemize}', bStart), b2 = src.lastIndexOf('\\begin{enumerate}', bStart);
          const beginIdx = Math.max(b1, b2);
          const ends = [src.indexOf('\\end{itemize}', bEnd), src.indexOf('\\end{enumerate}', bEnd)].filter((x) => x >= 0).sort((a, b) => a - b);
          if (beginIdx < 0) return;
          if (!ends.length) return;
          const endClose = src.indexOf('}', ends[0]) + 1;
          const inner = src.slice(beginIdx, endClose).replace(/\\(begin|end)\{(itemize|enumerate)\}/g, '');
          const items = inner.split(/\\item\b/).map((s) => s.trim()).filter(Boolean);
          const nv = src.slice(0, beginIdx) + items.join('\n\n') + src.slice(endClose);
          handleEdit(nv);
        } else { // paragraph → list
          const block2 = src.slice(bStart, bEnd);
          const lines = block2.split('\n').map((l) => l.trim()).filter(Boolean);
          const body = '\\begin{' + action.kind + '}\n' + lines.map((l) => '  \\item ' + l).join('\n') + '\n\\end{' + action.kind + '}';
          handleEdit(src.slice(0, bStart) + body + src.slice(bEnd));
        }
      }
    };

    // Write mode: insert a new block (table / figure) at a document offset.
    const onInsertBlock = (latex, off) => {
      const src = source;
      let at = off;
      if (at == null) { const d = src.indexOf('\\end{document}'); at = d >= 0 ? d : src.length; }
      const before = src.slice(0, at), after = src.slice(at);
      const pre = /\n\n$/.test(before) ? '' : (/\n$/.test(before) ? '\n' : '\n\n');
      const post = /^\n\n/.test(after) ? '' : (/^\n/.test(after) ? '\n' : '\n\n');
      handleEdit(before + pre + latex + post + after);
    };

    // Write mode: regenerate the Nth tabular from the edited cell model.
    const onTableEdit = (tabIndex, rows, opts) => {
      const src = source;
      const re = /\\begin\{tabular\}(\[[^\]]*\])?\{([^}]*)\}([\s\S]*?)\\end\{tabular\}/g;
      let m, idx = 0, target = null;
      while ((m = re.exec(src))) { if (idx === tabIndex) { target = m; break; } idx++; }
      if (!target) return;
      const ncol = rows.length ? rows[0].length : 1;
      let colChars = (target[2] || '').replace(/[^lcr]/g, '').split('');
      while (colChars.length < ncol) colChars.push(colChars[colChars.length - 1] || 'l');
      colChars = colChars.slice(0, ncol);
      const bodyLatex = rows.map((r, ri) => '  ' + r.join(' & ') + ' \\\\' + (ri === 0 && opts && opts.header ? '\n  \\hline' : '')).join('\n');
      const repl = '\\begin{tabular}' + (target[1] || '') + '{' + colChars.join('') + '}\n' + bodyLatex + '\n\\end{tabular}';
      handleEdit(src.slice(0, target.index) + repl + src.slice(target.index + target[0].length));
    };

    // Write mode: insert an image as a figure (saves the picked file into the project).
    const imgInsertInput = useRef(null);
    const pendingImgOffset = useRef(null);
    const onInsertImage = (off) => { pendingImgOffset.current = off; if (imgInsertInput.current) imgInsertInput.current.click(); };
    function onInsertImagePicked(e) {
      const file = (e.target.files || [])[0]; e.target.value = '';
      if (!file || !/\.(png|jpe?g|gif|svg)$/i.test(file.name)) return;
      if (file.size > SIZE_LIMIT) { window.PRUI.toast('Image is larger than 50 MB.', { kind: 'error' }); return; }
      const path = uniquePath((p) => !!filesRef.current[p], pjoin(currentDir, file.name));
      filesRef.current = { ...filesRef.current, [path]: {} };
      putBinary(path, file, 'image', file.name, (name) => {
        const fig = '\\begin{figure}[h]\n\\centering\n\\includegraphics[width=0.7\\linewidth]{' + name + '}\n\\caption{Caption}\n\\label{fig:' + name.replace(/\.[^.]+$/, '') + '}\n\\end{figure}';
        onInsertBlock(fig, pendingImgOffset.current);
      });
    }
    // Write mode: insert a pasted/dropped image blob as a figure.
    const onInsertImageBlob = (blob, off) => {
      if (!blob) return;
      const ext = ((blob.type || 'image/png').split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
      const path = uniquePath((p) => !!filesRef.current[p], pjoin(currentDir, 'pasted-' + Date.now() + '.' + ext));
      filesRef.current = { ...filesRef.current, [path]: {} };
      putBinary(path, blob, 'image', bn(path), (name) => {
        onInsertBlock('\\begin{figure}[h]\n\\centering\n\\includegraphics[width=0.7\\linewidth]{' + name + '}\n\\caption{Caption}\n\\label{fig:' + name.replace(/\.[^.]+$/, '') + '}\n\\end{figure}', off);
      });
    };

    // Insert an AI-generated figure (PNG blob) with the user's caption, before \end{document}.
    const onInsertFigure = (blob, caption) => {
      if (!blob) return;
      const ext = ((blob.type || 'image/png').split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
      const path = uniquePath((p) => !!filesRef.current[p], pjoin(currentDir, 'figure-' + Date.now() + '.' + ext));
      filesRef.current = { ...filesRef.current, [path]: {} };
      putBinary(path, blob, 'image', bn(path), (name) => {
        const lab = (name.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9]/g, '') || 'fig');
        const cap = String(caption || 'Caption').replace(/([%#&_$])/g, '\\$1');
        onInsertBlock('\\begin{figure}[h]\n\\centering\n\\includegraphics[width=0.7\\linewidth]{' + name + '}\n\\caption{' + cap + '}\n\\label{fig:' + lab + '}\n\\end{figure}', null);
      });
    };

    // bibKeys for \cite autocomplete is derived above from bibEntries (single-sourced through the PRRefs
    // parser, so offered keys and "Title (Year)" hints can never drift apart).
    const displayAnns = useMemo(() => annotations.map((a) => {
      if (!a.anchor || a.anchor.file !== active) return a;
      const cur = source.slice(a.anchor.start, a.anchor.end);
      if (cur === a.anchor.quote) return a;
      const at = a.anchor.quote ? source.indexOf(a.anchor.quote) : -1;
      if (at >= 0) return Object.assign({}, a, { anchor: Object.assign({}, a.anchor, { start: at, end: at + a.anchor.quote.length }) });
      return Object.assign({}, a, { _orphan: true });
    }), [annotations, source, active]);

    // annotation ranges for the LaTeX-code highlight (CodeEditor marks): subtle comment/to-do underlay
    const annoMarksFor = useCallback((docId) => {
      if (!docId || docId[0] === '@') return [];
      const anns = docId === active ? displayAnns : annotations;
      const out = [];
      anns.forEach((a) => {
        if (a.kind === 'review') return;
        if (!a.anchor || a.anchor.file !== docId || a._orphan || a.status === 'resolved' || a.status === 'done') return;
        if (a.anchor.end > a.anchor.start) out.push({ s: a.anchor.start, e: a.anchor.end, cls: a.kind === 'todo' ? 'anno-t' : 'anno-c' });
      });
      return out;
    }, [displayAnns, annotations, active]);

    // sentence-id → 'comment'|'todo'|'both' map for highlighting annotated sentences on the compiled PDF
    const annoSidsFor = useCallback((docId) => {
      if (!docId || docId[0] === '@') return {};
      const comp = getCompiled(docId); if (!comp) return {};
      const anns = docId === active ? displayAnns : annotations;
      const map = {};
      anns.forEach((a) => {
        if (a.kind === 'review') return; // review has its own marker layer
        if (!a.anchor || a.anchor.file !== docId || a._orphan || a.status === 'resolved' || a.status === 'done') return;
        const k = a.kind === 'todo' ? 'todo' : 'comment';
        comp.sentences.forEach((s) => {
          if (a.anchor.start < s.end && a.anchor.end > s.start) map[s.id] = !map[s.id] ? k : (map[s.id] === k ? k : 'both');
        });
      });
      return map;
    }, [displayAnns, annotations, active, getCompiled]);

    // sentence-id → worst review severity, for the AI-review marker layer (mirrors annoSidsFor)
    const reviewSidsFor = useCallback((docId) => {
      if (!docId || docId[0] === '@' || !showReview) return {};
      const comp = getCompiled(docId); if (!comp) return {};
      const anns = docId === active ? displayAnns : annotations;
      const rank = { major: 3, minor: 2, nit: 1 };
      const map = {};
      anns.forEach((a) => {
        if (a.kind !== 'review' || !a.anchor || a.anchor.file !== docId || a._orphan || a.status === 'resolved') return;
        comp.sentences.forEach((s) => {
          if (a.anchor.start < s.end && a.anchor.end > s.start) {
            const sev = a.severity || 'minor';
            if (!map[s.id] || rank[sev] > rank[map[s.id]]) map[s.id] = sev;
          }
        });
      });
      return map;
    }, [displayAnns, annotations, active, getCompiled, showReview]);

    // map of sentence ids whose ElevenLabs audio is already generated (♪ — free to replay), per doc
    const voicedSidsFor = useCallback((docId) => {
      if (!docId || docId[0] === '@' || !showVoiced) return {};
      const E = window.PREleven;
      if (voice.engine !== 'eleven' || !E || !E.keyFor) return {};
      const comp = getCompiled(docId); if (!comp) return {};
      const cfg = { elevenVoice: voice.elevenVoice, model: voice.model, stability: voice.stability, similarity: voice.similarity };
      const map = {};
      comp.sentences.forEach((s) => { if (s.text && voicedKeys[E.keyFor(s.text, cfg)]) map[s.id] = 1; });
      return map;
    }, [voicedKeys, voice.engine, voice.elevenVoice, voice.model, voice.stability, voice.similarity, getCompiled, showVoiced]);

    // annotations on a given sentence (for the hover card): body, author, kind, due
    const annoForSentence = useCallback((docId, sid) => {
      const comp = getCompiled(docId); if (!comp) return [];
      const s = comp.sentences.find((x) => String(x.id) === String(sid)); if (!s) return [];
      const anns = docId === active ? displayAnns : annotations;
      const A = window.PRAuth;
      return anns.filter((a) => a.kind !== 'review' && a.anchor && a.anchor.file === docId && !a._orphan && a.status !== 'resolved' && a.status !== 'done' && a.anchor.start < s.end && a.anchor.end > s.start)
        .map((a) => { const au = A && A.byId(a.authorId); return { kind: a.kind, body: a.body, due: a.due, author: au ? au.name : 'Someone', color: (au && au.color) ? au.color : '#8a8f98', initials: (au && A.initials) ? A.initials(au.name) : '•' }; });
    }, [getCompiled, displayAnns, annotations, active]);

    // raw annotation objects (id, replies, status…) overlapping a sentence — for the bubble thread popover
    const annoObjsForSentence = useCallback((docId, sid) => {
      const comp = getCompiled(docId); if (!comp) return [];
      const s = comp.sentences.find((x) => String(x.id) === String(sid)); if (!s) return [];
      const anns = docId === active ? displayAnns : annotations;
      return anns.filter((a) => a.kind !== 'review' && a.anchor && a.anchor.file === docId && !a._orphan && a.anchor.start < s.end && a.anchor.end > s.start);
    }, [getCompiled, displayAnns, annotations, active]);
    // bubble thread popover: which sentence's threads are open, and where (anchored next to the clicked card)
    const [bubble, setBubble] = useState(null); // { docId, sid, rect }
    const onOpenBubble = useCallback((docId, sid, rect) => setBubble({ docId: docId, sid: String(sid), rect: rect }), []);

    // hover card showing the comment/to-do text + author at the sentence's top-right corner
    const [annoPop, setAnnoPop] = useState(null);
    const annoPopTimer = useRef(null);
    useEffect(() => {
      const SEL = '.sent.has-comment, .sent.has-todo, .sent.has-both';
      let curEl = null;
      const over = (e) => {
        const el = e.target.closest && e.target.closest(SEL);
        if (!el || el === curEl) return;
        curEl = el; clearTimeout(annoPopTimer.current);
        const root = el.closest('[data-doc]'); const docId = root ? root.getAttribute('data-doc') : active;
        const items = annoForSentence(docId, el.getAttribute('data-sid'));
        if (!items.length) { setAnnoPop(null); return; }
        const r = el.getBoundingClientRect();
        setAnnoPop({ top: r.top, left: r.left, right: r.right, items: items });
      };
      const out = (e) => {
        const el = e.target.closest && e.target.closest(SEL); if (!el) return;
        curEl = null; annoPopTimer.current = setTimeout(() => setAnnoPop(null), 220);
      };
      document.addEventListener('mouseover', over); document.addEventListener('mouseout', out);
      return () => { document.removeEventListener('mouseover', over); document.removeEventListener('mouseout', out); clearTimeout(annoPopTimer.current); };
    }, [annoForSentence, active]);

    function startAnnotation(kind) {
      const r = selRange.current;
      const file = selDocRef.current && isCurProj(selDocRef.current) ? selDocRef.current : active;
      const src = getSource(file);
      setDraft({ kind: kind, anchor: { file: file, start: r.start, end: r.end, quote: src.slice(r.start, r.end) } });
      setSelQuote(''); setSelPaneId(null); setPreviewSel(null); setDrawer({ open: true, tab: kind === 'todo' ? 'todos' : 'comments' });
    }
    /* selection inside a source pane */
    const onSourceSel = useCallback((pane, s, e) => {
      if (e > s && isCurProj(pane.docId)) {
        selRange.current = { start: s, end: e }; selDocRef.current = pane.docId;
        setSelQuote(getSource(pane.docId).slice(s, e));
        const host = previewEls.current['src:' + pane.id];
        const r = host ? host.getBoundingClientRect() : null;
        setSelPos(r ? { top: r.top + 8, left: r.left + r.width / 2 } : null);
        setSelPaneId(pane.id);
      } else if (selPaneId === pane.id) { setSelQuote(''); setSelPaneId(null); }
    }, [isCurProj, getSource, selPaneId]);
    const saveDraft = (d) => { if (!draft) return; window.PRStore.addAnnotation(projectId, { kind: draft.kind, anchor: draft.anchor, body: d.body, authorId: me.id, assignee: d.assignee || null, due: d.due || null, mentions: d.mentions || [], attachments: d.attachments || [], status: 'open' }); setDraft(null); refreshCollab(); };
    const onReply = (ann, payload) => { const o = typeof payload === 'string' ? { body: payload } : payload; window.PRStore.replyAnnotation(projectId, ann.id, me.id, o.body, { mentions: o.mentions || [], attachments: o.attachments || [] }); refreshCollab(); };
    const onResolve = (ann) => { window.PRStore.updateAnnotation(projectId, ann.id, { status: ann.status === 'open' ? 'resolved' : 'open' }); refreshCollab(); };
    const onToggleTodo = (ann) => { window.PRStore.updateAnnotation(projectId, ann.id, { status: ann.status === 'done' ? 'open' : 'done' }); refreshCollab(); };
    const onEditAnn = (ann, d) => { window.PRStore.updateAnnotation(projectId, ann.id, { body: d.body, mentions: d.mentions || [], attachments: d.attachments || [], assignee: d.assignee || null, due: d.due || null, editedAt: Date.now() }); refreshCollab(); };
    const onDeleteAnn = (ann) => { window.PRStore.deleteAnnotation(projectId, ann.id); refreshCollab(); };
    // Jump from a comment/to-do/review note → move BOTH the code view (select + scroll the flagged
    // span) AND the preview (scroll to that sentence); previously it only touched the code.
    const onJumpAnn = (ann) => {
      const a = ann && ann.anchor; if (!a) return;
      if (a.file !== active) {
        // cross-file: index against the TARGET file's own sentences (not the stale active list), then
        // let the [active] effect place it — mirrors onPreviewClick's cross-file path.
        var fsid = null;
        try {
          const comp = window.LatexEngine.process(getSource(a.file), files); const sents = comp.sentences || [];
          let k = -1; for (let i = 0; i < sents.length; i++) { if (a.start >= sents[i].start && a.start <= sents[i].end) { k = i; break; } if (sents[i].start > a.start) { k = Math.max(0, i - 1); break; } }
          const ki = Math.max(0, k < 0 ? sents.length - 1 : k); idxByDoc.current[a.file] = ki; fsid = sents[ki] && sents[ki].id;
        } catch (e) { }
        setActive(a.file); setSelectReq({ start: a.start, end: a.end, nonce: Date.now() }); if (fsid != null) setTimeout(() => flashSentence(a.file, fsid), 450); return;
      }
      setSelectReq({ start: a.start, end: a.end, nonce: Date.now() });
      const k = sentAt(a.start);
      if (k >= 0) { seekTo(k); const s = sentsRef.current[k]; if (s) { requestAnimationFrame(() => scrollPreviewTo(s.id)); flashSentence(active, s.id); } }
    };
    // does offset `pos` fall inside a verbatim-like environment? (a % comment there becomes literal text)
    const inVerbatim = (src, pos) => {
      const head = src.slice(0, pos); let depth = 0, m;
      const re = /\\(begin|end)\{(verbatim|verbatim\*|lstlisting|lstlisting\*|minted|Verbatim|alltt|comment)\}/g;
      while ((m = re.exec(head))) { if (m[1] === 'begin') depth++; else if (depth > 0) depth--; }
      return depth > 0;
    };
    // Apply a review suggestion to the source: a concrete `replacement` swaps the flagged span; otherwise
    // the prose suggestion is inserted as a LaTeX comment above the flagged line (undoable). Refuses to
    // touch a drifted/unanchored note, an ambiguous (non-unique) quote, or text inside a verbatim block.
    const onApplyReview = (ann) => {
      const a = ann && ann.anchor;
      if (!a || ann._orphan || a.file !== active || a.start === a.end) { onJumpAnn(ann); return; }
      const src = source; let nv, caret;
      // the stored offsets must still point exactly at the quote, and the quote must be unambiguous
      if (a.quote && (src.slice(a.start, a.end) !== a.quote || src.indexOf(a.quote) !== src.lastIndexOf(a.quote))) { onJumpAnn(ann); return; }
      if (ann.replacement != null && ann.replacement !== '') {
        nv = src.slice(0, a.start) + ann.replacement + src.slice(a.end); caret = a.start + ann.replacement.length;
      } else if (ann.suggestion) {
        const ls = src.lastIndexOf('\n', Math.max(0, a.start - 1)) + 1;
        if (inVerbatim(src, ls)) { onJumpAnn(ann); return; } // don't inject a comment into verbatim/listing
        const note = '% [AI review · ' + (ann.category || 'note') + '] ' + String(ann.suggestion).replace(/\s+/g, ' ').trim() + '\n';
        nv = src.slice(0, ls) + note + src.slice(ls); caret = ls;
      } else { onJumpAnn(ann); return; }
      handleEdit(nv);
      setSelectReq({ start: caret, end: caret, nonce: Date.now() });
      if (window.PRStore) { window.PRStore.updateAnnotation(projectId, ann.id, { status: 'resolved', appliedAt: Date.now() }); refreshCollab(); }
    };

    /* ---- AI review import (workflow findings → anchored review notes) ---- */
    const reviewInput = useRef(null);
    const reviewAnns = useMemo(() => displayAnns.filter((a) => a.kind === 'review'), [displayAnns]);
    const onImportReview = () => { if (reviewInput.current) reviewInput.current.click(); };
    const onReviewFile = (e) => {
      const f = e.target.files && e.target.files[0]; e.target.value = '';
      if (!f || !window.PRStore || !window.PRStore.importReview) return;
      const r = new FileReader();
      r.onload = () => {
        try {
          const data = JSON.parse(String(r.result));
          const findings = Array.isArray(data) ? data : (data.findings || []);
          const res = window.PRStore.importReview(projectId, findings, { actorId: me.id });
          refreshCollab(); setReviewFocus(null); setDrawer({ open: true, tab: 'review' });
          window.PRUI.toast('AI review imported: ' + res.imported + ' note' + (res.imported === 1 ? '' : 's') + ' anchored to the text' + (res.unanchored ? ' (' + res.unanchored + ' could not be located)' : '') + '.', { kind: 'ok' });
        } catch (err) { window.PRUI.toast('Could not read the review file (expected JSON with a "findings" array): ' + (err && err.message), { kind: 'error' }); }
      };
      r.readAsText(f);
    };
    const onClearReview = () => { if (!(window.PRStore && window.PRStore.clearReview)) return; window.PRUI.confirm({ title: 'Remove AI review notes', body: 'Remove all AI review notes from this project?', confirmLabel: 'Remove', danger: true }).then(function (ok) { if (!ok) return; window.PRStore.clearReview(projectId); refreshCollab(); }); };
    const onSaveVersion = (label) => { window.PRStore.addVersion(projectId, label, me.id, true); refreshCollab(); };
    const onRestore = (v) => { const p = window.PRStore.restoreVersion(projectId, v.id); if (p) { setFiles(p.files); setOrder(p.order); if (!p.files[active]) setActive(p.active); } setDiffVersion(null); refreshCollab(); };
    const toggleDrawer = (tab) => setDrawer((d) => d.open && d.tab === tab ? { open: false, tab: tab } : { open: true, tab: tab });
    const saveReading = () => { if (projectId && window.PRStore) window.PRStore.setReading(me.id, projectId, idxRef.current); setSavedFlash(true); setTimeout(() => setSavedFlash(false), 1700); };

    /* ================= window-management handlers ================= */
    const WS = window.WS;
    const ensureExt = useCallback((proj, file) => {
      const docId = '@' + proj.id + '/' + file;
      if (!extDocs.current[docId]) {
        const p = window.PRStore.get(proj.id);
        const f = p && p.files[file];
        if (!f || f.type !== 'tex') return null;
        extDocs.current[docId] = { source: f.content, files: p.files, label: proj.title + ' \u00b7 ' + bn(file), projTitle: proj.title, file: file };
        setExtTick((t) => t + 1);
      }
      return docId;
    }, []);
    const addPaneNextTo = useCallback((newPane, dir) => {
      setLayout((lay) => {
        if (!lay) return newPane;
        const f = focusedPaneId && WS.find(lay, focusedPaneId);
        const target = (f && WS.isPane(f)) ? focusedPaneId : WS.firstPane(lay).id;
        return WS.splitPane(lay, target, dir || 'row', newPane);
      });
      const fp = WS.firstPane(newPane); if (fp) setFocusedPaneId(fp.id); setPreset(null);
    }, [focusedPaneId]);

    const wsOnFocus = useCallback((pane) => {
      setFocusedPaneId(pane.id);
      if ((pane.kind === 'source' || pane.kind === 'preview') && isCurProj(pane.docId) && docExists(pane.docId) && pane.docId !== active) setActive(pane.docId);
    }, [active, isCurProj, docExists]);
    const wsOnAdd = useCallback((paneId, dir) => { const np = WS.mkPane('preview', active); setLayout((lay) => WS.splitPane(lay, paneId, dir, np)); setFocusedPaneId(np.id); setPreset(null); }, [active]);
    const wsOnAddKind = useCallback((kind, docId, rendered) => { addPaneNextTo(rendered ? { id: WS.nid(), type: 'pane', kind: 'pdf', docId: docId } : WS.mkPane(kind, docId), 'row'); }, [addPaneNextTo]);
    const wsOnAddMedia = useCallback((kind, file) => { addPaneNextTo(WS.mkPane(kind, null, file), 'row'); }, [addPaneNextTo]);
    const wsOnAddExternal = useCallback((proj, file, mode) => {
      const docId = ensureExt(proj, file); if (!docId) return;
      if (mode === 'both') addPaneNextTo({ id: WS.nid(), type: 'split', dir: 'row', ratio: 0.5, a: WS.mkPane('source', docId), b: WS.mkPane('preview', docId) }, 'row');
      else addPaneNextTo(WS.mkPane(mode, docId), 'row');
    }, [ensureExt, addPaneNextTo]);
    const wsOnClose = useCallback((paneId) => {
      setLayout((lay) => {
        if (WS.isPane(lay)) return lay; // never zero panes
        const nl = WS.closePane(lay, paneId);
        const fp = WS.firstPane(nl); if (fp) setFocusedPaneId(fp.id);
        return nl;
      });
      setSoloPaneId((s) => s === paneId ? null : s);
    }, []);
    const wsOnSolo = useCallback((paneId) => setSoloPaneId((s) => s === paneId ? null : paneId), []);
    const wsOnMovePane = useCallback((srcId, destId, zone) => {
      setLayout((lay) => WS.movePane(lay, srcId, destId, zone));
      setSoloPaneId(null); setDragId(null);
    }, []);
    const wsOnSetRatio = useCallback((id, r) => setLayout((lay) => WS.setRatio(lay, id, r)), []);
    const wsOnRebind = useCallback((pane, patch) => {
      setLayout((lay) => WS.patchPane(lay, pane.id, patch));
      if (patch.docId && isCurProj(patch.docId) && docExists(patch.docId)) setActive(patch.docId);
    }, [isCurProj, docExists]);
    const wsOnPreset = useCallback((k) => {
      setSoloPaneId(null); setPreset(k);
      if (k === 'split') setLayout({ id: WS.nid(), type: 'split', dir: 'row', ratio: 0.5, a: WS.mkPane('source', active), b: WS.mkPane('preview', active) });
      else if (k === 'preview') setLayout(WS.mkPane('preview', active));
      else if (k === 'source') setLayout(WS.mkPane('source', active));
      else if (k === 'compiled') setLayout({ id: WS.nid(), type: 'split', dir: 'row', ratio: 0.5, a: WS.mkPane('source', active), b: WS.mkPane('compiled', active) });
      else if (k === 'threeup') {
        const pdfs = order.filter((f) => files[f] && files[f].type === 'pdf');
        const third = pdfs.length ? WS.mkPane('pdf', null, pdfs[0]) : { id: WS.nid(), type: 'pane', kind: 'pdf', docId: active };
        setLayout({ id: WS.nid(), type: 'split', dir: 'row', ratio: 0.34, a: WS.mkPane('source', active), b: { id: WS.nid(), type: 'split', dir: 'row', ratio: 0.5, a: WS.mkPane('preview', active), b: third } });
      }
      setTimeout(() => { const fp = WS.firstPane(layoutRef.current); if (fp) setFocusedPaneId(fp.id); }, 0);
    }, [active, order, files]);
    const pdfInput = useRef(null);
    const wsOnUploadPdf = useCallback(() => { if (pdfInput.current) pdfInput.current.click(); }, []);
    function onPdfPicked(e) {
      const file = (e.target.files || [])[0]; e.target.value = '';
      if (!file || !/\.pdf$/i.test(file.name)) { if (file) window.PRUI.toast('Please choose a PDF file.', { kind: 'error' }); return; }
      if (file.size > SIZE_LIMIT) { window.PRUI.toast('PDF is larger than 50 MB.', { kind: 'error' }); return; }
      const path = uniquePath((p) => !!filesRef.current[p], pjoin(currentDir, file.name));
      filesRef.current = { ...filesRef.current, [path]: {} };
      putBinary(path, file, 'pdf', file.name, () => { addPaneNextTo(WS.mkPane('pdf', null, path), 'row'); });
    }
    const blobURLs = useRef({});
    const getFileURL = useCallback((file) => {
      const f = files[file]; if (!f) return null;
      if (f.storagePath && window.PR_SIGNED && window.PR_SIGNED[f.storagePath]) return window.PR_SIGNED[f.storagePath];
      if (f.type === 'pdf' && f.dataURL) {
        const cached = blobURLs.current[file];
        if (cached && cached.dataURL === f.dataURL) return cached.url;
        try { const url = URL.createObjectURL(dataURLToBlob(f.dataURL)); blobURLs.current[file] = { dataURL: f.dataURL, url: url }; return url; } catch (e) { return f.dataURL; }
      }
      return f.dataURL || f.src || null;
    }, [files, signTick]);
    const getFileData = useCallback((file) => { const f = files[file]; return f && f.dataURL ? f.dataURL : null; }, [files]);
    const onPrintDoc = useCallback((docId) => {
      docId = docId || active;
      const comp = getCompiled(docId); if (!comp) { window.PRUI.toast('Nothing to render yet — open a document first.', { kind: 'error' }); return; }
      const w = window.open('', '_blank'); if (!w) { window.PRUI.toast('Please allow pop-ups to export the PDF.', { kind: 'error' }); return; }
      w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>' + docLabel(docId) + '</title>' +
        '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">' +
        '<link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,600;8..60,700&display=swap" rel="stylesheet">' +
        '<style>body{margin:0;background:#fff;font-family:"Source Serif 4",Georgia,serif;color:#1d2430;line-height:1.6}.paper{max-width:680px;margin:0 auto;padding:48px 40px}h1,h2,h3{font-family:inherit}.sent{}@media print{.paper{max-width:none}}</style>' +
        '</head><body><div class="paper">' + comp.html + '</div></body></html>');
      w.document.close(); w.focus(); setTimeout(() => { try { w.print(); } catch (e) { } }, 700);
    }, [getCompiled, docLabel, active]);
    // #5 — export the compiled document to Word (.docx); html-docx-js is lazy-loaded on first use
    const loadHtmlDocx = () => window.htmlDocx ? Promise.resolve(window.htmlDocx) : new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://unpkg.com/html-docx-js/dist/html-docx.js'; s.onload = () => res(window.htmlDocx); s.onerror = rej; document.head.appendChild(s); });
    const onWordDoc = useCallback((docId) => {
      docId = docId || active;
      const comp = getCompiled(docId); if (!comp) { window.PRUI.toast('Nothing to export yet — open a document first.', { kind: 'error' }); return; }
      loadHtmlDocx().then((HD) => {
        const html = '<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Georgia,serif;line-height:1.5}h1,h2,h3{font-family:inherit}</style></head><body>' + comp.html + '</body></html>';
        const blob = HD.asBlob(html);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = (docLabel(docId) || 'document').replace(/\.[^.]+$/, '') + '.docx';
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
      }, () => window.PRUI.toast('The Word-export library could not be loaded (offline?).', { kind: 'error' }));
    }, [getCompiled, docLabel, active]);
    const myProjects = useCallback(() => (window.PRStore ? window.PRStore.listFor(me.id).filter((p) => p.id !== projectId) : []), [projectId]);
    const projTexFiles = useCallback((p) => Object.keys(p.files || {}).filter((f) => p.files[f] && p.files[f].type === 'tex'), []);
    const externalDocsList = useCallback(() => Object.keys(extDocs.current).map((docId) => ({ docId, label: docLabel(docId) })), [extTick]);
    const listProjFiles = useCallback((kind) => order.filter((f) => files[f] && (kind === 'tex' ? files[f].type === 'tex' : files[f].type !== 'tex' && files[f].type !== 'bib')), [order, files]);
    const registerPreview = useCallback((paneId, el) => { if (el) previewEls.current[paneId] = el; else delete previewEls.current[paneId]; }, []);

    useEffect(() => {
      if (!editedRef.current || !projectId || !window.PRStore || !canEdit) return;
      const tmr = setTimeout(() => { const d = new Date(); window.PRStore.addVersion(projectId, 'Autosave ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2), me.id, false); }, 6000);
      return () => clearTimeout(tmr);
    }, [source]);

    const ANNO_IC = {
      comment: '<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2.5 3.5h11v7H8l-3 2.5V10.5h-2.5z" stroke-linejoin="round"/></svg>',
      todo: '<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M3 8.5l3 3 6.5-7.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    };
    const REVIEW_IC = '<svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M7 2.5l1.2 2.6 2.8.3-2.1 1.9.6 2.8L7 11.3 4.5 12.6l.6-2.8L3 7.9l2.8-.3z" stroke-linejoin="round"/></svg>';
    useLayoutEffect(() => {
      const A = window.PRAuth;
      const roots = Array.from(document.querySelectorAll('.preview-scroll'));
      roots.forEach((root) => root.querySelectorAll('.sent').forEach((el) => {
        el.classList.remove('has-comment', 'has-todo', 'has-both');
        el.style.removeProperty('--anno-color');
        const t = el.querySelector(':scope > .anno-tag'); if (t) t.remove();
      }));
      roots.forEach((root) => { root.querySelectorAll('.anno-margin-card').forEach((c) => c.remove()); root.classList.remove('has-anno-margin'); });
      roots.forEach((root) => {
        const docId = root.getAttribute('data-doc');
        if (!docId || docId[0] === '@') return;
        const comp = getCompiled(docId); if (!comp) return;
        const anns = docId === active ? displayAnns : annotations;
        const bySent = {}, bySentAnns = {};
        anns.forEach((a) => {
          if (a.kind === 'review') return;
          if (!a.anchor || a.anchor.file !== docId || a.status === 'resolved' || a.status === 'done' || a._orphan) return;
          comp.sentences.forEach((s) => {
            if (a.anchor.start < s.end && a.anchor.end > s.start) {
              const g = bySent[s.id] || (bySent[s.id] = { comment: [], todo: [] });
              g[a.kind === 'todo' ? 'todo' : 'comment'].push(a.authorId);
              (bySentAnns[s.id] || (bySentAnns[s.id] = [])).push(a);
            }
          });
        });
        Object.keys(bySent).forEach((sid) => {
          const el = root.querySelector('.sent[data-sid="' + sid + '"]'); if (!el) return;
          const g = bySent[sid]; const hasC = g.comment.length, hasT = g.todo.length;
          el.classList.add(hasC && hasT ? 'has-both' : hasC ? 'has-comment' : 'has-todo');
          const u = A && A.byId(g.comment[0] || g.todo[0]);
          if (u && u.color) el.style.setProperty('--anno-color', u.color);
          const authors = []; g.comment.concat(g.todo).forEach((id) => { if (authors.indexOf(id) < 0) authors.push(id); });
          const tag = document.createElement('span'); tag.className = 'anno-tag'; tag.contentEditable = 'false';
          let html = authors.slice(0, 3).map((id) => { const au = A && A.byId(id); return au ? '<span class="anno-av" style="background:' + au.color + '" title="' + au.name + '">' + A.initials(au.name) + '</span>' : ''; }).join('');
          if (hasC) html += '<span class="anno-ic comment" title="Comment">' + ANNO_IC.comment + '</span>';
          if (hasT) html += '<span class="anno-ic todo" title="To-do">' + ANNO_IC.todo + '</span>';
          tag.innerHTML = html;
          tag.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
          tag.addEventListener('click', (e) => { e.stopPropagation(); if (docId !== active && isCurProj(docId)) setActive(docId); setDrawer({ open: true, tab: hasC && !hasT ? 'comments' : hasT && !hasC ? 'todos' : 'comments' }); });
          el.appendChild(tag);
        });
        // #6 — margin cards: persistent comment/to-do cards anchored beside their sentence, in a reserved
        // right column INSIDE the scroll content, so they scroll together with the document.
        const rr = root.getBoundingClientRect();
        const cards = Object.keys(bySentAnns).map((sid) => {
          const el = root.querySelector('.sent[data-sid="' + sid + '"]'); if (!el) return null;
          const er = el.getBoundingClientRect();
          return { top: er.top - rr.top + root.scrollTop, sid: sid, anns: bySentAnns[sid] };
        }).filter(Boolean).sort((a, b) => a.top - b.top);
        if (cards.length && root.clientWidth >= 900) {
          root.classList.add('has-anno-margin');
          let lastBottom = -999;
          cards.forEach((c) => {
            const top = Math.max(c.top, lastBottom + 8); lastBottom = top + 74;
            const first = c.anns[0]; const todoOnly = c.anns.every((a) => a.kind === 'todo');
            const au = A && A.byId(first.authorId);
            const card = document.createElement('div');
            card.className = 'anno-margin-card' + (todoOnly ? ' todo' : ''); card.style.top = top + 'px';
            const head = document.createElement('div'); head.className = 'amc-head';
            if (au) { const av = document.createElement('span'); av.className = 'anno-av'; av.style.background = au.color; av.textContent = A.initials(au.name); head.appendChild(av); const nm = document.createElement('b'); nm.textContent = au.name; head.appendChild(nm); }
            if (c.anns.length > 1) { const more = document.createElement('span'); more.className = 'amc-more'; more.textContent = '+' + (c.anns.length - 1); head.appendChild(more); }
            const body = document.createElement('div'); body.className = 'amc-body'; body.textContent = first.body || (todoOnly ? '(to-do)' : '(comment)');
            card.appendChild(head); card.appendChild(body);
            card.addEventListener('mousedown', (e) => { e.preventDefault(); });
            card.addEventListener('click', (e) => { e.stopPropagation(); onOpenBubble(docId, c.sid, card.getBoundingClientRect()); });
            root.appendChild(card);
          });
        }
      });
    }, [displayAnns, annotations, compiled, otherCompiled, active, layout, soloPaneId]);

    // flag sentences whose ElevenLabs audio is already generated (♪ — replays free, no extra credit)
    useLayoutEffect(() => {
      const roots = Array.from(document.querySelectorAll('.preview-scroll'));
      roots.forEach((root) => root.querySelectorAll('.sent.voiced').forEach((el) => { el.classList.remove('voiced'); el.removeAttribute('title'); }));
      const E = window.PREleven;
      if (!showVoiced || voice.engine !== 'eleven' || !E || !E.keyFor) return;
      const cfg = { elevenVoice: voice.elevenVoice, model: voice.model, stability: voice.stability, similarity: voice.similarity };
      roots.forEach((root) => {
        const docId = root.getAttribute('data-doc'); if (!docId || docId[0] === '@') return;
        const comp = getCompiled(docId); if (!comp) return;
        comp.sentences.forEach((s) => {
          if (!s.text || !voicedKeys[E.keyFor(s.text, cfg)]) return;
          const el = root.querySelector('.sent[data-sid="' + s.id + '"]');
          if (el) { el.classList.add('voiced'); el.title = 'Voiced with ElevenLabs — replays free, no extra credits'; }
        });
      });
    }, [voicedKeys, voice.engine, voice.elevenVoice, voice.model, voice.stability, voice.similarity, compiled, otherCompiled, active, layout, soloPaneId, showVoiced]);

    // AI-review markers on the preview: a ✦ tag per sentence carrying review notes (severity-coloured)
    useLayoutEffect(() => {
      const roots = Array.from(document.querySelectorAll('.preview-scroll'));
      roots.forEach((root) => root.querySelectorAll('.sent.has-review').forEach((el) => {
        el.classList.remove('has-review', 'review-major', 'review-minor', 'review-nit'); el.removeAttribute('title');
        const t = el.querySelector(':scope > .review-tag'); if (t) t.remove();
      }));
      if (!showReview) return;
      const rank = { major: 3, minor: 2, nit: 1 };
      roots.forEach((root) => {
        const docId = root.getAttribute('data-doc'); if (!docId || docId[0] === '@') return;
        const comp = getCompiled(docId); if (!comp) return;
        const anns = docId === active ? displayAnns : annotations;
        const bySent = {};
        anns.forEach((a) => {
          if (a.kind !== 'review' || !a.anchor || a.anchor.file !== docId || a._orphan || a.status === 'resolved') return;
          comp.sentences.forEach((s) => { if (a.anchor.start < s.end && a.anchor.end > s.start) (bySent[s.id] = bySent[s.id] || []).push(a); });
        });
        Object.keys(bySent).forEach((sid) => {
          const el = root.querySelector('.sent[data-sid="' + sid + '"]'); if (!el) return;
          const list = bySent[sid]; let worst = 'nit'; list.forEach((a) => { if (rank[a.severity || 'minor'] > rank[worst]) worst = a.severity || 'minor'; });
          el.classList.add('has-review', 'review-' + worst);
          el.title = list.map((a) => '[' + (a.category || '') + ' · ' + (a.severity || '') + '] ' + (a.comment || '')).join('\n\n').slice(0, 500);
          const tag = document.createElement('span'); tag.className = 'review-tag review-' + worst; tag.contentEditable = 'false';
          tag.innerHTML = REVIEW_IC + (list.length > 1 ? '<i class="rt-n">' + list.length + '</i>' : '');
          tag.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
          tag.addEventListener('click', (e) => { e.stopPropagation(); if (docId !== active && isCurProj(docId)) setActive(docId); setReviewFocus(list[0].id); setDrawer({ open: true, tab: 'review' }); });
          el.appendChild(tag);
        });
      });
    }, [displayAnns, annotations, compiled, otherCompiled, active, layout, soloPaneId, showReview]);

    const sentence = compiled.sentences[idx];
    const total = compiled.sentences.length;
    const readLine = source && sentence ? source.slice(0, sentence.start).split('\n').length - 1 : -1;
    const diags = compiled.diagnostics || [];

    const collabMembers = [window.PRAuth && window.PRAuth.byId(projMeta.ownerId)].concat(projMeta.members.map((m) => window.PRAuth && window.PRAuth.byId(m.userId))).filter(Boolean);
    const openComments = annotations.filter((a) => a.kind === 'comment' && a.status === 'open').length;
    const openTodos = annotations.filter((a) => a.kind === 'todo' && a.status !== 'done').length;
    const openReview = annotations.filter((a) => a.kind === 'review' && a.status !== 'resolved').length;
    const projForShare = Object.assign({ id: projectId, title: init.title }, projMeta);
    // submission-readiness gate — aggregates every check the editor performs into one pre-submission verdict
    const readiness = (() => {
      const items = [], m = kpiMetrics;
      if (m && m.checks && m.checks.length) {
        const over = m.checks.filter((c) => c.status === 'over' || c.status === 'missing');
        const warn = m.checks.filter((c) => c.status === 'warn');
        const na = m.checks.filter((c) => c.status === 'na'); // not yet measurable (e.g. page count before a compile) — don't claim compliance
        items.push({ key: 'format', label: 'Format & limits', status: over.length ? 'fail' : (warn.length || na.length) ? 'warn' : 'ok', detail: over.length ? over.length + ' over/missing — ' + over.map((c) => c.label).join(', ') : na.length ? na.length + ' not measured yet — compile to check' : warn.length ? warn.length + ' near a limit' : 'all within limits' });
      }
      let refErr = 0; try { refErr = window.PRRefs ? window.PRRefs.errorCount(refs) : 0; } catch (e) { }
      items.push({ key: 'cites', label: 'Citations & bibliography', status: refErr ? 'fail' : refsIssues ? 'warn' : 'ok', detail: refErr ? refErr + ' hard error(s) — undefined cites / duplicate keys or DOIs' : refsIssues ? refsIssues + ' issue(s) to review' : 'no issues' });
      items.push({ key: 'numbers', label: 'Number consistency', status: consistencyConflicts ? 'warn' : 'ok', detail: consistencyConflicts ? consistencyConflicts + ' metric(s) reported with more than one value' : 'no conflicts' });
      items.push({ key: 'spell', label: 'Spelling', status: !spellOn ? 'skip' : spellCount > 25 ? 'warn' : 'ok', detail: !spellOn ? 'not run — enable spell check' : spellCount ? spellCount + ' word(s) flagged (curate the dictionary)' : 'clean' });
      items.push({ key: 'notes', label: 'Open comments & to-dos', status: (openComments + openTodos) ? 'warn' : 'ok', detail: (openComments + openTodos) ? openComments + ' comment(s), ' + openTodos + ' to-do(s) still open' : 'all resolved' });
      items.push({ key: 'review', label: 'AI review', status: openReview ? 'warn' : 'ok', detail: openReview ? openReview + ' unresolved finding(s)' : (reviewAnns.length ? 'all resolved' : 'no review imported') });
      const fails = items.filter((i) => i.status === 'fail').length, warns = items.filter((i) => i.status === 'warn').length;
      return { items: items, fails: fails, warns: warns, verdict: fails ? 'fail' : warns ? 'warn' : 'ok' };
    })();

    // the global dark toggle drives the editor: dark → the "night" paper theme; light → the user's pick
    const globalDark = !!(window.PRTheme ? window.PRTheme.isDark() : document.documentElement.classList.contains('dark'));
    const effTheme = globalDark ? 'night' : (t.theme || 'paper');
    const themeVars = {
      paper: { bg: '#eceef1', pane: '#ffffff', paperBg: '#ffffff', ink: '#1d2430' },
      sepia: { bg: '#e9e2d2', pane: '#fbf6ea', paperBg: '#fbf6ea', ink: '#3a3220' },
      night: { bg: '#0f1320', pane: '#161b29', paperBg: '#1b2233', ink: '#dfe6f2' }
    }[effTheme] || {};
    // the light highlight pastels would hide light text on the dark paper — tint instead of cover
    const readingHl = effTheme === 'night' ? ('color-mix(in srgb, ' + (t.reading || '#ffe08a') + ' 32%, transparent)') : t.reading;

    return (
      <div className="app" data-theme={effTheme} style={{
        '--reading': readingHl, '--serif-size': t.serifSize + 'px', '--mono-size': t.monoSize + 'px',
        '--paper-width': t.paperWidth + 'px', '--app-bg': themeVars.bg, '--pane': themeVars.pane,
        '--paper-bg': themeVars.paperBg, '--ink': themeVars.ink, '--dim': t.dimInactive ? 1 : 0
      }}>
        <header className="topbar">
          <div className="brand">
            <a className="back-btn" href="Projects.html" title="Back to projects">
              <svg viewBox="0 0 16 16" width="15" height="15"><path d="M10 3L5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </a>
            <div className="brand-mark"><span></span></div>
            <div className="brand-text"><b>{init.title || 'Publify'}</b><i>researcher profiles &amp; publications</i><span id="pr-ver-slot" className="pr-ver-slot"></span></div>
          </div>
          <div className="topbar-center">
            <span className="file-chip"><svg viewBox="0 0 16 16" className="dot"><circle cx="8" cy="8" r="4" /></svg>{active ? bn(active) : 'No file open'}</span>
          </div>
          <div className="topbar-actions">
            <Collab.PresenceBar peers={peers} />
            <span className={'role-tag role-' + myRole}>{myRole}</span>
            <div className="collab-toggles">
              <button className={'ct' + (drawer.open && drawer.tab === 'comments' ? ' on' : '')} title="Comments" aria-label="Comments" aria-pressed={drawer.open && drawer.tab === 'comments'} onClick={() => toggleDrawer('comments')}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 3.5h12v8H8l-3 2.5V11.5H2z" strokeLinejoin="round" /></svg>{openComments ? <i className="ct-badge">{openComments}</i> : null}</button>
              <button className={'ct' + (drawer.open && drawer.tab === 'todos' ? ' on' : '')} title="To-dos" aria-label="To-dos" aria-pressed={drawer.open && drawer.tab === 'todos'} onClick={() => toggleDrawer('todos')}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="2.5" y="2.5" width="11" height="11" rx="2" /><path d="M5.5 8l2 2 3.5-4" strokeLinecap="round" strokeLinejoin="round" /></svg>{openTodos ? <i className="ct-badge">{openTodos}</i> : null}</button>
              <button className={'ct' + (drawer.open && drawer.tab === 'history' ? ' on' : '')} title="Version history" aria-label="Version history" aria-pressed={drawer.open && drawer.tab === 'history'} onClick={() => toggleDrawer('history')}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M8 4v4l3 1.5" strokeLinecap="round" /><path d="M2.5 8a5.5 5.5 0 105.5-5.5A5.5 5.5 0 003.2 5" /><path d="M2.5 2.5V5H5" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
              <button className={'ct' + (drawer.open && drawer.tab === 'activity' ? ' on' : '')} title="Activity" aria-label="Activity" aria-pressed={drawer.open && drawer.tab === 'activity'} onClick={() => toggleDrawer('activity')}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 8h3l1.5 4 3-8L13.5 8H14" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
              <button className={'ct' + (drawer.open && drawer.tab === 'kpi' ? ' on' : '')} title="KPIs & format compliance" aria-label="KPIs & format compliance" aria-pressed={drawer.open && drawer.tab === 'kpi'} onClick={() => toggleDrawer('kpi')}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 14V8M6 14V4M10 14v-3M14 14V6" strokeLinecap="round" /></svg></button>
              <button className={'ct' + (drawer.open && drawer.tab === 'review' ? ' on' : '')} title="AI review" aria-label="AI review" aria-pressed={drawer.open && drawer.tab === 'review'} onClick={() => toggleDrawer('review')}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M8 1.7l1.7 3.7 4 .4-3 2.7.9 4L8 12.9 4.4 14.5l.9-4-3-2.7 4-.4z" strokeLinejoin="round" /></svg>{openReview ? <i className="ct-badge">{openReview}</i> : null}</button>
              <button className={'ct' + (drawer.open && drawer.tab === 'numbers' ? ' on' : '')} title="Number consistency" aria-label="Number consistency" aria-pressed={drawer.open && drawer.tab === 'numbers'} onClick={() => toggleDrawer('numbers')}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M3 5h3M3 8h6M3 11h4" strokeLinecap="round" /><path d="M11.5 4v8M9.7 5.6L11.5 4l1.8 1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>{consistencyConflicts ? <i className="ct-badge warn">{consistencyConflicts}</i> : null}</button>
              {spellAvailable && <button className={'ct' + (drawer.open && drawer.tab === 'spelling' ? ' on' : '')} title="Spell check (HU/EN)" aria-label="Spell check (HU/EN)" aria-pressed={drawer.open && drawer.tab === 'spelling'} onClick={() => { const opening = !(drawer.open && drawer.tab === 'spelling'); toggleDrawer('spelling'); if (opening && !spellOn) setSpellOn(true); }}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 12l2.6-7 2.6 7M3 9.5h3.2" strokeLinecap="round" strokeLinejoin="round" /><path d="M9.5 12l2-3 2 3M10 10.6h3" strokeLinecap="round" strokeLinejoin="round" /></svg>{spellOn && spellCount ? <i className="ct-badge warn">{spellCount}</i> : null}</button>}
              <button className={'ct' + (drawer.open && drawer.tab === 'refs' ? ' on' : '')} title="References & citations" aria-label="References & citations" aria-pressed={drawer.open && drawer.tab === 'refs'} onClick={() => toggleDrawer('refs')}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M4 2.5h6l2.5 2.5V13.5H4z" strokeLinejoin="round" /><path d="M6.2 6h4M6.2 8.3h4M6.2 10.6h2.6" strokeLinecap="round" /></svg>{refsIssues ? <i className="ct-badge warn">{refsIssues}</i> : null}</button>
            </div>
            {isAdmin && <a className="btn btn-icon" href="Admin.html" title="Admin" aria-label="Admin">
              <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M8 1.8l5 1.9v3.6c0 3-2.1 5.2-5 6.1-2.9-.9-5-3.1-5-6.1V3.7z" /><path d="M5.8 8l1.6 1.6L10.4 6.5" /></svg>
            </a>}
            <button className="btn" onClick={() => setShareOpen(true)}>
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="4" cy="8" r="2" /><circle cx="12" cy="4" r="2" /><circle cx="12" cy="12" r="2" /><path d="M5.8 7l4.4-2.2M5.8 9l4.4 2.2" /></svg>Share
            </button>
            <input ref={fileInput} type="file" multiple accept=".tex,.bib,.bbl,.bst,.cls,.sty,.txt,.md,.markdown,.pdf,application/pdf,.docx,.xlsx,.xls,.pptx,image/*" style={{ display: 'none' }} onChange={onUpload} />
            <input ref={reviewInput} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={onReviewFile} />
            <input ref={dirInput} type="file" multiple style={{ display: 'none' }} onChange={onUploadFolder} />
            <button className="btn btn-icon" title="Upload files" aria-label="Upload files" onClick={() => fileInput.current.click()}>
              <svg viewBox="0 0 16 16" width="15" height="15"><path d="M8 2v8M8 2L5 5M8 2l3 3M3 11v2a1 1 0 001 1h8a1 1 0 001-1v-2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            <button className="btn btn-icon" title="Upload folder" aria-label="Upload folder" onClick={() => dirInput.current.click()}>
              <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M1.8 5c0-.5.4-.9.9-.9h2.6c.3 0 .5.1.7.3l.7.8h5.6c.5 0 .9.4.9.9V12c0 .5-.4.9-.9.9H2.7c-.5 0-.9-.4-.9-.9z" /><path d="M8 11.6V7M8 7L6.4 8.6M8 7l1.6 1.6" /></svg>
            </button>
            <button className="btn btn-icon" title={dlBusy ? 'Downloading project…' : 'Download project (.zip — all files + images + the comments/to-dos database)'} aria-label={dlBusy ? 'Downloading project…' : 'Download project (.zip — all files + images + the comments/to-dos database)'} onClick={downloadProject} disabled={dlBusy} style={dlBusy ? { opacity: .6 } : null}>
              <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2.5v6.5M5.4 6.4L8 9l2.6-2.6M3 12.5h10" /></svg>
            </button>
            <div className="acct-mini">
              <button className="acct-btn" title="Account" aria-label="Account" aria-expanded={acctOpen} onClick={(e) => { e.stopPropagation(); setAcctOpen((v) => !v); }}><Collab.Avatar user={me} size={30} /></button>
              {acctOpen && <React.Fragment>
                <div className="acct-scrim" onClick={() => setAcctOpen(false)} />
                <aside className="acct-drawer" onClick={(e) => e.stopPropagation()}>
                  <a className="adr-head" href="Profile.html" title="Open your profile"><Collab.Avatar user={me} size={42} /><div style={{ minWidth: 0, flex: 1 }}><b>{me.name}</b><small>{me.email}</small></div></a>
                  <div className="adr-nav">
                    <a className="adr-i" href="Profile.html"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="8" cy="5.5" r="2.5" /><path d="M3.5 13.5c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4" strokeLinecap="round" /></svg>Open profile</a>
                    <a className="adr-i" href="Profile.html#settings"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="3.5" y="7" width="9" height="6" rx="1.4" /><path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" strokeLinecap="round" /></svg>Change password</a>
                    <a className="adr-i" href="PhD.html"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M8 2L1.5 5 8 8l6.5-3L8 2z" strokeLinejoin="round" /><path d="M4.5 6.3v3.4c0 1 1.6 1.8 3.5 1.8s3.5-.8 3.5-1.8V6.3M14.5 5.2v3.3" strokeLinecap="round" /></svg>Doctoral School</a>
                    <a className="adr-i" href="Research.html"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M6.5 2v4L3 12.2A1.4 1.4 0 0 0 4.2 14h7.6A1.4 1.4 0 0 0 13 12.2L9.5 6V2" strokeLinejoin="round" /><path d="M5.5 2h5M5.6 9h4.8" strokeLinecap="round" /></svg>Research</a>
                    <a className="adr-i" href="Projects.html"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M10 3L5 8l5 5" strokeLinecap="round" strokeLinejoin="round" /></svg>Back to projects</a>
                  </div>
                  <div className="adr-sub">Switch account</div>
                  <div className="adr-nav">{(window.PRAuth.demoUsers ? window.PRAuth.demoUsers() : []).filter((u) => u.id !== me.id).map((u) => <button key={u.id} className="adr-i" onClick={() => { window.PRAuth.signIn(u.id); location.reload(); }}><Collab.Avatar user={u} size={22} />{u.name}</button>)}</div>
                  <div className="adr-foot"><button className="adr-i danger" onClick={() => { window.PRAuth.signOut(); location.href = 'Projects.html'; }}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M6 14H3V2h3M10 11l3-3-3-3M13 8H6" strokeLinecap="round" strokeLinejoin="round" /></svg>Sign out</button></div>
                </aside>
              </React.Fragment>}
            </div>
          </div>
        </header>

        <div className="workspace">
          <FilePanel files={files} order={order} folders={folders} active={active} width={fileW}
            outline={outline} onGoto={gotoOffset}
            expanded={expanded} currentDir={currentDir} renaming={renaming}
            onOpen={(p) => {
              const f = files[p];
              if (f && (f.type === 'pdf' || f.type === 'image')) { wsOnAddMedia(f.type, p); return; }
              if (!docExists(p)) return;
              // rebind the source/preview/compiled panes that follow the active doc so the clicked file shows
              const old = active;
              if (p !== old) setLayout((lay) => {
                const SK = { source: 1, preview: 1, compiled: 1 };
                const followers = WS.allPanes(lay).filter((pane) => SK[pane.kind] && pane.docId === old);
                let r = lay;
                if (followers.length) followers.forEach((pane) => { r = WS.patchPane(r, pane.id, { docId: p }); });
                else { const fp = WS.allPanes(lay).find((pane) => SK[pane.kind]); if (fp) r = WS.patchPane(r, fp.id, { docId: p }); }
                return r;
              });
              setActive(p);
            }} onToggle={toggleExpand} onSetDir={setCurrentDir}
            onNewFile={addFile} onNewFolder={addFolder} onUploadClick={() => fileInput.current.click()} onUploadFolderClick={() => dirInput.current.click()}
            onCommitRename={commitRename} onCancelRename={() => setRenaming(null)} onStartRename={(type, path) => setRenaming({ type, path })}
            onDeleteFile={deleteFile} onDeleteFolder={deleteFolder} onMove={moveItem}
            onSetNote={(path, note) => setFiles((f) => f[path] ? { ...f, [path]: { ...f[path], note: note } } : f)} />

          <div className="splitter" onMouseDown={startFileDrag} title="Drag to resize the file browser"><span></span></div>

          <div className="ws-area">
            <div className="ws-toolbar">
              <window.Workspace.Presets ctx={{ preset, onPreset: wsOnPreset }} />
              <span className="ws-tb-sp" />
              {canFigures ? <button className="ws-tb-btn" title="Generate AI figure (PaperBanana)" onClick={() => setFigOpen(true)}>✨ Figure</button> : null}
              {diags.length > 0
                ? <div className="diag-wrap">
                    <button className={'diag-chip' + (diagOpen ? ' on' : '')} title="Rendering issues" onClick={(e) => { e.stopPropagation(); setDiagOpen((o) => !o); }}>
                      <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 2l6 11H2z" strokeLinejoin="round" /><path d="M8 6.5v3" strokeLinecap="round" /><circle cx="8" cy="11.2" r=".6" fill="currentColor" stroke="none" /></svg>
                      {diags.length} {diags.length === 1 ? 'issue' : 'issues'}
                    </button>
                    {diagOpen && <div className="diag-pop" onClick={(e) => e.stopPropagation()}>
                      <div className="diag-head">Rendering issues · {bn(active)}</div>
                      {diags.map((d, di) => {
                        const fix = (files[active] && files[active].type === 'tex') ? fixForDiag(d, source) : null;
                        const canGoto = d.at != null && files[active] && files[active].type === 'tex';
                        return (
                          <div key={di} className="diag-row">
                            <span className={'diag-dot ' + (d.severity || 'warn')}></span>
                            <span className="diag-msg" style={canGoto ? { cursor: 'pointer' } : null} onClick={canGoto ? () => { setDiagOpen(false); setSelectReq({ start: d.at, end: d.at, nonce: Date.now() }); } : undefined}>
                              {d.message}{d.detail ? <em> — {d.detail.slice(0, 60)}</em> : null}
                            </span>
                            {fix && <button className="diag-fix" title={fix.label} onClick={() => applyFix(fix)}>Fix</button>}
                          </div>
                        );
                      })}
                    </div>}
                  </div>
                : <span className="ph-ok"><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 8.5l3 3 7-8" strokeLinecap="round" strokeLinejoin="round" /></svg>Rendered</span>}
              <button className="ws-tb-btn" title="Download the rendered PDF (real TeX → PDF)" onClick={downloadPdf} disabled={pdfWantDl}>
                {pdfWantDl
                  ? <><span className="pr-spin" aria-hidden="true" /> Compiling…</>
                  : <><svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2.5v7M5 7l3 3 3-3M3 13h10" /></svg> PDF</>}
              </button>
              <div className="add-wrap">
                <button className={'btn add-pane-btn' + (addOpen ? ' on' : '')} onClick={(e) => { e.stopPropagation(); setAddOpen((v) => !v); }}>
                  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M8 3v10M3 8h10" /></svg>Add pane
                </button>
                {addOpen && <window.Workspace.AddPaneMenu onClose={() => setAddOpen(false)} ctx={{
                  activeDocId: active, docColor, listFiles: listProjFiles, myProjects, projTexFiles,
                  onAddKind: wsOnAddKind, onAddMedia: wsOnAddMedia, onAddExternal: wsOnAddExternal, onUploadPdf: wsOnUploadPdf
                }} />}
              </div>
            </div>

            <window.Workspace.Workspace ctx={{
              layout, focusedPaneId, soloPaneId, activeDocId: active, status, sentence, selectReq, readLine,
              monoSize: t.monoSize, canEdit, canComment, bibKeys, bibMeta,
              writeMode, setWrite: setWriteMode, onPreviewEdit, onBlockTransform, onInsertBlock, onTableEdit, onInsertImage, onInsertImageBlob,
              isCurProj, docExists, readOnlyDoc, getSource, getCompiled, docLabel, docColor,
              getCompiledPdf, requestCompile, onCompileExact, annoMarks: annoMarksFor, spellMarks: spellMarksFor, annoSids: annoSidsFor, annoForSentence, onOpenBubble, voicedSids: voicedSidsFor, reviewSids: reviewSidsFor,
              hlHide: (hlShow.comment ? '' : ' hl-hide-comment') + (hlShow.todo ? '' : ' hl-hide-todo') + (hlShow.spell ? '' : ' hl-hide-spell'),
              canClose: window.WS.allPanes(layout).length > 1,
              onFocus: wsOnFocus, onAdd: wsOnAdd, onSplit: wsOnAdd, onClose: wsOnClose, onSolo: wsOnSolo, onSetRatio: wsOnSetRatio,
              dragId, onDragStart: (id) => setDragId(id), onDragEnd: () => setDragId(null), onMovePane: wsOnMovePane,
              onRebind: wsOnRebind, onEditSource: (docId, v) => { if (docId === active) handleEdit(v); },
              onCaret: (pane, off) => { if (pane.docId === active) onCaret(off); }, onJump: (pane, off) => { if (pane.docId === active) onEditorJump(off); },
              onSourceSel, onPreviewClick, onPreviewMouseUp, onPreviewScroll, registerPreview,
              getFileURL, getFileData, onPrint: onPrintDoc, onWord: onWordDoc, listFiles: listProjFiles, externalDocs: externalDocsList,
              selPaneId, selQuote, selPos, onComment: () => startAnnotation('comment'), onTodo: () => startAnnotation('todo'), onCloseSel: () => { setSelQuote(''); setSelPaneId(null); }
            }} />
          </div>

          {drawer.open && <Collab.RightDrawer tab={drawer.tab} setTab={(tb) => setDrawer({ open: true, tab: tb })} onClose={() => setDrawer({ open: false, tab: drawer.tab })}
            me={me} project={projForShare} members={collabMembers} canEdit={canEdit} docName={bn(active)}
            annotations={displayAnns} draft={draft} onSaveDraft={saveDraft} onCancelDraft={() => setDraft(null)}
            onReply={onReply} onResolve={onResolve} onDelete={onDeleteAnn} onToggleTodo={onToggleTodo} onJump={onJumpAnn} onEdit={onEditAnn}
            versions={versions} onCompare={(v) => setDiffVersion(v)} onRestore={onRestore} onSaveVersion={onSaveVersion}
            activity={projMeta.activity}
            metrics={kpiMetrics} journalMeta={projMeta.journalMeta} journal={projMeta.journal} templateId={projMeta.templateId}
            readiness={readiness} coverTitle={init.title} coverAuthor={me.name}
            submission={projMeta.submission} onSetStatus={setSubmissionStatus} tts={projMeta.tts} engine={voice.engine} model={voice.model}
            review={reviewAnns} reviewFocus={reviewFocus} onImportReview={onImportReview} onClearReview={onClearReview} onApplyReview={onApplyReview} canImport={isCurProj(active)}
            consistency={consistency} onGotoOff={gotoOffset}
            refs={refs} onGotoRef={gotoRef} onAddDoi={onAddDoi} bibPaths={bibPaths}
            spellOn={spellOn} onToggleSpell={() => setSpellOn((s) => !s)} spell={spellResult} spellBusy={spellBusy} spellErr={spellErr}
            spellLang={spellLang} spellLangPref={spellLangPref} onSetSpellLang={setSpellLangPref} spellLangs={window.PRSpell ? window.PRSpell.langs : {}}
            spellPersonal={spellPersonal} onSpellGoto={gotoOffset} onSpellSuggest={onSpellSuggest} onSpellReplaceAll={onSpellReplaceAll}
            onSpellAddDict={onSpellAddDict} onSpellIgnore={onSpellIgnore} onSpellUndoDict={onSpellUndoDict} onSpellRetry={() => setSpellRetry((n) => n + 1)} />}
          <input ref={pdfInput} type="file" accept="application/pdf,.pdf" style={{ display: 'none' }} onChange={onPdfPicked} />
          <input ref={imgInsertInput} type="file" accept="image/png,image/jpeg,image/gif,image/svg+xml,.png,.jpg,.jpeg,.gif,.svg" style={{ display: 'none' }} onChange={onInsertImagePicked} />
          <FigureGenModal open={figOpen} defaultCaption="" defaultMethod="" onClose={() => setFigOpen(false)} onPick={(blob, cap) => { onInsertFigure(blob, cap); setFigOpen(false); }} />
        </div>

        <Transport status={status} idx={idx} total={total} sentence={sentence} docLabel={bn(active)}
          onPlay={play} onStop={stop} onPrev={() => step(-1)} onNext={() => step(1)} onSeek={seekTo}
          rate={rate} setRate={setRate} voices={voices} voiceURI={voiceURI} setVoiceURI={setVoiceURI}
          onVoice={() => setVoiceOpen((v) => !v)} engine={voice.engine} busy={elevenBusy} err={elevenErr}
          showVoiced={showVoiced} onToggleVoiced={() => setShowVoiced((v) => !v)}
          showReview={showReview} onToggleReview={() => setShowReview((v) => !v)} hasReview={reviewAnns.length > 0}
          hlShow={hlShow} onToggleHl={(k) => setHlShow((s) => Object.assign({}, s, { [k]: !s[k] }))}
          onBookmark={saveReading} saved={savedFlash} />

        {bubble && <Collab.BubbleThreads rect={bubble.rect} anns={annoObjsForSentence(bubble.docId, bubble.sid)}
          me={me} members={collabMembers} canEdit={canEdit}
          onReply={onReply} onResolve={onResolve} onDelete={onDeleteAnn} onToggleTodo={onToggleTodo}
          onJump={onJumpAnn} onEdit={onEditAnn} onClose={() => setBubble(null)} />}

        {shareOpen && <Collab.ShareModal project={projForShare} me={me} onClose={() => setShareOpen(false)} onChange={refreshCollab} />}
        {diffVersion && <Collab.DiffModal version={diffVersion} file={active} currentSource={source} onClose={() => setDiffVersion(null)} onRestore={onRestore} />}
        {resume != null && !editPaused && <Collab.ResumePill n={resume} onResume={() => { seekTo(resume - 1); setResume(null); }} onDismiss={() => setResume(null)} />}
        {editPaused && <Collab.ResumePill label={'Paused while you edit — resume from sentence ' + (idx + 1)} onResume={() => { setEditPaused(false); play(); }} onDismiss={() => setEditPaused(false)} />}
        {storageWarn && <div className="storage-toast"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 5v4" strokeLinecap="round" /><circle cx="8" cy="11.5" r=".6" fill="currentColor" /><path d="M8 2l6 11H2z" strokeLinejoin="round" /></svg><div><b>Storage is full</b><span>Your latest change may not have saved. Delete old versions or large attachments to free space.</span></div><button onClick={() => setStorageWarn(false)}>✕</button></div>}
        {voiceOpen && <Collab.VoiceSettings engine={voice.engine} elevenVoice={voice.elevenVoice} model={voice.model} stability={voice.stability} similarity={voice.similarity} set={(patch) => setVoice((v) => Object.assign({}, v, patch))}
          pron={pronDict} onSetPron={setPronAndSave} narr={narr} narrationStats={narrationStats} onDownloadNarration={downloadNarration} onCancelNarration={cancelNarration} />}
        {annoPop && <Collab.AnnoPopover pop={annoPop} onEnter={() => clearTimeout(annoPopTimer.current)} onLeave={() => setAnnoPop(null)} />}

        {uploads.length > 0 && <UploadModal items={uploads} onClose={() => setUploads([])} />}
        {t.renderMode === 'manual' && renderStale && <button className="render-pill" onClick={renderNow} title="Render preview (⌘/Ctrl + Enter)"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M13 8a5 5 0 11-1.5-3.5M13 2v3h-3" strokeLinecap="round" strokeLinejoin="round" /></svg>Render preview</button>}

        {<button className="tweaks-fab" onClick={() => window.postMessage({ type: '__activate_edit_mode' }, '*')} title="Settings & Tweaks"><svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="10" cy="10" r="2.7" /><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" strokeLinecap="round" /></svg></button>}

        {cmdk && <CommandPalette onClose={() => setCmdk(false)} items={[
          { group: 'Reading', label: status === 'playing' ? 'Pause reading' : 'Play — read aloud', hint: 'Space', run: play },
          { group: 'Reading', label: 'Stop reading', run: stop },
          { group: 'Reading', label: 'Next sentence', hint: '⌥→', run: () => step(1) },
          { group: 'Reading', label: 'Previous sentence', hint: '⌥←', run: () => step(-1) },
          { group: 'Document', label: 'Comments', run: () => setDrawer({ open: true, tab: 'comments' }) },
          { group: 'Document', label: 'To-dos', run: () => setDrawer({ open: true, tab: 'todos' }) },
          { group: 'Document', label: 'Version history', run: () => setDrawer({ open: true, tab: 'history' }) },
          { group: 'Document', label: 'Activity', run: () => setDrawer({ open: true, tab: 'activity' }) },
          { group: 'Document', label: 'Share…', run: () => setShareOpen(true) },
          { group: 'Document', label: 'Render preview now', hint: '⌘⏎', run: renderNow },
          { group: 'Document', label: 'Print / Export PDF', run: () => onPrintDoc && onPrintDoc() },
          { group: 'Document', label: 'Export to Word (.docx)', run: () => onWordDoc && onWordDoc() },
        ].concat(outline.map((o) => ({ group: 'Go to', label: o.title, hint: o.kind, run: () => gotoOffset(o.off) })))} />}

        <TweaksPanel>
          <TweakSection label="Appearance" />
          <TweakRadio label="Theme" value={t.theme} options={["paper", "sepia", "night"]} onChange={(v) => setTweak('theme', v)} />
          <TweakColor label="Reading highlight" value={t.reading} options={["#ffe08a", "#bfe3ff", "#c8f2d4", "#ffc9d6", "#e3d2ff"]} onChange={(v) => setTweak('reading', v)} />
          <TweakToggle label="Dim other sentences" value={t.dimInactive} onChange={(v) => setTweak('dimInactive', v)} />
          <TweakSection label="Typography" />
          <TweakSlider label="Preview text" value={t.serifSize} min={13} max={22} step={0.5} unit="px" onChange={(v) => setTweak('serifSize', v)} />
          <TweakSlider label="Editor text" value={t.monoSize} min={11} max={18} step={0.5} unit="px" onChange={(v) => setTweak('monoSize', v)} />
          <TweakSlider label="Page width" value={t.paperWidth} min={560} max={900} step={10} unit="px" onChange={(v) => setTweak('paperWidth', v)} />
          <TweakSection label="Rendering" />
          <TweakRadio label="Preview" value={t.renderMode || 'auto'} options={["auto", "manual"]} onChange={(v) => setTweak('renderMode', v)} />
          <TweakToggle label="Number sections" value={t.numberSections !== false} onChange={(v) => setTweak('numberSections', v)} />
          <TweakRadio label="Citations" value={t.citeStyle || 'numeric'} options={["numeric", "author-year"]} onChange={(v) => setTweak('citeStyle', v)} />
          <TweakSection label="Export" />
          <button className="tp-pdf-btn" onClick={() => onPrintDoc && onPrintDoc()}>
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 2v8M8 10l-3-3M8 10l3-3M3 12.5h10" strokeLinecap="round" strokeLinejoin="round" /></svg>
            Download PDF
          </button>
        </TweaksPanel>
      </div>
    );
  }

  function RenameInput(props) {
    const r = useRef(null);
    const [v, setV] = useState(props.value);
    useEffect(() => { if (r.current) { r.current.focus(); const d = v.lastIndexOf('.'); r.current.setSelectionRange(0, d > 0 ? d : v.length); } }, []);
    return <input ref={r} className="tree-rename" value={v} onClick={(e) => e.stopPropagation()}
      onChange={(e) => setV(e.target.value)} onBlur={() => props.onCommit(v)}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); props.onCommit(v); } else if (e.key === 'Escape') props.onCancel(); }} />;
  }

  function FilePanel(props) {
    const [dragOver, setDragOver] = useState(null);
    const [notePath, setNotePath] = useState(null); // file whose note editor is open
    const [outlineOpen, setOutlineOpen] = useState(true);
    const OUT_LEVEL = { part: 0, chapter: 0, section: 1, subsection: 2, subsubsection: 3, figure: 2, table: 2 };
    const noteIco = <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="6" /><path d="M8 7.2v3.4" strokeLinecap="round" /><circle cx="8" cy="5.2" r=".5" fill="currentColor" /></svg>;
    const ico = (type) => {
      if (type === 'pdf') return <svg viewBox="0 0 16 16"><path d="M3.5 2.5h6l3 3V13a.5.5 0 01-.5.5h-8A.5.5 0 013 13V3a.5.5 0 01.5-.5z" fill="none" stroke="currentColor" strokeWidth="1.2" /><text x="8" y="11.5" fontSize="4" textAnchor="middle" fill="currentColor" fontFamily="sans-serif" fontWeight="700">PDF</text></svg>;
      if (type === 'image') return <svg viewBox="0 0 16 16"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" /><circle cx="5.5" cy="6" r="1.2" fill="currentColor" /><path d="M2 12l3.5-3 2.5 2 3-3.5 3 4.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg>;
      if (type === 'bib') return <svg viewBox="0 0 16 16"><path d="M3 2.5h7l3 3V13a.5.5 0 01-.5.5h-9A.5.5 0 013 13z" fill="none" stroke="currentColor" strokeWidth="1.2" /><path d="M6 8h4M6 10.5h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>;
      return <svg viewBox="0 0 16 16"><path d="M3.5 2.5h6l3 3V13a.5.5 0 01-.5.5h-8A.5.5 0 013 13V3a.5.5 0 01.5-.5z" fill="none" stroke="currentColor" strokeWidth="1.2" /><text x="8" y="11" fontSize="5" textAnchor="middle" fill="currentColor" fontFamily="serif">T</text></svg>;
    };
    const folderIco = <svg viewBox="0 0 16 16" fill="currentColor"><path d="M1.6 4.3c0-.6.4-1 1-1h3c.3 0 .5.1.7.3l.9 1h5.2c.6 0 1 .5 1 1v6c0 .6-.4 1-1 1H2.6c-.6 0-1-.4-1-1z" /></svg>;
    const chev = (open) => <span className={'chev' + (open ? ' open' : '')}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M6 4l4 4-4 4" /></svg></span>;
    const trash = <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M3 4h10M6 4V2.6h4V4M4.6 4l.5 9h5.8l.5-9" strokeLinecap="round" strokeLinejoin="round" /></svg>;
    const plus = <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M8 4v8M4 8h8" /></svg>;

    const subfolders = (dir) => props.folders.filter((f) => dn(f) === dir).sort((a, b) => bn(a).localeCompare(bn(b)));
    const filesIn = (dir) => props.order.filter((p) => props.files[p] && dn(p) === dir);
    const renaming = props.renaming;

    function renderFolder(path, depth) {
      const open = props.expanded.has(path);
      const isRen = renaming && renaming.type === 'folder' && renaming.path === path;
      return (
        <div key={'d:' + path}>
          <div className={'tree-row folder' + (props.currentDir === path ? ' sel' : '') + (dragOver === path ? ' drop' : '')}
            style={{ paddingLeft: 8 + depth * 14 }} draggable
            onClick={() => { props.onSetDir(path); props.onToggle(path); }}
            onDragStart={(e) => { e.stopPropagation(); e.dataTransfer.setData('text/plain', path); e.dataTransfer.effectAllowed = 'move'; }}
            onDragOver={(e) => { e.preventDefault(); setDragOver(path); }}
            onDragLeave={() => setDragOver((d) => d === path ? null : d)}
            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(null); const fp = e.dataTransfer.getData('text/plain'); if (fp) props.onMove(fp, path); }}>
            {chev(open)}
            <span className="fp-ico folder-ico">{folderIco}</span>
            {isRen ? <RenameInput value={bn(path)} onCommit={props.onCommitRename} onCancel={props.onCancelRename} />
              : <span className="fp-name" onDoubleClick={(e) => { e.stopPropagation(); props.onStartRename('folder', path); }}>{bn(path)}</span>}
            <span className="row-actions" onClick={(e) => e.stopPropagation()}>
              <button title="New file here" onClick={() => props.onNewFile(path)}>{plus}</button>
              <button className="del" title="Delete folder" onClick={() => props.onDeleteFolder(path)}>{trash}</button>
            </span>
          </div>
          {open && <div>{subfolders(path).map((f) => renderFolder(f, depth + 1))}{filesIn(path).map((p) => renderFile(p, depth + 1))}</div>}
        </div>
      );
    }

    function renderFile(path, depth) {
      const f = props.files[path];
      const isRen = renaming && renaming.type === 'file' && renaming.path === path;
      return (
        <React.Fragment key={'f:' + path}>
        <div className={'tree-row file' + (props.active === path ? ' active' : '')}
          style={{ paddingLeft: 8 + depth * 14 }} draggable
          onDragStart={(e) => { e.dataTransfer.setData('text/plain', path); e.dataTransfer.effectAllowed = 'move'; }}
          onClick={() => { props.onSetDir(dn(path)); props.onOpen(path); }}>
          <span className="chev-spacer"></span>
          <span className="fp-ico">{ico(f.type)}</span>
          {isRen ? <RenameInput value={bn(path)} onCommit={props.onCommitRename} onCancel={props.onCancelRename} />
            : <span className="fp-name" onDoubleClick={(e) => { e.stopPropagation(); props.onStartRename('file', path); }}>{bn(path)}</span>}
          {f.note ? <span className="fp-note-dot" title={f.note} /> : null}
          <span className="row-actions" onClick={(e) => e.stopPropagation()}>
            <button className={'fnote' + (f.note ? ' has' : '')} title={f.note ? 'Edit file note' : 'Add a note (what this file is / why it was added)'} onClick={() => setNotePath(notePath === path ? null : path)}>{noteIco}</button>
            <button className="del" title="Delete file" onClick={() => props.onDeleteFile(path)}>{trash}</button>
          </span>
        </div>
        {notePath === path && <div className="fp-note-edit" style={{ paddingLeft: 8 + (depth + 1) * 14 }} onClick={(e) => e.stopPropagation()}>
          <textarea autoFocus defaultValue={f.note || ''} placeholder="What is this file? Why was it added? (visible to collaborators & agents)"
            onBlur={(e) => { props.onSetNote(path, e.target.value.trim()); setNotePath(null); }}
            onKeyDown={(e) => { if (e.key === 'Escape') setNotePath(null); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { props.onSetNote(path, e.target.value.trim()); setNotePath(null); } }} />
          <div className="fp-note-hint">Esc to cancel · ⌘/Ctrl+Enter to save</div>
        </div>}
      </React.Fragment>
      );
    }

    return (
      <aside className="filepanel" style={props.width ? { width: props.width } : null}>
        <div className="fp-head">
          <span className="fp-title">Project</span>
          <div className="fp-actions">
            <button title="New file" onClick={() => props.onNewFile()}>{plus}</button>
            <button title="New folder" onClick={() => props.onNewFolder()}>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M1.8 4.3c0-.5.4-.9.9-.9h2.8c.3 0 .5.1.7.3l.8.9h5.3c.5 0 .9.4.9.9V12c0 .5-.4.9-.9.9H2.7c-.5 0-.9-.4-.9-.9z" /><path d="M8 6.5v3.4M6.3 8.2h3.4" strokeLinecap="round" /></svg>
            </button>
            <button title="Upload files" onClick={props.onUploadClick}>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2v8M8 2L5 5M8 2l3 3M3 11v2a1 1 0 001 1h8a1 1 0 001-1v-2" /></svg>
            </button>
            <button title="Upload folder" onClick={props.onUploadFolderClick}>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M1.8 5c0-.5.4-.9.9-.9h2.6c.3 0 .5.1.7.3l.7.8h5.6c.5 0 .9.4.9.9V12c0 .5-.4.9-.9.9H2.7c-.5 0-.9-.4-.9-.9z" /><path d="M8 11.6V7M8 7L6.4 8.6M8 7l1.6 1.6" /></svg>
            </button>
          </div>
        </div>
        <div className={'fp-list' + (dragOver === '__root__' ? ' drop-root' : '')}
          onClick={(e) => { if (e.target === e.currentTarget) props.onSetDir(''); }}
          onDragOver={(e) => { e.preventDefault(); setDragOver('__root__'); }}
          onDragLeave={(e) => { if (e.target === e.currentTarget) setDragOver((d) => d === '__root__' ? null : d); }}
          onDrop={(e) => { e.preventDefault(); setDragOver(null); const fp = e.dataTransfer.getData('text/plain'); if (fp) props.onMove(fp, ''); }}>
          {subfolders('').map((f) => renderFolder(f, 0))}
          {filesIn('').map((p) => renderFile(p, 0))}
        </div>
        {props.outline && props.outline.length > 0 && <div className="fp-outline">
          <button className="fp-out-head" onClick={() => setOutlineOpen((o) => !o)}>
            <span className={'chev' + (outlineOpen ? ' open' : '')}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M6 4l4 4-4 4" /></svg></span>
            Outline<i className="fp-out-n">{props.outline.length}</i>
          </button>
          {outlineOpen && <div className="fp-out-list">
            {props.outline.map((o, i) => <button key={i} className={'fp-out-i k-' + o.kind} style={{ paddingLeft: 10 + (OUT_LEVEL[o.kind] || 0) * 12 }} title={o.title} onClick={() => props.onGoto && props.onGoto(o.off)}>
              {(o.kind === 'figure' || o.kind === 'table') ? <span className="fp-out-tag">{o.kind === 'figure' ? 'Fig' : 'Tab'}</span> : null}
              <span className="fp-out-t">{o.title}</span>
            </button>)}
          </div>}
        </div>}
        <div className="fp-foot">Drag files into folders · double-click to rename · click an outline item to jump</div>
      </aside>
    );
  }

  function NonText(props) {
    const f = props.file;
    return (
      <div className="nontext">
        {f && f.type === 'image'
          ? <div className="nt-img"><img src={f.dataURL || f.src} alt={props.name} /><div className="nt-cap">{props.name}</div></div>
          : <div className="nt-msg">Open a <b>.tex</b> file to edit and read it aloud.</div>}
      </div>
    );
  }

  function Splitter(props) {
    const onDown = (e) => {
      e.preventDefault();
      const w = e.currentTarget.parentElement.getBoundingClientRect().width;
      let last = e.clientX;
      const mv = (ev) => { props.onDrag(ev.clientX - last, w); last = ev.clientX; };
      const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); document.body.style.cursor = ''; };
      document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
      document.body.style.cursor = 'col-resize';
    };
    return <div className="splitter" onMouseDown={onDown}><span></span></div>;
  }

  const RATES = [0.75, 1, 1.25, 1.5, 1.75];
  function Transport(props) {
    const { status, idx, total, sentence } = props;
    const pct = total ? ((idx + (status !== 'idle' ? 1 : 0)) / total) * 100 : 0;
    const playing = status === 'playing';
    function barClick(e) {
      const r = e.currentTarget.getBoundingClientRect();
      const p = (e.clientX - r.left) / r.width;
      props.onSeek(Math.round(p * (total - 1)));
    }
    return (
      <footer className="transport">
        <div className="tp-controls">
          <button className="tp-btn" onClick={props.onPrev} title="Previous sentence (Alt+←)" aria-label="Previous sentence (Alt+←)">
            <svg viewBox="0 0 20 20"><path d="M13 4l-7 6 7 6zM6 4v12" fill="currentColor" /></svg>
          </button>
          <button className={'tp-btn tp-play' + (playing ? ' is-playing' : '')} onClick={props.onPlay} title="Play / Pause (Space)" aria-label="Play / Pause (Space)">
            {playing
              ? <svg viewBox="0 0 20 20"><rect x="5" y="4" width="3.5" height="12" rx="1" /><rect x="11.5" y="4" width="3.5" height="12" rx="1" /></svg>
              : <svg viewBox="0 0 20 20"><path d="M6 4l11 6-11 6z" /></svg>}
          </button>
          <button className="tp-btn" onClick={props.onStop} title="Stop" aria-label="Stop">
            <svg viewBox="0 0 20 20"><rect x="5" y="5" width="10" height="10" rx="1.5" /></svg>
          </button>
          <button className="tp-btn" onClick={props.onNext} title="Next sentence (Alt+→)" aria-label="Next sentence (Alt+→)">
            <svg viewBox="0 0 20 20"><path d="M7 4l7 6-7 6zM14 4v12" fill="currentColor" /></svg>
          </button>
        </div>

        <div className="tp-now">
          <div className="tp-now-label">{props.busy ? 'Synthesizing…' : status === 'paused' ? 'Paused' : status === 'playing' ? 'Now reading' : 'Ready'}
            {props.docLabel ? <span className="tp-doc" title="Document being read"><svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M4 2.5h5l3 3V13a.5.5 0 01-.5.5h-7A.5.5 0 014 13z" strokeLinejoin="round" /></svg>{props.docLabel}</span> : null}
            <span className="tp-count">{total ? Math.min(idx + 1, total) : 0} / {total}</span>
            <button className={'tp-save' + (props.saved ? ' done' : '')} onClick={props.onBookmark} title="Save where you are in the reading">
              {props.saved
                ? <><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" /></svg>Saved</>
                : <><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 2.5h8v11l-4-2.6-4 2.6z" strokeLinejoin="round" /></svg>Save position</>}
            </button>
          </div>
          <div className="tp-now-text" style={props.err ? { color: '#dc2626' } : null}>{props.err ? props.err : (sentence ? sentence.text : 'Press play to read the document aloud.')}</div>
          <div className="tp-bar" onClick={barClick}><div className="tp-fill" style={{ width: pct + '%' }}></div></div>
        </div>

        <div className="tp-right">
          <button className={'tp-toggle' + (props.showVoiced ? ' on' : ' off')} title={props.showVoiced ? 'Hide ♪ voiced-sentence highlights' : 'Show ♪ voiced-sentence highlights'} aria-label={props.showVoiced ? 'Hide ♪ voiced-sentence highlights' : 'Show ♪ voiced-sentence highlights'} aria-pressed={!!props.showVoiced} onClick={(e) => { e.stopPropagation(); props.onToggleVoiced && props.onToggleVoiced(); }}><span className="tp-glyph">♪</span></button>
          {props.hasReview ? <button className={'tp-toggle' + (props.showReview ? ' on' : ' off')} title={props.showReview ? 'Hide AI review markers' : 'Show AI review markers'} aria-label={props.showReview ? 'Hide AI review markers' : 'Show AI review markers'} aria-pressed={!!props.showReview} onClick={(e) => { e.stopPropagation(); props.onToggleReview && props.onToggleReview(); }}><span className="tp-glyph">✦</span></button> : null}
          {props.hlShow ? <button className={'tp-toggle' + (props.hlShow.comment ? ' on' : ' off')} title={(props.hlShow.comment ? 'Hide' : 'Show') + ': comment highlights in the code'} aria-label={(props.hlShow.comment ? 'Hide' : 'Show') + ': comment highlights in the code'} aria-pressed={!!props.hlShow.comment} onClick={(e) => { e.stopPropagation(); props.onToggleHl && props.onToggleHl('comment'); }}><span className="tp-glyph">✎</span></button> : null}
          {props.hlShow ? <button className={'tp-toggle' + (props.hlShow.todo ? ' on' : ' off')} title={(props.hlShow.todo ? 'Hide' : 'Show') + ': to-do highlights in the code'} aria-label={(props.hlShow.todo ? 'Hide' : 'Show') + ': to-do highlights in the code'} aria-pressed={!!props.hlShow.todo} onClick={(e) => { e.stopPropagation(); props.onToggleHl && props.onToggleHl('todo'); }}><span className="tp-glyph">✓</span></button> : null}
          {props.hlShow ? <button className={'tp-toggle' + (props.hlShow.spell ? ' on' : ' off')} title={(props.hlShow.spell ? 'Hide' : 'Show') + ': spelling highlights in the code'} aria-label={(props.hlShow.spell ? 'Hide' : 'Show') + ': spelling highlights in the code'} aria-pressed={!!props.hlShow.spell} onClick={(e) => { e.stopPropagation(); props.onToggleHl && props.onToggleHl('spell'); }}><span className="tp-glyph">∿</span></button> : null}
          <button className={'tp-gear' + (props.engine === 'eleven' ? ' on' : '')} title="Voice engine" aria-label="Voice engine" onClick={(e) => { e.stopPropagation(); props.onVoice && props.onVoice(); }}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="10" cy="10" r="2.6" /><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" strokeLinecap="round" /></svg>
            {props.engine === 'eleven' ? <span className="gear-tag">EL</span> : null}
          </button>
          <div className="tp-field">
            <label>Speed</label>
            <div className="speed-seg">
              {RATES.map((r) => <button key={r} className={props.rate === r ? 'on' : ''} onClick={() => props.setRate(r)}>{r === 1 ? '1×' : r + '×'}</button>)}
            </div>
          </div>
          <div className="tp-field">
            <label>Voice</label>
            <select className="voice-sel" value={props.voiceURI} onChange={(e) => props.setVoiceURI(e.target.value)}>
              {props.voices.length === 0 && <option value="">Default</option>}
              {props.voices.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>)}
            </select>
          </div>
        </div>
      </footer>
    );
  }

  function statusIcon(s) {
    if (s === 'uploading' || s === 'queued') return <span className="up-spin" />;
    if (s === 'done') return '\u2713';
    if (s === 'skipped') return '\u2298';
    if (s === 'error') return '!';
    return '\u2022';
  }
  function UploadModal(props) {
    const { items, onClose } = props;
    const settled = items.every((it) => it.status === 'done' || it.status === 'skipped' || it.status === 'error');
    const done = items.filter((it) => it.status === 'done').length;
    const skipped = items.filter((it) => it.status === 'skipped').length;
    const failed = items.filter((it) => it.status === 'error').length;
    const active = items.length - done - skipped - failed;
    useEffect(() => {
      if (settled && skipped === 0 && failed === 0 && items.length) { const t = setTimeout(onClose, 1800); return () => clearTimeout(t); }
    }, [settled, skipped, failed, items.length]);
    const fmt = (n) => !n ? '' : n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
    return (
      <div className="up-scrim" onMouseDown={() => { if (settled) onClose(); }} onKeyDown={(e) => { if (e.key === 'Escape' && settled) onClose(); }}>
        <div className="up-modal" role="dialog" aria-modal="true" aria-label={settled ? 'Upload complete' : 'Uploading files'} onMouseDown={(e) => e.stopPropagation()}>
          <div className="up-head">
            <b>{settled ? 'Upload complete' : 'Uploading files'}</b>
            <button className="up-x" onClick={onClose} disabled={!settled} title={settled ? 'Close' : 'Uploads in progress…'} aria-label={settled ? 'Close' : 'Uploads in progress…'}>✕</button>
            <span className="up-sub">{active > 0 ? active + ' in progress · ' : ''}{done} done{skipped ? ' · ' + skipped + ' skipped' : ''}{failed ? ' · ' + failed + ' failed' : ''}</span>
          </div>
          <div className="up-list">
            {items.map((it) => (
              <div className={'up-row up-' + it.status} key={it.id}>
                <span className="up-ic">{statusIcon(it.status)}</span>
                <span className="up-name" title={it.name}>{it.name}</span>
                <span className="up-meta">{it.status === 'uploading' || it.status === 'queued'
                  ? <span className="up-bar"><i /></span>
                  : (it.status === 'skipped' || it.status === 'error') ? it.reason : fmt(it.size)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  function CommandPalette(props) {
    const { items, onClose } = props;
    const [q, setQ] = useState('');
    const [sel, setSel] = useState(0);
    const inRef = useRef(null);
    useEffect(() => { if (inRef.current) inRef.current.focus(); }, []);
    useEffect(() => { setSel(0); }, [q]);
    const ql = q.trim().toLowerCase();
    const filtered = items.filter((it) => !ql || it.label.toLowerCase().indexOf(ql) >= 0 || (it.group && it.group.toLowerCase().indexOf(ql) >= 0));
    const run = (it) => { if (!it) return; onClose(); setTimeout(() => it.run(), 0); };
    const onKey = (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(filtered.length - 1, s + 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
      else if (e.key === 'Enter') { e.preventDefault(); run(filtered[sel]); }
      else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    };
    const groups = [];
    filtered.forEach((it) => { let g = groups.find((x) => x.name === it.group); if (!g) { g = { name: it.group, rows: [] }; groups.push(g); } g.rows.push(it); });
    let idx = -1;
    return (
      <div className="cmdk-overlay" onMouseDown={onClose}>
        <div className="cmdk" role="dialog" aria-modal="true" aria-label="Command palette" onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKey}>
          <div className="cmdk-in">
            <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="7" cy="7" r="4.5" /><path d="M11 11l3 3" strokeLinecap="round" /></svg>
            <input ref={inRef} value={q} placeholder="Type a command or jump to a section…" onChange={(e) => setQ(e.target.value)} />
            <span className="cmdk-esc">esc</span>
          </div>
          <div className="cmdk-list">
            {filtered.length === 0 && <div className="cmdk-empty">No matches</div>}
            {groups.map((g) => (
              <div key={g.name} className="cmdk-group">
                <div className="cmdk-gh">{g.name}</div>
                {g.rows.map((it) => { idx++; const i = idx; return (
                  <div key={i} className={'cmdk-row' + (i === sel ? ' on' : '')} onMouseEnter={() => setSel(i)} onClick={() => run(it)}>
                    {it.group === 'Go to' && <span className={'cmdk-kind ' + it.hint}>{it.hint === 'figure' ? 'FIG' : it.hint === 'table' ? 'TAB' : it.hint === 'section' ? '§' : it.hint === 'subsection' ? '§§' : '§§§'}</span>}
                    <span className="cmdk-label">{it.label}</span>
                    {it.hint && it.group !== 'Go to' && <span className="cmdk-hint">{it.hint}</span>}
                  </div>
                ); })}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  ReactDOM.createRoot(document.getElementById('root')).render(<App />);
})();
