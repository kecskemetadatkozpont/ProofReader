/* Aloud dashboard: accounts, projects, sharing, activity, usage. */
const { useState, useEffect, useRef, useCallback } = React;
const Store = window.PRStore;
const Auth = window.PRAuth;

// manuscript lifecycle — a project's submission stage drives the card chip + progress
const STAGES = ['Drafting', 'Submitted', 'Under review', 'Revising', 'Accepted'];
const STAGE_COLOR = { 'Drafting': '#8a92a0', 'Submitted': '#0891b2', 'Under review': '#b45309', 'Revising': '#7c3aed', 'Accepted': '#16a34a', 'Rejected': '#dc2626' };
function stagePct(s) { var i = STAGES.indexOf(s); if (i >= 0) return Math.round(i / (STAGES.length - 1) * 100); return s === 'Rejected' ? 100 : 0; }

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
const isUrl = (s) => /^https?:\/\//i.test(String(s || '').trim());
function journalLabel(j) { if (!j) return ''; const m = /^https?:\/\/([^/]+)/i.exec(j); return m ? m[1].replace(/^www\./, '') : j; }
const jStyle = { display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 6, fontSize: 11.5, fontWeight: 600, color: 'var(--ink)', background: 'var(--surface-2)', borderRadius: 6, padding: '2px 7px', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: 'none' };
const isCloudMode = () => !!(window.PR_BACKEND && window.PR_BACKEND.mode === 'cloud');

/* ---------------- notifications ----------------
   In-app notifications (e.g. "X shared a document with you"). The unread count shows as a red badge on
   the profile avatar (top-right); the list + a per-item "View" link live in the account drawer. Cloud only. */
