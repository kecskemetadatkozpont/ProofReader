/* Aloud editor collaboration UI (presentational). Exposes window.Collab. */
(function () {
  const { useState, useEffect, useRef } = React;
  const Auth = window.PRAuth;
  const bn = (p) => { const i = (p || '').lastIndexOf('/'); return i < 0 ? p : p.slice(i + 1); };
  const rel = (ts) => { const s = Math.floor((Date.now() - ts) / 1000); if (s < 60) return 'now'; const m = Math.floor(s / 60); if (m < 60) return m + 'm'; const h = Math.floor(m / 60); if (h < 24) return h + 'h'; return Math.floor(h / 24) + 'd'; };

  function Avatar({ user, size = 26, ring }) {
    if (!user) return null;
    return <span className="cav" style={{ width: size, height: size, fontSize: size * 0.4, background: user.color, boxShadow: ring ? '0 0 0 2px ' + ring : 'none' }}>{Auth.initials(user.name)}</span>;
  }

  function PresenceBar({ peers }) {
    if (!peers || !peers.length) return null;
    return <div className="presence" title={peers.map((p) => (Auth.byId(p.userId) || {}).name).join(', ') + ' here now'}>
      {peers.slice(0, 4).map((p) => <Avatar key={p.userId} user={Auth.byId(p.userId)} size={26} ring="var(--pane)" />)}
      <span className="presence-dot" /></div>;
  }

  function ResumePill({ n, onResume, onDismiss, label }) {
    return <div className="resume-pill">
      <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M5 3l8 5-8 5z" /></svg>
      {label || ('Resume reading from sentence ' + n)}
      <button onClick={onResume}>Resume</button>
      <button className="x" onClick={onDismiss}>✕</button>
    </div>;
  }

  function SelectionToolbar({ quote, onComment, onTodo, onClose, pos }) {
    const style = pos ? { position: 'fixed', top: pos.top, left: pos.left, transform: 'translateX(-50%)' } : undefined;
    return <div className={'seltool' + (pos ? ' seltool-fixed' : '')} style={style}>
      <span className="seltool-q">“{quote.slice(0, 46)}{quote.length > 46 ? '…' : ''}”</span>
      <button onClick={onComment}><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 3.5h12v8H8l-3 2.5V11.5H2z" strokeLinejoin="round" /></svg>Comment</button>
      <button onClick={onTodo}><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2.5" y="2.5" width="11" height="11" rx="2" /><path d="M5.5 8l2 2 3.5-4" strokeLinecap="round" strokeLinejoin="round" /></svg>To-do</button>
      <button className="x" onClick={onClose}>✕</button>
    </div>;
  }

  /* Hover card for an annotated sentence — shows each comment/to-do, its text and author,
   * floating just outside the sentence's top-right corner. */
  function AnnoPopover({ pop, onEnter, onLeave }) {
    if (!pop || !pop.items || !pop.items.length) return null;
    const W = 300;
    let left = pop.right + 10;
    if (left + W > window.innerWidth - 10) left = Math.max(10, pop.left - W - 10); // flip to the left if off-screen
    let top = Math.max(8, pop.top - 6);
    if (top + 70 > window.innerHeight) top = Math.max(8, window.innerHeight - 80);
    return <div className="anno-pop2" style={{ top: top, left: left, width: W }} onMouseEnter={onEnter} onMouseLeave={onLeave}>
      {pop.items.map((it, i) => <div key={i} className="anno-pop2-item">
        <div className="anno-pop2-head">
          <span className="anno-pop2-av" style={{ background: it.color }}>{it.initials}</span>
          <span className="anno-pop2-author">{it.author}</span>
          <span className={'anno-pop2-kind ' + (it.kind === 'todo' ? 'todo' : 'comment')}>
            {it.kind === 'todo'
              ? <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 8.5l3 3 6.5-7.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              : <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M2.5 3.5h11v7H8l-3 2.5V10.5h-2.5z" strokeLinejoin="round" /></svg>}
            {it.kind === 'todo' ? 'To-do' : 'Comment'}
          </span>
          {it.when ? <span className="anno-pop2-when">{it.when}</span> : null}
        </div>
        {it.due ? <div className="anno-pop2-due">⏷ {it.due}</div> : null}
        <div className="anno-pop2-body">{it.body ? it.body : <i className="anno-pop2-empty">(nincs szöveg)</i>}</div>
      </div>)}
    </div>;
  }

  /* ---- attachments + mentions helpers ---- */
  function readAttachments(fileList, cb) {
    const files = Array.from(fileList || []);
    let n = files.length; const out = []; if (!n) { cb([]); return; }
    files.forEach((file) => {
      if (file.size > 50 * 1024 * 1024) { alert('“' + file.name + '” is larger than 50 MB and was skipped.'); if (--n === 0) cb(out); return; }
      const isImg = /^image\//.test(file.type);
      const r = new FileReader();
      r.onload = () => { out.push({ id: Math.random().toString(36).slice(2), name: file.name, type: isImg ? 'image' : 'file', mime: file.type, size: file.size, dataURL: String(r.result) }); if (--n === 0) cb(out); };
      r.onerror = () => { if (--n === 0) cb(out); };
      r.readAsDataURL(file);
    });
  }
  const extOf = (n) => { const i = (n || '').lastIndexOf('.'); return i > 0 ? n.slice(i + 1).toUpperCase() : 'FILE'; };
  const fmtSize = (b) => b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(0) + ' KB' : (b / 1048576).toFixed(1) + ' MB';

  function highlightBody(body, mentions) {
    if (!body) return null;
    const names = (mentions || []).map((id) => (Auth.byId(id) || {}).name).filter(Boolean).map((n) => n.split(' ')[0]);
    const uniq = Array.from(new Set(names));
    if (!uniq.length) return body;
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('@(' + uniq.map(esc).join('|') + ')\\b', 'g');
    const parts = []; let last = 0, m;
    while ((m = re.exec(body))) { if (m.index > last) parts.push(body.slice(last, m.index)); parts.push(<span className="mention" key={m.index}>@{m[1]}</span>); last = m.index + m[0].length; }
    if (last < body.length) parts.push(body.slice(last));
    return parts;
  }

  function openLightbox(att) { window.dispatchEvent(new CustomEvent('pr-lightbox', { detail: att })); }
  function Lightbox() {
    const [att, setAtt] = useState(null);
    useEffect(() => { const h = (e) => setAtt(e.detail); window.addEventListener('pr-lightbox', h); return () => window.removeEventListener('pr-lightbox', h); }, []);
    if (!att) return null;
    return <div className="lightbox" onClick={() => setAtt(null)}>
      <img src={att.dataURL} alt={att.name} onClick={(e) => e.stopPropagation()} />
      <div className="lb-bar"><span>{att.name}</span><a href={att.dataURL} download={att.name} onClick={(e) => e.stopPropagation()}>Download</a><button onClick={() => setAtt(null)}>✕</button></div>
    </div>;
  }

  function AttachmentList({ attachments, onRemove, compact }) {
    if (!attachments || !attachments.length) return null;
    return <div className={'attach-grid' + (compact ? ' compact' : '')}>
      {attachments.map((a, i) => (
        <div className={'attach' + (a.type === 'image' ? ' img' : '')} key={a.id || i}>
          {a.type === 'image'
            ? <button className="attach-thumb" onClick={() => openLightbox(a)} title={'Open ' + a.name} style={{ backgroundImage: 'url(' + a.dataURL + ')' }} />
            : <a className="attach-file" href={a.dataURL} download={a.name} title={'Download ' + a.name}><span className="ext">{extOf(a.name)}</span></a>}
          <div className="attach-meta"><span className="attach-name" title={a.name}>{a.name}</span>{a.size ? <span className="attach-size">{fmtSize(a.size)}</span> : null}</div>
          {onRemove && <button className="attach-x" onClick={() => onRemove(i)} title="Remove">✕</button>}
        </div>
      ))}
    </div>;
  }

  function MentionTextarea({ value, onChange, members, mentions, setMentions, placeholder, onSubmit, autoFocus, rows }) {
    const ref = useRef(null);
    const [menu, setMenu] = useState(null);
    useEffect(() => { if (autoFocus && ref.current) ref.current.focus(); }, []);
    const detect = (el) => {
      const pos = el.selectionStart, upto = (el.value || '').slice(0, pos);
      const m = /@([\w]*)$/.exec(upto);
      if (m) { const q = m[1].toLowerCase(); const items = members.filter((u) => u.name.toLowerCase().indexOf(q) >= 0 || u.email.toLowerCase().indexOf(q) >= 0); setMenu({ start: pos - m[0].length, items: items, sel: 0 }); }
      else setMenu(null);
    };
    const pick = (u) => {
      if (!menu || !ref.current) return;
      const live = ref.current.value, caret = ref.current.selectionStart;
      const before = live.slice(0, menu.start), after = live.slice(caret);
      const insert = '@' + u.name.split(' ')[0] + ' ';
      onChange(before + insert + after);
      if (!mentions.includes(u.id)) setMentions(mentions.concat(u.id));
      setMenu(null);
      requestAnimationFrame(() => { if (ref.current) { const p = (before + insert).length; ref.current.focus(); ref.current.setSelectionRange(p, p); } });
    };
    const key = (e) => {
      if (menu && menu.items.length) {
        if (e.key === 'ArrowDown') { e.preventDefault(); setMenu(Object.assign({}, menu, { sel: (menu.sel + 1) % menu.items.length })); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); setMenu(Object.assign({}, menu, { sel: (menu.sel - 1 + menu.items.length) % menu.items.length })); return; }
        if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(menu.items[menu.sel]); return; }
        if (e.key === 'Escape') { setMenu(null); return; }
      }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onSubmit && onSubmit(); }
    };
    return <div className="mention-wrap">
      <textarea ref={ref} rows={rows || 3} placeholder={placeholder} value={value}
        onChange={(e) => { onChange(e.target.value); detect(e.target); }}
        onKeyDown={key} onClick={(e) => detect(e.target)}
        onKeyUp={(e) => { if (['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].indexOf(e.key) < 0) detect(e.target); }} />
      {menu && menu.items.length > 0 && <div className="mention-menu">
        {menu.items.map((u, i) => <button key={u.id} type="button" className={'mention-opt' + (i === menu.sel ? ' on' : '')} onMouseDown={(e) => { e.preventDefault(); pick(u); }}>
          <Avatar user={u} size={22} /><span className="mo-t"><b>{u.name}</b><small>{u.email}</small></span></button>)}
      </div>}
    </div>;
  }

  function MentionChips({ mentions }) {
    if (!mentions || !mentions.length) return null;
    return <div className="mention-chips">{mentions.map((id) => { const u = Auth.byId(id); if (!u) return null; return <span className="m-chip" key={id}><Avatar user={u} size={15} />{u.name.split(' ')[0]}</span>; })}<span className="m-note">notified</span></div>;
  }

  function Compose({ kind, members, onSave, onCancel, initial, submitLabel }) {
    const [body, setBody] = useState(initial ? (initial.body || '') : '');
    const [mentions, setMentions] = useState(initial ? (initial.mentions || []) : []);
    const [attachments, setAttachments] = useState(initial ? (initial.attachments || []) : []);
    const [assignee, setAssignee] = useState(initial ? (initial.assignee || '') : '');
    const [due, setDue] = useState(initial ? (initial.due || '') : '');
    const fileRef = useRef(null);
    const submit = () => { if (!body.trim() && !attachments.length) return; onSave({ body: body, assignee: assignee, due: due, mentions: mentions, attachments: attachments }); };
    return <div className="compose">
      <MentionTextarea value={body} onChange={setBody} members={members} mentions={mentions} setMentions={setMentions} autoFocus onSubmit={submit}
        placeholder={kind === 'todo' ? 'What needs doing?  Type @ to mention…' : 'Add a comment…  Type @ to mention…'} />
      <AttachmentList attachments={attachments} onRemove={(i) => setAttachments(attachments.filter((_, j) => j !== i))} />
      {kind === 'todo' && <div className="compose-meta">
        <select value={assignee} onChange={(e) => setAssignee(e.target.value)}><option value="">Assignee…</option>{members.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
        <input placeholder="Due (e.g. Fri)" value={due} onChange={(e) => setDue(e.target.value)} />
      </div>}
      <div className="compose-actions">
        <input ref={fileRef} type="file" multiple style={{ display: 'none' }} onChange={(e) => { readAttachments(e.target.files, (a) => setAttachments((prev) => prev.concat(a))); e.target.value = ''; }} />
        <button className="attach-btn" type="button" onClick={() => fileRef.current.click()} title="Attach image or file">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9.5 5L5.6 8.9a1.8 1.8 0 002.5 2.5l4.4-4.4a3 3 0 00-4.2-4.2L3.6 7.5a4.2 4.2 0 005.9 5.9L13 10" strokeLinecap="round" strokeLinejoin="round" /></svg>Attach
        </button>
        <span style={{ flex: 1 }} />
        <button className="link" onClick={onCancel}>Cancel</button>
        <button className="solid" onClick={submit}>{submitLabel || (kind === 'todo' ? 'Add to-do' : 'Comment')}</button>
      </div>
    </div>;
  }

  function Thread({ ann, me, members, canEdit, onReply, onResolve, onDelete, onJump, onEdit }) {
    const [replyOpen, setReplyOpen] = useState(false);
    const [editing, setEditing] = useState(false);
    const [reply, setReply] = useState('');
    const [rMentions, setRMentions] = useState([]);
    const [rAtts, setRAtts] = useState([]);
    const rFile = useRef(null);
    const author = Auth.byId(ann.authorId);
    const mayEdit = canEdit || (me && ann.authorId === me.id);
    const sendReply = () => { if (!reply.trim() && !rAtts.length) return; onReply(ann, { body: reply, mentions: rMentions, attachments: rAtts }); setReply(''); setRMentions([]); setRAtts([]); setReplyOpen(false); };
    return <div className={'thread' + (ann.status === 'resolved' || ann.status === 'done' ? ' done' : '')}>
      <div className="thread-anchor" onClick={() => onJump(ann)}>{ann._orphan ? <span className="orphan">⚠ passage changed</span> : '“' + (ann.anchor.quote || '').slice(0, 60) + '”'}<span className="thread-file">{bn(ann.anchor.file)}</span></div>
      {editing
        ? <Compose kind="comment" members={members} submitLabel="Save" initial={{ body: ann.body, mentions: ann.mentions, attachments: ann.attachments }} onSave={(d) => { onEdit(ann, d); setEditing(false); }} onCancel={() => setEditing(false)} />
        : <div className="msg"><Avatar user={author} size={24} /><div className="msg-b"><b>{author ? author.name.split(' ')[0] : '?'}</b> <span className="t">{rel(ann.createdAt)}</span>{ann.editedAt ? <span className="t"> · edited</span> : null}<div className="body">{highlightBody(ann.body, ann.mentions)}</div><AttachmentList attachments={ann.attachments} /><MentionChips mentions={ann.mentions} /></div></div>}
      {ann.replies.map((r) => { const u = Auth.byId(r.authorId); return <div className="msg reply" key={r.id}><Avatar user={u} size={22} /><div className="msg-b"><b>{u ? u.name.split(' ')[0] : '?'}</b> <span className="t">{rel(r.at)}</span><div className="body">{highlightBody(r.body, r.mentions)}</div><AttachmentList attachments={r.attachments} compact /><MentionChips mentions={r.mentions} /></div></div>; })}
      {replyOpen
        ? <div className="reply-box">
            <MentionTextarea value={reply} onChange={setReply} members={members} mentions={rMentions} setMentions={setRMentions} autoFocus rows={2} placeholder="Reply…  Type @ to mention…" onSubmit={sendReply} />
            <AttachmentList attachments={rAtts} onRemove={(i) => setRAtts(rAtts.filter((_, j) => j !== i))} compact />
            <div className="compose-actions">
              <input ref={rFile} type="file" multiple style={{ display: 'none' }} onChange={(e) => { readAttachments(e.target.files, (a) => setRAtts((p) => p.concat(a))); e.target.value = ''; }} />
              <button className="attach-btn" type="button" onClick={() => rFile.current.click()}><svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9.5 5L5.6 8.9a1.8 1.8 0 002.5 2.5l4.4-4.4a3 3 0 00-4.2-4.2L3.6 7.5a4.2 4.2 0 005.9 5.9L13 10" strokeLinecap="round" strokeLinejoin="round" /></svg>Attach</button>
              <span style={{ flex: 1 }} /><button className="link" onClick={() => { setReplyOpen(false); setReply(''); setRAtts([]); setRMentions([]); }}>Cancel</button><button className="solid" onClick={sendReply}>Reply</button>
            </div>
          </div>
        : !editing && <div className="thread-foot">
            <button className="reply-trigger" onClick={() => setReplyOpen(true)}>Reply…</button>
            {mayEdit && <button onClick={() => setEditing(true)} title="Edit"><svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M10.5 2.5l3 3-7.5 7.5H3v-3z" strokeLinejoin="round" /></svg></button>}
            <button onClick={() => onResolve(ann)} title={ann.status === 'open' ? 'Resolve' : 'Reopen'}>{ann.status === 'open' ? '✓' : '↺'}</button>
            {mayEdit && <button onClick={() => onDelete(ann)} title="Delete">✕</button>}
          </div>}
    </div>;
  }

  function TodoItem({ ann, me, canEdit, onToggle, onJump, onDelete, onEdit, members }) {
    const [editing, setEditing] = useState(false);
    const assignee = ann.assignee ? Auth.byId(ann.assignee) : null;
    const mayEdit = canEdit || (me && ann.authorId === me.id);
    if (editing) return <div className="todo-item editing"><div className="tbody"><Compose kind="todo" members={members} submitLabel="Save" initial={{ body: ann.body, mentions: ann.mentions, attachments: ann.attachments, assignee: ann.assignee, due: ann.due }} onSave={(d) => { onEdit(ann, d); setEditing(false); }} onCancel={() => setEditing(false)} /></div></div>;
    return <div className={'todo-item' + (ann.status === 'done' ? ' done' : '')}>
      <button className="tcheck" onClick={() => onToggle(ann)}>{ann.status === 'done' ? '✓' : ''}</button>
      <div className="tbody">
        <div className="ttext">{highlightBody(ann.body, ann.mentions)}</div>
        <div className="tmeta" onClick={() => onJump(ann)}>“{(ann.anchor.quote || '').slice(0, 40)}”</div>
        <AttachmentList attachments={ann.attachments} compact />
        <div className="tchips">{assignee && <span className="tchip"><Avatar user={assignee} size={16} />{assignee.name.split(' ')[0]}</span>}{(ann.mentions || []).map((id) => { const u = Auth.byId(id); return u ? <span className="tchip mention-chip" key={id}>@{u.name.split(' ')[0]}</span> : null; })}{ann.due && <span className="tchip due">due {ann.due}</span>}<span className="tchip file">{bn(ann.anchor.file)}</span></div>
      </div>
      {mayEdit && <button className="tdel" onClick={() => setEditing(true)} title="Edit"><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M10.5 2.5l3 3-7.5 7.5H3v-3z" strokeLinejoin="round" /></svg></button>}
      {mayEdit && <button className="tdel" onClick={() => onDelete(ann)} title="Delete">✕</button>}
    </div>;
  }

  /* Floating thread popover opened from a margin bubble — the full conversation (replies, reply box,
     resolve/reopen, delete) and to-dos for ONE sentence, anchored next to it. Reuses Thread/TodoItem so the
     side drawer is no longer needed to read or answer a comment. */
  function BubbleThreads(p) {
    const ref = useRef(null);
    useEffect(() => {
      const onKey = (e) => { if (e.key === 'Escape') p.onClose(); };
      const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) p.onClose(); };
      window.addEventListener('keydown', onKey);
      const t = setTimeout(() => window.addEventListener('mousedown', onDown), 0);
      return () => { clearTimeout(t); window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onDown); };
    }, []);
    const r = p.rect || { left: 320, right: 320, top: 120, bottom: 120 };
    const W = 326;
    let left = r.left - W - 12;                                            // prefer LEFT of the bubble (gutter is on the right)
    if (left < 12) left = Math.min(window.innerWidth - W - 12, (r.right || r.left) + 12);
    const top = Math.max(12, Math.min(r.top, window.innerHeight - 380));
    const anns = p.anns || [];
    const comments = anns.filter((a) => a.kind !== 'todo');
    const todos = anns.filter((a) => a.kind === 'todo');
    return <div className="bubble-pop" ref={ref} style={{ left: left, top: top, width: W }}>
      <div className="bubble-pop-head"><span>{[comments.length ? 'Megjegyzés' : '', todos.length ? 'Teendő' : ''].filter(Boolean).join(' · ')}</span><button className="bubble-pop-x" onClick={p.onClose} title="Bezárás">✕</button></div>
      <div className="bubble-pop-body">
        {comments.map((a) => <Thread key={a.id} ann={a} me={p.me} members={p.members} canEdit={p.canEdit} onReply={p.onReply} onResolve={p.onResolve} onDelete={p.onDelete} onJump={p.onJump} onEdit={p.onEdit} />)}
        {todos.map((a) => <TodoItem key={a.id} ann={a} me={p.me} members={p.members} canEdit={p.canEdit} onToggle={p.onToggleTodo} onJump={p.onJump} onDelete={p.onDelete} onEdit={p.onEdit} />)}
        {!anns.length && <div className="bubble-empty">Ehhez a mondathoz nincs nyitott megjegyzés.</div>}
      </div>
    </div>;
  }

  function buildMarkdown(todos, projectTitle) {
    let md = '# To-dos — ' + projectTitle + '\n\n_Exported ' + new Date().toLocaleString() + '_\n\n';
    const byFile = {};
    todos.forEach((t) => { const f = bn(t.anchor.file); (byFile[f] = byFile[f] || []).push(t); });
    Object.keys(byFile).forEach((f) => {
      md += '## ' + f + '\n\n';
      byFile[f].forEach((t) => {
        const a = t.assignee ? (Auth.byId(t.assignee) || {}).name : null;
        md += '- [' + (t.status === 'done' ? 'x' : ' ') + '] ' + t.body;
        const tags = []; if (a) tags.push('@' + a.split(' ')[0]); if (t.due) tags.push('due ' + t.due);
        (t.mentions || []).forEach((id) => { const u = Auth.byId(id); if (u) tags.push('@' + u.name.split(' ')[0]); });
        if (tags.length) md += ' — ' + tags.join(', ');
        md += '\n';
        if (t.anchor.quote) md += '  > "' + t.anchor.quote.slice(0, 80) + '"\n';
        (t.attachments || []).forEach((at) => { md += '  - 📎 ' + at.name + (at.type === 'image' ? ' (image)' : '') + '\n'; });
      });
      md += '\n';
    });
    return md;
  }

  function RightDrawer(p) {
    const tabs = [['comments', 'Comments'], ['todos', 'To-dos'], ['review', 'Review'], ['numbers', 'Numbers'], ['refs', 'References'], ['spelling', 'Spelling'], ['history', 'History'], ['activity', 'Activity'], ['kpi', 'KPIs']];
    const reviewOpen = (p.review || []).filter((a) => a.status !== 'resolved').length;
    const numConflicts = (p.consistency || []).filter((g) => g.distinct > 1).length;
    const spellOpen = p.spellOn && p.spell ? p.spell.misspelled.length : 0;
    const refIssues = (window.PRRefs && p.refs) ? window.PRRefs.issueCount(p.refs) : 0;
    const comments = p.annotations.filter((a) => a.kind === 'comment');
    const todos = p.annotations.filter((a) => a.kind === 'todo');
    const openCount = p.annotations.filter((a) => a.status === 'open' && a.kind === 'comment').length;
    const todoOpen = todos.filter((a) => a.status !== 'done').length;
    const [vlabel, setVlabel] = useState('');
    function exportMd() {
      const md = buildMarkdown(todos, p.project.title);
      const blob = new Blob([md], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob); const a = document.createElement('a');
      a.href = url; a.download = (p.project.title || 'todos').replace(/[^\w]+/g, '-').toLowerCase() + '-todos.md'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }
    return <aside className="drawer">
      <div className="drawer-tabs">
        {tabs.map(([k, l]) => <button key={k} className={'dtab' + (p.tab === k ? ' on' : '')} onClick={() => p.setTab(k)}>{l}{k === 'comments' && openCount ? <span className="badge">{openCount}</span> : null}{k === 'todos' && todoOpen ? <span className="badge">{todoOpen}</span> : null}{k === 'review' && reviewOpen ? <span className="badge">{reviewOpen}</span> : null}{k === 'numbers' && numConflicts ? <span className="badge warn">{numConflicts}</span> : null}{k === 'refs' && refIssues ? <span className="badge warn">{refIssues}</span> : null}{k === 'spelling' && spellOpen ? <span className="badge warn">{spellOpen}</span> : null}</button>)}
        <button className="drawer-x" onClick={p.onClose} title="Close">✕</button>
      </div>
      {(p.tab === 'comments' || p.tab === 'todos') && p.docName && <div className="drawer-doc"><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M4 2.5h5l3 3V13a.5.5 0 01-.5.5h-7A.5.5 0 014 13z" strokeLinejoin="round" /></svg>Active document <b>{p.docName}</b><span className="dd-hint">· each note is tagged with its file</span></div>}
      <div className="drawer-body">
        {p.tab === 'comments' && <>
          {p.draft && p.draft.kind === 'comment' && <Compose kind="comment" members={p.members} onSave={(d) => p.onSaveDraft(d)} onCancel={p.onCancelDraft} />}
          {comments.length === 0 && !p.draft && <div className="empty-d">Select text in the editor and click <b>Comment</b> to start a thread.</div>}
          {comments.map((a) => <Thread key={a.id} ann={a} me={p.me} members={p.members} canEdit={p.canEdit} onReply={p.onReply} onResolve={p.onResolve} onDelete={p.onDelete} onJump={p.onJump} onEdit={p.onEdit} />)}
        </>}
        {p.tab === 'todos' && <>
          <div className="drawer-head"><span>{todoOpen} open · {todos.length} total</span><button className="link" onClick={exportMd} disabled={!todos.length}>↓ Markdown</button></div>
          {p.draft && p.draft.kind === 'todo' && <Compose kind="todo" members={p.members} onSave={(d) => p.onSaveDraft(d)} onCancel={p.onCancelDraft} />}
          {todos.length === 0 && !p.draft && <div className="empty-d">Select text and click <b>To-do</b> to add a task. All tasks roll up here and export as Markdown.</div>}
          {todos.map((a) => <TodoItem key={a.id} ann={a} me={p.me} members={p.members} canEdit={p.canEdit} onToggle={p.onToggleTodo} onJump={p.onJump} onDelete={p.onDelete} onEdit={p.onEdit} />)}
        </>}
        {p.tab === 'history' && <>
          <div className="compose" style={{ display: 'flex', gap: 6 }}>
            <input placeholder="Name this version…" value={vlabel} onChange={(e) => setVlabel(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && vlabel.trim()) { p.onSaveVersion(vlabel.trim()); setVlabel(''); } }} style={{ flex: 1 }} />
            <button className="solid" onClick={() => { if (vlabel.trim()) { p.onSaveVersion(vlabel.trim()); setVlabel(''); } }}>Save</button>
          </div>
          {p.versions.length === 0 && <div className="empty-d">Versions are saved automatically as you edit. Name one to mark a milestone.</div>}
          {p.versions.map((v) => { const u = Auth.byId(v.authorId); return <div key={v.id} className={'ver-row' + (v.named ? ' named' : '')}>
            <Avatar user={u} size={24} />
            <div className="ver-b"><div className="ver-l">{v.named ? <b>{v.label}</b> : v.label}</div><div className="ver-t">{u ? u.name.split(' ')[0] : '?'} · {rel(v.createdAt)} ago</div></div>
            <div className="ver-act"><button onClick={() => p.onCompare(v)} title="Compare with current">Diff</button><button onClick={() => p.onRestore(v)} title="Restore">Restore</button></div>
          </div>; })}
        </>}
        {p.tab === 'activity' && <>
          {(!p.activity || !p.activity.length) && <div className="empty-d">Edits, comments and shares show up here.</div>}
          {(p.activity || []).map((a) => { const u = Auth.byId(a.actorId); return <div className="act-d" key={a.id}><Avatar user={u} size={24} /><div><b>{u ? u.name.split(' ')[0] : a.actorId}</b> {a.verb} {a.target}<div className="act-t">{rel(a.at)} ago</div></div></div>; })}
        </>}
        {p.tab === 'kpi' && <KpiPanel metrics={p.metrics} journalMeta={p.journalMeta} journal={p.journal} templateId={p.templateId} submission={p.submission} onSetStatus={p.onSetStatus} canEdit={p.canEdit} tts={p.tts} engine={p.engine} model={p.model} readiness={p.readiness} coverTitle={p.coverTitle} coverAuthor={p.coverAuthor} />}
        {p.tab === 'review' && <ReviewPanel review={p.review} focus={p.reviewFocus} onJump={p.onJump} onResolve={p.onResolve} onDelete={p.onDelete} onApply={p.onApplyReview} onImport={p.onImportReview} onClear={p.onClearReview} canImport={p.canImport} />}
        {p.tab === 'numbers' && <ConsistencyPanel groups={p.consistency} onGoto={p.onGotoOff} />}
        {p.tab === 'refs' && <ReferencesPanel refs={p.refs} onGoto={p.onGotoRef} onAddDoi={p.onAddDoi} bibPaths={p.bibPaths} canEdit={p.canEdit} docName={p.docName} />}
        {p.tab === 'spelling' && <SpellPanel on={p.spellOn} onToggle={p.onToggleSpell} result={p.spell} busy={p.spellBusy} err={p.spellErr} lang={p.spellLang} langPref={p.spellLangPref} langs={p.spellLangs} onSetLang={p.onSetSpellLang} personal={p.spellPersonal} onGoto={p.onSpellGoto} onSuggest={p.onSpellSuggest} onReplaceAll={p.onSpellReplaceAll} onAddDict={p.onSpellAddDict} onIgnore={p.onSpellIgnore} onUndoDict={p.onSpellUndoDict} onRetry={p.onSpellRetry} canEdit={p.canEdit} />}
      </div>
      <Lightbox />
    </aside>;
  }

  /* ---- KPI / format-compliance panel (Tier A auto-tracked + Tier B reference + Tier C status) ---- */
  /* ---- AI Review panel: workflow findings as navigable, anchored review notes ---- */
  var REV_SEV = { major: ['#dc2626', '#fef2f2'], minor: ['#b4530f', '#fdecdf'], nit: ['#64748b', '#eef2f7'] };
  function ReviewPanel(p) {
    const review = p.review || [];
    const open = review.filter((a) => a.status !== 'resolved');
    const resolved = review.filter((a) => a.status === 'resolved');
    const rank = { major: 0, minor: 1, nit: 2 };
    const sorted = open.slice().sort((a, b) => (rank[a.severity || 'minor'] - rank[b.severity || 'minor']));
    const counts = { major: open.filter((a) => a.severity === 'major').length, minor: open.filter((a) => a.severity === 'minor').length, nit: open.filter((a) => a.severity === 'nit').length };
    const focusRef = useRef(null);
    useEffect(() => { if (p.focus && focusRef.current) { try { focusRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { } } }, [p.focus]);
    function item(a, dim) {
      const c = REV_SEV[a.severity || 'minor'] || REV_SEV.minor;
      const unanchored = !a.anchor || a.anchor.start === a.anchor.end || a._orphan;
      return <div key={a.id} ref={a.id === p.focus ? focusRef : null} className={'rev-item ' + (a.severity || 'minor') + (dim ? ' done' : '') + (a.id === p.focus ? ' focus' : '')}>
        <div className="rev-head">
          <span className="rev-sev" style={{ color: c[0], background: c[1] }}>{a.severity || 'minor'}</span>
          <span className="rev-cat">{a.category || 'style'}</span>
          {unanchored ? <span className="rev-cat" title="Could not be located in the current text">unanchored</span> : null}
          <span className="rev-grow" />
          <button className="link" onClick={() => p.onJump(a)} disabled={unanchored}>Jump</button>
        </div>
        <div className="rev-body">{a.comment}</div>
        {a.suggestion ? <div className="rev-sug"><b>Javaslat:</b> {a.suggestion}</div> : null}
        {a.anchor && a.anchor.quote ? <div className="rev-quote">“{a.anchor.quote.length > 130 ? a.anchor.quote.slice(0, 130) + '…' : a.anchor.quote}”</div> : null}
        <div className="rev-acts">
          {!unanchored && (a.suggestion || a.replacement) ? <button className="link" title="Insert the suggestion as a LaTeX comment above the flagged line (or apply a concrete fix), then mark it resolved — undoable" onClick={() => p.onApply && p.onApply(a)}>Apply</button> : null}
          {a.suggestion ? <button className="link" onClick={() => { try { navigator.clipboard && navigator.clipboard.writeText(a.suggestion); } catch (e) { } }}>Copy</button> : null}
          <button className="link" onClick={() => p.onResolve(a)}>{a.status === 'resolved' ? 'Reopen' : 'Mark resolved'}</button>
          <button className="link danger" onClick={() => p.onDelete(a)}>Delete</button>
        </div>
      </div>;
    }
    return <div className="review">
      <div className="rev-bar">
        <div className="rev-summary">{open.length} open · <b style={{ color: '#dc2626' }}>{counts.major}</b> major · <b style={{ color: '#b4530f' }}>{counts.minor}</b> minor · {counts.nit} nit{resolved.length ? ' · ' + resolved.length + ' resolved' : ''}</div>
        <div className="rev-bar-acts">
          <button className="vp-btn primary" onClick={p.onImport} disabled={!p.canImport} title="Import a review .json produced by the review workflow">Import…</button>
          {review.length ? <button className="link danger" onClick={p.onClear}>Clear</button> : null}
        </div>
      </div>
      {review.length === 0 && <div className="empty-d">No AI review yet. Run the review workflow on this thesis, then <b>Import…</b> the resulting <code>.review.json</code>. Each note anchors to the sentence it refers to, shows up as a ✦ marker in the Preview and the compiled PDF, and is listed here by severity.</div>}
      {sorted.map((a) => item(a, false))}
      {resolved.length ? <div className="rev-resolved-h">Resolved ({resolved.length})</div> : null}
      {resolved.map((a) => item(a, true))}
    </div>;
  }

  /* ---- Number consistency panel: metric-like values grouped by label; conflicts (>1 value) first ---- */
  function ConsistencyPanel(p) {
    const groups = p.groups || [];
    const conflicts = groups.filter((g) => g.distinct > 1);
    const single = groups.filter((g) => g.distinct === 1);
    const vals = (g) => g.values.map((v, i) => <button key={i} className="num-val" title={'line ' + (v.occ[0] && v.occ[0].line) + (v.count > 1 ? ' · ' + v.count + '×' : '')} onClick={() => v.occ[0] && p.onGoto(v.occ[0].off)}>{v.raw}{v.count > 1 ? <i className="num-x">×{v.count}</i> : null}</button>);
    const group = (g, conflict) => <div key={g.label + (g.pct ? '%' : '')} className={'num-item' + (conflict ? ' conflict' : '')}>
      <div className="num-head"><b>{g.label}</b>{conflict ? <span className="num-flag">{g.distinct} values · spread {g.spread.toFixed(3)}</span> : <span className="num-ok">{g.total}×</span>}</div>
      <div className="num-vals">{vals(g)}</div>
      {conflict && g.values.length <= 6 && <div className="num-occ">{g.values.reduce((acc, v) => acc.concat(v.occ.slice(0, 2).map((o, j) => <button key={v.raw + j} className="num-occ-i" onClick={() => p.onGoto(o.off)}>L{o.line} · <b>{v.raw}</b> · …{o.snippet}…</button>)), [])}</div>}
    </div>;
    return <div className="numbers">
      {groups.length === 0 && <div className="empty-d">No metric-like numbers detected here yet. This scans the active document for the same metric (AUROC, FPR95, ρ, method names, …) appearing with different values — a common thesis integrity defect — so you can cross-check text against tables.</div>}
      {groups.length > 0 && <div className="num-bar"><b style={{ color: conflicts.length ? '#b4530f' : '#1c7a47' }}>{conflicts.length}</b> metric{conflicts.length === 1 ? '' : 's'} appear with more than one value{single.length ? ' · ' + single.length + ' single-valued' : ''}. Heuristic — verify whether any should be identical (e.g. text vs. tables).</div>}
      {conflicts.map((g) => group(g, true))}
      {single.length ? <div className="num-sec">Single-valued ({single.length})</div> : null}
      {single.map((g) => group(g, false))}
    </div>;
  }

  /* ---- References / citation manager: cross-checks \cite vs .bib vs .bbl; DOI→BibTeX lookup ---- */
  function ReferencesPanel(p) {
    const r = p.refs;
    const [doi, setDoi] = useState('');
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState(null);                                                  // { ok, text }
    function addDoi() {
      const v = doi.trim(); if (!v || busy || !p.onAddDoi) return;
      setBusy(true); setMsg(null);
      p.onAddDoi(v).then((res) => {
        setBusy(false); setDoi('');
        setMsg({ ok: true, text: 'Added @' + res.key + (res.renamed ? ' (key disambiguated)' : '') + ' → ' + res.path + (res.title ? ' · ' + res.title.slice(0, 48) : '') });
      }, (e) => { setBusy(false); setMsg({ ok: false, text: (e && e.message) || 'Lookup failed.' }); });
    }
    const occBtn = (o, label) => <button key={(o.file || '') + o.off + label} className="num-occ-i" title={(o.file || '') + ' · line ' + o.line} onClick={() => p.onGoto && p.onGoto(o.file, o.off)}>L{o.line} · <b>{label}</b>{o.snippet ? <span> · {o.file}</span> : null}</button>;
    const item = (cls, head, sub, occ) => <div className={'num-item' + (cls ? ' ' + cls : '')} key={head}>
      <div className="num-head"><b>{head}</b>{sub ? <span className="num-flag">{sub}</span> : null}</div>
      {occ && occ.length ? <div className="num-occ">{occ}</div> : null}
    </div>;
    if (!r) return <div className="numbers"><div className="empty-d">Reference scanner unavailable.</div></div>;
    const undef = r.undefinedCites || [], uncited = r.uncited || [], dupKeys = r.dupKeys || [], dupDois = r.dupDois || [], bbl = r.bblStale || {};
    const errors = undef.length + dupKeys.length + dupDois.length + ((bbl.bblNotInBib || []).length);
    const warns = uncited.length + ((bbl.citedNotInBbl || []).length) + ((bbl.bblNotCited || []).length);
    const s = r.stats || {};
    return <div className="numbers refs">
      {p.canEdit !== false && <div className="ref-doi">
        <div className="ref-doi-row">
          <input placeholder="Add by DOI  (10.1109/…)" value={doi} disabled={busy}
            onChange={(e) => setDoi(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addDoi(); }} />
          <button className="solid" onClick={addDoi} disabled={busy || !doi.trim()}>{busy ? '…' : 'Fetch'}</button>
        </div>
        {msg && <div className={'ref-msg' + (msg.ok ? ' ok' : ' err')}>{msg.text}</div>}
        <div className="ref-doi-hint">Fetches metadata from Crossref and appends a BibTeX entry to {p.bibPaths && p.bibPaths.length ? <code>{p.bibPaths[0]}</code> : <code>references.bib</code>} (cached locally).</div>
      </div>}
      <div className="num-bar"><b style={{ color: errors ? '#dc2626' : (warns ? '#b4530f' : '#1c7a47') }}>{errors}</b> error{errors === 1 ? '' : 's'} · <b style={{ color: warns ? '#b4530f' : '#1c7a47' }}>{warns}</b> warning{warns === 1 ? '' : 's'} across {s.citedDistinct || 0} cited keys / {s.entries || 0} .bib entries{s.bblPresent ? ' / ' + (s.bblItems || 0) + ' .bbl items' : ''}. Click a row to jump.</div>

      {undef.length > 0 && <><div className="num-sec err">Undefined citations ({undef.length})</div>
        {undef.map((u) => item('conflict', '\\cite{' + u.key + '}', u.count > 1 ? u.count + ' uses · no .bib entry' : 'no .bib entry', u.occ.map((o) => occBtn(o, u.key))))}</>}

      {dupKeys.length > 0 && <><div className="num-sec err">Duplicate bib keys ({dupKeys.length})</div>
        {dupKeys.map((d) => item('conflict', '@…{' + d.key + '}', d.count + ' entries (last wins)', d.occ.map((o) => occBtn(o, '@' + (o.snippet || 'entry') + '{' + d.key + '}'))))}</>}

      {dupDois.length > 0 && <><div className="num-sec err">Duplicate DOIs ({dupDois.length})</div>
        {dupDois.map((d) => item('conflict', d.doi, d.keys.length + ' entries · same paper?', d.occ.map((o) => occBtn(o, o.snippet))))}</>}

      {(bbl.bblNotInBib || []).length > 0 && <><div className="num-sec err">.bbl entries with no .bib source ({bbl.bblNotInBib.length})</div>
        <div className="ref-keys">{bbl.bblNotInBib.map((k) => <span key={k} className="ref-key">{k}</span>)}</div></>}

      {(bbl.citedNotInBbl || []).length > 0 && <><div className="num-sec">Cited but missing from .bbl — recompile ({bbl.citedNotInBbl.length})</div>
        <div className="ref-keys">{bbl.citedNotInBbl.map((k) => <span key={k} className="ref-key">{k}</span>)}</div></>}

      {(bbl.bblNotCited || []).length > 0 && <><div className="num-sec">Stale .bbl entries — no longer cited ({bbl.bblNotCited.length})</div>
        <div className="ref-keys">{bbl.bblNotCited.slice(0, 40).map((k) => <span key={k} className="ref-key">{k}</span>)}{bbl.bblNotCited.length > 40 ? <span className="ref-key">+{bbl.bblNotCited.length - 40}</span> : null}</div></>}

      {uncited.length > 0 && <><div className="num-sec">Uncited entries ({uncited.length})<span className="num-sec-x"> · in .bib, never \cite'd (bibtex omits these)</span></div>
        {uncited.map((u) => <button key={u.file + u.off} className="ref-uncited" title={u.file + ' · line ' + u.line} onClick={() => p.onGoto && p.onGoto(u.file, u.off)}>
          <b>{u.key}</b>{u.title ? <span className="ref-uncited-t"> {u.author ? u.author + ', ' : ''}{u.title.slice(0, 60)}{u.year ? ' (' + u.year + ')' : ''}</span> : null}
        </button>)}</>}

      {errors === 0 && warns === 0 && <div className="empty-d">No citation issues detected. This cross-checks every <code>\cite</code> against your <code>.bib</code> entries and the compiled <code>.bbl</code> across the whole project — surfacing undefined cites, uncited or duplicate entries, duplicate DOIs and a stale bibliography. Heuristic; verify before acting.</div>}
    </div>;
  }

  /* ---- Spell-check panel: Hunspell (HU/EN) misspellings with suggestions, add-to-dictionary, jump ---- */
  function SpellPanel(p) {
    const [open, setOpen] = useState(null);     // expanded word
    const [sugg, setSugg] = useState({});       // word → suggestions[]
    const [loading, setLoading] = useState(null);
    const [removed, setRemoved] = useState({}); // optimistic: words just added/ignored, hidden until the re-scan lands
    useEffect(() => { setSugg({}); setOpen(null); setRemoved({}); }, [p.result]); // fresh scan → drop stale suggestion cache + optimistic hides
    const clearLoad = (w) => setLoading((c) => (c === w ? null : c));
    const r = p.result;
    const expand = (w) => {
      if (open === w) { setOpen(null); return; }
      setOpen(w);
      if (sugg[w] === undefined && p.onSuggest) { setLoading(w); p.onSuggest(w).then((s) => { setSugg((m) => Object.assign({}, m, { [w]: s || [] })); clearLoad(w); }).catch(() => { setSugg((m) => Object.assign({}, m, { [w]: [] })); clearLoad(w); }); }
    };
    const hide = (w, fn) => { fn(w); setRemoved((m) => Object.assign({}, m, { [w]: 1 })); };
    const langName = (p.langs && p.langs[p.lang]) || (p.lang || '').toUpperCase();
    return <div className="numbers spell">
      <div className="sp-head">
        <label className="sp-switch"><input type="checkbox" checked={!!p.on} onChange={p.onToggle} /> <span>Spell check</span></label>
        <select className="sp-lang" value={p.langPref || ''} onChange={(e) => p.onSetLang(e.target.value)} title="Dictionary language" disabled={!p.on}>
          <option value="">Auto ({langName})</option>
          {Object.keys(p.langs || {}).map((k) => <option key={k} value={k}>{p.langs[k]}</option>)}
        </select>
      </div>
      {!p.on && <div className="empty-d">Spell check is off. Turn it on to flag misspelled words in the active document (Hungarian + English, LaTeX-aware — commands, math and citation keys are skipped). The dictionary (≈4 MB for Hungarian) downloads once and is cached in your browser.</div>}
      {p.on && p.err && <div className="num-bar" style={{ color: '#dc2626' }}>Could not run the checker: {p.err}{p.onRetry ? <button className="sp-retry" onClick={p.onRetry}>Retry</button> : null}</div>}
      {p.on && !p.err && p.busy && <div className="num-bar">Checking <b>{langName}</b>…</div>}
      {p.on && !p.err && !p.busy && r && (() => { const visible = r.misspelled.filter((m) => !removed[m.word]); return <>
        <div className="num-bar"><b style={{ color: visible.length ? '#b4530f' : '#1c7a47' }}>{visible.length}</b> word{visible.length === 1 ? '' : 's'} to review · {r.distinct} distinct in {r.total} · <b>{langName}</b>. Click a word for suggestions; “Add” teaches your personal dictionary.</div>
        {visible.map((m) => <div key={m.word} className={'sp-item' + (open === m.word ? ' open' : '')}>
          <div className="sp-row">
            <button className="sp-word" title="Jump to first occurrence" onClick={() => m.first && p.onGoto(m.first.start)}>{m.word}</button>
            {m.count > 1 ? <i className="sp-x">{m.count}×</i> : null}
            <button className="sp-more" onClick={() => expand(m.word)}>{open === m.word ? 'Hide' : 'Fix…'}</button>
          </div>
          {open === m.word && <div className="sp-detail">
            {loading === m.word && <div className="sp-note">Finding suggestions…</div>}
            {loading !== m.word && (sugg[m.word] || []).length > 0 && <div className="sp-sugs">{sugg[m.word].map((s, i) => <button key={i} className="sp-sug" disabled={!p.canEdit} title={p.canEdit ? 'Replace all occurrences' : 'Read-only'} onClick={() => p.onReplaceAll(m.word, s)}>{s}</button>)}</div>}
            {loading !== m.word && (sugg[m.word] || []).length === 0 && <div className="sp-note">No suggestions.</div>}
            <div className="sp-acts">
              <button onClick={() => hide(m.word, p.onAddDict)}>+ Add to dictionary</button>
              <button onClick={() => hide(m.word, p.onIgnore)}>Ignore</button>
              {m.offsets.length > 1 && <span className="sp-occs">{m.offsets.slice(0, 12).map((o, i) => <button key={i} className="sp-occ" title={'Occurrence ' + (i + 1)} onClick={() => p.onGoto(o.start)}>·{i + 1}</button>)}</span>}
            </div>
          </div>}
        </div>)}
        {visible.length === 0 && <div className="empty-d">No misspellings found in this document. 🎉</div>}
      </>; })()}
      {p.on && (p.personal || []).length > 0 && <div className="sp-dict">
        <div className="num-sec">Personal dictionary ({p.personal.length})</div>
        <div className="sp-dict-list">{p.personal.map((w) => <button key={w} className="sp-dword" title="Remove from dictionary" onClick={() => p.onUndoDict(w)}>{w} ✕</button>)}</div>
      </div>}
    </div>;
  }

  var KPI_STATUS = { ok: ['#1c7a47', '#e6f3ec', 'On track'], warn: ['#b4530f', '#fdecdf', 'Near limit'], over: ['#dc2626', '#fef2f2', 'Over / missing'], info: ['#475569', '#eef2f7', ''], na: ['#94a3b8', '#f1f5f9', 'Compile to measure'], missing: ['#b4530f', '#fdecdf', 'Not found'] };
  var STATUSES = ['drafting', 'internal-review', 'submitted', 'under-review', 'major-revision', 'minor-revision', 'accepted', 'rejected', 'published'];
  var R_ICON = { ok: ['✓', '#1c7a47'], warn: ['~', '#b4530f'], fail: ['✕', '#dc2626'], skip: ['·', '#94a3b8'] };
  function KpiPanel(p) {
    var m = p.metrics, jm = p.journalMeta, sub = p.submission || {}, rd = p.readiness;
    var [cover, setCover] = useState(null); // null = closed; else the editable cover-letter text
    var [copied, setCopied] = useState(false);
    function genCover() {
      var j = p.journal || (jm && jm.name) || 'your journal';
      var title = p.coverTitle || '[Manuscript title]';
      var q = jm && jm.quartile ? ' (' + jm.quartile + ')' : '';
      setCover('Dear Editor,\n\nI am pleased to submit our manuscript, "' + title + '", for consideration for publication in ' + j + '.\n\n[In one short paragraph: the problem you address, your key contribution and result, and why it fits the scope of ' + j + '.]\n\nThis manuscript is original, has not been published previously, and is not under consideration for publication elsewhere. All authors have read and approved the manuscript and agree to its submission to ' + j + '. We declare no competing interests.\n\nWe believe this work will be of interest to the readership of ' + j + q + ', and we look forward to your response.\n\nSincerely,\n' + (p.coverAuthor || '[Your name]'));
      setCopied(false);
    }
    function copyCover() { if (!navigator.clipboard) return; navigator.clipboard.writeText(cover || '').then(function () { setCopied(true); setTimeout(function () { setCopied(false); }, 1800); }, function () { }); }
    function dlCover() { var b = new Blob([cover || ''], { type: 'text/plain' }); var u = URL.createObjectURL(b); var a = document.createElement('a'); a.href = u; a.download = 'cover-letter.txt'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 3000); }
    function badge(st) { var c = KPI_STATUS[st] || KPI_STATUS.info; return <span className="kpi-badge" style={{ color: c[0], background: c[1] }}>{st === 'ok' ? '✓' : st === 'over' ? '!' : st === 'warn' ? '~' : st === 'missing' ? '?' : '·'}</span>; }
    function pct(v, lim) { if (v == null || !lim) return 0; return Math.min(100, Math.round(v / lim * 100)); }
    var stat = [];
    if (m) {
      stat = [['Words', m.words != null ? '≈ ' + m.words.toLocaleString() : '—'], ['Pages', m.pages != null ? m.pages : '—'],
        ['Figures', m.figures], ['Tables', m.tables], ['Equations', m.equations], ['References', m.references],
        ['Keywords', m.keywords != null ? m.keywords : '—'], ['Reading', m.readingMin + ' min']];
    }
    return <div className="kpi">
      {rd && rd.items.length > 0 && <div className="rd">
        <div className={'rd-verdict ' + rd.verdict}>{rd.verdict === 'ok' ? '✓ Ready to submit' : rd.verdict === 'warn' ? '~ Almost ready' : '✕ Not ready'}<i>{rd.fails ? rd.fails + ' blocking · ' : ''}{rd.warns ? rd.warns + ' to review' : (rd.fails ? '' : 'all checks pass')}</i></div>
        {rd.items.map((it) => { var ic = R_ICON[it.status] || R_ICON.skip; return <div className="rd-row" key={it.key}>
          <span className="rd-ic" style={{ color: ic[1] }}>{ic[0]}</span>
          <span className="rd-label">{it.label}</span>
          <span className="rd-detail">{it.detail}</span>
        </div>; })}
        <button className="rd-cover" onClick={genCover}>✎ Draft cover letter</button>
        {cover != null && <div className="rd-cl">
          <textarea className="rd-cl-txt" value={cover} onChange={(e) => setCover(e.target.value)} spellCheck={false} />
          <div className="rd-cl-acts">
            <button className="vp-btn" onClick={copyCover}>{copied ? 'Copied ✓' : 'Copy'}</button>
            <button className="vp-btn" onClick={dlCover}>Download .txt</button>
            <button className="vp-btn" onClick={() => setCover(null)}>Close</button>
          </div>
        </div>}
      </div>}
      {!m && <div className="empty-d">Open a .tex document to see live manuscript metrics.</div>}
      {m && <>
        <div className="kpi-h">Format compliance {p.templateId && <span className="kpi-sub">· {p.templateId}</span>}</div>
        {m.checks.map((c) => {
          var st = c.status, c2 = KPI_STATUS[st] || KPI_STATUS.info;
          return <div className="kpi-row" key={c.key}>
            <div className="kpi-row-h"><span>{c.label}</span><span className="kpi-val">{c.value == null ? '—' : (c.unit === '%' ? c.value + '%' : c.value)}{c.limit && c.unit !== '%' ? <i className="kpi-lim"> / {c.limit}{c.unit ? ' ' + c.unit : ''}</i> : null} {badge(st)}</span></div>
            <div className="kpi-bar"><i style={{ width: (c.unit === '%' ? (c.value || 0) : pct(c.value, c.limit)) + '%', background: c2[0] }} /></div>
            {c.note && <div className="kpi-note">{c.note}</div>}
          </div>;
        })}
        <div className="kpi-stats">{stat.map((s, i) => <div className="kpi-stat" key={i}><b>{s[1]}</b><span>{s[0]}</span></div>)}</div>
      </>}

      <div className="kpi-h" style={{ marginTop: 16 }}>Journal metrics {p.journal && <span className="kpi-sub">· {p.journal}</span>}</div>
      {jm
        ? <>
            <div className="kpi-jgrid">
              {[['Impact Factor', jm.impactFactor], ['CiteScore', jm.citeScore], ['SJR', jm.sjr], ['Quartile', jm.quartile], ['h-index', jm.hIndex], ['Acceptance', jm.acceptanceRate], ['APC', jm.apc], ['Open access', jm.oaModel]]
                .filter((r) => r[1]).map((r, i) => <div className="kpi-j" key={i}><span>{r[0]}</span><b>{r[1]}</b></div>)}
            </div>
            {jm.indexing && <div className="kpi-note" style={{ marginTop: 6 }}>Indexing: {jm.indexing}</div>}
            <div className="kpi-prov">Reference data ({jm.impactFactorYear || 'as-of n/a'}, confidence: {jm.confidence || 'n/a'}). Source: {jm.source}. <b>Verify before relying.</b></div>
          </>
        : <div className="empty-d">No venue selected. Create a project from a journal template to see its bibliometrics.</div>}

      <div className="kpi-h" style={{ marginTop: 16 }}>Submission status</div>
      <select className="kpi-status-sel" value={sub.status || 'drafting'} disabled={!p.canEdit} onChange={(e) => p.onSetStatus && p.onSetStatus(e.target.value)}>
        {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase())}</option>)}
      </select>
      {sub.submittedAt && <div className="kpi-note" style={{ marginTop: 6 }}>Submitted {rel(sub.submittedAt)} ago · {Math.max(0, Math.round((Date.now() - sub.submittedAt) / 86400000))} days in pipeline</div>}

      <div className="kpi-h" style={{ marginTop: 16 }}>Narration cost {p.engine === 'eleven' ? <span className="kpi-sub">· ElevenLabs{p.model ? ' · ' + p.model : ''}</span> : null}</div>
      {(() => { const t = p.tts || { chars: 0, credits: 0, requests: 0 }; return <>
        <div className="kpi-stats" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
          <div className="kpi-stat"><b>{(t.chars || 0).toLocaleString()}</b><span>characters</span></div>
          <div className="kpi-stat"><b>≈{(t.credits || 0).toLocaleString()}</b><span>credits (est.)</span></div>
          <div className="kpi-stat"><b>{t.requests || 0}</b><span>syntheses</span></div>
        </div>
        <div className="kpi-note" style={{ marginTop: 6 }}>Characters are the exact charge on your ElevenLabs key for this thesis (only new sentences are billed — re-listening and audio already generated, also for collaborators on a shared project, is free from cache). Credits are estimated (Flash/Turbo are half-price); your account's real usage is shown in the voice panel.{t.chars ? '' : ' Nothing synthesized yet.'}</div>
      </>; })()}
    </div>;
  }

  function VoiceSettings(p) {
    const E = window.PREleven;
    const [key, setKey] = useState(E ? E.getKey() : '');
    const [editingKey, setEditingKey] = useState(!(E && E.hasKey()));
    const [voiceList, setVoiceList] = useState(E ? E.voices : []);
    const [status, setStatus] = useState(null); // { type:'ok'|'err'|'busy', msg }
    const [acct, setAcct] = useState(null); // real ElevenLabs account usage
    const testRef = useRef(null);
    const connected = !!(E && E.hasKey());

    useEffect(() => () => { if (testRef.current) { try { testRef.current.pause(); } catch (e) { } } }, []);
    useEffect(() => { if (connected && E.accountUsage) E.accountUsage().then(setAcct).catch(() => { }); }, []); // eslint-disable-line
    // auto-load the voices this key is actually allowed to use (free tier can't use Library voices)
    useEffect(() => { if (connected) loadVoices(true); }, []); // eslint-disable-line

    const saveKey = () => {
      if (!E) return;
      E.setKey(key.trim());
      setEditingKey(false);
      if (key.trim()) { setStatus({ type: 'ok', msg: 'Key saved — loading your voices…' }); loadVoices(true); }
      else setStatus({ type: 'err', msg: 'Add a key to use ElevenLabs.' });
    };
    const loadVoices = (auto) => {
      if (!E || !E.hasKey()) return;
      setStatus({ type: 'busy', msg: 'Loading your voices…' });
      E.listAccountVoices().then((vs) => {
        const stock = (E.voices || []).map((v) => ({ id: v.id, name: v.name, category: 'premade', mine: false }));
        const seen = {}, merged = [];
        vs.concat(stock).forEach((v) => { if (!seen[v.id]) { seen[v.id] = 1; merged.push(v); } });
        setVoiceList(merged);
        const mineN = vs.filter((v) => v.mine).length;
        // if the current selection isn't one this account can use, prefer one of the user's own voices
        if (vs.length && !vs.some((v) => v.id === p.elevenVoice)) p.set({ elevenVoice: (vs.find((v) => v.mine) || vs[0]).id });
        setStatus({ type: 'ok', msg: mineN ? (mineN + ' of your voices · ' + vs.length + ' available') : ('No custom voices yet · ' + vs.length + ' premade available') });
      }).catch((e) => {
        const msg = (e && e.message) || 'Could not load voices.';
        if (/rejected your API key|\(401\)|\(403\)/.test(msg)) { setEditingKey(true); setStatus({ type: 'err', msg: msg }); return; }
        if (!auto) setStatus({ type: 'err', msg: msg }); else setStatus(null);
      });
    };
    const testVoice = () => {
      if (!E) return;
      if (!connected) { setStatus({ type: 'err', msg: 'Add your API key first.' }); return; }
      setStatus({ type: 'busy', msg: 'Synthesizing sample…' });
      E.test({ elevenVoice: p.elevenVoice, model: p.model, stability: p.stability, similarity: p.similarity })
        .then((url) => { if (testRef.current) { try { testRef.current.pause(); } catch (e) { } } const a = new Audio(url); testRef.current = a; a.play().catch(() => { }); setStatus({ type: 'ok', msg: 'Playing sample.' }); })
        .catch((e) => setStatus({ type: 'err', msg: (e && e.message) || 'Test failed.' }));
    };

    return <div className="voice-pop" onClick={(e) => e.stopPropagation()}>
      <div className="vp-head">Voice engine</div>
      <div className="seg2">
        <button className={p.engine === 'browser' ? 'on' : ''} onClick={() => p.set({ engine: 'browser' })}>Browser <small>free</small></button>
        <button className={p.engine === 'eleven' ? 'on' : ''} onClick={() => p.set({ engine: 'eleven' })}>ElevenLabs <small>premium</small></button>
      </div>
      {p.engine === 'eleven' ? <>
        <div className="vp-label">API key{connected && !editingKey ? <button className="vp-link" onClick={() => setEditingKey(true)}>change</button> : null}</div>
        {editingKey
          ? <div className="vp-key">
              <input className="vp-input" type="password" value={key} placeholder="xi-api-key…" autoComplete="off"
                onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveKey(); }} />
              <button className="vp-btn primary" onClick={saveKey}>Save</button>
            </div>
          : <div className="vp-conn"><span className="vp-dot" />Connected · stored in this browser</div>}

        <div className="vp-label">Voice{connected ? <button className="vp-link" onClick={() => loadVoices(false)}>load My Voices</button> : null}</div>
        <select className="vp-sel" value={p.elevenVoice} onChange={(e) => p.set({ elevenVoice: e.target.value })}>
          {voiceList.some((v) => v.mine) && <optgroup label="My Voices">
            {voiceList.filter((v) => v.mine).map((v) => <option key={v.id} value={v.id}>{v.name}{v.category && v.category !== 'premade' ? ' · ' + v.category : ''}</option>)}
          </optgroup>}
          <optgroup label="Premade">
            {voiceList.filter((v) => !v.mine).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </optgroup>
        </select>
        {connected && voiceList.length > 0 && !voiceList.some((v) => v.mine) && <div className="vp-note" style={{ marginTop: 6 }}>No custom voices on this account yet. Create or clone a voice in ElevenLabs → <b>Voices / My Voices</b>, then click <b>load My Voices</b>.</div>}

        <div className="vp-label">Model</div>
        <select className="vp-sel" value={p.model} onChange={(e) => p.set({ model: e.target.value })}>
          {(E ? E.models : []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>

        <div className="vp-label">Stability <span>{p.stability}</span></div>
        <input type="range" min="0" max="100" value={p.stability} onChange={(e) => p.set({ stability: +e.target.value })} />
        <div className="vp-label">Similarity <span>{p.similarity}</span></div>
        <input type="range" min="0" max="100" value={p.similarity} onChange={(e) => p.set({ similarity: +e.target.value })} />

        <div className="vp-actions"><button className="vp-btn" onClick={testVoice}>
          <svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor"><path d="M4 3l9 5-9 5z" /></svg>Test voice
        </button></div>
        {status ? <div className={'vp-status ' + status.type}>{status.msg}</div> : null}
        {acct && typeof acct.used === 'number' ? <div className="vp-status">ElevenLabs account: {acct.used.toLocaleString()} / {(acct.limit || 0).toLocaleString()} characters used this period.</div> : null}
        <div className="vp-note">Your key stays in this browser and calls ElevenLabs directly. On the free plan only your account's default voices work via the API — Voice Library voices need a paid plan (Starter, $5/mo). Each sentence's audio is saved (in this browser, and — on a shared cloud project — for collaborators too), so re-listening never re-charges; only new sentences are billed. The per-thesis charge is tracked in the KPIs panel.</div>
      </> : <div className="vp-note">Uses your browser's built-in speech — free and offline. Pick a specific browser voice in the transport bar.</div>}

      <div className="vp-sep" />
      <div className="vp-label">Pronunciation dictionary</div>
      <PronEditor list={p.pron || []} onSet={p.onSetPron} />

      {p.engine === 'eleven' && <>
        <div className="vp-sep" />
        <div className="vp-label">Download narration</div>
        <NarrationExport stats={p.narrationStats} narr={p.narr} onDownload={p.onDownloadNarration} onCancel={p.onCancelNarration} />
      </>}
    </div>;
  }

  /* ---- pronunciation dictionary editor: how specific words should be SPOKEN ---- */
  function PronEditor(p) {
    const [from, setFrom] = useState(''); const [to, setTo] = useState('');
    const list = p.list || [];
    const add = () => { const f = from.trim(); if (!f) return; p.onSet(list.filter((e) => e.from.toLowerCase() !== f.toLowerCase()).concat([{ from: f, to: to.trim() }])); setFrom(''); setTo(''); };
    const remove = (f) => p.onSet(list.filter((e) => e.from !== f));
    return <div className="pron">
      {list.length > 0 && <div className="pron-list">{list.map((e) => <div key={e.from} className="pron-row"><b>{e.from}</b><span className="pron-arrow">→</span><i>{e.to || '∅'}</i><button className="pron-x" title="Remove" onClick={() => remove(e.from)}>✕</button></div>)}</div>}
      <div className="pron-add">
        <input className="vp-input" placeholder="word — e.g. LiDAR" value={from} onChange={(e) => setFrom(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
        <input className="vp-input" placeholder="say — e.g. lie-dar" value={to} onChange={(e) => setTo(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
        <button className="vp-btn" onClick={add}>Add</button>
      </div>
      <div className="vp-note" style={{ marginTop: 6 }}>Whole-word, case-insensitive overrides applied before the voice synthesizes — acronyms (OOD → “oh oh dee”), names, units. Changing it re-voices only the affected sentences. Stored for your account.</div>
    </div>;
  }

  /* ---- narration (audiobook) export: concatenate the document's per-sentence MP3 clips ---- */
  function NarrationExport(p) {
    const s = (p.stats && p.stats()) || { total: 0, cached: 0, missing: 0 };
    const n = p.narr;
    return <div className="narr">
      <div className="vp-note" style={{ marginTop: 0 }}>{s.total} sentence{s.total === 1 ? '' : 's'} · <b>{s.cached}</b> already voiced (free){s.missing ? ' · ' + s.missing + ' need synthesis (uses credits)' : ''}.</div>
      {n && n.busy ? <div className="vp-status busy">Exporting… {n.done}/{n.total}{n.fails ? ' · ' + n.fails + ' failed' : ''} <button className="vp-link" onClick={p.onCancel}>cancel</button></div> : null}
      {n && n.doneFlag ? <div className="vp-status ok">Saved {n.total} clip{n.total === 1 ? '' : 's'} as a single MP3.{n.fails ? ' (' + n.fails + ' could not be voiced)' : ''}</div> : null}
      {n && n.err ? <div className="vp-status err">{n.err}</div> : null}
      <div className="vp-actions" style={{ gap: 8 }}>
        <button className="vp-btn" disabled={!s.cached || (n && n.busy)} onClick={() => p.onDownload(false)}>Download voiced ({s.cached})</button>
        <button className="vp-btn primary" disabled={!s.total || (n && n.busy)} onClick={() => p.onDownload(true)}>Synthesize all &amp; download</button>
      </div>
    </div>;
  }

  function ShareModal(p) {
    const Store = window.PRStore; const project = p.project; const me = p.me;
    const BE = window.PR_BACKEND;
    const [email, setEmail] = useState(''); const [role, setRole] = useState('editor');
    const [sugg, setSugg] = useState([]); const [open, setOpen] = useState(false);
    const owner = Auth.byId(project.ownerId);
    const ROLES = ['editor', 'commenter', 'viewer'];
    const isMember = (id) => id === project.ownerId || (project.members || []).some((m) => m.userId === id);
    const cloud = !!(BE && BE.mode === 'cloud');
    const isOwnerView = project.ownerId === me.id;
    const [accept, setAccept] = useState({}); const [resent, setResent] = useState({});
    useEffect(() => { if (isOwnerView && cloud && Store.loadAcceptance) Store.loadAcceptance(project.id).then(setAccept); }, [project.id, (project.members || []).length]);
    const search = (q) => {
      setEmail(q);
      if (BE && BE.searchUsers && q.trim().length >= 2) { BE.searchUsers(q).then((list) => { setSugg((list || []).filter((u) => u.id !== me.id && !isMember(u.id))); setOpen(true); }); }
      else { setSugg([]); setOpen(false); }
    };
    const add = (u) => { if (!u) return; Store.addMember(project.id, u.id, role); setEmail(''); setSugg([]); setOpen(false); p.onChange(); };
    const invite = () => {
      const e = email.trim(); if (!e) return;
      if (sugg[0]) { add(sugg[0]); return; }
      const cached = Auth.byEmail(e); if (cached) { add(cached); return; }
      if (BE && BE.findUserByEmail) { BE.findUserByEmail(e).then((u) => { if (u) add(u); else alert('Nincs ilyen regisztrált felhasználó: ' + e); }); }
      else alert('Nincs ilyen regisztrált felhasználó.');
    };
    const link = location.href.split('#')[0];
    return <div className="overlay" onClick={p.onClose}><div className="modal" onClick={(e) => e.stopPropagation()}>
      <div className="modal-head"><h3>Share “{project.title}”</h3><p>Invite collaborators or share a link.</p></div>
      <div className="modal-body">
        <div className="field-label">Invite by email</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <input className="text-input" value={email} placeholder="Név vagy e-mail — kezdj el gépelni…" autoComplete="off" onChange={(e) => search(e.target.value)} onFocus={() => { if (sugg.length) setOpen(true); }} onKeyDown={(e) => { if (e.key === 'Enter') invite(); if (e.key === 'Escape') setOpen(false); }} style={{ width: '100%' }} />
            {open && sugg.length > 0 ? <div className="share-sugg">{sugg.map((u) => <button key={u.id} className="share-sugg-it" onMouseDown={(e) => e.preventDefault()} onClick={() => add(u)}><Avatar user={u} size={24} /><span className="ss-t"><b>{u.name}</b><small>{u.email}</small></span></button>)}</div> : null}
          </div>
          <select className="sel" value={role} onChange={(e) => setRole(e.target.value)}>{ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select>
          <button className="solid" onClick={invite} style={{ padding: '0 14px' }}>Invite</button>
        </div>
        <div className="field-label" style={{ marginTop: 16 }}>People with access</div>
        <div className="member-row"><Avatar user={owner} size={30} /><span className="mname">{owner ? owner.name : project.ownerId}{owner && owner.id === me.id ? ' (you)' : ''}</span><span className="role-pill">Owner</span></div>
        {project.members.map((m) => { const u = Auth.byId(m.userId); const acc = accept[m.userId]; const pending = acc == null; return <div key={m.userId} className="member-row"><Avatar user={u} size={30} /><span className="mname">{u ? u.name : m.userId}</span>
          {isOwnerView && cloud ? <span className={'inv-pill ' + (pending ? 'pending' : 'ok')} title={pending ? 'A meghívott még nem fogadta el a meghívást' : ('Elfogadva: ' + new Date(acc).toLocaleString())}>{pending ? 'Függőben' : 'Elfogadva'}</span> : null}
          {project.ownerId === me.id ? <>{pending && cloud ? <button className="link" title="Meghívó-értesítés újraküldése" onClick={() => { Store.resendInvite(project.id, m.userId, m.role, project.title); setResent((s) => Object.assign({}, s, { [m.userId]: true })); }}>{resent[m.userId] ? 'Elküldve ✓' : 'Resend'}</button> : null}<select className="sel" value={m.role} onChange={(e) => { Store.setRole(project.id, m.userId, e.target.value); p.onChange(); }}>{ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select><button className="link" style={{ color: '#dc2626' }} onClick={() => { Store.removeMember(project.id, m.userId); p.onChange(); }}>Remove</button></> : <span className="role-pill">{m.role}</span>}
        </div>; })}
        <div className="field-label" style={{ marginTop: 16 }}>Public link</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13 }}>
          <input type="checkbox" checked={project.link.enabled} disabled={project.ownerId !== me.id} onChange={(e) => { Store.setLink(project.id, e.target.checked, project.link.role); p.onChange(); }} />
          Anyone with the link can
          <select className="sel" value={project.link.role} disabled={!project.link.enabled || project.ownerId !== me.id} onChange={(e) => { Store.setLink(project.id, true, e.target.value); p.onChange(); }}>{ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select>
        </label>
        {project.link.enabled && <div className="link-box"><input readOnly value={link} /><button className="btn-ghost" onClick={() => navigator.clipboard && navigator.clipboard.writeText(link)}>Copy</button></div>}
      </div>
      <div className="modal-foot"><button className="solid" onClick={p.onClose}>Done</button></div>
    </div></div>;
  }

  function DiffModal(p) {
    const [mode, setMode] = useState('inline');
    const oldS = (p.version.files[p.file] && p.version.files[p.file].content) || '';
    const newS = p.currentSource || '';
    const words = window.PRDiff.words(oldS, newS);
    const lines = window.PRDiff.lines(oldS, newS);
    const stats = window.PRDiff.stats(oldS, newS);
    return <div className="overlay" onClick={p.onClose}><div className="modal diff-modal" onClick={(e) => e.stopPropagation()}>
      <div className="modal-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div><h3>Compare · {p.version.label}</h3><p>{bn(p.file)} · <span style={{ color: '#15803d' }}>+{stats.add}</span> <span style={{ color: '#b91c1c' }}>−{stats.del}</span> words vs. current</p></div>
        <div className="seg2 small"><button className={mode === 'inline' ? 'on' : ''} onClick={() => setMode('inline')}>Inline</button><button className={mode === 'split' ? 'on' : ''} onClick={() => setMode('split')}>Split</button></div>
      </div>
      <div className="modal-body diff-body">
        {mode === 'inline'
          ? <pre className="diff-inline">{words.map((o, i) => <span key={i} className={o.t}>{o.s}</span>)}</pre>
          : <div className="diff-split"><pre>{lines.map((o, i) => o.t !== 'add' ? <div key={i} className={o.t === 'del' ? 'del' : ''}>{o.s || ' '}</div> : null)}</pre><pre>{lines.map((o, i) => o.t !== 'del' ? <div key={i} className={o.t === 'add' ? 'add' : ''}>{o.s || ' '}</div> : null)}</pre></div>}
      </div>
      <div className="modal-foot"><button className="btn-ghost" onClick={p.onClose}>Close</button><button className="solid" onClick={() => p.onRestore(p.version)}>Restore this version</button></div>
    </div></div>;
  }

  window.Collab = { Avatar, PresenceBar, ResumePill, SelectionToolbar, AnnoPopover, BubbleThreads, RightDrawer, VoiceSettings, ShareModal, DiffModal };
})();
