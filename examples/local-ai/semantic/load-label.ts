export async function loadLabel(
  id: string,
  fetcher: (id: string) => Promise<string | undefined>,
) {
  if (!id.trim()) return "missing";
  const label = await fetcher(id);
  return label ?? "untitled";
}
