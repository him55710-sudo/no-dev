import {
  withOptions,
  SQLITE_VERSION,
  VisitorKeys,
  type AstNode,
} from "sqlite3-parser";
import {
  words,
  type Anchor,
  type FileAnalysis,
  type Rule,
  type Step,
  type Words,
} from "./types";

export const sqlLimits = {
  bytes: 128 * 1024,
  nodes: 400,
  depth: 12,
  rules: 300,
  edit: 4096,
};
// Match modern SQLite's numeric separator syntax; the library default disables it.
const { parse } = withOptions({ digitSeparator: "_" });
const numeric =
  /^[+-]?(?:0[xX][\da-fA-F](?:_?[\da-fA-F])*|(?:\d(?:_?\d)*(?:\.(?:\d(?:_?\d)*)?)?|\.\d(?:_?\d)*)(?:[eE][+-]?\d(?:_?\d)*)?)$/;
const keys = VisitorKeys as Partial<Record<AstNode["type"], readonly string[]>>;
const titles: Partial<Record<AstNode["type"], Words>> = {
  SelectStmt: words(
    "조회문 — 실행 결과는 데이터와 호출 환경에 따라 달라집니다",
    "Query — results depend on data and the caller",
  ),
  InsertStmt: words(
    "행 추가·충돌 처리 선언",
    "Insert and conflict-handling statement",
  ),
  UpdateStmt: words("행 수정 선언", "Update statement"),
  DeleteStmt: words("행 삭제 선언", "Delete statement"),
  CreateTableStmt: words("테이블 정의", "Table definition"),
  CreateIndexStmt: words(
    "인덱스 정의 — 속도 향상은 미검증",
    "Index definition — speed improvement unchecked",
  ),
  CreateViewStmt: words("뷰 정의", "View definition"),
  CreateTriggerStmt: words(
    "트리거 정의 — 실행 조건과 본문",
    "Trigger definition — event, condition and body",
  ),
  AlterTableStmt: words("테이블 구조 변경 선언", "Table alteration statement"),
  DropTableStmt: words("테이블 삭제 선언", "Drop table statement"),
  DropIndexStmt: words("인덱스 삭제 선언", "Drop index statement"),
  BeginStmt: words("트랜잭션 시작 선언", "Begin transaction statement"),
  CommitStmt: words("트랜잭션 확정 선언", "Commit transaction statement"),
  RollbackStmt: words("트랜잭션 되돌리기 선언", "Rollback statement"),
  ExplainStmt: words(
    "실행 계획 조회 선언 — 계획을 실제로 조회하지는 않았습니다",
    "Explain statement — no actual plan was obtained",
  ),
  With: words(
    "이 문장 안에서 사용할 이름 붙인 쿼리",
    "Named queries used within this statement",
  ),
  CommonTableExpr: words("이름 붙인 쿼리 정의", "Named query definition"),
  FromClause: words("조회 대상과 결합", "Query sources and joins"),
  JoinedSelectTable: words(
    "결합 방식·조건 — 일치하지 않는 행 처리도 원문 확인",
    "Join type and condition — check unmatched-row handling in source",
  ),
  CaseExpr: words(
    "CASE 분기 — 순서대로 비교하며, ELSE가 없고 일치하지 않으면 NULL",
    "CASE branches — compared in order; no match without ELSE yields NULL",
  ),
  WhenThen: words(
    "WHEN 비교·조건과 THEN 결과",
    "WHEN comparison/condition and THEN result",
  ),
  Limit: words(
    "LIMIT·OFFSET 식 — 음수 LIMIT는 상한 없음, 0은 결과 없음",
    "LIMIT/OFFSET expressions — negative LIMIT has no upper bound; zero returns no rows",
  ),
  FunctionCallExpr: words(
    "함수 호출식 — 함수의 실제 구현은 별도 확인",
    "Function call expression — implementation needs separate checks",
  ),
  ColumnDefinition: words(
    "열 이름·자료형·제약 선언",
    "Column name, type and constraint declaration",
  ),
};
const clauses: Record<string, Words> = {
  limitCount: words(
    "최대 반환 행 수 식",
    "Maximum returned row count expression",
  ),
  limitOffset: words("건너뛸 행 수 식", "Rows to skip expression"),
  whereClause: words(
    "WHERE: 조건이 참인 행이 대상 — NULL은 참이 아님",
    "WHERE: target rows whose condition is true — NULL is not true",
  ),
  having: words(
    "HAVING: 그룹에 적용하는 조건",
    "HAVING: condition applied to groups",
  ),
  groupBy: words("GROUP BY: 묶을 기준 식", "GROUP BY: grouping expression"),
  orderBy: words(
    "ORDER BY: 정렬 식·방향",
    "ORDER BY: ordering expression/direction",
  ),
  returning: words(
    "RETURNING: 변경한 행에서 반환할 식",
    "RETURNING: expression returned from changed rows",
  ),
  elseExpr: words(
    "ELSE: 앞의 CASE 비교·조건에 맞지 않을 때의 값",
    "ELSE: value when preceding CASE comparisons/conditions do not match",
  ),
  whenClause: words("WHEN: 트리거 실행 조건", "WHEN: trigger condition"),
};

