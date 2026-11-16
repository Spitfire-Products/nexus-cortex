import { describe, it, expect } from 'vitest';
import { initialSigninsState, signinsReduce, grantLabel, type SigninRow } from './signinsModel.js';

const rows: SigninRow[] = [
  { site: 'example.org', cookieCount: 2, importedAt: 1, expired: false, grant: 'none' },
  { site: 'github.com', cookieCount: 5, importedAt: 2, expired: false, grant: 'always' },
];
describe('signinsModel (vault T4 /signins)', () => {
  it('moves within bounds', () => {
    let s = initialSigninsState();
    s = signinsReduce(s, { ch: '', up: true }, rows).state; expect(s.sel).toBe(0);
    s = signinsReduce(s, { ch: '', down: true }, rows).state; expect(s.sel).toBe(1);
    s = signinsReduce(s, { ch: '', down: true }, rows).state; expect(s.sel).toBe(1);
  });
  it('a / s / c grant on the SELECTED row', () => {
    const s = { ...initialSigninsState(), sel: 1 };
    expect(signinsReduce(s, { ch: 'a' }, rows).effect).toEqual({ kind: 'grant', site: 'github.com', scope: 'always' });
    expect(signinsReduce(s, { ch: 's' }, rows).effect).toEqual({ kind: 'grant', site: 'github.com', scope: 'session' });
    expect(signinsReduce(s, { ch: 'c' }, rows).effect).toEqual({ kind: 'grant', site: 'github.com', scope: 'none' });
  });
  it('d asks first; only y deletes; any other key cancels', () => {
    const s1 = signinsReduce(initialSigninsState(), { ch: 'd' }, rows);
    expect(s1.effect.kind).toBe('none'); expect(s1.state.mode).toEqual({ k: 'confirm-delete', site: 'example.org' });
    expect(signinsReduce(s1.state, { ch: 'n' }, rows).effect.kind).toBe('none');
    expect(signinsReduce(s1.state, { ch: 'y' }, rows).effect).toEqual({ kind: 'delete', site: 'example.org' });
    expect(signinsReduce(s1.state, { ch: '', escape: true }, rows).state.mode.k).toBe('list');
  });
  it('Esc closes from the list; an empty list does nothing but close', () => {
    expect(signinsReduce(initialSigninsState(), { ch: '', escape: true }, rows).effect).toEqual({ kind: 'close' });
    expect(signinsReduce(initialSigninsState(), { ch: 'a' }, []).effect.kind).toBe('none');
  });
  it('a selection past a shrunken list is clamped (after a delete)', () => {
    const r = signinsReduce({ mode: { k: 'list' }, sel: 5 }, { ch: 'a' }, rows);
    expect(r.state.sel).toBe(1); expect(r.effect).toEqual({ kind: 'grant', site: 'github.com', scope: 'always' });
  });
  it('labels', () => { expect(grantLabel('always')).toMatch(/scheduled/); expect(grantLabel('none')).toBe('asks each time'); });
});

describe('signinsModel import flow (i → profile → tick sites → Enter)', () => {
  const data = {
    profiles: [{ label: 'Google Chrome — Person 1' }, { label: 'Brave — Default' }],
    sites: [{ site: 'chase.com', cookies: 3, sensitive: true }, { site: 'github.com', cookies: 5, sensitive: false }],
  };
  it('i opens the profile step (works with an empty list) and asks for the profiles', () => {
    const r = signinsReduce(initialSigninsState(), { ch: 'i' }, []);
    expect(r.effect).toEqual({ kind: 'load-profiles' });
    expect(r.state.mode).toEqual({ k: 'import-profile', psel: 0 });
  });
  it('profile step: moves in bounds, Enter loads that profile\'s sites, Esc goes back to the list', () => {
    let s = signinsReduce(initialSigninsState(), { ch: 'i' }, rows).state;
    s = signinsReduce(s, { ch: '', down: true }, rows, data).state;
    s = signinsReduce(s, { ch: '', down: true }, rows, data).state;
    expect(s.mode).toEqual({ k: 'import-profile', psel: 1 });
    const e = signinsReduce(s, { ch: '', enter: true }, rows, data);
    expect(e.effect).toEqual({ kind: 'load-sites', profile: 1 });
    expect(e.state.mode).toEqual({ k: 'import-sites', profile: 1, ssel: 0, ticked: [] });
    expect(signinsReduce(s, { ch: '', escape: true }, rows, data).state.mode.k).toBe('list');
    expect(signinsReduce({ ...s, mode: { k: 'import-profile', psel: 0 } }, { ch: '', enter: true }, rows, {}).effect.kind).toBe('none');   // no profiles
  });
  it('sites step: nothing is ticked at first (sensitive included); Enter with none ticked does nothing', () => {
    const s = { ...initialSigninsState(), mode: { k: 'import-sites' as const, profile: 0, ssel: 0, ticked: [] } };
    expect(signinsReduce(s, { ch: '', enter: true }, rows, data).effect.kind).toBe('none');
  });
  it('space toggles; Enter imports exactly the ticked sites; allowSensitive only when a sensitive one was ticked', () => {
    let s: any = { ...initialSigninsState(), mode: { k: 'import-sites', profile: 0, ssel: 0, ticked: [] } };
    s = signinsReduce(s, { ch: '', down: true }, rows, data).state;          // github.com
    s = signinsReduce(s, { ch: ' ' }, rows, data).state;
    expect(signinsReduce(s, { ch: '', enter: true }, rows, data).effect).toEqual({ kind: 'import', profile: 0, sites: ['github.com'], allowSensitive: false });
    s = signinsReduce(s, { ch: '', up: true }, rows, data).state;            // chase.com
    s = signinsReduce(s, { ch: ' ' }, rows, data).state;
    const r = signinsReduce(s, { ch: '', enter: true }, rows, data);
    expect(r.effect).toEqual({ kind: 'import', profile: 0, sites: ['github.com', 'chase.com'], allowSensitive: true });
    expect(r.state.mode.k).toBe('list');
    s = signinsReduce(s, { ch: ' ' }, rows, data).state;                     // untick chase
    expect(signinsReduce(s, { ch: '', enter: true }, rows, data).effect).toMatchObject({ sites: ['github.com'], allowSensitive: false });
  });
});

