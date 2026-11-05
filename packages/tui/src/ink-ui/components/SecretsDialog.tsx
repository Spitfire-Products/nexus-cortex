/**
 * Secrets Dialog — /secrets in neoncortex (2026-11-02, docs/SECRETS_VAULT_PLAN.md).
 *
 * The interactive face of the encrypted vault (~/.cortex/secrets.enc; core config/secretsVault.ts), modelled on the Nexus Terminal SPA's
 * SECRETS window (commands/standalone/SECRETS/SecretsWindow.tsx) and using the SPA's own provider catalog (core config/spaSecretTypes.ts,
 * synced): secrets grouped by provider with the SPA icons, masked previews, paste-a-key → provider auto-detect (SPA keyPatterns) with a
 * PROVIDER_TYPE name suggestion, edit / delete (confirm) / reveal (on screen only) / bind to an env var / import from ~/.cortex/.env.
 * Values only ever appear inside this dialog — nothing is added to the transcript or the model's context.
 * Same look as ModelPickerDialog (bordered box, ↑↓, footer hints). `cortex secrets …` is the headless equivalent.
 */
import React, { useMemo, useState } from 'react';
import fs from 'fs';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { Colors } from '@nexus-cortex/cli/dist/themes/colors.js';
import {
  Vault, openVaultNonInteractive, initVaultDefault, vaultPath, getGlobalEnvPath, parseEnvFile,
  detectProvider, suggestSecretName, providerForName, providerIcon, SECRET_PROVIDERS,
} from '@nexus-cortex/core';

export interface SecretsDialogProps {
  onClose: () => void;
  /** A one-line, value-free notice for the transcript (e.g. "stored GITHUB_TOKEN"). */
  onNotice?: (text: string) => void;
}

type Mode =
  | { k: 'list' } | { k: 'missing' } | { k: 'locked' }
  | { k: 'add-value' } | { k: 'add-name'; value: string; provider: string | null; type?: string }
  // Provider / type pickers (2026-11-02, SPA SECRETS parity): `value` set = a new secret being added; `name` set = re-tagging an existing one.
  | { k: 'pick-provider'; value?: string; name?: string; detected: string | null }
  | { k: 'pick-type'; value?: string; name?: string; provider: string }
  // "Custom / other" asks for the provider's NAME (2026-11-02: it stored no provider at all — Gemini/Inception/TypeSafe keys came out untagged)
  | { k: 'custom-provider'; value?: string; name?: string }
  | { k: 'edit'; name: string } | { k: 'delete'; name: string } | { k: 'bind'; name: string } | { k: 'reveal'; name: string };

const SECRET_NAME = /(_API_KEY|_API_TOKEN|_OAUTH_TOKEN|_TOKEN|_SECRET|_PASSWORD|_ACCESS_KEY)$/;
const mask = (v: string) => (v.length <= 8 ? '••••' : `${v.slice(0, 4)}…${v.slice(-2)} (${v.length})`);
const VISIBLE_ROWS = 12;

