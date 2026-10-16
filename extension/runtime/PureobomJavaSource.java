// Fixed, standard-library-only reader. User source is parsed, never compiled/run.
import com.sun.source.tree.*;
import com.sun.source.util.*;
import java.io.*;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.regex.Pattern;
import javax.tools.*;

public final class PureobomJavaSource {
  static Map<String, Object> map(Object... pairs) {
    var out = new LinkedHashMap<String, Object>();
    for (int i = 0; i < pairs.length; i += 2) out.put((String) pairs[i], pairs[i + 1]);
    return out;
  }

  static Map<String, Object> words(String ko, String en) {
    return map("ko", ko, "en", en);
  }

  static String shortText(String s) {
    s = s.replaceAll("\\s+", " ").trim();
    return s.length() > 240 ? s.substring(0, 240) + "…" : s;
  }

  static String json(Object value) {
    if (value == null) return "null";
    if (value instanceof String s) {
      var out = new StringBuilder("\"");
      for (int i = 0; i < s.length(); i++) {
        char c = s.charAt(i);
        if (c == '"' || c == '\\') out.append('\\').append(c);
        else if (c < 32 || Character.isSurrogate(c)) out.append(String.format("\\u%04x", (int) c));
        else out.append(c);
      }
      return out.append('"').toString();
    }
    if (value instanceof Map<?, ?> m) {
      var entries = new ArrayList<String>();
      m.forEach((k, v) -> entries.add(json(k.toString()) + ":" + json(v)));
      return "{" + String.join(",", entries) + "}";
    }
    if (value instanceof Iterable<?> list) {
      var entries = new ArrayList<String>();
      list.forEach(v -> entries.add(json(v)));
      return "[" + String.join(",", entries) + "]";
    }
    if (value instanceof Boolean || value instanceof Number) return value.toString();
    throw new IllegalArgumentException("Unsupported result type");
  }

  static final Pattern NUMBER =
      Pattern.compile("[+-]?(?:[0-9][0-9a-fA-F_xXbBpPeE.+-]*[lLfFdD]?|\\.[0-9][0-9_eE+-]*[fFdD]?)");
  final String source, path;
  final CompilationUnitTree unit;
  final SourcePositions positions;
  final List<Map<String, Object>> functions = new ArrayList<>(),
      rules = new ArrayList<>(),
      issues = new ArrayList<>();
  final Map<String, Tree> editable = new LinkedHashMap<>();
  final Map<String, Object> out;
  int count = 0, explained = 0;
  boolean truncated = false;

  PureobomJavaSource(String source, String path) throws IOException {
    this.source = source;
    this.path = path;
    var compiler = ToolProvider.getSystemJavaCompiler();
    if (compiler == null)
      throw new IllegalArgumentException("JDK compiler unavailable; install a JDK, not only a JRE");
    var diagnostics = new DiagnosticCollector<JavaFileObject>();
    var input =
        new SimpleJavaFileObject(
            URI.create("string:///PureobomInput.java"), JavaFileObject.Kind.SOURCE) {
          @Override
          public CharSequence getCharContent(boolean ignore) {
            return source;
          }
        };
    try (var manager =
        compiler.getStandardFileManager(diagnostics, Locale.ROOT, StandardCharsets.UTF_8)) {
      manager.setLocationFromPaths(StandardLocation.CLASS_PATH, List.of());
      manager.setLocationFromPaths(StandardLocation.SOURCE_PATH, List.of());
      manager.setLocationFromPaths(StandardLocation.ANNOTATION_PROCESSOR_PATH, List.of());
      var task =
          (JavacTask)
              compiler.getTask(
                  null,
                  manager,
                  diagnostics,
                  List.of("-proc:none", "-implicit:none", "-Xlint:none"),
                  null,
                  List.of(input));
      // Do not call analyze(), generate(), call() or load classes from user input.
      unit = task.parse().iterator().next();
      positions = Trees.instance(task).getSourcePositions();
    }
    for (var d : diagnostics.getDiagnostics())
      if (d.getKind() == Diagnostic.Kind.ERROR && issues.size() < 20) {
        int start = (int) Math.max(0, Math.min(source.length(), d.getStartPosition()));
        int end = (int) Math.max(start, Math.min(source.length(), d.getEndPosition()));
        var issue = anchor(start, end);
        issue.putAll(
            map(
                "id",
                "java-error:" + issues.size(),
                "level",
                "error",
                "title",
                words("Java 문법을 확인하세요", "Check Java syntax"),
                "detail",
                words(shortText(d.getMessage(Locale.ROOT)), shortText(d.getMessage(Locale.ROOT)))));
        issues.add(issue);
      }
    out =
        map(
            "path",
            path,
            "kind",
            "script",
            "lines",
            line(source.length()),
            "functions",
            functions,
            "rules",
            rules,
            "imports",
            List.of(),
            "issues",
            issues,
            "steps",
            List.of(),
            "explained",
            0,
            "total",
            0,
            "syntaxValid",
            issues.isEmpty(),
            "java",
            map("version", Runtime.version().toString(), "truncated", false));
  }

