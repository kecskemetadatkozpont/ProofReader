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
    { id: 'u_dani', name: 'Dani Szabó', email: 'dani@lab.edu', color: '#db2777', plan: 'pro' },
    // SZE colleagues — profiles with MTMT publications (see publications.js); emails are their institutional addresses
    { id: 'u_csikos', name: 'Csikós Fanni', email: 'csikos.fanni@sze.hu', color: '#0891b2', plan: 'pro' },
    { id: 'u_pekk', name: 'Pekk Letícia', email: 'pekk.leticia@ga.sze.hu', color: '#7c3aed', plan: 'pro' },
    { id: 'u_ihasz', name: 'Ihász Máté', email: 'ihasz.mate@sze.hu', color: '#be185d', plan: 'pro' },
    { id: 'u_jagicza', name: 'Jagicza Márton', email: 'jagicza.marton@ga.sze.hu', color: '#ca8a04', plan: 'pro' },
    { id: 'u_cseke', name: 'Cseke Tibor', email: 'cseke.tibor@sze.hu', color: '#059669', plan: 'pro' },
    { id: 'u_sutheo', name: 'Sütheő Gergő', email: 'sutheo.gergo@ga.sze.hu', color: '#dc2626', plan: 'pro' },
    { id: 'u_weltsch', name: 'Weltsch Zoltán', email: 'weltsch.zoltan@sze.hu', color: '#ea580c', plan: 'pro' },
    { id: 'u_nagyz', name: 'Nagy Zoltán', email: 'nagy.zoltan@nje.hu', color: '#0d9488', plan: 'pro' },
    { id: 'u_fulop', name: 'Fülöp Tamás', email: 'fulop.tamas@nje.hu', color: '#4d7c0f', plan: 'pro' }
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

  /* ---- password auth (the colleague profiles; PBKDF2-SHA256). Client-side prototype: hashes only.
     A changed password is kept in localStorage (proofreader:pw:<email>) and overrides the bundled
     initial hash from passwords.js — so it is per-browser, not synced across devices. ---- */
  function b64ToBytes(s) { var bin = atob(s), a = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; }
  function bytesToB64(a) { var s = ''; for (var i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s); }
  function derive(pw, saltBytes, iters) {
    var subtle = window.crypto && window.crypto.subtle;
    if (!subtle) return Promise.reject(new Error('Secure crypto is unavailable in this browser.'));
    return subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits'])
      .then(function (key) { return subtle.deriveBits({ name: 'PBKDF2', salt: saltBytes, iterations: iters, hash: 'SHA-256' }, key, 256); })
      .then(function (bits) { return bytesToB64(new Uint8Array(bits)); });
  }
  function emailOf(x) { if (!x) return ''; if (String(x).indexOf('@') >= 0) return String(x).toLowerCase(); var u = byId(x); return u ? String(u.email).toLowerCase() : ''; }
  function pwRecord(email) { email = String(email || '').toLowerCase(); var ov = read('proofreader:pw:' + email, null); if (ov && ov.hash) return ov; var b = window.PRPasswords && window.PRPasswords[email]; return b || null; }
  function isProtected(x) { return !!pwRecord(emailOf(x)); }
  function verifyPassword(email, pw) { var rec = pwRecord(email); if (!rec) return Promise.resolve(false); return derive(pw || '', b64ToBytes(rec.salt), rec.iters || 150000).then(function (h) { return h === rec.hash; }); }
  function setPassword(email, pw) {
    email = String(email || '').toLowerCase();
    if (!pw || String(pw).length < 6) return Promise.reject(new Error('Choose a password of at least 6 characters.'));
    var salt = new Uint8Array(16); window.crypto.getRandomValues(salt); var iters = 150000;
    return derive(pw, salt, iters).then(function (h) { write('proofreader:pw:' + email, { salt: bytesToB64(salt), iters: iters, hash: h }); return true; });
  }
  function signInWithPassword(email, pw) {
    var u = byEmail(String(email || '').trim());
    if (!u) return Promise.resolve(null);
    return verifyPassword(u.email, pw).then(function (okv) { if (okv) { signIn(u.id); return u; } return null; });
  }
  function demoUsers() { return users().filter(function (u) { return !isProtected(u.email); }); } // passwordless pick lists
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

  window.PRAuth = { users: users, byId: byId, byEmail: byEmail, current: current, signIn: signIn, signOut: signOut, updateUser: updateUser, initials: initials, startPresence: startPresence, SEED: SEED,
    isProtected: isProtected, verifyPassword: verifyPassword, setPassword: setPassword, signInWithPassword: signInWithPassword, demoUsers: demoUsers };
})();
