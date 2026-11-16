/**
 * signinsModel — the /signins menu's choice logic (vault T4), pure so it is tested without Ink. The component only renders and calls the
 * core library (sessionBrowserSecrets.ts) with the effect this returns.
 *
 * Keys in the list: ↑↓ move · a = always (standing grant; a scheduled task may load it with nobody asked) · s = this session only ·
 * c = clear grant · d = delete the saved sign-in (asks y/n) · i = import from a browser (profile → tick sites with space → Enter;
 * sensitive sites start unticked, ticking one is the acknowledgement) · Esc close/back.
 * Site picker (operator 11-15 real-Mac test: hundreds of cookie sites, x.com took "a couple hundred" ↓ presses and the highlight scrolled
 * out of view): typing letters/digits/./- FILTERS the list (Backspace deletes, Esc clears the filter, a second Esc goes back); Ctrl+A
 * ticks every LISTED non-sensitive site (again = untick them) — sensitive sites still need their own Space tick; the component draws a
 * window around the highlight (visibleWindow). Values are never shown (vault rule) — there is no reveal.
 */
export type SigninGrant = 'none' | 'session' | 'always';
export interface SigninRow { site: string; cookieCount: number; importedAt: number; expiresAt?: number; expired: boolean; grant: SigninGrant; expiringSoon?: boolean; refreshedAt?: number }
export type SigninsMode =
  | { k: 'list' }
  | { k: 'confirm-delete'; site: string }
  /** import step 1: choose a browser profile (rows = SigninsImportData.profiles) */
  | { k: 'import-profile'; psel: number }
  /** import step 2: tick sites in that profile (rows = SigninsImportData.sites); sensitive sites start unticked */
  | { k: 'import-sites'; profile: number; ssel: number; ticked: string[]; q?: string };
/** What the import steps need to show: profile labels, then the chosen profile's sites (names + counts only — nothing decrypted). */
export interface SigninsImportData { profiles?: readonly { label: string }[]; sites?: readonly { site: string; cookies: number; sensitive: boolean }[] }
export interface SigninsState { mode: SigninsMode; sel: number }
export type SigninsEffect =
  | { kind: 'grant'; site: string; scope: SigninGrant }
  | { kind: 'delete'; site: string }
  | { kind: 'close' }
  /** find the browser profiles on this machine (the component loads them into SigninsImportData.profiles) */
  | { kind: 'load-profiles' }
  /** list a profile's sites — names and counts only */
  | { kind: 'load-sites'; profile: number }
  /** import the ticked sites; allowSensitive is true only when the person ticked a sensitive one (the tick is the acknowledgement) */
  | { kind: 'import'; profile: number; sites: string[]; allowSensitive: boolean }
  | { kind: 'none' };
export interface SigninsKey { ch: string; up?: boolean; down?: boolean; escape?: boolean; enter?: boolean; ctrl?: boolean; backspace?: boolean }
type SiteItem = { site: string; cookies: number; sensitive: boolean };
/** The sites the picker shows for a filter: case-insensitive substring of the site name, original order kept. */
export function filterSites<T extends SiteItem>(sites: readonly T[], q = ''): T[] {
  const f = q.trim().toLowerCase();
  return f ? sites.filter((x) => x.site.toLowerCase().includes(f)) : [...sites];
}
/** Rows to draw for a list of `total` with the highlight at `sel`: at most `size`, the highlight always inside, scrolling with it. */
export function visibleWindow(total: number, sel: number, size: number): { start: number; end: number } {
  const n = Math.max(1, size);
  if (total <= n) return { start: 0, end: total };
  const s = Math.min(Math.max(0, sel - Math.floor(n / 2)), total - n);
  return { start: s, end: s + n };
}
const FILTER_CH = /^[a-z0-9.\-_]$/i;

export const initialSigninsState = (): SigninsState => ({ mode: { k: 'list' }, sel: 0 });

