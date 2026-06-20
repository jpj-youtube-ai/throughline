import { pgTable, uuid, text, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";

export const riskEnum = pgEnum("risk", ["low", "med", "high"]);
export const claimStateEnum = pgEnum("claim_state", ["unclaimed", "claimed"]);
export const githubStatusEnum = pgEnum("github_status", ["open", "closed"]);

export const requirements = pgTable("requirements", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(), // REQ-NNN
  title: text("title").notNull(),
});

export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(), // TASK-NNN
  title: text("title").notNull(),
  body: text("body").notNull(),
  requirementId: uuid("requirement_id")
    .notNull()
    .references(() => requirements.id),
  // The three metrics already live on the task record.
  effort: integer("effort").notNull(), // 1-5
  risk: riskEnum("risk").notNull(),
  confidence: integer("confidence").notNull(), // 0-100
  claimUserId: uuid("claim_user_id"),
  claimState: claimStateEnum("claim_state").notNull().default("unclaimed"),
  branchName: text("branch_name"),
  githubIssueNumber: integer("github_issue_number"),
  // Mirrored from GitHub only — never written by app logic.
  githubStatus: githubStatusEnum("github_status").notNull().default("open"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type TaskRecord = typeof tasks.$inferSelect;
