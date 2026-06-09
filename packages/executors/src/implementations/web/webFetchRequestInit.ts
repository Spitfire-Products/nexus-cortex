/**
 * WebFetch reliability: the local-fetch fallback was issued with NO request
 * headers, so Node's default User-Agent got 403/blocked by virtually every
 * real site behind a CDN/WAF (county records, gov, news) — the dominant
 * cause of the observed ~1/20 success rate. A browser-like header set makes
 * most "blocked" pages return real HTML.
 */
export function buildBrowserFetchInit(signal: AbortSignal): RequestInit {
  return {
    signal,
    redirect: 'follow',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,' +
        'image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  };
}