  int line(int offset) {
    int line = 1;
    for (int i = 0; i < offset; i++) {
      char c = source.charAt(i);
      if (c == '\r') {
        line++;
        if (i + 1 < offset && source.charAt(i + 1) == '\n') i++;
      } else if (c == '\n') line++;
    }
    return line;
  }

  int start(Tree n) {
    return (int) positions.getStartPosition(unit, n);
  }

  int end(Tree n) {
    return (int) positions.getEndPosition(unit, n);
  }

  boolean located(Tree n) {
    return n != null && start(n) >= 0 && end(n) >= start(n) && end(n) <= source.length();
  }

  Map<String, Object> anchor(int start, int end) {
    return map(
        "start", start, "end", end, "line", line(start), "endLine", line(Math.max(start, end - 1)));
  }

  Map<String, Object> anchor(Tree n) {
    if (!located(n)) throw new IllegalArgumentException("Source position unavailable");
    return anchor(start(n), end(n));
  }

  String raw(Tree n) {
    return located(n) ? source.substring(start(n), end(n)) : "";
  }

  String expr(Tree n) {
    return shortText(raw(n));
  }

  Map<String, Object> step(Tree n, String kind, String ko, String en, boolean supported) {
    var step = anchor(n);
    step.putAll(
        map(
            "id",
            "java:" + start(n) + ":" + count++,
            "kind",
            kind,
            "text",
            words(ko, en),
            "children",
            List.of(),
            "supported",
            supported));
    if (supported) explained++;
    return step;
  }

  boolean limit(int depth) {
    if (depth > 12 || count >= 400) {
      truncated = true;
      return true;
    }
    return false;
  }

  List<Map<String, Object>> seq(List<? extends Tree> trees, String scope, int depth) {
    var result = new ArrayList<Map<String, Object>>();
    for (var tree : trees) {
      if (limit(depth)) break;
      if (located(tree)) result.add(read(tree, scope, depth));
    }
    return result;
  }

  List<Map<String, Object>> body(Tree tree, String scope, int depth) {
    if (tree == null) return List.of();
    return seq(tree instanceof BlockTree b ? b.getStatements() : List.of(tree), scope, depth);
  }

  String literalType(Tree n) {
    if (n instanceof LiteralTree l)
      return switch (l.getKind()) {
        case STRING_LITERAL -> "string";
        case BOOLEAN_LITERAL -> "boolean";
        case INT_LITERAL, LONG_LITERAL, FLOAT_LITERAL, DOUBLE_LITERAL -> "number";
        default -> "";
      };
    if (n instanceof UnaryTree u
        && (u.getKind() == Tree.Kind.UNARY_MINUS || u.getKind() == Tree.Kind.UNARY_PLUS)
        && literalType(u.getExpression()).equals("number")) return "number";
    return "";
  }

