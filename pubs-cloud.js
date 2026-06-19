/* Publify — cloud publications. Loads AFTER publications.js + backend.js + store-cloud.js.
 * In 'cloud' mode it refreshes the signed-in researcher's publication list FROM the Supabase
 * `publications` table, overwriting the bundled publications.js entry (which stays as the
 * instant cache / demo fallback). Re-renders via PRStore._notify so the Profile reflects the
 * live DB (future edits to the table show up without a rebuild). */
(function () {
  'use strict';
  var BE = window.PR_BACKEND;
  if (!BE || BE.mode !== 'cloud' || !BE.sb || !BE.user || !window.PRPubs) return;
  var sb = BE.sb, me = BE.user;
  var COLS = 'mtid,type,type_hu,title,year,first_author,author_count,journal,volume,issue,pages,doi,citations,indep_citations,oa_type,category,core,citation,mtmt_url';
  function map(r) {
    return {
      mtid: r.mtid, type: r.type, typeHu: r.type_hu, title: r.title, year: r.year,
      firstAuthor: r.first_author, authorCount: r.author_count, journal: r.journal, volume: r.volume,
      issue: r.issue, pages: r.pages, doi: r.doi, citations: r.citations || 0, indepCitations: r.indep_citations || 0,
      oaType: r.oa_type, category: r.category, core: r.core, citation: r.citation, mtmtUrl: r.mtmt_url
    };
  }
  sb.from('publications').select(COLS).eq('researcher_id', me.id).order('year', { ascending: false }).then(function (res) {
    if (!res || res.error || !res.data) return;
    var pubs = res.data.map(map);
    var email = String(me.email || '').toLowerCase(); if (!email) return;
    var prev = window.PRPubs.data[email];
    var rec = Object.assign({ name: me.name, mtmtId: '', orcid: '' }, prev || {}, { publications: pubs, pubCount: pubs.length });
    window.PRPubs.data[email] = rec;
    window.PRPubs.cloud = true;
    if (window.PRStore && window.PRStore._notify) window.PRStore._notify();
  }, function () { });
})();
