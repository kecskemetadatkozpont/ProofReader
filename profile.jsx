/* Aloud — Profile / hub page. The researcher's home base: identity, resume-work overview,
 * usage & cost, a read-only settings summary that deep-links into the editor, and the honest
 * "where does my data live" story. Reads only data store.js / eleven.js / PR_BACKEND already expose. */
const { useState, useEffect, useCallback, useRef } = React;
const Auth = window.PRAuth, Store = window.PRStore, E = window.PREleven;

function fmtBytes(n) {
  n = n || 0;
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
  return (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + ' MB';
}
function rel(ts) {
  if (!ts) return 'a while ago';
  var s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  var m = Math.floor(s / 60); if (m < 60) return m + ' min ago';
  var h = Math.floor(m / 60); if (h < 24) return h + ' h ago';
  var d = Math.floor(h / 24); if (d < 30) return d + ' day' + (d === 1 ? '' : 's') + ' ago';
  return Math.floor(d / 30) + ' mo ago';
}
function over80(u) { return (u.storageLimit && u.storageBytes / u.storageLimit > 0.8) || (u.charLimit && u.chars / u.charLimit > 0.8); }

const IC = {
  overview: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="2" y="2" width="5" height="5" rx="1" /><rect x="9" y="2" width="5" height="5" rx="1" /><rect x="2" y="9" width="5" height="5" rx="1" /><rect x="9" y="9" width="5" height="5" rx="1" /></svg>,
  usage: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 14V8M6 14V4M10 14v-3M14 14V6" strokeLinecap="round" /></svg>,
  settings: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="8" cy="8" r="2.2" /><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M12.5 3.5l-1.4 1.4M4.9 11.1l-1.4 1.4" strokeLinecap="round" /></svg>,
  data: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><ellipse cx="8" cy="3.5" rx="5.5" ry="2" /><path d="M2.5 3.5v9c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2v-9M2.5 8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2" /></svg>,
  publications: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M4 2.5h6l2.5 2.5V13a.5.5 0 01-.5.5H4a.5.5 0 01-.5-.5V3a.5.5 0 01.5-.5z" strokeLinejoin="round" /><path d="M5.8 6.5h4.4M5.8 8.7h4.4M5.8 10.9h2.6" strokeLinecap="round" /></svg>,
};

function Avatar(props) {
  var size = props.size || 34, u = props.user;
  if (!u) return <span className="avatar" style={{ width: size, height: size }} />;
  return <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.4, background: u.color }}>{Auth.initials(u.name)}</span>;
}

