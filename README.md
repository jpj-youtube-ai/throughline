# Throughline — task generation (build step 1)

Standalone script that turns an approved idea + the spec + a curated repo slice
into spec-linked, structured tasks for Claude Code. This is the core of REQ-008,
built and proven before any app shell.

## Setup

```sh
npm install
export ANTHROPIC_API_KEY=sk-ant-...   # PowerShell: $env:ANTHROPIC_API_KEY = "sk-ant-..."
```

## Run

```sh
npm run generate -- --idea examples/ideas/01-bind-repo.json --out out/01.json --verbose
```

Flags:

- `--idea <path|->` (required) — idea JSON (`title`, `why`, optional `feasibility`,
  `viability`, `relevantPaths`); `-` reads stdin.
- `--spec <path>` (default `./SPEC.md`)
- `--repo <path>` (default `.`) — target repo to slice for context.
- `--claude <path>` (default `<repo>/CLAUDE.md`) — conventions.
- `--model opus|sonnet` (default `opus`)
- `--out <path>` — write JSON here (default stdout). Human summary always goes to stderr.
- `--max-context-tokens <n>` (default `40000`) — repo-slice budget (spec + conventions
  are always included in full).
- `--max-retries <n>` (default `2`) — corrective retries on malformed/invalid output.
- `--include <glob>` (repeatable) — force files into the slice.
- `--no-thinking` — disable adaptive thinking.

On malformed or invalid output it retries with the validation errors fed back, then
exits non-zero with `generation failed — retry` and writes nothing — never a partial task.
