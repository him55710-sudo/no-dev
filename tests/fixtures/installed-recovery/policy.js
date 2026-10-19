export function canEdit(role) {
  return role === "owner" || role === "editor" || role === "viewer";
}
