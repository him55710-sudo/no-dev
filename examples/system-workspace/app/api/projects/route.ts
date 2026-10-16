import { readProject, updateProject, type Project } from "@/features/sharing/service";
// Explicit test fixtures. This is not a production authentication implementation.
const project: Project = { id: "demo", title: "공유 프로젝트", members: { alice: "owner", bob: "editor", charlie: "viewer" } };
export function GET() { return Response.json(readProject(project, "charlie")); }
export async function PATCH(request: Request) {
  const { title } = await request.json();
  if (typeof title !== "string") return new Response("Invalid title", { status: 400 });
  return Response.json(updateProject(project, "charlie", title));
}
