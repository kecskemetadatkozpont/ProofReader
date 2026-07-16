// Per-project language for AI-generated content (migration-65: research_projects.language = 'en' | 'hu').
// Append langDirective(lang) to the system prompt of USER-FACING generation so the output matches the project
// language the user chose. The user may still request the other language ad hoc for a specific item.
//
// IMPORTANT: do NOT apply this to prompts that generate OpenAlex/academic SEARCH KEYWORDS — those must stay English
// for retrieval regardless of the project language (the keyword prompts already say "English").

export function normLang(l: any): 'en' | 'hu' {
  return String(l || 'en').toLowerCase() === 'hu' ? 'hu' : 'en';
}

export function langDirective(lang: any): string {
  return normLang(lang) === 'hu'
    ? '\n\nOUTPUT LANGUAGE: Write ALL user-facing prose — questions, summaries, reasons, criteria descriptions, section text, titles, explanations — in HUNGARIAN (magyar), natural and fluent. Keep code, identifiers, DOIs and required academic search keywords in English. If the user explicitly asks for another language for a specific item, honor that request.'
    : '\n\nOUTPUT LANGUAGE: Write all user-facing prose in ENGLISH.';
}

// Load a project's language ('en'|'hu'); degrades to 'en' if the column/row is absent (pre-migration safe).
export async function loadProjectLang(sb: any, projectId: string): Promise<'en' | 'hu'> {
  if (!projectId) return 'en';
  try {
    const { data } = await sb.from('research_projects').select('language').eq('id', projectId).maybeSingle();
    return normLang(data && (data as any).language);
  } catch (_e) { return 'en'; }
}
