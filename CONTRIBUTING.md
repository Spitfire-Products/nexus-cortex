# Contributing to Nexus Cortex

Thanks for your interest in improving Nexus Cortex. This guide covers the basics.

## Development setup

```bash
git clone https://github.com/Spitfire-Products/nexus-cortex.git
cd nexus-cortex
npm install
npm run build        # multi-pass build (core ⇄ executors need two passes)
```

Always build from the repository root — never from an individual package. See the
[Architecture doc](docs/architecture.md#package-build-order) for why the build order matters.

## Project layout

It's a TypeScript monorepo (`packages/*`):

- `types` — shared interfaces (zero runtime deps)
- `core` — the orchestration engine
- `executors` — tool implementations
- `server` — the HTTP server
- `cli` — the headless `cortex` command
- `meta` — the `nexus-cortex` convenience install

Each package has its own `CLAUDE.md` with a focused reading list.

## Making a change

1. Fork the repo and create a branch (`git checkout -b feature/your-change`).
2. Make your change, with tests where it makes sense.
3. Run the checks:
   ```bash
   npm run typecheck
   npm test
   npm run lint
   ```
4. Commit and push, then open a pull request describing what changed and why.

## Pull request guidelines

- Keep PRs focused — one logical change per PR is easier to review.
- If you change registry-derived facts (tools, models, providers), don't hardcode counts in
  docs — the README counts are generated (`npm run docs:counts`).
- Note any new environment variables in `.env.example` and `docs/configuration.md`.

## Reporting issues

Found a bug or have a feature request? Open an issue at
[github.com/Spitfire-Products/nexus-cortex/issues](https://github.com/Spitfire-Products/nexus-cortex/issues).

## License

By contributing, you agree that your contributions are licensed under the
[Apache-2.0 License](LICENSE).
