import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

export type SqlDialect = "sqlite" | "mysql" | "postgres" | "bigquery" | "snowflake";
export type DigestCoverageStatus = "checked" | "not_applicable" | "unsupported" | "insufficient_evidence";

export interface SchemaForeignKey {
  readonly columns: readonly string[];
  readonly references: { readonly table: string; readonly columns: readonly string[] };
}

export interface SchemaTable {
  readonly name: string;
  readonly columns: readonly string[];
  readonly primaryKey?: readonly string[];
  readonly uniqueKeys?: readonly (readonly string[])[];
  readonly foreignKeys?: readonly SchemaForeignKey[];
  readonly description?: string;
}

export interface SchemaEvidence {
  readonly connectionId: string;
  readonly dialect: SqlDialect;
  readonly tables: readonly SchemaTable[];
  readonly reviewedDescriptions?: Readonly<Record<string, string>>;
}

export interface DigestSource {
  readonly name: string;
  readonly alias?: string;
}

export interface DigestJoin {
  readonly type: string;
  /** Immediate left relation when the authoritative parser can identify it. */
  readonly left?: DigestSource;
  readonly source: DigestSource;
  readonly condition?: string;
}

export type PopulationEffectKind = "filter" | "having" | "qualify" | "inner_join" | "semi_join" | "anti_join" | "distinct" | "set_operation" | "structural" | "unknown";
export type PopulationEffectStatus = "authorized" | "structural" | "disputed" | "unresolved";

export interface PopulationEffectNode {
  readonly path: string;
  readonly kind: PopulationEffectKind;
  readonly expression: string;
  readonly value?: string;
  readonly source?: string;
  readonly status?: PopulationEffectStatus;
}

export type CardinalityEvidenceStatus = "one_to_one" | "one_to_many" | "many_to_one" | "fanout" | "many_to_many" | "unknown";

export interface DigestCardinalityEvidence {
  readonly left: string;
  readonly right: string;
  readonly status: CardinalityEvidenceStatus;
  readonly fanoutFactor?: number;
  readonly source: "formal" | "observed_snapshot";
  readonly snapshotId?: string;
  readonly duplicatedSide?: "left" | "right";
  readonly duplicateKeys?: readonly string[];
}

export interface DigestMeasure {
  readonly function: string;
  readonly expression: string;
  readonly output?: string;
  readonly inputRelations?: readonly string[];
  readonly aggregationLevel?: readonly string[];
  readonly distinct?: boolean;
}

export interface DigestProjection {
  readonly output: string;
  readonly expression: string;
}

export interface DigestOutputLineage {
  readonly output: string;
  readonly expression: string;
  readonly columns: readonly string[];
}

export interface DigestWindow {
  readonly function: string;
  readonly partitionBy: readonly string[];
  readonly orderBy: readonly string[];
  /** Select-list alias used by QUALIFY, when the parser can bind one. */
  readonly output?: string;
  readonly frame?: string;
}

export interface QueryDigest {
  readonly normalizedSql: string;
  readonly normalizedSqlHash: string;
  readonly dialect: SqlDialect;
  readonly parserVersion: string;
  readonly parserEngine: "sqlglot" | "deterministic-tokenizer";
  readonly queryDigestVersion: string;
  readonly schemaEvidenceFingerprint: string;
  readonly sources: readonly DigestSource[];
  readonly joins: readonly DigestJoin[];
  readonly filters: readonly string[];
  /** Independent top-level QUALIFY expression; filters also retain it for compatibility. */
  readonly qualify?: string;
  readonly measures: readonly DigestMeasure[];
  readonly groupBy: readonly string[];
  readonly projections: readonly DigestProjection[];
  readonly outputLineage: readonly DigestOutputLineage[];
  readonly windows: readonly DigestWindow[];
  readonly orderBy: readonly string[];
  readonly limit?: number;
  readonly setOperations: readonly string[];
  readonly nullHandling: readonly string[];
  readonly populationEffects?: readonly PopulationEffectNode[];
  readonly cardinalityEvidence?: readonly DigestCardinalityEvidence[];
  readonly coverage: Readonly<Record<string, DigestCoverageStatus>>;
  readonly unsupportedNodes: readonly string[];
  readonly lineageCompleteness: "complete" | "partial" | "unsupported";
}

export interface QueryDigestInput {
  readonly sql: string;
  readonly dialect: SqlDialect;
  readonly schema?: SchemaEvidence;
}

export interface QueryDigestCompiler {
  compile(input: QueryDigestInput): QueryDigest;
}

export interface SqlglotQueryDigestCompilerOptions {
  readonly executable: string;
  readonly timeoutMs?: number;
}