function Header(props) {
  var me = props.me, mode = props.mode, usage = props.usage, isDemo = mode !== 'cloud';
  var [editing, setEditing] = useState(false);
  var [name, setName] = useState(me.name);
  var [menu, setMenu] = useState(false);
  useEffect(function () { var c = function () { setMenu(false); }; window.addEventListener('click', c); return function () { window.removeEventListener('click', c); }; }, []);
  var others = isDemo ? (Auth.demoUsers ? Auth.demoUsers() : Auth.users()).filter(function (u) { return u.id !== me.id; }) : []; // password-protected colleagues aren't passwordless-switchable
  var TINTS = ['#4f46e5', '#0e9f6e', '#d9760b', '#db2777', '#0891b2', '#7c3aed', '#dc2626'];
  function saveName() { var n = name.trim(); if (n && isDemo) { Auth.updateUser(me.id, { name: n }); props.setMe(Auth.byId(me.id)); } setEditing(false); }
  function setTint(c) { if (isDemo) { Auth.updateUser(me.id, { color: c }); props.setMe(Auth.byId(me.id)); } }
  var isFree = /free/i.test(usage.planLabel || '');
  return <header className="pf-head">
    <div className="pf-head-top"><a className="pf-back" href="Projects.html">← Projects</a><span id="pr-ver-slot" className="pf-ver" /></div>
    <div className="pf-id">
      <Avatar user={me} size={68} />
      <div className="pf-id-main">
        {editing
          ? <div className="pf-name-edit"><input value={name} autoFocus aria-label="Display name" onChange={function (e) { setName(e.target.value); }} onKeyDown={function (e) { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setEditing(false); }} /><button className="btn-ghost" onClick={saveName}>Save</button></div>
          : <h1>{me.name} {isDemo ? <button className="pf-edit" title="Edit name" onClick={function () { setName(me.name); setEditing(true); }}>✎</button> : null}</h1>}
        <div className="pf-email">{me.email}</div>
        <div className="pf-chips">
          <span className="plan-pill">{usage.planLabel}</span>
          <span className={'pf-mode ' + (mode === 'cloud' ? 'cloud' : 'demo')}>{mode === 'cloud' ? 'Cloud — synced to your account' : 'Demo — this browser only'}</span>
        </div>
        {isDemo ? <div className="pf-tints" role="group" aria-label="Avatar colour">{TINTS.map(function (c) { return <button key={c} className={'pf-tint' + (me.color === c ? ' on' : '')} style={{ background: c }} title={'Avatar colour ' + c} aria-label={'Avatar colour ' + c} aria-pressed={me.color === c} onClick={function () { setTint(c); }} />; })}</div> : null}
      </div>
      <div className="pf-head-actions">
        {isFree ? <button className="btn-ghost" onClick={function () { alert('Pro plans are a preview — billing is not yet enabled in this prototype.'); }}>Upgrade to Pro</button> : null}
        {isDemo && others.length ? <div className="acct" onClick={function (e) { e.stopPropagation(); }}>
          <button className="btn-ghost" onClick={function () { setMenu(function (m) { return !m; }); }}>Switch user ▾</button>
          {menu ? <div className="menu" style={{ right: 0, top: 42, minWidth: 200 }}>{others.map(function (u) { return <button key={u.id} className="mi" onClick={function () { Auth.signIn(u.id); location.reload(); }}><Avatar user={u} size={22} />{u.name}</button>; })}</div> : null}
        </div> : null}
        <button className="btn-ghost danger" onClick={function () { var prot = Auth.isProtected && Auth.isProtected(me.email); Auth.signOut(); location.replace(prot ? 'Profile.html' : 'Landing.html'); }}>Sign out</button>
      </div>
    </div>
  </header>;
}

function Overview(props) {
  var me = props.me, usage = props.usage, go = props.go;
  var projects = Store.listFor(me.id) || [];
  var recent = projects.slice().sort(function (a, b) { return (b.updated || 0) - (a.updated || 0); }).slice(0, 4);
  var owned = projects.filter(function (p) { return !p._shared; }).length;
  var shared = projects.filter(function (p) { return p._shared; }).length;
  var pr = Store.prefs ? Store.prefs() : {};
  var stPct = usage.storageLimit ? Math.min(100, usage.storageBytes / usage.storageLimit * 100) : 0;
  var chPct = usage.charLimit ? Math.min(100, usage.chars / usage.charLimit * 100) : 0;
  var flags = [];
  if (E && (pr.engine === 'eleven' || !pr.engine) && !E.hasKey()) flags.push(['ElevenLabs is selected but no API key is set.', 'Add it in Settings', 'settings']);
  if (stPct > 80) flags.push(['Storage is over 80% of your plan.', 'See usage', 'usage']);
  if (chPct > 80) flags.push(['Voice characters are over 80% of this month.', 'See usage', 'usage']);
  return <div>
    <h2 className="pf-h">Welcome back, {me.name.split(' ')[0]}</h2>
    {flags.length ? <div className="pf-flags">{flags.map(function (f, i) { return <div className="pf-flag" key={i}><span>{f[0]}</span><button onClick={function () { go(f[2]); }}>{f[1]} →</button></div>; })}</div> : null}
    <div className="pf-stats">
      <div className="pf-stat"><b>{owned}</b><span>Owned projects</span></div>
      <div className="pf-stat"><b>{shared}</b><span>Shared with me</span></div>
      <div className="pf-stat"><b>{fmtBytes(usage.storageBytes)}</b><span>of {fmtBytes(usage.storageLimit)} storage</span></div>
      <div className="pf-stat"><b>{(usage.chars || 0).toLocaleString()}</b><span>of {(usage.charLimit || 0).toLocaleString()} TTS chars/mo</span></div>
    </div>
    <h3 className="pf-h3">Continue where you left off</h3>
    {recent.length === 0
      ? <div className="pf-empty">No projects yet. <a href="Projects.html">Create your first project →</a></div>
      : <div className="pf-cards">{recent.map(function (p) {
        var r = Store.getReading ? Store.getReading(me.id, p.id) : null;
        return <a className="pf-card" key={p.id} href={'ProofReader.html?p=' + encodeURIComponent(p.id)}>
          <div className="pf-card-t">{p.title}{p._shared ? <span className="pf-shared">shared</span> : null}</div>
          <div className="pf-card-m">{r ? 'Resume at sentence ' + (r.idx + 1) + ' · ' + rel(r.at) : 'Updated ' + rel(p.updated)}</div>
        </a>;
      })}</div>}
    <div className="pf-actions"><a className="btn-primary" href="Projects.html">All projects &amp; new</a></div>
  </div>;
}

