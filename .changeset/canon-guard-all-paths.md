---
"nexus-canon": patch
---

Mass-deletion guard moved to the shared choke point + atomic clone. The 2026-08-20 second incident (3949c39d) proved the sync-only guard insufficient: /tmp reaped the store, the re-clone raced a canon cycle, and the UNGUARDED translate path committed a 16,445-file deletion from the partial tree 2 seconds after clone. Now: guardedAddAll (>10 staged deletions = loud abort + reset) at ALL 4 commit paths (sync/translate/graph/artifacts), and atomicClone (clone to temp dir + rename) so a store path never holds .git over a partially-checked-out tree.
