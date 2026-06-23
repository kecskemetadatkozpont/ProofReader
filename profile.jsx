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
  chatprompt: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2.5 3.5h11a1 1 0 011 1v6a1 1 0 01-1 1H7l-3 2.5V11.5H2.5a1 1 0 01-1-1v-6a1 1 0 011-1z" strokeLinejoin="round" /><path d="M5 6.3h6M5 8.4h4" strokeLinecap="round" /></svg>,
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
    <div className="pf-head-top"><a className="pf-back" href="Projects.html">← Publications</a><a className="pf-back" href="Landing.html" style={{ marginLeft: 14 }}>Kezdőlap ↗</a><span id="pr-ver-slot" className="pf-ver" /></div>
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
  var me = props.me, usage = props.usage, go = props.go, preview = props.preview;
  var [rprojects, setRprojects] = useState([]);
  var [previewProjects, setPreviewProjects] = useState(null);
  useEffect(function () {
    var B = window.PR_BACKEND; if (!(B && B.sb)) return;
    // research projects belong to the DISPLAYED user (me) — in admin view that's the viewed researcher
    B.sb.from('research_projects').select('id,title,stage,status').eq('owner_id', me.id).order('updated_at', { ascending: false }).then(function (r) { setRprojects((r && r.data) || []); });
    // in admin preview the local Store only holds the admin's projects — fetch the viewed user's writing projects directly (admin RLS)
    if (preview) B.sb.from('projects').select('id,data,updated_at,deleted_at').eq('owner_id', me.id).is('deleted_at', null).order('updated_at', { ascending: false }).then(function (r) {
      setPreviewProjects(((r && r.data) || []).map(function (row) { return { id: row.id, title: (row.data && row.data.title) || 'Untitled publication', ownerId: me.id, updated: row.updated_at ? Date.parse(row.updated_at) : 0, _shared: false }; }));
    });
  }, [me.id, preview]);
  var projects = preview ? (previewProjects || []) : (Store.listFor(me.id) || []);
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
      <div className="pf-stat"><b>{owned}</b><span>Publications</span></div>
      <div className="pf-stat"><b>{shared}</b><span>Shared with me</span></div>
      <div className="pf-stat"><b>{fmtBytes(usage.storageBytes)}</b><span>of {fmtBytes(usage.storageLimit)} storage</span></div>
      <div className="pf-stat"><b>{(usage.chars || 0).toLocaleString()}</b><span>of {(usage.charLimit || 0).toLocaleString()} TTS chars/mo</span></div>
    </div>
    <h3 className="pf-h3">Continue where you left off</h3>
    {recent.length === 0
      ? <div className="pf-empty">No publications yet. <a href="Projects.html">Create your first publication →</a></div>
      : <div className="pf-cards">{recent.map(function (p) {
        var r = Store.getReading ? Store.getReading(me.id, p.id) : null;
        return <a className="pf-card" key={p.id} href={'ProofReader.html?p=' + encodeURIComponent(p.id)}>
          <div className="pf-card-t">{p.title}{p._shared ? <span className="pf-shared">shared</span> : null}</div>
          <div className="pf-card-m">{r ? 'Resume at sentence ' + (r.idx + 1) + ' · ' + rel(r.at) : 'Updated ' + rel(p.updated)}</div>
        </a>;
      })}</div>}
    <div className="pf-actions"><a className="btn-primary" href="Projects.html">All publications &amp; new</a></div>
    {rprojects.length ? <div style={{ marginTop: 20 }}>
      <h3 className="pf-h3">Research projects</h3>
      <div className="pf-cards">{rprojects.map(function (p) {
        var STG = ['Setup', 'Idea', 'Literature', 'Protocol', 'Data', 'Compute', 'Analysis', 'Writing', 'Submission'];
        return <a className="pf-card" key={p.id} href={adminTargetUser() ? 'Research.html?adminView=1' : 'Research.html'}><div className="pf-card-t">{p.title}</div><div className="pf-card-m">{(STG[p.stage] || 'Setup') + ' · ' + (p.status || 'active')}</div></a>;
      })}</div>
      <div className="pf-actions" style={{ marginTop: 10 }}><a className="btn-ghost" href={adminTargetUser() ? 'Research.html?adminView=1' : 'Research.html'}>Open Research →</a></div>
    </div> : null}
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

