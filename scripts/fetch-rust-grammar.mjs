// Optional maintainer command. Builds and installed products use the checked-in
// asset; they never download a grammar at runtime.
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const base = "https://github.com/tree-sitter/tree-sitter-rust";
const response = await fetch(`${base}/releases/download/v0.24.2/tree-sitter-rust.wasm`);
if (!response.ok) throw Error(`Grammar download: ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
const expected = "24c89bd9252255e4aebbcbd7d2d308bd92c86dd95a130fdc80efa49577b8d738";
if (createHash("sha256").update(bytes).digest("hex") !== expected)
  throw Error("Rust grammar SHA-256 mismatch");
const license = await fetch("https://raw.githubusercontent.com/tree-sitter/tree-sitter-rust/v0.24.2/LICENSE");
if (!license.ok) throw Error(`License download: ${license.status}`);
await mkdir("extension/runtime/rust", { recursive: true });
await writeFile("extension/runtime/rust/tree-sitter-rust.wasm", bytes);
await writeFile("extension/runtime/rust/LICENSE", await license.text());
console.log(`Verified tree-sitter-rust v0.24.2: ${bytes.length} bytes, ${expected}`);
