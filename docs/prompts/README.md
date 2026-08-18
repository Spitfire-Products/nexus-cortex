# Prompt presets — P6c staged trial (BASH_PLUS_SPEC, 2026-08-18)

P6c verdict (56/56 accuracy, valid instrument): minimal prompts with an orientation
pointer beat the full guide corpus on deepseek-v4-flash by −69% input / −85% output
(~3.6x cheaper/task) at equal accuracy. Winner: boot-observation (boot-prompt.md +
orient.sh — orientation delivered as observation-mass via the model's own first
action). Runner-up: orient-prompt.md (doc pointer, no script).

STAGED TRIAL (default NOT flipped — operator opt-in per arm):
  CORTEX_SYSTEM_PROMPT_FILE=$PWD/docs/prompts/boot-prompt.md \
  CORTEX_PROMPT_MASS=minimal \
  cortex "..."          # or set on the server env

Notes:
- CORTEX_PROMPT_MASS=minimal drops every static guide doc (incl. CLAUDE.md/memory)
  for the session; the varying rider (periodic_reminder) still flows.
- boot-prompt.md points at the BENCH orient script (absolute path, this repo).
  Productizing needs a project-level convention (e.g. .cortex/orient) — follow-up.
- Evidence + gate: nexus-terminal/modules/database-ai/training/BASH_PLUS_SPEC.md §R63/P6c.
