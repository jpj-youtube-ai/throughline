import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { tasks } from "../db/schema";
import { emitEvent } from "../db/events";
import { reconcileRequirementStatus } from "../requirements/lifecycle";

type GithubStatus = "open" | "closed";

// Verify a GitHub webhook delivery: HMAC-SHA256 of the raw body keyed by the
// shared secret, compared in constant time against the X-Hub-Signature-256 header.
export function verifySignature(
  secret: string | undefined,
  rawBody: string,
  signatureHeader: string | null,
): boolean {
  if (!secret || !signatureHeader) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

interface Target {
  by: "issue" | "task";
  issueNumber?: number;
  taskKey?: string;
  to: GithubStatus;
}

// Map a webhook event to the status change it implies, or null to ignore it.
function resolveTarget(eventType: string | null, payload: unknown): Target | null {
  if (eventType === "issues") {
    const p = payload as { action?: string; issue?: { number?: number } };
    if (typeof p.issue?.number !== "number") return null;
    if (p.action === "closed") return { by: "issue", issueNumber: p.issue.number, to: "closed" };
    if (p.action === "reopened") return { by: "issue", issueNumber: p.issue.number, to: "open" };
    return null;
  }
  if (eventType === "pull_request") {
    const p = payload as { action?: string; pull_request?: { merged?: boolean; title?: string } };
    if (p.action === "closed" && p.pull_request?.merged === true && typeof p.pull_request.title === "string") {
      const m = /\[TASK-(\d+)\]/.exec(p.pull_request.title);
      if (m) return { by: "task", taskKey: `TASK-${m[1]}`, to: "closed" };
    }
    return null;
  }
  return null;
}

export interface WebhookResult {
  changed: boolean;
  taskKey?: string;
  to?: GithubStatus;
}

/**
 * Mirror a GitHub status change onto the matching task (REQ-009). This is the
 * ONLY place github_status is ever written — the board cannot set it. Emits
 * task.github_status_changed in the same transaction.
 */
export async function handleWebhook(
  db: Db,
  eventType: string | null,
  payload: unknown,
): Promise<WebhookResult> {
  const target = resolveTarget(eventType, payload);
  if (!target) return { changed: false };

  return db.transaction(async (tx) => {
    const where =
      target.by === "issue"
        ? eq(tasks.githubIssueNumber, target.issueNumber!)
        : eq(tasks.key, target.taskKey!);
    const [task] = await tx
      .select({ id: tasks.id, key: tasks.key, status: tasks.githubStatus, requirementId: tasks.requirementId, projectId: tasks.projectId })
      .from(tasks)
      .where(where)
      .for("update")
      .limit(1);
    if (!task) return { changed: false };
    if (task.status === target.to) return { changed: false, taskKey: task.key, to: target.to };

    await tx.update(tasks).set({ githubStatus: target.to, updatedAt: new Date() }).where(eq(tasks.id, task.id));
    await emitEvent(tx, {
      type: "task.github_status_changed",
      subjectType: "task",
      subjectId: task.id,
      payload: { from: task.status, to: target.to },
      projectId: task.projectId ?? undefined,
    });

    // A merge can complete a requirement (→ shipped); a reopen can un-complete it
    // (→ building). Derived from the task that just changed, in the same tx.
    await reconcileRequirementStatus(tx, task.requirementId);

    return { changed: true, taskKey: task.key, to: target.to };
  });
}
