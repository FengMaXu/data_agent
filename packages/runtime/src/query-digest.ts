import { createHash } from "node:crypto";

export type SqlDialect = "sqlite" | "mysql" | "bigquery" | "snowflake";
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
  readonly source: DigestSource;
  readonly condition?: string;
}

export interface DigestMeasure {
  readonly function: string;
  readonly expression: string;
  readonly output?: string;
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
  readonly frame?: string;
}

export interface QueryDigest {
  readonly normalizedSql: string;
  readonly normalizedSqlHash: string;
  readonly dialect: SqlDialect;
  readonly parserVersion: string;
  readonly queryDigestVersion: string;
  readonly schemaEvidenceFingerprint: string;
  readonly sources: readonly DigestSource[];
  readonly joins: readonly DigestJoin[];
  readonly filters: readonly string[];
  readonly measures: readonly DigestMeasure[];
  readonly groupBy: readonly string[];
  readonly projections: readonly DigestProjection[];
  readonly outputLineage: readonly DigestOutputLineage[];
  readonly windows: readonly DigestWindow[];
  readonly orderBy: readonly string[];
  readonly limit?: number;
  readonly setOperations: readonly string[];
  readonly nullHandling: readonly string[];
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

const PARSER_VERSION = "sqlglot-30.8.0-adapter-1";
const QUERY_DIGEST_VERSION = "1";
const AGGREGATE_FUNCTIONS = new Set(["COUNT", "SUM", "AVG", "MIN", "MAX", "TOTAL", "GROUP_CONCAT"]);
const CLAUSE_WORDS = new Set(["WHERE", "GROUP", "HAVING", "ORDER", "LIMIT", "UNION", "INTERSECT", "EXCEPT", "FETCH", "QUALIFY"]);
const IDENTIFIER_STOP_WORDS = new Set([
  "SELECT", "FROM", "JOIN", "LEFT", "RIGHT", "FULL", "INNER", "OUTER", "CROSS", "ON", "WHERE", "GROUP", "BY", "HAVING", "ORDER", "LIMIT", "UNION", "ALL", "INTERSECT", "EXCEPT", "FETCH", "QUALIFY",
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
  if (tokens.length > 1 && last?.kind === "word" && !SQL_KEYWORDS.has(upper(last))) {
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
        measures.push({ function: functionName, expression: close > index ? render(item.slice(index + 1, close + 1)) : parsed.expression, ...(parsed.output !== parsed.expression ? { output: parsed.output } : {}) });
      }
    }
  }
  return { projections, measures, lineage };
}

function parseWindows(tokens: readonly Token[]): DigestWindow[] {
  const windows: DigestWindow[] = [];
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
    windows.push({
      function: functionName,
      partitionBy: partitionStart >= 0 ? splitTopLevel(body, partitionStart, partitionEnd).map(render) : [],
      orderBy: orderStart >= 0 ? splitTopLevel(body, orderStart, orderEnd).map(render) : [],
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
      ...(table.description ? { description: table.description } : {}),
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
  for (let index = 0; index < tokens.length; index += 1) {
    if (depthAt(tokens, index) !== 0) continue;
    const isFrom = sameWord(tokens[index], "FROM");
    const isJoin = sameWord(tokens[index], "JOIN");
    if (!isFrom && !isJoin) continue;
    const parsed = sourceAt(tokens, index + 1);
    if (parsed.subquery) { unsupported.push("subquery"); continue; }
    if (!parsed.source) continue;
    if (isJoin) {
      let type = "INNER";
      for (let cursor = index - 1; cursor >= 0 && index - cursor <= 3; cursor -= 1) {
        const candidate = upper(tokens[cursor]);
        if (["LEFT", "RIGHT", "FULL", "CROSS", "INNER"].includes(candidate)) { type = candidate; break; }
      }
      const onIndex = findTopLevel(tokens, "ON", parsed.next);
      const condition = onIndex >= 0 && onIndex < clauseEnd(tokens, parsed.next) ? render(tokens.slice(onIndex + 1, clauseEnd(tokens, onIndex + 1))) : undefined;
      joins.push({ type, source: parsed.source, ...(condition ? { condition } : {}) });
    }
    sources.push(parsed.source);
    index = Math.max(index, parsed.next - 1);
  }
  return { sources, joins, unsupported };
}

function parseFilters(tokens: readonly Token[]): string[] {
  const filters: string[] = [];
  for (const word of ["WHERE", "HAVING", "QUALIFY"]) {
    const start = findTopLevel(tokens, word);
    if (start >= 0) {
      const end = clauseEnd(tokens, start + 1);
      const value = render(tokens.slice(start + 1, end));
      if (value) filters.push(value);
    }
  }
  return filters;
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
      const windows = parseWindows(tokens);
      const unsupportedNodes = [...new Set([
        ...parsedSources.unsupported,
        ...(tokens.some((token) => sameWord(token, "RECURSIVE")) ? ["recursive_cte"] : []),
        ...(tokens.some((token, index) => sameWord(token, "SELECT") && depthAt(tokens, index) > 0) ? ["subquery"] : []),
      ])];
      const wildcard = tokens.some((token) => token.value === "*");
      const coverage: Record<string, DigestCoverageStatus> = {
        sources: parsedSources.sources.length ? "checked" : "insufficient_evidence",
        joins: parsedSources.joins.length ? "checked" : "not_applicable",
        filters: parseFilters(tokens).length ? "checked" : "not_applicable",
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
      const lineageCompleteness = wildcard ? "partial" : unsupportedNodes.length ? "partial" : "complete";
      return {
        normalizedSql,
        normalizedSqlHash: digestHash(normalizedSql),
        dialect: input.dialect,
        parserVersion: PARSER_VERSION,
        queryDigestVersion: QUERY_DIGEST_VERSION,
        schemaEvidenceFingerprint: schemaFingerprint(input, parsedSources.sources),
        sources: parsedSources.sources,
        joins: parsedSources.joins,
        filters: parseFilters(tokens),
        measures: parsedProjection.measures,
        groupBy: parseListClause(tokens, "GROUP", "BY"),
        projections: parsedProjection.projections,
        outputLineage: parsedProjection.lineage,
        windows,
        orderBy: parseOrder(tokens),
        ...(parseLimit(tokens) !== undefined ? { limit: parseLimit(tokens) } : {}),
        setOperations: parseSetOperations(tokens),
        nullHandling: parseNullHandling(tokens),
        coverage,
        unsupportedNodes,
        lineageCompleteness,
      };
    },
  };
}