function bar(pct) { return <div className="pf-bar"><i style={{ width: pct + '%', background: pct > 90 ? '#dc2626' : pct > 75 ? '#b4530f' : 'var(--accent)' }} /></div>; }

function UsageCost(props) {
  var me = props.me, usage = props.usage;
  var [acct, setAcct] = useState(null), [acctErr, setAcctErr] = useState(null);
  useEffect(function () { if (E && E.hasKey() && E.accountUsage) { E.accountUsage().then(setAcct, function (e) { setAcctErr((e && e.message) || 'failed'); }); } }, []);
  var stPct = usage.storageLimit ? Math.min(100, usage.storageBytes / usage.storageLimit * 100) : 0;
  var chPct = usage.charLimit ? Math.min(100, usage.chars / usage.charLimit * 100) : 0;
  var owned = (Store.listFor(me.id) || []).filter(function (p) { return !p._shared; });
  var top = null;
  owned.forEach(function (p) { var t = Store.ttsForProject ? Store.ttsForProject(me.id, p.id) : null; if (t && t.chars && (!top || t.chars > top.chars)) top = { title: p.title, id: p.id, chars: t.chars, credits: t.credits }; });
  return <div>
    <h2 className="pf-h">Usage &amp; cost</h2>
    <div className="pf-panel">
      <div className="pf-row"><span>Storage</span><b>{fmtBytes(usage.storageBytes)} / {fmtBytes(usage.storageLimit)}</b></div>{bar(stPct)}
      <div className="pf-row" style={{ marginTop: 12 }}><span>Voice characters this month <i className="pf-est">app-side estimate · not billed</i></span><b>{(usage.chars || 0).toLocaleString()} / {(usage.charLimit || 0).toLocaleString()}</b></div>{bar(chPct)}
      <div className="pf-note">{(usage.requests || 0)} syntheses counted this month. This quota is not enforced server-side in the prototype — your real constraint is your ElevenLabs balance below.</div>
    </div>
    <h3 className="pf-h3">ElevenLabs account — your real balance</h3>
    <div className="pf-panel">
      {!E || !E.hasKey()
        ? <div className="pf-note">No ElevenLabs key set — you are on the free browser voice, which costs nothing. Add a key in <a href="#settings">Settings</a> to use ElevenLabs.</div>
        : acct
          ? <div><div className="pf-row"><span>Characters used / limit{acct.tier ? ' · ' + acct.tier : ''}</span><b>{(acct.used || 0).toLocaleString()} / {(acct.limit || 0).toLocaleString()}</b></div>{bar(acct.limit ? Math.min(100, acct.used / acct.limit * 100) : 0)}</div>
          : acctErr ? <div className="pf-note err">Could not read ElevenLabs usage: {acctErr}</div>
            : <div className="pf-note">Loading your ElevenLabs usage…</div>}
    </div>
    <h3 className="pf-h3">Cost by thesis</h3>
    {top
      ? <div className="pf-panel"><div className="pf-row"><span>Most-voiced: <a href={'ProofReader.html?p=' + encodeURIComponent(top.id)}>{top.title}</a></span><b>{top.chars.toLocaleString()} chars · ≈{(top.credits || top.chars).toLocaleString()} credits</b></div><div className="pf-note">Re-reads are free — only first-time synthesis charges. Audio is cached in this browser (and shared with collaborators on a cloud project).</div></div>
      : <div className="pf-empty">No voice synthesis billed yet.</div>}
  </div>;
}

