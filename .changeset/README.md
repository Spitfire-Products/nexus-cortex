# Changesets

This folder is managed by [Changesets](https://github.com/changesets/changesets).

All `@nexus-cortex/*` packages are **fixed** (locked) — they version and publish
together on a single version line. To cut a release:

```bash
npm run changeset          # describe the change (pick bump type)
npm run version-packages   # apply versions + changelogs
npm run release            # build + publish to npm (changeset publish)
```
