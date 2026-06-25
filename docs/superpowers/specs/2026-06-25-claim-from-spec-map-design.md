# Claim tasks from the spec map — design

**Date:** 2026-06-25
**Status:** Approved (design); pending implementation plan
**Layer:** Surface `[3]` — adds a claim entry point to the spec-map requirement detail (REQ-010 claiming, surfaced via the REQ-017 spec map).

## Problem

Tasks can only be claimed from the `/tasks` board. After generating tasks from the spec-map requirement detail (the drawer that opens when you click a requirement), the user wants to **claim those tasks right there**, including the ones just generated — without bouncing to the board.

Two frictions today:
- The detail's task list (`requirement-detail.tsx`) shows key / title / "claimed" pill / issue link, but **no Claim control**. Claiming lives only in `/tasks` (`claim-button.tsx` → the `claim` action).
- After **Generate tasks**, `SpecGenerate` shows *"Generated N task(s) — refresh to see them."* The generated tasks don't appear in place because the detail renders inside an **intercepted drawer** (`@drawer/(.)spec/[key]`), which doesn't re-render on `revalidatePath` (the TASK-058 quirk).

## Decision (settled in brainstorming)

- **Inline & immediate**: after Generate, the new tasks render in place (claimable, no manual refresh).
- **Per-task** claiming only (no "claim all").
- **Reuse the claim domain unchanged** — `claimTask` (atomic, emits `task.claimed` in-tx) + the best-effort branch sweep. This is a Surface placement change, not a mechanism change.

## Architecture

### 1. Expose task ids (read-only data change) — `src/spec/detail.ts`
Add `id` to the task rows returned by `getRequirementDetail` and its `RequirementDetail.tasks` type. Both the static detail list and the post-generate inline list need the task id to claim. No other query change.

### 2. Generate action returns claimable tasks — `src/app/(app)/spec/[key]/actions.ts`
`generateTasksForRequirement`: on success, re-fetch the requirement's tasks (reuse the now-id-bearing `getRequirementDetail`) and return `tasks: { id, key, title, claimState }[]` in place of bare `taskKeys`. This feeds the inline render and sidesteps the drawer's no-auto-refresh entirely (the component renders from the action's returned data, not from a revalidated server fetch). `persistGenerationForRequirement` is **unchanged** (it still returns `taskKeys`); the action does the re-fetch.

### 3. Shared claim logic + a spec-scoped claim action
The truth model is preserved by reusing `claimTask`. To avoid duplicating the action body:

- **Extract a helper** `claimAndBranch(db, taskId, userId): Promise<{ claimed: boolean; branchCreated: boolean }>` from the existing `/tasks` `claim` action — it runs `claimTask` (→ `task.claimed` in-tx), then the best-effort `createBranchesForClaimedTasks` scoped to the task's project (REQ-011), then reads back `branch_created_at`. **No revalidation inside the helper** (that's action-specific). Lives in `src/tasks/actions.ts` (or a small sibling module).
- The existing **`claim`** action (`/tasks`) is refactored onto `claimAndBranch` (revalidates `/tasks`, `/dashboard` — unchanged behavior).
- A new **`claimFromSpec`** action (`spec/[key]/actions.ts`) calls `claimAndBranch` and revalidates `/spec`, `/spec/[key]`, `/dashboard`, `/tasks`. Returns the same `ClaimState` shape (`{ ok, branchCreated } | { ok:false, error }`).

### 4. Where it renders
- **`RequirementDetail`** (server, `requirement-detail.tsx`): for each task with `claimState === "unclaimed"`, render a compact Claim affordance (the spec claim control, fed `task.id`). `claimed` tasks keep the existing "claimed" pill.
- **`SpecGenerate`** (client, `spec-generate.tsx`): on `state.ok === true`, render the returned `tasks` inline (key, title, Claim) instead of the "refresh to see them" copy.
- **Claim control** — a small client component using `useActionState` against `claimFromSpec` (mirrors `ClaimButton`), reflecting "Claiming… / claimed" in place; used by both the static list and the inline list.

