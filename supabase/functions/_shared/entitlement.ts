// Publify — shared server-side entitlement enforcement (migration-49).
//
// This is the AUTHORITATIVE gate. Frontend hiding (entitlements.js/nav.js) is cosmetic;
// a user can always call an edge function directly with their JWT, so every AI edge fn
// must run assertEntitled() FIRST — before any DB write, ai_usage debit, or stream fork.
//
// The `sb` passed in must be the caller-JWT client the function already builds
// (createClient(url, anon, { global: { headers: { Authorization } } })), so the
// self-scoped SQL helpers resolve auth.uid() to the caller.
//
// Deployed automatically: `supabase functions deploy <fn>` bundles imported local files.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const deny = (msg: string, status: number) =>
  new Response(JSON.stringify({ error: msg }), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// Cheapest model — matches allowed_models fallback; used only if the RPC itself errors.
const CHEAPEST = 'claude-haiku-4-5-20251001';

/**
 * Gate 1 (account active) + Gate 2 (feature enabled) for the caller.
 * Returns a 403 Response to return-early on denial, or null to proceed.
 * Fail-CLOSED: any RPC error denies (safe-by-default).
 */
export async function assertEntitled(sb: any, feature: string): Promise<Response | null> {
  const { data: active, error: e1 } = await sb.rpc('is_active');
  if (e1 || active !== true) return deny('A fiók nem aktív (jóváhagyásra vár vagy felfüggesztve).', 403);
  const { data: enabled, error: e2 } = await sb.rpc('is_feature_enabled', { p_key: feature });
  if (e2 || enabled !== true) return deny(`Ez a funkció (${feature}) nincs engedélyezve ehhez a felhasználóhoz.`, 403);
  return null;
}

/** Account-active check only (for endpoints without a specific feature key, e.g. km-search page_memory can use assertEntitled). */
export async function assertActive(sb: any): Promise<Response | null> {
  const { data: active, error } = await sb.rpc('is_active');
  if (error || active !== true) return deny('A fiók nem aktív (jóváhagyásra vár vagy felfüggesztve).', 403);
  return null;
}

/** The model the fn MUST use for the caller — allowlist-honoring, never an env default. */
export async function resolveModel(sb: any): Promise<string> {
  const { data } = await sb.rpc('effective_model');
  return (typeof data === 'string' && data) ? data : CHEAPEST;
}

/** For fns that intentionally pin a tier: keep it only if the caller may use it, else downgrade to their effective model. */
export async function clampModel(sb: any, preferred: string): Promise<string> {
  const { data: ok } = await sb.rpc('model_allowed', { p_model: preferred });
  return ok === true ? preferred : await resolveModel(sb);
}
