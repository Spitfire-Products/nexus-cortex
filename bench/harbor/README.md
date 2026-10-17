# Harbor adapter for nexus-cortex

`nexus_cortex_agent.py` is the installed-agent adapter that lets the [Harbor](https://github.com/laude-institute/harbor) benchmark
runner drive the published `nexus-cortex` CLI inside each task container, the same way Harbor drives mini-swe-agent or Terminus.
It is the exact file our Terminal-Bench cells run (banked with every result store). Loaded through Harbor's import-path mechanism,
so Harbor itself needs no modification:

```
harbor run -d terminal-bench/terminal-bench@4.0 -a nexus_cortex_agent:NexusCortex -m deepseek-flash \
  --agent-import-path . --n-concurrent 4
```

What it does: `install()` puts node and the pinned `nexus-cortex` release in the task container (`TB2_HARNESS=nexus-cortex@<version>`
pins it; unset = latest); `run()` starts `cortex-server` in the task directory and drives one headless session with the task
instruction; the task's own grader scores the result. Provider keys are read from Harbor's environment (`DEEPSEEK_API_KEY` etc.) and
forwarded into the container; the harness lever profile and the arm levers listed in the adapter's pass-through block are forwarded
the same way. Full reproduction instructions: `docs/REPRODUCING_BENCH_RESULTS.md`.
