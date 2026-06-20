# Contributing — working conventions (REQ-011)

Throughline links every commit on `master` to a task via squash-merge. The board
enforces the branch half; the PR/squash half is a repo setting plus the title
convention below. This is the same convention the board will write into the
target repo's `CLAUDE.md` (REQ-014).

- **Branches:** `task-<key>-<slug>` (e.g. `task-014-event-log-table`). The board
  computes this at claim time (`branchNameFor` in `src/tasks/claim.ts`).
- **PRs & commits:** the PR title and the squash commit message **start with**
  `[TASK-NNN]`.
- **Squash-merge:** set the repo to squash-merge seeded from the PR title, so each
  task lands on `master` as one clean `[TASK-NNN]` line. No per-commit linter is
  needed — `git log master` shows one `[TASK-NNN]` line per merged task.
- **One task per PR.** Each task implements exactly its linked `REQ-NNN`.

This repository dogfoods the convention: `git log main` is one `[TASK-NNN]` line
per task. The canonical source for the patterns is `src/conventions.ts`.