function Settings(props) {
  var me = props.me, p = Store.prefs ? Store.prefs() : {};
  var recent = (Store.listFor(me.id) || []).slice().sort(function (a, b) { return (b.updated || 0) - (a.updated || 0); })[0];
  var editorLink = recent ? 'ProofReader.html?p=' + encodeURIComponent(recent.id) : 'Projects.html';
  var voiceName = (function () { if (p.engine === 'browser') return 'Browser voice' + (p.voiceURI ? ' · ' + p.voiceURI : ''); var v = (E && E.voices || []).filter(function (x) { return x.id === p.elevenVoice; })[0]; return 'ElevenLabs' + (v ? ' · ' + v.name : ''); })();
  return <div>
    <h2 className="pf-h">Settings</h2>
    <div className="pf-note bnr">Your account defaults, stored in this browser for <b>{me.name}</b>. Change them in the editor's panels — the Profile shows a read-only summary so there is one source of truth.</div>
    <div className="pf-panel">
      <div className="pf-set-h">Voice &amp; reading</div>
      <div className="pf-kv"><span>Engine</span><b>{p.engine === 'browser' ? 'Browser (free)' : 'ElevenLabs'}</b></div>
      <div className="pf-kv"><span>Voice</span><b>{voiceName}</b></div>
      <div className="pf-kv"><span>Model</span><b>{p.model || 'eleven_v3'}</b></div>
      <div className="pf-kv"><span>Reading rate</span><b>{p.rate || 1}×</b></div>
      <div className="pf-kv"><span>ElevenLabs key</span><b>{E && E.hasKey() ? 'set · this browser only' : 'not set'}</b></div>
      <a className="btn-ghost" href={editorLink}>Open voice settings in the editor →</a>
    </div>
    <div className="pf-panel">
      <div className="pf-set-h">Writing &amp; language</div>
      <div className="pf-kv"><span>Spell check</span><b>{p.spellOn ? 'on' : 'off'}</b></div>
      <div className="pf-kv"><span>Language</span><b>{p.spellLang ? (p.spellLang === 'hu' ? 'Magyar' : 'English') : 'Auto-detect'}</b></div>
      <div className="pf-kv"><span>Personal dictionary</span><b>{(p.spellDict || []).length} words</b></div>
      <div className="pf-kv"><span>Pronunciation overrides</span><b>{(p.ttsDict || []).length} entries</b></div>
      <a className="btn-ghost" href={editorLink}>Open the editor to change these →</a>
    </div>
    {(((window.PR_BACKEND && window.PR_BACKEND.mode) === 'cloud') || (window.PRAuth && window.PRAuth.isProtected && window.PRAuth.isProtected(me.email))) ? <ChangePassword email={me.email} /> : null}
  </div>;
}

