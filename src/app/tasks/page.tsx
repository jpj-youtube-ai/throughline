import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { getDb } from "@/db/client";
import { listTasks } from "@/tasks/queries";
import { claimTask, unclaimTask } from "@/tasks/claim";

export const dynamic = "force-dynamic";

async function claim(formData: FormData) {
  "use server";
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in.");
  await claimTask(getDb(), String(formData.get("taskId")), session.user.id);
  revalidatePath("/tasks");
}

async function unclaim(formData: FormData) {
  "use server";
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in.");
  await unclaimTask(getDb(), String(formData.get("taskId")), session.user.id);
  revalidatePath("/tasks");
}

export default async function TasksPage() {
  const session = await auth();
  const tasks = await listTasks(getDb());

  return (
    <main style={{ padding: 32, maxWidth: 760 }}>
      <h1>Tasks</h1>
      <p>
        <a href="/ideas">← Ideas</a>
      </p>
      {tasks.length === 0 ? (
        <p>No tasks yet — they appear once an approved idea is generated.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 16 }}>
          {tasks.map((t) => (
            <li key={t.id} style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <span>
                  <strong>{t.key}</strong> {t.title}
                </span>
                <a href={`/spec#${t.requirementKey}`} style={{ whiteSpace: "nowrap" }}>
                  {t.requirementKey}
                </a>
              </div>
              <small style={{ color: "#666" }}>
                effort {t.effort} · risk {t.risk} · confidence {t.confidence} ·{" "}
                <span style={{ color: t.githubStatus === "closed" ? "#137333" : "#666" }}>{t.githubStatus}</span>
                {t.githubIssueUrl && (
                  <>
                    {" "}
                    · <a href={t.githubIssueUrl}>issue</a>
                  </>
                )}
              </small>
              <div style={{ marginTop: 8 }}>
                {t.claimState === "claimed" ? (
                  <span style={{ color: "#666" }}>
                    Claimed by <strong>{t.claimerLogin}</strong> · <code>{t.branchName}</code>
                    {session?.user?.login && session.user.login === t.claimerLogin && (
                      <form action={unclaim} style={{ display: "inline", marginLeft: 8 }}>
                        <input type="hidden" name="taskId" value={t.id} />
                        <button type="submit">Unclaim</button>
                      </form>
                    )}
                  </span>
                ) : session?.user?.id ? (
                  <form action={claim}>
                    <input type="hidden" name="taskId" value={t.id} />
                    <button type="submit">Claim</button>
                  </form>
                ) : (
                  <small>
                    <a href="/">sign in</a> to claim
                  </small>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
