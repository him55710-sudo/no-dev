// Fixed standard-library reader. User source is parsed as data, never built or run.
package main

import (
	"encoding/json"
	"fmt"
	"go/ast"
	"go/parser"
	"go/scanner"
	"go/token"
	"io"
	"os"
	"runtime"
	"strconv"
	"strings"
	"unicode/utf8"
)

type M = map[string]any
type input struct{ Source, Path, Action, RuleID, Value string }
type reader struct {
	source string
	fs     *token.FileSet
	tree   *ast.File
	out    M
	units  []int
	ends   map[int]int
	ranges map[string][2]int
	count  int
}

func words(ko, en string) M { return M{"ko": ko, "en": en} }
func short(s string) string {
	r := []rune(s)
	if len(r) > 240 {
		return string(r[:240]) + "…"
	}
	return s
}
func (r *reader) anchor(n ast.Node) M {
	a, b := r.fs.PositionFor(n.Pos(), false), r.fs.PositionFor(n.End(), false)
	end := b.Offset
	if actual, ok := r.ends[end]; ok {
		end = actual
	}
	return M{"start": r.units[a.Offset], "end": r.units[end], "line": a.Line, "endLine": r.fs.PositionFor(token.Pos(r.fs.File(n.Pos()).Base()+end), false).Line}
}
func (r *reader) span(n ast.Node) (int, int) {
	a, b := r.fs.PositionFor(n.Pos(), false).Offset, r.fs.PositionFor(n.End(), false).Offset
	if actual, ok := r.ends[b]; ok {
		b = actual
	}
	return a, b
}
func (r *reader) expr(n ast.Node) string {
	if n == nil {
		return ""
	}
	a, b := r.span(n)
	return short(r.source[a:b])
}
func (r *reader) truncated() { r.out["go"].(M)["truncated"] = true }
func (r *reader) step(n ast.Node, kind, ko, en string, supported bool) M {
	s := r.anchor(n)
	r.count++
	s["id"] = fmt.Sprintf("go:%v:%d", s["start"], r.count)
	s["kind"] = kind
	s["text"] = words(ko, en)
	s["children"] = []M{}
	s["supported"] = supported
	if supported {
		r.out["explained"] = r.out["explained"].(int) + 1
	}
	return s
}
func literal(e ast.Expr) (*ast.BasicLit, bool) {
	if u, ok := e.(*ast.UnaryExpr); ok {
		if u.Op != token.ADD && u.Op != token.SUB {
			return nil, false
		}
		b, ok := u.X.(*ast.BasicLit)
		return b, ok && (b.Kind == token.INT || b.Kind == token.FLOAT)
	}
	b, ok := e.(*ast.BasicLit)
	return b, ok && (b.Kind == token.INT || b.Kind == token.FLOAT || b.Kind == token.STRING)
}
func numericTokens(source string) bool {
	var scan scanner.Scanner
	set := token.NewFileSet()
	scan.Init(set.AddFile("literal", set.Base(), len(source)), []byte(source), nil, scanner.ScanComments)
	tokens := []token.Token{}
	for {
		_, t, _ := scan.Scan()
		if t == token.EOF {
			break
		}
		if t != token.SEMICOLON {
			tokens = append(tokens, t)
		}
	}
	if len(tokens) == 1 {
		return tokens[0] == token.INT || tokens[0] == token.FLOAT
	}
	return len(tokens) == 2 && (tokens[0] == token.ADD || tokens[0] == token.SUB) && (tokens[1] == token.INT || tokens[1] == token.FLOAT)
}
func (r *reader) rule(name string, e ast.Expr, scope string) {
	if name == "_" || e == nil {
		return
	}
	rules := r.out["rules"].([]M)
	if len(rules) >= 300 {
		r.truncated()
		return
	}
	lit, ok := literal(e)
	if !ok {
		return
	}
	a, b := r.span(e)
	raw := r.source[a:b]
	if len(raw) > 4096 {
		return
	}
	kind, value := "number", raw
	if lit.Kind != token.STRING && !numericTokens(raw) {
		return
	}
	if lit.Kind == token.STRING {
		kind = "string"
		var err error
		value, err = strconv.Unquote(raw)
		if err != nil || !utf8.ValidString(value) {
			return
		}
	}
	s := r.anchor(e)
	id := fmt.Sprintf("go:%v", s["start"])
	r.ranges[id] = [2]int{a, b}
	s["id"] = id
	s["name"] = name
	s["label"] = words(name, name)
	s["scope"] = scope
	s["type"] = kind
	s["value"] = value
	s["raw"] = raw
	s["syntax"] = "go"
	s["note"] = words("원문 리터럴 하나입니다. 타입·범위·사용처·동작은 별도 검사해야 합니다.", "One written literal. Types, representable range, uses and behavior need separate checks.")
	r.out["rules"] = append(rules, s)
}
func (r *reader) seq(body []ast.Stmt, scope string, depth int) []M {
	out := []M{}
	for _, n := range body {
		if depth > 12 || r.count >= 400 {
			r.truncated()
			break
		}
		out = append(out, r.stmt(n, scope, depth))
	}
	return out
}
func (r *reader) decl(n ast.Decl, scope string, depth int) M {
	switch n := n.(type) {
	case *ast.GenDecl:
		s := r.step(n, "declaration", "선언: "+r.expr(n)+". 표기된 타입·초기화 결과는 검증하지 않습니다.", "Declaration: "+r.expr(n)+". Written types and initialization results are not verified.", true)
		for _, spec := range n.Specs {
			if v, ok := spec.(*ast.ValueSpec); ok && len(v.Names) == 1 && len(v.Values) == 1 {
				r.rule(v.Names[0].Name, v.Values[0], scope)
			}
		}
		return s
	case *ast.FuncDecl:
		name := n.Name.Name
		if n.Recv != nil && len(n.Recv.List) > 0 {
			name = "(" + r.expr(n.Recv.List[0].Type) + ")." + name
		}
		s := r.step(n, "definition", name+" 함수/메서드 선언입니다. 본문을 실행한 결과가 아닙니다.", "Function/method declaration "+name+"; this is not an execution result.", true)
		functions := r.out["functions"].([]M)
		if len(functions) >= 100 {
			r.truncated()
			return s
		}
		params := []M{}
		if n.Type.Params != nil {
			for i, f := range n.Type.Params.List {
				if len(f.Names) == 0 {
					params = append(params, M{"name": fmt.Sprintf("arg%d", i+1), "label": words("이름 없음", "unnamed"), "type": r.expr(f.Type), "optional": false})
				}
				for _, p := range f.Names {
					params = append(params, M{"name": p.Name, "label": words(p.Name, p.Name), "type": r.expr(f.Type), "optional": false})
				}
			}
		}
		fn := r.anchor(n)
		fn["id"] = s["id"]
		fn["name"] = name
		fn["label"] = words(name, name)
		fn["params"] = params
		fn["calls"] = []string{}
		fn["async"] = false
		fn["simulatable"] = false
		result := "—"
		if n.Type.Results != nil {
			result = r.expr(n.Type.Results)
		}
		fn["note"] = words("Go AST에서 읽은 본문입니다. 반환 표기: "+result+". 타입·호출 동작은 미검증입니다. 반환된 error 값은 자동으로 발생한 예외가 아닙니다.", "Body read from Go AST. Declared results: "+result+". Types and called behavior are unchecked. Returning an error value is not an automatically thrown exception.")
		fn["steps"] = []M{}
		if n.Body != nil {
			fn["steps"] = r.seq(n.Body.List, name, depth+1)
		}
		r.out["functions"] = append(functions, fn)
		return s
	}
	return r.step(n, "unknown", "지원하지 않는 선언입니다. 원문 확인: "+r.expr(n), "Unsupported declaration; inspect source: "+r.expr(n), false)
}
func (r *reader) initWrapper(n ast.Node, init ast.Stmt, inner M, scope string, depth int) M {
	if init == nil {
		return inner
	}
	s := r.step(n, "initialization", "초기 구문을 한 번 수행한 뒤 아래 제어 구문으로 진행합니다.", "Perform the initializer once, then enter the control statement below.", true)
	r.out["explained"] = r.out["explained"].(int) - 1
	s["children"] = []M{r.stmt(init, scope, depth+1), inner}
	return s
}
func (r *reader) stmt(n ast.Stmt, scope string, depth int) M {
	child := func(body []ast.Stmt) []M { return r.seq(body, scope, depth+1) }
	switch n := n.(type) {
	case *ast.BlockStmt:
		s := r.step(n, "block", "중괄호 블록입니다.", "Brace-delimited block.", true)
		s["children"] = child(n.List)
		return s
	case *ast.DeclStmt:
		return r.decl(n.Decl, scope, depth)
	case *ast.AssignStmt:
		if len(n.Lhs) == 1 && len(n.Rhs) == 1 {
			if name, ok := n.Lhs[0].(*ast.Ident); ok && (n.Tok == token.ASSIGN || n.Tok == token.DEFINE) {
				r.rule(name.Name, n.Rhs[0], scope)
			}
		}
		return r.step(n, "data", "대입/선언 구문: "+r.expr(n)+". 우변을 평가한 뒤 대입합니다.", "Assignment/declaration: "+r.expr(n)+". Evaluate right-hand expressions before assignment.", true)
	case *ast.IfStmt:
		s := r.step(n, "condition", "조건 「"+r.expr(n.Cond)+"」이 참이면:", "If the condition is true: "+r.expr(n.Cond), true)
		s["children"] = child(n.Body.List)
		if n.Else != nil {
			s["otherwise"] = child([]ast.Stmt{n.Else})
		}
		return r.initWrapper(n, n.Init, s, scope, depth)
	case *ast.ForStmt:
		cond := r.expr(n.Cond)
		koCond, enCond := cond, cond
		if n.Cond == nil {
			koCond, enCond = "조건 없음", "no condition"
		}
		s := r.step(n, "loop", "각 반복 전 조건을 확인합니다: "+koCond, "Check before each iteration: "+enCond, true)
		s["children"] = child(n.Body.List)
		if n.Post != nil {
			s["branches"] = []M{{"label": words("본문 정상 종료 또는 이 반복문의 continue 후 수행하는 후처리", "Post statement after normal body completion or continue for this loop"), "steps": child([]ast.Stmt{n.Post})}}
		}
		return r.initWrapper(n, n.Init, s, scope, depth)
	case *ast.RangeStmt:
		binding := ""
		if n.Key != nil {
			binding = r.expr(n.Key)
			if n.Value != nil {
				binding += ", " + r.expr(n.Value)
			}
			binding += " " + n.Tok.String() + " "
		}
		s := r.step(n, "loop", "range 반복 구문: "+binding+"range "+r.expr(n.X)+". 식의 타입에 따라 순회 방식이 달라집니다.", "Range loop: "+binding+"range "+r.expr(n.X)+". Iteration depends on the expression's type.", true)
		s["children"] = child(n.Body.List)
		return s
	case *ast.ReturnStmt:
		values := []string{}
		for _, e := range n.Results {
			values = append(values, r.expr(e))
		}
		ko, en := "반환식 ["+strings.Join(values, ", ")+"]를 평가해 반환하려 합니다.", "Evaluate and return result expressions ["+strings.Join(values, ", ")+"]."
		if len(values) == 0 {
			ko = "명시한 반환식이 없는 return입니다. 이름 있는 결과 변수 또는 반환값 없는 함수를 확인하세요."
			en = "Return with no explicit expressions; inspect named result variables or the void signature."
		}
		return r.step(n, "return", ko+" 등록된 defer 호출은 함수가 끝나기 전에 역순으로 실행되며 결과나 흐름을 바꿀 수 있습니다.", en+" Registered deferred calls run in reverse order before function exit and may change results or control flow.", true)
	case *ast.DeferStmt:
		return r.step(n, "defer", "defer 「"+r.expr(n.Call)+"」: 함수 값과 인자는 지금 평가하고 호출은 이 함수가 끝날 때까지 미룹니다. 등록된 호출은 역순으로 실행됩니다.", "defer "+r.expr(n.Call)+": evaluate the function value and arguments now; postpone the call until this function exits. Registered calls run in reverse order.", true)
	case *ast.GoStmt:
		return r.step(n, "goroutine", "go 「"+r.expr(n.Call)+"」: 함수 값과 인자를 현재 고루틴에서 평가하고 호출은 별도 고루틴에서 진행합니다. 완료 순서는 보장하지 않습니다.", "go "+r.expr(n.Call)+": evaluate the function value and arguments in the current goroutine; run the call in another goroutine. Completion order is not established.", true)
	case *ast.SwitchStmt:
		tag := r.expr(n.Tag)
		koTag, enTag := tag, tag
		if n.Tag == nil {
			koTag, enTag = "true (생략된 식)", "true (omitted expression)"
		}
		s := r.step(n, "switch", "switch 식 「"+koTag+"」과 일치하는 첫 case로 진행하며 기본적으로 자동 fallthrough 하지 않습니다.", "Switch on "+enTag+"; enter the first matching case, with no implicit fallthrough.", true)
		s["branches"] = r.cases(n.Body.List, scope, depth, false)
		return r.initWrapper(n, n.Init, s, scope, depth)
	case *ast.TypeSwitchStmt:
		s := r.step(n, "switch", "타입 switch: "+r.expr(n.Assign)+". 동적 타입과 일치하는 case를 선택하는 구조이며 타입 자체를 검증하지 않습니다.", "Type switch: "+r.expr(n.Assign)+". Select a matching dynamic-type case; types themselves are not verified.", true)
		s["branches"] = r.cases(n.Body.List, scope, depth, true)
		return r.initWrapper(n, n.Init, s, scope, depth)
	case *ast.SelectStmt:
		s := r.step(n, "select", "select: 준비된 통신 중 하나를 선택합니다. 여러 개면 의사 무작위로 선택하고, 없으면 default 또는 대기합니다.", "Select one ready communication; choose pseudo-randomly if several are ready, otherwise use default or block.", true)
		branches := []M{}
		for _, part := range n.Body.List {
			if r.count >= 400 || depth > 12 {
				r.truncated()
				break
			}
			r.count++
			c := part.(*ast.CommClause)
			text := "default"
			if c.Comm != nil {
				text = r.expr(c.Comm)
			}
			branches = append(branches, M{"label": words(text, text), "steps": child(c.Body)})
		}
		s["branches"] = branches
		return s
	case *ast.BranchStmt:
		target := ""
		if n.Label != nil {
			target = " " + n.Label.Name
		}
		text := n.Tok.String() + target
		return r.step(n, "branch", "제어 이동 「"+text+"」입니다. 대상 반복문·switch·레이블과 주변 제어 흐름을 원문에서 확인하세요.", "Control transfer "+text+"; inspect its loop, switch or label target and surrounding flow.", true)
	case *ast.LabeledStmt:
		s := r.step(n, "label", "레이블 "+n.Label.Name, "Label "+n.Label.Name, true)
		s["children"] = child([]ast.Stmt{n.Stmt})
		return s
	case *ast.ExprStmt:
		return r.step(n, "expression", "식 「"+r.expr(n.X)+"」을 평가합니다. 호출한 구현의 동작은 추측하지 않습니다.", "Evaluate "+r.expr(n.X)+"; behavior of called implementations is not inferred.", true)
	case *ast.SendStmt:
		return r.step(n, "channel", "채널 전송 구문: "+r.expr(n)+". 채널 상태에 따라 대기하거나 실패할 수 있습니다.", "Channel send: "+r.expr(n)+". It may block or fail depending on channel state.", true)
	case *ast.IncDecStmt:
		return r.step(n, "data", "증감 구문: "+r.expr(n), "Increment/decrement statement: "+r.expr(n), true)
	case *ast.EmptyStmt:
		return r.step(n, "empty", "빈 구문입니다.", "Empty statement.", true)
	}
	return r.step(n, "unknown", "지원하지 않는 구문입니다. 원문 확인: "+r.expr(n), "Unsupported statement; inspect source: "+r.expr(n), false)
}
func (r *reader) cases(body []ast.Stmt, scope string, depth int, types bool) []M {
	out := []M{}
	for _, part := range body {
		if r.count >= 400 || depth > 12 {
			r.truncated()
			break
		}
		r.count++
		c := part.(*ast.CaseClause)
		values := []string{}
		for _, e := range c.List {
			values = append(values, r.expr(e))
		}
		text := "case " + strings.Join(values, ", ")
		if c.List == nil {
			text = "default"
		}
		out = append(out, M{"label": words(text, text), "steps": r.seq(c.Body, scope, depth+1)})
	}
	return out
}
func newReader(in input) *reader {
	units := make([]int, len(in.Source)+1)
	count := 0
	for offset, ch := range in.Source {
		units[offset] = count
		count++
		if ch > 0xffff {
			count++
		}
	}
	units[len(in.Source)] = count
	return &reader{source: in.Source, fs: token.NewFileSet(), units: units, ends: map[int]int{}, ranges: map[string][2]int{}, out: M{"path": in.Path, "kind": "script", "lines": strings.Count(in.Source, "\n") + 1, "functions": []M{}, "rules": []M{}, "imports": []M{}, "issues": []M{}, "steps": []M{}, "explained": 0, "total": 0, "syntaxValid": true, "go": M{"version": runtime.Version(), "truncated": false}}}
}
func (r *reader) analyze() M {
	tree, err := parser.ParseFile(r.fs, "source.go", r.source, parser.AllErrors|parser.SkipObjectResolution)
	r.tree = tree
	if err != nil {
		r.out["syntaxValid"] = false
		offset, line := 0, 1
		if errors, ok := err.(scanner.ErrorList); ok && len(errors) > 0 {
			offset = errors[0].Pos.Offset
			line = strings.Count(r.source[:offset], "\n") + 1
		}
		r.out["issues"] = []M{{"start": r.units[offset], "end": r.units[offset], "line": line, "endLine": line, "id": "go-syntax", "level": "error", "title": words("Go 문법을 확인하세요", "Check Go syntax"), "detail": words(short(err.Error()), short(err.Error()))}}
		return r.out
	}
	// Go's AST removes CR characters inside raw literals; recover the true source end.
	ast.Inspect(tree, func(n ast.Node) bool {
		if b, ok := n.(*ast.BasicLit); ok && b.Kind == token.STRING && strings.HasPrefix(b.Value, "`") {
			a := r.fs.PositionFor(b.Pos(), false).Offset
			if rel := strings.IndexByte(r.source[a+1:], '`'); rel >= 0 {
				r.ends[r.fs.PositionFor(b.End(), false).Offset] = a + rel + 2
			}
		}
		if _, ok := n.(ast.Stmt); ok {
			r.out["total"] = r.out["total"].(int) + 1
		}
		return true
	})
	steps := []M{}
	for _, d := range tree.Decls {
		if r.count >= 400 {
			r.truncated()
			break
		}
		steps = append(steps, r.decl(d, "file", 0))
	}
	r.out["steps"] = steps
	// Counts represent displayed source units, not percentage of semantic understanding.
	r.out["total"] = r.out["total"].(int) + len(tree.Decls)
	return r.out
}
func (r *reader) patch(in input) (M, error) {
	r.analyze()
	var rule M
	for _, candidate := range r.out["rules"].([]M) {
		if candidate["id"] == in.RuleID {
			rule = candidate
			break
		}
	}
	if rule == nil || r.out["syntaxValid"] != true {
		return nil, fmt.Errorf("최신 수정 가능한 값을 선택하세요. / Select a current editable literal.")
	}
	if utf8.RuneCountInString(in.Value) > 4096 {
		return nil, fmt.Errorf("값 제한: 4096자 / Value limit: 4096 characters")
	}
	replacement := strings.TrimSpace(in.Value)
	if rule["type"] == "string" {
		if in.Value == rule["value"] {
			return nil, fmt.Errorf("No change / 현재 값과 같습니다")
		}
		replacement = strconv.Quote(in.Value)
	} else {
		expression, err := parser.ParseExpr(replacement)
		if err != nil {
			return nil, fmt.Errorf("Go 숫자 리터럴 하나를 입력하세요. / Enter one Go numeric literal.")
		}
		lit, ok := literal(expression)
		if !ok || lit.Kind == token.STRING || int(expression.Pos()) != 1 || int(expression.End()) != len(replacement)+1 {
			return nil, fmt.Errorf("Go 숫자 리터럴 하나만 입력하세요. / Enter exactly one Go numeric literal.")
		}
		if !numericTokens(replacement) {
			return nil, fmt.Errorf("Not one numeric literal")
		}
	}
	if replacement == rule["raw"] {
		return nil, fmt.Errorf("No change / 현재 값과 같습니다")
	}
	span := r.ranges[in.RuleID]
	updated := r.source[:span[0]] + replacement + r.source[span[1]:]
	if _, err := parser.ParseFile(token.NewFileSet(), "proposal.go", updated, parser.AllErrors|parser.SkipObjectResolution); err != nil {
		return nil, fmt.Errorf("Go proposal syntax: %s", short(err.Error()))
	}
	description := fmt.Sprintf("%v: %v → %s", rule["name"], rule["raw"], replacement)
	return M{"path": in.Path, "ruleId": in.RuleID, "start": rule["start"], "end": rule["end"], "oldText": rule["raw"], "newText": replacement, "original": in.Source, "updated": updated, "description": words(description, description), "semanticChecked": false}, nil
}
func run() (any, error) {
	var in input
	data, err := io.ReadAll(io.LimitReader(os.Stdin, 128*1024*8+1))
	if err != nil {
		return nil, err
	}
	if err = json.Unmarshal(data, &in); err != nil {
		return nil, err
	}
	if len(in.Source) > 128*1024 {
		return nil, fmt.Errorf("Go source limit: 128KiB")
	}
	r := newReader(in)
	switch in.Action {
	case "analyze":
		return r.analyze(), nil
	case "patch":
		return r.patch(in)
	default:
		return nil, fmt.Errorf("Unknown action")
	}
}
func main() {
	result, err := run()
	response := M{"result": result}
	if err != nil {
		response = M{"error": short(err.Error())}
	}
	json.NewEncoder(os.Stdout).Encode(response)
}