function DataSync(props) {
  var me = props.me, isCloud = props.mode === 'cloud';
  var [msg, setMsg] = useState(null);
  function clearAudio() { if (E && E.clearCache) { Promise.resolve(E.clearCache()).then(function (okv) { setMsg(okv === false ? 'In-memory audio cleared — some persisted audio could not be removed.' : 'Audio cache cleared on this browser.'); }); } }
  function forgetKey() { if (E && E.setKey) { E.setKey(''); setMsg('ElevenLabs key forgotten on this browser.'); props.onChanged && props.onChanged(); } }
  var ROWS = [
    ['Projects & files', isCloud ? 'Supabase (your account)' : 'This browser (localStorage)', isCloud ? 'yes — any device' : 'no', 'collaborators on shared projects'],
    ['Comments, to-dos, versions', isCloud ? 'Supabase' : 'This browser', isCloud ? 'yes' : 'no', 'collaborators'],
    ['Settings (voice / spell / pronunciation)', 'This browser only', 'no', 'no — yours alone'],
    ['Usage & reading positions', 'This browser only', 'no', 'no'],
    ['ElevenLabs API key', 'This browser only', 'no', 'no — never sent to Publify'],
    ['Generated audio (MP3 cache)', 'This browser (IndexedDB)', 'no', 'shared cache on cloud projects'],
  ];
  return <div>
    <h2 className="pf-h">Data &amp; sync</h2>
    <div className="pf-note bnr">{isCloud
      ? 'You are signed in to your account (cloud) — your profile, publications and projects sync to Supabase. Your settings, usage, reading positions, ElevenLabs key and audio cache still live only in THIS browser, even in cloud mode.'
      : 'Demo mode — everything lives in this browser and is shared by all seeded users signed in here. Nothing leaves the machine.'}</div>
    <div className="pf-panel" style={{ padding: 0, overflowX: 'auto' }}>
      <table className="pf-table">
        <thead><tr><th>Data</th><th>Where it lives</th><th>New browser?</th><th>Shared?</th></tr></thead>
        <tbody>{ROWS.map(function (r, i) { return <tr key={i}><td>{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td><td>{r[3]}</td></tr>; })}</tbody>
      </table>
    </div>
    <h3 className="pf-h3">Clear data on this browser</h3>
    <div className="pf-panel">
      <div className="pf-data-acts">
        <button className="btn-ghost" onClick={clearAudio}>Clear audio cache</button>
        <button className="btn-ghost" onClick={forgetKey}>Forget ElevenLabs key</button>
      </div>
      {msg ? <div className="pf-note ok">{msg}</div> : null}
      <div className="pf-note">Exporting / importing all your data as JSON is coming soon. Deleting a cloud account is not yet wired up.</div>
    </div>
  </div>;
}

function Publications(props) {
  var me = props.me;
  var rec = (window.PRPubs && window.PRPubs.forUser(me)) || null;
  var pubs = (rec && rec.publications) || [];
  var [counts, setCounts] = useState({});
  var [open, setOpen] = useState(null);     // expanded pubKey
  var [files, setFiles] = useState({});     // pubKey -> [meta]
  var [busy, setBusy] = useState(null);     // pubKey currently uploading
  var [err, setErr] = useState(null);
  var inputRef = useRef(null);
  var PF = window.PRPubFiles;
  var keyOf = function (p) { return me.email + ':' + p.mtid; };
  useEffect(function () { if (PF && pubs.length) PF.counts(pubs.map(keyOf)).then(setCounts); }, []); // eslint-disable-line
  function loadFiles(k) { if (PF) PF.list(k).then(function (fs) { setFiles(function (m) { var n = Object.assign({}, m); n[k] = fs; return n; }); }); }
  function toggle(k) { if (open === k) { setOpen(null); return; } setOpen(k); if (files[k] === undefined) loadFiles(k); }
  function pick(k) { if (inputRef.current) { inputRef.current.value = ''; inputRef.current.dataset.k = k; inputRef.current.click(); } } // target stashed on the input, not a shared ref
  function onFile(e) {
    var k = e.target.dataset.k, f = e.target.files && e.target.files[0]; if (!k || !f || !PF) return;
    setErr(null); setBusy(k);
    PF.add(k, f).then(function () { setBusy(null); loadFiles(k); PF.counts(pubs.map(keyOf)).then(setCounts); }, function (er) { setBusy(null); setErr((er && er.message) || 'Upload failed.'); });
  }
  function view(id) { if (PF) PF.getBlob(id).then(function (b) { if (b) { var u = URL.createObjectURL(b); window.open(u, '_blank'); setTimeout(function () { URL.revokeObjectURL(u); }, 60000); } }); }
  function download(m) { if (PF) PF.getBlob(m.id).then(function (b) { if (b) { var u = URL.createObjectURL(b); var a = document.createElement('a'); a.href = u; a.download = m.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 5000); } }); }
  function del(id, k) { if (PF) PF.remove(id).then(function () { loadFiles(k); PF.counts(pubs.map(keyOf)).then(setCounts); }); }

  if (!rec) return <div><h2 className="pf-h">My publications</h2><div className="pf-empty">No publication record is linked to this profile yet. Publication lists are imported from MTMT for participating researchers.</div></div>;

  var totalCites = pubs.reduce(function (a, p) { return a + (p.citations || 0); }, 0);
  // group by year desc
  var years = [], byYear = {};
  pubs.forEach(function (p) { var y = p.year || 0; if (!byYear[y]) { byYear[y] = []; years.push(y); } byYear[y].push(p); });
  years.sort(function (a, b) { return b - a; });

  return <div>
    <h2 className="pf-h">My publications</h2>
    <input ref={inputRef} type="file" accept="application/pdf,.pdf,.doc,.docx,.txt,.csv,.xlsx,.zip,.tex,.bib,image/*" style={{ display: 'none' }} onChange={onFile} />
    <div className="pf-panel">
      <div className="pf-pub-sum">
        <div><b>{pubs.length}</b><span>publications</span></div>
        <div><b>{totalCites}</b><span>citations (MTMT)</span></div>
        <div><b>{pubs.filter(function (p) { return p.doi; }).length}</b><span>with a DOI</span></div>
      </div>
      <div className="pf-note">Imported from <a href={'https://m2.mtmt.hu/gui2/?mode=browse&params=author;' + rec.mtmtId} target="_blank" rel="noopener">MTMT</a> (as of 19 June 2026){rec.orcid ? <span> · ORCID <a href={'https://orcid.org/' + rec.orcid} target="_blank" rel="noopener">{rec.orcid}</a></span> : null}. Citation counts are a snapshot. Attach the PDF or data files for each item below — {(window.PRPubFiles && window.PRPubFiles.cloud) ? 'they are stored securely in your cloud account (Supabase Storage), available on any device.' : 'they are stored in this browser.'}</div>
    </div>
    {err ? <div className="pf-note err" style={{ margin: '0 0 10px' }}>{err}</div> : null}
    {years.map(function (y) { return <div key={y}>
      <h3 className="pf-h3">{y || 'Undated'}</h3>
      {byYear[y].map(function (p) {
        var k = keyOf(p), n = counts[k] || 0;
        return <div className={'pf-pub' + (open === k ? ' open' : '')} key={p.mtid}>
          <div className="pf-pub-main">
            <div className="pf-pub-t">{p.title || '(untitled)'}</div>
            <div className="pf-pub-cite">{p.citation || (p.firstAuthor + ' (' + (p.year || '') + ')')}</div>
            <div className="pf-pub-meta">
              {p.typeHu ? <span className="pf-tag">{p.typeHu}</span> : null}
              {p.journal ? <span className="pf-pub-j">{p.journal}</span> : null}
              {p.citations ? <span className="pf-tag cit">{p.citations} cit.</span> : null}
              {p.oaType && p.oaType !== 'NONE' ? <span className="pf-tag oa">Open access</span> : null}
              {p.doi ? <a className="pf-tag link" href={'https://doi.org/' + p.doi} target="_blank" rel="noopener">DOI</a> : null}
              <a className="pf-tag link" href={'https://m2.mtmt.hu/gui2/?mode=browse&params=publication;' + p.mtid} target="_blank" rel="noopener">MTMT</a>
            </div>
          </div>
          <button className="pf-pub-files" onClick={function () { toggle(k); }}>{n ? n + ' file' + (n === 1 ? '' : 's') : 'Attach'} {open === k ? '▴' : '▾'}</button>
          {open === k ? <div className="pf-pub-drop">
            {(files[k] || []).map(function (m) { return <div className="pf-file" key={m.id}>
              <span className="pf-file-n" title={m.name}>{m.name}</span>
              <span className="pf-file-s">{fmtBytes(m.size)}</span>
              <button onClick={function () { view(m.id); }}>View</button>
              <button onClick={function () { download(m); }}>Download</button>
              <button className="pf-file-x" onClick={function () { del(m.id, k); }}>✕</button>
            </div>; })}
            {files[k] && files[k].length === 0 ? <div className="pf-note" style={{ margin: '2px 0 8px' }}>No files attached yet.</div> : null}
            <button className="btn-ghost" disabled={busy === k} onClick={function () { pick(k); }}>{busy === k ? 'Uploading…' : '+ Attach PDF / data file'}</button>
          </div> : null}
        </div>;
      })}
    </div>; })}
  </div>;
}

