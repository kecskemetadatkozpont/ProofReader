/* Aloud dashboard: accounts, projects, sharing, activity, usage. */
const { useState, useEffect, useRef, useCallback } = React;
const Store = window.PRStore;
const Auth = window.PRAuth;

function Avatar({ user, size = 30 }) {
  if (!user) return null;
  return <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.4, background: user.color }}>{Auth.initials(user.name)}</span>;
}
function relTime(ts) {
  if (!ts) return '';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60); if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60); if (h < 24) return h + 'h ago';
  const d = Math.floor(h / 24); if (d < 7) return d + 'd ago';
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function hashBars(seed) {
  let x = 0; for (let i = 0; i < seed.length; i++) x = (x * 31 + seed.charCodeAt(i)) >>> 0;
  const out = [], widths = [92, 88, 95, 70, 90, 84, 60, 96];
  for (let i = 0; i < 7; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; out.push(widths[x % widths.length]); }
  return out;
}
function fmtBytes(b) { if (b < 1024) return b + ' B'; if (b < 1048576) return (b / 1024).toFixed(0) + ' KB'; if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB'; return (b / 1073741824).toFixed(2) + ' GB'; }
const ROLES = ['editor', 'commenter', 'viewer'];

/* ---------------- sign-in ---------------- */
function SignIn({ onSignIn }) {
  const [pick, setPick] = useState(false);
  return (
    <div className="signin">
      <div className="signin-card">
        <div className="brand-mark"><span></span></div>
        <h1>Sign in to Aloud</h1>
        <p>Listen to your manuscripts, collaborate, and proofread by ear.</p>
        {!pick
          ? <button className="google-btn" onClick={() => setPick(true)}>
              <svg width="20" height="20" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.1 0 24 0 14.6 0 6.4 5.4 2.5 13.3l7.8 6.1C12.2 13.2 17.6 9.5 24 9.5z" /><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.2-.4-4.7H24v9h12.4c-.5 2.9-2.1 5.3-4.6 7l7.1 5.5c4.2-3.9 6.6-9.6 6.6-16.8z" /><path fill="#FBBC05" d="M10.3 28.6c-.5-1.4-.8-2.9-.8-4.6s.3-3.2.8-4.6l-7.8-6.1C.9 16.5 0 20.1 0 24s.9 7.5 2.5 10.7l7.8-6.1z" /><path fill="#34A853" d="M24 48c6.1 0 11.3-2 15-5.5l-7.1-5.5c-2 1.4-4.6 2.2-7.9 2.2-6.4 0-11.8-3.7-13.7-9.4l-7.8 6.1C6.4 42.6 14.6 48 24 48z" /></svg>
              Continue with Google
            </button>
          : <>
              <div className="field-label" style={{ textAlign: 'left' }}>Choose a demo account</div>
              <div className="demo-users">
                {Auth.users().map((u) => (
                  <button key={u.id} className="demo-user" onClick={() => onSignIn(u.id)}>
                    <Avatar user={u} size={34} />
                    <span><span className="du-name">{u.name}</span><br /><span className="du-mail">{u.email}</span></span>
                    <span className="du-plan">{u.plan === 'pro' ? 'PRO' : 'FREE'}</span>
                  </button>
                ))}
              </div>
            </>}
        <div className="demo-note">Prototype: pick any account. Open two windows as different people to collaborate live.</div>
      </div>
    </div>
  );
}

/* ---------------- modals ---------------- */
function NewModal({ onClose, onCreate }) {
  const [title, setTitle] = useState(''); const [tpl, setTpl] = useState('sample'); const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.focus(); }, []);
  const create = () => onCreate(title.trim() || 'Untitled project', tpl);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h3>New project</h3><p>Give it a name and pick a starting point.</p></div>
        <div className="modal-body">
          <div className="field-label">Project name</div>
          <input ref={ref} className="text-input" value={title} placeholder="e.g. NeurIPS submission" onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') create(); }} />
          <div className="tpl-row">
            <button className={'tpl' + (tpl === 'blank' ? ' on' : '')} onClick={() => setTpl('blank')}>
              <div className="tpl-ico"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M4 2h5l3 3v9H4z" /><path d="M9 2v3h3" /></svg></div>
              <b>Blank</b><small>A minimal article skeleton.</small>
            </button>
            <button className={'tpl' + (tpl === 'sample' ? ' on' : '')} onClick={() => setTpl('sample')}>
              <div className="tpl-ico"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M3 3h10v10H3z" /><path d="M5 6h6M5 8.5h6M5 11h4" strokeLinecap="round" /></svg></div>
              <b>Sample paper</b><small>Full demo with figures &amp; math.</small>
            </button>
          </div>
        </div>
        <div className="modal-foot"><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={create}>Create project</button></div>
      </div>
    </div>
  );
}