export const SecretsDialog: React.FC<SecretsDialogProps> = ({ onClose, onNotice }) => {
  const initial = useMemo(() => openVaultNonInteractive(), []);
  const [vault, setVault] = useState<Vault | null>(initial.vault);
  const [mode, setMode] = useState<Mode>(initial.vault ? { k: 'list' } : initial.status.exists ? { k: 'locked' } : { k: 'missing' });
  const [sel, setSel] = useState(0);
  const [input, setInput] = useState('');
  const [msg, setMsg] = useState<string>(initial.vault ? `unlocked via ${initial.status.source}` : initial.status.exists ? 'locked' : '');
  const [tick, setTick] = useState(0);
  const [pick, setPick] = useState(0);   // cursor in the provider / type pickers   // re-read the vault after a change
  const note = (t: string) => { setMsg(t); onNotice?.(t); };

  // Rows: secrets grouped by provider (SPA catalog), each group headed by its icon + name.
  const rows = useMemo(() => {
    if (!vault) return [] as Array<{ name: string; provider: string; bound: boolean }>;
    const bound = new Set(vault.bindings().map((b) => b.secret));
    return vault.names().map((name) => {
      const meta = vault.meta(name);
      const provider = meta?.provider || providerForName(name)?.id || 'custom';
      return { name, provider, bound: bound.has(name) };
    }).sort((a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name));
  }, [vault, tick]);
  const current = rows[Math.min(sel, Math.max(0, rows.length - 1))];
  const typing = ['locked', 'add-value', 'add-name', 'edit', 'bind', 'custom-provider'].includes(mode.k);

  const providerOptions = useMemo(() => [...SECRET_PROVIDERS.filter((p) => p.id !== 'custom').map((p) => ({ id: p.id, label: `${providerIcon(p.id)} ${p.name}` })), { id: 'custom', label: '🔑 Custom / other' }], []);
  const typeOptions = (providerId: string): string[] => {
    const p = SECRET_PROVIDERS.find((x) => x.id === providerId);
    return [...new Set([...(p?.expectedSecrets ?? []), 'api-key', 'token', 'secret', 'password'])];
  };
  const refresh = () => setTick((t) => t + 1);
  const back = () => { setInput(''); setMode({ k: 'list' }); };

  useInput((ch, key) => {
    if (key.escape) { if (mode.k === 'list' || mode.k === 'missing' || mode.k === 'locked') onClose(); else back(); return; }
    if (mode.k === 'missing') {
      if (key.return) { try { const r = initVaultDefault(); const o = openVaultNonInteractive(); setVault(o.vault); setMode({ k: 'list' }); note(`vault created — ${r.hint}`); } catch (e) { setMsg(`error: ${(e as Error).message}`); } }
      return;
    }
    if (mode.k === 'reveal') { back(); return; }
    if (mode.k === 'pick-provider' || mode.k === 'pick-type') {
      const opts = mode.k === 'pick-provider' ? providerOptions.map((o) => o.id) : typeOptions(mode.provider);
      if (key.upArrow) { setPick((i) => Math.max(0, i - 1)); return; }
      if (key.downArrow) { setPick((i) => Math.min(opts.length - 1, i + 1)); return; }
      if (!key.return) return;
      const chosen = opts[Math.min(pick, opts.length - 1)]!;
      if (mode.k === 'pick-provider' && chosen === 'custom') { setInput(''); setMode({ k: 'custom-provider', value: mode.value, name: mode.name }); return; }
      if (mode.k === 'pick-provider') { setPick(0); setMode({ k: 'pick-type', value: mode.value, name: mode.name, provider: chosen }); return; }
      const providerMeta = { provider: mode.provider };
      if (mode.name && vault) {   // re-tag an existing secret
        try { vault.set(mode.name, vault.get(mode.name) ?? '', { ...providerMeta, type: chosen }); note(`${mode.name}: provider ${mode.provider}, type ${chosen}`); refresh(); } catch (e) { setMsg(`error: ${(e as Error).message}`); }
        back(); return;
      }
      // A Claude SUBSCRIPTION OAuth token (claude setup-token) is not an API key: the harness refuses it as ANTHROPIC_API_KEY (2026-11-02)
      setInput(/^sk-ant-oat/.test(mode.value ?? '') ? 'CLAUDE_CODE_OAUTH_TOKEN' : suggestSecretName(mode.provider, chosen));
      setMode({ k: 'add-name', value: mode.value!, provider: mode.provider, type: chosen });
      return;
    }
    if (mode.k === 'delete') {
      if (ch === 'y' && vault) { vault.delete(mode.name); note(`deleted ${mode.name}`); setSel((s) => Math.max(0, s - 1)); refresh(); }
      back(); return;
    }
    if (mode.k !== 'list' || !vault) return;
    if (key.upArrow) { setSel((s) => Math.max(0, s - 1)); return; }
    if (key.downArrow) { setSel((s) => Math.min(rows.length - 1, s + 1)); return; }
    if (ch === 'a') { setInput(''); setMode({ k: 'add-value' }); return; }
    if (ch === 'i') {
      try {
        const envPath = getGlobalEnvPath(); const parsed = fs.existsSync(envPath) ? parseEnvFile(fs.readFileSync(envPath, 'utf8')) : {};
        const moved = Object.entries(parsed).filter(([k, v]) => SECRET_NAME.test(k) && String(v ?? '').trim()).map(([k, v]) => { vault.set(k, String(v), { category: 'imported' }); return k; });
        note(moved.length ? `imported ${moved.length} key(s) from ${envPath} — run \`cortex secrets import-env --strip\` to blank them there` : 'no secret-looking keys with values in ~/.cortex/.env');
        refresh();
      } catch (e) { setMsg(`error: ${(e as Error).message}`); }
      return;
    }
    if (!current) return;
    if (ch === 'e' || key.return) { setInput(''); setMode({ k: 'edit', name: current.name }); return; }
    if (ch === 'd') { setMode({ k: 'delete', name: current.name }); return; }
    if (ch === 'r') { setMode({ k: 'reveal', name: current.name }); return; }
    if (ch === 'b') { setInput(current.name); setMode({ k: 'bind', name: current.name }); return; }
    if (ch === 'p') { const i = providerOptions.findIndex((o) => o.id === current.provider); setPick(Math.max(0, i)); setMode({ k: 'pick-provider', name: current.name, detected: current.provider }); return; }
  }, { isActive: !typing });
  // While a text field is active, only Esc is handled here (TextInput owns the other keys).
  useInput((_ch, key) => { if (key.escape) { if (mode.k === 'locked') onClose(); else back(); } }, { isActive: typing });

  const submit = (value: string) => {
    const v = value.trim();
    try {
      if (mode.k === 'locked') { const opened = Vault.open(v, 'passphrase'); setVault(opened); setInput(''); setMode({ k: 'list' }); setMsg('unlocked with the passphrase'); return; }
      if (!vault || !v) return;
      // The name follows the SPA's PROVIDER_TYPE convention with the provider's own first expected secret type (GitHub → GITHUB_TOKEN-style).
      // Pasted value → the provider picker, with the auto-detected provider pre-selected (Enter accepts it); then the type; then the name.
      if (mode.k === 'add-value') { const p = detectProvider(v); const i = providerOptions.findIndex((o) => o.id === (p?.id ?? 'custom')); setPick(Math.max(0, i)); setInput(''); setMode({ k: 'pick-provider', value: v, detected: p?.id ?? null }); return; }
      if (mode.k === 'add-name') { vault.set(v, mode.value, { ...(mode.provider ? { provider: mode.provider } : {}), ...(mode.type ? { type: mode.type } : {}) }); note(`stored ${v}`); refresh(); back(); return; }
      if (mode.k === 'custom-provider') {
        // a provider id the catalog does not know: lower-case, letters/digits/-/_ ("TypeSafe AI" → typesafe-ai)
        const id = v.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
        if (!id) { setMsg('type the provider name (e.g. gemini, inception, typesafe)'); return; }
        setPick(0); setInput(''); setMode({ k: 'pick-type', value: mode.value, name: mode.name, provider: id }); return;
      }
      if (mode.k === 'edit') { vault.set(mode.name, v); note(`updated ${mode.name}`); refresh(); back(); return; }
      if (mode.k === 'bind') { if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(v)) { setMsg('env var names: letters, digits and _, not starting with a digit'); return; } vault.bind({ secret: mode.name, envVar: v, scope: 'global' }); note(`bound ${mode.name} → $${v}`); refresh(); back(); return; }
    } catch (e) { setMsg(`error: ${(e as Error).message}`); }
  };

  // Scroll window like ModelPickerDialog.
  const start = Math.max(0, Math.min(sel - Math.floor(VISIBLE_ROWS / 2), Math.max(0, rows.length - VISIBLE_ROWS)));
  const shown = rows.slice(start, start + VISIBLE_ROWS);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={Colors.AccentBlue} paddingX={2} paddingY={1} marginY={1}>
      <Box marginBottom={1}>
        <Text color={Colors.AccentBlue} bold>🔐 Secrets</Text>
        <Text dimColor>  {vault ? `${rows.length} stored · ${vaultPath()}` : vaultPath()}</Text>
      </Box>

      {mode.k === 'missing' && <Text>No vault yet. <Text color={Colors.AccentCyan}>Enter</Text> to create one (key in the OS keychain, or an owner-only key file when there is none).</Text>}
      {mode.k === 'locked' && (
        <Box flexDirection="column">
          <Text>The vault is locked. Enter its passphrase / key <Text dimColor>(or set CORTEX_SECRETS_KEY for unattended runs)</Text>:</Text>
          <Box><Text color={Colors.AccentCyan}>› </Text><TextInput value={input} onChange={setInput} onSubmit={submit} mask="*" /></Box>
        </Box>
      )}

      {vault && mode.k !== 'missing' && mode.k !== 'locked' && (
        <Box flexDirection="row">
          <Box flexDirection="column" width={58}>
            {rows.length === 0 && <Text dimColor>No secrets yet — press a to add one, i to import from ~/.cortex/.env.</Text>}
            {start > 0 && <Text dimColor>    ↑ {start} more</Text>}
            {shown.map((r, i) => {
              const idx = start + i; const isSel = idx === sel; const prev = rows[idx - 1];
              const header = !prev || prev.provider !== r.provider;
              const cfg = SECRET_PROVIDERS.find((p) => p.id === r.provider);
              return (
                <Box key={r.name} flexDirection="column">
                  {header && <Text color={Colors.AccentPurple}>{providerIcon(r.provider)} {cfg?.name ?? r.provider}</Text>}
                  <Text>
                    <Text color={isSel ? Colors.AccentCyan : undefined} bold={isSel}>{isSel ? '❯ ' : '  '}</Text>
                    <Text color={isSel ? Colors.AccentCyan : undefined}>{r.name.padEnd(30).slice(0, 30)}</Text>
                    <Text dimColor> {mask(vault.get(r.name) ?? '')}</Text>
                    {r.bound && <Text color={Colors.AccentGreen}> ⇢ bound</Text>}
                  </Text>
                </Box>
              );
            })}
            {start + VISIBLE_ROWS < rows.length && <Text dimColor>    ↓ {rows.length - start - VISIBLE_ROWS} more</Text>}
          </Box>
          <Box flexDirection="column" width={34} paddingLeft={1}>
            <Text bold color={Colors.AccentBlue}>Details</Text>
            <Box borderStyle="single" borderColor={Colors.Gray} flexDirection="column" paddingX={1} minHeight={7}>
              {current ? (
                <>
                  <Text><Text color={Colors.AccentCyan}>Name:</Text> {current.name.slice(0, 22)}</Text>
                  <Text><Text color={Colors.AccentCyan}>Provider:</Text> {SECRET_PROVIDERS.find((p) => p.id === current.provider)?.name ?? current.provider}</Text>
                  {vault.meta(current.name)?.type && <Text><Text color={Colors.AccentCyan}>Type:</Text> {vault.meta(current.name)!.type}</Text>}
                  <Text><Text color={Colors.AccentCyan}>Updated:</Text> {new Date(vault.meta(current.name)?.updatedAt ?? 0).toLocaleDateString()}</Text>
                  {vault.bindings().filter((b) => b.secret === current.name).map((b) => <Text key={b.envVar} color={Colors.AccentGreen}>⇢ ${b.envVar}</Text>)}
                </>
              ) : <Text dimColor>—</Text>}
            </Box>
          </Box>
        </Box>
      )}

      {mode.k === 'add-value' && <Box marginTop={1}><Text>Paste the value: </Text><TextInput value={input} onChange={setInput} onSubmit={submit} mask="*" /></Box>}
      {(mode.k === 'pick-provider' || mode.k === 'pick-type') && (() => {
        const labels = mode.k === 'pick-provider' ? providerOptions.map((o) => o.label) : typeOptions(mode.provider);
        const start = Math.max(0, Math.min(pick - 5, labels.length - 10));
        return (
          <Box marginTop={1} flexDirection="column">
            <Text color={Colors.AccentBlue}>{mode.k === 'pick-provider'
              ? (mode.detected ? `Provider (detected: ${providerIcon(mode.detected)} ${SECRET_PROVIDERS.find((p) => p.id === mode.detected)?.name ?? mode.detected} — Enter to accept, ↑↓ to change):` : 'Provider not recognised — pick one, or Custom / other:')
              : `Secret type for ${SECRET_PROVIDERS.find((p) => p.id === mode.provider)?.name ?? mode.provider}:`}</Text>
            {start > 0 && <Text dimColor>    ↑ {start} more</Text>}
            {labels.slice(start, start + 10).map((l, i) => (
              <Text key={l} color={start + i === pick ? Colors.AccentCyan : undefined}>{start + i === pick ? '❯ ' : '  '}{l}</Text>
            ))}
            {start + 10 < labels.length && <Text dimColor>    ↓ {labels.length - start - 10} more</Text>}
          </Box>
        );
      })()}
      {mode.k === 'custom-provider' && <Box marginTop={1}><Text>Provider name (e.g. gemini, inception, typesafe): </Text><TextInput value={input} onChange={setInput} onSubmit={submit} /></Box>}
      {mode.k === 'add-name' && (
        <Box marginTop={1} flexDirection="column">
          {/^sk-ant-oat/.test(mode.value) && <Text color={Colors.AccentYellow}>This is a Claude subscription OAuth token (claude setup-token), not an API key — it works only in Claude Code (claude -p). For nexus-cortex models store a Console key (sk-ant-api03-…) as ANTHROPIC_API_KEY.</Text>}
          <Text dimColor>{mode.type ? `Name suggested from ${mode.provider ? (SECRET_PROVIDERS.find((p) => p.id === mode.provider)?.name ?? mode.provider) : 'custom'} / ${mode.type} — edit if you like (letters, digits, _).` : mode.provider ? `Detected ${providerIcon(mode.provider)} ${SECRET_PROVIDERS.find((p) => p.id === mode.provider)?.name} — name suggested; edit if you like.` : 'Provider not recognised — name it (letters, digits, _).'}</Text>
          <Box><Text>Name: </Text><TextInput value={input} onChange={setInput} onSubmit={submit} /></Box>
        </Box>
      )}
      {mode.k === 'edit' && <Box marginTop={1}><Text>New value for {mode.name}: </Text><TextInput value={input} onChange={setInput} onSubmit={submit} mask="*" /></Box>}
      {mode.k === 'bind' && <Box marginTop={1}><Text>Bind {mode.name} to env var: $</Text><TextInput value={input} onChange={setInput} onSubmit={submit} /></Box>}
      {mode.k === 'delete' && <Box marginTop={1}><Text color={Colors.AccentRed}>Delete {mode.name}? </Text><Text>y = yes, any other key = no</Text></Box>}
      {mode.k === 'reveal' && vault && <Box marginTop={1} flexDirection="column"><Text>{mode.name} = <Text color={Colors.AccentYellow}>{vault.get(mode.name)}</Text></Text><Text dimColor>(shown here only, not in the transcript — any key to hide)</Text></Box>}

      {msg !== '' && <Box marginTop={1}><Text dimColor>{msg}</Text></Box>}
      <Box marginTop={1}>
        <Text dimColor>{mode.k === 'list' ? '↑↓ move • a add • Enter/e edit • r reveal • b bind • p provider/type • d delete • i import .env • Esc close' : (mode.k === 'pick-provider' || mode.k === 'pick-type' ? '↑↓ choose • Enter select • Esc back' : 'Enter confirm • Esc back')}</Text>
      </Box>
    </Box>
  );
};

export default SecretsDialog;
