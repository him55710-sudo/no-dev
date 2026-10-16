import { canRead, canEdit, type MemberRole } from "./policy";
export type Project = {
  id: string;
  title: string;
  members: Record<string, MemberRole>;
};
export function readProject(project: Project, userId: string) {
  if (!canRead(project.members[userId])) throw new Error("Forbidden");
  return { id: project.id, title: project.title };
}
export function updateProject(project: Project, userId: string, title: string) {
  if (!canEdit(project.members[userId])) throw new Error("Forbidden");
  project.title = title;
  return readProject(project, userId);
}
