import type { SourceFile } from "./types";
export const limits = {
  maxFiles: 300,
  maxFileBytes: 512 * 1024,
  maxTotalBytes: 8 * 1024 * 1024,
};
export function eligible(path: string) {
  return (
    !path
      .split(/[\\/]/)
      .some(
        (p) =>
          p.startsWith(".") ||
          ["node_modules", "dist", "build", "coverage", "vendor"].includes(p),
      ) &&
    /\.(?:[cm]?[jt]sx?|jsonc?|css|html|md|py|ya?ml|txt)$/i.test(path) &&
    !/(?:pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$/i.test(path)
  );
}
export async function readFiles(inputs: File[]) {
  const files: SourceFile[] = [];
  const skipped: string[] = [];
  let total = 0;
  const paths = inputs.map((f) => f.webkitRelativePath || f.name);
  const root = paths[0]?.includes("/") ? paths[0].split("/")[0] + "/" : "";
  const sharedRoot = !!root && paths.every((p) => p.startsWith(root));
  for (let i = 0; i < inputs.length; i++) {
    const f = inputs[i];
    const path = sharedRoot ? paths[i].slice(root.length) : paths[i];
    if (!eligible(path)) {
      skipped.push(path);
      continue;
    }
    if (
      f.size > limits.maxFileBytes ||
      total + f.size > limits.maxTotalBytes ||
      files.length >= limits.maxFiles
    ) {
      skipped.push(path + " (크기 제한 / size limit)");
      continue;
    }
    const content = await f.text();
    if (content.includes("\0")) {
      skipped.push(path + " (binary)");
      continue;
    }
    if (files.some((x) => x.path === path)) {
      skipped.push(path + " (duplicate)");
      continue;
    }
    files.push({ path, content });
    total += f.size;
  }
  return { files, skipped };
}