function useNotifications(uid) {
  const sb = window.PR_BACKEND && window.PR_BACKEND.sb;
  const [notes, setNotes] = useState([]);
  // Always scope to the displayed user. Admins can read ALL notifications via the nf_read RLS
  // (recipient_id = auth.uid() OR is_admin()), so without this filter an admin's bell would show
  // everyone's notifications — and in admin "view as" preview they'd be misattributed to the target.
  const load = useCallback(() => { if (!sb || !uid) { setNotes([]); return; } sb.from('notifications').select('id,kind,payload,read_at,created_at').eq('recipient_id', uid).order('created_at', { ascending: false }).limit(40).then((r) => setNotes((r && r.data) || [])); }, [uid]);
  useEffect(() => { load(); }, [load]);
  const markRead = (n) => { if (!n || n.read_at || !sb) return; sb.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', n.id).then(() => setNotes((l) => l.map((x) => x.id === n.id ? { ...x, read_at: 'now' } : x))); };
  const markAll = () => { const ids = notes.filter((n) => !n.read_at).map((n) => n.id); if (!ids.length || !sb) return; sb.from('notifications').update({ read_at: new Date().toISOString() }).in('id', ids).then(load); };
  const unread = notes.filter((n) => !n.read_at).length;
  return { notes, unread, markRead, markAll, reload: load };
}
function notifTitle(n) { const p = n.payload || {}; if (n.kind === 'share') return p.title || 'Shared document'; if (n.kind === 'digest') return 'Daily research summary'; return p.title || n.kind; }
function notifSumm(n) { const p = n.payload || {}; if (n.kind === 'share') return (p.by ? p.by + ' ' : '') + 'shared a document with you · ' + (p.role || 'editor'); if (n.kind === 'digest') return (p.day || '') + ' · ' + (p.students || 0) + ' students'; return p.body || ''; }
// Where a notification's "View" link goes (null → no link). Share → open the shared document;
// job (Elicit report/review done) → open the research project (from there: Studies → SR Studio).
function notifTarget(n) { const p = n.payload || {}; if (n.kind === 'share' && p.project_id) return 'ProofReader.html?p=' + p.project_id; if (n.kind === 'job' && p.project_id) return 'Research.html?project=' + p.project_id; return null; }

// Always-visible bell next to the profile avatar: red count when unread, dropdown lists notifications
// with "Elfogad" (accept invitation) + "Megnyit" (open) actions. Cloud only.
function NotifBell({ notif }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { if (!open) return; const h = (e) => { if (!e.target.closest('.notif-wrap')) setOpen(false); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, [open]);
  const accept = (n) => { const p = n.payload || {}; if (p.project_id && Store.acceptInvitation) Store.acceptInvitation(p.project_id); notif.markRead(n); };
  const view = (n) => { notif.markRead(n); const t = notifTarget(n); if (t) location.href = t; };
  return <div className="notif-wrap">
    <button className="bell" title="Notifications" aria-label={'Notifications' + (notif.unread ? ' (' + notif.unread + ' unread)' : '')} aria-pressed={open} onClick={(e) => { e.stopPropagation(); const o = !open; setOpen(o); if (o) notif.reload(); }}>
      <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 2a3.5 3.5 0 0 0-3.5 3.5c0 3-1.5 4-1.5 4h10s-1.5-1-1.5-4A3.5 3.5 0 0 0 8 2z" strokeLinejoin="round" /><path d="M6.6 12.4a1.5 1.5 0 0 0 2.8 0" strokeLinecap="round" /></svg>
      {notif.unread ? <i className="nb">{notif.unread > 9 ? '9+' : notif.unread}</i> : null}
    </button>
    {open ? <div className="notif-pop" onClick={(e) => e.stopPropagation()}>
      <div className="nh">Notifications{notif.unread ? <button className="back-btn" aria-label="Mark all notifications as read" onClick={notif.markAll}>Mark all read</button> : null}</div>
      {notif.notes.length ? notif.notes.slice(0, 20).map((n) => { const tgt = notifTarget(n); return (
        <div key={n.id} className={'notif-item' + (n.read_at ? '' : ' unread')}>
          <b>{notifTitle(n)}</b><div className="nx">{notifSumm(n)}</div>
          <div className="ni-actions">
            {n.kind === 'share' ? <button className="adr-accept" aria-label={'Accept invitation: ' + notifTitle(n)} onClick={() => accept(n)}>Accept</button> : null}
            {tgt ? <button className="adr-view" aria-label={'Open: ' + notifTitle(n)} onClick={() => view(n)}>Open <span aria-hidden="true">→</span></button> : null}
          </div>
        </div>
      ); }) : <div className="adr-notif-empty" style={{ textAlign: 'center' }}>No notifications.</div>}
    </div> : null}
  </div>;
}

/* ---------------- sign-in ---------------- */
function SignIn({ onSignIn }) {
  const [pick, setPick] = useState(false);
  return (
    <div className="signin">
      <div className="signin-card">
        <div className="brand-mark"><span></span></div>
        <h1>Sign in to Publify</h1>
        <p>Listen to your manuscripts, collaborate, and proofread by ear.</p>
        {!pick
          ? <button className="google-btn" onClick={() => setPick(true)}>
              <svg width="20" height="20" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.1 0 24 0 14.6 0 6.4 5.4 2.5 13.3l7.8 6.1C12.2 13.2 17.6 9.5 24 9.5z" /><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.2-.4-4.7H24v9h12.4c-.5 2.9-2.1 5.3-4.6 7l7.1 5.5c4.2-3.9 6.6-9.6 6.6-16.8z" /><path fill="#FBBC05" d="M10.3 28.6c-.5-1.4-.8-2.9-.8-4.6s.3-3.2.8-4.6l-7.8-6.1C.9 16.5 0 20.1 0 24s.9 7.5 2.5 10.7l7.8-6.1z" /><path fill="#34A853" d="M24 48c6.1 0 11.3-2 15-5.5l-7.1-5.5c-2 1.4-4.6 2.2-7.9 2.2-6.4 0-11.8-3.7-13.7-9.4l-7.8 6.1C6.4 42.6 14.6 48 24 48z" /></svg>
              Continue with Google
            </button>
          : <>
              <div className="field-label" style={{ textAlign: 'left' }}>Choose a demo account</div>
              <div className="demo-users">
                {(Auth.demoUsers ? Auth.demoUsers() : []).map((u) => (
                  <button key={u.id} className="demo-user" onClick={() => onSignIn(u.id)}>
                    <Avatar user={u} size={34} />
                    <span><span className="du-name">{u.name}</span><br /><span className="du-mail">{u.email}</span></span>
                    <span className="du-plan">{u.plan === 'pro' ? 'PRO' : 'FREE'}</span>
                  </button>
                ))}
              </div>
            </>}
        <div className="demo-note">Prototype: pick any account, or <a href="Profile.html">sign in to your researcher profile</a> with your email &amp; password.</div>
      </div>
    </div>
  );
}

/* ---------------- modals ---------------- */
function CollabRow({ user, role, onRole, onRemove }) {
  return (
    <div className="member-row">
      <Avatar user={user} size={28} />
      <span className="mname">{user.name}<small>{user.email}</small></span>
      <select className="sel" value={role} onChange={(e) => onRole(e.target.value)}>{ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select>
      <button className="btn-text" style={{ color: '#dc2626' }} onClick={onRemove}>Remove</button>
    </div>
  );
}

function NewModal({ me, onClose, onCreate }) {
  const [title, setTitle] = useState('');
  const [tpl, setTpl] = useState('sample');
  const [journal, setJournal] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('editor');
  const [collabs, setCollabs] = useState([]); // [{user, role}]
  const [err, setErr] = useState('');
  const ref = useRef(null);
  const journalTouched = useRef(false);
  useEffect(() => { if (ref.current) ref.current.focus(); }, []);
  const tplGroups = (window.PR_TEMPLATES && window.PR_TEMPLATES.groups) ? window.PR_TEMPLATES.groups() : null;
  const pickTpl = (t) => { setTpl(t.id); if (!journalTouched.current) setJournal(t.journalMeta ? t.name : ''); };
  const qOf = (m) => { const x = (m && m.quartile || '').match(/Q[1-4]/); return x ? x[0] : ''; };

  const addCollab = async () => {
    const e = email.trim(); if (!e) return;
    const dup = collabs.some((c) => (c.user.email || '').toLowerCase() === e.toLowerCase()) || (me && (me.email || '').toLowerCase() === e.toLowerCase());
    if (dup) { setErr('Already added.'); return; }
    let u = Auth.byEmail(e);
    if (!u && isCloudMode() && window.PR_BACKEND.findUserByEmail) { setErr('Searching…'); u = await window.PR_BACKEND.findUserByEmail(e); }
    if (!u) { setErr(isCloudMode() ? 'No registered user with that email.' : 'No user with that email. Try: ' + Auth.users().map((x) => x.email).join(', ')); return; }
    setCollabs((cs) => cs.concat([{ user: u, role }])); setEmail(''); setErr('');
  };
  const create = () => onCreate(title.trim() || 'Untitled project', tpl, { journal: journal.trim(), members: collabs.map((c) => ({ userId: c.user.id, role: c.role })) });

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" style={{ width: 640 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h3>New publication</h3><p>Name it, pick a target venue (format &amp; KPIs auto-tracked), and invite collaborators.</p></div>
        <div className="modal-body">
          <div className="field-label">Project name</div>
          <input ref={ref} className="text-input" value={title} placeholder="e.g. NeurIPS submission" onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') create(); }} />

          <div className="field-label" style={{ marginTop: 14 }}>Target journal <span className="usage-sub" style={{ fontWeight: 400 }}>· name or submission link, optional</span></div>
          <input className="text-input" value={journal} placeholder="e.g. Sensors (MDPI) — https://susy.mdpi.com/…" onChange={(e) => { setJournal(e.target.value); journalTouched.current = true; }} />

          <div className="field-label" style={{ marginTop: 14 }}>Invite collaborators <span className="usage-sub" style={{ fontWeight: 400 }}>· optional</span></div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="text-input" list="newuserlist" value={email} placeholder="name@lab.edu" onChange={(e) => { setEmail(e.target.value); setErr(''); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCollab(); } }} style={{ flex: 1 }} />
            <datalist id="newuserlist">{Auth.users().map((u) => <option key={u.id} value={u.email}>{u.name}</option>)}</datalist>
            <select className="sel" value={role} onChange={(e) => setRole(e.target.value)}>{ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select>
            <button className="btn-ghost" style={{ height: 42 }} onClick={addCollab}>Add</button>
          </div>
          {err && <div className="usage-sub" style={{ color: err === 'Searching…' ? '#64748b' : '#dc2626', marginTop: 6 }}>{err}</div>}
          {collabs.map((c, i) => <CollabRow key={c.user.id} user={c.user} role={c.role}
            onRole={(r) => setCollabs((cs) => cs.map((x, j) => j === i ? { user: x.user, role: r } : x))}
            onRemove={() => setCollabs((cs) => cs.filter((_, j) => j !== i))} />)}

          <div className="field-label" style={{ marginTop: 16 }}>Start from a template <span className="usage-sub" style={{ fontWeight: 400 }}>· WoS/Scopus venue formats, with KPIs auto-tracked in the editor</span></div>
          {tplGroups
            ? <div className="tpl-gallery">
                {tplGroups.map((g) => (
                  <div key={g.group} className="tpl-group">
                    <div className="tpl-group-h">{g.group}</div>
                    <div className="tpl-grid">
                      {g.items.map((t) => (
                        <button key={t.id} className={'tpl-card' + (tpl === t.id ? ' on' : '')} onClick={() => pickTpl(t)} title={t.description}>
                          <div className="tpl-card-top"><b>{t.name}</b>{t.indexing && /WoS/.test(t.indexing) ? <span className="idx-badge">WoS</span> : (t.indexing && /Scopus/.test(t.indexing) ? <span className="idx-badge scopus">Scopus</span> : null)}</div>
                          <small className="tpl-cls">{t.documentClass}</small>
                          {t.journalMeta && <div className="tpl-kpi">
                            {t.journalMeta.impactFactor && !/n\/a/.test(t.journalMeta.impactFactor) && <span>IF {t.journalMeta.impactFactor}</span>}
                            {t.journalMeta.citeScore && !/n\/a|level|high/i.test(t.journalMeta.citeScore) && <span>CS {t.journalMeta.citeScore}</span>}
                            {qOf(t.journalMeta) && <span className="q">{qOf(t.journalMeta)}</span>}
                          </div>}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            : <div className="tpl-row">
                <button className={'tpl' + (tpl === 'blank' ? ' on' : '')} onClick={() => setTpl('blank')}><b>Blank</b><small>A minimal article skeleton.</small></button>
                <button className={'tpl' + (tpl === 'sample' ? ' on' : '')} onClick={() => setTpl('sample')}><b>Sample paper</b><small>Full demo with figures &amp; math.</small></button>
              </div>}
        </div>
        <div className="modal-foot"><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={create}>Create publication</button></div>
      </div>
    </div>
  );
}

function ShareModal({ project, me, onClose, onChange }) {
  const [email, setEmail] = useState(''); const [role, setRole] = useState('editor'); const [err, setErr] = useState('');
  const [accept, setAccept] = useState({}); const [resent, setResent] = useState({}); const [copied, setCopied] = useState(false);
  const owner = Auth.byId(project.ownerId);
  const isOwnerView = project.ownerId === me.id;
  useEffect(() => { if (isOwnerView && isCloudMode() && Store.loadAcceptance) Store.loadAcceptance(project.id).then(setAccept); }, [project.id, project.members.length]);
  useEffect(() => { const onKey = (e) => { if (e.key === 'Escape') onClose(); }; document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey); }, [onClose]);
  const invite = async () => {
    const e = email.trim(); if (!e) return;
    let u = Auth.byEmail(e);
    if (!u && isCloudMode() && window.PR_BACKEND.findUserByEmail) { setErr('Searching…'); u = await window.PR_BACKEND.findUserByEmail(e); }
    if (!u) { setErr(isCloudMode() ? 'No registered user with that email.' : 'No user with that email. Try: ' + Auth.users().map((x) => x.email).join(', ')); return; }
    Store.addMember(project.id, u.id, role); setEmail(''); setErr(''); onChange();
  };
  const link = location.origin + location.pathname.replace(/Projects\.html$/, '') + 'ProofReader.html?p=' + project.id;
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={'Share ' + project.title} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h3>Share “{project.title}”</h3><p>Invite collaborators or share a link.</p></div>
        <div className="modal-body">
          <div className="field-label">Invite by email</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="text-input" list="userlist" value={email} placeholder="name@lab.edu" onChange={(e) => { setEmail(e.target.value); setErr(''); }} onKeyDown={(e) => { if (e.key === 'Enter') invite(); }} style={{ flex: 1 }} />
            <datalist id="userlist">{Auth.users().map((u) => <option key={u.id} value={u.email}>{u.name}</option>)}</datalist>
            <select className="sel" value={role} onChange={(e) => setRole(e.target.value)}>{ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select>
            <button className="btn-primary" style={{ height: 42 }} onClick={invite}>Invite</button>
          </div>
          {err && <div className="usage-sub" style={{ color: err === 'Searching…' ? '#64748b' : '#dc2626', marginTop: 6 }}>{err}</div>}

          <div className="field-label" style={{ marginTop: 18 }}>People with access</div>
          <div className="member-row">
            <Avatar user={owner} size={32} />
            <span className="mname">{owner ? owner.name : project.ownerId}{owner && owner.id === me.id ? ' (you)' : ''}<small>{owner && owner.email}</small></span>
            <span className="role-pill">Owner</span>
          </div>
          {project.members.map((m) => {
            const u = Auth.byId(m.userId);
            const acc = accept[m.userId];
            const pending = acc == null;
            return (
              <div key={m.userId} className="member-row">
                <Avatar user={u} size={32} />
                <span className="mname">{u ? u.name : m.userId}{u && u.id === me.id ? ' (you)' : ''}<small>{u && u.email}</small></span>
                {isOwnerView && isCloudMode()
                  ? <span className={'inv-pill ' + (pending ? 'pending' : 'ok')} aria-label={'Invitation ' + (pending ? 'pending' : 'accepted')} title={pending ? 'The invitee has not accepted the invitation yet' : ('Accepted: ' + new Date(acc).toLocaleString())}>{pending ? 'Pending' : 'Accepted'}</span>
                  : null}
                {project.ownerId === me.id
                  ? <>
                      {pending && isCloudMode() ? <button className="btn-text" title="Resend invitation notification" onClick={() => { Store.resendInvite(project.id, m.userId, m.role, project.title); setResent((s) => Object.assign({}, s, { [m.userId]: true })); }}>{resent[m.userId] ? 'Sent ✓' : 'Resend'}</button> : null}
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
          {project.link.enabled && <div className="link-box"><input readOnly value={link} /><button className="btn-ghost" onClick={() => { navigator.clipboard && navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1800); }}>{copied ? 'Copied ✓' : 'Copy'}</button></div>}
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

          <div className="usage-sub" style={{ marginTop: 16, padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 9 }}>
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
        <div className="modal-head"><h3>Recent activity</h3><p>Across all your publications</p></div>
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
  const others = (Auth.demoUsers ? Auth.demoUsers() : []).filter((x) => x.id !== me.id); // switch-account: demo only (cloud users can't switch + must not see the directory)
  return (
    <React.Fragment>
      <div className="acct-scrim" onClick={onClose} />
      <aside className="acct-drawer" onClick={(e) => e.stopPropagation()}>
        <a className="adr-head" href="Profile.html" title="Open your profile"><Avatar user={me} size={42} /><div style={{ minWidth: 0, flex: 1 }}><b>{me.name}</b><small>{me.email}</small></div><span className="plan-pill">{u.planLabel}</span></a>
        <div className="adr-nav">
          <a className="adr-i" href="Profile.html"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="8" cy="5.5" r="2.5" /><path d="M3.5 13.5c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4" strokeLinecap="round" /></svg>Open profile</a>
          <a className="adr-i" href="PhD.html"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M8 2L1.5 5 8 8l6.5-3L8 2z" strokeLinejoin="round" /><path d="M4.5 6.3v3.4c0 1 1.6 1.8 3.5 1.8s3.5-.8 3.5-1.8V6.3M14.5 5.2v3.3" strokeLinecap="round" /></svg>Doctoral School</a>
          <a className="adr-i" href={/[?&]adminView=1/.test(location.search) ? "Research.html?adminView=1" : "Research.html"}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M6.5 2v4L3 12.2A1.4 1.4 0 0 0 4.2 14h7.6A1.4 1.4 0 0 0 13 12.2L9.5 6V2" strokeLinejoin="round" /><path d="M5.5 2h5M5.6 9h4.8" strokeLinecap="round" /></svg>Research</a>
          <button className="adr-i" onClick={onUsage}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 13h12M4 13V7M8 13V3M12 13V9" strokeLinecap="round" /></svg>Usage &amp; storage</button>
        </div>
        {others.length ? <React.Fragment>
          <div className="adr-sub">Switch account</div>
          <div className="adr-nav">{others.map((x) => <button key={x.id} className="adr-i" onClick={() => onSwitch(x.id)}><Avatar user={x} size={22} />{x.name}</button>)}</div>
        </React.Fragment> : null}
        <div className="adr-foot"><button className="adr-i danger" onClick={onSignOut}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M6 14H3V2h3M10 11l3-3-3-3M13 8H6" strokeLinecap="round" strokeLinejoin="round" /></svg>Sign out</button></div>
      </aside>
    </React.Fragment>
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
function Card({ project, me, onOpen, onRename, onDuplicate, onDelete, onShare, onStatus }) {
  const status = project.status || 'Drafting';
  const stColor = STAGE_COLOR[status] || '#8a92a0';
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
    <div className="card proj-card" onClick={() => { if (!renaming) onOpen(); }}>
      <div className="pc-head" onClick={(e) => { if (renaming) e.stopPropagation(); }}>
        <span className="pc-ico" aria-hidden="true">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 2.2h4.6L12.4 6V13a.6.6 0 0 1-.6.6H4a.6.6 0 0 1-.6-.6V2.8A.6.6 0 0 1 4 2.2z" /><path d="M8.4 2.4v3.4h3.6" /><path d="M5.6 9h4.8M5.6 11h3.2" /></svg>
        </span>
        <div className="pc-chips">
          {project._shared && <span className="pc-chip shared"><Avatar user={Auth.byId(project.ownerId)} size={15} />Shared</span>}
          {isOwner
            ? <select className="pc-status" value={status} style={{ color: stColor, borderColor: stColor + '66' }} title="Submission status" aria-label="Submission status" onClick={(e) => e.stopPropagation()} onChange={(e) => onStatus(e.target.value)}>
                {STAGES.concat(['Rejected']).map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            : <span className="pc-chip">Editor</span>}
        </div>
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
        {project.journal && (isUrl(project.journal)
          ? <a href={project.journal} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={jStyle} title={project.journal}>↗ {journalLabel(project.journal)}</a>
          : <span style={jStyle} title={project.journal}>{journalLabel(project.journal)}</span>)}
        {members.length > 1 && <div className="members-stack">{members.slice(0, 5).map((u, i) => <Avatar key={i} user={u} size={22} />)}</div>}
        {!renaming && (
          <div className="card-actions" onClick={(e) => e.stopPropagation()}>
            <button className="ca ca-open" onClick={onOpen} title="Open in the editor">
              <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 2.2l2.8 2.8-7.4 7.4-3.2.4.4-3.2z" /><path d="M10.2 3l2.8 2.8" /></svg>Open
            </button>
            <button className="ca" onClick={onShare} title="Share with collaborators">
              <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="4" cy="8" r="2" /><circle cx="12" cy="4" r="2" /><circle cx="12" cy="12" r="2" /><path d="M5.8 7l4.4-2.2M5.8 9l4.4 2.2" /></svg>Share
            </button>
            <span className="ca-grow" />
            <button className="ca ca-ico" onClick={() => setRenaming(true)} title="Rename" aria-label="Rename project">
              <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 2.2l2.8 2.8-7.4 7.4-3.2.4.4-3.2z" /></svg>
            </button>
            <button className="ca ca-ico" onClick={onDuplicate} title="Duplicate" aria-label="Duplicate project">
              <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="5" y="5" width="9" height="9" rx="1.5" /><path d="M11 5V3.5A1.5 1.5 0 009.5 2H3.5A1.5 1.5 0 002 3.5v6A1.5 1.5 0 003.5 11H5" /></svg>
            </button>
            {isOwner && <button className="ca ca-ico ca-danger" onClick={onDelete} title="Move to trash" aria-label="Move project to trash">
              <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M3 4h10M6 4V2.5h4V4M5 4l.6 9h4.8L11 4" /></svg>
            </button>}
          </div>
        )}
      </div>
      <div className="pc-progress" title={status + ' · ' + stagePct(status) + '%'}><i style={{ width: stagePct(status) + '%', background: stColor }} /></div>
    </div>
  );
}

function TrashCard({ project, ttl, onRestore, onPurge }) {
  const left = Math.max(0, (ttl || 0) - (Date.now() - (project.deletedAt || 0)));
  const days = Math.max(0, Math.ceil(left / 86400000));
  return (
    <div className="card" style={{ cursor: 'default' }}>
      <div className="thumb" style={{ opacity: 0.55, filter: 'grayscale(0.5)' }}><MiniPage project={project} /></div>
      <div className="card-foot">
        <div className="card-title">{project.title}</div>
        <div className="card-meta">
          <span>Deleted {relTime(project.deletedAt)}</span>
          <span className="sep" /><span style={{ color: days <= 1 ? '#dc2626' : undefined }}>{days} day{days === 1 ? '' : 's'} left</span>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button className="btn-ghost" onClick={onRestore}><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8a5 5 0 105-5 5 5 0 00-4.5 2.8" /><path d="M3 3v2.5h2.5" /></svg>Restore</button>
          <button className="btn-text" style={{ color: '#dc2626' }} onClick={onPurge}>Delete forever</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- app ---------------- */
// Admin "view as": opened from Admin with ?adminView=1 + a stored target. Admins have read-all on the
// projects table (admin_all_projects RLS), so we fetch the target's publications directly, read-only.
function adminTargetUser() {
  try {
    if (!/[?&]adminView=1/.test(location.search)) return null;
    const BE = window.PR_BACKEND, u = BE && BE.user; if (!u) return null;
    if (!(u.role === 'admin' || (BE.profiles && BE.profiles[u.id] && BE.profiles[u.id].role === 'admin'))) return null; // admin-only
    const t = JSON.parse(localStorage.getItem('pr-admin-view') || 'null');
    return t && t.id ? { id: t.id, name: t.name, email: t.email, color: t.color, plan: t.plan || 'pro', _preview: true } : null;
  } catch (e) { return null; }
}

function App() {
  const [me, setMe] = useState(() => adminTargetUser() || Auth.current());
  const preview = !!(me && me._preview);
  const [projects, setProjects] = useState([]);
  const [acctOpen, setAcctOpen] = useState(false);
  const notif = useNotifications(me && me.id);
  const [modal, setModal] = useState(null); // 'new' | 'usage' | 'activity'
  const [shareId, setShareId] = useState(null);
  const [tab, setTab] = useState('all');
  const [isAdmin, setIsAdmin] = useState(() => !!(window.PR_BACKEND && window.PR_BACKEND.user && window.PR_BACKEND.user.role === 'admin'));
  const [, force] = useState(0);

  const refresh = useCallback(() => {
    if (!me) return;
    if (me._preview) {
      const sb = window.PR_BACKEND && window.PR_BACKEND.sb;
      if (!sb) { setProjects([]); return; }
      const mk = (row, shared) => Object.assign({}, row.data || {}, {
        id: row.id, title: (row.data && row.data.title) || 'Untitled publication', ownerId: row.owner_id || me.id,
        updated: row.updated_at ? Date.parse(row.updated_at) : 0, members: (row.data && row.data.members) || [], _shared: shared, _preview: true
      });
      // The target's own publications + the ones shared with them (so "Shared with me" matches their real view).
      Promise.all([
        sb.from('projects').select('id,data,updated_at,deleted_at,owner_id').eq('owner_id', me.id).is('deleted_at', null),
        sb.from('project_members').select('project_id').eq('user_id', me.id)
      ]).then(([owned, mem]) => {
        const memIds = ((mem && mem.data) || []).map((r) => r.project_id);
        const sharedQ = memIds.length
          ? sb.from('projects').select('id,data,updated_at,deleted_at,owner_id').in('id', memIds).is('deleted_at', null)
          : Promise.resolve({ data: [] });
        sharedQ.then((shared) => {
          const list = (((owned && owned.data) || []).map((r) => mk(r, false)))
            .concat(((shared && shared.data) || []).map((r) => mk(r, true)));
          setProjects(list);
        });
      });
      return;
    }
    Store.seedIfEmpty(); setProjects(Store.listFor(me.id));
  }, [me]);
  useEffect(() => { refresh(); }, [me]);
  useEffect(() => Store.subscribe(refresh), [refresh]);
  useEffect(() => { const c = () => setAcctOpen(false); window.addEventListener('click', c); return () => window.removeEventListener('click', c); }, []);
  useEffect(() => { const h = (e) => setIsAdmin(!!(e.detail && e.detail.role === 'admin')); window.addEventListener('pr-profile', h); return () => window.removeEventListener('pr-profile', h); }, []);
  // admin preview: wait for the admin's backend auth to attach, then load the target's publications
  useEffect(() => { if (!preview) return; let n = 0; const iv = setInterval(() => { n++; if ((window.PR_BACKEND && window.PR_BACKEND.user) || n > 15) { clearInterval(iv); refresh(); } }, 500); return () => clearInterval(iv); }, [preview, refresh]);

  if (!me) return <SignIn onSignIn={(id) => { Auth.signIn(id); setMe(Auth.byId(id)); }} />;

  const open = (id) => { location.href = 'ProofReader.html?p=' + encodeURIComponent(id); };
  const create = (title, tpl, opts) => { const p = Store.create(title, tpl, opts); open(p.id); };
  const trashed = Store.listTrashedFor ? Store.listTrashedFor(me.id) : [];
  const shown = tab === 'trash' ? [] : projects.filter((p) => tab === 'all' ? true : tab === 'owned' ? !p._shared : p._shared);
  const usage = Store.usage(me.id);
  const stPct = Math.min(100, usage.storageBytes / usage.storageLimit * 100);
  const shareProject = shareId ? Store.get(shareId) : null;

  return (
    <div>
      <header className="topbar">
        <div className="brand"><div className="brand-mark"><span></span></div><div className="brand-text"><b>Publify</b><i>researcher profiles &amp; publications</i><span id="pr-ver-slot" className="pr-ver-slot"></span></div></div>
        <div className="top-right">
          {isAdmin && <a className="btn-ghost" href="Admin.html" title="Admin console"><svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M8 1.8l5 1.9v3.6c0 3-2.1 5.2-5 6.1-2.9-.9-5-3.1-5-6.1V3.7z" /><path d="M5.8 8l1.6 1.6L10.4 6.5" /></svg>Admin</a>}
          {!preview && <button className="btn-ghost" onClick={() => setModal('activity')}><svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="8" cy="8" r="6" /><path d="M8 5v3l2 1.5" strokeLinecap="round" /></svg>Activity</button>}
          {!preview && <button className="btn-ghost" onClick={() => setModal('usage')} title="Storage used"><svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="8" cy="4" rx="5" ry="2" /><path d="M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4" /><path d="M3 8c0 1.1 2.2 2 5 2s5-.9 5-2" /></svg>Storage</button>}
          {!preview && <button className="btn-primary" onClick={() => setModal('new')}><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M8 3v10M3 8h10" /></svg>New publication</button>}
          {isCloudMode() && <NotifBell notif={notif} />}
          <div className="acct">
            <button className="acct-btn" title="Account" aria-label="Account menu" aria-expanded={acctOpen} onClick={(e) => { e.stopPropagation(); setAcctOpen((v) => !v); }}><Avatar user={me} size={34} /></button>
            {acctOpen && <AccountMenu me={me}
              onUsage={() => { setAcctOpen(false); setModal('usage'); }}
              onSwitch={(id) => { Auth.signIn(id); setMe(Auth.byId(id)); setAcctOpen(false); }}
              onSignOut={() => { Auth.signOut(); setMe(null); }}
              onClose={() => setAcctOpen(false)} />}
          </div>
        </div>
      </header>

      <div className="wrap">
        {preview && <div className="usage-sub" style={{ background: 'var(--warn-bg)', color: 'var(--warn)', padding: '10px 14px', borderRadius: 10, margin: '0 0 14px', fontWeight: 600, fontSize: 13 }}>👁 Admin view — {me.name}’s publications (read-only). <a href="Profile.html?adminView=1" style={{ color: 'var(--warn)' }}>Profile</a> · <a href="Research.html?adminView=1" style={{ color: 'var(--warn)' }}>Research</a> · <a href="Admin.html" style={{ color: 'var(--warn)' }}>← Back to admin</a></div>}
        <div className="page-head">
          <div><h1>{preview ? me.name + '’s publications' : 'Your publications'}</h1><p>{preview ? 'Read-only admin view of this researcher’s writing projects' : ('Welcome back, ' + me.name.split(' ')[0] + ' · open one to edit and hear it read aloud')}</p></div>
        </div>
        <div className="tabs">
          {[['all', 'All'], ['owned', 'Owned by me'], ['shared', 'Shared with me'], ['trash', 'Trash' + (trashed.length ? ' (' + trashed.length + ')' : '')]].map(([k, l]) => (
            <button key={k} className={'tab' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>

        {tab === 'trash'
          ? (trashed.length === 0
              ? <div className="empty"><h2>Trash is empty</h2><p>Deleted publications are kept here for 7 days, then permanently removed.</p></div>
              : <>
                  <p className="usage-sub" style={{ margin: '2px 2px 14px' }}>Deleted publications are kept for 7 days, then permanently removed. Restore one to bring it back to your publications.</p>
                  <div className="grid">
                    {trashed.map((p) => (
                      <TrashCard key={p.id} project={p} ttl={Store.trashTtl}
                        onRestore={() => { Store.restore(p.id); refresh(); }}
                        onPurge={() => { if (window.confirm('Permanently delete “' + p.title + '”? This cannot be undone.')) { Store.purge(p.id); refresh(); } }} />
                    ))}
                  </div>
                </>)
          : shown.length === 0 && tab !== 'all'
            ? <div className="empty"><h2>Nothing here yet</h2><p>{tab === 'shared' ? 'Publications others share with you will appear here.' : 'Create a publication to get started.'}</p></div>
            : <div className="grid">
                {tab !== 'shared' && !preview && <button className="card new-card" onClick={() => setModal('new')}><div className="plus"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M8 3v10M3 8h10" /></svg></div><span>New publication</span></button>}
                {shown.map((p) => (
                  <Card key={p.id} project={p} me={me} onOpen={() => open(p.id)}
                    onShare={() => setShareId(p.id)}
                    onRename={(t) => { Store.rename(p.id, t); refresh(); }}
                    onStatus={(s) => { const pr = Store.get(p.id); if (pr) { pr.status = s; Store.save(pr); refresh(); } }}
                    onDuplicate={() => { Store.duplicate(p.id); refresh(); }}
                    onDelete={() => { Store.remove(p.id); refresh(); }} />
                ))}
              </div>}
      </div>

      {modal === 'new' && <NewModal me={me} onClose={() => setModal(null)} onCreate={create} />}
      {modal === 'usage' && <UsageModal me={me} onClose={() => setModal(null)} />}
      {modal === 'activity' && <ActivityModal projects={projects} onClose={() => setModal(null)} />}
      {shareProject && <ShareModal project={shareProject} me={me} onClose={() => setShareId(null)} onChange={() => { force((n) => n + 1); refresh(); }} />}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
