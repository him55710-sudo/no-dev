// MIT. Only this fixed helper is compiled. Input C# is parsed, never compiled or run.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.Text;

sealed record Words(string Ko, string En);
class Anchor
{
    public int Start { get; set; }
    public int End { get; set; }
    public int Line { get; set; }
    public int EndLine { get; set; }
}
sealed class Step : Anchor
{
    public string Id { get; set; } = "";
    public string Kind { get; set; } = "source";
    public Words Text { get; set; } = new("", "");
    public List<Step> Children { get; set; } = new();
    public List<Step>? Otherwise { get; set; }
    public Step? Finalizer { get; set; }
    public List<Branch>? Branches { get; set; }
    public bool Supported { get; set; } = true;
}
sealed record Branch(Words Label, List<Step> Steps);
sealed record Parameter(string Name, string Type, bool Optional);
sealed class Function : Anchor
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public Words Label { get; set; } = new("", "");
    public List<Parameter> Params { get; set; } = new();
    public List<Step> Steps { get; set; } = new();
    public string[] Calls { get; set; } = Array.Empty<string>();
    public bool Async { get; set; }
    public bool Simulatable { get; set; } = false;
}
sealed class Rule : Anchor
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public Words Label { get; set; } = new("", "");
    public object Value { get; set; } = "";
    public string Type { get; set; } = "";
    public string Scope { get; set; } = "source";
    public string Raw { get; set; } = "";
    public string Syntax { get; set; } = "csharp";
    public Words Note { get; set; } = new("적힌 값 하나만 바꿉니다. 타입·오버로드·프로젝트 조건·동작은 검증하지 않습니다.", "Changes one written value. Types, overloads, project conditions and behavior are unchecked.");
}
sealed class Issue : Anchor
{
    public string Id { get; set; } = "";
    public string Level { get; set; } = "info";
    public Words Title { get; set; } = new("", "");
    public Words Detail { get; set; } = new("", "");
}
sealed class Reader
{
    readonly string source, path;
    readonly SyntaxTree tree;
    readonly CompilationUnitSyntax root;
    readonly List<Function> functions = new();
    readonly List<Rule> rules = new();
    readonly List<Issue> issues = new();
    int steps;
    bool truncated;
    static readonly CSharpParseOptions Options = new(LanguageVersion.Default, DocumentationMode.Parse, SourceCodeKind.Regular);
    public Reader(string path, string source)
    {
        this.path = path; this.source = source;
        if (Encoding.UTF8.GetByteCount(source) > 128 * 1024 || source.Contains('\0')) throw new Exception("C# input limit: 128KiB, no NUL.");
        tree = CSharpSyntaxTree.ParseText(source, Options);
        root = (CompilationUnitSyntax)tree.GetRoot();
    }
    T At<T>(T item, TextSpan span) where T : Anchor
    {
        item.Start = span.Start; item.End = span.End;
        // Physical source positions; #line directives must not redirect navigation.
        var lines = tree.GetText().Lines;
        item.Line = lines.GetLineFromPosition(span.Start).LineNumber + 1;
        item.EndLine = lines.GetLineFromPosition(Math.Max(span.Start, span.End - 1)).LineNumber + 1;
        return item;
    }
    string Raw(SyntaxNode? n) => n == null ? "" : source.Substring(n.SpanStart, n.Span.Length);
    string Short(SyntaxNode? n) { var s = Raw(n); return s.Length <= 240 ? s : s[..240] + "…"; }
    Step New(SyntaxNode n, string ko, string en, string kind = "source") => At(new Step { Id = "cs-step:" + n.SpanStart + ":" + steps++, Kind = kind, Text = new(ko, en) }, n.Span);
    List<Step> ReadBody(SyntaxNode? n, int depth = 0)
    {
        if (n == null) return new();
        if (depth > 16 || steps >= 400) { truncated = true; return new(); }
        if (n is BlockSyntax block) return block.Statements.SelectMany(s => ReadBody(s, depth + 1)).ToList();
        var raw = Short(n);
        Step step;
        switch (n)
        {
            case IfStatementSyntax x:
                step = New(n, "조건이 참이면: " + Short(x.Condition), "If the condition is true: " + Short(x.Condition), "if");
                step.Children = ReadBody(x.Statement, depth + 1);
                if (x.Else != null) step.Otherwise = ReadBody(x.Else.Statement, depth + 1);
                break;
            case ReturnStatementSyntax x:
                step = New(n, x.Expression == null ? "현재 함수에서 돌아갑니다." : "이 식의 결과를 반환: " + Short(x.Expression), x.Expression == null ? "Return from the current function." : "Return this expression: " + Short(x.Expression), "return");
                step.Children = ReadExpression(x.Expression, depth + 1); break;
            case ThrowStatementSyntax x:
                step = New(n, x.Expression == null ? "현재 예외를 다시 던집니다." : "예외를 던집니다: " + Short(x.Expression), x.Expression == null ? "Rethrow the current exception." : "Throw an exception: " + Short(x.Expression), "throw"); break;
            case TryStatementSyntax x:
                step = New(n, "try 블록을 실행하고 해당되는 catch를 찾습니다. 필터·finally의 효과도 확인하세요.", "Run the try block; matching catches, filters and finally affect completion.", "try");
                step.Children = ReadBody(x.Block, depth + 1);
                step.Branches = x.Catches.Select(c => new Branch(new("catch " + Short(c.Declaration) + " " + Short(c.Filter), "catch " + Short(c.Declaration) + " " + Short(c.Filter)), ReadBody(c.Block, depth + 1))).ToList();
                if (x.Finally != null)
                {
                    step.Finalizer = New(x.Finally, "finally: 블록을 떠날 때 실행합니다. 새 예외는 기존 완료를 바꿀 수 있습니다.", "finally: runs when leaving the block; a new exception can change pending completion.", "finally");
                    step.Finalizer.Children = ReadBody(x.Finally.Block, depth + 1);
                }
                break;
            case ForStatementSyntax x:
                step = New(n, "for 반복 — 초기화: " + Short(x.Declaration) + string.Join(", ", x.Initializers.Select(Short)) + "; 조건: " + (x.Condition == null ? "생략(참)" : Short(x.Condition)) + "; 반복 후: " + string.Join(", ", x.Incrementors.Select(Short)), "for loop — initialize: " + Short(x.Declaration) + string.Join(", ", x.Initializers.Select(Short)) + "; condition: " + (x.Condition == null ? "omitted (true)" : Short(x.Condition)) + "; after iteration: " + string.Join(", ", x.Incrementors.Select(Short)), "loop");
                step.Children = ReadBody(x.Statement, depth + 1); break;
            case CommonForEachStatementSyntax x:
                step = New(n, (x.AwaitKeyword.IsKind(SyntaxKind.AwaitKeyword) ? "비동기 " : "") + "각 항목을 순회: " + Short(x.Expression), (x.AwaitKeyword.IsKind(SyntaxKind.AwaitKeyword) ? "Asynchronously enumerate: " : "Enumerate each item: ") + Short(x.Expression), "loop");
                step.Children = ReadBody(x.Statement, depth + 1); break;
            case WhileStatementSyntax x:
                step = New(n, "조건이 참인 동안 반복: " + Short(x.Condition), "Repeat while true: " + Short(x.Condition), "loop"); step.Children = ReadBody(x.Statement, depth + 1); break;
            case DoStatementSyntax x:
                step = New(n, "먼저 본문 실행 후 조건이 참이면 반복: " + Short(x.Condition), "Run the body first, then repeat while true: " + Short(x.Condition), "loop"); step.Children = ReadBody(x.Statement, depth + 1); break;
            case SwitchStatementSyntax x:
                step = New(n, "switch: 값과 일치하는 case·패턴·when을 확인합니다: " + Short(x.Expression), "switch: match the value against cases, patterns and when guards: " + Short(x.Expression), "switch");
                step.Branches = x.Sections.Select(s => new Branch(new(string.Join(" ", s.Labels.Select(Short)), string.Join(" ", s.Labels.Select(Short))), s.Statements.SelectMany(t => ReadBody(t, depth + 1)).ToList())).ToList(); break;
            case UsingStatementSyntax x:
                step = New(n, "using: 범위를 떠날 때 자원을 정리합니다" + (x.AwaitKeyword.IsKind(SyntaxKind.AwaitKeyword) ? "(비동기)" : "") + ": " + Short(x.Declaration ?? (SyntaxNode?)x.Expression), "using: dispose resources on leaving the scope" + (x.AwaitKeyword.IsKind(SyntaxKind.AwaitKeyword) ? " asynchronously" : "") + ": " + Short(x.Declaration ?? (SyntaxNode?)x.Expression), "using"); step.Children = ReadBody(x.Statement, depth + 1); break;
            case LockStatementSyntax x:
                step = New(n, "lock: 잠금을 얻은 동안 본문 실행; 의미는 식의 타입에 따라 달라집니다: " + Short(x.Expression), "lock: run while holding the lock; semantics depend on the expression type: " + Short(x.Expression), "lock"); step.Children = ReadBody(x.Statement, depth + 1); break;
            case CheckedStatementSyntax x:
                step = New(n, x.Keyword.Text + ": 이 범위의 정수 연산 오버플로 문맥", x.Keyword.Text + ": integer-overflow context in this scope", "context"); step.Children = ReadBody(x.Block, depth + 1); break;
            case LocalDeclarationStatementSyntax x:
                step = New(n, (x.UsingKeyword.IsKind(SyntaxKind.UsingKeyword) ? "using 선언 — 범위를 떠날 때 자원 정리: " : "지역 이름과 초기값 선언: ") + Short(x.Declaration), (x.UsingKeyword.IsKind(SyntaxKind.UsingKeyword) ? "using declaration — dispose on leaving scope: " : "Declare local names and initializers: ") + Short(x.Declaration), "declaration");
                step.Children = x.Declaration.Variables.SelectMany(v => ReadExpression(v.Initializer?.Value, depth + 1)).ToList(); break;
            case LocalFunctionStatementSyntax x:
                step = New(n, "지역 함수 선언 — 호출될 때 본문 실행: " + x.Identifier.Text, "Local function declaration — body runs when called: " + x.Identifier.Text, "declaration"); break;
            case YieldStatementSyntax x:
                step = New(n, "지연 열거의 " + x.ReturnOrBreakKeyword.Text + ": " + Short(x.Expression), "Iterator " + x.ReturnOrBreakKeyword.Text + ": " + Short(x.Expression), "yield"); break;
            case BreakStatementSyntax:
            case ContinueStatementSyntax:
            case GotoStatementSyntax:
                step = New(n, "제어 이동: " + raw, "Transfer control: " + raw, "control"); break;
            case LabeledStatementSyntax x:
                step = New(n, "이동 대상 이름: " + x.Identifier.Text, "Label for control transfer: " + x.Identifier.Text, "label"); step.Children = ReadBody(x.Statement, depth + 1); break;
            case ExpressionStatementSyntax x:
                step = New(n, "식 실행: " + Short(x.Expression), "Evaluate the expression: " + Short(x.Expression), "expression"); step.Children = ReadExpression(x.Expression, depth + 1); break;
            case GlobalStatementSyntax x: return ReadBody(x.Statement, depth + 1);
            default:
                step = New(n, "원문 확인(" + n.Kind() + "): " + raw, "Review source (" + n.Kind() + "): " + raw); step.Supported = false; break;
        }
        return new() { step };
    }
    List<Step> ReadExpression(ExpressionSyntax? n, int depth)
    {
        if (n == null) return new();
        if (depth > 16 || steps >= 400) { truncated = true; return new(); }
        Step s;
        switch (n)
        {
            case ParenthesizedExpressionSyntax x: return ReadExpression(x.Expression, depth + 1);
            case ConditionalExpressionSyntax x:
                if (steps + 3 > 400) { truncated = true; return new(); }
                s = New(n, "조건식: " + Short(x.Condition), "Conditional expression: " + Short(x.Condition), "if");
                s.Children = new() { New(x.WhenTrue, "참일 때의 식: " + Short(x.WhenTrue), "Expression when true: " + Short(x.WhenTrue)) };
                s.Children[0].Children = ReadExpression(x.WhenTrue, depth + 1);
                s.Otherwise = new() { New(x.WhenFalse, "거짓일 때의 식: " + Short(x.WhenFalse), "Expression when false: " + Short(x.WhenFalse)) };
                s.Otherwise[0].Children = ReadExpression(x.WhenFalse, depth + 1); break;
            case SwitchExpressionSyntax x:
                s = New(n, "switch 식 — 순서대로 패턴·when 확인: " + Short(x.GoverningExpression), "switch expression — match patterns and when guards in order: " + Short(x.GoverningExpression), "switch");
                s.Branches = new();
                foreach (var arm in x.Arms)
                {
                    if (steps >= 400) { truncated = true; break; }
                    var result = New(arm.Expression, "결과 식: " + Short(arm.Expression), "Result expression: " + Short(arm.Expression));
                    result.Children = ReadExpression(arm.Expression, depth + 1);
                    s.Branches.Add(new(new(Short(arm.Pattern) + " " + Short(arm.WhenClause), Short(arm.Pattern) + " " + Short(arm.WhenClause)), new() { result }));
                }
                break;
            case AwaitExpressionSyntax x:
                s = New(n, "await: 이 작업의 완료를 기다린 뒤 계속합니다: " + Short(x.Expression), "await: continue after this operation completes: " + Short(x.Expression), "await"); break;
            case AnonymousFunctionExpressionSyntax:
                s = New(n, "익명 함수 생성 — 본문은 여기서 즉시 실행되지 않습니다: " + Short(n), "Create an anonymous function — its body is not executed immediately here: " + Short(n), "lambda"); break;
            case ThrowExpressionSyntax x:
                s = New(n, "이 식을 평가하면 예외를 던집니다: " + Short(x.Expression), "Evaluating this expression throws: " + Short(x.Expression), "throw"); break;
            case BinaryExpressionSyntax x when x.IsKind(SyntaxKind.LogicalAndExpression) || x.IsKind(SyntaxKind.LogicalOrExpression) || x.IsKind(SyntaxKind.CoalesceExpression):
                s = New(n, "조건부 우변 평가(" + x.OperatorToken.Text + ") — 정확한 의미는 피연산자 타입에 따라 확인: " + Short(n), "Conditional right-hand evaluation (" + x.OperatorToken.Text + ") — check operand types for exact semantics: " + Short(n), "expression");
                s.Children = ReadExpression(x.Left, depth + 1); s.Children.AddRange(ReadExpression(x.Right, depth + 1)); break;
            default:
                return n.ChildNodes().OfType<ExpressionSyntax>().SelectMany(e => ReadExpression(e, depth + 1)).ToList();
        }
        return new() { s };
    }
    void AddFunction(SyntaxNode n, string name, ParameterListSyntax parameters, SyntaxNode? body, ExpressionSyntax? expression, SyntaxTokenList modifiers)
    {
        if (functions.Count >= 100) { truncated = true; return; }
        var owners = n.Ancestors().OfType<TypeDeclarationSyntax>().Reverse().Select(x => x.Identifier.Text);
        var full = string.Join(".", owners.Append(name)) + "(" + string.Join(",", parameters.Parameters.Select(p => Short(p.Type))) + ")";
        var fn = At(new Function { Id = "csharp-fn:" + n.SpanStart, Name = full, Label = new(full, full), Async = modifiers.Any(SyntaxKind.AsyncKeyword) }, n.Span);
        fn.Params = parameters.Parameters.Select(p => new Parameter(p.Identifier.Text, Short(p.Type), p.Default != null)).ToList();
        fn.Steps = ReadBody(body);
        if (expression != null && steps < 400)
        {
            var arrow = New(expression, "식 본문 — 호출할 때 평가: " + Short(expression), "Expression body — evaluated when invoked: " + Short(expression), "expression");
            arrow.Children = ReadExpression(expression, 1); fn.Steps.Add(arrow);
        }
        else if (expression != null) truncated = true;
        functions.Add(fn);
    }
    IEnumerable<SyntaxNode> Nodes()
    {
        var pending = new Stack<SyntaxNode>(); pending.Push(root); int count = 0;
        while (pending.Count > 0)
        {
            if (++count > 20000) { truncated = true; yield break; }
            var node = pending.Pop(); yield return node;
            foreach (var child in node.ChildNodes().Reverse()) pending.Push(child);
        }
    }
    void CollectRule(LiteralExpressionSyntax n)
    {
        string type;
        object value;
        SyntaxNode target = n;
        if (n.IsKind(SyntaxKind.NumericLiteralExpression))
        {
            type = "number";
            if (n.Parent is PrefixUnaryExpressionSyntax prefix && (prefix.IsKind(SyntaxKind.UnaryMinusExpression) || prefix.IsKind(SyntaxKind.UnaryPlusExpression)))
            {
                if (prefix.OperatorToken.Span.End != n.SpanStart) return;
                target = prefix;
            }
            value = Raw(target);
        }
        else if (n.IsKind(SyntaxKind.StringLiteralExpression)) { type = "string"; value = n.Token.ValueText; }
        else if (n.IsKind(SyntaxKind.TrueLiteralExpression) || n.IsKind(SyntaxKind.FalseLiteralExpression)) { type = "boolean"; value = n.IsKind(SyntaxKind.TrueLiteralExpression); }
        else return; // char, null, UTF-8 literal and interpolation have different semantics.
        if (rules.Count >= 300) { truncated = true; return; }
        var rule = At(new Rule { Id = "csharp:" + target.SpanStart, Type = type, Raw = Raw(target), Value = value }, target.Span);
        rule.Name = "C# L" + rule.Line + " @" + rule.Start;
        var label = type == "number" ? "숫자" : type == "boolean" ? "참거짓" : "문자열";
        rule.Label = new(rule.Name + " " + label, rule.Name + " " + type); rules.Add(rule);
    }
    IEnumerable<Step> AllSteps(IEnumerable<Step> initial)
    {
        var pending = new Stack<Step>(initial);
        while (pending.Count > 0)
        {
            var step = pending.Pop(); yield return step;
            foreach (var child in step.Children) pending.Push(child);
            foreach (var child in step.Otherwise ?? new()) pending.Push(child);
            if (step.Finalizer != null) pending.Push(step.Finalizer);
            foreach (var branch in step.Branches ?? new()) foreach (var child in branch.Steps) pending.Push(child);
        }
    }
    public object Analyze()
    {
        var errors = tree.GetDiagnostics().Where(d => d.Severity == DiagnosticSeverity.Error).Take(30).ToList();
        foreach (var error in errors)
        {
            var text = error.Id + ": " + error.GetMessage(CultureInfo.InvariantCulture);
            issues.Add(At(new Issue { Id = "csharp-error:" + issues.Count, Level = "error", Title = new("C# 문법 오류", "C# syntax error"), Detail = new(text, text) }, error.Location.SourceSpan));
        }
        var top = new List<Step>();
        if (errors.Count == 0)
        {
            foreach (var node in Nodes())
            {
                switch (node)
                {
                    case MethodDeclarationSyntax x: AddFunction(x, x.Identifier.Text, x.ParameterList, x.Body, x.ExpressionBody?.Expression, x.Modifiers); break;
                    case ConstructorDeclarationSyntax x: AddFunction(x, x.Identifier.Text, x.ParameterList, x.Body, x.ExpressionBody?.Expression, x.Modifiers); break;
                    case DestructorDeclarationSyntax x: AddFunction(x, "~" + x.Identifier.Text, x.ParameterList, x.Body, x.ExpressionBody?.Expression, x.Modifiers); break;
                    case OperatorDeclarationSyntax x: AddFunction(x, "operator " + x.OperatorToken.Text, x.ParameterList, x.Body, x.ExpressionBody?.Expression, x.Modifiers); break;
                    case ConversionOperatorDeclarationSyntax x: AddFunction(x, x.ImplicitOrExplicitKeyword.Text + " " + Short(x.Type), x.ParameterList, x.Body, x.ExpressionBody?.Expression, x.Modifiers); break;
                    case LocalFunctionStatementSyntax x: AddFunction(x, x.Identifier.Text, x.ParameterList, x.Body, x.ExpressionBody?.Expression, x.Modifiers); break;
                    case LiteralExpressionSyntax x: CollectRule(x); break;
                }
            }
            foreach (var n in root.Members)
            {
                if (steps >= 400) { truncated = true; break; }
                if (n is GlobalStatementSyntax) top.AddRange(ReadBody(n));
                else top.Add(New(n, "선언 원문(" + n.Kind() + "): " + Short(n), "Source declaration (" + n.Kind() + "): " + Short(n), "declaration"));
            }
        }
        if (root.ContainsDirectives)
            issues.Add(At(new Issue { Id = "csharp-directives", Level = "review", Title = new("전처리 조건 확인", "Review preprocessor conditions"), Detail = new("파일 안의 #define/#undef는 반영하지만 프로젝트의 DefineConstants·언어 버전·대상 프레임워크는 읽지 않습니다. 비활성 분기의 코드·값은 분석하지 않습니다. #line으로 원문 위치를 바꾸지 않습니다.", "File #define/#undef are parsed; project DefineConstants, language version and target framework are not loaded. Inactive branches are not analyzed or editable. #line does not remap source navigation.") }, new TextSpan(0, 0)));
        if (truncated)
            issues.Add(At(new Issue { Id = "csharp-limit", Level = "review", Title = new("일부 표시 생략", "Some source omitted"), Detail = new("표시 한도: 400단계·16깊이·100함수·300값·20000노드. 생략한 부분은 원문에서 확인하세요.", "Display limits: 400 steps, depth 16, 100 functions, 300 values, 20000 visited nodes. Review omitted source directly.") }, new TextSpan(0, 0)));
        var displayed = AllSteps(top.Concat(functions.SelectMany(f => f.Steps))).ToList();
        return new { path, kind = "script", lines = tree.GetText().Lines.Count, functions, rules, imports = Array.Empty<object>(), issues, steps = top, explained = displayed.Count(s => s.Supported), total = displayed.Count, syntaxValid = errors.Count == 0, csharp = new { version = typeof(CSharpSyntaxTree).Assembly.GetName().Version!.ToString(), languageVersion = Options.LanguageVersion.ToDisplayString(), truncated } };
    }
    public object Patch(string ruleId, string value)
    {
        if (value.Length > 4096 || value.Contains('\0')) throw new Exception("C# replacement limit: 4096 characters, no NUL.");
        Analyze();
        var rule = rules.SingleOrDefault(r => r.Id == ruleId) ?? throw new Exception("Choose a current editable C# value.");
        string next;
        if (rule.Type == "string") next = SyntaxFactory.Literal(value).Text;
        else if (rule.Type == "boolean") next = value is "true" or "false" ? value : throw new Exception("Use true or false.");
        else
        {
            next = value;
            var expression = SyntaxFactory.ParseExpression(next, options: Options, consumeFullText: true);
            ExpressionSyntax atom = expression;
            if (expression is PrefixUnaryExpressionSyntax p && (p.IsKind(SyntaxKind.UnaryMinusExpression) || p.IsKind(SyntaxKind.UnaryPlusExpression)))
            {
                if (p.OperatorToken.Span.End != p.Operand.SpanStart) throw new Exception("Keep sign adjacent to the numeric literal.");
                atom = p.Operand;
            }
            if (expression.ContainsDiagnostics || expression.SpanStart != 0 || expression.Span.Length != next.Length || expression.ToFullString() != next || atom is not LiteralExpressionSyntax l || !l.IsKind(SyntaxKind.NumericLiteralExpression) || expression.DescendantTrivia().Any()) throw new Exception("Use one C# numeric literal, not an expression or comment.");
        }
        if (next == rule.Raw) throw new Exception("The value has not changed.");
        var updated = source[..rule.Start] + next + source[rule.End..];
        var check = new Reader(path, updated); check.Analyze();
        if (check.tree.GetDiagnostics().Any(d => d.Severity == DiagnosticSeverity.Error) || !check.rules.Any(r => r.Start == rule.Start && r.End == rule.Start + next.Length && r.Type == rule.Type && r.Raw == next)) throw new Exception("Changed C# did not reparse as the same single value.");
        return new { path, ruleId, start = rule.Start, end = rule.End, oldText = rule.Raw, newText = next, original = source, updated, semanticChecked = false, description = new Words(rule.Label.Ko + ": " + rule.Raw + " → " + next, rule.Label.En + ": " + rule.Raw + " → " + next) };
    }
}
static class Program
{
    public static void Main()
    {
        Console.InputEncoding = new UTF8Encoding(false, true);
        Console.OutputEncoding = new UTF8Encoding(false, true);
        var json = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull, MaxDepth = 80 };
        try
        {
            var input = new StringBuilder(); var buffer = new char[4096]; int count;
            while ((count = Console.In.Read(buffer, 0, buffer.Length)) > 0) { input.Append(buffer, 0, count); if (input.Length > 1024 * 1024) throw new Exception("C# request too large."); }
            using var request = JsonDocument.Parse(input.ToString());
            var r = request.RootElement;
            var reader = new Reader(r.GetProperty("path").GetString()!, r.GetProperty("content").GetString()!);
            object result = r.GetProperty("action").GetString() == "analyze" ? reader.Analyze() : r.GetProperty("action").GetString() == "patch" ? reader.Patch(r.GetProperty("ruleId").GetString()!, r.GetProperty("value").GetString()!) : throw new Exception("Unknown C# action.");
            Console.Write(JsonSerializer.Serialize(new { result }, json));
        }
        catch (Exception error) { Console.Write(JsonSerializer.Serialize(new { error = error.Message }, json)); }
    }
}
