/**
 * Signins Dialog — /signins in both TUIs (vault T4, operator 11-14: "shouldnt a user be able to manage grants, and session secrets there?").
 * The interactive face of the browser session vault (~/.cortex/session-vault.enc; core config/sessionBrowserSecrets.ts). Same look as
 * SecretsDialog. METADATA ONLY: site, cookie count, imported/expiry dates, grant — a cookie value is never shown (vault rule; there is no
 * reveal). All logic is the core library + the pure signinsModel; this file only renders. `cortex browser-secrets …` is the headless twin.
 */
import React, { useMemo, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { Colors } from '@nexus-cortex/cli/dist/themes/colors.js';
import { listBrowserSecrets, grantBrowserSecret, revokeBrowserSecret, findChromeProfiles, listImportableSites, importChromeSites, type ChromeProfile } from '@nexus-cortex/core';
import { initialSigninsState, signinsReduce, grantLabel, filterSites, visibleWindow, type SigninRow, type SigninsImportData } from '../signinsModel.js';

export interface SigninsDialogProps {
  onClose: () => void;
  /** A one-line, value-free notice for the transcript (e.g. "github.com: always"). */
  onNotice?: (text: string) => void;
  /** The running agent session — needed for a "this session" grant; without it `s` reports why and does nothing. */
  sessionId?: string;
}

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** Rows a list may draw: fits the terminal (the 11-15 picker drew hundreds and the highlight scrolled out of view). */
const listRows = () => Math.max(5, Math.min(18, (process.stdout.rows || 30) - 14));
const more = (n: number, dir: '↑' | '↓') => (n > 0 ? <Text dimColor>  {dir} {n} more</Text> : null);

export const SigninsDialog: React.FC<SigninsDialogProps> = ({ onClose, onNotice, sessionId }) => {
  const [state, setState] = useState(initialSigninsState());
  // Keys can arrive faster than Ink re-renders (a held ↓): reduce from the LATEST state, not the one captured at the last render —
  // otherwise every key between two renders starts from the same stale state and only one move lands (operator 11-15: hundreds of ↓).
  const stateRef = useRef(state);
  const [tick, setTick] = useState(0);
  const [msg, setMsg] = useState('');
  const { rows, loadError } = useMemo((): { rows: SigninRow[]; loadError?: string } => {
    try { return { rows: listBrowserSecrets(sessionId ? { sessionId } : {}) }; } catch (e) { return { rows: [], loadError: (e as Error).message }; }
  }, [tick, sessionId]);
  const note = (t: string) => { setMsg(t); onNotice?.(t); };
  // import (i): profiles on this machine, then the chosen profile's sites — names and counts only; the decrypt happens in importChromeSites
  const [profiles, setProfiles] = useState<ChromeProfile[]>([]);
  const [sites, setSites] = useState<NonNullable<SigninsImportData['sites']>>([]);
  const [busy, setBusy] = useState('');
  const data: SigninsImportData = { profiles: profiles.map((p) => ({ label: `${p.browserLabel} — ${p.name} (${p.source})` })), sites };
  // Ink may call the key handler registered by an EARLIER render (keys right after a site list loads): read the latest values from refs,
  // or a ↓ sees the old empty list, clamps to row 0, and Space ticks the wrong site (11-15, flaky under a 300-site profile).
  const live = useRef({ data, rows, profiles, busy, sessionId });
  live.current = { data, rows, profiles, busy, sessionId };

  useInput((ch, key) => {
    const { data, rows, profiles, busy, sessionId } = live.current;
    if (busy) return;   // a site list or an import is running
    const { state: next, effect } = signinsReduce(stateRef.current, { ch, up: key.upArrow, down: key.downArrow, escape: key.escape, enter: key.return, ctrl: key.ctrl, backspace: key.backspace || key.delete }, rows, data);
    stateRef.current = next;
    setState(next);
    try {
      if (effect.kind === 'close') onClose();
      else if (effect.kind === 'load-profiles') {
        setSites([]);
        const found = findChromeProfiles();
        setProfiles(found);
        setMsg(found.length ? '' : 'No Chrome, Brave, Edge, Arc or Chromium profile was found on this machine.');
      }
      else if (effect.kind === 'load-sites') {
        const prof = profiles[effect.profile]; if (!prof) return;
        setBusy('reading the site list…');
        void listImportableSites(prof).then((l) => { setSites(l); setMsg(l.length ? '' : 'That profile has no saved cookies.'); })
          .catch((e) => setMsg(`error: ${(e as Error).message}`)).finally(() => setBusy(''));
      }
      else if (effect.kind === 'import') {
        const prof = profiles[effect.profile]; if (!prof) return;
        setBusy(process.platform === 'darwin' ? 'importing… macOS may ask to allow access to the browser\'s Safe Storage key' : 'importing…');
        void importChromeSites(prof, effect.sites, { allowSensitive: effect.allowSensitive })
          .then((r) => {
            const parts = [...r.imported.map((i) => `${i.site}: ${i.cookies} saved${i.skipped ? ` (${i.skipped} skipped)` : ''}`), ...r.refused.map((x) => `${x.site}: not imported — ${x.reason}`)];
            note(parts.join(' · ') || 'nothing imported'); setTick((t) => t + 1);
          })
          .catch((e) => setMsg(`error: ${(e as Error).message}`)).finally(() => setBusy(''));
      }
      else if (effect.kind === 'grant') { const r = grantBrowserSecret(effect.site, effect.scope, sessionId ? { sessionId } : {}); note(`${r.site}: ${grantLabel(r.grant)}`); setTick((t) => t + 1); }
      else if (effect.kind === 'delete') { void revokeBrowserSecret(effect.site).then((r) => { note(`${r.site}: saved sign-in ${r.revoked ? 'deleted' : 'was not stored'}`); setTick((t) => t + 1); }); }
    } catch (e) { setMsg(`error: ${(e as Error).message}`); }
  });

  const sel = Math.min(state.sel, Math.max(0, rows.length - 1));
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={Colors.AccentBlue} paddingX={1}>
      <Text bold color={Colors.AccentBlue}>Saved browser sign-ins</Text>
      <Text dimColor>Metadata only — cookie values are never shown. "always" lets a scheduled task use the sign-in with nobody asked.</Text>
      {state.mode.k === 'import-profile' ? (
        <Box marginTop={1} flexDirection="column">
          <Text bold>Import from which browser profile?</Text>
          {data.profiles!.map((p, i) => (
            <Text key={p.label} color={i === (state.mode as { psel: number }).psel ? Colors.AccentCyan : undefined}>{i === (state.mode as { psel: number }).psel ? '❯ ' : '  '}{p.label}</Text>
          ))}
        </Box>
      ) : state.mode.k === 'import-sites' ? ((() => {
        const m = state.mode as { ssel: number; ticked: string[]; q?: string };
        const shown = filterSites(sites, m.q ?? '');
        const ssel = Math.min(m.ssel, Math.max(0, shown.length - 1));
        const w = visibleWindow(shown.length, ssel, listRows());
        return (
          <Box marginTop={1} flexDirection="column">
            <Text bold>Tick the sites to import (names only so far — nothing is decrypted until you press Enter)</Text>
            <Text>filter: <Text color={Colors.AccentCyan}>{m.q || ''}</Text><Text dimColor>{m.q ? '' : 'type to narrow'}  ·  {shown.length} of {sites.length} sites  ·  {m.ticked.length} ticked</Text></Text>
            {more(w.start, '↑')}
            {shown.slice(w.start, w.end).map((x, j) => {
              const i = w.start + j;
              return (
                <Text key={x.site} color={i === ssel ? Colors.AccentCyan : undefined}>
                  {i === ssel ? '❯ ' : '  '}[{m.ticked.includes(x.site) ? 'x' : ' '}] {x.site.padEnd(36)} {String(x.cookies).padStart(4)} cookies
                  {x.sensitive ? <Text color={Colors.AccentYellow}>  sensitive (banking/email/identity/gov/health/payments)</Text> : null}
                </Text>
              );
            })}
            {more(shown.length - w.end, '↓')}
            {shown.length === 0 && sites.length > 0 ? <Text dimColor>  no site matches "{m.q}"</Text> : null}
          </Box>
        );
      })()
      ) : rows.length === 0 ? (
        <Box marginTop={1}><Text dimColor>No saved sign-ins yet. Press i to import one from your browser.</Text></Box>
      ) : (
        (() => { const w = visibleWindow(rows.length, sel, listRows()); return (
        <Box marginTop={1} flexDirection="column">
          {more(w.start, '↑')}
          {rows.slice(w.start, w.end).map((r, j) => { const i = w.start + j; return (
            <Text key={r.site} color={i === sel ? Colors.AccentCyan : undefined}>
              {i === sel ? '❯ ' : '  '}{r.site.padEnd(28)} {String(r.cookieCount).padStart(3)} cookies  imported {day(r.importedAt)}
              {r.expired ? <Text color={Colors.AccentRed}>  EXPIRED — re-import</Text> : r.expiringSoon && r.expiresAt ? <Text color={Colors.AccentYellow}>  expires {day(r.expiresAt * 1000)} — re-import soon</Text> : null}
              {r.refreshedAt ? <Text dimColor>  refreshed {day(r.refreshedAt)}</Text> : null}
              <Text color={r.grant === 'none' ? undefined : Colors.AccentGreen}>  {grantLabel(r.grant)}</Text>
            </Text>
          ); })}
          {more(rows.length - w.end, '↓')}
        </Box>
        ); })()
      )}
      {state.mode.k === 'confirm-delete' && <Box marginTop={1}><Text color={Colors.AccentRed}>Delete the saved sign-in for {state.mode.site}? </Text><Text>y = yes, any other key = no</Text></Box>}
      {loadError && <Box marginTop={1}><Text color={Colors.AccentRed}>error: {loadError}</Text></Box>}
      {busy !== '' && <Box marginTop={1}><Text color={Colors.AccentYellow}>{busy}</Text></Box>}
      {msg !== '' && <Box marginTop={1}><Text dimColor>{msg}</Text></Box>}
      <Box marginTop={1}><Text dimColor>{
        state.mode.k === 'list' ? '↑↓ move • a always • s this session • c clear grant • d delete • i import from a browser • Esc close'
        : state.mode.k === 'import-profile' ? '↑↓ move • Enter choose • Esc back'
        : state.mode.k === 'import-sites' ? 'type to filter • ↑↓ move • Space tick • Ctrl+A tick all listed (not sensitive) • Enter import ticked • Esc clear filter / back'
        : 'y confirm • any key cancel'}</Text></Box>
    </Box>
  );
};

export default SigninsDialog;