// #1 — edit MTMT + ORCID after registration (cloud accounts), saved to the profiles table
function ResearchIds(props) {
  var [v, setV] = useState({ mtmt: '', orcid: '', loaded: false });
  var [busy, setBusy] = useState(false), [msg, setMsg] = useState(null);
  useEffect(function () {
    var B = window.PR_BACKEND;
    if (!(B && B.sb && B.mode === 'cloud')) { setV({ mtmt: '', orcid: '', loaded: true }); return; }
    B.sb.from('profiles').select('mtmt_id,orcid').eq('id', props.id).maybeSingle().then(function (r) {
      var d = (r && r.data) || {};
      setV({ mtmt: d.mtmt_id || '', orcid: d.orcid || '', loaded: true });
    });
  }, []);
  function save(e) {
    if (e) e.preventDefault();
    var orc = v.orcid.trim();
    if (orc && !/^\d{4}-\d{4}-\d{4}-\d{3}[\dXx]$/.test(orc)) { setMsg(['err', 'Az ORCID formátuma: 0000-0000-0000-0000.']); return; }
    var B = window.PR_BACKEND;
    if (!(B && B.sb)) { setMsg(['err', 'Csak bejelentkezve menthető.']); return; }
    setBusy(true); setMsg(null);
    B.sb.from('profiles').update({ mtmt_id: v.mtmt.trim() || null, orcid: orc || null }).eq('id', props.id).then(function (r) {
      setBusy(false);
      if (r && r.error) { setMsg(['err', r.error.message]); return; }
      setMsg(['ok', 'Mentve.']);
    });
  }
  return <div className="pf-panel">
    <div className="pf-set-h">Kutatói azonosítók</div>
    <form className="pf-pw" onSubmit={save}>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 3 }}>MTMT azonosító</div>
      <input className="pf-login-in" value={v.mtmt} placeholder="pl. 10012345" onChange={function (e) { setV(Object.assign({}, v, { mtmt: e.target.value })); }} aria-label="MTMT azonosító" />
      <div style={{ fontSize: 12, color: 'var(--muted)', margin: '6px 0 3px' }}>ORCID</div>
      <input className="pf-login-in" value={v.orcid} placeholder="0000-0000-0000-0000" onChange={function (e) { setV(Object.assign({}, v, { orcid: e.target.value })); }} aria-label="ORCID" />
      <div className="pf-pw-acts"><button className="btn-primary" type="submit" disabled={busy}>{busy ? 'Mentés…' : 'Mentés'}</button></div>
    </form>
    {msg ? <div className={'pf-note ' + (msg[0] === 'ok' ? 'ok' : 'err')}>{msg[1]}</div> : null}
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
    {((window.PR_BACKEND && window.PR_BACKEND.mode) === 'cloud') ? <ResearchIds id={me.id} /> : null}
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
    ['Settings (voice / spell / pronunciation)', isCloud ? 'Supabase (your account)' : 'This browser only', isCloud ? 'yes — any device' : 'no', 'no — yours alone'],
    ['Usage & reading positions', 'This browser only', 'no', 'no'],
    ['ElevenLabs API key', 'This browser only', 'no', 'no — never sent to Publify'],
    ['Generated audio (MP3 cache)', 'This browser (IndexedDB)', 'no', 'shared cache on cloud projects'],
  ];
  return <div>
    <h2 className="pf-h">Data &amp; sync</h2>
    <div className="pf-note bnr">{isCloud
      ? 'You are signed in to your account (cloud) — your profile, publications, projects, publication files and settings sync to Supabase. Your usage, reading positions, ElevenLabs key and audio cache still live only in THIS browser.'
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
  var me = props.me, preview = props.preview;
  var staticRec = (window.PRPubs && window.PRPubs.forUser(me)) || null;
  var [liveRows, setLiveRows] = useState(null);   // publications-table rows (cloud): preferred & refreshable
  var [syncing, setSyncing] = useState(false);
  var [syncMsg, setSyncMsg] = useState(null);
  var [counts, setCounts] = useState({});
  var [open, setOpen] = useState(null);     // expanded pubKey
  var [files, setFiles] = useState({});     // pubKey -> [meta]
  var [busy, setBusy] = useState(null);     // pubKey currently uploading
  var [err, setErr] = useState(null);
  var [viewer, setViewer] = useState(null); // {url, name} for the built-in PDF viewer
  var inputRef = useRef(null);
  var [adding, setAdding] = useState(false);
  var [fm, setFm] = useState({ title: '', authors: '', year: '', journal: '', doi: '' });
  var [saving, setSaving] = useState(false);
  function rowToPub(r) { return { mtid: r.mtid, title: r.title, year: r.year, firstAuthor: r.first_author, authorCount: r.author_count, journal: r.journal, volume: r.volume, issue: r.issue, pages: r.pages, doi: r.doi, citations: r.citations, indepCitations: r.indep_citations, oaType: r.oa_type, category: r.category, core: r.core, citation: r.citation, type: r.type, typeHu: r.type_hu, mtmtUrl: r.mtmt_url }; }
  // merge the bundled MTMT snapshot with the live publications table (table wins per mtid → freshest data)
  var _by = {};
  ((staticRec && staticRec.publications) || []).forEach(function (p) { _by[p.mtid] = p; });
  (liveRows || []).forEach(function (r) { _by[r.mtid] = rowToPub(r); });
  var pubs = Object.keys(_by).map(function (k) { return _by[k]; });
  var synced = !!(liveRows && liveRows.length);
  var rec = staticRec || (synced ? { name: me.name, mtmtId: '', orcid: null, publications: pubs } : null);
  // on mount (cloud): load this user's publications table so a refresh persists across reloads
  useEffect(function () {
    var B = window.PR_BACKEND;
    if (!(B && B.sb && B.user)) return;
    B.sb.from('publications').select('*').eq('researcher_id', B.user.id).order('year', { ascending: false }).then(function (r) { if (r && r.data) setLiveRows(r.data); });
  }, []);
  // refresh: pull the latest from MTMT (by the user's mtmt_id) via the mtmt-sync edge function
  function syncMtmt() {
    var B = window.PR_BACKEND;
    if (!(B && B.sb)) { setSyncMsg(['err', 'Csak bejelentkezve frissíthető.']); return; }
    setSyncing(true); setSyncMsg(null);
    B.sb.functions.invoke('mtmt-sync').then(function (res) {
      setSyncing(false);
      if (res && res.error) { setSyncMsg(['err', 'A frissítés nem sikerült (mtmt-sync edge function nincs telepítve?).']); return; }
      var d = res && res.data;
      if (d && d.error) { setSyncMsg(['err', d.error === 'no_mtmt_id' ? 'Előbb állítsd be az MTMT azonosítód a Beállításokban.' : ('Hiba: ' + d.error)]); return; }
      setLiveRows((d && d.publications) || []);
      setSyncMsg(['ok', '✓ Frissítve — ' + ((d && d.count) || 0) + ' publikáció az MTMT-ből.']);
    }, function () { setSyncing(false); setSyncMsg(['err', 'A frissítés nem sikerült.']); });
  }
  var PF = window.PRPubFiles;
  var keyOf = function (p) { return me.email + ':' + p.mtid; };
  useEffect(function () { if (PF && pubs.length) PF.counts(pubs.map(keyOf)).then(setCounts); }, []); // eslint-disable-line
  function loadFiles(k) { if (PF) PF.list(k).then(function (fs) { setFiles(function (m) { var n = Object.assign({}, m); n[k] = fs; return n; }); }); }
  function toggle(k) { if (open === k) { setOpen(null); return; } setOpen(k); if (files[k] === undefined) loadFiles(k); }
  function pick(k) { if (inputRef.current) { inputRef.current.value = ''; inputRef.current.dataset.k = k; inputRef.current.click(); } } // target stashed on the input, not a shared ref
  function onFile(e) {
    var k = e.target.dataset.k, f = e.target.files && e.target.files[0]; if (!k || !f || !PF) return;
    setErr(null); setBusy(k);
    PF.add(k, f).then(function () { setBusy(null); setOpen(k); loadFiles(k); PF.counts(pubs.map(keyOf)).then(setCounts); }, function (er) { setBusy(null); setErr((er && er.message) || 'Upload failed.'); });
  }
  function view(m) { if (PF) PF.getBlob(m.id).then(function (b) { if (b) { var u = URL.createObjectURL(b); setViewer({ url: u, name: m.name, type: m.type }); } }); }
  function closeViewer() { if (viewer) { try { URL.revokeObjectURL(viewer.url); } catch (e) { } } setViewer(null); }
  function download(m) { if (PF) PF.getBlob(m.id).then(function (b) { if (b) { var u = URL.createObjectURL(b); var a = document.createElement('a'); a.href = u; a.download = m.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 5000); } }); }
  function del(id, k) { if (PF) PF.remove(id).then(function () { loadFiles(k); PF.counts(pubs.map(keyOf)).then(setCounts); }); }
  function addPub() {
    var B = window.PR_BACKEND;
    if (!B || !B.sb || !B.user) { setErr('Sign in to add publications.'); return; }
    if (!fm.title.trim()) { setErr('A title is required.'); return; }
    setSaving(true); setErr(null);
    var au = fm.authors.trim();
    B.sb.from('publications').insert({
      researcher_id: B.user.id, mtid: -Date.now(), title: fm.title.trim(),
      year: parseInt(fm.year, 10) || null, first_author: au ? au.split(',')[0].trim() : null,
      author_count: au ? au.split(',').length : 1, journal: fm.journal.trim() || null,
      doi: fm.doi.trim() || null, type: 'Manual', category: 'Manual',
      citation: (au ? au + '. ' : '') + fm.title.trim() + (fm.year ? ' (' + fm.year + ')' : '') + (fm.journal ? ' ' + fm.journal : '')
    }).then(function (r) { setSaving(false); if (r && r.error) { setErr(r.error.message); return; } location.reload(); });
  }
  var isCloud = !!(window.PR_BACKEND && window.PR_BACKEND.sb && window.PR_BACKEND.user);
  var refreshBtn = (isCloud && !preview) ? <button className="btn-ghost" disabled={syncing} onClick={syncMtmt} title="A publikációs lista frissítése az MTMT-ből (az MTMT azonosítód alapján)">{syncing ? 'Frissítés…' : '🔄 Frissítés MTMT-ből'}</button> : null;
  var syncNote = syncMsg ? <div className={'pf-note ' + (syncMsg[0] === 'ok' ? 'ok' : 'err')} style={{ margin: '6px 0 0' }}>{syncMsg[1]}</div> : null;
  var pin = { width: '100%', height: 36, border: '1px solid var(--pf-line, #e6e8ee)', borderRadius: 8, padding: '0 10px', marginBottom: 6, fontFamily: 'inherit', fontSize: 13.5, boxSizing: 'border-box', background: 'var(--pf-paper, #fff)', color: 'inherit' };
  var addUI = preview ? null : <div className="pf-panel" style={{ marginBottom: 14 }}>
    {!adding
      ? <button className="btn-ghost" onClick={function () { setAdding(true); }}>+ Add a publication manually</button>
      : <div>
        <input style={pin} placeholder="Title *" value={fm.title} onChange={function (e) { setFm(Object.assign({}, fm, { title: e.target.value })); }} />
        <input style={pin} placeholder="Authors (comma-separated)" value={fm.authors} onChange={function (e) { setFm(Object.assign({}, fm, { authors: e.target.value })); }} />
        <div style={{ display: 'flex', gap: 8 }}>
          <input style={pin} placeholder="Year" value={fm.year} onChange={function (e) { setFm(Object.assign({}, fm, { year: e.target.value })); }} />
          <input style={pin} placeholder="Journal / venue" value={fm.journal} onChange={function (e) { setFm(Object.assign({}, fm, { journal: e.target.value })); }} />
        </div>
        <input style={pin} placeholder="DOI (optional)" value={fm.doi} onChange={function (e) { setFm(Object.assign({}, fm, { doi: e.target.value })); }} />
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button className="btn-primary" disabled={saving} onClick={addPub}>{saving ? 'Saving…' : 'Add publication'}</button>
          <button className="btn-ghost" onClick={function () { setAdding(false); setErr(null); }}>Cancel</button>
        </div>
      </div>}
  </div>;

  if (!rec) return <div><div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}><h2 className="pf-h" style={{ margin: 0 }}>My publications</h2>{refreshBtn}</div>{syncNote}{addUI}{err ? <div className="pf-note err">{err}</div> : null}<div className="pf-empty">No publications yet — add one above, or refresh from MTMT. (Researcher lists are imported from MTMT.)</div></div>;

  var totalCites = pubs.reduce(function (a, p) { return a + (p.citations || 0); }, 0);
  // group by year desc
  var years = [], byYear = {};
  pubs.forEach(function (p) { var y = p.year || 0; if (!byYear[y]) { byYear[y] = []; years.push(y); } byYear[y].push(p); });
  years.sort(function (a, b) { return b - a; });

  return <div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}><h2 className="pf-h" style={{ margin: 0 }}>My publications</h2>{refreshBtn}</div>
    {syncNote}
    {addUI}
    <input ref={inputRef} type="file" accept="application/pdf,.pdf,.doc,.docx,.txt,.csv,.xlsx,.zip,.tex,.bib,image/*" style={{ display: 'none' }} onChange={onFile} />
    <div className="pf-panel">
      <div className="pf-pub-sum">
        <div><b>{pubs.length}</b><span>publications</span></div>
        <div><b>{totalCites}</b><span>citations (MTMT)</span></div>
        <div><b>{pubs.filter(function (p) { return p.doi; }).length}</b><span>with a DOI</span></div>
      </div>
      <div className="pf-note">Imported from <a href={'https://m2.mtmt.hu/gui2/?mode=browse&params=author;' + rec.mtmtId} target="_blank" rel="noopener">MTMT</a> {synced ? '(frissítve MTMT-ből)' : '(as of 19 June 2026)'}{rec.orcid ? <span> · ORCID <a href={'https://orcid.org/' + rec.orcid} target="_blank" rel="noopener">{rec.orcid}</a></span> : null}. Citation counts are a snapshot. {preview ? <span><b>Admin:</b> you can upload or manage PDFs on behalf of {me.name} — files are stored in their account.</span> : <span>Attach the PDF or data files for each item below — {(window.PRPubFiles && window.PRPubFiles.cloud) ? 'they are stored securely in your cloud account (Supabase Storage), available on any device.' : 'they are stored in this browser.'}</span>}</div>
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
          {n
            ? <button className="pf-pub-files" onClick={function () { toggle(k); }}>📄 {n} file{n === 1 ? '' : 's'} {open === k ? '▴' : '▾'}</button>
            : <button className="pf-pub-files up" disabled={busy === k} onClick={function () { pick(k); }}>{busy === k ? 'Uploading…' : '⬆ Upload PDF'}</button>}
          {open === k ? <div className="pf-pub-drop">
            {(files[k] || []).map(function (m) { return <div className="pf-file" key={m.id}>
              <span className="pf-file-n" title={m.name}>{m.name}</span>
              <span className="pf-file-s">{fmtBytes(m.size)}</span>
              <button onClick={function () { view(m); }}>View</button>
              <button onClick={function () { download(m); }}>Download</button>
              <button className="pf-file-x" onClick={function () { del(m.id, k); }}>✕</button>
            </div>; })}
            <button className="btn-ghost" disabled={busy === k} onClick={function () { pick(k); }}>{busy === k ? 'Uploading…' : '+ Add another file'}</button>
          </div> : null}
        </div>;
      })}
    </div>; })}
    {viewer ? <PdfViewer file={viewer} me={me} onClose={closeViewer} /> : null}
  </div>;
}