export const QUERY_DIGEST_PARSER_VERSION = "query-digest-tokenizer-3";
/** The managed parser version calibrated for authoritative Query Digests. */
export const SQLGLOT_RUNTIME_VERSION = "30.17.0";
const SQLGLOT_SCRIPT = [
  "import json, sys, sqlglot",
  "from sqlglot import exp",
  "payload = json.loads(sys.stdin.read())",
  "expression = sqlglot.parse_one(payload['sql'], read=payload['dialect'])",
  "def sql(node): return node.sql() if node is not None else ''",
  "def source(node): return {'name': node.name, **({'alias': node.alias} if node.alias else {})}",
  "sources = [source(node) for node in expression.find_all(exp.Table)]",
  "select = expression if isinstance(expression, exp.Select) else next(iter(expression.find_all(exp.Select)), expression)",
  "ctes = list(expression.find_all(exp.CTE))",
  "projections = []",
  "lineage = []",
  "for node in getattr(select, 'expressions', []):",
  "    output = node.alias_or_name or sql(node)",
  "    body = node.this if isinstance(node, exp.Alias) else node",
  "    columns = list(dict.fromkeys(sql(column) for column in body.find_all(exp.Column)))",
  "    projections.append({'output': output, 'expression': sql(body)})",
  "    lineage.append({'output': output, 'expression': sql(body), 'columns': columns})",
  "group = select.args.get('group')",
  "group_by = [sql(node) for node in group.expressions] if group is not None else []",
  "measures = []",
  "for node in expression.find_all(exp.AggFunc):",
  "    inputs = list(dict.fromkeys(column.table for column in node.find_all(exp.Column) if column.table))",
  "    measures.append({'function': node.key.upper(), 'expression': sql(node), 'inputRelations': inputs, 'aggregationLevel': group_by, 'distinct': bool(node.args.get('distinct'))})",
  "joins = []",
  "from_clause = select.args.get('from_') or select.args.get('from')",
  "current_relation = from_clause.this if from_clause is not None else None",
  "for node in select.args.get('joins') or []:",
  "    target = node.this",
  "    kind = (node.args.get('side') or node.args.get('kind') or 'INNER').upper()",
  "    join = {'type': kind, 'source': source(target) if isinstance(target, exp.Table) else {'name': sql(target)}}",
  "    if isinstance(current_relation, exp.Table): join['left'] = source(current_relation)",
  "    if node.args.get('on') is not None: join['condition'] = sql(node.args['on'])",
  "    elif node.args.get('using'): join['condition'] = 'USING (' + ', '.join(sql(item) for item in node.args['using']) + ')'",
  "    joins.append(join)",
  "    current_relation = target",
  "def clause(name):",
  "    node = select.args.get(name)",
  "    return sql(node.this if hasattr(node, 'this') else node) if node is not None else ''",
  "qualify = clause('qualify')",
  "filters = [value for value in [clause('where'), clause('having'), qualify] if value]",
  "group = select.args.get('group')",
  "group_by = [sql(node) for node in group.expressions] if group is not None else []",
  "order = select.args.get('order')",
  "order_by = [sql(node) for node in order.expressions] if order is not None else []",
  "limit = select.args.get('limit')",
  "limit_value = int(limit.expression.name) if limit is not None and limit.expression is not None and str(limit.expression.name).isdigit() else None",
  "windows = []",
  "for projection in getattr(select, 'expressions', []):",
  "    output = projection.alias_or_name or sql(projection)",
  "    body = projection.this if isinstance(projection, exp.Alias) else projection",
  "    for node in body.find_all(exp.Window):",
  "        windows.append({'function': (node.this.sql_name().upper() if node.this is not None else 'WINDOW'), 'partitionBy': [sql(item) for item in node.args.get('partition_by', [])], 'orderBy': [sql(item) for item in (node.args.get('order') or exp.Order()).expressions], 'output': output})",
  "set_operations = [node.key.upper() + (' ALL' if node.args.get('distinct') is False else '') for node in expression.find_all((exp.Union, exp.Intersect, exp.Except))]",
  "null_handling = list(dict.fromkeys(node.key.upper() for node in expression.find_all(exp.Func) if node.key.upper() in {'COALESCE', 'NULLIF'}))",
  "unsupported = []",
  "if ctes: unsupported.append('cte')",
  "if set_operations: unsupported.append('set_operation')",
  "if any(isinstance(node, exp.Case) for node in expression.walk()): unsupported.append('case_expression')",
  "if any(isinstance(node, exp.Subquery) for node in expression.walk()): unsupported.append('subquery')",
  "population_effects = [{'path': f'filters[{index}]', 'kind': 'filter', 'expression': value} for index, value in enumerate(filters)]",
  "population_effects += [{'path': f'joins[{index}]', 'kind': 'inner_join', 'expression': join.get('condition', ''), 'source': join['source']['name']} for index, join in enumerate(joins) if join['type'] == 'INNER']",
  "if select.args.get('distinct') is not None: population_effects.append({'path': 'distinct', 'kind': 'distinct', 'expression': 'DISTINCT'})",
  "population_effects += [{'path': f'setOperations[{index}]', 'kind': 'set_operation', 'expression': value} for index, value in enumerate(set_operations)]",
  "coverage = {key: ('unsupported' if unsupported and (any(item in unsupported for item in {'cte', 'set_operation', 'case_expression', 'subquery'}) or key in {'outputLineage', 'sources', 'joins', 'measures', 'groupBy'}) else ('checked' if value else 'not_applicable')) for key, value in {'sources': sources, 'joins': joins, 'filters': filters, 'qualify': qualify, 'measures': measures, 'groupBy': group_by, 'projections': projections, 'outputLineage': lineage, 'windows': windows, 'orderBy': order_by, 'setOperations': set_operations, 'nullHandling': null_handling}.items()}",
  "digest = {'sources': sources, 'joins': joins, 'filters': filters, 'qualify': qualify, 'measures': measures, 'groupBy': group_by, 'projections': projections, 'outputLineage': lineage, 'windows': windows, 'orderBy': order_by, 'limit': limit_value, 'setOperations': set_operations, 'nullHandling': null_handling, 'populationEffects': population_effects, 'coverage': coverage, 'unsupportedNodes': unsupported, 'lineageCompleteness': 'partial' if unsupported else 'complete'}",
  "print(json.dumps({'version': getattr(sqlglot, '__version__', 'unknown'), 'sql': expression.sql(), 'digest': digest}, ensure_ascii=False))",
].join("\n");
export const QUERY_DIGEST_VERSION = "3";
const AGGREGATE_FUNCTIONS = new Set(["COUNT", "SUM", "AVG", "MIN", "MAX", "TOTAL", "GROUP_CONCAT"]);
const CLAUSE_WORDS = new Set(["WHERE", "GROUP", "HAVING", "ORDER", "LIMIT", "UNION", "INTERSECT", "EXCEPT", "FETCH", "QUALIFY", "JOIN", "LEFT", "RIGHT", "FULL", "INNER", "CROSS"]);
const IDENTIFIER_STOP_WORDS = new Set([
  "SELECT", "FROM", "JOIN", "LEFT", "RIGHT", "FULL", "INNER", "OUTER", "CROSS", "ON", "USING", "WHERE", "GROUP", "BY", "HAVING", "ORDER", "LIMIT", "UNION", "ALL", "INTERSECT", "EXCEPT", "FETCH", "QUALIFY",
]);
const SQL_KEYWORDS = new Set([
  ...IDENTIFIER_STOP_WORDS,
  "AS", "AND", "OR", "NOT", "NULL", "IS", "IN", "CASE", "WHEN", "THEN", "ELSE", "END", "DISTINCT", "ASC", "DESC", "OVER", "PARTITION", "ROWS", "RANGE", "BETWEEN", "CURRENT", "ROW", "PRECEDING", "FOLLOWING", "FILTER", "TRUE", "FALSE",
]);

