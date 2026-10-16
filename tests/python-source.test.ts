import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { mkdtemp, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pythonSource } from "../extension/src/pythonSource";
import type { FileAnalysis, Patch, Step } from "../src/core/types";
import { parseRequest } from "../src/core/ruleRequest";
import { storyLines } from "../src/core/storyReport";

const script = resolve("extension/runtime/python_source.py");
const analyze = async (content: string, path = "sample.py") =>
  pythonSource({ path, content }, script, {
    action: "analyze",
  }) as Promise<FileAnalysis>;
const patch = async (content: string, ruleId: string, value: string) =>
  pythonSource({ path: "sample.py", content }, script, {
    action: "patch",
    ruleId,
    value,
  }) as Promise<Patch>;
function flatten(steps: Step[]): Step[] {
  return steps.flatMap((s) => [
    s,
    ...flatten(s.children),
    ...flatten(s.otherwise || []),
    ...(s.branches || []).flatMap((b) => flatten(b.steps)),
    ...(s.finalizer ? flatten([s.finalizer]) : []),
  ]);
}

describe("isolated Python source reader", () => {
  it("reads the actual shipping branches and exact literals in both languages without inferring currency", async () => {
    const source = await readFile("examples/shipping.py", "utf8");
    const a = await analyze(source);
    expect(a.syntaxValid).toBe(true);
    expect(a.python?.version).toMatch(/^3\./);
    expect(a.rules.map((r) => r.raw)).toEqual(["50_000", "3_000"]);
    const fn = a.functions[0];
    expect(fn.simulatable).toBe(false);
    const steps = flatten(fn.steps);
    expect(steps.some((s) => s.text.en.includes("subtotal < 0"))).toBe(true);
    expect(
      steps.some((s) =>
        s.text.en.includes("subtotal >= FREE_SHIPPING_THRESHOLD"),
      ),
    ).toBe(true);
    expect(steps.some((s) => s.text.en.includes("ValueError"))).toBe(true);
    expect(steps.at(-1)?.text.en).toContain("SHIPPING_FEE");
    expect(steps.at(-1)?.text.ko).toContain("SHIPPING_FEE");
    expect(
      steps.filter((s) => s.kind === "condition").every((s) => !s.otherwise),
    ).toBe(true);
    expect(JSON.stringify(a)).not.toMatch(/won|KRW|₩|원 이상/);
    for (const s of steps)
      expect(source.slice(s.start, s.end).trim().length).toBeGreaterThan(0);
  });
  it("preserves loop else, ordered handlers, try else, finally and pending returns", async () => {
    const source = `def process(items):
    try:
        for item in items:
            if item < 0:
                break
        else:
            return "complete"
    except ValueError as error:
        return "value"
    except Exception:
        raise
    else:
        return "no error"
    finally:
        cleanup()
    return "outside"
`;
    const a = await analyze(source);
    const lines = storyLines(a.functions[0].steps, "en").join("\n");
    expect(lines).toContain("without break");
    expect(lines.indexOf("except ValueError")).toBeLessThan(
      lines.indexOf("except Exception"),
    );
    expect(lines).toContain("without an exception, return, break or continue");
    expect(lines).toContain("Enclosing finally runs first");
    expect(lines.indexOf("finally: runs")).toBeGreaterThan(
      lines.indexOf('Return "no error"'),
    );
    expect(lines.indexOf('Return "outside"')).toBeGreaterThan(
      lines.indexOf("cleanup()"),
    );
    expect(a.functions[0].steps.at(-1)?.text.en).not.toContain("finally");
  });
  it("keeps nested functions, generators, decorators and annotations separate from execution claims", async () => {
    const a = await analyze(`@decorate()
def outer(x: int = 3, /, *, y=None):
    def inner():
        yield 1
        return 2
    return inner()

class Box:
    async def read(self, *args, **kwargs):
        async with lock():
            await fetch()
`);
    expect(a.functions.map((f) => f.name)).toEqual([
      "outer",
      "outer.inner",
      "Box.read",
    ]);
    expect(a.functions[0].note?.en).not.toContain("A generator");
    expect(a.functions[1].note?.en).toContain("A generator");
    expect(a.functions[1].steps[1].text.en).toContain("Finish the generator");
    expect(a.functions[0].params.map((p) => [p.name, p.optional])).toEqual([
      ["x", true],
      ["y", true],
    ]);
    expect(a.functions[2].async).toBe(true);
    expect(a.functions[2].steps[0].text.en).toContain(
      "Context-manager exit may suppress exceptions",
    );
    expect(a.steps[0].text.en).toContain("Defaults and decorators");
  });
  it("uses UTF-16 source ranges after Unicode, CRLF and bare CR; changes only the selected literal", async () => {
    for (const newline of ["\n", "\r\n", "\r"]) {
      const source = [
        `# 😀 한글`,
        `제목 = "😀"; 큰수 = 9007199254740993`,
        `작음 = -0.000_001`,
        `빈값: str`,
      ].join(newline);
      const a = await analyze(source);
      expect(a.rules.map((r) => r.value)).toEqual([
        "😀",
        "9007199254740993",
        "-0.000_001",
      ]);
      const rule = a.rules[1];
      expect(rule.line).toBe(2);
      expect(source.slice(rule.start, rule.end)).toBe("9007199254740993");
      const p = await patch(source, rule.id, "9007199254740995");
      expect(p.updated).toBe(
        source.replace("9007199254740993", "9007199254740995"),
      );
      expect(p.semanticChecked).toBe(false);
    }
  });
  it("round trips inert strings including emoji, escapes and triple-quoted source without rounding numbers", async () => {
    const source = `title = r"old\\path"\ncount = 0xFF\nenabled = False\nconcat = ("a" # keep\n          "b")\ntext = """two\nlines"""\n`;
    const a = await analyze(source);
    expect(a.rules.map((r) => r.name)).toEqual([
      "title",
      "count",
      "enabled",
      "text",
    ]);
    const newValue = '😀\n"\\</script>\u0000';
    const p = await patch(source, a.rules[0].id, newValue);
    expect((await analyze(p.updated)).rules[0].value).toBe(newValue);
    expect(p.updated).toContain('concat = ("a" # keep');
    const numeric = parseRequest("change count to 0xCA_FE", a.rules);
    expect(numeric.value).toBe("0xCA_FE");
    expect((await patch(source, numeric.rule.id, numeric.value)).newText).toBe(
      "0xCA_FE",
    );
    expect(parseRequest("enabled를 True로 변경", a.rules).value).toBe("true");
    expect((await patch(source, a.rules[2].id, "true")).newText).toBe("True");
    for (const wrong of ["0xGG", "12foo"])
      expect(() => parseRequest(`change count to ${wrong}`, a.rules)).toThrow();
  });
  it("rejects malformed/scope-invalid sources and code disguised as literals", async () => {
    for (const source of [
      "if x\n pass",
      "return 3",
      "break",
      "def f():\n    nonlocal absent\n",
    ])
      expect((await analyze(source)).syntaxValid).toBe(false);
    const source = "count = 2\n";
    const rule = (await analyze(source)).rules[0];
    for (const input of [
      "1+2",
      "3 # comment",
      "(3)",
      "True",
      "3j",
      "float('inf')",
      "__import__('os')",
      "2",
      "5".repeat(4097),
    ])
      await expect(patch(source, rule.id, input)).rejects.toThrow();
    await expect(patch(source, "python:999", "4")).rejects.toThrow(
      /current editable/,
    );
  });
  it("never imports or runs source, including decorators and default expressions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pureobom-python-static-"));
    try {
      const target = join(directory, "executed.txt");
      const source = `from pathlib import Path\nPath(${JSON.stringify(target)}).write_text('unsafe')\n@missing_decorator()\ndef function(x=missing_default()):\n    raise RuntimeError('never execute')\n`;
      expect((await analyze(source)).syntaxValid).toBe(true);
      await expect(access(target)).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("marks unsupported statements and bounded output instead of implying complete coverage", async () => {
    const a = await analyze("def update(x):\n    x += 1\n    del x\n");
    expect(a.functions[0].steps.every((s) => s.supported === false)).toBe(true);
    expect(a.explained).toBeLessThan(a.total);
    const many = await analyze(
      Array.from({ length: 600 }, (_, i) => `v${i} = ${i}`).join("\n"),
    );
    expect(many.python?.truncated).toBe(true);
    expect(many.steps).toHaveLength(400);
    expect(many.rules).toHaveLength(300);
    await expect(analyze("#".repeat(128 * 1024 + 1))).rejects.toThrow(/128KB/);
  });
  it("fails explicitly when the interpreter is missing, cancelled or times out", async () => {
    const file = { path: "source.py", content: "x = 1\n" };
    await expect(
      pythonSource(
        file,
        script,
        { action: "analyze" },
        { executable: resolve("test-results/missing-python-executable") },
      ),
    ).rejects.toThrow(/Python unavailable/);
    const controller = new AbortController();
    const pending = pythonSource(
      file,
      script,
      { action: "analyze" },
      { signal: controller.signal },
    );
    controller.abort();
    await expect(pending).rejects.toThrow(/cancelled/);
    await expect(
      pythonSource(file, script, { action: "analyze" }, { timeoutMs: 1 }),
    ).rejects.toThrow(/timed out/);
  });
});
