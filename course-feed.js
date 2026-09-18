/* Publify — Kurzus: hírfolyam (course-feed.js).
 * Loaded by Course.html before course.jsx; exposes window.PRCourseFeed.
 *
 * The lecturer posts announcements; students see them and the post is marked as seen the moment it
 * actually appears on their screen (IntersectionObserver, batched), never on a mere page load. Each post
 * then carries a small read indicator: for a student "látod", for the lecturer how many of the enrolled
 * students it reached, with a per-student list of who has seen it and who has not. Wording stays honest:
 * this measures that the post was displayed, not that it was understood. Schema: migration-131.
 * UI copy Hungarian, comments English, like the rest of the repo. */
(function () {
  'use strict';
  var h = React.createElement;
  var useState = React.useState, useEffect = React.useEffect, useRef = React.useRef;
  var BE = window.PR_BACKEND, sb = BE && BE.sb;

  function toast(m, o) { try { window.PRUI && window.PRUI.toast(m, o); } catch (e) { } }
  function confirmBox(title, body, label, danger) {
    if (window.PRUI && window.PRUI.confirm) return window.PRUI.confirm({ title: title, body: body, confirmLabel: label, danger: !!danger });
    return Promise.resolve(window.confirm(title + (body ? '\n\n' + body : '')));
  }
  function missingSchema(err) { return !!(err && (err.code === 'PGRST202' || err.code === 'PGRST205' || err.code === '42P01')); }
  function initials(n) { return String(n || '?').split(/\s+/).map(function (w) { return w.charAt(0); }).join('').slice(0, 2).toUpperCase() || '?'; }
  function fmtWhen(d) { try { return new Date(d).toLocaleString('hu-HU', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return d; } }
  function fmtDay(d) { if (!d) return ''; try { return new Date(d).toLocaleDateString('hu-HU', { month: 'long', day: 'numeric' }); } catch (e) { return d; } }

  var KINDS = [
    { k: 'info', t: 'Infó', ic: 'ℹ️' },
    { k: 'fontos', t: 'Fontos', ic: '❗' },
    { k: 'hatarido', t: 'Határidő', ic: '⏰' }
  ];
  var KIND_BY = {}; KINDS.forEach(function (k) { KIND_BY[k.k] = k; });

  // ---------- who has seen it (lecturer) ----------
  function Readers(props) {
    var lS = useState(null), list = lS[0], setList = lS[1];
    useEffect(function () {
      sb.rpc('course_post_readers', { p_post: props.postId }).then(function (r) {
        if (r && r.error) { setList([]); return; }
        setList(r.data || []);
      });
    }, [props.postId]);
    if (!list) return h('p', { className: 'co-note' }, 'Betöltés…');
    var seen = list.filter(function (x) { return x.read_at; });
    var missing = list.filter(function (x) { return !x.read_at; });
    return h('div', { className: 'cf-readers' },
      h('div', { className: 'cf-rgroup' },
        h('b', null, '👁 Látta (' + seen.length + ')'),
        seen.length ? h('div', { className: 'cf-people' }, seen.map(function (x) {
          return h('span', { key: x.user_id, className: 'cf-person seen', title: fmtWhen(x.read_at) },
            h('span', { className: 'cf-av' }, initials(x.name)), x.name);
        })) : h('span', { className: 'co-note' }, 'még senki')),
      h('div', { className: 'cf-rgroup' },
        h('b', null, '◌ Még nem látta (' + missing.length + ')'),
        missing.length ? h('div', { className: 'cf-people' }, missing.map(function (x) {
          return h('span', { key: x.user_id, className: 'cf-person' },
            h('span', { className: 'cf-av' }, initials(x.name)), x.name);
        })) : h('span', { className: 'co-note' }, 'mindenkihez eljutott')));
  }

  // ---------- composer ----------
  function Composer(props) {
    var p = props.post || {};
    var tS = useState(p.title || ''), title = tS[0], setTitle = tS[1];
    var bS = useState(p.body || ''), body = bS[0], setBody = bS[1];
    var kS = useState(p.kind || 'info'), kind = kS[0], setKind = kS[1];
    var pnS = useState(!!p.pinned), pinned = pnS[0], setPinned = pnS[1];
    var dS = useState(p.due_on || ''), due = dS[0], setDue = dS[1];
    var busyS = useState(false), busy = busyS[0], setBusy = busyS[1];
    function save() {
      if (body.trim().length < 2) { toast('Írd meg a közleményt.', { kind: 'error' }); return; }
      setBusy(true);
      sb.rpc('course_post_save', { p_course: props.courseId, p_post: {
        id: p.id || null, title: title, body: body, kind: kind, pinned: pinned, due_on: due || null
      } }).then(function (r) {
        setBusy(false);
        if (r && r.error) { toast(r.error.message, { kind: 'error' }); return; }
        toast(p.id ? '✓ Módosítva' : '✓ Kiírva a hallgatóknak', { kind: 'ok' });
        setTitle(''); setBody(''); setDue(''); setPinned(false); setKind('info');
        props.onDone();
      });
    }
    return h('div', { className: 'co-card cf-composer' },
      h('div', { className: 'cf-comp-h' },
        h('b', null, p.id ? '✎ Közlemény szerkesztése' : '📢 Új közlemény'),
        h('span', { className: 'sp' }),
        h('span', { className: 'seg' }, KINDS.map(function (k) {
          return h('button', { key: k.k, type: 'button', className: kind === k.k ? 'on' : '', onClick: function () { setKind(k.k); } }, k.ic + ' ' + k.t);
        }))),
      h('input', { className: 'in', value: title, maxLength: 140, placeholder: 'Cím (nem kötelező)', onChange: function (e) { setTitle(e.target.value); } }),
      h('textarea', { className: 'in', rows: 4, value: body, maxLength: 4000,
        placeholder: 'Mit szeretnél közölni? Pl. a jövő heti óra elmarad, vagy a beadandó határideje csúszik.',
        onChange: function (e) { setBody(e.target.value); } }),
      h('div', { className: 'cf-comp-f' },
        h('label', { className: 'cf-check' },
          h('input', { type: 'checkbox', checked: pinned, onChange: function (e) { setPinned(e.target.checked); } }),
          h('span', null, 'Kiemelve a lista tetején')),
        kind === 'hatarido' ? h('label', { className: 'cf-check' },
          h('span', null, 'Határidő:'),
          h('input', { className: 'in sm', type: 'date', value: due || '', onChange: function (e) { setDue(e.target.value); } })) : null,
        h('span', { className: 'sp' }),
        p.id ? h('button', { type: 'button', className: 'btn', onClick: props.onCancel }, 'Mégse') : null,
        h('button', { type: 'button', className: 'btn pri', disabled: busy, onClick: save }, p.id ? 'Mentés' : 'Kiírom')));
  }

  // ---------- one post ----------
  function Post(props) {
    var p = props.post, isInstr = props.isInstr;
    var oS = useState(false), open = oS[0], setOpen = oS[1];
    var ref = useRef(null);
    useEffect(function () {
      if (isInstr || p.read_by_me || !ref.current || !window.IntersectionObserver) return;
      // seen = actually rendered on screen for a moment, not merely fetched
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { if (e.isIntersecting) { props.onSeen(p.id); io.disconnect(); } });
      }, { threshold: 0.6 });
      io.observe(ref.current);
      return function () { io.disconnect(); };
    }, [p.id, p.read_by_me, isInstr]);

    var kind = KIND_BY[p.kind] || KIND_BY.info;
    var pct = props.students ? Math.round((p.reads || 0) / props.students * 100) : 0;
    return h('div', { ref: ref, className: 'co-card cf-post' + (p.pinned ? ' pinned' : '') + (' k-' + p.kind) + ((!isInstr && !p.read_by_me) ? ' new' : '') },
      h('div', { className: 'cf-post-h' },
        h('span', { className: 'cf-kind' }, kind.ic + ' ' + kind.t),
        p.pinned ? h('span', { className: 'cf-chip' }, '📌 kiemelt') : null,
        p.due_on ? h('span', { className: 'cf-chip due' }, '⏰ ' + fmtDay(p.due_on)) : null,
        h('span', { className: 'sp' }),
        h('span', { className: 'co-note' }, (p.author || '') + ' · ' + fmtWhen(p.created_at)),
        isInstr ? h('button', { type: 'button', className: 'btn sm', onClick: function () { props.onEdit(p); } }, '✎') : null,
        isInstr ? h('button', { type: 'button', className: 'btn sm danger', onClick: function () { props.onDelete(p); } }, '🗑') : null),
      p.title ? h('h3', null, p.title) : null,
      h('p', { className: 'cf-body' }, p.body),
      isInstr
        ? h('div', { className: 'cf-seen' },
          h('button', { type: 'button', className: 'cf-seenbtn', onClick: function () { setOpen(!open); } },
            h('span', { className: 'cf-bar' }, h('i', { style: { width: pct + '%' } })),
            h('b', null, '👁 ' + (p.reads || 0) + ' / ' + props.students),
            h('span', { className: 'co-note' }, 'hallgató látta · ' + (open ? 'elrejtem' : 'kik azok?')))
          , open ? h(Readers, { postId: p.id }) : null)
        : h('div', { className: 'cf-seen' },
          p.read_by_me ? h('span', { className: 'co-note' }, '👁 Látta a rendszer, hogy megjelent nálad.')
            : h('span', { className: 'cf-newtag' }, '● új')));
  }

  // ---------- the feed ----------
  function FeedTab(props) {
    var courseId = props.course.id;
    var dS = useState(null), data = dS[0], setData = dS[1];
    var eS = useState(''), schema = eS[0], setSchema = eS[1];
    var edS = useState(null), editing = edS[0], setEditing = edS[1];
    var pending = useRef({});
    var timer = useRef(null);

    function load() {
      sb.rpc('course_feed', { p_course: courseId }).then(function (r) {
        if (r && r.error) { if (missingSchema(r.error)) setSchema('missing'); else toast(r.error.message, { kind: 'error' }); return; }
        setData(r.data || {});
        if (props.onUnread) props.onUnread((r.data || {}).unread || 0);
      });
    }
    useEffect(function () {
      load();
      if (!sb || !sb.channel) return;
      var ch = sb.channel('course-feed:' + courseId)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'course_posts', filter: 'course_id=eq.' + courseId }, function () { load(); })
        .subscribe();
      return function () { try { sb.removeChannel(ch); } catch (e) { } };
    }, [courseId]);

    // seen marks are batched: scrolling through ten posts is one request, not ten
    function onSeen(id) {
      pending.current[id] = true;
      if (timer.current) return;
      timer.current = setTimeout(function () {
        var ids = Object.keys(pending.current); pending.current = {}; timer.current = null;
        if (!ids.length) return;
        sb.rpc('course_post_read', { p_posts: ids }).then(function () { load(); });
      }, 1200);
    }
    function del(p) {
      confirmBox('Törlöd a közleményt?', (p.title || p.body).slice(0, 80) + '… törlődik, az olvasási visszajelzésekkel együtt.', 'Törlés', true).then(function (ok) {
        if (!ok) return;
        sb.rpc('course_post_delete', { p_post: p.id }).then(function (r) {
          if (r && r.error) { toast(r.error.message, { kind: 'error' }); return; }
          load();
        });
      });
    }

    if (schema === 'missing') return h('div', { className: 'soon' },
      h('b', null, 'A hírfolyam még nincs bekapcsolva az adatbázisban. '),
      'Az adminisztrátornak le kell futtatnia a ', h('code', null, 'backend/migration-131-course-feed.sql'), ' fájlt.');
    if (!data) return h('div', { className: 'soon' }, 'Betöltés…');

    var posts = data.posts || [], isInstr = !!data.is_instructor;
    var unseen = posts.filter(function (p) { return !p.reads; }).length;
    return h('div', { className: 'cf-wrap' },
      h('div', { className: 'cf-top' },
        h('div', null,
          h('h3', null, '📢 Hírfolyam'),
          h('p', { className: 'co-note' }, isInstr
            ? 'Itt írhatsz a kurzus hallgatóinak. Minden bejegyzésnél látod, hány hallgató képernyőjén jelent meg, és kinél nem.'
            : 'Az oktató közleményei. Ami újként jelölt, azt még nem láttad.')),
        h('span', { className: 'sp' }),
        h('span', { className: 'cf-chip' }, posts.length + ' bejegyzés'),
        isInstr ? h('span', { className: 'cf-chip' }, data.students + ' hallgató') : null,
        (!isInstr && data.unread) ? h('span', { className: 'cf-chip new' }, data.unread + ' új') : null),

      isInstr ? (editing
        ? h(Composer, { courseId: courseId, post: editing, onDone: function () { setEditing(null); load(); }, onCancel: function () { setEditing(null); } })
        : h(Composer, { courseId: courseId, onDone: load })) : null,

      isInstr && unseen && posts.length ? h('p', { className: 'co-note' }, unseen + ' bejegyzést még egyetlen hallgató sem látott.') : null,

      posts.length ? posts.map(function (p) {
        return h(Post, { key: p.id, post: p, isInstr: isInstr, students: data.students || 0,
          onSeen: onSeen, onEdit: setEditing, onDelete: del });
      }) : h('div', { className: 'soon' }, isInstr ? 'Még nincs közlemény. Írd meg az elsőt — például mikor és hol lesz az első óra.' : 'Az oktató még nem írt ki semmit.'));
  }

  window.PRCourseFeed = { FeedTab: FeedTab };
})();
