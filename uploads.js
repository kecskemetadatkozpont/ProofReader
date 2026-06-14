/* Aloud — large binary uploads via Supabase Storage (cloud mode only).
 * Loads AFTER backend.js + store-cloud.js, BEFORE app.jsx.
 * Binary files (images, PDFs, any type) go to the 'project-files' bucket at
 * <projectId>/<ts>-<name> instead of being base64-inlined into the project
 * blob. Rendering resolves storagePath -> a cached signed URL (PR_SIGNED). */
(function () {
  'use strict';
  var BE = window.PR_BACKEND;
  window.PR_SIGNED = window.PR_SIGNED || {};
  var enabled = !!(BE && BE.mode === 'cloud' && BE.sb && window.PR_CONFIG);
  var sb = enabled ? BE.sb : null;
  var bucket = (window.PR_CONFIG && window.PR_CONFIG.uploadsBucket) || 'project-files';

  function safeName(n) { return String(n || 'file').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80) || 'file'; }

  function put(projectId, name, blob) {
    if (!enabled) return Promise.reject(new Error('uploads disabled (demo mode)'));
    if (!projectId) return Promise.reject(new Error('no project'));
    var path = projectId + '/' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6) + '-' + safeName(name);
    var ct = (blob && blob.type) || 'application/octet-stream';
    return sb.storage.from(bucket).upload(path, blob, { contentType: ct, upsert: true }).then(function (r) {
      if (r.error) throw r.error;
      return { storagePath: path, name: name, size: (blob && blob.size) || 0, mime: ct };
    });
  }

  function signedUrl(storagePath) {
    if (!enabled || !storagePath) return Promise.resolve(null);
    if (window.PR_SIGNED[storagePath]) return Promise.resolve(window.PR_SIGNED[storagePath]);
    return sb.storage.from(bucket).createSignedUrl(storagePath, 3600).then(function (r) {
      var u = r && r.data && r.data.signedUrl; if (u) window.PR_SIGNED[storagePath] = u; return u || null;
    }, function () { return null; });
  }

  // Sign every storagePath in a files map that isn't cached yet. Resolves true
  // if any new URL was added (so the caller can recompile/re-render).
  function ensureSigned(files) {
    if (!enabled || !files) return Promise.resolve(false);
    var paths = Object.keys(files).map(function (k) { return files[k] && files[k].storagePath; })
      .filter(function (p) { return p && !window.PR_SIGNED[p]; });
    if (!paths.length) return Promise.resolve(false);
    return Promise.all(paths.map(signedUrl)).then(function () { return true; });
  }

  function remove(storagePath) { if (enabled && storagePath) sb.storage.from(bucket).remove([storagePath]).then(function () { }, function () { }); }

  window.PRUploads = { enabled: enabled, bucket: bucket, put: put, signedUrl: signedUrl, ensureSigned: ensureSigned, remove: remove };
})();
