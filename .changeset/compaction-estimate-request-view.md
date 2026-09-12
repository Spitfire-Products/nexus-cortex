---
'@nexus-cortex/core': patch
---

HB-COMPACTION-ESTIMATE (R129): proactive compaction and the pre-compaction checkpoint rung now judge the REQUEST view of the history, not the stored history. On long tool-heavy tasks the stored history can weigh 1M+ estimated tokens of raw tool output while the request carries the aged-pruned view (68K real tokens on a Terminal-Bench 4.0 CAD task), so compaction fired on a false reading and re-fired every iteration, leaving the model with a handful of raw messages plus the memory for the rest of the task. `ensureHistoryFitsModel` scales the token estimate by the pruned-view/raw char ratio (`scaleEstimateToRequestView`, `approxCharsOf`; identity below the pruner's 50% utilization gate) and scales the post-compaction count the same way; DEBUG logs `request-view estimate: N of M stored tokens`.