function Login(props) {
  var [email, setEmail] = useState(''), [pw, setPw] = useState(''), [err, setErr] = useState(null), [busy, setBusy] = useState(false);
  function submit(e) {
    if (e) e.preventDefault();
    var em = email.trim(); if (!em || !pw) { setErr('Enter your email and password.'); return; }
    setBusy(true); setErr(null);
    var BE = window.PR_BACKEND;
    if (BE && BE.sb && BE.sb.auth && BE.sb.auth.signInWithPassword) {
      // real Supabase Auth — on success backend.js sees SIGNED_IN and reboots the page into cloud mode
      BE.sb.auth.signInWithPassword({ email: em, password: pw }).then(function (res) {
        if (res && res.error) { setBusy(false); setErr(/invalid|credential/i.test(res.error.message || '') ? 'Incorrect email or password.' : res.error.message); return; }
        if (res && res.data && res.data.session) return;     // keep "Signing in…": the backend reloads us into cloud mode
        setBusy(false); setErr('Incorrect email or password.');
      }, function (er) { setBusy(false); setErr((er && er.message) || 'Sign-in failed.'); });
      return;
    }
    // fallback: client-side mock (demo / backend unavailable)
    if (!window.PRAuth || !window.PRAuth.signInWithPassword) { setBusy(false); setErr('Sign-in is unavailable.'); return; }
    window.PRAuth.signInWithPassword(em, pw).then(function (u) { setBusy(false); if (u) props.onSignIn(u); else setErr('Incorrect email or password.'); }, function (er) { setBusy(false); setErr((er && er.message) || 'Sign-in failed.'); });
  }
  return <div className="pf-login"><form className="pf-login-card" onSubmit={submit}>
    <div className="pf-login-mark"><span /></div>
    <h1>Sign in to your profile</h1>
    <p>Researchers: sign in with your institutional email and the password you were given.</p>
    <input className="pf-login-in" type="email" autoComplete="username" placeholder="name@sze.hu" autoFocus value={email} aria-label="Email" onChange={function (e) { setEmail(e.target.value); }} />
    <input className="pf-login-in" type="password" autoComplete="current-password" placeholder="Password" value={pw} aria-label="Password" onChange={function (e) { setPw(e.target.value); }} />
    {err ? <div className="pf-login-err">{err}</div> : null}
    <button className="btn-primary" type="submit" disabled={busy} style={{ width: '100%', justifyContent: 'center' }}>{busy ? 'Signing in…' : 'Sign in'}</button>
    <div className="pf-login-note">Forgot your password? Contact the administrator. · <a href="Projects.html">Back to Publify</a></div>
  </form></div>;
}