  void rule(String name, Tree n, String scope) {
    if (n == null || !located(n)) return;
    String type = literalType(n), raw = raw(n);
    if (type.isEmpty() || raw.length() > 4096) return;
    if (type.equals("number") && !NUMBER.matcher(raw).matches()) return;
    // Text blocks and Unicode-escaped token boundaries need a dedicated editor.
    if (type.equals("string") && (!raw.startsWith("\"") || raw.startsWith("\"\"\""))) return;
    if (type.equals("boolean") && !raw.equals("true") && !raw.equals("false")) return;
    if (rules.size() >= 300) {
      truncated = true;
      return;
    }
    String id = "java:" + start(n);
    if (editable.containsKey(id)) return;
    Object value = type.equals("number") ? raw : ((LiteralTree) n).getValue();
    var r = anchor(n);
    r.putAll(
        map(
            "id",
            id,
            "name",
            name,
            "label",
            words(name, name),
            "scope",
            scope,
            "type",
            type,
            "value",
            value,
            "raw",
            raw,
            "syntax",
            "java",
            "note",
            words(
                "원문 값 하나입니다. 대입 타입·사용처·실행 결과는 별도 검사해야 합니다.",
                "One written value. Assignment types, uses and runtime results need separate"
                    + " checks.")));
    rules.add(r);
    editable.put(id, n);
  }

  List<Map<String, Object>> expressionFlow(ExpressionTree expression, String scope, int depth) {
    if (expression == null || limit(depth)) return List.of();
    while (expression instanceof ParenthesizedTree p) expression = p.getExpression();
    if (expression instanceof SwitchExpressionTree
        || expression instanceof ConditionalExpressionTree
        || expression instanceof LambdaExpressionTree) return body(expression, scope, depth);
    return List.of();
  }

  List<Map<String, Object>> cases(List<? extends CaseTree> cases, String scope, int depth) {
    var branches = new ArrayList<Map<String, Object>>();
    for (var c : cases) {
      if (limit(depth) || !located(c)) break;
      // Count case containers too, including empty labels.
      count++;
      String labels = String.join(", ", c.getLabels().stream().map(this::expr).toList());
      String guard = c.getGuard() == null ? "" : " when " + expr(c.getGuard());
      String suffix = c.getCaseKind() == CaseTree.CaseKind.RULE ? " →" : " :";
      String text = labels + guard + suffix;
      branches.add(
          map(
              "label",
              words(text, text),
              "steps",
              c.getCaseKind() == CaseTree.CaseKind.RULE
                  ? body(c.getBody(), scope, depth + 1)
                  : seq(c.getStatements(), scope, depth + 1)));
    }
    return branches;
  }

