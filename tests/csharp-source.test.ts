import { beforeAll, describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { readFile, access } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { csharpSource } from "../extension/src/csharpSource";
import type { FileAnalysis, Patch } from "../src/core/types";
import { storyLines } from "../src/core/storyReport";
import { parseRequest } from "../src/core/ruleRequest";

const script = resolve("extension/runtime/PureobomCSharpSource.cs");
const cache = resolve("test-results/csharp-source-core-cache");
const dotnet = process.env.PUREOBOM_TEST_DOTNET;
const analyze = (content: string) =>
  csharpSource(
    { path: "Demo.cs", content },
    script,
    cache,
    { action: "analyze" },
    { dotnet },
  ) as Promise<FileAnalysis>;
const patch = (content: string, ruleId: string, value: string) =>
  csharpSource(
    { path: "Demo.cs", content },
    script,
    cache,
    { action: "patch", ruleId, value },
    { dotnet },
  ) as Promise<Patch>;
beforeAll(async () => {
  await analyze("class Demo { int value=1; }");
}, 90000);

describe("C# Roslyn source reader", () => {
  it("never executes user module initializers, constructors or entry points", async () => {
    const marker = resolve("test-results", `csharp-must-not-execute-${randomUUID()}`);
    const source = `using System.Runtime.CompilerServices;
class SideEffects {
  [ModuleInitializer] internal static void Initialize() => System.IO.File.WriteAllText(@"${marker.replaceAll('"', '""')}", "executed");
  static SideEffects() { Initialize(); }
  static void Main() { Initialize(); }
}`;
    const a = await analyze(source);
    expect(a.syntaxValid).toBe(true);
    const rule = a.rules.find((r) => r.value === "executed")!;
    expect((await patch(source, rule.id, "still inert")).updated).toContain("still inert");
    await expect(access(marker)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("reads both conditional results and explicit exception without guessing domain units", async () => {
    const a = await analyze(
      await readFile("examples/local-ai/Shipping.cs", "utf8"),
    );
    expect(a.syntaxValid).toBe(true);
    expect(a.csharp?.languageVersion).toBeTruthy();
    expect(a.functions[0].name).toContain("Shipping.");
    const en = a.functions.flatMap((f) => storyLines(f.steps, "en")).join("\n");
    expect(en).toContain("subtotal < 0");
    expect(en).toContain("ArgumentOutOfRangeException");
    expect(en).toContain("subtotal >= 50000");
    expect(en).toContain("Expression when true: 0");
    expect(en).toContain("Expression when false: 3000");
    expect(a.rules.some((r) => r.raw === "50000")).toBe(true);
    expect(a.functions.every((f) => !f.simulatable)).toBe(true);
    expect(JSON.stringify(a)).not.toMatch(/KRW|won|₩/);
  });
  it("uses physical UTF-16 source positions and preserves exact integer and decimal suffixes", async () => {
    const source =
      '// 😀 한글\r\n#line 900 "elsewhere.cs"\r\nclass Demo {\rlong n=9007199254740993L;\r\n decimal price=1.25m; string 이름=@"a""b"; }';
    const a = await analyze(source);
    expect(a.rules.map((r) => r.line)).toEqual([4, 5, 5]);
    for (const rule of a.rules)
      expect(source.slice(rule.start, rule.end)).toBe(rule.raw);
    expect(a.rules[0].value).toBe("9007199254740993L");
    const p = await patch(source, a.rules[0].id, "9223372036854775807L");
    expect(p.updated).toBe(
      source.replace("9007199254740993L", "9223372036854775807L"),
    );
    expect((await patch(source, a.rules[1].id, "0.15m")).newText).toBe("0.15m");
    expect(a.rules[2].value).toBe('a"b');
    expect(a.issues.some((i) => i.id === "csharp-directives")).toBe(true);
  });
  it("encodes ordinary, verbatim and raw strings without turning content into C# code", async () => {
    const source =
      'class Demo { string a="hi"; string b=@"x""y"; string c="""raw content"""; }';
    const a = await analyze(source);
    expect(a.rules.map((r) => r.value)).toEqual(["hi", 'x"y', "raw content"]);
    const value = '새😀\n\r\t"; throw new Exception(); // \\u0022';
    for (const r of a.rules) {
      const p = await patch(source, r.id, value);
      expect(p.updated).toBe(
        source.slice(0, r.start) + p.newText + source.slice(r.end),
      );
      expect(
        (await analyze(p.updated)).rules.find((x) => x.start === r.start)
          ?.value,
      ).toBe(value);
      expect(p.semanticChecked).toBe(false);
    }
  }, 20000);
  it("rejects injected expressions/comments and excludes char/null/UTF8/interpolation or separated signs", async () => {
    const source =
      'class Demo { int n=-2; bool ok=true; char c=\'x\'; object o=null; int comment=- /* keep */ 3; string i=$"{n}"; void M(){ var u="hi"u8; } }';
    const a = await analyze(source);
    expect(a.rules.map((r) => r.raw)).toEqual(["-2", "true"]);
    for (const value of [
      "1+2",
      "1; int injected=2",
      "(2)",
      "2 /*x*/",
      "2 // x",
      "+ 2",
      "2\n",
      "--2",
    ])
      await expect(patch(source, a.rules[0].id, value)).rejects.toThrow();
    expect((await patch(source, a.rules[1].id, "false")).newText).toBe("false");
    await expect(patch(source, "csharp:999", "1")).rejects.toThrow(
      /current editable/,
    );
  }, 30000);
  it("keeps loops, catches/filter/finally, disposal, switch patterns and deferred lambdas visible", async () => {
    const a = await analyze(`class Demo {
      int Work(int n) { using var resource=Open();
        try { for(int i=0;i<3;i++){if(i==1)continue;} foreach(var x in items) Use(x); do {n--;}while(n>1); while(n<0)n++;
          lock(gate){ Use(n); } checked { n++; }
          using(var child=Open()){Use(child);}
          Func<int> thunk=()=>Danger();
          return n switch { <0 when enabled => -1, 0 => 2, _ => 3 };
        } catch(Exception e) when(Filter(e)) {throw;} finally {Cleanup();}
      }
    }`);
    expect(a.syntaxValid).toBe(true);
    const en = storyLines(a.functions[0].steps, "en").join("\n");
    for (const expected of [
      "dispose on leaving scope",
      "for loop",
      "Enumerate each item",
      "Run the body first",
      "holding the lock",
      "integer-overflow",
      "not executed immediately",
      "when enabled",
      "when(Filter(e))",
      "pending completion",
    ])
      expect(en).toContain(expected);
  });
  it("reports syntax failure without recovered rules and distinguishes parsing from types and conditional compilation", async () => {
    const bad = await analyze("class Demo { int x=; }");
    expect(bad.syntaxValid).toBe(false);
    expect(bad.rules).toEqual([]);
    const unresolved = await analyze(
      'class Demo { int n="wrong"; MissingType Work()=>unknown(); }',
    );
    expect(unresolved.syntaxValid).toBe(true);
    const conditional = await analyze(
      "#if DEBUG\nclass A {int n=1;}\n#else\nclass B {int n=2;}\n#endif",
    );
    expect(conditional.rules.map((r) => r.raw)).toEqual(["2"]);
    expect(conditional.issues.some((i) => i.id === "csharp-directives")).toBe(
      true,
    );
  });
  it("marks bounded output and rejects oversized input, invalid Unicode, absent SDK and cancellation", async () => {
    const many = await analyze(
      "class Demo{" +
        Array.from({ length: 350 }, (_, i) => `int n${i}=${i};`).join("") +
        "}",
    );
    expect(many.csharp?.truncated).toBe(true);
    expect(many.rules).toHaveLength(300);
    await expect(analyze("x".repeat(129 * 1024))).rejects.toThrow(/128KiB/);
    await expect(analyze("//\ud800")).rejects.toThrow(/surrogate/);
    await expect(
      csharpSource(
        { path: "a.cs", content: "class A{}" },
        script,
        cache,
        { action: "analyze" },
        { dotnet: resolve("test-results/missing-dotnet.exe") },
      ),
    ).rejects.toThrow(/SDK/);
    await expect(
      csharpSource(
        { path: "a.cs", content: "class A{}" },
        script,
        cache,
        { action: "analyze" },
        { dotnet, signal: AbortSignal.abort() },
      ),
    ).rejects.toThrow(/cancelled/);
  });
  it("preserves C# numeric spelling in natural-language change requests", async () => {
    const a = await analyze("class Demo { ulong n=1UL; }");
    for (const value of [
      "9007199254740993UL",
      "0xFFu",
      "0b1010L",
      "1_000m",
      "-2.5e-3F",
      ".5D",
    ])
      expect(
        parseRequest(`change ${a.rules[0].label.en} to ${value}`, a.rules)
          .value,
      ).toBe(value);
  });
});
