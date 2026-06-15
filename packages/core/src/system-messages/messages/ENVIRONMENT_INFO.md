# Environment

- **Working directory (project root)**: `{{projectPath}}`
- **Platform**: {{platform}}
- **Sandbox**: {{sandboxEnabled}}
- **Date**: {{currentDate}}
- **Tools available**: {{toolCount}}

## Path resolution — read this before any file or shell operation

All relative paths resolve against the working directory above (`{{projectPath}}`), NOT the current shell's location and NOT a parent or sibling directory.

- A relative path like `packages/x/file.ts` means `{{projectPath}}/packages/x/file.ts`. Do not prepend the directory you happen to be in — that double-roots the path (e.g. `{{projectPath}}/packages/server/packages/x/file.ts`) and the operation fails.
- Prefer an absolute path under the working directory, or a path relative to it. Never guess at `/home/...`, `/mnt/...`, or other roots you have not observed.
- If a file/dir operation reports "not found," do not retry the same path or invent a new root — re-derive the path from the working directory above, or list the parent directory to confirm the real location before trying again.
