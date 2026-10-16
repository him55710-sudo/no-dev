import { canEdit, type MemberRole } from "@/features/sharing/policy";
export function ProjectEditor({ role, title }: { role: MemberRole; title: string }) {
  const editable = canEdit(role);
  return <section><h1>{title}</h1><input defaultValue={title} disabled={!editable} /><button disabled={!editable}>프로젝트 수정</button></section>;
}