function ShareModal({ project, me, onClose, onChange }) {
  const [email, setEmail] = useState(''); const [role, setRole] = useState('editor');
  const owner = Auth.byId(project.ownerId);
  const invite = () => {
    const u = Auth.byEmail(email.trim());
    if (!u) { alert('No user with that email in this prototype. Try: ' + Auth.users().map((x) => x.email).join(', ')); return; }
    Store.addMember(project.id, u.id, role); setEmail(''); onChange();
  };
  const link = location.origin + location.pathname.replace(/Projects\.html$/, '') + 'ProofReader.html?p=' + project.id;
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h3>Share “{project.title}”</h3><p>Invite collaborators or share a link.</p></div>
        <div className="modal-body">
          <div className="field-label">Invite by email</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="text-input" list="userlist" value={email} placeholder="name@lab.edu" onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') invite(); }} style={{ flex: 1 }} />
            <datalist id="userlist">{Auth.users().map((u) => <option key={u.id} value={u.email}>{u.name}</option>)}</datalist>
            <select className="sel" value={role} onChange={(e) => setRole(e.target.value)}>{ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select>
            <button className="btn-primary" style={{ height: 42 }} onClick={invite}>Invite</button>
          </div>

          <div className="field-label" style={{ marginTop: 18 }}>People with access</div>
          <div className="member-row">
            <Avatar user={owner} size={32} />
            <span className="mname">{owner ? owner.name : project.ownerId}{owner && owner.id === me.id ? ' (you)' : ''}<small>{owner && owner.email}</small></span>
            <span className="role-pill">Owner</span>
          </div>
          {project.members.map((m) => {
            const u = Auth.byId(m.userId);
            return (
              <div key={m.userId} className="member-row">
                <Avatar user={u} size={32} />
                <span className="mname">{u ? u.name : m.userId}{u && u.id === me.id ? ' (you)' : ''}<small>{u && u.email}</small></span>
                {project.ownerId === me.id
                  ? <>
                      <select className="sel" value={m.role} onChange={(e) => { Store.setRole(project.id, m.userId, e.target.value); onChange(); }}>{ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select>
                      <button className="btn-text danger" style={{ color: '#dc2626' }} onClick={() => { Store.removeMember(project.id, m.userId); onChange(); }}>Remove</button>
                    </>
                  : <span className="role-pill">{m.role}</span>}
              </div>
            );
          })}

          <div className="field-label" style={{ marginTop: 18 }}>Public link</div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13 }}>
            <input type="checkbox" checked={project.link.enabled} onChange={(e) => { Store.setLink(project.id, e.target.checked, project.link.role); onChange(); }} disabled={project.ownerId !== me.id} />
            Anyone with the link can
            <select className="sel" value={project.link.role} disabled={!project.link.enabled || project.ownerId !== me.id} onChange={(e) => { Store.setLink(project.id, true, e.target.value); onChange(); }}>{ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select>
          </label>
          {project.link.enabled && <div className="link-box"><input readOnly value={link} /><button className="btn-ghost" onClick={() => { navigator.clipboard && navigator.clipboard.writeText(link); }}>Copy</button></div>}
        </div>
        <div className="modal-foot"><button className="btn-primary" onClick={onClose}>Done</button></div>
      </div>
    </div>
  );
}

