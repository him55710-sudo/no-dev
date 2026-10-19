import { canEdit } from "./policy.js";
export function editControls(role) {
  const editable = canEdit(role);
  return { editable, reason: "" };
}