/** One key → the next state + what the component must do. A row the key needs but the list lacks yields no effect. */
export function signinsReduce(state: SigninsState, key: SigninsKey, rows: readonly SigninRow[], data: SigninsImportData = {}): { state: SigninsState; effect: SigninsEffect } {
  const none: SigninsEffect = { kind: 'none' };
  const back = { state: { ...state, mode: { k: 'list' } as SigninsMode }, effect: none };
  const m = state.mode;
  if (m.k === 'import-profile') {
    if (key.escape) return back;
    const n = data.profiles?.length ?? 0;
    const psel = Math.min(m.psel, Math.max(0, n - 1));
    if (key.up) return { state: { ...state, mode: { ...m, psel: Math.max(0, psel - 1) } }, effect: none };
    if (key.down) return { state: { ...state, mode: { ...m, psel: Math.min(Math.max(0, n - 1), psel + 1) } }, effect: none };
    if (key.enter && n > 0) return { state: { ...state, mode: { k: 'import-sites', profile: psel, ssel: 0, ticked: [] } }, effect: { kind: 'load-sites', profile: psel } };
    return { state, effect: none };
  }
  if (m.k === 'import-sites') {
    const q = m.q ?? '';
    if (key.escape) return q ? { state: { ...state, mode: { ...m, q: '', ssel: 0 } }, effect: none } : back;
    const all = data.sites ?? [];
    const sites = filterSites(all, q);
    const n = sites.length;
    const ssel = Math.min(m.ssel, Math.max(0, n - 1));
    if (key.up) return { state: { ...state, mode: { ...m, ssel: Math.max(0, ssel - 1) } }, effect: none };
    if (key.down) return { state: { ...state, mode: { ...m, ssel: Math.min(Math.max(0, n - 1), ssel + 1) } }, effect: none };
    if (key.backspace) return { state: { ...state, mode: { ...m, q: q.slice(0, -1), ssel: 0 } }, effect: none };
    if (key.ctrl && key.ch.toLowerCase() === 'a') {
      // select all = the LISTED non-sensitive sites; again = untick them. Sensitive sites keep their own explicit tick (the acknowledgement).
      const pick = sites.filter((x) => !x.sensitive).map((x) => x.site);
      const allOn = pick.length > 0 && pick.every((x) => m.ticked.includes(x));
      const ticked = allOn ? m.ticked.filter((x) => !pick.includes(x)) : [...m.ticked, ...pick.filter((x) => !m.ticked.includes(x))];
      return { state: { ...state, mode: { ...m, ssel, ticked } }, effect: none };
    }
    if (key.ch === ' ' && sites[ssel]) {
      const s = sites[ssel]!.site;
      const ticked = m.ticked.includes(s) ? m.ticked.filter((x) => x !== s) : [...m.ticked, s];
      return { state: { ...state, mode: { ...m, ssel, ticked } }, effect: none };
    }
    if (key.enter && m.ticked.length) {
      const allowSensitive = all.some((x) => x.sensitive && m.ticked.includes(x.site));
      return { state: { ...state, mode: { k: 'list' } }, effect: { kind: 'import', profile: m.profile, sites: [...m.ticked], allowSensitive } };
    }
    if (!key.ctrl && key.ch && key.ch.length === 1 && FILTER_CH.test(key.ch)) return { state: { ...state, mode: { ...m, q: q + key.ch.toLowerCase(), ssel: 0 } }, effect: none };
    return { state: { ...state, mode: { ...m, ssel } }, effect: none };
  }
  if (state.mode.k === 'confirm-delete') {
    const site = state.mode.site;
    return { state: { ...state, mode: { k: 'list' } }, effect: key.ch === 'y' ? { kind: 'delete', site } : none };
  }
  if (key.escape) return { state, effect: { kind: 'close' } };
  const n = rows.length;
  const sel = Math.min(state.sel, Math.max(0, n - 1));
  if (key.up) return { state: { ...state, sel: Math.max(0, sel - 1) }, effect: none };
  if (key.down) return { state: { ...state, sel: Math.min(Math.max(0, n - 1), sel + 1) }, effect: none };
  if (key.ch === 'i') return { state: { ...state, sel, mode: { k: 'import-profile', psel: 0 } }, effect: { kind: 'load-profiles' } };
  const row = rows[sel];
  if (!row) return { state: { ...state, sel }, effect: none };
  switch (key.ch) {
    case 'a': return { state: { ...state, sel }, effect: { kind: 'grant', site: row.site, scope: 'always' } };
    case 's': return { state: { ...state, sel }, effect: { kind: 'grant', site: row.site, scope: 'session' } };
    case 'c': return { state: { ...state, sel }, effect: { kind: 'grant', site: row.site, scope: 'none' } };
    case 'd': return { state: { mode: { k: 'confirm-delete', site: row.site }, sel }, effect: none };
    default: return { state: { ...state, sel }, effect: none };
  }
}

/** The grant column, in words a person reads. */
export function grantLabel(g: SigninGrant): string {
  return g === 'always' ? 'always (scheduled tasks too)' : g === 'session' ? 'this session' : 'asks each time';
}