function UsageModal({ me, onClose }) {
  const u = Store.usage(me.id);
  const stPct = Math.min(100, u.storageBytes / u.storageLimit * 100);
  const chPct = Math.min(100, u.chars / u.charLimit * 100);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h3>Usage &amp; storage</h3><p>{me.name} · {u.planLabel} plan · resets monthly</p></div>
        <div className="modal-body" style={{ paddingBottom: 18 }}>
          <div className="usage-line"><b>Storage</b><span className="usage-sub">{fmtBytes(u.storageBytes)} / {fmtBytes(u.storageLimit)}</span></div>
          <div className={'bar' + (stPct > 80 ? ' warn' : '')}><i style={{ width: stPct + '%' }} /></div>
          <div className="usage-sub">Files and saved versions across projects you own.</div>

          <div className="usage-line"><b>Voice (ElevenLabs) characters</b><span className="usage-sub">{u.chars.toLocaleString()} / {u.charLimit.toLocaleString()}</span></div>
          <div className={'bar' + (chPct > 80 ? ' warn' : '')}><i style={{ width: chPct + '%' }} /></div>
          <div className="usage-sub">{u.requests} synthesis request{u.requests === 1 ? '' : 's'} this month.</div>

          <div className="usage-sub" style={{ marginTop: 16, padding: '10px 12px', background: '#f4f5f8', borderRadius: 9 }}>
            In production these counters are enforced server-side. Premium narration is billed per character, so audio is cached and prefetched to keep usage low.
          </div>
        </div>
        <div className="modal-foot"><button className="btn-primary" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}

function ActivityModal({ projects, onClose }) {
  const events = [];
  projects.forEach((p) => (p.activity || []).forEach((a) => events.push(Object.assign({ project: p.title, pid: p.id }, a))));
  events.sort((a, b) => b.at - a.at);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h3>Recent activity</h3><p>Across all your projects</p></div>
        <div className="modal-body">
          {events.length === 0 && <p className="usage-sub">No activity yet.</p>}
          {events.slice(0, 60).map((a) => {
            const u = Auth.byId(a.actorId);
            return (
              <div key={a.id} className="act-row">
                <Avatar user={u} size={26} />
                <div style={{ flex: 1 }}><b>{u ? u.name.split(' ')[0] : a.actorId}</b> {a.verb} {a.target} <span className="usage-sub">· {a.project}</span></div>
                <span className="at">{relTime(a.at)}</span>
              </div>
            );
          })}
        </div>
        <div className="modal-foot"><button className="btn-primary" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}

function AccountMenu({ me, onClose, onUsage, onSwitch, onSignOut }) {
  const u = Store.usage(me.id);
  return (
    <div className="menu" onClick={(e) => e.stopPropagation()}>
      <div className="mhead"><Avatar user={me} size={38} /><div><b>{me.name}</b><small>{me.email}</small></div><span className="plan-pill">{u.planLabel}</span></div>
      <div className="divider" />
      <button className="mi" onClick={onUsage}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 13h12M4 13V7M8 13V3M12 13V9" strokeLinecap="round" /></svg>Usage &amp; storage</button>
      <div className="sub">Switch account</div>
      {Auth.users().filter((x) => x.id !== me.id).map((x) => (
        <button key={x.id} className="mi" onClick={() => onSwitch(x.id)}><Avatar user={x} size={22} />{x.name}</button>
      ))}
      <div className="divider" />
      <button className="mi danger" onClick={onSignOut}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M6 14H3V2h3M10 11l3-3-3-3M13 8H6" strokeLinecap="round" strokeLinejoin="round" /></svg>Sign out</button>
    </div>
  );
}

