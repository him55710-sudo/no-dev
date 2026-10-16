import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";

export async function bundledNotices(inputs) {
  const roots = new Set();
  for (const input of inputs) {
    const path = input.replaceAll("\\", "/"),
      marker = "node_modules/",
      index = path.lastIndexOf(marker);
    if (index < 0) continue;
    const parts = path.slice(index + marker.length).split("/");
    roots.add(
      path.slice(0, index + marker.length) +
        parts.slice(0, parts[0].startsWith("@") ? 2 : 1).join("/"),
    );
  }
  // Prebundled libraries can hide runtime dependency inputs from esbuild.
  const queued = [...roots].map((root) => resolve(root));
  roots.clear();
  for (let i = 0; i < queued.length; i++) {
    const root = queued[i];
    if (roots.has(root)) continue;
    roots.add(root);
    const manifest = JSON.parse(
      await readFile(resolve(root, "package.json"), "utf8"),
    );
    const require = createRequire(resolve(root, "package.json"));
    for (const name of Object.keys(manifest.dependencies ?? {})) {
      let path;
      try {
        path = dirname(require.resolve(name + "/package.json"));
      } catch {
        path = dirname(require.resolve(name));
        while (true) {
          try {
            if (
              JSON.parse(await readFile(resolve(path, "package.json"), "utf8"))
                .name === name
            )
              break;
          } catch {
            /* Continue toward the package root. */
          }
          const parent = dirname(path);
          if (parent === path)
            throw Error(`Cannot locate license package: ${name}`);
          path = parent;
        }
      }
      queued.push(path);
    }
  }
  const packages = [];
  for (const root of roots) {
    const manifest = JSON.parse(
      await readFile(resolve(root, "package.json"), "utf8"),
    );
    const files = (await readdir(root))
      .filter((name) =>
        /^(?:licen[cs]e|copying|notice)(?:\.[^.]+)?$/i.test(name),
      )
      .sort();
    if (!files.length)
      throw Error(
        `Missing bundled license text: ${manifest.name}@${manifest.version}`,
      );
    const notices = await Promise.all(
      files.map(
        async (file) =>
          `${file}\n${await readFile(resolve(root, file), "utf8")}`,
      ),
    );
    packages.push({
      name: manifest.name,
      version: manifest.version,
      license: manifest.license,
      notices,
    });
  }
  packages.sort((a, b) => a.name.localeCompare(b.name));
  return packages
    .map(
      (pkg) =>
        `${pkg.name} ${pkg.version} (${typeof pkg.license === "string" ? pkg.license : "see license text"})\n${"=".repeat(72)}\n${pkg.notices.join("\n\n")}\n`,
    )
    .join("\n");
}