### 5. Styling
Compact, fitting the detail's ~13px density and the verdigris ledger aesthetic — not a heavy `primary` button per row. Execute with the **impeccable** / **ui-ux-pro-max** tooling, honoring the existing design system ([[design-system]]).

## Truth-model constraints

- Claiming still goes through `claimTask` — atomic `unclaimed→claimed`, `claim_user_id` + `branch_name` set, **`task.claimed` emitted in the same transaction**. No new event types, no new state.
- The branch sweep stays **best-effort, after** the claim tx (external call; REQ-011). A sweep failure leaves `branch_created_at` null for the next worker sweep — unchanged.
- `getRequirementDetail` and the generate re-fetch are **reads** (adding `id`, returning rows). No writes, no events.
- `github_status` untouched (still webhook-only).

## Error handling

- Lost claim race → `claimFromSpec` returns `{ ok:false, error: "Task is already claimed." }`; revalidates `/spec` so the row shows the real state (same as the `/tasks` action).
- Branch sweep failure → claim still holds; the control shows "claimed · branch not created — it'll retry" (same copy as `ClaimButton`).
- Generate failure → unchanged (`{ ok:false, error }`).

## Components

**New**
- `claimAndBranch` helper (shared by the two claim actions).
- `claimFromSpec` action (`spec/[key]/actions.ts`).
- A spec claim control client component (e.g. `spec-claim-button.tsx`).

**Modified**
- `src/spec/detail.ts` — `id` on task rows + type.
- `src/app/(app)/spec/[key]/actions.ts` — `generateTasksForRequirement` returns `tasks`; add `claimFromSpec`.
- `src/app/(app)/spec/requirement-detail.tsx` — Claim control per unclaimed task.
- `src/app/(app)/spec/spec-generate.tsx` — inline render of returned tasks with Claim.
- `src/app/(app)/tasks/actions.ts` — `claim` refactored onto `claimAndBranch`.

## Testing

- **`getRequirementDetail`** (pglite): each task row includes `id`; existing assertions hold; project-scoped.
- **The generate re-fetch shape** (pglite): after persisting tasks for a requirement, the returned `tasks` carry `id`, `key`, `title`, `claimState`. (Test the query/orchestration helper the action uses; the server action itself is auth-gated and verified at runtime.)
- **`claimAndBranch`** (pglite, injected/faked branch sweep): claims an unclaimed task (`claimed:true`, emits `task.claimed`), returns `claimed:false` on an already-claimed task — leaning on the well-tested `claimTask`.
- **`claim` action regression**: still behaves as before after the refactor (its existing coverage / a focused check).
- **UI** (`RequirementDetail`, `SpecGenerate`, the claim control): React rendering isn't unit-tested in this repo — verified at **runtime** in a signed-in browser (generate → tasks appear inline → claim one → shows claimed + branch).
- Register any new `*.test.ts` in the `package.json` `test` script.

## Scope / phasing (for the plan)

1. **Data** — `id` on `getRequirementDetail` tasks (+ test).
2. **Claim plumbing** — `claimAndBranch` helper + refactor `/tasks` `claim` onto it + `claimFromSpec` (+ helper test).
3. **Generate returns tasks** — `generateTasksForRequirement` re-fetch + return shape.
4. **UI** — claim control component; wire into `RequirementDetail` (static list) and `SpecGenerate` (inline); style with impeccable / ui-ux-pro-max.
5. **Verify** — suite + typecheck + build; runtime walkthrough of the full generate→claim flow.

## Requirement linkage

**REQ-010** (Task board & claiming) — the claim capability, surfaced on the spec map. Confirm during planning whether it ships under REQ-010 or warrants recognizing the spec-map placement under REQ-017 (surface, don't fold silently).

## Out of scope (YAGNI)

- "Claim all" (per-task only).
- Unclaim from the spec map.
- Any change to the claim mechanism, `task.claimed`, or the branch convention.
- Changing `persistGenerationForRequirement`'s return type (the action re-fetches instead).
