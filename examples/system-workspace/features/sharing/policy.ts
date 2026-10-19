export type MemberRole = "owner" | "editor" | "viewer";
export function canRead(role: MemberRole | undefined) {
  return role !== undefined;
}
export function canEdit(role: MemberRole | undefined) {
  // Baseline policy: every project member can edit. The design task changes this.
  return role !== undefined;
}
