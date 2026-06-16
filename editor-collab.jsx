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
    const tabs = [['comments', 'Comments'], ['todos', 'To-dos'], ['history', 'History'], ['activity', 'Activity'], ['kpi', 'KPIs']];
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
        {tabs.map(([k, l]) => <button key={k} className={'dtab' + (p.tab === k ? ' on' : '')} onClick={() => p.setTab(k)}>{l}{k === 'comments' && openCount ? <span className="badge">{openCount}</span> : null}{k === 'todos' && todoOpen ? <span className="badge">{todoOpen}</span> : null}</button>)}
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
        {p.tab === 'kpi' && <KpiPanel metrics={p.metrics} journalMeta={p.journalMeta} journal={p.journal} templateId={p.templateId} submission={p.submission} onSetStatus={p.onSetStatus} canEdit={p.canEdit} />}
      </div>
      <Lightbox />
    </aside>;
  }

  /* ---- KPI / format-compliance panel (Tier A auto-tracked + Tier B reference + Tier C status) ---- */
  var KPI_STATUS = { ok: ['#1c7a47', '#e6f3ec', 'On track'], warn: ['#b4530f', '#fdecdf', 'Near limit'], over: ['#dc2626', '#fef2f2', 'Over / missing'], info: ['#475569', '#eef2f7', ''], na: ['#94a3b8', '#f1f5f9', 'Compile to measure'], missing: ['#b4530f', '#fdecdf', 'Not found'] };
  var STATUSES = ['drafting', 'internal-review', 'submitted', 'under-review', 'major-revision', 'minor-revision', 'accepted', 'rejected', 'published'];
  function KpiPanel(p) {
    var m = p.metrics, jm = p.journalMeta, sub = p.submission || {};
    function badge(st) { var c = KPI_STATUS[st] || KPI_STATUS.info; return <span className="kpi-badge" style={{ color: c[0], background: c[1] }}>{st === 'ok' ? '✓' : st === 'over' ? '!' : st === 'warn' ? '~' : st === 'missing' ? '?' : '·'}</span>; }
    function pct(v, lim) { if (v == null || !lim) return 0; return Math.min(100, Math.round(v / lim * 100)); }
    var stat = [];
    if (m) {
      stat = [['Words', m.words != null ? '≈ ' + m.words.toLocaleString() : '—'], ['Pages', m.pages != null ? m.pages : '—'],
        ['Figures', m.figures], ['Tables', m.tables], ['Equations', m.equations], ['References', m.references],
        ['Keywords', m.keywords != null ? m.keywords : '—'], ['Reading', m.readingMin + ' min']];
    }
    return <div className="kpi">
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
    </div>;
  }

  function VoiceSettings(p) {
    const E = window.PREleven;
    const [key, setKey] = useState(E ? E.getKey() : '');
    const [editingKey, setEditingKey] = useState(!(E && E.hasKey()));
    const [voiceList, setVoiceList] = useState(E ? E.voices : []);
    const [status, setStatus] = useState(null); // { type:'ok'|'err'|'busy', msg }
    const testRef = useRef(null);
    const connected = !!(E && E.hasKey());

    useEffect(() => () => { if (testRef.current) { try { testRef.current.pause(); } catch (e) { } } }, []);
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
        const seen = {}, merged = [];
        vs.concat(E.voices).forEach((v) => { if (!seen[v.id]) { seen[v.id] = 1; merged.push(v); } });
        setVoiceList(merged);
        // if the current selection isn't one this account can use, switch to the first available
        if (vs.length && !vs.some((v) => v.id === p.elevenVoice)) p.set({ elevenVoice: vs[0].id });
        setStatus({ type: 'ok', msg: vs.length + ' voice' + (vs.length === 1 ? '' : 's') + ' available on your plan.' });
      }).catch((e) => { if (!auto) setStatus({ type: 'err', msg: (e && e.message) || 'Could not load voices.' }); else setStatus(null); });
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

        <div className="vp-label">Voice{connected ? <button className="vp-link" onClick={loadVoices}>load mine</button> : null}</div>
        <select className="vp-sel" value={p.elevenVoice} onChange={(e) => p.set({ elevenVoice: e.target.value })}>
          {voiceList.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>

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
        <div className="vp-note">Your key stays in this browser and calls ElevenLabs directly. On the free plan only your account's default voices work via the API — Voice Library voices need a paid plan (Starter, $5/mo). Audio is cached per sentence and the next sentences prefetch for gapless playback. For production, route through a backend so the key stays server-side.</div>
      </> : <div className="vp-note">Uses your browser's built-in speech — free and offline. Pick a specific browser voice in the transport bar.</div>}
    </div>;
  }

  function ShareModal(p) {
    const Store = window.PRStore; const project = p.project; const me = p.me;
    const [email, setEmail] = useState(''); const [role, setRole] = useState('editor');
    const owner = Auth.byId(project.ownerId);
    const ROLES = ['editor', 'commenter', 'viewer'];
    const invite = () => { const u = Auth.byEmail(email.trim()); if (!u) { alert('Try: ' + Auth.users().map((x) => x.email).join(', ')); return; } Store.addMember(project.id, u.id, role); setEmail(''); p.onChange(); };
    const link = location.href.split('#')[0];
    return <div className="overlay" onClick={p.onClose}><div className="modal" onClick={(e) => e.stopPropagation()}>
      <div className="modal-head"><h3>Share “{project.title}”</h3><p>Invite collaborators or share a link.</p></div>
      <div className="modal-body">
        <div className="field-label">Invite by email</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="text-input" list="ul2" value={email} placeholder="name@lab.edu" onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') invite(); }} style={{ flex: 1 }} />
          <datalist id="ul2">{Auth.users().map((u) => <option key={u.id} value={u.email} />)}</datalist>
          <select className="sel" value={role} onChange={(e) => setRole(e.target.value)}>{ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select>
          <button className="solid" onClick={invite} style={{ padding: '0 14px' }}>Invite</button>
        </div>
        <div className="field-label" style={{ marginTop: 16 }}>People with access</div>
        <div className="member-row"><Avatar user={owner} size={30} /><span className="mname">{owner ? owner.name : project.ownerId}{owner && owner.id === me.id ? ' (you)' : ''}</span><span className="role-pill">Owner</span></div>
        {project.members.map((m) => { const u = Auth.byId(m.userId); return <div key={m.userId} className="member-row"><Avatar user={u} size={30} /><span className="mname">{u ? u.name : m.userId}</span>
          {project.ownerId === me.id ? <><select className="sel" value={m.role} onChange={(e) => { Store.setRole(project.id, m.userId, e.target.value); p.onChange(); }}>{ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select><button className="link" style={{ color: '#dc2626' }} onClick={() => { Store.removeMember(project.id, m.userId); p.onChange(); }}>Remove</button></> : <span className="role-pill">{m.role}</span>}
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

  window.Collab = { Avatar, PresenceBar, ResumePill, SelectionToolbar, AnnoPopover, RightDrawer, VoiceSettings, ShareModal, DiffModal };
})();