/* ---- read-aloud: lazy-loaded PDF.js text extraction + a sentence player over PREleven
   (ElevenLabs, cached + metered) with a free browser-TTS fallback. ---- */
function ensurePdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (window._pdfjsLoading) return window._pdfjsLoading;
  window._pdfjsLoading = new Promise(function (res, rej) {
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
    s.onload = function () { try { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js'; } catch (e) { } res(window.pdfjsLib); };
    s.onerror = function () { window._pdfjsLoading = null; rej(new Error('Could not load the PDF reader.')); };
    document.head.appendChild(s);
  });
  return window._pdfjsLoading;
}
function extractPdfText(url) {
  return ensurePdfJs().then(function (lib) {
    return fetch(url).then(function (r) { return r.arrayBuffer(); }).then(function (ab) { return lib.getDocument({ data: new Uint8Array(ab) }).promise; });
  }).then(function (pdf) {
    var text = '', chain = Promise.resolve();
    for (var i = 1; i <= pdf.numPages; i++) (function (n) {
      chain = chain.then(function () { return pdf.getPage(n); }).then(function (pg) { return pg.getTextContent(); })
        .then(function (tc) { text += tc.items.map(function (it) { return it.str; }).join(' ') + '\n'; });
    })(i);
    return chain.then(function () { return text; });
  });
}
function splitSentences(text) {
  var clean = String(text || '').replace(/-\s*\n\s*/g, '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  var raw = clean.match(/[^.!?]*[.!?]+|\S[^.!?]*$/g) || [clean];
  var out = [];
  raw.forEach(function (s) {
    s = s.trim(); if (s.length < 2) return;
    while (s.length > 320) { var cut = s.lastIndexOf(' ', 320); if (cut < 80) cut = 320; out.push(s.slice(0, cut).trim()); s = s.slice(cut).trim(); }
    if (s) out.push(s);
  });
  return out;
}
function voiceCfg() {
  var p = (Store.prefs && Store.prefs()) || {};
  return { engine: p.engine, elevenVoice: p.elevenVoice || (E && E.voices && E.voices[0] && E.voices[0].id), model: p.model, stability: p.stability, similarity: p.similarity, rate: p.rate || 1, voiceURI: p.voiceURI };
}
function elevenOn(c) { return c.engine !== 'browser' && E && E.hasKey(); }

// Put PDF.js text spans into human reading order (handles a simple 2-column layout) so sentences
// come out contiguous instead of in scrambled content-stream order.
function orderReading(spans, pageW) {
  if (spans.length < 2) return spans;
  var mid = pageW / 2, crossing = 0, leftC = [], rightC = [];
  spans.forEach(function (s) {
    if (s.left < mid && (s.left + s.w) > mid) crossing++;
    ((s.left + s.w / 2) < mid ? leftC : rightC).push(s);
  });
  function byTopLeft(a, b) { return Math.abs(a.top - b.top) > 6 ? a.top - b.top : a.left - b.left; }
  if (leftC.length > spans.length * 0.25 && rightC.length > spans.length * 0.25 && crossing < spans.length * 0.08) {
    leftC.sort(byTopLeft); rightC.sort(byTopLeft); return leftC.concat(rightC);   // two columns: left then right
  }
  return spans.slice().sort(byTopLeft);
}
// Words that end in "." but do NOT end a sentence.
var SENT_ABBR = { 'e.g': 1, 'i.e': 1, 'al': 1, 'vs': 1, 'cf': 1, 'fig': 1, 'figs': 1, 'eq': 1, 'eqs': 1, 'no': 1, 'nos': 1, 'pp': 1, 'p': 1, 'dr': 1, 'prof': 1, 'mr': 1, 'mrs': 1, 'ms': 1, 'st': 1, 'vol': 1, 'ed': 1, 'eds': 1, 'approx': 1, 'inc': 1, 'ltd': 1, 'co': 1, 'etc': 1, 'ref': 1, 'refs': 1, 'sec': 1, 'ch': 1, 'tab': 1, 'resp': 1, 'al': 1, 'phd': 1, 'msc': 1, 'bsc': 1 };
function endsSentence(buf) {
  var t = buf.replace(/[)\]"'»“”’]+$/, '');
  if (!/[.!?]$/.test(t)) return false;
  if (/[!?]$/.test(t)) return true;
  if (/\.\.\.$/.test(t)) return false;                       // ellipsis, mid-sentence
  if (/(^|\s)[A-Z]\.$/.test(t)) return false;                // a single capital initial, e.g. "J."
  var m = t.match(/([A-Za-z.]+)\.$/); var word = m ? m[1].toLowerCase().replace(/\.+$/, '') : '';
  if (word && SENT_ABBR[word]) return false;                 // known abbreviation
  return true;
}

function PdfViewer(props) {
  var f = props.file;
  var meId = (props.me && props.me.id) || ((Auth.current && Auth.current()) || {}).id;
  var [phase, setPhase] = useState('idle');      // idle | loading | ready | error
  var [sents, setSents] = useState([]);
  var [idx, setIdx] = useState(0);
  var [playing, setPlaying] = useState(false);
  var [err, setErr] = useState('');
  var [view, setView] = useState('orig');        // orig (native iframe) | hl (rendered PDF + highlight overlay)
  var audioRef = useRef(null), idxRef = useRef(0), playingRef = useRef(false), genRef = useRef(0);
  var hlRef = useRef(null), sentsRef = useRef([]), renderedRef = useRef(false);
  idxRef.current = idx;
  var cfg = voiceCfg();
  var isPdf = /pdf/i.test((f && f.type) || '') || /\.pdf$/i.test((f && f.name) || '');

  // Fully halt any audio: cancel browser TTS, pause + release the <audio>, drop its handlers.
  function stopAudio() {
    try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) { }
    var a = audioRef.current; audioRef.current = null;
    if (a) { try { a.onended = null; if (a.pause) a.pause(); if ('src' in a) a.src = ''; } catch (e) { } }
  }
  // Bump the generation token → every in-flight fetch/onended/chain from an older gen aborts.
  function newGen() { genRef.current = (genRef.current + 1) % 1e9; stopAudio(); return genRef.current; }
  useEffect(function () { return function () { genRef.current++; playingRef.current = false; stopAudio(); }; }, []);
  useEffect(function () {
    var onKey = function (e) { if (e.key === 'Escape') { newGen(); playingRef.current = false; props.onClose(); } };
    window.addEventListener('keydown', onKey); return function () { window.removeEventListener('keydown', onKey); };
  }, []);

  function speakAt(i, list, gen) {
    if (gen !== genRef.current) return;                          // a newer stop/seek/play superseded us
    if (i < 0 || i >= list.length) { setPlaying(false); playingRef.current = false; if (i >= list.length) setIdx(0); return; }
    setIdx(i); idxRef.current = i; setPlaying(true); playingRef.current = true;
    var text = list[i], c = voiceCfg();
    var alive = function () { return gen === genRef.current && playingRef.current; };
    if (elevenOn(c)) {
      try { E.prefetch(list.slice(i + 1, i + 3).map(function (t) { return { text: t }; }), c, meId); } catch (e) { }
      E.getAudio(text, c, meId).then(function (url) {
        if (gen !== genRef.current) return;                      // stop/seek happened during the fetch
        var a = new Audio(url); audioRef.current = a; try { a.playbackRate = c.rate || 1; } catch (e) { }
        a.onended = function () { if (alive()) speakAt(i + 1, list, gen); };
        if (playingRef.current) a.play().catch(function () { });  // a pause during the fetch must win
      }, function () { if (alive()) speakAt(i + 1, list, gen); });
    } else {
      try { window.speechSynthesis.cancel(); } catch (e) { }
      var u = new SpeechSynthesisUtterance(text); u.rate = c.rate || 1;
      try { if (c.voiceURI) { var v = (window.speechSynthesis.getVoices() || []).filter(function (x) { return x.voiceURI === c.voiceURI; })[0]; if (v) u.voice = v; } } catch (e) { }
      u.onend = function () { if (alive()) speakAt(i + 1, list, gen); };
      audioRef.current = { pause: function () { try { window.speechSynthesis.pause(); } catch (e) { } }, play: function () { try { window.speechSynthesis.resume(); } catch (e) { } } };
      if (playingRef.current) { try { window.speechSynthesis.speak(u); } catch (e) { } }
    }
  }

  // Render each page to a canvas (keeps the real layout) + an overlaid, transparent PDF.js text
  // layer whose spans we tag with their sentence index → highlight + click-to-read on the PDF.
  function renderHighlight() {
    if (renderedRef.current) return Promise.resolve(sentsRef.current);
    setPhase('loading'); setErr('');
    return ensurePdfJs().then(function (lib) {
      return fetch(f.url).then(function (r) { return r.arrayBuffer(); }).then(function (ab) { return lib.getDocument({ data: new Uint8Array(ab) }).promise; }).then(function (pdf) {
        var container = hlRef.current; if (!container) return [];
        container.innerHTML = '';
        var pageSpans = [], chain = Promise.resolve();
        var maxW = (container.clientWidth || 820) - 28;
        for (var p = 1; p <= pdf.numPages; p++) (function (pn) {
          chain = chain.then(function () { return pdf.getPage(pn); }).then(function (page) {
            var base = page.getViewport({ scale: 1 });
            var scale = Math.max(0.5, Math.min(2, maxW / base.width));
            var vp = page.getViewport({ scale: scale });
            var pageDiv = document.createElement('div'); pageDiv.className = 'pf-pdfpage';
            pageDiv.style.width = Math.floor(vp.width) + 'px'; pageDiv.style.height = Math.floor(vp.height) + 'px';
            var canvas = document.createElement('canvas'); canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
            pageDiv.appendChild(canvas);
            var tld = document.createElement('div'); tld.className = 'textLayer';
            tld.style.width = Math.floor(vp.width) + 'px'; tld.style.height = Math.floor(vp.height) + 'px';
            pageDiv.appendChild(tld);
            container.appendChild(pageDiv);
            return page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise
              .then(function () { return page.getTextContent(); })
              .then(function (tc) {
                var task = lib.renderTextLayer({ textContent: tc, textContentSource: tc, container: tld, viewport: vp, textDivs: [] });
                return (task.promise || task).then(function () {
                  var spans = tld.querySelectorAll('span'), arr = [];
                  for (var k = 0; k < spans.length; k++) { var d = spans[k], txt = d.textContent || ''; if (txt.trim()) arr.push({ div: d, text: txt, left: d.offsetLeft, top: d.offsetTop, w: d.offsetWidth }); }
                  pageSpans[pn - 1] = { spans: arr, w: vp.width };
                });
              });
          });
        })(p);
        return chain.then(function () {
          // walk spans in human reading order; accumulate text into sentences with smart boundaries
          var ordered = [];
          pageSpans.forEach(function (pg) { if (pg) ordered = ordered.concat(orderReading(pg.spans, pg.w)); });
          var sentences = [], curIdx = 0, buf = '';
          ordered.forEach(function (sp) {
            sp.div.dataset.sent = curIdx; sp.div.classList.add('tl-s');
            buf += (buf ? ' ' : '') + sp.text;
            if (endsSentence(buf) && buf.trim().length >= 8) { sentences[curIdx] = buf.replace(/\s+/g, ' ').trim(); curIdx++; buf = ''; }
          });
          if (buf.trim()) sentences[curIdx] = buf.replace(/\s+/g, ' ').trim();   // tail (spans already tagged curIdx)
          sentsRef.current = sentences; setSents(sentences); renderedRef.current = true;
          if (!sentences.length) { setPhase('error'); setErr('No selectable text in this PDF — it may be a scan.'); }
          else setPhase('ready');
          return sentences;
        });
      });
    }, function (e) { setPhase('error'); setErr((e && e.message) || 'Could not render this PDF.'); return []; });
  }
  function showHighlight() { setView('hl'); return renderHighlight(); }
  function start() { showHighlight().then(function (list) { if (list && list.length) { var g = newGen(); playingRef.current = true; speakAt(0, list, g); } }); }
  function togglePlay() {
    if (playing) { setPlaying(false); playingRef.current = false; try { if (audioRef.current && audioRef.current.pause) audioRef.current.pause(); } catch (e) { } return; }
    if (!renderedRef.current || phase !== 'ready') { start(); return; }
    setView('hl'); setPlaying(true); playingRef.current = true;
    if (audioRef.current && audioRef.current.play) audioRef.current.play(); else { var g = newGen(); speakAt(idx, sentsRef.current, g); }
  }
  function stopAll() { newGen(); playingRef.current = false; setPlaying(false); setIdx(0); }
  function seek(i) { var g = newGen(); playingRef.current = true; speakAt(Math.max(0, Math.min(sentsRef.current.length - 1, i)), sentsRef.current, g); }   // click a sentence → read from there
  function jump(d) { seek(idx + d); }
  function onHlClick(e) { var t = e.target; if (t && t.classList && t.classList.contains('tl-s') && t.dataset && t.dataset.sent != null) seek(parseInt(t.dataset.sent, 10) || 0); }
  function onHlOver(e) { var t = e.target; if (!t || !t.classList || !t.classList.contains('tl-s') || t.dataset.sent == null || !hlRef.current) return; var ss = hlRef.current.querySelectorAll('.tl-s[data-sent="' + t.dataset.sent + '"]'); for (var i = 0; i < ss.length; i++) ss[i].classList.add('hov'); }
  function onHlOut(e) { if (!hlRef.current) return; var ss = hlRef.current.querySelectorAll('.tl-s.hov'); for (var i = 0; i < ss.length; i++) ss[i].classList.remove('hov'); }
  // highlight the spoken sentence's spans on the rendered PDF + scroll into view
  useEffect(function () {
    if (view !== 'hl' || !hlRef.current) return;
    var on = hlRef.current.querySelectorAll('.tl-s.on'); for (var i = 0; i < on.length; i++) on[i].classList.remove('on');
    var cur = hlRef.current.querySelectorAll('.tl-s[data-sent="' + idx + '"]'); for (var j = 0; j < cur.length; j++) cur[j].classList.add('on');
    if (cur[0] && cur[0].scrollIntoView) { try { cur[0].scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { try { cur[0].scrollIntoView(); } catch (e2) { } } }
  }, [idx, view, phase]);

  return <div className="pf-viewer" onMouseDown={props.onClose}>
    <div className="pf-viewer-box" onMouseDown={function (e) { e.stopPropagation(); }}>
      <div className="pf-viewer-bar">
        <span className="pf-viewer-name" title={f.name}>{f.name}</span>
        {isPdf ? <button className="btn-ghost" title="Toggle sentence highlighting on the PDF" onClick={function () { view === 'hl' ? setView('orig') : showHighlight(); }}>{view === 'hl' ? '📄 Original' : '✨ Highlight'}</button> : null}
        <a className="btn-ghost" href={f.url} download={f.name}>Download</a>
        <button className="btn-ghost" onClick={function () { newGen(); playingRef.current = false; props.onClose(); }}>✕ Close</button>
      </div>
      {isPdf
        ? (view === 'hl'
          ? <div className="pf-pdf-wrap">
              {phase === 'loading' ? <div className="pf-pdf-load">Rendering the PDF…</div> : phase === 'error' ? <div className="pf-pdf-load" style={{ color: '#fecaca' }}>{err}</div> : null}
              <div className="pf-pdf" ref={hlRef} onClick={onHlClick} onMouseOver={onHlOver} onMouseOut={onHlOut} />
            </div>
          : <iframe className="pf-viewer-frame" src={f.url} title={f.name} />)
        : /^image\//i.test(f.type || '')
          ? <div className="pf-viewer-img"><img src={f.url} alt={f.name} /></div>
          : <div className="pf-viewer-other">This file type can’t be previewed inline. <a href={f.url} download={f.name}>Download it</a> to open.</div>}
      {isPdf ? <div className="pf-ra">
        <div className="pf-ra-row">
          <button className="pf-ra-btn play" onClick={togglePlay} disabled={phase === 'loading'} title={playing ? 'Pause' : 'Read aloud'}>{phase === 'loading' ? '…' : playing ? '⏸' : '▶'}</button>
          {phase === 'ready' ? [
            <button key="p" className="pf-ra-btn" onClick={function () { jump(-1); }} title="Previous sentence">⏮</button>,
            <button key="n" className="pf-ra-btn" onClick={function () { jump(1); }} title="Next sentence">⏭</button>,
            <button key="s" className="pf-ra-btn" onClick={stopAll} title="Stop">⏹</button>,
            <div key="pr" className="pf-ra-prog"><i style={{ width: (sents.length ? ((idx + 1) / sents.length * 100) : 0) + '%' }} /></div>,
            <span key="m" className="pf-ra-meta">{(idx + 1) + '/' + sents.length} · {elevenOn(cfg) ? 'ElevenLabs' : 'Browser voice'}{elevenOn(cfg) && E && E.cached && E.cached(sents[idx], cfg) ? <span className="pf-ra-cached"> · cached</span> : null}</span>
          ] : phase === 'idle' ? <span className="pf-ra-meta">▶ Read this PDF aloud{elevenOn(cfg) ? ' with ElevenLabs' : ' (browser voice — add an ElevenLabs key in the editor for premium audio)'}.</span>
            : phase === 'loading' ? <span className="pf-ra-meta">Extracting text…</span> : null}
        </div>
        {phase === 'error' ? <div className="pf-ra-err">{err}</div> : phase === 'ready' ? <div className="pf-ra-cur">{sents[idx]}</div> : null}
      </div> : null}
    </div>
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

// Admin "view as": when opened from the Admin page with ?adminView=1 and a stored target (and a
// real cloud session), preview that user's profile read-only. Only public/admin-readable data is
// shown (profile + publications); private data stays RLS-gated to the real session.
function adminTargetUser() {
  try {
    if (!/[?&]adminView=1/.test(location.search)) return null;
    var BE = window.PR_BACKEND, u = BE && BE.user; if (!u) return null;
    if (!(u.role === 'admin' || (BE.profiles && BE.profiles[u.id] && BE.profiles[u.id].role === 'admin'))) return null; // admin-only
    var t = JSON.parse(localStorage.getItem('pr-admin-view') || 'null');
    return t && t.email ? t : null;
  } catch (e) { return null; }
}

// The editable system prompt for the user's "Chat with Publify" research assistant (Research → Ideas).
function ChatPrompt(props) {
  var me = props.me;
  var [prompt, setPrompt] = useState('');
  var [loaded, setLoaded] = useState(false);
  var [saving, setSaving] = useState(false);
  var [status, setStatus] = useState('');
  useEffect(function () {
    var BE = window.PR_BACKEND;
    if (BE && BE.sb && BE.user) {
      BE.sb.from('research_system_prompts').select('prompt').eq('user_id', BE.user.id).maybeSingle().then(function (r) {
        setPrompt((r && r.data && r.data.prompt) || ''); setLoaded(true);
      }, function () { setLoaded(true); });
    } else { setLoaded(true); }
  }, []); // eslint-disable-line
  function save() {
    var BE = window.PR_BACKEND;
    if (!BE || !BE.sb || !BE.user) { setStatus('Sign in to save.'); return; }
    setSaving(true); setStatus('');
    BE.sb.from('research_system_prompts').upsert({ user_id: BE.user.id, prompt: prompt, updated_at: new Date().toISOString() }, { onConflict: 'user_id' }).then(function (r) {
      setSaving(false);
      setStatus(r && r.error ? ('Error: ' + r.error.message) : 'Saved ✓');
      setTimeout(function () { setStatus(''); }, 2500);
    });
  }
  var words = prompt.trim() ? prompt.trim().split(/\s+/).length : 0;
  return <div>
    <h2 className="pf-h">Chat prompt</h2>
    <p style={{ fontSize: 13.5, color: 'var(--muted)', margin: '0 0 14px', maxWidth: '52em', lineHeight: 1.6 }}>
      This is the system prompt that steers your <b>“Chat with Publify”</b> assistant in the Research → Ideas tab.
      It's pre-tuned to your field and publications — edit it freely to change how the assistant brainstorms,
      challenges, and proposes research ideas with you.
    </p>
    {!loaded ? <div className="pf-empty">Loading…</div> : <div className="pf-panel">
      <textarea value={prompt} onChange={function (e) { setPrompt(e.target.value); }} rows={18} spellCheck={false}
        style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', fontSize: 13.5, lineHeight: 1.6, padding: '12px 14px', border: '1px solid var(--line)', borderRadius: 10, background: 'var(--surface, #fff)', color: 'inherit', resize: 'vertical' }}
        placeholder="Te egy világszínvonalú kutatótárs vagy a … területén. Segíts ötletelni, réseket találni, és falszifikálható kutatási kérdéseket javasolni…" />
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 10, flexWrap: 'wrap' }}>
        <button className="btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save prompt'}</button>
        <span style={{ fontSize: 12.5, color: 'var(--faint)' }}>{words} words</span>
        {status ? <span style={{ fontSize: 13, fontWeight: 600, color: /Error/.test(status) ? 'var(--danger)' : 'var(--ok)' }}>{status}</span> : null}
      </div>
    </div>}
  </div>;
}

function App() {
  var preview = adminTargetUser();
  var [me, setMe] = useState(function () { return preview || Auth.current(); });
  // admin "view as": the gate in adminTargetUser() needs the admin's role, which loads async — re-check
  // when it resolves (pr-profile) and switch to the viewed user, so the profile isn't stuck on the admin.
  useEffect(function () {
    function sync() { var t = adminTargetUser(); if (t) setMe(function (cur) { return cur && cur.id === t.id ? cur : t; }); }
    sync();
    window.addEventListener('pr-profile', sync);
    return function () { window.removeEventListener('pr-profile', sync); };
  }, []);
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
  // in preview only Overview + Publications are faithful to the target (the rest is session-bound)
  var RAIL = [['overview', 'Overview']];
  if (myPubs) RAIL.push(['publications', 'My publications']);
  if (!preview) RAIL = RAIL.concat([['chatprompt', 'Chat prompt'], ['usage', 'Usage & cost'], ['settings', 'Settings'], ['data', 'Data & sync']]);
  var allowed = RAIL.map(function (r) { return r[0]; });
  var curRoute = allowed.indexOf(route) >= 0 ? route : 'overview';

  return <div className="pf">
    {preview ? <div style={{ background: 'var(--warn-bg)', color: '#92400e', padding: '9px 16px', fontSize: 13, textAlign: 'center', fontWeight: 600 }}>
      👁 Admin preview — viewing <b>{me.name}</b>’s profile read-only. <a href="PhD.html?adminView=1" style={{ color: '#92400e' }}>Doctoral School</a> · <a href="Admin.html" style={{ color: '#92400e' }}>← Back to admin</a>
    </div> : null}
    <Header me={me} setMe={setMe} mode={mode} usage={usage} />
    <div className="pf-body">
      <nav className="pf-rail" aria-label="Profile sections">
        {RAIL.map(function (it) {
          var id = it[0];
          return <button key={id} className={'pf-nav' + (curRoute === id ? ' on' : '')} aria-current={curRoute === id ? 'page' : undefined} onClick={function () { go(id); }}>
            {IC[id]}<span>{it[1]}</span>{id === 'usage' && over80(usage) ? <i className="pf-dot" title="Near a limit" /> : null}{id === 'publications' && myPubs ? <i className="pf-count">{myPubs.pubCount}</i> : null}
          </button>;
        })}
        <div className="pf-soon">More areas coming soon</div>
      </nav>
      <main className="pf-main">
        {curRoute === 'publications' ? <Publications me={me} preview={preview} />
          : curRoute === 'chatprompt' ? <ChatPrompt me={me} />
            : curRoute === 'usage' ? <UsageCost me={me} usage={usage} />
              : curRoute === 'settings' ? <Settings me={me} />
                : curRoute === 'data' ? <DataSync me={me} mode={mode} onChanged={refresh} />
                  : <Overview me={me} usage={usage} go={go} preview={!!preview} />}
      </main>
    </div>
  </div>;
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