type TokenKind = "word" | "number" | "string" | "quoted" | "symbol";
interface Token { readonly kind: TokenKind; readonly value: string; }

function isWordStart(char: string): boolean { return /[A-Za-z_]/.test(char); }
function isWordPart(char: string): boolean { return /[A-Za-z0-9_$]/.test(char); }
function isDigit(char: string): boolean { return char >= "0" && char <= "9"; }

function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < sql.length) {
    const char = sql[index];
    if (/\s/.test(char)) { index += 1; continue; }
    if (char === "-" && sql[index + 1] === "-") {
      index += 2;
      while (index < sql.length && sql[index] !== "\n") index += 1;
      continue;
    }
    if (char === "/" && sql[index + 1] === "*") {
      index += 2;
      while (index < sql.length && !(sql[index] === "*" && sql[index + 1] === "/")) index += 1;
      index += index < sql.length ? 2 : 0;
      continue;
    }
    if (char === "#") {
      index += 1;
      while (index < sql.length && sql[index] !== "\n") index += 1;
      continue;
    }
    if (char === "'" || char === '"' || char === "`" || char === "[") {
      const quote = char === "[" ? "]" : char;
      const start = index;
      index += 1;
      while (index < sql.length) {
        if (sql[index] === quote) {
          if (sql[index + 1] === quote) { index += 2; continue; }
          index += 1;
          break;
        }
        if (char === "'" && sql[index] === "\\") index += 2;
        else index += 1;
      }
      tokens.push({ kind: char === "'" ? "string" : "quoted", value: sql.slice(start, index) });
      continue;
    }
    if (isWordStart(char)) {
      const start = index;
      index += 1;
      while (index < sql.length && isWordPart(sql[index])) index += 1;
      tokens.push({ kind: "word", value: sql.slice(start, index) });
      continue;
    }
    if (isDigit(char) || (char === "." && isDigit(sql[index + 1] ?? ""))) {
      const start = index;
      index += 1;
      while (index < sql.length && /[0-9.eE+-]/.test(sql[index]) && !(sql[index] === "+" || sql[index] === "-") || (sql[index - 1] === "e" || sql[index - 1] === "E")) index += 1;
      tokens.push({ kind: "number", value: sql.slice(start, index) });
      continue;
    }
    const two = sql.slice(index, index + 2);
    if (["<=", ">=", "<>", "!=", "||", "::", "+=", "-=", "->"].includes(two)) {
      tokens.push({ kind: "symbol", value: two });
      index += 2;
      continue;
    }
    tokens.push({ kind: "symbol", value: char });
    index += 1;
  }
  return tokens;
}

function upper(token: Token | undefined): string { return token?.value.toUpperCase() ?? ""; }
function sameWord(token: Token | undefined, value: string): boolean { return upper(token) === value; }
function depthAt(tokens: readonly Token[], index: number): number {
  let depth = 0;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (tokens[cursor].value === "(") depth += 1;
    else if (tokens[cursor].value === ")") depth = Math.max(0, depth - 1);
  }
  return depth;
}

function findTopLevel(tokens: readonly Token[], word: string, start = 0): number {
  let depth = 0;
  for (let index = start; index < tokens.length; index += 1) {
    const value = tokens[index].value;
    if (value === "(") { depth += 1; continue; }
    if (value === ")") { depth = Math.max(0, depth - 1); continue; }
    if (depth === 0 && sameWord(tokens[index], word)) return index;
  }
  return -1;
}

