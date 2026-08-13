/* Publify — shared run-trace viewer (window.PRTrace).
 *
 * Agent/web chat replies carry an INVISIBLE trace of what the swarm did, embedded in the message content as an
 * HTML comment: `<!--pf-trace:BASE64(json)-->`. It is invisible even on OLD clients (DOMPurify strips comments),
 * and new clients strip + render it as a HYBRID panel: a compact node-flow graph (planner → workers → reviewer →
 * synth) + tabs [Lépések | Források]. Emitted by the claude-session (mode:'agents') and research-agents edges.
 *
 * Trace schema (v1):
 *   { v:1, kind:'swarm'|'web',
 *     agents:[ { id, role:'planner'|'researcher'|'reviewer'|'synth'|'web', label, searches:[str], nsrc:int, status:str } ],
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

  function b64dec(s) {
    try { var bin = atob(s), bytes = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return new TextDecoder().decode(bytes); } catch (e) { return ''; }
  }
  function parse(content) {
    var m = FENCE.exec(String(content == null ? '' : content)); if (!m) return null;
    var js = b64dec(m[1]); if (!js) return null;
    try { var o = JSON.parse(js); return (o && o.agents && o.agents.length) ? o : null; } catch (e) { return null; }
  }
  function strip(content) { return String(content == null ? '' : content).replace(FENCE_G, ''); }
  function icon(role) { return role === 'planner' ? '🧭' : role === 'researcher' ? '🔬' : role === 'reviewer' ? '🧐' : role === 'synth' ? '🧩' : role === 'web' ? '🌐' : '•'; }

  var STYLE = [
    '.prt{margin-top:8px;border:1px solid var(--line);border-radius:11px;background:var(--surface-2,#f5f6f9);overflow:hidden;font-size:12.5px}',
    '.prt-flow{display:flex;align-items:stretch;gap:6px;flex-wrap:wrap;padding:10px 11px;overflow-x:auto}',
    '.prt-stage{display:flex;flex-direction:column;gap:5px;min-width:0}',
    '.prt-arrow{align-self:center;color:var(--faint);font-size:16px;line-height:1;flex:none}',
    '.prt-out{align-self:center;font-weight:600;color:var(--muted);white-space:nowrap;flex:none}',
    '.prt-node{display:flex;align-items:center;gap:5px;padding:5px 9px;border:1px solid var(--line);border-radius:999px;background:var(--surface,#fff);color:var(--ink,#1a2030);cursor:pointer;font:inherit;font-size:12px;max-width:190px}',
    '.prt-node:hover{border-color:var(--accent)}',
    '.prt-node.sel{border-color:var(--accent);background:var(--accent-tint,#eef0ff);color:var(--accent);font-weight:600}',
    '.prt-node.err{border-color:var(--danger,#dc2626);color:var(--danger,#dc2626)}',
    '.prt-nic{flex:none}',
    '.prt-nlab{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}',
    '.prt-nbadge{flex:none;font-size:10.5px;color:var(--muted);font-weight:600}',
    '.prt-tabs{display:flex;gap:2px;align-items:center;padding:0 9px;border-top:1px solid var(--line);border-bottom:1px solid var(--line);background:var(--surface,#fff)}',
    '.prt-tab{border:0;background:transparent;padding:8px 10px;font:inherit;font-size:12px;font-weight:600;color:var(--muted);cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px}',
    '.prt-tab.on{color:var(--accent);border-bottom-color:var(--accent)}',
    '.prt-clear{margin-left:auto;border:0;background:transparent;color:var(--faint);cursor:pointer;font:inherit;font-size:11.5px}',
    '.prt-clear:hover{color:var(--accent)}',
    '.prt-body{padding:9px 11px;max-height:280px;overflow-y:auto}',
    '.prt-steps{display:flex;flex-direction:column;gap:9px}',
    '.prt-step{display:flex;flex-direction:column;gap:4px}',
    '.prt-shead{display:flex;align-items:center;gap:5px}',
    '.prt-shead b{font-weight:600}',
    '.prt-sstat{margin-left:auto;color:var(--faint);font-size:11px;white-space:nowrap}',
    '.prt-schips{display:flex;flex-wrap:wrap;gap:5px;padding-left:19px}',
    '.prt-chip{background:var(--surface-2,#f5f6f9);border:1px solid var(--line);border-radius:6px;padding:2px 7px;font-size:11px;color:var(--muted);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.prt-snote{padding-left:19px;color:var(--faint);font-size:11px}',
    '.prt-src{display:flex;flex-direction:column;gap:2px}',
    '.prt-srow{display:flex;align-items:center;gap:7px;padding:5px 6px;border-radius:7px;color:var(--ink,#1a2030);text-decoration:none}',
    'a.prt-srow:hover{background:var(--surface-2,#f5f6f9);color:var(--accent)}',
    '.prt-sic{flex:none}',
    '.prt-stit{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}',
    '.prt-empty{color:var(--faint);font-size:11.5px}',
    '@media (prefers-reduced-motion:reduce){.prt-node{transition:none}}'
  ].join('');
  function injectStyle() { if (document.getElementById('prt-style')) return; try { var s = document.createElement('style'); s.id = 'prt-style'; s.textContent = STYLE; document.head.appendChild(s); } catch (e) { } }

  function View(props) {
    var React = window.React, h = React.createElement;
    var tr = props.trace || {}, agents = tr.agents || [], sources = tr.sources || [];
    var tS = React.useState('steps'), tab = tS[0], setTab = tS[1];
    var sS = React.useState(null), sel = sS[0], setSel = sS[1];
    injectStyle();

    function node(a) {
      return h('button', { key: a.id, className: 'prt-node' + (sel === a.id ? ' sel' : '') + (a.status && a.status.indexOf('⚠') >= 0 ? ' err' : ''), title: a.label + (a.status ? ' — ' + a.status : ''), onClick: function () { setSel(sel === a.id ? null : a.id); setTab('steps'); } },
        h('span', { className: 'prt-nic' }, icon(a.role)),
        h('span', { className: 'prt-nlab' }, a.label),
        a.nsrc ? h('span', { className: 'prt-nbadge' }, '📄' + a.nsrc) : null);
    }
    var stages = [
      agents.filter(function (a) { return a.role === 'planner'; }),
      agents.filter(function (a) { return a.role === 'researcher' || a.role === 'web'; }),
      agents.filter(function (a) { return a.role === 'reviewer'; }),
      agents.filter(function (a) { return a.role === 'synth'; })
    ].filter(function (g) { return g.length; });
    var flowItems = [];
    stages.forEach(function (g, gi) {
      flowItems.push(h('div', { key: 's' + gi, className: 'prt-stage' }, g.map(node)));
      flowItems.push(h('span', { key: 'a' + gi, className: 'prt-arrow', 'aria-hidden': 'true' }, '›'));
    });
    flowItems.push(h('span', { key: 'out', className: 'prt-out' }, '💬 válasz'));
    var flow = h('div', { className: 'prt-flow' }, flowItems);

    var shown = sel ? agents.filter(function (a) { return a.id === sel; }) : agents;
    var stepsEl = h('div', { className: 'prt-steps' }, shown.map(function (a) {
      return h('div', { key: a.id, className: 'prt-step' },
        h('div', { className: 'prt-shead' }, h('span', null, icon(a.role)), h('b', null, a.label), a.status ? h('span', { className: 'prt-sstat' }, a.status) : null),
        (a.searches && a.searches.length) ? h('div', { className: 'prt-schips' }, a.searches.map(function (q, qi) { return h('span', { key: qi, className: 'prt-chip', title: q }, '🌐 ' + q); })) : null,
        a.nsrc ? h('div', { className: 'prt-snote' }, '📄 ' + a.nsrc + ' forrás') : null);
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

    return h('div', { className: 'prt' }, flow, tabs, h('div', { className: 'prt-body' }, tab === 'steps' ? stepsEl : srcEl));
  }

  window.PRTrace = { parse: parse, strip: strip, View: View, view: function (tr) { return window.React.createElement(View, { trace: tr }); } };
})();
