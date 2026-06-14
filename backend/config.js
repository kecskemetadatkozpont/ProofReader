/* ProofReader backend configuration.
 * The anon / publishable key is SAFE to ship in the browser — Row-Level
 * Security (see backend/schema.sql) gates every request. The service_role
 * key and Google client secret are NOT here; they live only in the
 * Supabase dashboard / Edge Function environment. */
window.PR_CONFIG = {
  supabaseUrl: 'https://jokqthwszkweyqmmdesn.supabase.co',
  supabaseAnonKey: 'sb_publishable_Kjq-VoLCdhDaqBfH_3tAwQ_po3li_zV',
  // Storage bucket for binary uploads (images, PDFs)
  uploadsBucket: 'project-files'
};
