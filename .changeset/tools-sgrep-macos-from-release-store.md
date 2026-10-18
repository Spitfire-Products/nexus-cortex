---
"@nexus-cortex/cli": patch
---

`cortex tools install` / auto-install: the macOS arm64 sgrep now comes from our cortex-tools release (built from the same pinned upstream commit as the Linux binaries) instead of upstream's own macOS tarball, which is cut from the v0.3.0 tag and lacks `--explain`, `--stdin` and `--rg-json` although it reports the same version. The installer now identifies an asset by its sha256 as well as its version, so a re-pinned asset re-installs on `cortex update` even when the version string is unchanged; existing installs refresh once.
