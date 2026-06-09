/**
 * In-band escalation directive appended to every WebFetch failure result.
 *
 * WebFetch routes through Gemini urlContext with a 10s plain-fetch fallback;
 * both fail on blocked / JS-heavy / dynamic pages (county record sites, etc.).
 * Weaker models then retry WebFetch in a loop instead of switching tools.
 * This tells the model — at the moment of failure, where it cannot be missed
 * — to stop retrying WebFetch and use the browser instead.
 */
export function browseEscalationDirective(url?: string): string {
  const target = url ? ` "${url}"` : ' the same URL';
  return (
    `<system-reminder>WebFetch could not retrieve${target} — the page is ` +
    `blocked, dynamic, or JS-rendered. Do NOT retry WebFetch on this URL; it ` +
    `will keep failing. Call the \`browse\` tool instead:\n` +
    ` browse({ task: "Navigate to${target} and extract the page content", url: ${url ? `"${url}"` : 'the URL'} })\n` +
    `The browse subagent renders JavaScript, handles CAPTCHAs/challenges ` +
    `(detect_challenge + solve_challenge), and returns the result. Do not ` +
    `attempt WebFetch again for this page.</system-reminder>`
  );
}
