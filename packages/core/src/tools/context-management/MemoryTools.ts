/**
 * MemoryTools — MemoryWrite / MemoryRecall (P-A memory upgrade, stages 2+3).
 *
 * Two-tier memory: `.cortex/MEMORY.md` is a curated one-line-per-memory INDEX
 * (injected every session at high priority); per-fact detail lives in
 * `.cortex/memory/<name>.md` files with frontmatter (name/description/type),
 * loaded on demand via MemoryRecall. This replaces free-hand Markdown editing
 * with dedupe-by-name, typed categories, and an update-not-duplicate contract.
 *
 * Legacy compatibility: projects with only a monolithic MEMORY.md (and the
 * lossless MEMORY.archive.md spill) are searched as a fallback by MemoryRecall —
 * no migration required (operator ruling 2026-07-24: archive-fallback over
 * auto-migrator).
 *
 * Ownership rule (stage 3): sub-agents are READ-ONLY. Concurrent sub-agent
 * writers on the shared projectPath memory files have no lock — the parent owns
 * writes; children recall and report memories back in their results.
 */
import * as fs from 'fs/promises';
import * as path from 'path';

const MEMORY_DIR = 'memory';
const INDEX_FILE = 'MEMORY.md';
const ARCHIVE_FILE = 'MEMORY.archive.md';
const TYPES = ['user', 'feedback', 'project', 'reference'] as const;

const INDEX_HEADER = `# Memory

Curated index — one line per memory; detail lives in \`.cortex/memory/<name>.md\`
(use MemoryRecall to load one). Maintain via MemoryWrite (dedupe-by-name,
update-not-duplicate, delete-when-wrong). Injected every session — keep lines
short and load-bearing.
`;

function cortexDir(projectPath: string): string {
  return path.join(projectPath, '.cortex');
}

function slugOk(name: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,63}$/.test(name);
}

function indexLine(name: string, description: string): string {
  return `- [${name}](${MEMORY_DIR}/${name}.md) — ${description.replace(/\s+/g, ' ').trim()}`;
}

async function upsertIndexLine(projectPath: string, name: string, line: string | null): Promise<void> {
  const indexPath = path.join(cortexDir(projectPath), INDEX_FILE);
  let content = '';
  try { content = await fs.readFile(indexPath, 'utf-8'); } catch { content = INDEX_HEADER; }
  const marker = `(${MEMORY_DIR}/${name}.md)`;
  const lines = content.split('\n').filter((l) => !l.includes(marker));
  if (line) lines.push(line);
  await fs.writeFile(indexPath, lines.join('\n').replace(/\n{3,}/g, '\n\n') + '\n', 'utf-8');
}

export class MemoryWrite {
  static async execute(
    input: { action?: string; name?: string; type?: string; description?: string; content?: string },
    projectPath: string,
  ): Promise<{ success: boolean; message: string }> {
    // Stage-3 ownership rule: children read-only (no lock exists on the shared files).
    if (process.env.CORTEX_SUBAGENT === '1') {
      return { success: false, message: 'MemoryWrite is read-only in sub-agents (write ownership belongs to the parent). Include the memory-worthy finding in your final result instead.' };
    }
    const action = input.action ?? 'write';
    const name = (input.name ?? '').trim();
    if (!slugOk(name)) {
      return { success: false, message: `Invalid name "${name}" — use a kebab-case slug (a-z, 0-9, hyphens, 2-64 chars).` };
    }
    const dir = path.join(cortexDir(projectPath), MEMORY_DIR);
    const filePath = path.join(dir, `${name}.md`);

    if (action === 'delete') {
      try { await fs.unlink(filePath); } catch { /* absent is fine */ }
      await upsertIndexLine(projectPath, name, null);
      return { success: true, message: `Deleted memory "${name}" (file + index line).` };
    }

    const type = (input.type ?? 'project') as (typeof TYPES)[number];
    if (!TYPES.includes(type)) {
      return { success: false, message: `Invalid type "${type}" — one of: ${TYPES.join(', ')}.` };
    }
    const description = (input.description ?? '').trim();
    if (!description) return { success: false, message: 'description (one line) is required.' };
    const content = (input.content ?? '').trim();
    if (!content) return { success: false, message: 'content is required for write.' };

    await fs.mkdir(dir, { recursive: true });
    let existed = false;
    try { await fs.access(filePath); existed = true; } catch { /* new */ }
    const body = `---\nname: ${name}\ndescription: ${description.replace(/\n/g, ' ')}\ntype: ${type}\n---\n\n${content}\n`;
    await fs.writeFile(filePath, body, 'utf-8');
    await upsertIndexLine(projectPath, name, indexLine(name, description));
    return { success: true, message: `${existed ? 'Updated' : 'Created'} memory "${name}" (${type}) + index line.` };
  }
}

export class MemoryRecall {
  static async execute(
    input: { name?: string; query?: string },
    projectPath: string,
  ): Promise<{ success: boolean; message: string }> {
    const dir = path.join(cortexDir(projectPath), MEMORY_DIR);
    const name = (input.name ?? '').trim();
    const query = (input.query ?? '').trim().toLowerCase();

    if (name) {
      try {
        const content = await fs.readFile(path.join(dir, `${name}.md`), 'utf-8');
        return { success: true, message: content };
      } catch {
        const legacy = await this.legacySearch(projectPath, name.toLowerCase());
        return legacy
          ? { success: true, message: `(no memory file "${name}" — legacy monolith/archive matches)\n\n${legacy}` }
          : { success: false, message: `No memory named "${name}" (and no legacy matches).` };
      }
    }

    if (!query) return { success: false, message: 'Provide name or query.' };

    const hits: Array<{ name: string; description: string; content: string }> = [];
    try {
      for (const f of await fs.readdir(dir)) {
        if (!f.endsWith('.md')) continue;
        const content = await fs.readFile(path.join(dir, f), 'utf-8');
        const desc = /description:\s*(.+)/.exec(content)?.[1] ?? '';
        if (f.toLowerCase().includes(query) || desc.toLowerCase().includes(query) || content.toLowerCase().includes(query)) {
          hits.push({ name: f.replace(/\.md$/, ''), description: desc, content });
        }
      }
    } catch { /* no memory dir — legacy project */ }

    const legacy = await this.legacySearch(projectPath, query);
    if (hits.length === 0 && !legacy) return { success: false, message: `No memories match "${query}".` };
    const parts: string[] = [];
    const top = hits[0];
    if (top) {
      parts.push(`Matches (${hits.length}):\n${hits.map((h) => `- ${h.name} — ${h.description}`).join('\n')}`);
      parts.push(`--- ${top.name} (top match, full content) ---\n${top.content}`);
    }
    if (legacy) parts.push(`--- legacy monolith/archive matches ---\n${legacy}`);
    return { success: true, message: parts.join('\n\n') };
  }

  /** Legacy fallback: grep MEMORY.md + MEMORY.archive.md line-wise (±1 context). */
  private static async legacySearch(projectPath: string, needle: string): Promise<string | null> {
    const out: string[] = [];
    for (const f of [INDEX_FILE, ARCHIVE_FILE]) {
      try {
        const lines = (await fs.readFile(path.join(cortexDir(projectPath), f), 'utf-8')).split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line && line.toLowerCase().includes(needle)) {
            out.push([lines[i - 1], line, lines[i + 1]].filter(Boolean).join('\n'));
            if (out.length >= 8) break;
          }
        }
      } catch { /* file absent */ }
      if (out.length >= 8) break;
    }
    return out.length ? out.join('\n…\n') : null;
  }
}
