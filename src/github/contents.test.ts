import test from "node:test";
import assert from "node:assert/strict";
import { commitFileToBranch, type ContentsClient } from "./contents";

function fakeClient(existing: { content?: string; sha?: string } | { status: 404 }): { client: ContentsClient; puts: any[] } {
  const puts: any[] = [];
  const client: ContentsClient = {
    rest: { repos: {
      getContent: async () => { if ("status" in existing) throw Object.assign(new Error("nf"), { status: 404 }); return { data: { sha: existing.sha!, content: Buffer.from(existing.content!, "utf8").toString("base64") } }; },
      createOrUpdateFileContents: async (p) => { puts.push(p); return {}; },
    } },
  };
  return { client, puts };
}

test("creates the file when absent (404)", async () => {
  const { client, puts } = fakeClient({ status: 404 });
  const r = await commitFileToBranch(1, "a/b", "task-1", "prototypes/x.html", "<h1>x</h1>", "msg", client);
  assert.equal(r.committed, true);
  assert.equal(puts.length, 1);
  assert.equal(puts[0].branch, "task-1");
  assert.equal(Buffer.from(puts[0].content, "base64").toString("utf8"), "<h1>x</h1>");
  assert.equal(puts[0].sha, undefined);
});

test("skips when the file already has identical content", async () => {
  const { client, puts } = fakeClient({ content: "<h1>x</h1>", sha: "abc" });
  const r = await commitFileToBranch(1, "a/b", "task-1", "prototypes/x.html", "<h1>x</h1>", "msg", client);
  assert.equal(r.committed, false);
  assert.equal(puts.length, 0);
});

test("updates with the blob sha when content differs", async () => {
  const { client, puts } = fakeClient({ content: "<h1>old</h1>", sha: "abc" });
  const r = await commitFileToBranch(1, "a/b", "task-1", "prototypes/x.html", "<h1>new</h1>", "msg", client);
  assert.equal(r.committed, true);
  assert.equal(puts[0].sha, "abc");
} );
