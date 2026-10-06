import type { ConversationAddress, ProgressView, PublicationDelivered } from "@data-agent/contracts";
import type { AnswerActionValue } from "./inbound.js";

/** Card JSON 2.0. `update_multi` lets one card be patched for everyone who sees it. */
type Card = { schema: "2.0"; config: { update_multi: true }; header?: unknown; body: { elements: unknown[] } };

const TABLE_COLUMN_LIMIT = 50;
const TABLE_PAGE_SIZE = 10;
const MARKDOWN_LIMIT = 8_000;

function card(elements: unknown[], title?: string, template = "blue"): Card {
  return {
    schema: "2.0",
    config: { update_multi: true },
    ...(title ? { header: { title: { tag: "plain_text", content: title }, template } } : {}),
    body: { elements },
  };
}

const markdown = (content: string) => ({ tag: "markdown", content: content.length > MARKDOWN_LIMIT ? `…${content.slice(-MARKDOWN_LIMIT)}` : content });

/**
 * The model links workspace files by relative path, which only the Web app can
 * open. In Feishu such a link is dead, so it becomes its plain text; the file
 * itself arrives as its own message when it is a Deliverable.
 */
export function withoutLocalLinks(text: string): string {
  return text.replace(/(!?)\[([^\]]*)\]\(([^)\s]*)\)/g, (link, image: string, label: string, url: string) => /^https?:\/\//i.test(url) ? link : image ? "" : label || url);
}

const note = (content: string) => ({ tag: "markdown", content, text_size: "notation" });

/** RFC 4180 rows: quoted fields, doubled quotes, CRLF or LF, an optional BOM. */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const source = input.startsWith("﻿") ? input.slice(1) : input;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    if (quoted) {
      if (char === "\"" && source[index + 1] === "\"") { field += "\""; index += 1; }
      else if (char === "\"") quoted = false;
      else field += char;
    } else if (char === "\"") quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += char;
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

/** A CSV result as a card table; columns past Feishu's limit are dropped and said so. */
export function tableElements(csv: string): unknown[] {
  const [header, ...rows] = parseCsv(csv);
  if (!header || header.length === 0) return [];
  const shown = header.slice(0, TABLE_COLUMN_LIMIT);
  const elements: unknown[] = [{
    tag: "table",
    page_size: Math.max(1, Math.min(TABLE_PAGE_SIZE, rows.length)),
    row_height: "auto",
    header_style: { text_align: "left", bold: true },
    columns: shown.map((name, index) => ({ name: `c${index}`, display_name: name || `列${index + 1}`, data_type: "text" })),
    rows: rows.map((values) => Object.fromEntries(shown.map((_name, index) => [`c${index}`, values[index] ?? ""]))),
  }];
  if (header.length > shown.length) elements.push(note(`仅显示前 ${shown.length} 列，共 ${header.length} 列。`));
  return elements;
}

export function questionCard(question: string, options: readonly string[], clarificationId: string, address: ConversationAddress): string {
  const value = (text: string): AnswerActionValue => ({ kind: "answer", clarificationId, text, audience: address.audience, ...(address.threadId ? { threadId: address.threadId } : {}) });
  return JSON.stringify(card([
    markdown(question),
    ...options.map((option) => ({ tag: "button", text: { tag: "plain_text", content: option }, type: "default", width: "fill", behaviors: [{ type: "callback", value: value(option) }] })),
    note(options.length > 0 ? "点击选项，或直接回复文字。" : "请直接回复文字。"),
  ], "需要确认口径", "orange"));
}

/** What the question card becomes once someone answered it, so it cannot be answered twice. */
export function answeredCard(answer: string): Card {
  return card([markdown(`已回答：**${answer}**`)], "需要确认口径", "grey");
}

export function publicationCard(publication: PublicationDelivered, rows: { readonly csv?: string; readonly attached: boolean }): string {
  const elements: unknown[] = [];
  if (rows.csv) elements.push(...tableElements(rows.csv));
  if (rows.attached) elements.push(markdown("完整结果见下方 CSV 文件。"));
  if (!rows.csv && !rows.attached) elements.push(markdown("结果已发布，请在数据智能体中查看或下载。"));
  if (publication.disclosure) elements.push(note(`**口径说明**：${publication.disclosure}`));
  elements.push(note(`发布记录：${publication.receiptId}`));
  return JSON.stringify(card(elements, "查询结果", "green"));
}

export function progressCard(view: ProgressView): string {
  const text = withoutLocalLinks(view.text).trim();
  if (view.state === "completed") return JSON.stringify(card([markdown(text || "已完成。")]));
  return JSON.stringify(card([
    markdown(text || "正在思考…"),
    note(view.activeTool ? `⏳ 正在执行 ${view.activeTool}` : "⏳ 处理中"),
  ]));
}
