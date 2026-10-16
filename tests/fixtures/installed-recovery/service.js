import { canEdit } from "./policy.js";
export function updateProject(project, userId, title) {
  if (!canEdit(project.members[userId])) throw Error("Forbidden");
  project.title = title;
  return project;
}
export function readProject(project, userId) {
  if (!project.members[userId]) throw Error("Forbidden");
  return project.title;
}
