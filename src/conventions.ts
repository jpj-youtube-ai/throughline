// The Throughline working conventions (REQ-011). The board already produces
// conforming branch names (see `branchNameFor` / `claimTask`); the squash-merge
// is a one-time repo setting. REQ-014 (CLAUDE.md managed block) will write this
// block into the target repo's CLAUDE.md so Claude Code follows it.

export const BRANCH_PATTERN = /^task-\d+-[a-z0-9-]+$/;
export const PR_TITLE_PATTERN = /^\[TASK-\d{3}\]/;

export const CONVENTIONS_MARKDOWN = `## Working conventions

- **Branches:** \`task-<key>-<slug>\` (e.g. \`task-014-event-log-table\`). The board sets this at claim time.
- **PRs & commits:** the PR title and the squash commit message **start with** \`[TASK-NNN]\`.
- **Squash-merge:** the repo squash-merges seeded from the PR title, so each task
  lands on \`master\` as one clean \`[TASK-NNN]\` line — no per-commit linter needed.
- **One task per PR.** Each task implements exactly its linked \`REQ-NNN\`.
`;
