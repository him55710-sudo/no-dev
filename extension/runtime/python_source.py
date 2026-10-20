"""Fixed, isolated AST reader. Input is data; user code is never executed/imported."""
import ast
import io
import json
import re
import sys
import tokenize

MAX_SOURCE = 128 * 1024
MAX_STEPS = 400
MAX_DEPTH = 12


def words(ko, en):
    return {"ko": ko, "en": en}


class Reader:
    def __init__(self, source, path):
        self.source = source
        self.lines = re.split(r"(?<=\n)|(?<=\r)(?!\n)", source)
        self.cp_starts, self.js_starts = [], []
        cp, js = 0, 0
        for line in self.lines:
            self.cp_starts.append(cp)
            self.js_starts.append(js)
            cp += len(line)
            js += len(line.encode("utf-16-le")) // 2
        self.count = 0
        self.ranges = {}
        self.out = {
            "path": path, "kind": "script", "lines": len(self.lines),
            "functions": [], "rules": [], "imports": [], "issues": [],
            "steps": [], "explained": 0, "total": 0, "syntaxValid": True,
            "python": {"version": sys.version.split()[0], "truncated": False},
        }

    def position(self, line, column):
        prefix = self.lines[line - 1].encode("utf-8")[:column].decode("utf-8")
        return (self.cp_starts[line - 1] + len(prefix),
                self.js_starts[line - 1] + len(prefix.encode("utf-16-le")) // 2)

    def span(self, node):
        start, js_start = self.position(node.lineno, node.col_offset)
        end, js_end = self.position(node.end_lineno, node.end_col_offset)
        return start, end, {"start": js_start, "end": js_end,
                            "line": node.lineno, "endLine": node.end_lineno}

    def raw(self, node):
        start, end, _ = self.span(node)
        return self.source[start:end]

    def expression(self, node):
        if node is None:
            return "None"
        raw = self.raw(node)
        return raw if len(raw) <= 240 else raw[:240] + "…"

    def rule(self, name, value, scope):
        if len(self.out["rules"]) >= 300:
            self.out["python"]["truncated"] = True
            return
        if value is None:
            return
        raw = self.raw(value)
        if len(raw) > 4096:
            return
        literal = value
        if isinstance(value, ast.UnaryOp) and isinstance(value.op, (ast.UAdd, ast.USub)):
            literal = value.operand
        if not isinstance(literal, ast.Constant):
            return
        v = literal.value
        if type(v) is bool and value is literal:
            kind, display = "boolean", v
        elif type(v) in (int, float):
            kind, display = "number", raw
        elif type(v) is str and value is literal:
            # Replacing implicit string concatenation would also remove comments.
            tokens = [t for t in tokenize.generate_tokens(io.StringIO(raw).readline)
                      if t.type not in (tokenize.NL, tokenize.NEWLINE, tokenize.ENDMARKER)]
            if len(tokens) != 1 or tokens[0].type != tokenize.STRING:
                return
            kind, display = "string", v
        else:
            return
        start, end, anchor = self.span(value)
        identifier = "python:" + str(anchor["start"])
        self.ranges[identifier] = (start, end)
        self.out["rules"].append({**anchor, "id": identifier, "name": name,
            "label": words(name, name), "type": kind, "value": display,
            "scope": scope, "raw": raw, "syntax": "python",
            "note": words("원문에 적힌 값 하나입니다. 사용처·타입·실행 결과는 별도 확인해야 합니다.",
                          "One written literal. Its uses, types and runtime effects need separate checks.")})

    def step(self, node, ko, en, kind="statement", supported=True):
        _, _, anchor = self.span(node)
        self.count += 1
        if supported:
            self.out["explained"] += 1
        return {**anchor, "id": f"py:{anchor['start']}:{self.count}", "kind": kind,
                "text": words(ko, en), "children": [], "supported": supported}

    def sequence(self, body, scope="file", depth=0, cleanup=0, generator=False):
        result = []
        for node in body:
            if self.count >= MAX_STEPS or depth > MAX_DEPTH:
                self.out["python"]["truncated"] = True
                break
            result.append(self.statement(node, scope, depth, cleanup, generator))
        return result

    def statement(self, node, scope, depth, cleanup, generator):
        expr = self.expression
        child = lambda body, final=cleanup: self.sequence(body, scope, depth + 1, final, generator)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            name = node.name if scope == "file" else scope + "." + node.name
            s = self.step(node, f"{name} 함수를 정의합니다. 기본값·데코레이터 식은 정의 시 평가될 수 있으며 본문은 호출과 구별합니다.",
                          f"Define {name}. Defaults and decorators may be evaluated at definition; the body is separate from a call.", "definition")
            if len(self.out["functions"]) < 100:
                args = node.args
                positional = args.posonlyargs + args.args
                defaults = [None] * (len(positional) - len(args.defaults)) + args.defaults
                params = []
                for a, default in list(zip(positional, defaults)) + list(zip(args.kwonlyargs, args.kw_defaults)):
                    params.append({"name": a.arg, "label": words(a.arg, a.arg),
                                   "type": expr(a.annotation) if a.annotation else "—",
                                   "optional": default is not None})
                for prefix, a in (("*", args.vararg), ("**", args.kwarg)):
                    if a:
                        params.append({"name": prefix + a.arg, "label": words(prefix + a.arg, prefix + a.arg),
                                       "type": expr(a.annotation) if a.annotation else "—", "optional": True})
                pending = list(node.body)
                is_generator = False
                while pending:
                    n = pending.pop()
                    if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Lambda)):
                        continue
                    if isinstance(n, (ast.Yield, ast.YieldFrom)):
                        is_generator = True
                    pending.extend(ast.iter_child_nodes(n))
                _, _, anchor = self.span(node)
                function = {**anchor, "id": s["id"], "name": name, "label": words(name, name),
                    "params": params, "calls": [], "async": isinstance(node, ast.AsyncFunctionDef),
                    "simulatable": False, "steps": [],
                    "note": words(
                        "Python AST에서 읽은 본문입니다. 주석/자료형 표기는 검증하지 않으며 호출한 함수의 동작은 추측하지 않습니다." + (" 생성기는 순회 중 yield에서 값을 내보내고 중단·재개합니다." if is_generator else ""),
                        "Body read from Python AST. Comments and annotations are not verified; called-function behavior is not inferred." + (" A generator yields, suspends and resumes during iteration." if is_generator else ""))}
                self.out["functions"].append(function)
                function["steps"] = self.sequence(node.body, name, depth + 1, 0, is_generator)
            else:
                self.out["python"]["truncated"] = True
            return s
        if isinstance(node, ast.ClassDef):
            name = node.name if scope == "file" else scope + "." + node.name
            s = self.step(node, f"클래스 {name}를 정의합니다. 아래는 클래스 본문의 구조이며 생성자 호출 결과가 아닙니다.",
                          f"Define class {name}. Below is the class body, not an instance creation result.", "definition")
            s["children"] = self.sequence(node.body, name, depth + 1, cleanup, generator)
            return s
        if isinstance(node, ast.If):
            s = self.step(node, f"조건 「{expr(node.test)}」이 참으로 평가되면:", f"If the condition evaluates as true: {expr(node.test)}", "condition")
            s["children"] = child(node.body)
            if node.orelse:
                s["otherwise"] = child(node.orelse)
            return s
        if isinstance(node, (ast.For, ast.AsyncFor, ast.While)):
            if isinstance(node, ast.While):
                ko, en = f"조건 「{expr(node.test)}」이 참인 동안 반복합니다.", f"Repeat while the condition is true: {expr(node.test)}"
            else:
                mode = "비동기로 " if isinstance(node, ast.AsyncFor) else ""
                ko = f"「{expr(node.iter)}」를 {mode}순회하며 항목을 「{expr(node.target)}」에 대입합니다."
                en = f"Iterate {'asynchronously ' if mode else ''}over {expr(node.iter)}, assigning each item to {expr(node.target)}."
            s = self.step(node, ko, en, "loop")
            s["children"] = child(node.body)
            if node.orelse:
                s["branches"] = [{"label": words("else: break 없이 정상적으로 반복이 끝나면", "else: after normal loop completion without break"), "steps": child(node.orelse)}]
            return s
        if isinstance(node, (ast.Try, getattr(ast, "TryStar", ast.Try))):
            s = self.step(node, "try 본문을 실행하는 구조입니다. 예외 처리는 아래 분기를 따릅니다.",
                          "Try body; exception handling follows the branches below.", "python-try")
            inner = cleanup + bool(node.finalbody)
            s["children"] = child(node.body, inner)
            s["branches"] = []
            star = type(node).__name__ == "TryStar"
            for handler in node.handlers:
                exception = expr(handler.type) if handler.type else "BaseException"
                binding = f" as {handler.name}" if handler.name else ""
                marker = "except*" if star else "except"
                label = words(f"{marker} {exception}{binding}: {'예외 그룹의 일치하는 부분' if star else '순서대로 처음 일치하는 예외'} 처리",
                              f"{marker} {exception}{binding}: {'matching exception-group portions' if star else 'first matching handler in order'}")
                s["branches"].append({"label": label, "steps": child(handler.body, inner)})
            if node.orelse:
                s["branches"].append({"label": words("else: try 본문이 예외·return·break·continue 없이 끝나면", "else: if try finishes without an exception, return, break or continue"), "steps": child(node.orelse, inner)})
            if node.finalbody:
                final = self.step(node.finalbody[0], "finally: 본문/처리기를 떠날 때 실행되며, 예정된 반환이나 예외를 바꿀 수 있습니다.",
                                  "finally: runs when leaving the body/handlers and can replace a pending return or exception.", "finally")
                self.out["explained"] -= 1  # Synthetic section, not another AST statement.
                final["children"] = child(node.finalbody)
                s["finalizer"] = final
            return s
        if isinstance(node, (ast.With, ast.AsyncWith)):
            contexts = ", ".join(expr(i.context_expr) + (" as " + expr(i.optional_vars) if i.optional_vars else "") for i in node.items)
            s = self.step(node, f"{'async with' if isinstance(node, ast.AsyncWith) else 'with'} 문맥 「{contexts}」에 진입해 본문을 처리합니다. 종료 시 문맥 관리자가 예외를 억제할 수도 있습니다.",
                          f"Enter {'asynchronous ' if isinstance(node, ast.AsyncWith) else ''}context {contexts}; process the body. Context-manager exit may suppress exceptions.", "context")
            s["children"] = child(node.body)
            return s
        if isinstance(node, ast.Return):
            if generator:
                ko, en = f"생성기를 종료합니다. 종료 값: {expr(node.value)}", f"Finish the generator. Completion value: {expr(node.value)}"
            else:
                ko, en = f"「{expr(node.value)}」를 반환하고 함수를 끝내려 합니다.", f"Return {expr(node.value)} and leave the function."
            if cleanup:
                ko += " 바깥 finally가 먼저 실행되며 반환·예외를 바꿀 수 있습니다."
                en += " Enclosing finally runs first and may replace the return or exception."
            return self.step(node, ko, en, "return")
        if isinstance(node, ast.Raise):
            target_ko = expr(node.exc) if node.exc else "현재 예외"
            target_en = expr(node.exc) if node.exc else "active exception"
            cause = f" from {expr(node.cause)}" if node.cause else ""
            return self.step(node, f"예외 「{target_ko}{cause}」를 발생시키거나 다시 전달합니다. 일치하는 처리기가 있으면 그 흐름을 따릅니다.",
                             f"Raise or re-raise {target_en}{cause}; a matching handler can handle it.", "error")
        if isinstance(node, (ast.Assign, ast.AnnAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            names = ", ".join(expr(n) for n in targets)
            if node.value is None:
                return self.step(node, f"「{names}」에 자료형 표기 「{expr(node.annotation)}」를 둡니다. 값을 대입하지는 않습니다.",
                                 f"Annotate {names} with {expr(node.annotation)}; no value is assigned.", "data")
            if len(targets) == 1 and isinstance(targets[0], ast.Name):
                self.rule(targets[0].id, node.value, scope)
            return self.step(node, f"「{expr(node.value)}」를 평가해 「{names}」에 대입합니다.",
                             f"Evaluate {expr(node.value)} and assign to {names}.", "data")
        if isinstance(node, ast.Expr):
            if isinstance(node.value, ast.Constant) and isinstance(node.value.value, str):
                return self.step(node, "문자열 표현식입니다. 함수·클래스·모듈의 첫 구문이면 문서 문자열일 수 있습니다. 내용의 사실 여부는 검증하지 않습니다.",
                                 "String expression; it may be a docstring when first in a function, class or module. Its claims are not verified.", "data")
            if isinstance(node.value, (ast.Yield, ast.YieldFrom)):
                return self.step(node, f"값을 내보내고 중단·재개하는 생성기 식: {expr(node.value)}", f"Generator yield/suspension expression: {expr(node.value)}", "yield")
            return self.step(node, f"식 「{expr(node.value)}」를 평가합니다. 호출의 실제 동작은 해당 구현을 확인해야 합니다.",
                             f"Evaluate {expr(node.value)}. A call's behavior requires inspecting its implementation.", "expression")
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            return self.step(node, f"가져오기 구문: {expr(node)}. 가져오는 모듈의 초기화 동작은 분석하지 않습니다.",
                             f"Import statement: {expr(node)}. Imported-module initialization is not analyzed.", "import")
        if isinstance(node, ast.Break):
            return self.step(node, "가장 가까운 반복문을 빠져나가며 그 반복문의 else를 건너뛰려 합니다." + (" 바깥 finally가 먼저 실행되며 흐름을 바꿀 수 있습니다." if cleanup else ""),
                             "Leave the nearest loop, skipping its else block." + (" Enclosing finally runs first and may change this flow." if cleanup else ""), "break")
        if isinstance(node, ast.Continue):
            return self.step(node, "가장 가까운 반복문의 다음 반복으로 넘어가려 합니다." + (" 바깥 finally가 먼저 실행되며 흐름을 바꿀 수 있습니다." if cleanup else ""),
                             "Continue with the next iteration of the nearest loop." + (" Enclosing finally runs first and may change this flow." if cleanup else ""), "continue")
        if isinstance(node, ast.Pass):
            return self.step(node, "pass: 이 구문은 아무 작업도 하지 않습니다.", "pass: this statement does nothing.")
        if isinstance(node, ast.Assert):
            return self.step(node, f"assert 검사: {expr(node.test)}. 거짓이면 AssertionError; 최적화 모드에서는 생략될 수 있습니다.",
                             f"Assert {expr(node.test)}; false raises AssertionError. Optimized execution may omit this check.", "check")
        return self.step(node, f"아직 구조를 설명하지 않는 {type(node).__name__} 구문입니다. 원문에서 확인하세요: {expr(node)}",
                         f"Unsupported {type(node).__name__} statement; inspect source: {expr(node)}", "unknown", False)

    def analyze(self):
        try:
            tree = ast.parse(self.source, filename="source.py")
            # Compile for scope errors (e.g. return outside a function), never execute.
            compile(tree, "source.py", "exec", dont_inherit=True)
        except (SyntaxError, ValueError) as error:
            self.out["syntaxValid"] = False
            line = min(max(getattr(error, "lineno", 1) or 1, 1), len(self.lines))
            start = self.js_starts[line - 1]
            self.out["issues"].append({"start": start, "end": start, "line": line, "endLine": line,
                "id": "python-syntax", "level": "error", "title": words("Python 문법을 확인해 주세요", "Check Python syntax"),
                "detail": words(str(error)[:1000], str(error)[:1000])})
            return self.out
        self.out["total"] = sum(isinstance(n, ast.stmt) for n in ast.walk(tree))
        self.out["steps"] = self.sequence(tree.body)
        return self.out

    def patch(self, identifier, value):
        self.analyze()
        rule = next((r for r in self.out["rules"] if r["id"] == identifier), None)
        if not rule or not self.out["syntaxValid"]:
            raise ValueError("최신 수정 가능한 값을 선택하세요. / Select a current editable literal.")
        if not isinstance(value, str) or len(value) > 4096:
            raise ValueError("값은 4096자 이내여야 합니다. / Value limit: 4096 characters.")
        if rule["type"] == "string":
            if value == rule["value"]:
                raise ValueError("현재 값과 같습니다. / No change.")
            new = repr(value)
        elif rule["type"] == "boolean":
            if value not in ("true", "false", "True", "False"):
                raise ValueError("True 또는 False를 선택하세요. / Choose True or False.")
            new = "True" if value.lower() == "true" else "False"
        else:
            new = value.strip()
            number = ast.parse(new, mode="eval").body
            if isinstance(number, ast.UnaryOp) and isinstance(number.op, (ast.USub, ast.UAdd)):
                number = number.operand
            if not isinstance(number, ast.Constant) or type(number.value) not in (int, float):
                raise ValueError("Python 숫자 리터럴 하나만 입력하세요. / Enter one Python numeric literal.")
            # The AST must span the entire input: no trailing comments or expressions.
            tokens = [t for t in tokenize.generate_tokens(io.StringIO(new).readline)
                      if t.type not in (tokenize.NEWLINE, tokenize.ENDMARKER)]
            if not (len(tokens) == 1 and tokens[0].type == tokenize.NUMBER or
                    len(tokens) == 2 and tokens[0].string in ("+", "-") and tokens[1].type == tokenize.NUMBER):
                raise ValueError("Python 숫자 리터럴 하나만 입력하세요. / Enter one Python numeric literal.")
        if new == rule["raw"]:
            raise ValueError("현재 값과 같습니다. / No change.")
        start, end = self.ranges[identifier]
        updated = self.source[:start] + new + self.source[end:]
        compile(ast.parse(updated, filename="proposal.py"), "proposal.py", "exec", dont_inherit=True)
        description = f"{rule['name']}: {rule['raw']} → {new}"
        return {"path": self.out["path"], "ruleId": identifier, "start": rule["start"], "end": rule["end"],
                "oldText": rule["raw"], "newText": new, "original": self.source, "updated": updated,
                "description": words(description, description), "semanticChecked": False}


def main():
    payload = json.loads(sys.stdin.buffer.read(MAX_SOURCE * 8 + 1).decode("utf-8"))
    source, path = payload["source"], payload["path"]
    if not isinstance(source, str) or len(source.encode("utf-8")) > MAX_SOURCE:
        raise ValueError("Python 설명은 128KB까지입니다. / Python analysis limit: 128KB.")
    reader = Reader(source, path)
    if payload["action"] == "analyze":
        result = reader.analyze()
    elif payload["action"] == "patch":
        result = reader.patch(payload["ruleId"], payload["value"])
    else:
        raise ValueError("Unknown action")
    return {"result": result}


try:
    response = main()
except Exception as error:
    response = {"error": str(error)[:1000], "kind": type(error).__name__}
sys.stdout.buffer.write(json.dumps(response, ensure_ascii=True, allow_nan=False).encode("utf-8"))
