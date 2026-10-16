import { test } from "node:test";
import assert from "node:assert/strict";
import { readProject, updateProject } from "./service.js";
import { editControls } from "./ui.js";
const project = () => ({
  title: "before",
  members: { alice: "owner", bob: "editor", charlie: "viewer" },
});
test("viewer reads but cannot edit; denied request preserves data", () => {
  const item = project(),
    before = structuredClone(item);
  assert.equal(readProject(item, "charlie"), "before");
  assert.throws(
    () => updateProject(item, "charlie", "denied"),
    (error) => error.status === 403,
  );
  assert.deepEqual(item, before);
});
for (const user of ["alice", "bob"])
  test(`${user} retains editing`, () => {
    assert.equal(updateProject(project(), user, "after").title, "after");
  });
test("membership in another project does not grant access", () => {
  const item = { title: "separate", members: { someone: "owner" } };
  assert.throws(
    () => updateProject(item, "alice", "denied"),
    (error) => error.status === 403,
  );
  assert.equal(item.title, "separate");
});
test("viewer controls are disabled with an explanation", () => {
  assert.deepEqual(editControls("viewer"), {
    editable: false,
    reason: "읽기 전용",
  });
  assert.equal(editControls("editor").editable, true);
  assert.equal(editControls("owner").editable, true);
});
