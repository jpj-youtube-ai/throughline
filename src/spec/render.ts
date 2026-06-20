export interface SpecRequirement {
  key: string;
  title: string;
  description: string;
  status: "planned" | "building" | "shipped";
}

export interface SpecTaskRef {
  key: string;
  title: string;
  requirementKey: string;
}

// Render the requirements into the two-horizon SPEC.md projection (REQ-012):
// shipped vs planned/building, each with its linked tasks. Pure — the board
// materializes this from the requirement log; it is never hand-edited.
export function renderSpec(reqs: SpecRequirement[], tasks: SpecTaskRef[]): string {
  const tasksByReq = new Map<string, SpecTaskRef[]>();
  for (const t of tasks) {
    const list = tasksByReq.get(t.requirementKey) ?? [];
    list.push(t);
    tasksByReq.set(t.requirementKey, list);
  }

  const byKey = (a: SpecRequirement, b: SpecRequirement) => a.key.localeCompare(b.key);
  const shipped = reqs.filter((r) => r.status === "shipped").sort(byKey);
  const planned = reqs.filter((r) => r.status === "planned" || r.status === "building").sort(byKey);

  const renderReq = (r: SpecRequirement): string => {
    const lines = [`### ${r.key} — ${r.title}`];
    if (r.description.trim()) lines.push("", r.description.trim());
    const ts = (tasksByReq.get(r.key) ?? []).slice().sort((a, b) => a.key.localeCompare(b.key));
    if (ts.length) {
      lines.push("", "Tasks:");
      for (const t of ts) lines.push(`- ${t.key} — ${t.title}`);
    }
    return lines.join("\n");
  };

  const section = (title: string, list: SpecRequirement[]): string =>
    `## ${title} (${list.length})\n\n` + (list.length ? list.map(renderReq).join("\n\n") : "_None yet._");

  return [
    "<!-- Generated projection — do not hand-edit. Materialized from the requirement log (REQ-012). -->",
    "",
    "# Throughline — Specification",
    "",
    section("Shipped", shipped),
    "",
    section("Planned", planned),
    "",
  ].join("\n");
}
