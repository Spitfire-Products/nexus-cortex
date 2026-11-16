# Saved browser sign-ins (`cortex browser-secrets`, `/signins`)

The agent's browser starts with an empty profile, so it is signed in nowhere. Saved sign-ins let you give it **your** session for one site at
a time: you import the site's cookies from a browser you already use, they are stored encrypted, and the agent's browser gets them only after
you approve. The model never sees a cookie value: tools report counts only ("github.com session loaded (14 cookies)").

Saved sign-ins load into the **local** browser (`cortex browser use local`), on its default backend: the agent calls `load_session`
for a site after opening any page, then opens the site. The hosted browser and the sandbox backend cannot use them.

## Importing (at your terminal)

In a TUI: `/signins`, then `i` — choose the browser profile, tick sites with Space (sensitive ones start unticked; ticking one is the
acknowledgement), Enter imports the ticked sites. From the shell:

```bash
cortex browser-secrets import                                  # Chrome's Default profile: site names + cookie counts, nothing decrypted
cortex browser-secrets import --browser brave                  # chrome | brave | edge | arc | chromium, optionally :<profile>
cortex browser-secrets import --browser chrome:"Profile 1" github.com linear.app
cortex browser-secrets import chase.com --sensitive            # sensitive sites need the extra flag
```

- **Names first.** Without site names the command only lists the sites the profile holds cookies for. Listing needs no key and decrypts
  nothing. There is no import-everything.
- **Sensitive sites** (banking, payments, email and identity providers, government, health, password managers) are marked in the list and
  imported only with `--sensitive`.
- **Terminal only.** The command refuses to run without a terminal, so an agent's shell cannot import on your behalf.
- **Consent at the decrypt.** On macOS the browser's cookie key is in your Keychain ("Chrome Safe Storage", "Brave Safe Storage", …); macOS
  shows its own Allow dialog the first time. On Linux the key is the browser's built-in one or your desktop keyring (`secret-tool`).
- The browser's cookie file is copied to a private temp folder first (the browser keeps it locked while running) and the copy is deleted
  afterwards. Values go straight into the vault; nothing is printed.
- Supported: Google Chrome, Brave, Microsoft Edge, Arc, Chromium on macOS and Linux (Node 22.13 or newer). Windows, Firefox and Safari are
  not supported yet.

Each import replaces the site's previous entry and makes every earlier approval for that site stale, so the next use asks again.

## Where it is stored

`~/.cortex/session-vault.enc` (owner-only), encrypted the same way as [secrets](secrets.md) and unlocked the same way: `CORTEX_SECRETS_KEY`,
`CORTEX_SECRETS_KEY_FILE`, the OS keychain, or `~/.cortex/vault.key`. The same master derives a different key here, so a key that opens
`secrets.enc` cannot open the sign-in vault. Site names, sources, times and cookie counts are readable without the key; values are not.
Every release is logged to `~/.cortex/session-vault-release.jsonl` (site, mode, time; never a value).

## Approving a release

When the agent wants a saved sign-in, you are asked:
`Use your saved github.com session for this task? (once / this session / always for this site / no)`

| answer | effect |
|---|---|
| once | this call only |
| this session | this agent session only; never written to disk |
| always | a standing grant for this site, saved in `~/.cortex/session-vault-grants.json` and tied to the current import |
| no | nothing loads |

**Nobody there to ask** (auto-approve, a scheduled job run by the ticker, a headless run, YOLO): a site loads only if it has an **always**
grant; otherwise the request is refused at once. Grant a site ahead of a scheduled task with `cortex browser-secrets grant <site>`.

### How your answer reaches the browser

The local browser is a separate process, and it cannot ask you anything. When you approve a use, the harness writes a single-use
**release ticket** for that one call: an owner-only file in `~/.cortex/session-tickets/` naming the site, the import it is for, and your
answer. The ticket id travels with that one tool call, outside the tool's arguments, so the model never sees or sends one. The browser
deletes the ticket as it reads it and accepts it only for the same site and the same import, within 30 seconds. No cookie value is in a
ticket: the browser reads the vault itself. A `load_session` call with no valid ticket loads a site only when it has an **always** grant.

## Staying signed in: refresh and early warning

A saved sign-in starts as a copy of your browser's cookies at import time. Sites rotate their tokens as you use them, so the agent's
browser **writes the refreshed cookies back** to the vault: every 5 minutes while it runs and once more when it closes, only for the sites
it loaded in that run, and only cookies on that site or its subdomains. The import it came from stays the same, so an **always** grant
keeps working for scheduled tasks. A write-back never overwrites a newer import, and is logged as `refresh` (counts only).
`NEXUS_SESSION_WRITEBACK_MS` changes the interval. The agent's own `close_session` writes back first too. **A sign-out is never saved:** if any cookie the site was loaded with is gone from the browser (a site deletes its session cookies when it signs you out), the write-back is skipped and your saved sign-in stays as it was.

**Early warning.** When a site's latest cookie expiry is within 14 days, `/signins` and `cortex browser-secrets list` say
`expires <date> — re-import soon`, and an expired one says `EXPIRED — re-import`. A load of an expiring or expired site returns the
same warning to the agent, and it is noted once a day in `~/.cortex/session-vault-warnings.jsonl` (site, kind, date; never a value), so a
scheduled job's failure is never silent. Remember that a re-import needs a fresh grant for scheduled tasks.

## Managing them

In a TUI, `/signins` lists saved sites with their cookie count, import time, expiry and grant: `a` always, `s` this session, `c` clear the
grant, `d` delete the saved sign-in (asks to confirm), `i` import. From the shell:

```bash
cortex browser-secrets list [--json]      # metadata only
cortex browser-secrets grant <site>       # always
cortex browser-secrets clear <site>       # remove the grant; the next use asks
cortex browser-secrets revoke <site>      # delete the saved sign-in and its grant
```

## Limits

- Some sites tie a session to the device, the IP address or the browser (Google's device-bound sessions, banks, some single sign-on
  providers). An imported session may land on a sign-in page.
- Some sites check that a session comes from the same browser it was created in: X (x.com) did not accept an imported session in the agent's
  browser in our test (the values were correct; its Cloudflare and device checks are bound to your own Chrome).
- Sites that keep their login in local storage rather than cookies are not covered by a cookie import.
- Reading a browser's cookie store is also what credential-stealing malware does; endpoint security on a managed machine may flag the import.
- Passwords and passkeys are never imported.
