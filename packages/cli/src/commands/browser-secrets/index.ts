/**
 * `cortex browser-secrets` (vault task T3) — a thin printer over the core library in
 * packages/core/src/config/sessionBrowserSecrets.ts. All the logic (and all the tests) live there; this file only formats.
 *
 * Nothing here can print a cookie value: the library never returns one. `session` grants live in the AGENT PROCESS's memory, so
 * from this CLI process a grant is always 'none' or 'always'.
 */
export interface BrowserSecretsCliOptions {
  json?: boolean; session?: boolean; browser?: string; sensitive?: boolean;
  /** test seam: is a person at this terminal? default: stdin AND stdout are TTYs */
  isTTY?: boolean;
}

const pad = (s: string, n: number): string => (s.length >= n ? s : s + ' '.repeat(n - s.length));
const when = (ms: number): string => new Date(ms).toISOString();

export async function runBrowserSecrets(
  action: string,
  args: string[],
  options: BrowserSecretsCliOptions = {},
): Promise<number> {
  const { listBrowserSecrets, revokeBrowserSecret, grantBrowserSecret } = await import('@nexus-cortex/core');

  if (action === 'list') {
    const rows = listBrowserSecrets();
    if (options.json) { console.log(JSON.stringify(rows, null, 2)); return 0; }
    if (!rows.length) { console.log('No browser sessions are saved.'); return 0; }
    console.log(`${pad('SITE', 28)} ${pad('COOKIES', 8)} ${pad('IMPORTED', 24)} GRANT`);
    for (const r of rows) {
      // early warning (11-16): EXPIRED / expires <date> within 14 days; refreshed = last write-back of the browser's refreshed cookies
      const flag = r.expired ? '  EXPIRED — re-import' : r.expiringSoon && r.expiresAt ? `  expires ${new Date(r.expiresAt * 1000).toISOString().slice(0, 10)} — re-import soon` : '';
      const fresh = r.refreshedAt ? `  refreshed ${when(r.refreshedAt)}` : '';
      console.log(`${pad(r.site, 28)} ${pad(String(r.cookieCount), 8)} ${pad(when(r.importedAt), 24)} ${r.grant}${flag}${fresh}`);
    }
    console.log('\nValues are never shown. `session` grants live in the agent process, so they read as none/always here.');
    return 0;
  }

  if (action === 'revoke') {
    const site = args[0];
    if (!site) { console.error('usage: cortex browser-secrets revoke <site>'); return 2; }
    const res = await revokeBrowserSecret(site);
    if (options.json) { console.log(JSON.stringify(res, null, 2)); return 0; }
    console.log(`${res.site}: session ${res.revoked ? 'removed' : 'was not stored'}; standing grant ${res.grantCleared ? 'cleared' : 'was not set'}.`);
    return 0;
  }

  if (action === 'import') {
    // A person at the keyboard only: an agent running this through its shell would read the user's browsing list and choose what to
    // import. (On macOS the Keychain's own Allow dialog for "<Browser> Safe Storage" is the second consent step, at the decrypt.)
    const tty = options.isTTY ?? (!!process.stdin.isTTY && !!process.stdout.isTTY);
    if (!tty) { console.error('cortex browser-secrets import runs only at a terminal (a person picks the sites) — it is refused from scripts and agents'); return 2; }
    const { findChromeProfiles, pickChromeProfile, listImportableSites, importChromeSites } = await import('@nexus-cortex/core');
    let profile;
    try { profile = pickChromeProfile(findChromeProfiles(), options.browser ?? 'chrome'); }
    catch (e) {
      console.error((e as Error).message);
      const all = findChromeProfiles();
      if (all.length) console.error(`profiles here: ${all.map((p) => `${p.browser}:${p.profile} (${p.name})`).join(', ')}`);
      return 1;
    }
    const sites = args.filter((a) => !a.startsWith('--'));
    if (!sites.length) {
      const rows = await listImportableSites(profile);
      if (options.json) { console.log(JSON.stringify({ profile: profile.source, sites: rows }, null, 2)); return 0; }
      console.log(`${profile.browserLabel} — ${profile.name} (${profile.source}): ${rows.length} site(s) with saved cookies. Names only; nothing is decrypted.`);
      for (const r of rows) console.log(`  ${pad(r.site, 40)} ${pad(String(r.cookies), 5)}${r.sensitive ? '  sensitive — needs --sensitive' : ''}`);
      console.log(`\nImport the ones you want: cortex browser-secrets import --browser ${profile.source} <site> [<site> ...]`);
      return 0;
    }
    try {
      const r = await importChromeSites(profile, sites, { allowSensitive: !!options.sensitive });
      if (options.json) { console.log(JSON.stringify(r, null, 2)); return r.imported.length ? 0 : 1; }
      for (const i of r.imported) console.log(`${i.site}: ${i.cookies} cookie(s) saved from ${r.profile}${i.skipped ? `, ${i.skipped} skipped (could not be decrypted or restored exactly)` : ''}.`);
      for (const x of r.refused) console.log(`${x.site}: not imported — ${x.reason}.`);
      if (r.imported.length) console.log('\nThe agent asks before using one (or `cortex browser-secrets grant <site>` for scheduled tasks). Values are never shown.');
      return r.imported.length ? 0 : 1;
    } catch (e) { console.error((e as Error).message); return 1; }
  }

  if (action === 'grant' || action === 'clear') {
    // vault T4: a person at the keyboard grants a site ahead of a scheduled task ('always' — the floor then loads it with nobody asked),
    // or clears it. 'this session' lives in the AGENT process, so a separate CLI process cannot make one — use /signins in the TUI.
    const site = args[0];
    if (!site) { console.error(`usage: cortex browser-secrets ${action} <site>`); return 2; }
    if (options.session || args.includes('--session')) { console.error('a "this session" grant lives in the running agent — use /signins in the TUI'); return 2; }
    try {
      const r = grantBrowserSecret(site, action === 'grant' ? 'always' : 'none');
      if (options.json) { console.log(JSON.stringify(r, null, 2)); return 0; }
      console.log(action === 'grant' ? `${r.site}: always — scheduled and auto-approved tasks may load this sign-in without asking.` : `${r.site}: grant cleared — the next use asks.`);
      return 0;
    } catch (e) { console.error((e as Error).message); return 1; }
  }

  console.error('usage: cortex browser-secrets list [--json] | import [--browser <b[:profile]>] [site...] [--sensitive] | grant <site> | clear <site> | revoke <site>');
  return 2;
}
