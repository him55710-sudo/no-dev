import { beforeAll, describe, expect, it } from "vitest";
import { resolve, join } from "node:path";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { javaSource } from "../extension/src/javaSource";
import type { FileAnalysis, Patch } from "../src/core/types";
import { storyLines } from "../src/core/storyReport";
import { parseRequest } from "../src/core/ruleRequest";

const script = resolve("extension/runtime/PureobomJavaSource.java");
const cache = resolve("test-results/java-source-core-cache");
const javaHome = process.env.PUREOBOM_TEST_JAVA_HOME;
const analyze = (content: string) =>
  javaSource(
    { path: "Demo.java", content },
    script,
    cache,
    { action: "analyze" },
    { javaHome },
  ) as Promise<FileAnalysis>;
const patch = (content: string, ruleId: string, value: string) =>
  javaSource(
    { path: "Demo.java", content },
    script,
    cache,
    { action: "patch", ruleId, value },
    { javaHome },
  ) as Promise<Patch>;
beforeAll(async () => {
  await analyze("class Demo { int value = 1; }");
}, 90000);

describe("Java JDK source reader", () => {
  it("preserves Java literal suffixes and radix/exponent spelling in a natural-language request", async () => {
    const source = "class Demo { long limit = 9007199254740993L; }";
    const a = await analyze(source);
    const request = parseRequest("change limit to 9007199254740995L", a.rules);
    expect((await patch(source, request.rule.id, request.value)).updated).toBe(
      source.replace("9007199254740993L", "9007199254740995L"),
    );
    for (const value of [
      "0xFFL",
      "0b101L",
      "077L",
      "+1_234L",
      "-2.5e-3f",
      "0x1.0p2D",
      ".5F",
    ])
      expect(parseRequest(`change limit to ${value}`, a.rules).value).toBe(
        value,
      );
    expect(() => parseRequest("limit 2L or 3L", a.rules)).toThrow(
      /exactly one/,
    );
    expect(() => parseRequest("limit 3wrong", a.rules)).toThrow(/exactly one/);
  });
  it("reads shipping branches, a conditional result and an explicit throw without inferred currency or runtime success", async () => {
    const a = await analyze(
      await readFile("examples/local-ai/Shipping.java", "utf8"),
    );
    expect(a.syntaxValid).toBe(true);
    expect(a.java?.version).toMatch(/^2\d/);
    expect(a.functions[0].name).toBe("Shipping.fee(int)");
    const en = storyLines(a.functions[0].steps, "en").join("\n");
    expect(en).toContain("subtotal < 0");
    expect(en).toContain('new IllegalArgumentException("Negative subtotal")');
    expect(en).toContain("Conditional expression: subtotal >= 50000");
    expect(en).toContain("Written expression: 0");
    expect(en).toContain("Written expression: 3000");
    expect(a.functions[0].simulatable).toBe(false);
    expect(JSON.stringify(a)).not.toMatch(/won|KRW|₩/);
  });
  it("keeps overloads, resource cleanup, catches/finally, loops, switch labels/guards and lambda timing distinct", async () => {
    const a = await analyze(`record Demo(int x) {
  static int work(int value) throws Exception {
    try (var a = open(); var b = open()) {
      outer: for(int i=0;i<3;i++) { if(i==1) continue outer; }
      for(var item: items) use(item);
      do { value--; } while(value > 3);
      while(value < 0) value++;
      synchronized(lock) { assert value > 0 : "why"; }
      return switch(value) { case 0 -> 1; default -> { yield 2; } };
    } catch (IOException | Error problem) { throw problem; }
    finally { cleanup(); }
  }
  static int work(String value) { return switch(value) { case String s when s.isEmpty() -> 0; default -> 1; }; }
  void apply(int n) { switch(n) { case 0: use(n); case 1: break; default: break; } Runnable task=()->{ use(n); }; }
}`);
    expect(a.syntaxValid).toBe(true);
    expect(a.functions.map((f) => f.name)).toContain("Demo.work(int)");
    expect(a.functions.map((f) => f.name)).toContain("Demo.work(String)");
    const en = a.functions.flatMap((f) => storyLines(f.steps, "en")).join("\n");
    for (const phrase of [
      "reverse order",
      "before catch/finally",
      "may be suppressed",
      "IOException | Error",
      "replace a pending result",
      "continue outer",
      "Run the body first",
      "assertions are enabled",
      "holding the object's monitor",
      "Yield a result",
      "when s.isEmpty()",
      "Colon cases may fall through",
      "not executed immediately",
    ])
      expect(en).toContain(phrase);
  });
  it("preserves UTF-16 offsets, physical CRLF/CR lines, escaped Unicode and exact long values", async () => {
    const source =
      'class Demo {\r\n// 😀 한글\r\nlong count = 9007199254740993L;\rString 이름 = "\\uD83D\\uDE00";\r\nString text = "a\\u0062";\r\n}';
    const a = await analyze(source);
    expect(a.rules.map((r) => r.line)).toEqual([3, 4, 5]);
    expect(a.rules[0].value).toBe("9007199254740993L");
    expect(a.rules[1].value).toBe("😀");
    expect(a.rules[2].value).toBe("ab");
    for (const r of a.rules) expect(source.slice(r.start, r.end)).toBe(r.raw);
    const changed = await patch(source, a.rules[0].id, "9007199254740995L");
    expect(changed.updated).toBe(
      source.replace("9007199254740993L", "9007199254740995L"),
    );
    const value = '새😀\n\r\t\0"\\u000a';
    const str = await patch(source, a.rules[1].id, value);
    expect((await analyze(str.updated)).rules[1].value).toBe(value);
    expect(str.semanticChecked).toBe(false);
  }, 20000);
  it("changes one supported literal while rejecting expressions, comments, text blocks, chars and token escapes", async () => {
    const source =
      'class Demo { int n = -0xCA_FE; double d = 0x1.8p2; boolean ok=true; char c=\'x\'; int commented = - /* keep */ 2; String block = """\nhello\n"""; int escaped = \\u0031; }';
    const a = await analyze(source);
    expect(a.rules.map((r) => r.name)).toEqual(["n", "d", "ok"]);
    for (const value of ["1_234", "0b1010", "077", "+2", "-2147483648"])
      expect((await patch(source, a.rules[0].id, value)).newText).toBe(value);
    for (const value of [
      "1+2",
      "2 // x",
      "2/*x*/",
      "(2)",
      "1; int extra=2",
      "2147483648",
      "2_",
      "++2",
    ])
      await expect(patch(source, a.rules[0].id, value)).rejects.toThrow();
    expect((await patch(source, a.rules[2].id, "false")).newText).toBe("false");
    await expect(patch(source, a.rules[2].id, "1")).rejects.toThrow();
    await expect(patch(source, "java:9999", "2")).rejects.toThrow(
      /current editable/,
    );
  }, 30000);
  it("reports syntax errors without returning recovered editable rules, and does not call type checking a parse", async () => {
    const bad = await analyze("class Demo { int n = ; void work( { }");
    expect(bad.syntaxValid).toBe(false);
    expect(bad.rules).toEqual([]);
    expect(bad.issues.length).toBeGreaterThan(0);
    const types = await analyze(
      'class Demo { int n = "wrong type"; MissingThing work() { return unknown(); } }',
    );
    expect(types.syntaxValid).toBe(true);
    expect(types.functions[0].note?.en).toContain(
      "types, calls and actual exceptions are unchecked",
    );
  });
  it("does not execute static initializers or JVM option hooks", async () => {
    const folder = await mkdtemp(join(tmpdir(), "pureobom-java-noexec-"));
    const marker = join(folder, "ran.txt");
    const saved = Object.fromEntries(
      [
        "JAVA_TOOL_OPTIONS",
        "JDK_JAVA_OPTIONS",
        "_JAVA_OPTIONS",
        "CLASSPATH",
      ].map((k) => [k, process.env[k]]),
    );
    try {
      for (const key of Object.keys(saved))
        process.env[key] = "-invalid-pureobom-option";
      const source = `class Demo { static { try { java.nio.file.Files.writeString(java.nio.file.Path.of(${JSON.stringify(marker)}), "executed"); } catch(Exception e) {} } int count = 1; }`;
      expect((await analyze(source)).syntaxValid).toBe(true);
      await expect(access(marker)).rejects.toThrow();
    } finally {
      for (const [key, value] of Object.entries(saved))
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      if (!resolve(folder).startsWith(resolve(tmpdir())))
        throw Error("Invalid test cleanup path");
      await rm(folder, { recursive: true, force: true });
    }
  });
  it("bounds input/display, rejects malformed Unicode and handles absent JDK, cancellation and timeout", async () => {
    await expect(analyze("a".repeat(131073))).rejects.toThrow(/128KiB/);
    await expect(analyze("class X {}\ud800")).rejects.toThrow(/surrogate/);
    const big = await analyze(
      "class Demo { void work() {" + "use();".repeat(700) + "}}",
    );
    expect(big.java?.truncated).toBe(true);
    expect(big.total).toBeLessThanOrEqual(400);
    const file = { path: "Demo.java", content: "class Demo {}" };
    await expect(
      javaSource(
        file,
        script,
        cache,
        { action: "analyze" },
        { javaHome: resolve("test-results/no-such-jdk") },
      ),
    ).rejects.toThrow(/JDK unavailable/);
    const signal = AbortSignal.abort();
    await expect(
      javaSource(
        file,
        script,
        cache,
        { action: "analyze" },
        { javaHome, signal },
      ),
    ).rejects.toThrow(/cancelled/);
    await expect(
      javaSource(
        file,
        script,
        cache,
        { action: "analyze" },
        { javaHome, timeoutMs: 1 },
      ),
    ).rejects.toThrow(/timed out/);
  }, 15000);
});