/* ---------------- card ---------------- */
function MiniPage({ project }) {
  const bars = hashBars(project.id);
  return (
    <div className="mini-page">
      <div className="mp-title">{Store.titleGuess(project)}</div>
      {bars.map((w, i) => <div key={i} className={'mp-bar' + (i === 0 ? ' h' : '') + (i === 3 ? ' read' : '')} style={{ width: w + '%' }} />)}
    </div>
  );
}
function Card({ project, me, onOpen, onMenu, menuOpen, onClose, onRename, onDuplicate, onDelete, onShare }) {
  const [renaming, setRenaming] = useState(false);
  const [val, setVal] = useState(project.title);
  const inputRef = useRef(null);
  useEffect(() => { if (renaming && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); } }, [renaming]);
  const sentences = Store.countSentences(project);
  const fileCount = project.order ? project.order.length : Object.keys(project.files || {}).length;
  const isOwner = project.ownerId === me.id;
  const members = [Auth.byId(project.ownerId)].concat(project.members.map((m) => Auth.byId(m.userId))).filter(Boolean);
  const commit = () => { onRename(val.trim() || project.title); setRenaming(false); };
  return (
    <div className="card" onClick={() => { if (!renaming) onOpen(); }}>
      <button className="kebab" onClick={(e) => { e.stopPropagation(); onMenu(); }}><svg viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="3" r="1.4" /><circle cx="8" cy="8" r="1.4" /><circle cx="8" cy="13" r="1.4" /></svg></button>
      {menuOpen && (
        <div className="menu" onClick={(e) => e.stopPropagation()}>
          <button className="mi" onClick={() => { onShare(); onClose(); }}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="4" cy="8" r="2" /><circle cx="12" cy="4" r="2" /><circle cx="12" cy="12" r="2" /><path d="M5.8 7l4.4-2.2M5.8 9l4.4 2.2" /></svg>Share</button>
          <button className="mi" onClick={() => { setRenaming(true); onClose(); }}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M11 2l3 3-8 8H3v-3z" /></svg>Rename</button>
          <button className="mi" onClick={() => { onDuplicate(); onClose(); }}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="5" y="5" width="9" height="9" rx="1.5" /><path d="M11 5V3.5A1.5 1.5 0 009.5 2H3.5A1.5 1.5 0 002 3.5v6A1.5 1.5 0 003.5 11H5" /></svg>Duplicate</button>
          {isOwner && <><div className="divider" /><button className="mi danger" onClick={() => { onDelete(); onClose(); }}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M3 4h10M6 4V2.5h4V4M5 4l.6 9h4.8L11 4" strokeLinecap="round" /></svg>Delete</button></>}
        </div>
      )}
      <div className="thumb">
        {project._shared && <span className="shared-badge"><Avatar user={Auth.byId(project.ownerId)} size={16} />Shared</span>}
        <MiniPage project={project} />
      </div>
      <div className="card-foot" onClick={(e) => { if (renaming) e.stopPropagation(); }}>
        {renaming
          ? <input ref={inputRef} className="rename-input" value={val} onChange={(e) => setVal(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setRenaming(false); }} />
          : <div className="card-title">{project.title}</div>}
        <div className="card-meta">
          <span>Edited {relTime(project.updated)}</span>
          <span className="sep" /><span>{fileCount} file{fileCount === 1 ? '' : 's'}</span>
          {sentences != null && <><span className="sep" /><span>{sentences} sentences</span></>}
        </div>
        {members.length > 1 && <div className="members-stack">{members.slice(0, 5).map((u, i) => <Avatar key={i} user={u} size={22} />)}</div>}
      </div>
    </div>
  );
}

