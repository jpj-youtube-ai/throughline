import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { project } from "../db/schema";
import { emitEvent } from "../db/events";
import { CONVENTIONS_MARKDOWN } from "../conventions";

const START = "<!-- THROUGHLINE:START -->";
const END = "<!-- THROUGHLINE:END -->";

// The managed block written into the target repo's CLAUDE.md (REQ-014):
// branch/commit convention, task-pickup protocol, spec contract.
export function managedBlockBody(): string {
  return `${CONVENTIONS_MARKDOWN}
## Task pickup

- Pick an open, unclaimed task from the board; it sets your branch \`task-<key>-<slug>\`.
- Implement exactly the task's linked \`REQ-NNN\`. Work beyond it is drift and is flagged at PR time.
- Open a PR whose title starts with \`[TASK-NNN]\`; it squash-merges as one clean line.

## Spec contract

- \`SPEC.md\` is a generated projection — never hand-edit it; it is materialized from the requirement log.`;
}

/**
 * Replace the managed region between the markers, or append a new one if the
 * markers are absent. Everything outside the markers is left byte-identical.
 */
export function upsertManagedBlock(existing: string, blockBody: string): string {
  const block = `${START}\n${blockBody.trim()}\n${END}`;
  const startIdx = existing.indexOf(START);
  const endIdx = existing.indexOf(END);
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    return existing.slice(0, startIdx) + block + existing.slice(endIdx + END.length);
  }
  if (existing === "") return block + "\n";
  const sep = existing.endsWith("\n\n") ? "" : existing.endsWith("\n") ? "\n" : "\n\n";
  return existing + sep + block + "\n";
}

export type ClaudeCommitFn = (content: string) => Promise<{ sha: string }> | { sha: string };

export interface SyncClaudeMdResult {
  conventionVersion: number;
  sha: string;
  content: string;
}

/**
 * Sync the managed block into CLAUDE.md (REQ-014): upsert the marked region in
 * the current content, commit it, bump convention_version, and emit
 * claude_md.synced. The commit is injectable so the upsert is testable without a
 * clone. The caller reads the current CLAUDE.md from the clone.
 */
export async function syncClaudeMd(
  db: Db,
  currentClaudeMd: string,
  commit: ClaudeCommitFn,
): Promise<SyncClaudeMdResult> {
  const [proj] = await db.select().from(project).limit(1);
  if (!proj) throw new Error("No project bound (REQ-002).");

  const content = upsertManagedBlock(currentClaudeMd, managedBlockBody());
  const { sha } = await commit(content);
  const nextVersion = proj.conventionVersion + 1;

  await db.transaction(async (tx) => {
    await tx.update(project).set({ conventionVersion: nextVersion }).where(eq(project.id, proj.id));
    await emitEvent(tx, {
      type: "claude_md.synced",
      subjectType: "project",
      subjectId: proj.id,
      payload: { convention_version: nextVersion },
    });
  });

  return { conventionVersion: nextVersion, sha, content };
}