  Map<String, Object> read(Tree n, String scope, int depth) {
    if (n instanceof ClassTree c) {
      String name =
          scope.isEmpty() ? c.getSimpleName().toString() : scope + "." + c.getSimpleName();
      var s =
          step(
              n,
              "definition",
              c.getKind() + " 선언: " + name + ". 멤버 구조이며 초기화·호출 결과가 아닙니다.",
              c.getKind()
                  + " declaration: "
                  + name
                  + ". Member structure, not initialization or call results.",
              true);
      s.put("children", seq(c.getMembers(), name, depth + 1));
      return s;
    }
    if (n instanceof MethodTree m) {
      String params =
          String.join(", ", m.getParameters().stream().map(p -> expr(p.getType())).toList());
      String name =
          scope
              + "."
              + (m.getReturnType() == null ? "<constructor>" : m.getName())
              + "("
              + params
              + ")";
      var s =
          step(
              n,
              "definition",
              "메서드/생성자 선언: " + name,
              "Method/constructor declaration: " + name,
              true);
      if (functions.size() >= 100) {
        truncated = true;
        return s;
      }
      var fn = anchor(n);
      var parameters = new ArrayList<Map<String, Object>>();
      for (var p : m.getParameters())
        parameters.add(
            map("name", p.getName().toString(), "type", expr(p.getType()), "optional", false));
      String result = m.getReturnType() == null ? "constructor" : expr(m.getReturnType());
      String thrown = String.join(", ", m.getThrows().stream().map(this::expr).toList());
      fn.putAll(
          map(
              "id",
              s.get("id"),
              "name",
              name,
              "label",
              words(name, name),
              "params",
              parameters,
              "calls",
              List.of(),
              "async",
              false,
              "simulatable",
              false,
              "steps",
              List.of(),
              "note",
              words(
                  "반환 표기: "
                      + result
                      + ". throws 표기: ["
                      + thrown
                      + "]. 선언을 읽었으며 타입·호출·실제 예외를 확인한 것은 아닙니다.",
                  "Declared result: "
                      + result
                      + ". Declared throws: ["
                      + thrown
                      + "]. Declarations only; types, calls and actual exceptions are"
                      + " unchecked.")));
      functions.add(fn);
      fn.put("steps", body(m.getBody(), name, depth + 1));
      return s;
    }
    if (n instanceof VariableTree v) {
      rule(v.getName().toString(), v.getInitializer(), scope);
      var s =
          step(
              n,
              "data",
              "변수/필드 선언: " + expr(n) + ". 초기화 결과·대입 타입은 미검증입니다.",
              "Variable/field declaration: "
                  + expr(n)
                  + ". Initialization results and assignment types are unchecked.",
              true);
      s.put("children", expressionFlow(v.getInitializer(), scope, depth + 1));
      return s;
    }
    if (n instanceof BlockTree b) {
      var s =
          step(
              n,
              "block",
              b.isStatic() ? "정적 초기화 블록 선언입니다. 읽는 동안 실행하지 않습니다." : "중괄호 블록입니다.",
              b.isStatic()
                  ? "Static initializer declaration; not executed while reading."
                  : "Brace-delimited block.",
              true);
      s.put("children", seq(b.getStatements(), scope, depth + 1));
      return s;
    }
    if (n instanceof IfTree t) {
      var s =
          step(
              n,
              "condition",
              "조건이 참이면: " + expr(t.getCondition()),
              "If the condition is true: " + expr(t.getCondition()),
              true);
      s.put("children", body(t.getThenStatement(), scope, depth + 1));
      if (t.getElseStatement() != null)
        s.put("otherwise", body(t.getElseStatement(), scope, depth + 1));
      return s;
    }
    if (n instanceof ForLoopTree t) {
      var s =
          step(
              n,
              "loop",
              "for 반복입니다. 초기화는 한 번, 조건은 각 반복 전에 확인합니다. 조건 생략은 계속 반복하는 조건입니다.",
              "For loop: initialize once, check the condition before each iteration. An omitted"
                  + " condition permits continuing iteration.",
              true);
      s.put("children", seq(t.getInitializer(), scope, depth + 1));
      s.put(
          "branches",
          List.of(
              map(
                  "label",
                  words(
                      "조건: " + (t.getCondition() == null ? "생략" : expr(t.getCondition())),
                      "Condition: "
                          + (t.getCondition() == null ? "omitted" : expr(t.getCondition()))),
                  "steps",
                  body(t.getStatement(), scope, depth + 1)),
              map(
                  "label",
                  words(
                      "본문 정상 종료 또는 이 반복문의 continue 후 갱신",
                      "Update after normal body completion or continue for this loop"),
                  "steps",
                  seq(t.getUpdate(), scope, depth + 1))));
      return s;
    }
    if (n instanceof EnhancedForLoopTree t) {
      var s =
          step(
              n,
              "loop",
              "반복 대상 「"
                  + expr(t.getExpression())
                  + "」의 각 값에 변수 「"
                  + expr(t.getVariable())
                  + "」를 연결합니다.",
              "Bind "
                  + expr(t.getVariable())
                  + " to each value from "
                  + expr(t.getExpression())
                  + ".",
              true);
      s.put("children", body(t.getStatement(), scope, depth + 1));
      return s;
    }
    if (n instanceof WhileLoopTree t) {
      var s =
          step(
              n,
              "loop",
              "각 반복 전 조건 확인: " + expr(t.getCondition()),
              "Check before each iteration: " + expr(t.getCondition()),
              true);
      s.put("children", body(t.getStatement(), scope, depth + 1));
      return s;
    }
    if (n instanceof DoWhileLoopTree t) {
      var s =
          step(
              n,
              "loop",
              "본문을 먼저 수행하고 각 반복 뒤 조건 확인: " + expr(t.getCondition()),
              "Run the body first, then check after each iteration: " + expr(t.getCondition()),
              true);
      s.put("children", body(t.getStatement(), scope, depth + 1));
      return s;
    }
    if (n instanceof TryTree t) {
      String resources = String.join("; ", t.getResources().stream().map(this::expr).toList());
      var s =
          step(
              n,
              "guard",
              resources.isEmpty()
                  ? "try 본문을 시도합니다. 예외는 일치하는 catch에서 처리할 수 있습니다."
                  : "자원을 왼쪽부터 준비한 뒤 try 본문을 시도합니다: "
                      + resources
                      + ". 준비된 자원은 역순으로 닫고 catch/finally로 진행합니다. 닫기 예외는 억제될 수 있습니다.",
              resources.isEmpty()
                  ? "Attempt the try body; a matching catch may handle an exception."
                  : "Initialize resources left to right, then attempt the try body: "
                      + resources
                      + ". Close initialized resources in reverse order before catch/finally; close"
                      + " exceptions may be suppressed.",
              true);
      s.put("children", body(t.getBlock(), scope, depth + 1));
      var catches = new ArrayList<Map<String, Object>>();
      for (var c : t.getCatches()) {
        if (limit(depth + 1)) break;
        count++;
        catches.add(
            map(
                "label",
                words(
                    "일치하는 예외: " + expr(c.getParameter()),
                    "Matching exception: " + expr(c.getParameter())),
                "steps",
                body(c.getBlock(), scope, depth + 1)));
      }
      s.put("branches", catches);
      if (t.getFinallyBlock() != null && !limit(depth + 1)) {
        var fin =
            step(
                t.getFinallyBlock(),
                "finally",
                "finally 정리입니다. 정상 종료·반환·예외 등으로 나갈 때 수행하며 여기서의 제어 이동이 대기 중 결과를 덮을 수 있습니다.",
                "Finally cleanup on normal or abrupt completion, including return/throw. Abrupt"
                    + " completion here can replace a pending result.",
                true);
        fin.put("children", body(t.getFinallyBlock(), scope, depth + 2));
        s.put("finalizer", fin);
      }
      return s;
    }
    if (n instanceof SwitchTree t) {
      var s =
          step(
              n,
              "branch",
              "switch 대상: "
                  + expr(t.getExpression())
                  + ". 콜론 분기는 다음 분기로 이어질 수 있고 화살표 분기는 이어지지 않습니다.",
              "Switch selector: "
                  + expr(t.getExpression())
                  + ". Colon cases may fall through; arrow cases do not.",
              true);
      s.put("branches", cases(t.getCases(), scope, depth + 1));
      return s;
    }
    if (n instanceof SwitchExpressionTree t) {
      var s =
          step(
              n,
              "branch",
              "switch 식: " + expr(t.getExpression()) + ". 선택한 결과를 계산하며 yield는 이 식의 결과를 제공합니다.",
              "Switch expression: "
                  + expr(t.getExpression())
                  + ". Compute the selected result; yield supplies this expression's result.",
              true);
      s.put("branches", cases(t.getCases(), scope, depth + 1));
      return s;
    }
    if (n instanceof ConditionalExpressionTree t) {
      var s =
          step(
              n,
              "condition",
              "조건식: " + expr(t.getCondition()) + ". 참/거짓에 따라 한쪽 식만 평가합니다.",
              "Conditional expression: "
                  + expr(t.getCondition())
                  + ". Evaluate only the selected true/false expression.",
              true);
      s.put("children", body(t.getTrueExpression(), scope, depth + 1));
      s.put("otherwise", body(t.getFalseExpression(), scope, depth + 1));
      return s;
    }
    if (n instanceof LambdaExpressionTree t) {
      var s =
          step(
              n,
              "definition",
              "람다 선언입니다. 본문은 이 선언 위치에서 즉시 실행되는 것이 아닙니다.",
              "Lambda declaration; its body is not executed immediately at this declaration.",
              true);
      s.put("children", body(t.getBody(), scope, depth + 1));
      return s;
    }
    if (n instanceof SynchronizedTree t) {
      var s =
          step(
              n,
              "guard",
              "대상 모니터를 획득한 동안 본문을 수행합니다: " + expr(t.getExpression()) + ". 경합·교착 상태는 분석하지 않습니다.",
              "Run the body while holding the object's monitor: "
                  + expr(t.getExpression())
                  + ". Contention and deadlocks are not analyzed.",
              true);
      s.put("children", body(t.getBlock(), scope, depth + 1));
      return s;
    }
    if (n instanceof ReturnTree t) {
      var s =
          step(
              n,
              "return",
              "반환하려 합니다: "
                  + (t.getExpression() == null ? "값 없음" : expr(t.getExpression()))
                  + ". 적용되는 자원 정리/finally가 먼저 진행될 수 있습니다.",
              "Return "
                  + (t.getExpression() == null ? "without a value" : expr(t.getExpression()))
                  + ". Applicable resource cleanup/finally can run first.",
              true);
      s.put("children", expressionFlow(t.getExpression(), scope, depth + 1));
      return s;
    }
    if (n instanceof ThrowTree t)
      return step(
          n,
          "error",
          "예외를 던집니다: " + expr(t.getExpression()) + ". 실제 타입·처리 대상은 미검증입니다.",
          "Throw: " + expr(t.getExpression()) + ". Actual type and handler are unchecked.",
          true);
    if (n instanceof YieldTree t)
      return step(
          n,
          "return",
          "바깥 switch 식에 결과를 제공합니다: " + expr(t.getValue()),
          "Yield a result to the enclosing switch expression: " + expr(t.getValue()),
          true);
    if (n instanceof BreakTree || n instanceof ContinueTree)
      return step(
          n, "control", "제어 이동 구문: " + expr(n), "Control transfer statement: " + expr(n), true);
    if (n instanceof LabeledStatementTree t) {
      var s =
          step(n, "control", "구문 레이블: " + t.getLabel(), "Statement label: " + t.getLabel(), true);
      s.put("children", body(t.getStatement(), scope, depth + 1));
      return s;
    }
    if (n instanceof AssertTree t)
      return step(
          n,
          "guard",
          "assert 활성화 시 조건을 확인합니다: "
              + expr(t.getCondition())
              + ". 비활성화되면 이 검사는 수행하지 않습니다. 메시지 식: "
              + expr(t.getDetail()),
          "When assertions are enabled, check "
              + expr(t.getCondition())
              + ". This check is skipped when disabled. Detail expression: "
              + expr(t.getDetail()),
          true);
    if (n instanceof ExpressionStatementTree t) {
      if (t.getExpression() instanceof AssignmentTree a
          && (a.getVariable() instanceof IdentifierTree
              || a.getVariable() instanceof MemberSelectTree))
        rule(expr(a.getVariable()), a.getExpression(), scope);
      var s =
          step(
              n,
              "expression",
              "식 구문: " + expr(n) + ". 호출 내부 동작과 계산 결과는 미검증입니다.",
              "Expression statement: "
                  + expr(n)
                  + ". Called behavior and computed results are unchecked.",
              true);
      s.put("children", expressionFlow(t.getExpression(), scope, depth + 1));
      return s;
    }
    if (n instanceof ExpressionTree)
      return step(
          n,
          "expression",
          "원문 식: " + expr(n) + ". 계산 결과는 미검증입니다.",
          "Written expression: " + expr(n) + ". Computed result is unchecked.",
          true);
    if (n instanceof EmptyStatementTree)
      return step(n, "statement", "빈 구문입니다.", "Empty statement.", true);
    return step(
        n,
        "unknown",
        "아직 풀이하지 않는 구문입니다: " + n.getKind() + " · " + expr(n),
        "Statement not yet explained: " + n.getKind() + " · " + expr(n),
        false);
  }

