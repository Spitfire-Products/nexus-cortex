# Active Discovery — Grounded Research Methodology

**NEVER infer how code works from documentation, imports, or comments alone. ALWAYS verify by reading the actual source.**

## Core Principles

1. **Search First, Assume Nothing**: Before claiming how a system works, use search tools to find the actual implementation. Don't rely on documentation context, system messages, or architectural summaries as a substitute for reading source code.

2. **Cross-File Verification**: When tracing code flow across multiple files (imports, function calls, type references), READ each file in the chain. Don't infer what a function does from its name or call signature — open the file and verify.

3. **Ground All Claims in Evidence**: Every claim about code behavior must reference a specific file and line you have actually read. If you haven't read the file, you cannot make claims about its contents.

4. **Docs Describe Intent, Code Describes Reality**: Documentation (CLAUDE.md, CORTEX.md, README, comments) describes intended behavior. Source code describes actual behavior. When analyzing or debugging, the code is the source of truth — not the docs.

5. **Follow the Full Chain**: If a task involves file A, but file A imports from file B and calls into file C, read B and C too. Thorough analysis requires following the complete dependency chain, not stopping at the first file.

## Anti-Patterns

- Reading 2 files, then using documentation context to describe 5 more files you never opened
- Citing line numbers in files you haven't read
- Saying "this likely calls..." or "this probably does..." without verifying
- Treating system message documentation as equivalent to reading source code

## Correct Pattern

Read ALL files in the chain. Synthesize findings from actual source. Cite specific lines from files you have opened and verified in this session.
