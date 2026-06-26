import { and, eq, isNull, isNotNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { tasks, project } from "../db/schema";
import { openIssue as realOpenIssue, closeIssue as realCloseIssue } from "./app";
import { listProjects } from "../project/list";
import { generatePreviewHtml } from "../preview/generate";
import { renderHtmlToPng } from "../preview/render";
import { loadTaskPrototypes } from "@/prototypes/store";
import { slugify } from "@/prototypes/slug";
import { loadIdeaPhotos } from "@/ideas/photos";

export type OpenIssueFn = (
  installationId: number,
  repoFullName: string,
  title: string,
  body: string,
) => Promise<{ number: number; url: string }>;

export interface CreateIssuesResult {
  created: string[]; // task keys that got an issue this run
}

export interface PreviewDeps {
  generatePreview?: typeof generatePreviewHtml;
  renderPng?: typeof renderHtmlToPng;
  baseUrl?: string;
}

/**
 * Create a GitHub issue for each task that doesn't have one yet (REQ-009), via
 * the App, and store github_issue_number/url. Idempotent. Runs AFTER the tasks
 * are committed (never inside a DB transaction — an external call can't be rolled
 * back). The board stores the issue ref but never the status (that's webhook-only).
 *
 * `projectId` is optional: when omitted, resolves the oldest project (so existing
 * worker callers keep working without changes).
 */
export async function createIssuesForTasks(
  db: Db,
  projectId?: string,
  openIssue: OpenIssueFn = realOpenIssue,
  previewDeps: PreviewDeps = {},
): Promise<CreateIssuesResult> {
  let resolvedProjectId: string;
  if (projectId) {
    resolvedProjectId = projectId;
  } else {
    const projects = await listProjects(db);
    if (projects.length === 0) throw new Error("No project bound (REQ-002).");
    resolvedProjectId = projects[0].id;
  }

  const [proj] = await db.select().from(project).where(eq(project.id, resolvedProjectId)).limit(1);
  if (!proj) throw new Error(`Project ${resolvedProjectId} not found (REQ-002).`);

  const pending = await db
    .select({ id: tasks.id, key: tasks.key, title: tasks.title, body: tasks.body, originIdeaId: tasks.originIdeaId })
    .from(tasks)
    .where(and(isNull(tasks.githubIssueNumber), eq(tasks.projectId, resolvedProjectId)));

  const generatePreview = previewDeps.generatePreview ?? generatePreviewHtml;
  const renderPng = previewDeps.renderPng ?? renderHtmlToPng;
  const baseUrl = previewDeps.baseUrl ?? process.env.PUBLIC_BASE_URL;

  const photoSectionByIdea = new Map<string, string>();
  async function ideaPhotoSection(ideaId: string): Promise<string> {
    if (!baseUrl) return "";
    const cached = photoSectionByIdea.get(ideaId);
    if (cached !== undefined) return cached;
    const photos = await loadIdeaPhotos(db, ideaId);
    const section = photos.length
      ? "\n\n## Attached photos\n" + photos.map((p) => `![photo](${baseUrl}/idea-photo/${p.id})`).join("\n")
      : "";
    photoSectionByIdea.set(ideaId, section);
    return section;
  }

  const created: string[] = [];
  for (const t of pending) {
    let bodyPrefix = "";
    if (baseUrl) {
      try {
        const html = await generatePreview({ key: t.key, title: t.title, body: t.body });
        if (html) {
          const png = await renderPng(html);
          await db.update(tasks).set({ previewHtml: html, previewImage: png }).where(eq(tasks.id, t.id));
          bodyPrefix = `![preview](${baseUrl}/preview/${t.id}.png)\n\n`;
        }
      } catch (e) {
        console.error(`[issues] preview failed for ${t.key}:`, e instanceof Error ? e.message : e);
      }
    }
    const protos = await loadTaskPrototypes(db, t.id);
    const designSection = protos.length
      ? "\n\n## Design prototype\nBuild the UI to match the design prototype(s) committed to this task's branch:\n" +
        protos.map((p) => `- **${p.label}** → \`prototypes/${slugify(p.label)}.html\``).join("\n")
      : "";
    const photoSection = t.originIdeaId ? await ideaPhotoSection(t.originIdeaId) : "";
    const issue = await openIssue(proj.installationId, proj.repoFullName, `[${t.key}] ${t.title}`, bodyPrefix + t.body + designSection + photoSection);
    await db
      .update(tasks)
      .set({ githubIssueNumber: issue.number, githubIssueUrl: issue.url, updatedAt: new Date() })
      .where(eq(tasks.id, t.id));
    created.push(t.key);
  }
  return { created };
}

export type CloseIssueFn = (
  installationId: number,
  repoFullName: string,
  issueNumber: number,
) => Promise<void>;

export interface CloseIssuesResult {
  closed: string[]; // task keys whose issue we closed this run
}

/**
 * Close the GitHub issue for each task whose PR has merged (REQ-009) — i.e. the
 * webhook has mirrored github_status to 'closed' — that we haven't closed yet.
 * Runs AFTER any tx (an external call can't be rolled back). Idempotent and
 * self-healing: issue_closed_at is stamped only on success, so a failure retries
 * next tick. Closing an already-closed issue is a harmless GitHub no-op.
 *
 * issue_closed_at is outbound-action bookkeeping (like github_issue_number) — it
 * is NOT github_status (webhook-only) and emits no event.
 *
 * `projectId` is optional: when omitted, resolves the oldest project (parity with
 * createIssuesForTasks).
 */
export async function closeIssuesForMergedTasks(
  db: Db,
  projectId?: string,
  closeIssue: CloseIssueFn = realCloseIssue,
): Promise<CloseIssuesResult> {
  let resolvedProjectId: string;
  if (projectId) {
    resolvedProjectId = projectId;
  } else {
    const projects = await listProjects(db);
    if (projects.length === 0) throw new Error("No project bound (REQ-002).");
    resolvedProjectId = projects[0].id;
  }

  const [proj] = await db.select().from(project).where(eq(project.id, resolvedProjectId)).limit(1);
  if (!proj) throw new Error(`Project ${resolvedProjectId} not found (REQ-002).`);

  const pending = await db
    .select({ id: tasks.id, key: tasks.key, issueNumber: tasks.githubIssueNumber })
    .from(tasks)
    .where(
      and(
        eq(tasks.projectId, resolvedProjectId),
        eq(tasks.githubStatus, "closed"),
        isNotNull(tasks.githubIssueNumber),
        isNull(tasks.issueClosedAt),
      ),
    );

  const closed: string[] = [];
  for (const t of pending) {
    try {
      // issueNumber is non-null here: the isNotNull(githubIssueNumber) filter above guarantees it.
      await closeIssue(proj.installationId, proj.repoFullName, t.issueNumber!);
      await db
        .update(tasks)
        .set({ issueClosedAt: new Date(), updatedAt: new Date() })
        .where(eq(tasks.id, t.id));
      closed.push(t.key);
    } catch (e) {
      console.error(`[issues] close failed for ${t.key}:`, e instanceof Error ? e.message : e);
    }
  }
  return { closed };
}