function ChangePassword(props) {
  var isCloud = (window.PR_BACKEND && window.PR_BACKEND.mode) === 'cloud';
  var [open, setOpen] = useState(false), [cur, setCur] = useState(''), [n1, setN1] = useState(''), [n2, setN2] = useState('');
  var [msg, setMsg] = useState(null), [busy, setBusy] = useState(false);
  function done() { setBusy(false); setCur(''); setN1(''); setN2(''); setOpen(false); setMsg(['ok', 'Password changed.']); }
  function save(e) {
    if (e) e.preventDefault();
    if (n1.length < 6) { setMsg(['err', 'New password must be at least 6 characters.']); return; }
    if (n1 !== n2) { setMsg(['err', 'The new passwords do not match.']); return; }
    setBusy(true); setMsg(null);
    if (isCloud && window.PR_BACKEND.sb) {
      // verify the current password by re-authenticating, then update it on the account (syncs to every device)
      var sb = window.PR_BACKEND.sb;
      sb.auth.signInWithPassword({ email: props.email, password: cur }).then(function (res) {
        if (res && res.error) { setBusy(false); setMsg(['err', 'Your current password is incorrect.']); return; }
        sb.auth.updateUser({ password: n1 }).then(function (r2) {
          if (r2 && r2.error) { setBusy(false); setMsg(['err', r2.error.message || 'Could not change password.']); return; }
          done();
        }, function (er) { setBusy(false); setMsg(['err', (er && er.message) || 'Could not change password.']); });
      }, function (er) { setBusy(false); setMsg(['err', (er && er.message) || 'Could not verify your password.']); });
      return;
    }
    // fallback: client-side mock (demo / no account)
    window.PRAuth.verifyPassword(props.email, cur).then(function (okv) {
      if (!okv) { setBusy(false); setMsg(['err', 'Your current password is incorrect.']); return; }
      window.PRAuth.setPassword(props.email, n1).then(done, function (er) { setBusy(false); setMsg(['err', (er && er.message) || 'Could not change password.']); });
    }, function (er) { setBusy(false); setMsg(['err', (er && er.message) || 'Could not verify your password.']); });
  }
  return <div className="pf-panel">
    <div className="pf-set-h">Password</div>
    <div className="pf-kv"><span>Sign-in password</span><b>set</b></div>
    {!open ? <button className="btn-ghost" onClick={function () { setOpen(true); setMsg(null); }}>Change password</button>
      : <form className="pf-pw" onSubmit={save}>
        <input className="pf-login-in" type="password" autoComplete="current-password" placeholder="Current password" value={cur} onChange={function (e) { setCur(e.target.value); }} aria-label="Current password" />
        <input className="pf-login-in" type="password" autoComplete="new-password" placeholder="New password (min. 6)" value={n1} onChange={function (e) { setN1(e.target.value); }} aria-label="New password" />
        <input className="pf-login-in" type="password" autoComplete="new-password" placeholder="Repeat new password" value={n2} onChange={function (e) { setN2(e.target.value); }} aria-label="Repeat new password" />
        <div className="pf-pw-acts"><button className="btn-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button><button className="btn-ghost" type="button" onClick={function () { setOpen(false); setMsg(null); }}>Cancel</button></div>
      </form>}
    {msg ? <div className={'pf-note ' + (msg[0] === 'ok' ? 'ok' : 'err')}>{msg[1]}</div> : null}
    <div className="pf-note">{isCloud
      ? 'Your password is stored securely on your account (Supabase Auth) and works on every device.'
      : 'Changing your password is saved in this browser only (demo mode has no server-side account), so set it again on another device.'}</div>
  </div>;
}

