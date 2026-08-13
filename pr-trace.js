/* Publify — shared run-trace viewer (window.PRTrace).
 *
 * Agent/web chat replies carry an INVISIBLE trace of what the swarm did, embedded in the message content as an
 * HTML comment: `<!--pf-trace:BASE64(json)-->`. It is invisible even on OLD clients (DOMPurify strips comments),
 * and new clients strip + render it as a HYBRID panel: a role-coloured node-flow graph (each agent card names its
 * responsibility + goal) + tabs [Lépések | Források]. Emitted by claude-session (mode:'agents') and research-agents.
 *
 * Trace schema (v1):
 *   { v:1, kind:'swarm'|'web', task?:str,
 *     agents:[ { id, role:'planner'|'researcher'|'reviewer'|'synth'|'web', label, goal?, searches:[str], nsrc:int, status:str } ],
 *     sources:[ { title, url } ] }
 *
 * API:  window.PRTrace.parse(content) -> trace|null   window.PRTrace.strip(content) -> content without the fence
 *       window.PRTrace.View            React component  window.PRTrace.view(trace) -> element
 * Uses window.React lazily (only at render), so load order vs. React does not matter.
 */
(function () {
  if (window.PRTrace) return;
  var FENCE = /<!--pf-trace:([A-Za-z0-9+/=]+)-->/;
  var FENCE_G = /\s*<!--pf-trace:[A-Za-z0-9+/=]+-->\s*/g;

  // Each swarm role: human name (responsibility), icon, accent colour, and a generic responsibility description.
  var ROLE = {
    planner: { name: 'Tervező', ic: '🧭', c: '#6366f1', resp: 'Felbontja a feladatot kutatási szögekre' },
    researcher: { name: 'Kutató', ic: '🔬', c: '#0d9488', resp: 'A kijelölt szöget vizsgálja (web + források)' },
    web: { name: 'Kutató', ic: '🌐', c: '#0d9488', resp: 'Webkeresés és forrásgyűjtés' },
    reviewer: { name: 'Értékelő', ic: '🧐', c: '#d97706', resp: 'Kritikusan ellenőrzi a találatokat' },
    synth: { name: 'Szintetizáló', ic: '🧩', c: '#8b5cf6', resp: 'Egységes, forrásolt válasszá szerkeszt' }
  };
  function R(role) { return ROLE[role] || { name: 'Ágens', ic: '•', c: '#6366f1', resp: '' }; }

  function b64dec(s) {
    try { var bin = atob(s), bytes = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return new TextDecoder().decode(bytes); } catch (e) { return ''; }
  }
  function parse(content) {
    var m = FENCE.exec(String(content == null ? '' : content)); if (!m) return null;
    var js = b64dec(m[1]); if (!js) return null;
    try { var o = JSON.parse(js); return (o && o.agents && o.agents.length) ? o : null; } catch (e) { return null; }
  }
  function strip(content) { return String(content == null ? '' : content).replace(FENCE_G, ''); }

  var STYLE = [
    '.prt{margin-top:8px;border:1px solid var(--line);border-radius:12px;background:var(--surface,#fff);overflow:hidden;font-size:12.5px}',
    '.prt-goal{display:flex;gap:7px;padding:9px 12px;background:var(--surface-2,#f5f6f9);border-bottom:1px solid var(--line);font-size:12px;color:var(--muted);line-height:1.5}',
    '.prt-goal b{color:var(--ink,#1a2030);font-weight:700;flex:none}',
    '.prt-flow{display:flex;align-items:center;gap:0;padding:14px 12px;overflow-x:auto}',
    '.prt-stage{display:flex;flex-direction:column;gap:9px;justify-content:center;flex:none}',
    '.prt-conn{flex:none;display:flex;align-items:center;color:var(--faint);padding:0 5px}',
    '.prt-conn svg{display:block}',
    '.prt-node{position:relative;text-align:left;display:flex;flex-direction:column;gap:4px;padding:8px 11px 8px 12px;border:1px solid var(--line);border-left:4px solid var(--role,#6366f1);border-radius:10px;background:var(--surface,#fff);cursor:pointer;font:inherit;width:172px;transition:box-shadow .15s ease,transform .15s ease}',
    '.prt-node:hover{box-shadow:0 4px 12px rgba(15,18,32,.10);transform:translateY(-1px)}',
    '.prt-node.sel{box-shadow:0 0 0 2px var(--role,#6366f1) inset,0 4px 12px rgba(15,18,32,.10)}',
    '.prt-node.err{--role:#dc2626}',
    '.prt-nrole{display:flex;align-items:center;gap:5px;font-weight:700;font-size:10.5px;color:var(--role,#6366f1);text-transform:uppercase;letter-spacing:.4px}',
    '.prt-nic{font-size:13px;filter:saturate(1.1)}',
    '.prt-ngoal{color:var(--ink,#1a2030);font-size:11.5px;line-height:1.42;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}',
    '.prt-nfoot{display:flex;flex-wrap:wrap;gap:8px;font-size:10.5px;color:var(--muted);margin-top:1px}',
    '.prt-nfoot .ok{color:#16a34a}.prt-nfoot .bad{color:#dc2626;font-weight:600}',
    '.prt-out{flex:none;display:flex;align-items:center;gap:6px;padding:8px 13px;border-radius:999px;background:linear-gradient(135deg,var(--accent,#4f46e5),#8b5cf6);color:#fff;font-weight:700;white-space:nowrap;box-shadow:0 3px 10px rgba(79,70,229,.32)}',
    '.prt-tabs{display:flex;gap:2px;align-items:center;padding:0 9px;border-top:1px solid var(--line);border-bottom:1px solid var(--line);background:var(--surface-2,#f8f9fb)}',
    '.prt-tab{border:0;background:transparent;padding:8px 11px;font:inherit;font-size:12px;font-weight:600;color:var(--muted);cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px}',
    '.prt-tab.on{color:var(--accent);border-bottom-color:var(--accent)}',
    '.prt-clear{margin-left:auto;border:0;background:transparent;color:var(--faint);cursor:pointer;font:inherit;font-size:11.5px}',
    '.prt-clear:hover{color:var(--accent)}',
    '.prt-body{padding:10px 12px;max-height:300px;overflow-y:auto}',
    '.prt-steps{display:flex;flex-direction:column;gap:11px}',
    '.prt-step{display:flex;gap:9px}',
    '.prt-srail{flex:none;width:26px;display:flex;flex-direction:column;align-items:center}',
    '.prt-sdot{width:23px;height:23px;border-radius:50%;display:grid;place-items:center;font-size:12px;background:color-mix(in srgb,var(--role,#6366f1) 15%,transparent);border:1.5px solid var(--role,#6366f1)}',
    '.prt-sline{flex:1;width:2px;background:var(--line);margin:3px 0 -8px}',
    '.prt-sbody{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;padding-bottom:2px}',
    '.prt-shead{display:flex;align-items:baseline;gap:7px;flex-wrap:wrap}',
    '.prt-srole{font-weight:700;color:var(--role,#6366f1);font-size:12px}',
    '.prt-sgoal{color:var(--muted);font-size:11.5px}',
    '.prt-sstat{margin-left:auto;color:var(--faint);font-size:11px;white-space:nowrap}',
    '.prt-schips{display:flex;flex-wrap:wrap;gap:5px}',
    '.prt-chip{background:var(--surface-2,#f5f6f9);border:1px solid var(--line);border-radius:6px;padding:2px 7px;font-size:11px;color:var(--muted);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.prt-snote{color:var(--faint);font-size:11px}',
    '.prt-src{display:flex;flex-direction:column;gap:2px}',
    '.prt-srow{display:flex;align-items:center;gap:7px;padding:6px 7px;border-radius:7px;color:var(--ink,#1a2030);text-decoration:none}',
    'a.prt-srow:hover{background:var(--surface-2,#f5f6f9);color:var(--accent)}',
    '.prt-sic{flex:none}',
    '.prt-stit{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}',
    '.prt-empty{color:var(--faint);font-size:11.5px}',
    '@media (prefers-reduced-motion:reduce){.prt-node{transition:none}.prt-node:hover{transform:none}}'
  ].join('');
  function injectStyle() { if (document.getElementById('prt-style')) return; try { var s = document.createElement('style'); s.id = 'prt-style'; s.textContent = STYLE; document.head.appendChild(s); } catch (e) { } }

  function arrowEl(h, key) { return h('span', { key: key, className: 'prt-conn', 'aria-hidden': 'true' }, h('svg', { width: 24, height: 12, viewBox: '0 0 24 12' }, h('path', { d: 'M1 6 H19 M15 2 L19 6 L15 10', stroke: 'currentColor', strokeWidth: 1.7, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' }))); }

  function View(props) {
    var React = window.React, h = React.createElement;
    var tr = props.trace || {}, agents = tr.agents || [], sources = tr.sources || [];
    var tS = React.useState('steps'), tab = tS[0], setTab = tS[1];
    var sS = React.useState(null), sel = sS[0], setSel = sS[1];
    injectStyle();

    function node(a) {
      var r = R(a.role), st = a.status || '', isErr = st.indexOf('⚠') >= 0;
      return h('button', { key: a.id, className: 'prt-node' + (sel === a.id ? ' sel' : '') + (isErr ? ' err' : ''), style: { '--role': r.c }, title: (a.goal || r.resp || a.label || ''), onClick: function () { setSel(sel === a.id ? null : a.id); setTab('steps'); } },
        h('div', { className: 'prt-nrole' }, h('span', { className: 'prt-nic' }, r.ic), r.name),
        h('div', { className: 'prt-ngoal' }, a.goal || a.label || r.resp),
        h('div', { className: 'prt-nfoot' },
          (a.searches && a.searches.length) ? h('span', null, '🌐 ' + a.searches.length + ' keresés') : null,
          a.nsrc ? h('span', null, '📄 ' + a.nsrc) : null,
          st ? h('span', { className: isErr ? 'bad' : 'ok' }, st) : null));
    }
    var stages = [
      agents.filter(function (a) { return a.role === 'planner'; }),
      agents.filter(function (a) { return a.role === 'researcher' || a.role === 'web'; }),
      agents.filter(function (a) { return a.role === 'reviewer'; }),
      agents.filter(function (a) { return a.role === 'synth'; })
    ].filter(function (g) { return g.length; });
    var flowItems = [];
    stages.forEach(function (g, gi) {
      if (gi) flowItems.push(arrowEl(h, 'a' + gi));
      flowItems.push(h('div', { key: 's' + gi, className: 'prt-stage' }, g.map(node)));
    });
    flowItems.push(arrowEl(h, 'ao'));
    flowItems.push(h('span', { key: 'out', className: 'prt-out' }, '💬 Válasz'));

    var shown = sel ? agents.filter(function (a) { return a.id === sel; }) : agents;
    var stepsEl = h('div', { className: 'prt-steps' }, shown.map(function (a, ai) {
      var r = R(a.role), st = a.status || '', isErr = st.indexOf('⚠') >= 0, last = ai === shown.length - 1;
      return h('div', { key: a.id, className: 'prt-step', style: { '--role': r.c } },
        h('div', { className: 'prt-srail' }, h('span', { className: 'prt-sdot' }, r.ic), last ? null : h('span', { className: 'prt-sline' })),
        h('div', { className: 'prt-sbody' },
          h('div', { className: 'prt-shead' }, h('span', { className: 'prt-srole' }, r.name), a.label && a.label !== r.name ? h('span', { className: 'prt-sgoal' }, '· ' + a.label) : null, st ? h('span', { className: 'prt-sstat', style: isErr ? { color: '#dc2626' } : null }, st) : null),
          (a.goal && a.goal !== a.label) ? h('div', { className: 'prt-snote' }, '🎯 ' + a.goal) : null,
          (a.searches && a.searches.length) ? h('div', { className: 'prt-schips' }, a.searches.map(function (q, qi) { return h('span', { key: qi, className: 'prt-chip', title: q }, '🌐 ' + q); })) : null,
          a.nsrc ? h('div', { className: 'prt-snote' }, '📄 ' + a.nsrc + ' forrás') : null));
    }));
    var srcEl = h('div', { className: 'prt-src' }, sources.length ? sources.map(function (s, i) {
      return s.url
        ? h('a', { key: i, className: 'prt-srow', href: s.url, target: '_blank', rel: 'noopener noreferrer', title: s.title || s.url }, h('span', { className: 'prt-sic' }, '🔗'), h('span', { className: 'prt-stit' }, s.title || s.url))
        : h('div', { key: i, className: 'prt-srow', title: s.title || 'forrás' }, h('span', { className: 'prt-sic' }, '📄'), h('span', { className: 'prt-stit' }, s.title || 'forrás'));
    }) : h('div', { className: 'prt-empty' }, 'Nincs rögzített forrás ehhez a futáshoz.'));

    var tabs = h('div', { className: 'prt-tabs' },
      h('button', { className: 'prt-tab' + (tab === 'steps' ? ' on' : ''), onClick: function () { setTab('steps'); } }, 'Lépések'),
      h('button', { className: 'prt-tab' + (tab === 'sources' ? ' on' : ''), onClick: function () { setTab('sources'); } }, 'Források' + (sources.length ? ' (' + sources.length + ')' : '')),
      sel ? h('button', { className: 'prt-clear', onClick: function () { setSel(null); } }, '× szűrő') : null);

    return h('div', { className: 'prt' },
      tr.task ? h('div', { className: 'prt-goal' }, h('b', null, '🎯 Cél:'), h('span', null, tr.task)) : null,
      h('div', { className: 'prt-flow' }, flowItems),
      tabs,
      h('div', { className: 'prt-body' }, tab === 'steps' ? stepsEl : srcEl));
  }

  window.PRTrace = { parse: parse, strip: strip, View: View, view: function (tr) { return window.React.createElement(View, { trace: tr }); } };
})();