// ── site picker: filter, select all, window (operator 11-15 real-Mac test: hundreds of sites, the highlight scrolled out of view) ──
import { filterSites, visibleWindow } from './signinsModel.js';
describe('signins site picker', () => {
  const sites = [
    { site: 'chase.com', cookies: 3, sensitive: true },
    { site: 'github.com', cookies: 5, sensitive: false },
    { site: 'x.com', cookies: 15, sensitive: false },
    { site: 'xkcd.com', cookies: 1, sensitive: false },
  ];
  const at = () => ({ ...initialSigninsState(), mode: { k: 'import-sites' as const, profile: 0, ssel: 0, ticked: [] as string[] } });
  const step = (s: ReturnType<typeof at>, ...keys: Array<Parameters<typeof signinsReduce>[1]>) =>
    keys.reduce((st, k) => signinsReduce(st as any, k, [], { sites }).state as any, s);

  it('typing filters (case-insensitive substring), Backspace deletes, Esc clears then goes back', () => {
    let s = step(at(), { ch: 'X' }, { ch: '.' });
    expect((s.mode as any).q).toBe('x.');
    expect(filterSites(sites, (s.mode as any).q).map((x) => x.site)).toEqual(['x.com']);
    s = step(s, { ch: '', backspace: true }); expect((s.mode as any).q).toBe('x');
    expect(filterSites(sites, 'x').map((x) => x.site)).toEqual(['x.com', 'xkcd.com']);
    s = step(s, { ch: '', escape: true }); expect(s.mode.k).toBe('import-sites'); expect((s.mode as any).q).toBe('');
    s = step(s, { ch: '', escape: true }); expect(s.mode.k).toBe('list');
  });
  it('Space ticks the highlighted FILTERED row; Enter imports every ticked site, filtered or not', () => {
    let s = step(at(), { ch: 'g' }, { ch: ' ' }, { ch: '', backspace: true }, { ch: 'x' }, { ch: '.' }, { ch: ' ' });
    expect((s.mode as any).ticked).toEqual(['github.com', 'x.com']);
    const r = signinsReduce(s as any, { ch: '', enter: true }, [], { sites });
    expect(r.effect).toEqual({ kind: 'import', profile: 0, sites: ['github.com', 'x.com'], allowSensitive: false });
  });
  it('Ctrl+A ticks every LISTED non-sensitive site; again unticks them; sensitive needs its own tick', () => {
    let s = step(at(), { ch: 'a', ctrl: true });
    expect((s.mode as any).ticked.sort()).toEqual(['github.com', 'x.com', 'xkcd.com']);
    s = step(s, { ch: 'a', ctrl: true }); expect((s.mode as any).ticked).toEqual([]);
    s = step(s, { ch: 'x' }, { ch: 'a', ctrl: true });      // filtered: only the x sites
    expect((s.mode as any).ticked.sort()).toEqual(['x.com', 'xkcd.com']);
    expect((s.mode as any).q).toBe('x');                     // Ctrl+A is not typed into the filter
    s = step(s, { ch: '', escape: true }, { ch: ' ' });      // chase.com (row 0) ticked explicitly
    const r = signinsReduce(s as any, { ch: '', enter: true }, [], { sites });
    expect(r.effect).toMatchObject({ kind: 'import', allowSensitive: true });
  });
  it('↑↓ stay inside the filtered list', () => {
    const s = step(at(), { ch: 'x' }, { ch: '', down: true }, { ch: '', down: true }, { ch: '', down: true });
    expect((s.mode as any).ssel).toBe(1);
  });
  it('visibleWindow keeps the highlight inside and scrolls with it', () => {
    expect(visibleWindow(5, 4, 10)).toEqual({ start: 0, end: 5 });
    expect(visibleWindow(300, 0, 15)).toEqual({ start: 0, end: 15 });
    expect(visibleWindow(300, 250, 15)).toEqual({ start: 243, end: 258 });
    expect(visibleWindow(300, 299, 15)).toEqual({ start: 285, end: 300 });
    for (const sel of [0, 7, 8, 150, 292, 299]) { const w = visibleWindow(300, sel, 15); expect(sel >= w.start && sel < w.end).toBe(true); expect(w.end - w.start).toBe(15); }
  });
});
