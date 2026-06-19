/* Publify — cloud per-publication file store. Loads AFTER pubfiles.js + backend.js.
 * In 'cloud' mode it REPLACES window.PRPubFiles with a Supabase-backed implementation:
 * blobs live in the 'publication-files' Storage bucket, metadata in the publication_files
 * table. Same surface as pubfiles.js (add/list/counts/getBlob/remove). pubKey = "<email>:<mtid>";
 * we resolve <mtid> -> publications.id for the signed-in researcher. RLS scopes everything to
 * the owner (path "<owner_id>/<pub_id>/<file_id>"). Demo mode keeps the IndexedDB store. */
(function () {
  'use strict';
  var BE = window.PR_BACKEND;
  if (!BE || BE.mode !== 'cloud' || !BE.sb || !BE.user) return;     // demo / signed-out → keep IndexedDB
  var sb = BE.sb, me = BE.user, BUCKET = 'publication-files';
  var pubIdCache = {};                                              // mtid -> Promise<pubId|null>

  function mtidOf(pubKey) { var k = String(pubKey || ''); return k.slice(k.lastIndexOf(':') + 1); }
  function pubId(mtid) {
    if (!mtid) return Promise.resolve(null);
    if (pubIdCache[mtid]) return pubIdCache[mtid];
    pubIdCache[mtid] = sb.from('publications').select('id').eq('researcher_id', me.id).eq('mtid', mtid).maybeSingle()
      .then(function (r) { return (r && r.data && r.data.id) || null; }).catch(function () { return null; });
    return pubIdCache[mtid];
  }
  function meta(row) { return { id: row.id, name: row.name, type: row.mime, size: row.size, at: row.created_at ? Date.parse(row.created_at) : 0, path: row.storage_path }; }
  function newId() { try { return crypto.randomUUID(); } catch (e) { return ('f' + Date.now().toString(16) + Math.random().toString(16).slice(2)).replace(/[^a-f0-9]/g, '').slice(0, 32); } }

  function add(pubKey, file) {
    if (!file) return Promise.reject(new Error('No file'));
    return pubId(mtidOf(pubKey)).then(function (pid) {
      if (!pid) throw new Error('This publication is not linked to your cloud account.');
      var fid = newId(), path = me.id + '/' + pid + '/' + fid;
      return sb.storage.from(BUCKET).upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false }).then(function (up) {
        if (up && up.error) throw new Error(up.error.message || 'Upload failed.');
        return sb.from('publication_files').insert({ id: fid, publication_id: pid, owner_id: me.id, name: file.name || 'file', mime: file.type || '', size: file.size || 0, storage_path: path })
          .select('id,name,mime,size,storage_path,created_at').maybeSingle();
      }).then(function (r) {
        if (r && r.error) { try { sb.storage.from(BUCKET).remove([path]); } catch (e) {} throw new Error(r.error.message || 'Could not save the file.'); }
        return meta(r.data || { id: fid, name: file.name, mime: file.type, size: file.size, storage_path: path });
      });
    });
  }
  function list(pubKey) {
    return pubId(mtidOf(pubKey)).then(function (pid) {
      if (!pid) return [];
      return sb.from('publication_files').select('id,name,mime,size,storage_path,created_at').eq('publication_id', pid).order('created_at', { ascending: false })
        .then(function (r) { return (r && r.data ? r.data : []).map(meta); }).catch(function () { return []; });
    });
  }
  function counts(pubKeys) {
    var want = {}; (pubKeys || []).forEach(function (k) { want[k] = 0; });
    return sb.from('publication_files').select('publications(mtid)').eq('owner_id', me.id).then(function (r) {
      var tally = {};
      (r && r.data ? r.data : []).forEach(function (row) { var m = row.publications && row.publications.mtid; if (m != null) tally[String(m)] = (tally[String(m)] || 0) + 1; });
      Object.keys(want).forEach(function (k) { want[k] = tally[mtidOf(k)] || 0; });
      return want;
    }).catch(function () { return want; });
  }
  function getBlob(id) {
    return sb.from('publication_files').select('storage_path').eq('id', id).maybeSingle().then(function (r) {
      var path = r && r.data && r.data.storage_path; if (!path) return null;
      return sb.storage.from(BUCKET).download(path).then(function (d) { return (d && d.data) || null; });
    }).catch(function () { return null; });
  }
  function remove(id) {
    return sb.from('publication_files').select('storage_path').eq('id', id).maybeSingle().then(function (r) {
      var path = r && r.data && r.data.storage_path;
      return Promise.resolve(path ? sb.storage.from(BUCKET).remove([path]) : null).then(function () { return sb.from('publication_files').delete().eq('id', id); });
    }).then(function (r) { return !(r && r.error); }).catch(function () { return false; });
  }
  window.PRPubFiles = { add: add, list: list, counts: counts, getBlob: getBlob, remove: remove, cloud: true };
})();
