// The Throughline data model (SPEC §3). Defined in one place; the event-write
// helper (emitEvent) and every state write share this schema and a transaction.
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  bigint,
  bigserial,
  jsonb,
  timestamp,
  unique,
  customType,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() { return "bytea"; },
});

export const requirementStatus = pgEnum("requirement_status", ["planned", "building", "shipped"]);
export const provenance = pgEnum("provenance", ["imported", "voted", "drift"]);
export const ideaState = pgEnum("idea_state", ["scratch", "voting", "approved", "rejected", "generated"]);
export const riskLevel = pgEnum("risk_level", ["low", "med", "high"]);
export const claimState = pgEnum("claim_state", ["unclaimed", "claimed"]);
export const githubStatus = pgEnum("github_status", ["open", "closed"]);
export const driftStatus = pgEnum("drift_status", ["open", "resolved"]);
export const driftResolution = pgEnum("drift_resolution", ["new_req", "out_of_scope", "relink"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  githubId: bigint("github_id", { mode: "number" }).notNull().unique(),
  githubLogin: text("github_login").notNull(),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  activeProjectId: uuid("active_project_id").references(() => project.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Multi-project: each row is one bound repo.
export const project = pgTable("project", {
  id: uuid("id").primaryKey().defaultRandom(),
  repoFullName: text("repo_full_name").notNull(),
  defaultBranch: text("default_branch").notNull(),
  installationId: bigint("installation_id", { mode: "number" }).notNull(),
  localClonePath: text("local_clone_path").notNull(),
  specPath: text("spec_path").notNull().default("SPEC.md"),
  claudeMdPath: text("claude_md_path").notNull().default("CLAUDE.md"),
  conventionVersion: integer("convention_version").notNull().default(1),
  // Always-include paths/globs for the generation slice (REQ-008). Operator-curated.
  contextPins: jsonb("context_pins").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique("project_repo_full_name_unique").on(t.repoFullName)]);

export const requirements = pgTable("requirements", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull(), // REQ-NNN — unique per project (see table extras)
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  diagramHtml: text("diagram_html"), // derived conceptual-diagram cache (REQ-017); regenerable, no event
  status: requirementStatus("status").notNull().default("planned"),
  provenance: provenance("provenance").notNull(),
  originIdeaId: uuid("origin_idea_id").references(() => ideas.id),
  projectId: uuid("project_id").notNull().references(() => project.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique("requirements_project_key_unique").on(t.projectId, t.key)]);

export const ideas = pgTable("ideas", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  why: text("why"), // mandatory once promoted from scratch (enforced in app logic)
  feasibility: integer("feasibility"), // 1-10
  viability: integer("viability"), // 1-10
  authorId: uuid("author_id").notNull().references(() => users.id),
  state: ideaState("state").notNull(),
  projectId: uuid("project_id").notNull().references(() => project.id),
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const votes = pgTable(
  "votes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ideaId: uuid("idea_id").notNull().references(() => ideas.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("votes_idea_user_unique").on(t.ideaId, t.userId)],
);

export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull(), // TASK-NNN — unique per project (see table extras)
  title: text("title").notNull(),
  body: text("body").notNull(), // Claude Code pointers
  requirementId: uuid("requirement_id").notNull().references(() => requirements.id),
  originIdeaId: uuid("origin_idea_id").references(() => ideas.id),
  effort: integer("effort").notNull(), // 1-5
  risk: riskLevel("risk").notNull(),
  confidence: integer("confidence").notNull(), // 0-100
  claimUserId: uuid("claim_user_id").references(() => users.id),
  claimState: claimState("claim_state").notNull().default("unclaimed"),
  branchName: text("branch_name"),
  githubIssueNumber: integer("github_issue_number"),
  githubIssueUrl: text("github_issue_url"),
  previewHtml: text("preview_html"),
  previewImage: bytea("preview_image"),
  // Mirrored from GitHub only -- written exclusively by the webhook handler.
  githubStatus: githubStatus("github_status").notNull().default("open"),
  branchCreatedAt: timestamp("branch_created_at", { withTimezone: true }),
  // When we closed the task's GitHub issue after its PR merged (REQ-009).
  // Outbound-action bookkeeping, written ONLY by the worker close sweep — this is
  // NOT github_status (which stays webhook-only) and emits no event.
  issueClosedAt: timestamp("issue_closed_at", { withTimezone: true }),
  projectId: uuid("project_id").notNull().references(() => project.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique("tasks_project_key_unique").on(t.projectId, t.key)]);

export const driftFlags = pgTable("drift_flags", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id").notNull().references(() => tasks.id),
  prNumber: integer("pr_number").notNull(),
  unmappedItems: jsonb("unmapped_items").$type<unknown>().notNull(),
  status: driftStatus("status").notNull().default("open"),
  resolution: driftResolution("resolution"),
  resolvedBy: uuid("resolved_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

// The log. Append-only -- source of truth for intent and causal history.
// No code path updates or deletes this table (enforced by DB trigger too).
export const events = pgTable("events", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: text("type").notNull(),
  actorId: uuid("actor_id"), // null = system
  subjectType: text("subject_type").notNull(),
  subjectId: uuid("subject_id"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  rationale: text("rationale"),
  projectId: uuid("project_id").notNull().references(() => project.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // Monotonic total order -- created_at alone ties within a transaction (shared
  // now()), so the activity feed and narrative order by seq (REQ-019).
  seq: bigserial("seq", { mode: "number" }).notNull(),
});

export const narratives = pgTable("narratives", {
  id: uuid("id").primaryKey().defaultRandom(),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  eventCount: integer("event_count").notNull(),
  content: jsonb("content").$type<unknown>().notNull(),
  roadmapHtml: text("roadmap_html"),
  projectId: uuid("project_id").notNull().references(() => project.id),
});
