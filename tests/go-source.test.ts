import { beforeAll, describe, expect, it } from "vitest";
import { resolve, join } from "node:path";
import { readFile, access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { goSource } from "../extension/src/goSource";
import type { FileAnalysis, Patch } from "../src/core/types";
import { storyLines } from "../src/core/storyReport";
import { parseRequest } from "../src/core/ruleRequest";
const script = resolve("extension/runtime/go_source.go"),
  cache = resolve("test-results/go-source-core-cache"),
  executable = process.env.PUREOBOM_TEST_GO || "go";
const analyze = (content: string) =>
  goSource(
    { path: "sample.go", content },
    script,
    cache,
    { action: "analyze" },
    { executable },
  ) as Promise<FileAnalysis>;
const patch = (content: string, ruleId: string, value: string) =>
  goSource(
    { path: "sample.go", content },
    script,
    cache,
    { action: "patch", ruleId, value },
    { executable },
  ) as Promise<Patch>;
beforeAll(async () => {
  await analyze("package sample\nvar count = 1\n");
}, 90000);
describe("Go standard-library source reader", () => {
  it("reads actual shipping branches and every return expression without inventing an exception or currency", async () => {
    const a = await analyze(
      await readFile("examples/local-ai/shipping.go", "utf8"),
    );
    expect(a.go?.version).toMatch(/^go1\./);
    expect(a.syntaxValid).toBe(true);
    const text = storyLines(a.functions[0].steps, "en").join("\n");
    expect(text).toContain("subtotal < 0");
    expect(text).toContain('0, errors.New("negative subtotal")');
    expect(text).toContain("subtotal >= 50000");
    expect(text).toContain("3000, nil");
    expect(a.functions[0].note?.en).toContain(
      "not an automatically thrown exception",
    );
    expect(a.functions[0].simulatable).toBe(false);
    expect(JSON.stringify(a)).not.toMatch(/won|KRW|₩/);
  });
  it("separates initialization, deferred calls, goroutines, switch/type switch/select and named returns", async () => {
    const a = await analyze(`package demo
func work(x any) (result int, err error) {
 defer cleanup(result)
 go launch(result)
 if n := 2; n > 0 { result = n } else { result = 0 }
 for i := 0; i < 3; i++ { if i == 1 { continue } }
 for range 3 { }
 for k := range items { use(k) }
 for k, v := range items { use(k, v) }
 switch result { case 1, 2: result++; fallthrough; default: result-- }
 switch v := x.(type) { case int: result = v; default: result = 0 }
 select { case channel <- result: result++; default: result-- }
 return
}
func empty() {}
`);
    expect(a.syntaxValid).toBe(true);
    const lines = storyLines(a.functions[0].steps, "en").join("\n");
    expect(lines).toContain("arguments now");
    expect(lines).toContain("reverse order");
    expect(lines).toContain("another goroutine");
    expect(lines.indexOf("n := 2")).toBeLessThan(
      lines.indexOf("If the condition"),
    );
    expect(lines).toContain("Post statement after");
    expect(lines).toContain("Range loop: range 3.");
    expect(lines).toContain("Range loop: k := range items.");
    expect(lines).toContain("Range loop: k, v := range items.");
    expect(lines).not.toContain("ILLEGAL");
    expect(lines).toContain("no implicit fallthrough");
    expect(lines).toContain("Type switch");
    expect(lines).toContain("pseudo-randomly");
    expect(lines).toContain("no explicit expressions");
    expect(a.functions).toHaveLength(2);
  });
  it("keeps byte/UTF-16 positions, raw-string CRLF and physical lines despite line directives", async () => {
    const source =
      'package demo\r\n//line pretend.go:900\r\nvar 이름 = "😀"; var count = 9007199254740993\r\nvar message = `first\r\nsecond`\r\n';
    const a = await analyze(source);
    expect(a.rules.map((r) => r.line)).toEqual([3, 3, 4]);
    expect(a.rules[1].value).toBe("9007199254740993");
    for (const r of a.rules) expect(source.slice(r.start, r.end)).toBe(r.raw);
    expect(a.rules[2].raw).toBe("`first\r\nsecond`");
    expect(a.rules[2].value).toBe("first\nsecond");
    const p = await patch(source, a.rules[1].id, "9007199254740995");
    expect(p.updated).toBe(
      source.replace("9007199254740993", "9007199254740995"),
    );
    expect(p.semanticChecked).toBe(false);
    const updated = await patch(source, a.rules[2].id, 'new😀\n"\\\u0000');
    expect((await analyze(updated.updated)).rules[2].value).toBe(
      'new😀\n"\\\u0000',
    );
    expect(updated.updated).toContain("count = 9007199254740993\r\n");
  });
  it("edits exact numeric forms and rejects expressions, comments, runes, byte strings and shadowable bool identifiers", async () => {
    const source =
      "package demo\nconst count = -0xCA_FE\nvar ratio = 0x1.8p+2\nvar enabled = true\nvar weird = \"\\xff\"\nvar runeValue = 'x'\nvar commented = - /*keep*/ 2\n";
    const a = await analyze(source);
    expect(a.rules.map((r) => r.name)).toEqual(["count", "ratio"]);
    const request = parseRequest("change ratio to 0x1.fp+3", a.rules);
    expect((await patch(source, request.rule.id, request.value)).newText).toBe(
      "0x1.fp+3",
    );
    for (const n of ["0b1010_0011", "-0123", "+0o777", "1.25e-3"])
      expect((await patch(source, a.rules[0].id, n)).newText).toBe(n);
    for (const n of [
      "1+2",
      "3 // comment",
      "3/*comment*/",
      "- /*comment*/ 3",
      "(3)",
      "true",
      "2i",
      "0xZZ",
      "count()",
    ])
      await expect(patch(source, a.rules[0].id, n)).rejects.toThrow();
    await expect(patch(source, "go:9999", "3")).rejects.toThrow(
      /current editable/,
    );
  }, 20000);
  it("does not execute user imports, init functions, go generate directives or project environment hooks", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pureobom-go-inert-"));
    const previous = {
      GOFLAGS: process.env.GOFLAGS,
      GOENV: process.env.GOENV,
      GOTOOLCHAIN: process.env.GOTOOLCHAIN,
    };
    try {
      const marker = join(dir, "executed.txt");
      process.env.GOFLAGS = "-invalid-project-flag";
      process.env.GOENV = join(dir, "absent-go-env");
      process.env.GOTOOLCHAIN = "go99.0.0";
      const source = `package demo\nimport "os"\n//go:generate never-run-this\nfunc init() { os.WriteFile(${JSON.stringify(marker)}, []byte("executed"), 0600) }\n`;
      expect((await analyze(source)).syntaxValid).toBe(true);
      await expect(access(marker)).rejects.toThrow();
    } finally {
      for (const [k, v] of Object.entries(previous)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("reports syntax failures without claiming type/scope checking, and bounds large output", async () => {
    const invalid = await analyze("package demo\nfunc broken( {\n");
    expect(invalid.syntaxValid).toBe(false);
    expect(invalid.rules).toEqual([]);
    expect(invalid.issues[0].line).toBe(2);
    // go/parser intentionally accepts declarations that a type checker rejects.
    expect(
      (await analyze('package demo\nvar count int = "wrong type"\n'))
        .syntaxValid,
    ).toBe(true);
    const many = await analyze(
      "package demo\n" +
        Array.from({ length: 600 }, (_, i) => `var value${i} = ${i}`).join(
          "\n",
        ),
    );
    expect(many.go?.truncated).toBe(true);
    expect(many.rules).toHaveLength(300);
    expect(many.steps.length).toBeLessThanOrEqual(400);
    await expect(analyze("/".repeat(128 * 1024 + 1))).rejects.toThrow(/128KiB/);
  });
  it("reports a missing tool, cancellation and timeout explicitly", async () => {
    const file = { path: "sample.go", content: "package demo\n" };
    await expect(
      goSource(
        file,
        script,
        cache,
        { action: "analyze" },
        { executable: "pureobom-no-such-go" },
      ),
    ).rejects.toThrow(/Go unavailable/);
    const signal = new AbortController();
    const pending = goSource(
      file,
      script,
      cache,
      { action: "analyze" },
      { executable, signal: signal.signal },
    );
    signal.abort();
    await expect(pending).rejects.toThrow(/cancelled/);
    await expect(
      goSource(
        file,
        script,
        cache,
        { action: "analyze" },
        { executable, timeoutMs: 1 },
      ),
    ).rejects.toThrow(/timed out/);
  });
});
