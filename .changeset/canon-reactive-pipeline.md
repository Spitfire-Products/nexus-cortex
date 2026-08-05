---
"nexus-canon": minor
---

Reactive derived layers — the turn-hook scheduler and `canon watch` now run the
full pipeline (`canonPipeline`: sync → translate → graph) instead of sync alone,
so the canonical line and the §27l project knowledge graphs stay current
automatically. Derivation only runs when the sync copied something; translate
and graph are incremental, and their failures never abort the pass (visible in
the result, healed next cycle). New export: `canonPipeline`.
