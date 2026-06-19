/* Aloud auth + presence (prototype, client-side mock of Google sign-in).
 * Multiple seeded users share this browser's storage, so "sharing" works for real:
 * sign in as one user, share, switch user -> it appears under "Shared with me".
 * Presence/real-time across tabs uses BroadcastChannel + storage events. */
(function () {
  'use strict';
  var AUTH = 'proofreader:auth';
  var USERS = 'proofreader:users';

  var SEED = [
    { id: 'u_anna', name: 'Anna Kovács', email: 'anna@lab.edu', color: '#4f46e5', plan: 'pro' },
    { id: 'u_bela', name: 'Béla Nagy', email: 'bela@lab.edu', color: '#0e9f6e', plan: 'free' },
    { id: 'u_cili', name: 'Cili Tóth', email: 'cili@lab.edu', color: '#d9760b', plan: 'free' },
    { id: 'u_dani', name: 'Dani Szabó', email: 'dani@lab.edu', color: '#db2777', plan: 'pro' }
  ];

  function read(k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } }
  function write(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }

  function users() {
    var u = read(USERS, null);
    if (!u || !u.length) { u = SEED.slice(); write(USERS, u); }
    return u;
  }
  function byId(id) { return users().filter(function (x) { return x.id === id; })[0] || null; }
  function byEmail(email) { return users().filter(function (x) { return x.email.toLowerCase() === String(email).toLowerCase(); })[0] || null; }
  function current() { var a = read(AUTH, null); return a && a.userId ? byId(a.userId) : null; }
  function signIn(id) { write(AUTH, { userId: id, at: Date.now() }); }
  function signOut() { write(AUTH, { userId: null }); }
  function updateUser(id, patch) { var us = users(); for (var i = 0; i < us.length; i++) { if (us[i].id === id) { us[i] = Object.assign({}, us[i], patch); write(USERS, us); return us[i]; } } return null; }
  function initials(name) {
    return String(name || '?').trim().split(/\s+/).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase();
  }

  /* presence: heartbeat over BroadcastChannel; peers active within 8s */
  function startPresence(projectId, userId) {
    var peers = {}; var listeners = [];
    var bc = null; try { bc = new BroadcastChannel('proofreader-presence'); } catch (e) { }
    function emit() { var now = Date.now(); var live = Object.keys(peers).map(function (k) { return peers[k]; }).filter(function (p) { return now - p.at < 8000 && p.userId !== userId && p.projectId === projectId; }); listeners.forEach(function (cb) { cb(live); }); }
    function beat() { if (bc) bc.postMessage({ userId: userId, projectId: projectId, at: Date.now() }); }
    if (bc) bc.onmessage = function (e) { var d = e.data; if (!d || !d.userId) return; peers[d.userId] = d; emit(); };
    var iv = setInterval(function () { beat(); var now = Date.now(); Object.keys(peers).forEach(function (k) { if (now - peers[k].at > 8000) delete peers[k]; }); emit(); }, 3000);
    beat();
    return {
      on: function (cb) { listeners.push(cb); cb([]); },
      stop: function () { clearInterval(iv); if (bc) { try { bc.postMessage({ userId: userId, projectId: projectId, at: 0 }); bc.close(); } catch (e) { } } }
    };
  }

  window.PRAuth = { users: users, byId: byId, byEmail: byEmail, current: current, signIn: signIn, signOut: signOut, updateUser: updateUser, initials: initials, startPresence: startPresence, SEED: SEED };
})();
