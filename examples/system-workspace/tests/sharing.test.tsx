import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectEditor } from "../components/ProjectEditor";
import {
  readProject,
  updateProject,
  type Project,
} from "../features/sharing/service";
import { GET } from "../app/api/projects/route";
const project = (): Project => ({
  id: "p1",
  title: "Original",
  members: { alice: "owner", bob: "editor", charlie: "viewer" },
});
describe("existing sharing behavior", () => {
  it("allows all three member roles to read", () => {
    for (const user of ["alice", "bob", "charlie"])
      expect(readProject(project(), user).title).toBe("Original");
  });
  it("preserves owner and editor updates", () => {
    for (const user of ["alice", "bob"])
      expect(updateProject(project(), user, "Edited").title).toBe("Edited");
  });
  it("rejects a user who is not a member of this project", () => {
    const other: Project = {
      id: "p2",
      title: "Other",
      members: { dave: "owner" },
    };
    expect(() => updateProject(other, "alice", "Forbidden")).toThrow(
      "Forbidden",
    );
    expect(other.title).toBe("Other");
  });
  it("renders editable controls for owner and editor", () => {
    for (const role of ["owner", "editor"] as const)
      expect(
        renderToStaticMarkup(<ProjectEditor role={role} title="Project" />),
      ).not.toContain("disabled");
  });
  it("serves the fixture viewer's read request", async () => {
    const response = GET();
    expect(response.status).toBe(200);
    expect((await response.json()).id).toBe("demo");
  });
});
