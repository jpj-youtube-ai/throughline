import test from "node:test";
import assert from "node:assert/strict";
import { pushClone } from "./commit";

test("pushClone pushes HEAD:<branch> to the token-authenticated origin url", async () => {
  const calls: { args: string[]; cwd: string }[] = [];
  await pushClone("/clones/acme__repo", "acme/repo", 42, "main", {
    getToken: async (id) => `tok-${id}`,
    run: (args, cwd) => calls.push({ args, cwd }),
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cwd, "/clones/acme__repo");
  assert.deepEqual(calls[0].args, ["push", "https://x-access-token:tok-42@github.com/acme/repo.git", "HEAD:main"]);
});

test("pushClone propagates a git failure", async () => {
  await assert.rejects(
    pushClone("/c", "o/r", 1, "main", {
      getToken: async () => "t",
      run: () => { throw new Error("push rejected"); },
    }),
    /push rejected/,
  );
});