function findTopLevelAny(tokens: readonly Token[], words: ReadonlySet<string>, start: number): number {
  let depth = 0;
  for (let index = start; index < tokens.length; index += 1) {
    const value = tokens[index].value;
    if (value === "(") { depth += 1; continue; }
    if (value === ")") { depth = Math.max(0, depth - 1); continue; }
    if (depth === 0 && words.has(upper(tokens[index]))) return index;
  }
  return tokens.length;
}

function matchingParen(tokens: readonly Token[], open: number): number {
  let depth = 0;
  for (let index = open; index < tokens.length; index += 1) {
    if (tokens[index].value === "(") depth += 1;
    else if (tokens[index].value === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function splitTopLevel(tokens: readonly Token[], start: number, end: number): Token[][] {
  const result: Token[][] = [];
  let itemStart = start;
  let depth = 0;
  for (let index = start; index < end; index += 1) {
    if (tokens[index].value === "(") depth += 1;
    else if (tokens[index].value === ")") depth = Math.max(0, depth - 1);
    else if (tokens[index].value === "," && depth === 0) {
      if (index > itemStart) result.push(tokens.slice(itemStart, index));
      itemStart = index + 1;
    }
  }
  if (itemStart < end) result.push(tokens.slice(itemStart, end));
  return result;
}

function render(tokens: readonly Token[]): string {
  let output = "";
  for (const token of tokens) {
    const value = token.value;
    if (value === ",") { output = `${output.trimEnd()}, `; continue; }
    if (value === "." || value === ")" || output.endsWith(".") || output.endsWith("(")) { output += value; continue; }
    if (value === "(") { output = `${output.trimEnd()}(`; continue; }
    if (!output) { output = value; continue; }
    output += ` ${value}`;
  }
  return output.trim();
}

function identifier(tokens: readonly Token[], start: number): { name?: string; next: number } {
  if (!tokens[start] || tokens[start].value === "(") return { next: start };
  let index = start;
  let name = tokens[index].value;
  index += 1;
  while (tokens[index]?.value === "." && tokens[index + 1] && !["(", ")", ","].includes(tokens[index + 1].value)) {
    name += `.${tokens[index + 1].value}`;
    index += 2;
  }
  return { name, next: index };
}

function sourceAt(tokens: readonly Token[], start: number): { source?: DigestSource; next: number; subquery: boolean } {
  if (tokens[start]?.value === "(") return { next: matchingParen(tokens, start) + 1, subquery: true };
  const parsed = identifier(tokens, start);
  if (!parsed.name) return { next: start, subquery: false };
  let next = parsed.next;
  let alias: string | undefined;
  if (sameWord(tokens[next], "AS")) {
    alias = tokens[next + 1]?.value;
    next += alias ? 2 : 1;
  } else if (tokens[next]?.kind === "word" && !IDENTIFIER_STOP_WORDS.has(upper(tokens[next]))) {
    alias = tokens[next].value;
    next += 1;
  }
  return { source: { name: parsed.name, ...(alias ? { alias } : {}) }, next, subquery: false };
}

function clauseEnd(tokens: readonly Token[], start: number): number {
  return findTopLevelAny(tokens, CLAUSE_WORDS, start);
}

function aliasAndExpression(tokens: readonly Token[]): { expression: string; output: string } {
  const asIndex = tokens.findIndex((token, index) => index > 0 && sameWord(token, "AS"));
  if (asIndex >= 0 && tokens[asIndex + 1]) return { expression: render(tokens.slice(0, asIndex)), output: tokens[asIndex + 1].value };
  const last = tokens.at(-1);
  if (tokens.length > 1 && last?.kind === "word" && !SQL_KEYWORDS.has(upper(last)) && tokens[tokens.length - 2]?.value !== ".") {
    return { expression: render(tokens.slice(0, -1)), output: last.value };
  }
  return { expression: render(tokens), output: render(tokens) };
}

function expressionColumns(tokens: readonly Token[]): string[] {
  const columns: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.kind !== "word" && token.kind !== "quoted") continue;
    const value = upper(token);
    if (SQL_KEYWORDS.has(value) || AGGREGATE_FUNCTIONS.has(value) || upper(tokens[index + 1]) === "(") continue;
    const qualified = identifier(tokens, index).name;
    if (!qualified || qualified === "*") continue;
    if (tokens[index - 1]?.value === ".") continue;
    if (!columns.includes(qualified)) columns.push(qualified);
  }
  return columns;
}

function parseProjection(tokens: readonly Token[], start: number, end: number): { projections: DigestProjection[]; measures: DigestMeasure[]; lineage: DigestOutputLineage[] } {
  const projections: DigestProjection[] = [];
  const measures: DigestMeasure[] = [];
  const lineage: DigestOutputLineage[] = [];
  for (const item of splitTopLevel(tokens, start, end)) {
    const parsed = aliasAndExpression(item);
    projections.push({ output: parsed.output, expression: parsed.expression });
    lineage.push({ output: parsed.output, expression: parsed.expression, columns: expressionColumns(item) });
    for (let index = 0; index < item.length - 1; index += 1) {
      const functionName = upper(item[index]);
      if (item[index].kind === "word" && AGGREGATE_FUNCTIONS.has(functionName) && item[index + 1].value === "(") {
        const close = matchingParen(item, index + 1);
        const expression = close > index ? render(item.slice(index + 1, close + 1)) : parsed.expression;
        measures.push({ function: functionName, expression, distinct: /\bDISTINCT\b/i.test(expression), ...(parsed.output !== parsed.expression ? { output: parsed.output } : {}) });
      }
    }
  }
  return { projections, measures, lineage };
}

function parseWindows(tokens: readonly Token[], projectionStart = -1, projectionEnd = tokens.length): DigestWindow[] {
  const windows: DigestWindow[] = [];
  const projectionItems = projectionStart >= 0 && projectionEnd > projectionStart
    ? splitTopLevel(tokens, projectionStart, projectionEnd)
    : [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (!sameWord(tokens[index], "OVER") || tokens[index + 1]?.value !== "(") continue;
    const close = matchingParen(tokens, index + 1);
    if (close < 0) continue;
    let openFunction = index - 1;
    if (tokens[openFunction]?.value === ")") {
      let depth = 0;
      for (; openFunction >= 0; openFunction -= 1) {
        if (tokens[openFunction].value === ")") depth += 1;
        else if (tokens[openFunction].value === "(") {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      openFunction -= 1;
    }
    const functionName = upper(tokens[openFunction]) || "WINDOW";
    const bodyStart = index + 2;
    const partitionIndex = findTopLevel(tokens.slice(bodyStart, close), "PARTITION");
    const orderIndex = findTopLevel(tokens.slice(bodyStart, close), "ORDER");
    const body = tokens.slice(bodyStart, close);
    const relativePartition = partitionIndex >= 0 ? partitionIndex : -1;
    const relativeOrder = orderIndex >= 0 ? orderIndex : -1;
    const partitionStart = relativePartition >= 0 ? relativePartition + 2 : -1;
    const partitionEnd = relativeOrder >= 0 ? relativeOrder : body.length;
    const orderStart = relativeOrder >= 0 ? relativeOrder + 2 : -1;
    const frameStart = orderStart >= 0 ? body.findIndex((token, position) => position >= orderStart && ["ROWS", "RANGE", "GROUPS"].includes(upper(token))) : -1;
    const orderEnd = frameStart >= 0 ? frameStart : body.length;
    const projection = projectionItems.find((item) => item.includes(tokens[index]));
    const output = projection ? aliasAndExpression(projection).output : undefined;
    windows.push({
      function: functionName,
      partitionBy: partitionStart >= 0 ? splitTopLevel(body, partitionStart, partitionEnd).map(render) : [],
      orderBy: orderStart >= 0 ? splitTopLevel(body, orderStart, orderEnd).map(render) : [],
      ...(output ? { output } : {}),
      ...(frameStart >= 0 ? { frame: render(body.slice(frameStart)) } : {}),
    });
    index = close;
  }
  return windows;
}

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
}

function digestHash(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }

function schemaFingerprint(input: QueryDigestInput, sources: readonly DigestSource[]): string {
  const names = new Set(sources.map((source) => source.name.toLowerCase()));
  const tables = (input.schema?.tables ?? [])
    .filter((table) => names.has(table.name.toLowerCase()))
    .map((table) => ({
      name: table.name,
      columns: [...table.columns],
      ...(table.primaryKey ? { primaryKey: [...table.primaryKey] } : {}),
      ...(table.uniqueKeys ? { uniqueKeys: table.uniqueKeys.map((key) => [...key]) } : {}),
      ...(table.foreignKeys ? { foreignKeys: table.foreignKeys.map((key) => ({ columns: [...key.columns], references: { table: key.references.table, columns: [...key.references.columns] } })) } : {}),
      ...((table.description ?? input.schema?.reviewedDescriptions?.[table.name]) ? { description: table.description ?? input.schema?.reviewedDescriptions?.[table.name] } : {}),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  return digestHash(stable({
    connectionId: input.schema?.connectionId ?? "unknown",
    dialect: input.dialect,
    tables,
  }));
}

function parseSources(tokens: readonly Token[]): { sources: DigestSource[]; joins: DigestJoin[]; unsupported: string[] } {
  const sources: DigestSource[] = [];
  const joins: DigestJoin[] = [];
  const unsupported: string[] = [];
  const addFromSource = (start: number): number => {
    const parsed = sourceAt(tokens, start);
    if (parsed.subquery) { unsupported.push("subquery"); return Math.max(start, parsed.next); }
    if (!parsed.source) return start;
    sources.push(parsed.source);
    return parsed.next;
  };
  for (let index = 0; index < tokens.length; index += 1) {
    if (depthAt(tokens, index) !== 0) continue;
    const isFrom = sameWord(tokens[index], "FROM");
    const isJoin = sameWord(tokens[index], "JOIN");
    if (!isFrom && !isJoin) continue;
    const leftSource = isJoin ? sources.at(-1) : undefined;
    let next = addFromSource(index + 1);
    if (isFrom) {
      // A comma-separated FROM list is a set of independent sources, not a
      // JOIN. Keep every source visible so coverage cannot claim a partial
      // population or relationship description is complete.
      while (tokens[next]?.value === ",") {
        const afterComma = addFromSource(next + 1);
        if (afterComma <= next + 1) break;
        next = afterComma;
      }
    } else {
      const parsed = sourceAt(tokens, index + 1);
      if (parsed.source) {
        let type = "INNER";
        for (let cursor = index - 1; cursor >= 0 && index - cursor <= 3; cursor -= 1) {
          const candidate = upper(tokens[cursor]);
          if (["LEFT", "RIGHT", "FULL", "CROSS", "INNER"].includes(candidate)) { type = candidate; break; }
        }
        const onIndex = findTopLevel(tokens, "ON", parsed.next);
        const usingIndex = findTopLevel(tokens, "USING", parsed.next);
        const conditionIndex = onIndex >= 0 && (usingIndex < 0 || onIndex < usingIndex) ? onIndex : usingIndex;
        const condition = conditionIndex >= 0 && conditionIndex < clauseEnd(tokens, parsed.next)
          ? render(tokens.slice(conditionIndex + (conditionIndex === onIndex ? 1 : 0), clauseEnd(tokens, conditionIndex)))
          : undefined;
        joins.push({ type, ...(leftSource ? { left: leftSource } : {}), source: parsed.source, ...(condition ? { condition } : {}) });
      }
    }
    index = Math.max(index, next - 1);
  }
  return { sources, joins, unsupported };
}

function parseClauseExpression(tokens: readonly Token[], word: string): string | undefined {
  const start = findTopLevel(tokens, word);
  if (start < 0) return undefined;
  const end = clauseEnd(tokens, start + 1);
  const value = render(tokens.slice(start + 1, end));
  return value || undefined;
}

function parseFilters(tokens: readonly Token[]): string[] {
  return ["WHERE", "HAVING", "QUALIFY"]
    .map((word) => parseClauseExpression(tokens, word))
    .filter((value): value is string => Boolean(value));
}

function parsePopulationEffects(tokens: readonly Token[], joins: readonly DigestJoin[]): PopulationEffectNode[] {
  const effects: PopulationEffectNode[] = [];
  for (const word of ["WHERE", "HAVING", "QUALIFY"] as const) {
    const start = findTopLevel(tokens, word);
    if (start < 0) continue;
    const end = clauseEnd(tokens, start + 1);
    const expression = render(tokens.slice(start + 1, end));
    if (expression) {
      const structural = /^(?:1\s*=\s*1|TRUE)$/i.test(expression.trim());
      effects.push({ path: `filters[${effects.length}]`, kind: structural ? "structural" : word === "WHERE" ? "filter" : word.toLowerCase() as PopulationEffectKind, expression });
    }
  }
  joins.forEach((join, index) => {
    const type = join.type.toUpperCase();
    if (type === "INNER") effects.push({ path: `joins[${index}]`, kind: "inner_join", expression: join.condition ?? "", source: join.source.name });
  });
  if (tokens.some((token) => sameWord(token, "DISTINCT"))) effects.push({ path: "projections", kind: "distinct", expression: "DISTINCT" });
  for (const operation of ["UNION", "INTERSECT", "EXCEPT"] as const) {
    const index = tokens.findIndex((token) => sameWord(token, operation));
    if (index >= 0) effects.push({ path: "setOperations", kind: "set_operation", expression: `${operation}${sameWord(tokens[index + 1], "ALL") ? " ALL" : ""}` });
  }
  return effects;
}

function parseListClause(tokens: readonly Token[], first: string, second?: string): string[] {
  const start = findTopLevel(tokens, first);
  if (start < 0) return [];
  const contentStart = second && sameWord(tokens[start + 1], second) ? start + 2 : start + 1;
  const end = clauseEnd(tokens, contentStart);
  return splitTopLevel(tokens, contentStart, end).map(render).filter(Boolean);
}

function parseOrder(tokens: readonly Token[]): string[] {
  const start = findTopLevel(tokens, "ORDER");
  if (start < 0 || !sameWord(tokens[start + 1], "BY")) return [];
  const end = clauseEnd(tokens, start + 2);
  return splitTopLevel(tokens, start + 2, end).map(render).filter(Boolean);
}

function parseSetOperations(tokens: readonly Token[]): string[] {
  const operations: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (depthAt(tokens, index) !== 0) continue;
    const word = upper(tokens[index]);
    if (!["UNION", "INTERSECT", "EXCEPT"].includes(word)) continue;
    operations.push(`${word}${sameWord(tokens[index + 1], "ALL") ? " ALL" : ""}`);
  }
  return operations;
}

function parseLimit(tokens: readonly Token[]): number | undefined {
  const index = findTopLevel(tokens, "LIMIT");
  const value = index >= 0 ? Number(tokens[index + 1]?.value) : Number.NaN;
  return Number.isFinite(value) ? value : undefined;
}

function parseNullHandling(tokens: readonly Token[]): string[] {
  const found = new Set<string>();
  for (let index = 0; index < tokens.length; index += 1) {
    const word = upper(tokens[index]);
    if (["COALESCE", "NULLIF", "CASE", "NULL"].includes(word)) found.add(word);
    if (word === "IS" && ["NULL", "NOT"].includes(upper(tokens[index + 1]))) found.add("IS NULL");
  }
  return [...found];
}

export function schemaEvidenceFromDdl(connectionId: string, dialect: SqlDialect, ddl: string): SchemaEvidence {
  const tokens = tokenize(ddl);
  const tables: SchemaTable[] = [];
  for (let index = 0; index < tokens.length - 2; index += 1) {
    if (!sameWord(tokens[index], "CREATE") || !sameWord(tokens[index + 1], "TABLE")) continue;
    let nameIndex = index + 2;
    if (sameWord(tokens[nameIndex], "IF") && sameWord(tokens[nameIndex + 1], "NOT") && sameWord(tokens[nameIndex + 2], "EXISTS")) nameIndex += 3;
    const table = identifier(tokens, nameIndex).name;
    const open = identifier(tokens, nameIndex).next;
    if (!table || tokens[open]?.value !== "(") continue;
    const close = matchingParen(tokens, open);
    if (close < 0) continue;
    const columns: string[] = [];
    let primaryKey: string[] | undefined;
    const uniqueKeys: string[][] = [];
    const foreignKeys: SchemaForeignKey[] = [];
    for (const item of splitTopLevel(tokens, open + 1, close)) {
      const first = upper(item[0]);
      if (["PRIMARY", "UNIQUE", "CONSTRAINT", "FOREIGN", "CHECK"].includes(first)) {
        const primary = item.findIndex((token) => sameWord(token, "PRIMARY"));
        const unique = item.findIndex((token) => sameWord(token, "UNIQUE"));
        const foreign = item.findIndex((token) => sameWord(token, "FOREIGN"));
        const keyOpen = item.findIndex((token, position) => position > 0 && token.value === "(");
        const keyClose = keyOpen >= 0 ? matchingParen(item, keyOpen) : -1;
        const keyColumns = keyOpen >= 0 && keyClose > keyOpen ? splitTopLevel(item, keyOpen + 1, keyClose).map(render) : [];
        if (primary >= 0 && keyColumns.length) primaryKey = keyColumns;
        else if (unique >= 0 && keyColumns.length) uniqueKeys.push(keyColumns);
        else if (foreign >= 0 && keyColumns.length) {
          const references = item.findIndex((token, position) => position > foreign && sameWord(token, "REFERENCES"));
          if (references >= 0) {
            const target = identifier(item, references + 1);
            const targetOpen = target.next;
            const targetClose = targetOpen >= 0 && item[targetOpen]?.value === "(" ? matchingParen(item, targetOpen) : -1;
            const targetColumns = targetOpen >= 0 && targetClose > targetOpen ? splitTopLevel(item, targetOpen + 1, targetClose).map(render) : [];
            if (target.name && targetColumns.length) foreignKeys.push({ columns: keyColumns, references: { table: target.name, columns: targetColumns } });
          }
        }
      } else if (item[0]?.kind === "word" || item[0]?.kind === "quoted") {
        columns.push(item[0].value);
        if (item.some((token) => sameWord(token, "PRIMARY") && sameWord(item[item.indexOf(token) + 1], "KEY"))) primaryKey = [item[0].value];
        if (item.some((token) => sameWord(token, "UNIQUE"))) uniqueKeys.push([item[0].value]);
      }
    }
    tables.push({ name: table, columns, ...(primaryKey ? { primaryKey } : {}), ...(uniqueKeys.length ? { uniqueKeys } : {}), ...(foreignKeys.length ? { foreignKeys } : {}) });
    index = close;
  }
  return { connectionId, dialect, tables };
}

/**
 * Deterministic tokenizer diagnostics for tests and Shadow observability.
 * QueryAssurance's authoritative gate policy rejects this parserEngine; hosts
 * must inject createSqlglotQueryDigestCompiler for publish-time coverage.
 */
export function createQueryDigestCompiler(): QueryDigestCompiler {
  return {
    compile(input) {
      const tokens = tokenize(input.sql);
      const normalizedSql = render(tokens);
      const selectIndex = findTopLevel(tokens, "SELECT");
      const fromIndex = selectIndex >= 0 ? findTopLevel(tokens, "FROM", selectIndex + 1) : -1;
      const projectionEnd = fromIndex >= 0 ? fromIndex : tokens.length;
      const parsedProjection = selectIndex >= 0 ? parseProjection(tokens, selectIndex + 1, projectionEnd) : { projections: [], measures: [], lineage: [] };
      const parsedSources = parseSources(tokens);
      const populationEffects = parsePopulationEffects(tokens, parsedSources.joins);
      const qualify = parseClauseExpression(tokens, "QUALIFY");
      const windows = parseWindows(tokens, selectIndex >= 0 ? selectIndex + 1 : -1, projectionEnd);
      const unbalancedParentheses = (() => {
        let depth = 0;
        for (const token of tokens) {
          if (token.value === "(") depth += 1;
          else if (token.value === ")") depth -= 1;
          if (depth < 0) return true;
        }
        return depth !== 0;
      })();
      const unsupportedNodes = [...new Set([
        ...parsedSources.unsupported,
        ...(tokens.length === 0 ? ["empty_sql"] : []),
        ...(selectIndex < 0 ? ["missing_select"] : []),
        ...(selectIndex >= 0 && parsedProjection.projections.length === 0 ? ["missing_projection"] : []),
        ...(unbalancedParentheses ? ["unbalanced_parentheses"] : []),
        ...(tokens.some((token) => sameWord(token, "RECURSIVE")) ? ["recursive_cte"] : []),
        ...(tokens.some((token, index) => sameWord(token, "SELECT") && depthAt(tokens, index) > 0) ? ["subquery"] : []),
      ])];
      // A multiplication operator is not a wildcard projection. Restrict the
      // unsupported wildcard marker to a SELECT item whose expression ends in
      // `*` (optionally qualified by a table name).
      const wildcard = parsedProjection.projections.some((projection) => /(?:^|\.)\*$/.test(projection.expression.trim()));
      const coverage: Record<string, DigestCoverageStatus> = {
        sources: parsedSources.sources.length ? "checked" : "insufficient_evidence",
        joins: parsedSources.joins.length ? "checked" : "not_applicable",
        filters: parseFilters(tokens).length ? "checked" : "not_applicable",
        qualify: qualify ? "checked" : "not_applicable",
        measures: parsedProjection.measures.length ? "checked" : "not_applicable",
        groupBy: parseListClause(tokens, "GROUP", "BY").length ? "checked" : "not_applicable",
        projections: parsedProjection.projections.length ? "checked" : "insufficient_evidence",
        outputLineage: wildcard ? "unsupported" : parsedProjection.lineage.length ? "checked" : "insufficient_evidence",
        windows: windows.length ? "checked" : "not_applicable",
        orderBy: parseOrder(tokens).length ? "checked" : "not_applicable",
        setOperations: parseSetOperations(tokens).length ? "checked" : "not_applicable",
        nullHandling: parseNullHandling(tokens).length ? "checked" : "not_applicable",
      };
      for (const node of unsupportedNodes) {
        if (node === "subquery" || node === "recursive_cte") coverage.outputLineage = "unsupported";
      }
      const lineageCompleteness = unsupportedNodes.some((node) => ["empty_sql", "missing_select", "missing_projection", "unbalanced_parentheses"].includes(node))
        ? "unsupported"
        : wildcard || unsupportedNodes.length ? "partial" : "complete";
      return {
        normalizedSql,
        normalizedSqlHash: digestHash(normalizedSql),
        dialect: input.dialect,
        parserVersion: QUERY_DIGEST_PARSER_VERSION,
        parserEngine: "deterministic-tokenizer",
        queryDigestVersion: QUERY_DIGEST_VERSION,
        schemaEvidenceFingerprint: schemaFingerprint(input, parsedSources.sources),
        sources: parsedSources.sources,
        joins: parsedSources.joins,
        filters: parseFilters(tokens),
        ...(qualify ? { qualify } : {}),
        measures: parsedProjection.measures,
        groupBy: parseListClause(tokens, "GROUP", "BY"),
        projections: parsedProjection.projections,
        outputLineage: parsedProjection.lineage,
        windows,
        orderBy: parseOrder(tokens),
        ...(parseLimit(tokens) !== undefined ? { limit: parseLimit(tokens) } : {}),
        setOperations: parseSetOperations(tokens),
        nullHandling: parseNullHandling(tokens),
        populationEffects,
        coverage,
        unsupportedNodes,
        lineageCompleteness,
      };
    },
  };
}

/**
 * Optional strict parser adapter. The configured Python runtime must provide
 * the pinned sqlglot package; unlike the deterministic fallback this adapter
 * fails closed when sqlglot is unavailable or rejects the dialect; the
 * QueryAssurance coordinator may record that failure with an explicitly
 * unsupported fallback digest rather than treating it as full coverage.
 */
export function resolveQueryDigestParserVersion(compiler: QueryDigestCompiler | undefined, dialect: SqlDialect): string {
  if (!compiler) return QUERY_DIGEST_PARSER_VERSION;
  try {
    return compiler.compile({ sql: "SELECT 1", dialect }).parserVersion;
  } catch {
    return "sqlglot-unavailable";
  }
}

export function createSqlglotQueryDigestCompiler(options: SqlglotQueryDigestCompilerOptions): QueryDigestCompiler {
  return {
    compile(input) {
      const result = spawnSync(options.executable, ["-c", SQLGLOT_SCRIPT], {
        input: JSON.stringify({ sql: input.sql, dialect: input.dialect }),
        encoding: "utf8",
        timeout: options.timeoutMs ?? 5_000,
        windowsHide: true,
      });
      if (result.error) throw new Error(`SQLGLOT_UNAVAILABLE:${result.error.message}`);
      if (result.status !== 0) throw new Error(`SQLGLOT_PARSE_FAILED:${(result.stderr || result.stdout || "unknown error").trim().slice(0, 500)}`);
      let payload: { version?: string; sql?: string; digest?: Partial<QueryDigest> };
      try { payload = JSON.parse(result.stdout) as typeof payload; } catch { throw new Error("SQLGLOT_BAD_RESPONSE"); }
      if (!payload.sql || !payload.version || !payload.digest) throw new Error("SQLGLOT_AST_DIGEST_REQUIRED");
      if (payload.version !== SQLGLOT_RUNTIME_VERSION) throw new Error(`SQLGLOT_VERSION_UNCALIBRATED:expected=${SQLGLOT_RUNTIME_VERSION}:actual=${payload.version}`);
      const fallback = createQueryDigestCompiler().compile({ ...input, sql: payload.sql });
      const supplied = payload.digest;
      const digest: QueryDigest = {
        ...fallback,
        ...supplied,
        normalizedSql: fallback.normalizedSql,
        normalizedSqlHash: fallback.normalizedSqlHash,
        parserVersion: `sqlglot-${payload.version}`,
        parserEngine: "sqlglot",
        queryDigestVersion: QUERY_DIGEST_VERSION,
        schemaEvidenceFingerprint: schemaFingerprint({ ...input, sql: payload.sql }, supplied.sources ?? fallback.sources),
        // The tokenizer is diagnostic-only. In particular, do not import its
        // population effects into an AST digest or an unsupported nested query
        // could be treated as a checked G2 reduction.
        populationEffects: supplied.populationEffects ?? [],
        coverage: supplied.coverage ?? fallback.coverage,
        unsupportedNodes: supplied.unsupportedNodes ?? fallback.unsupportedNodes,
        lineageCompleteness: supplied.lineageCompleteness ?? fallback.lineageCompleteness,
      };
      return digest;
    },
  };
}