  Map<String, Object> analyze() {
    if (!issues.isEmpty()) return out;
    out.put("steps", seq(unit.getTypeDecls(), "", 0));
    out.put("total", count);
    out.put("explained", explained);
    out.put("java", map("version", Runtime.version().toString(), "truncated", truncated));
    return out;
  }

  static String javaString(String value) {
    var out = new StringBuilder("\"");
    for (int i = 0; i < value.length(); i++) {
      char c = value.charAt(i);
      switch (c) {
        case '\\', '"' -> out.append('\\').append(c);
        case '\n' -> out.append("\\n");
        case '\r' -> out.append("\\r");
        case '\t' -> out.append("\\t");
        case '\b' -> out.append("\\b");
        case '\f' -> out.append("\\f");
        default -> {
          if (c < 32 || c == 127) out.append(String.format("\\%03o", (int) c));
          else out.append(c);
        }
      }
    }
    return out.append('"').toString();
  }

  Map<String, Object> patch(String id, String value) throws IOException {
    analyze();
    if (!issues.isEmpty())
      throw new IllegalArgumentException("Fix Java syntax errors before editing");
    var node = editable.get(id);
    if (node == null) throw new IllegalArgumentException("Choose a current editable Java value");
    if (value.length() > 4096)
      throw new IllegalArgumentException("Java edit value limit: 4096 characters");
    String type = literalType(node),
        replacement = type.equals("string") ? javaString(value) : value.trim();
    if (type.equals("number") && !NUMBER.matcher(replacement).matches())
      throw new IllegalArgumentException(
          "Enter one Java numeric literal, without comments or expressions");
    if (type.equals("boolean") && !replacement.equals("true") && !replacement.equals("false"))
      throw new IllegalArgumentException("Enter true or false");
    String old = raw(node),
        updated = source.substring(0, start(node)) + replacement + source.substring(end(node));
    if (old.equals(replacement)) throw new IllegalArgumentException("Java value is unchanged");
    var checked = new PureobomJavaSource(updated, path);
    checked.analyze();
    if (!Boolean.TRUE.equals(checked.out.get("syntaxValid")))
      throw new IllegalArgumentException("Java replacement failed syntax parsing");
    Tree fresh = checked.editable.get(id);
    if (fresh == null
        || !checked.raw(fresh).equals(replacement)
        || !checked.literalType(fresh).equals(type))
      throw new IllegalArgumentException(
          "Java replacement must remain one value of the same literal category");
    if (type.equals("string") && !Objects.equals(((LiteralTree) fresh).getValue(), value))
      throw new IllegalArgumentException(
          "Java string encoding did not preserve the requested value");
    return map(
        "path",
        path,
        "ruleId",
        id,
        "start",
        start(node),
        "end",
        end(node),
        "oldText",
        old,
        "newText",
        replacement,
        "original",
        source,
        "updated",
        updated,
        "semanticChecked",
        false,
        "description",
        words(
            "Java 원문 값 하나를 바꿉니다. 타입·의존성·동작은 별도 검사해야 합니다.",
            "Change one written Java value. Check types, dependencies and behavior separately."));
  }

  public static void main(String[] args) {
    try {
      byte[] bytes = System.in.readNBytes(200001);
      if (bytes.length > 200000) throw new IllegalArgumentException("Java request limit exceeded");
      String[] fields = new String(bytes, StandardCharsets.US_ASCII).split("\n", -1);
      if (fields.length != 5) throw new IllegalArgumentException("Invalid Java request");
      for (int i = 0; i < fields.length; i++)
        fields[i] = new String(Base64.getDecoder().decode(fields[i]), StandardCharsets.UTF_8);
      if (fields[2].getBytes(StandardCharsets.UTF_8).length > 131072)
        throw new IllegalArgumentException("Java source limit: 128KiB");
      var reader = new PureobomJavaSource(fields[2], fields[1]);
      Object result =
          switch (fields[0]) {
            case "analyze" -> reader.analyze();
            case "patch" -> reader.patch(fields[3], fields[4]);
            default -> throw new IllegalArgumentException("Unknown Java operation");
          };
      System.out.print(json(map("result", result)));
    } catch (Throwable error) {
      String message =
          error instanceof StackOverflowError
              ? "Java nesting limit exceeded"
              : shortText(error.toString());
      System.out.print(json(map("error", message)));
    }
  }
}