/* ---------------- app ---------------- */
function App() {
  const [me, setMe] = useState(() => Auth.current());
  const [projects, setProjects] = useState([]);
  const [menuId, setMenuId] = useState(null);
  const [acctOpen, setAcctOpen] = useState(false);
  const [modal, setModal] = useState(null); // 'new' | 'usage' | 'activity'
  const [shareId, setShareId] = useState(null);
  const [tab, setTab] = useState('all');
  const [, force] = useState(0);

  const refresh = useCallback(() => { if (me) { Store.seedIfEmpty(); setProjects(Store.listFor(me.id)); } }, [me]);
  useEffect(() => { refresh(); }, [me]);
  useEffect(() => Store.subscribe(refresh), [refresh]);
  useEffect(() => { const c = () => { setMenuId(null); setAcctOpen(false); }; window.addEventListener('click', c); return () => window.removeEventListener('click', c); }, []);

  if (!me) return <SignIn onSignIn={(id) => { Auth.signIn(id); setMe(Auth.byId(id)); }} />;

  const open = (id) => { location.href = 'ProofReader.html?p=' + encodeURIComponent(id); };
  const create = (title, tpl) => { const p = Store.create(title, tpl); open(p.id); };
  const shown = projects.filter((p) => tab === 'all' ? true : tab === 'owned' ? !p._shared : p._shared);
  const usage = Store.usage(me.id);
  const stPct = Math.min(100, usage.storageBytes / usage.storageLimit * 100);
  const shareProject = shareId ? Store.get(shareId) : null;

  return (
    <div>
      <header className="topbar">
        <div className="brand"><div className="brand-mark"><span></span></div><div className="brand-text"><b>Aloud</b><i>LaTeX read-aloud editor</i></div></div>
        <div className="top-right">
          <button className="btn-ghost" onClick={() => setModal('activity')}><svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="8" cy="8" r="6" /><path d="M8 5v3l2 1.5" strokeLinecap="round" /></svg>Activity</button>
          <button className="usage-chip" onClick={() => setModal('usage')} title="Storage used"><span>Storage</span><span className="mini"><i style={{ width: stPct + '%' }} /></span></button>
          <button className="btn-primary" onClick={() => setModal('new')}><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M8 3v10M3 8h10" /></svg>New project</button>
          <div className="acct">
            <button className="acct-btn" onClick={(e) => { e.stopPropagation(); setAcctOpen((v) => !v); }}><Avatar user={me} size={34} /></button>
            {acctOpen && <AccountMenu me={me} onUsage={() => { setAcctOpen(false); setModal('usage'); }}
              onSwitch={(id) => { Auth.signIn(id); setMe(Auth.byId(id)); setAcctOpen(false); }}
              onSignOut={() => { Auth.signOut(); setMe(null); }} />}
          </div>
        </div>
      </header>

      <div className="wrap">
        <div className="page-head">
          <div><h1>Your projects</h1><p>Welcome back, {me.name.split(' ')[0]} · open one to edit and hear it read aloud</p></div>
        </div>
        <div className="tabs">
          {[['all', 'All'], ['owned', 'Owned by me'], ['shared', 'Shared with me']].map(([k, l]) => (
            <button key={k} className={'tab' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>

        {shown.length === 0 && tab !== 'all'
          ? <div className="empty"><h2>Nothing here yet</h2><p>{tab === 'shared' ? 'Projects others share with you will appear here.' : 'Create a project to get started.'}</p></div>
          : <div className="grid">
              {tab !== 'shared' && <button className="card new-card" onClick={() => setModal('new')}><div className="plus"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M8 3v10M3 8h10" /></svg></div><span>New project</span></button>}
              {shown.map((p) => (
                <Card key={p.id} project={p} me={me} onOpen={() => open(p.id)}
                  menuOpen={menuId === p.id} onMenu={() => setMenuId(menuId === p.id ? null : p.id)} onClose={() => setMenuId(null)}
                  onShare={() => setShareId(p.id)}
                  onRename={(t) => { Store.rename(p.id, t); refresh(); }}
                  onDuplicate={() => { Store.duplicate(p.id); refresh(); }}
                  onDelete={() => { Store.remove(p.id); refresh(); }} />
              ))}
            </div>}
      </div>

      {modal === 'new' && <NewModal onClose={() => setModal(null)} onCreate={create} />}
      {modal === 'usage' && <UsageModal me={me} onClose={() => setModal(null)} />}
      {modal === 'activity' && <ActivityModal projects={projects} onClose={() => setModal(null)} />}
      {shareProject && <ShareModal project={shareProject} me={me} onClose={() => setShareId(null)} onChange={() => { force((n) => n + 1); refresh(); }} />}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
