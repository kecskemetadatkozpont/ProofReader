/* Publify — Kurzus: önszerveződő Scrum-csapatok (course-teams.js).
 * Loaded by Course.html before course.jsx; exposes window.PRCourseTeams.
 *
 * Students form their own teams: anyone may found one (name + goal) and anyone may take a free seat,
 * within the size limits and until the deadline the lecturer sets. One team per student per course.
 * Roles are Scrum's: one Product Owner, one Scrum Master, everyone else a developer — the uniqueness is
 * enforced server side, and the card says out loud when a role is still missing. Every member may also
 * write one sentence about what they take on. The lecturer sees every team, who is still without one,
 * and can move people, lock a team, or fill the leftovers at the deadline. Teams exist so that tasks
 * can be handed to them later. Schema + rules: migration-122. UI copy Hungarian, comments English. */
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
  function fmtDay(d) { try { return new Date(d).toLocaleDateString('hu-HU', { year: 'numeric', month: 'long', day: 'numeric' }); } catch (e) { return d; } }

  var ROLES = [
    { k: 'po', t: 'Product Owner', ic: '🎯', d: 'A célt és a sorrendet ő tartja kézben.' },
    { k: 'sm', t: 'Scrum Master', ic: '🛡', d: 'A munkamenetre figyel, és elhárítja az akadályokat.' },
    { k: 'dev', t: 'Fejlesztő', ic: '🔧', d: 'A megoldáson dolgozik.' }
  ];
  var ROLE_BY = {}; ROLES.forEach(function (r) { ROLE_BY[r.k] = r; });

  function Avatar(props) { return h('span', { className: 'tm-av', title: props.name }, initials(props.name)); }

  // ---------- one team card ----------
  function TeamCard(props) {
    var t = props.team, me = props.me, cfg = props.cfg, isInstr = props.isInstr;
    var mine = !!(me && me.team_id === t.id);
    var hasTeam = !!props.hasTeam;   // true even on other teams' cards → no "join" button when already placed
    var eS = useState(false), editing = eS[0], setEditing = eS[1];
    var nS = useState(t.name), name = nS[0], setName = nS[1];
    var gS = useState(t.goal || ''), goal = gS[0], setGoal = gS[1];
    var rS = useState((me && me.responsibility) || ''), resp = rS[0], setResp = rS[1];
    useEffect(function () { setName(t.name); setGoal(t.goal || ''); }, [t.name, t.goal]);
    useEffect(function () { setResp((me && me.responsibility) || ''); }, [me && me.responsibility]);

    var status = t.status || 'forming';
    var approved = status === 'approved', submitted = status === 'submitted';
    var size = (t.members || []).length;
    var max = +cfg.max || 6, min = +cfg.min || 3;
    var hasPO = (t.members || []).some(function (m) { return m.role === 'po'; });
    var hasSM = (t.members || []).some(function (m) { return m.role === 'sm'; });
    var full = size >= max;
    var gaps = [];
    if (!hasPO) gaps.push('Product Owner');
    if (!hasSM) gaps.push('Scrum Master');

    function saveTeam() {
      sb.rpc('course_team_update', { p_team: t.id, p_name: name, p_goal: goal }).then(function (r) {
        if (r && r.error) { toast(r.error.message, { kind: 'error' }); return; }
        setEditing(false); props.onChange();
      });
    }
    function setRole(userId, role) {
      sb.rpc('course_team_set_role', { p_course: props.courseId, p_user: userId, p_role: role }).then(function (r) {
        if (r && r.error) { toast(r.error.message, { kind: 'error' }); return; }
        props.onChange();
      });
    }
    function saveResp() {
      sb.rpc('course_team_set_responsibility', { p_course: props.courseId, p_text: resp }).then(function (r) {
        if (r && r.error) { toast(r.error.message, { kind: 'error' }); return; }
        toast('✓ Mentve', { kind: 'ok' }); props.onChange();
      });
    }

    var teams = props.allTeams || [];
    return h('div', { className: 'co-card tm-card' + (mine ? ' mine' : '') + (t.locked ? ' locked' : '') },
      h('div', { className: 'tm-head' },
        editing
          ? h('input', { className: 'in', value: name, maxLength: 60, 'aria-label': 'Csapatnév', onChange: function (e) { setName(e.target.value); } })
          : h('h3', null, t.name),
        mine ? h('span', { className: 'chip ok' }, 'a te csapatod') : null,
        approved ? h('span', { className: 'chip ok', title: 'Az oktató jóváhagyta — az összetétel befagyott' }, '✓ jóváhagyva')
          : submitted ? h('span', { className: 'chip acc' }, '⏳ jóváhagyásra vár') : null,
        t.locked ? h('span', { className: 'chip', title: 'Az oktató zárolta: nem lehet be- és kilépni' }, '🔒 zárolt') : null,
        h('span', { className: 'sp' }),
        h('span', { className: 'tm-size' + (full ? ' full' : '') }, size + ' / ' + max + ' fő')),
      editing
        ? h('input', { className: 'in', value: goal, maxLength: 200, placeholder: 'Egy mondat: mivel foglalkozik a csapat?', 'aria-label': 'Csapat célja', onChange: function (e) { setGoal(e.target.value); } })
        : (t.goal ? h('p', { className: 'tm-goal' }, t.goal) : null),

      h('ul', { className: 'tm-members' }, (t.members || []).map(function (m) {
        var isMe = me && m.user_id === me.user_id;
        var canSetRole = (isInstr || (mine && !approved)) && props.open;
        return h('li', { key: m.user_id, className: 'tm-m' + (isMe ? ' me' : '') },
          h(Avatar, { name: m.name }),
          h('div', { className: 'tm-m-main' },
            h('b', null, m.name || 'Névtelen', isMe ? h('span', { className: 'tm-you' }, ' · te') : null),
            m.responsibility ? h('span', { className: 'tm-resp' }, m.responsibility) : null),
          canSetRole
            ? h('select', { className: 'in sm', value: m.role, 'aria-label': (m.name || '') + ' szerepe',
                onChange: function (e) { setRole(m.user_id, e.target.value); } },
              ROLES.map(function (r) { return h('option', { key: r.k, value: r.k }, r.ic + ' ' + r.t); }))
            : h('span', { className: 'chip role-' + m.role }, ROLE_BY[m.role].ic + ' ' + ROLE_BY[m.role].t),
          isInstr ? h('select', { className: 'in sm tm-move', value: '', 'aria-label': (m.name || '') + ' áthelyezése',
              onChange: function (e) { if (e.target.value) props.onMove(m, e.target.value === '-' ? null : e.target.value); } },
            h('option', { value: '' }, 'Áthelyezés…'),
            teams.filter(function (x) { return x.id !== t.id; }).map(function (x) {
              return h('option', { key: x.id, value: x.id }, x.name + ' (' + (x.members || []).length + ')');
            }),
            h('option', { value: '-' }, '⨯ Kivesz a csapatból')) : null);
      })),

      gaps.length ? h('p', { className: 'tm-gap' }, '⚠ Még nincs ' + gaps.join(' és ') + ' a csapatban.') : null,
      size < min ? h('p', { className: 'tm-gap' }, 'Legalább ' + min + ' fő kell — most ' + size + ' vagytok.') : null,
      t.review_note ? h('p', { className: 'tm-note' }, '↩ Az oktató visszaküldte: ' + t.review_note) : null,

      (mine && !approved && props.open) ? h('div', { className: 'tm-submit' },
        submitted
          ? h('span', null, h('b', null, 'Beküldve jóváhagyásra.'), ' Amíg az oktató el nem bírálja, még visszavonhatod.')
          : (size >= min && !gaps.length
            ? h('span', null, 'Kész az összeállítás? Küldjétek be jóváhagyásra.')
            : h('span', { className: 'co-note' }, 'Beküldéshez legalább ' + min + ' fő kell, Product Ownerrel és Scrum Masterrel.')),
        h('span', { className: 'sp' }),
        submitted
          ? h('button', { type: 'button', className: 'btn sm', onClick: function () { props.onWithdraw(t); } }, 'Visszavonom')
          : h('button', { type: 'button', className: 'btn pri sm', disabled: size < min || gaps.length > 0, onClick: function () { props.onSubmit(t); } }, '✓ Beküldjük jóváhagyásra')) : null,
      (mine && approved) ? h('p', { className: 'tm-ok' }, '✓ Az oktató jóváhagyta a csapatot. Az összetétel innentől rögzített.') : null,
      mine ? h('div', { className: 'tm-own' },
        h('label', { className: 'form-l' }, 'Mit vállalsz a csapatban?'),
        h('div', { className: 'tm-resp-row' },
          h('input', { className: 'in', value: resp, maxLength: 200, placeholder: 'pl. az adatok előkészítése és a heti mérés', 'aria-label': 'A te felelősséged',
            onChange: function (e) { setResp(e.target.value); }, onKeyDown: function (e) { if (e.key === 'Enter') saveResp(); } }),
          h('button', { type: 'button', className: 'btn sm', onClick: saveResp }, 'Mentés'))) : null,

      h('div', { className: 'tm-actions' },
        (approved && (mine || isInstr) && props.onOpenRoom)
          ? h('button', { type: 'button', className: 'btn pri sm', onClick: function () { props.onOpenRoom(t); } },
            isInstr ? '👁 Munkatér' : '🗂 Munkatér') : null,
        (mine && props.open && !approved) ? (editing
          ? h('span', null,
            h('button', { type: 'button', className: 'btn pri sm', onClick: saveTeam }, 'Mentés'),
            ' ',
            h('button', { type: 'button', className: 'btn sm', onClick: function () { setEditing(false); setName(t.name); setGoal(t.goal || ''); } }, 'Mégse'))
          : h('button', { type: 'button', className: 'btn sm', onClick: function () { setEditing(true); } }, '✎ Név és cél')) : null,
        (!mine && !hasTeam && !isInstr && props.open && !full && !t.locked)
          ? h('button', { type: 'button', className: 'btn pri sm', onClick: function () { props.onJoin(t); } }, '+ Csatlakozom')
          : (!mine && !hasTeam && !isInstr && (full || t.locked) ? h('span', { className: 'co-note' }, t.locked ? 'zárolt' : 'betelt') : null),
        (mine && props.open && !approved) ? h('button', { type: 'button', className: 'btn sm danger', onClick: function () { props.onLeave(t); } }, 'Kilépek') : null,
        h('span', { className: 'sp' }),
        isInstr && !approved ? h('button', { type: 'button', className: 'btn pri sm', onClick: function () { props.onReview(t, true); } }, '✓ Jóváhagyom') : null,
        isInstr && submitted ? h('button', { type: 'button', className: 'btn sm', onClick: function () { props.onReview(t, false); } }, '↩ Visszaküldöm') : null,
        isInstr && approved ? h('button', { type: 'button', className: 'btn sm', onClick: function () { props.onReview(t, false); } }, '↩ Visszanyitom') : null,
        isInstr ? h('button', { type: 'button', className: 'btn sm', onClick: function () { props.onLock(t); } }, t.locked ? 'Feloldás' : '🔒 Zárolás') : null,
        isInstr ? h('button', { type: 'button', className: 'btn sm danger', onClick: function () { props.onDelete(t); } }, '🗑') : null));
  }

  // ---------- lecturer config bar ----------
  function ConfigBar(props) {
    var cfg = props.cfg;
    var vS = useState({ min: cfg.min || 3, max: cfg.max || 6, deadline: cfg.deadline || '', locked: !!cfg.locked });
    var val = vS[0], setVal = vS[1];
    useEffect(function () { setVal({ min: cfg.min || 3, max: cfg.max || 6, deadline: cfg.deadline || '', locked: !!cfg.locked }); },
      [cfg.min, cfg.max, cfg.deadline, cfg.locked]);
    function save(patch) {
      var next = Object.assign({}, val, patch || {});
      setVal(next);
      sb.rpc('course_teams_config', { p_course: props.courseId, p_cfg: next }).then(function (r) {
        if (r && r.error) { toast(r.error.message, { kind: 'error' }); return; }
        toast('✓ Mentve', { kind: 'ok' }); props.onChange();
      });
    }
    return h('div', { className: 'co-card tm-cfg' },
      h('b', null, '⚙️ Csapatalakítás szabályai'),
      h('div', { className: 'tm-cfg-grid' },
        h('div', null, h('label', { className: 'form-l' }, 'Legkisebb létszám'),
          h('input', { className: 'in', type: 'number', min: 1, max: 20, value: val.min, onChange: function (e) { setVal(Object.assign({}, val, { min: +e.target.value })); }, onBlur: function () { save(); } })),
        h('div', null, h('label', { className: 'form-l' }, 'Legnagyobb létszám'),
          h('input', { className: 'in', type: 'number', min: 1, max: 20, value: val.max, onChange: function (e) { setVal(Object.assign({}, val, { max: +e.target.value })); }, onBlur: function () { save(); } })),
        h('div', null, h('label', { className: 'form-l' }, 'Alakítási határidő'),
          h('input', { className: 'in', type: 'date', value: val.deadline || '', onChange: function (e) { save({ deadline: e.target.value }); } })),
        h('div', { className: 'tm-cfg-lock' },
          h('label', { className: 'tm-check' },
            h('input', { type: 'checkbox', checked: val.locked, onChange: function (e) { save({ locked: e.target.checked }); } }),
            h('span', null, 'Csapatalakítás lezárva')))),
      h('p', { className: 'co-note' }, 'A határidő után — vagy ha lezárod — a hallgatók már nem alapítanak, nem lépnek be és nem lépnek ki. Te utána is átrendezheted a csapatokat.'));
  }

  // ---------- main tab ----------
  function TeamsTab(props) {
    var courseId = props.course.id;
    var dS = useState(null), data = dS[0], setData = dS[1];
    var eS = useState(''), schema = eS[0], setSchema = eS[1];
    var nS = useState(''), newName = nS[0], setNewName = nS[1];
    var gS = useState(''), newGoal = gS[0], setNewGoal = gS[1];
    var qS = useState(''), term = qS[0], setTerm = qS[1];
    var bS = useState(false), busy = bS[0], setBusy = bS[1];
    var formRef = useRef(null);

    function load() {
      sb.rpc('course_teams_state', { p_course: courseId }).then(function (r) {
        if (r && r.error) { if (missingSchema(r.error)) setSchema('missing'); else toast(r.error.message, { kind: 'error' }); return; }
        setData(r.data || {});
      });
    }
    useEffect(function () { load(); }, [courseId]);

    if (schema === 'missing') return h('div', { className: 'soon' },
      h('b', null, 'A csapatok még nincsenek bekapcsolva az adatbázisban. '),
      'Az adminisztrátornak le kell futtatnia a ', h('code', null, 'backend/migration-122-course-teams.sql'), ' fájlt a Supabase SQL-szerkesztőjében.');
    if (!data) return h('div', { className: 'soon' }, 'Betöltés…');

    var cfg = data.config || {}, teams = data.teams || [], solo = data.solo || [];
    var me = data.me ? Object.assign({ user_id: props.meId }, data.me) : null;
    var isInstr = !!data.is_instructor, open = !!data.open;
    var inTeams = teams.reduce(function (a, t) { return a + (t.members || []).length; }, 0);
    var q = term.trim().toLowerCase();
    var shown = !q ? teams : teams.filter(function (t) {
      return (t.name || '').toLowerCase().indexOf(q) >= 0
        || (t.goal || '').toLowerCase().indexOf(q) >= 0
        || (t.members || []).some(function (m) { return (m.name || '').toLowerCase().indexOf(q) >= 0; });
    });

    function create() {
      if (newName.trim().length < 2) { toast('Adj nevet a csapatnak.', { kind: 'error' }); return; }
      setBusy(true);
      sb.rpc('course_team_create', { p_course: courseId, p_name: newName, p_goal: newGoal }).then(function (r) {
        setBusy(false);
        if (r && r.error) { toast(r.error.message, { kind: 'error' }); return; }
        setNewName(''); setNewGoal('');
        toast(isInstr ? '✓ Csapat létrehozva — most oszd be a tagjait.' : '✓ Csapat létrehozva — hívd a többieket!', { kind: 'ok' });
        load();
      });
    }
    function join(t) {
      sb.rpc('course_team_join', { p_team: t.id }).then(function (r) {
        if (r && r.error) { toast(r.error.message, { kind: 'error' }); return; }
        toast('✓ Csatlakoztál: ' + t.name, { kind: 'ok' }); load();
      });
    }
    function leave(t) {
      confirmBox('Kilépsz a csapatból?', 'A(z) „' + t.name + '” csapatból kilépsz. Ha te vagy az utolsó tag, a csapat megszűnik.', 'Kilépek', true).then(function (ok) {
        if (!ok) return;
        sb.rpc('course_team_leave', { p_course: courseId }).then(function (r) {
          if (r && r.error) { toast(r.error.message, { kind: 'error' }); return; }
          load();
        });
      });
    }
    function lock(t) {
      sb.rpc('course_team_lock', { p_team: t.id, p_locked: !t.locked }).then(function (r) {
        if (r && r.error) { toast(r.error.message, { kind: 'error' }); return; }
        load();
      });
    }
    function del(t) {
      confirmBox('Törlöd a csapatot?', '„' + t.name + '” megszűnik, a ' + (t.members || []).length + ' tagja csapat nélkül marad.', 'Törlés', true).then(function (ok) {
        if (!ok) return;
        sb.rpc('course_team_delete', { p_team: t.id }).then(function (r) {
          if (r && r.error) { toast(r.error.message, { kind: 'error' }); return; }
          load();
        });
      });
    }
    function move(userId, teamId) {
      sb.rpc('course_team_move', { p_course: courseId, p_user: userId, p_team: teamId || null }).then(function (r) {
        if (r && r.error) { toast(r.error.message, { kind: 'error' }); return; }
        load();
      });
    }
    function submit(t) {
      sb.rpc('course_team_submit', { p_course: courseId }).then(function (r) {
        if (r && r.error) { toast(r.error.message, { kind: 'error' }); return; }
        toast('✓ Beküldve — az oktató hagyja jóvá.', { kind: 'ok' }); load();
      });
    }
    function withdraw() {
      sb.rpc('course_team_withdraw', { p_course: courseId }).then(function (r) {
        if (r && r.error) { toast(r.error.message, { kind: 'error' }); return; }
        load();
      });
    }
    function review(t, ok) {
      if (ok) {
        sb.rpc('course_team_review', { p_team: t.id, p_ok: true, p_note: null }).then(function (r) {
          if (r && r.error) { toast(r.error.message, { kind: 'error' }); return; }
          toast('✓ ' + t.name + ' jóváhagyva', { kind: 'ok' }); load();
        });
        return;
      }
      var note = window.prompt((t.status === 'approved' ? 'Visszanyitod a(z) „' : 'Visszaküldöd a(z) „') + t.name
        + '” csapatot. Mit írjunk nekik? (nem kötelező)', '');
      if (note === null) return;
      sb.rpc('course_team_review', { p_team: t.id, p_ok: false, p_note: note }).then(function (r) {
        if (r && r.error) { toast(r.error.message, { kind: 'error' }); return; }
        toast('A csapat újra alakulhat.', { kind: 'ok' }); load();
      });
    }
    function approveAll(n) {
      confirmBox('Jóváhagyod mindet?', n + ' csapat vár jóváhagyásra. Mindegyik összetétele befagy — visszanyitni bármikor tudod.', 'Jóváhagyás', false).then(function (ok) {
        if (!ok) return;
        sb.rpc('course_teams_approve_all', { p_course: courseId }).then(function (r) {
          if (r && r.error) { toast(r.error.message, { kind: 'error' }); return; }
          toast('✓ ' + ((r.data || {}).approved || 0) + ' csapat jóváhagyva', { kind: 'ok' }); load();
        });
      });
    }
    function autofill() {
      confirmBox('Beosztod a maradékot?', solo.length + ' hallgató még nincs csapatban. A rendszer előbb a hiányos csapatokat tölti fel, majd újakat nyit. Utána kézzel átrendezheted őket.', 'Beosztás', false).then(function (ok) {
        if (!ok) return;
        sb.rpc('course_teams_autofill', { p_course: courseId }).then(function (r) {
          if (r && r.error) { toast(r.error.message, { kind: 'error' }); return; }
          var d = r.data || {};
          toast('✓ ' + (d.placed || 0) + ' hallgató beosztva' + (d.new_teams ? ', ' + d.new_teams + ' új csapat' : ''), { kind: 'ok' });
          load();
        });
      });
    }

    var myTeam = me ? teams.filter(function (t) { return t.id === me.team_id; })[0] : null;
    var cardProps = { cfg: cfg, courseId: courseId, isInstr: isInstr, open: open, hasTeam: !!me, allTeams: teams,
      onChange: load, onJoin: join, onLeave: leave, onLock: lock, onDelete: del,
      onSubmit: submit, onWithdraw: withdraw, onReview: review, onOpenRoom: props.onOpenRoom,
      onMove: function (m, teamId) { move(m.user_id, teamId); } };

    return h('div', { className: 'tm-wrap' },
      h('div', { className: 'tm-top' },
        h('div', null,
          h('h3', null, '👥 Scrum-csapatok'),
          h('p', { className: 'co-note' }, isInstr
            ? 'A hallgatók maguk alakítják a csapatokat. Itt látod az összeset, a csapat nélkül maradtakat, és átrendezheted őket.'
            : 'Alapíts csapatot, vagy ülj be egy szabad helyre. A szerepeket a csapat osztja el egymás közt.')),
        h('span', { className: 'sp' }),
        h('span', { className: 'chip' }, teams.length + ' csapat'),
        h('span', { className: 'chip' }, inTeams + ' fő csapatban'),
        h('span', { className: 'chip' + (solo.length ? ' acc' : '') }, solo.length + ' csapat nélkül'),
        h('span', { className: 'chip ok' }, teams.filter(function (x) { return x.status === 'approved'; }).length + ' jóváhagyva')),

      !open ? h('div', { className: 'co-card tm-closed' },
        h('b', null, '🔒 A csapatalakítás lezárult.'),
        cfg.deadline ? ' A határidő ' + fmtDay(cfg.deadline) + ' volt.' : '',
        isInstr ? ' Oktatóként te továbbra is átrendezheted a csapatokat.' : ' Ha változtatnál, szólj az oktatónak.') : null,

      (isInstr && teams.filter(function (x) { return x.status === 'submitted'; }).length)
        ? h('div', { className: 'co-card tm-review' },
          h('b', null, '⏳ ' + teams.filter(function (x) { return x.status === 'submitted'; }).length + ' csapat vár jóváhagyásra'),
          h('p', { className: 'co-note' }, 'Beküldték az összeállításukat. Jóváhagyás után az összetételük befagy, és kaphatnak feladatot.'),
          h('div', { className: 'tm-review-list' },
            teams.filter(function (x) { return x.status === 'submitted'; }).map(function (x) {
              return h('span', { key: x.id, className: 'tm-review-i' },
                h('b', null, x.name), h('span', { className: 'co-note' }, (x.members || []).length + ' fő'),
                h('button', { type: 'button', className: 'btn pri sm', onClick: function () { review(x, true); } }, '✓'),
                h('button', { type: 'button', className: 'btn sm', onClick: function () { review(x, false); } }, '↩'));
            })),
          h('button', { type: 'button', className: 'btn sm', onClick: function () { approveAll(teams.filter(function (x) { return x.status === 'submitted'; }).length); } }, '✓ Mindet jóváhagyom'))
        : null,
      (isInstr && window.PRTeamRoom && teams.some(function (x) { return x.status === 'approved'; }))
        ? h(window.PRTeamRoom.TeamsOverview, { courseId: courseId, onOpen: function (id) { props.onOpenRoom && props.onOpenRoom({ id: id }); } }) : null,
      isInstr ? h(ConfigBar, { cfg: cfg, courseId: courseId, onChange: load }) : null,

      ((isInstr || !me) && open) ? h('div', { className: 'co-card tm-new', ref: formRef },
        h('b', null, isInstr ? '＋ Új csapat létrehozása' : '＋ Új csapat alapítása'),
        h('p', { className: 'co-note' }, isInstr
          ? 'Üres csapat jön létre — te nem leszel a tagja. Utána a „Még csapat nélkül” listából, vagy a tagok melletti áthelyezéssel töltheted fel.'
          : 'Adj neki nevet, és egy mondatban azt is, mivel foglalkoztok. A többiek ezután tudnak csatlakozni.'),
        h('div', { className: 'tm-new-row' },
          h('input', { className: 'in', value: newName, maxLength: 60, placeholder: 'Csapatnév', 'aria-label': 'Csapatnév', onChange: function (e) { setNewName(e.target.value); } }),
          h('input', { className: 'in', value: newGoal, maxLength: 200, placeholder: 'Mivel foglalkoztok? (nem kötelező)', 'aria-label': 'Csapat célja', onChange: function (e) { setNewGoal(e.target.value); } }),
          h('button', { type: 'button', className: 'btn pri', disabled: busy, onClick: create }, 'Létrehozom'))) : null,

      myTeam ? h('div', { className: 'tm-mine-wrap' },
        h('div', { className: 'tm-sec' }, 'A te csapatod'),
        h(TeamCard, Object.assign({ key: myTeam.id, team: myTeam, me: me }, cardProps))) : null,

      h('div', { className: 'tm-sec tm-sec-row' },
        h('span', null, myTeam ? 'A többi csapat' : 'Csapatok'),
        h('span', { className: 'sp' }),
        teams.length > 6 ? h('input', { className: 'in sm', value: term, placeholder: 'Csapat vagy név keresése…', 'aria-label': 'Keresés', onChange: function (e) { setTerm(e.target.value); } }) : null),

      shown.filter(function (t) { return !myTeam || t.id !== myTeam.id; }).length
        ? h('div', { className: 'tm-grid' }, shown.filter(function (t) { return !myTeam || t.id !== myTeam.id; }).map(function (t) {
          return h(TeamCard, Object.assign({ key: t.id, team: t, me: me && me.team_id === t.id ? me : null }, cardProps));
        }))
        : h('div', { className: 'soon' }, teams.length ? 'Nincs találat.' : 'Még egy csapat sincs. Alapítsd te az elsőt!'),

      h('div', { className: 'co-card tm-solo' },
        h('div', { className: 'tm-solo-h' },
          h('b', null, '🙋 Még csapat nélkül (' + solo.length + ')'),
          h('span', { className: 'sp' }),
          (isInstr && solo.length) ? h('button', { type: 'button', className: 'btn sm', onClick: autofill }, '⚡ Maradék beosztása') : null),
        solo.length
          ? h('div', { className: 'tm-solo-list' }, solo.map(function (s) {
            return h('span', { key: s.user_id, className: 'tm-solo-i' },
              h(Avatar, { name: s.name }), h('span', null, s.name || 'Névtelen'),
              isInstr ? h('select', { className: 'in sm', value: '', 'aria-label': (s.name || '') + ' beosztása',
                onChange: function (e) { if (e.target.value) move(s.user_id, e.target.value); } },
                h('option', { value: '' }, 'Csapatba…'),
                teams.map(function (t) { return h('option', { key: t.id, value: t.id }, t.name + ' (' + (t.members || []).length + ')'); })) : null);
          }))
          : h('p', { className: 'co-note' }, 'Mindenki talált csapatot.')),

      isInstr ? h('p', { className: 'co-note tm-foot' }, 'A csapatok azért állnak össze, hogy később központilag kaphassanak feladatot. A beosztás bármikor módosítható.') : null);
  }

  window.PRCourseTeams = { TeamsTab: TeamsTab, ROLES: ROLES };
})();