function locations(source: string) {
  const starts = [0];
  for (const m of source.matchAll(/\r\n|\r|\n/g))
    starts.push(m.index! + m[0].length);
  const line = (pos: number) => {
    let lo = 0,
      hi = starts.length;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >>> 1;
      if (starts[mid] <= pos) lo = mid;
      else hi = mid;
    }
    return lo + 1;
  };
  return (start: number, end: number): Anchor => ({
    start,
    end,
    line: line(start),
    endLine: line(end),
  });
}

export function readSqlSource(
  source: string,
  dialect: unknown,
  out: FileAnalysis,
) {
  const at = locations(source);
  out.sql = {
    dialect: dialect === "sqlite" ? "sqlite" : undefined,
    version: SQLITE_VERSION,
    truncated: false,
  };
  out.kind = "script";
  out.lines = source.split(/\r\n|\r|\n/).length;
  if (dialect !== "sqlite") return;
  const fail = (detail: Words, start = 0, end = start) => {
    out.syntaxValid = false;
    out.steps = [];
    out.rules = [];
    out.total = out.explained = 0;
    out.issues.push({
      ...at(start, end),
      id: `sql-error:${start}`,
      level: "error",
      title: words(
        "SQLite 원문을 읽을 수 없습니다",
        "Cannot parse SQLite source",
      ),
      detail,
    });
  };
  if (
    new TextEncoder().encode(source).length > sqlLimits.bytes ||
    source.includes("\0")
  ) {
    fail(
      words(
        "SQL은 NUL 없는 128KiB 이하 파일만 분석합니다. 일부만 잘라 검사하지 않습니다.",
        "SQL analysis requires a NUL-free file up to 128KiB. No partial syntax check was performed.",
      ),
    );
    return;
  }
  try {
    const parsed = parse(source, { emitTokens: true });
    if (parsed.status !== "ok") {
      for (const error of parsed.errors.slice(0, 3))
        fail(
          words(error.message, error.message),
          error.span.offset,
          error.span.offset + error.span.length,
        );
      return;
    }
    // Optional grammar prefixes may make node spans begin in leading trivia.
    // Use the parser's non-trivia token stream for actual source navigation.
    const tokens = parsed.tokens || [];
    const sourceStart = (offset: number, end: number) => {
      let lo = 0,
        hi = tokens.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (tokens[mid].span.offset < offset) lo = mid + 1;
        else hi = mid;
      }
      const token = tokens[lo];
      return token && token.span.offset < end ? token.span.offset : offset;
    };
    let visited = 0;
    const visit = (
      node: AstNode,
      into: Step[],
      depth: number,
      relation = "",
      blockLiteral = false,
    ) => {
      if (++visited > sqlLimits.nodes || depth > sqlLimits.depth) {
        out.sql!.truncated = true;
        return;
      }
      const end = node.span.offset + node.span.length,
        start = sourceStart(node.span.offset, end);
      if (start < 0 || end > source.length || end < start)
        throw Error("Invalid parser source range");
      const raw = source.slice(start, end);
      const title = clauses[relation] || titles[node.type];
      const fallback = node.type.endsWith("Stmt") && !title;
      let next = into;
      if (title || fallback) {
        const sample = raw.length > 180 ? raw.slice(0, 180) + "…" : raw;
        const text = title
          ? words(`${title.ko}: ${sample}`, `${title.en}: ${sample}`)
          : words(
              `이 구문은 원문 확인이 필요합니다: ${sample}`,
              `This statement needs source review: ${sample}`,
            );
        const step: Step = {
          ...at(start, end),
          id: `sql:${start}:${relation}:${node.type}`,
          kind: "sql",
          text,
          children: [],
          supported: !fallback,
        };
        into.push(step);
        next = step.children;
        out.total++;
        if (!fallback) out.explained++;
      }
      const signed =
        node.type === "UnaryExpr" &&
        ["Positive", "Negative"].includes(node.op) &&
        node.expr.type === "NumericLiteral";
      if (
        !blockLiteral &&
        (node.type === "NumericLiteral" ||
          node.type === "StringLiteral" ||
          signed)
      ) {
        const isString = node.type === "StringLiteral";
        const valid = isString
          ? /^'(?:[^'\0]|'')*'$/.test(raw)
          : numeric.test(raw);
        if (
          valid &&
          raw.length <= sqlLimits.edit &&
          out.rules.length < sqlLimits.rules
        ) {
          const name = `SQL L${at(start, end).line} @${start}`;
          out.rules.push({
            ...at(start, end),
            id: `sql-value:${start}:${end}`,
            name,
            label: words(
              `${name} ${isString ? "문자열" : "숫자"}`,
              `${name} ${isString ? "string" : "number"}`,
            ),
            value: isString ? raw.slice(1, -1).replace(/''/g, "'") : raw,
            type: isString ? "string" : "number",
            scope: "file",
            raw,
            syntax: "sql",
            note: words(
              "적힌 값만 바꿉니다. 열·자료형·제약·함수·결과·성능은 검증하지 않습니다.",
              "Changes only the written value. Columns, types, constraints, functions, results and performance are unchecked.",
            ),
          });
        } else if (out.rules.length >= sqlLimits.rules)
          out.sql!.truncated = true;
      }
      // A sign separated from its number by comments/whitespace is not a direct edit target.
      for (const key of keys[node.type] || []) {
        const value = (node as unknown as Record<string, unknown>)[key];
        for (const child of Array.isArray(value)
          ? value
          : value
            ? [value]
            : []) {
          if (visited >= sqlLimits.nodes) {
            out.sql!.truncated = true;
            return;
          }
          visit(
            child as AstNode,
            next,
            depth + 1,
            node.type === "Limit"
              ? key === "expr"
                ? "limitCount"
                : "limitOffset"
              : key,
            blockLiteral || signed,
          );
        }
      }
    };
    visit(parsed.root, out.steps, 0);
    if (out.sql.truncated)
      out.issues.push({
        ...at(0, 0),
        id: "sql-limit",
        level: "info",
        title: words("일부 구조 생략", "Some structure omitted"),
        detail: words(
          "표시 한도: AST 400개·12단계·수정 값 300개. 전체 원문 문법은 파싱했지만 모든 구조를 설명하지는 않습니다.",
          "Display limits: 400 AST nodes, 12 levels, 300 editable values. Full source syntax was parsed, but not every structure is described.",
        ),
      });
  } catch {
    fail(
      words(
        "파서가 이 원문을 처리하지 못했습니다. 데이터베이스 실행 검사가 필요합니다.",
        "The parser could not process this source. Check it with your database engine.",
      ),
    );
  }
}

export function sqlReplacement(rule: Rule, input: string) {
  if (input.length > sqlLimits.edit || input.includes("\0"))
    throw Error(
      "SQL 값은 NUL 없이 4096자 이내로 입력하세요. / Enter a NUL-free SQL value up to 4096 characters.",
    );
  if (rule.type === "string") {
    if (input === rule.value) throw Error("현재 값과 같습니다. / No change.");
    return `'${input.replace(/'/g, "''")}'`;
  }
  if (!numeric.test(input.trim()))
    throw Error(
      "SQLite 숫자 하나를 입력하세요. / Enter one SQLite numeric literal.",
    );
  return input.trim();
}