function App() {
  var [me, setMe] = useState(function () { return Auth.current(); });
  var [route, setRoute] = useState(function () { return ((location.hash || '#overview').replace('#', '').split('?')[0]) || 'overview'; });
  var [, force] = useState(0);
  var refresh = useCallback(function () { force(function (x) { return x + 1; }); }, []);
  useEffect(function () { var h = function () { setRoute(((location.hash || '#overview').replace('#', '').split('?')[0]) || 'overview'); }; window.addEventListener('hashchange', h); return function () { window.removeEventListener('hashchange', h); }; }, []);
  useEffect(function () { if (Store && Store.subscribe) return Store.subscribe(refresh); }, [refresh]);

  var mode = (window.PR_BACKEND && window.PR_BACKEND.mode) || 'demo';
  if (!me) {
    // while the backend is still resolving a session (or showing its own sign-in card), let its overlay drive.
    if (mode === 'signin' || mode === 'pending') return null;
    // otherwise show the researcher password login (sets me on success).
    return <Login onSignIn={function (u) { setMe(u); }} />;
  }
  var usage = Store.usage(me.id);
  var go = function (r) { location.hash = r; setRoute(r); };
  var myPubs = (window.PRPubs && window.PRPubs.forUser(me)) || null;
  var RAIL = [['overview', 'Overview']];
  if (myPubs) RAIL.push(['publications', 'My publications']);
  RAIL = RAIL.concat([['usage', 'Usage & cost'], ['settings', 'Settings'], ['data', 'Data & sync']]);

  return <div className="pf">
    <Header me={me} setMe={setMe} mode={mode} usage={usage} />
    <div className="pf-body">
      <nav className="pf-rail" aria-label="Profile sections">
        {RAIL.map(function (it) {
          var id = it[0];
          return <button key={id} className={'pf-nav' + (route === id ? ' on' : '')} aria-current={route === id ? 'page' : undefined} onClick={function () { go(id); }}>
            {IC[id]}<span>{it[1]}</span>{id === 'usage' && over80(usage) ? <i className="pf-dot" title="Near a limit" /> : null}{id === 'publications' && myPubs ? <i className="pf-count">{myPubs.pubCount}</i> : null}
          </button>;
        })}
        <div className="pf-soon">More areas coming soon</div>
      </nav>
      <main className="pf-main">
        {route === 'publications' ? <Publications me={me} />
          : route === 'usage' ? <UsageCost me={me} usage={usage} />
            : route === 'settings' ? <Settings me={me} />
              : route === 'data' ? <DataSync me={me} mode={mode} onChanged={refresh} />
                : <Overview me={me} usage={usage} go={go} />}
      </main>
    </div>
  </div>;
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
