import { readFile, realpath } from "node:fs/promises";
import path from "node:path";

/** The maximum UTF-8 payload returned by any bounded text read. */
export const MAX_TEXT_BYTES = 50 * 1024;

export interface LineRange {
  startLine?: number;
  endLine?: number;
}

export interface BoundedReadResult {
  content: string;
  truncated: boolean;
}

export function validateLineRange({ startLine, endLine }: LineRange): void {
  for (const [name, value] of [["startLine", startLine], ["endLine", endLine]] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value < 1)) {
      throw new Error(`INVALID_LINE_RANGE:${name}`);
    }
  }
  if (startLine !== undefined && endLine !== undefined && startLine > endLine) {
    throw new Error("INVALID_LINE_RANGE:START_AFTER_END");
  }
}

function truncateUtf8(content: string): BoundedReadResult {
  const bytes = Buffer.from(content, "utf8");
  if (bytes.byteLength <= MAX_TEXT_BYTES) return { content, truncated: false };

  // Never return a partial UTF-8 code point. The next excluded byte being a
  // continuation byte means the final included code point is incomplete.
  let end = MAX_TEXT_BYTES;
  while (end < bytes.byteLength && (bytes[end]! & 0xc0) === 0x80) end -= 1;
  return { content: bytes.subarray(0, end).toString("utf8"), truncated: true };
}

export function boundTextByLines(content: string, range: LineRange = {}): BoundedReadResult {
  validateLineRange(range);
  // Keep the exact legacy payload when no slicing was requested (including
  // its original line endings), while still applying the server-side cap.
  if (range.startLine === undefined && range.endLine === undefined) return truncateUtf8(content);
  const lines = content.split(/\r?\n/);
  const start = range.startLine ?? 1;
  const end = range.endLine ?? lines.length;
  return truncateUtf8(lines.slice(start - 1, end).join("\n"));
}

/** Read a file beneath root while checking both lexical and symlink escapes. */
export async function readBoundedFile(root: string, relativePath: string, range: LineRange = {}): Promise<BoundedReadResult> {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, relativePath);
  if (target !== resolvedRoot && !target.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error("PATH_ESCAPE");
  const [realRoot, realTarget] = await Promise.all([realpath(resolvedRoot), realpath(target)]);
  if (realTarget !== realRoot && !realTarget.startsWith(`${realRoot}${path.sep}`)) throw new Error("SYMLINK_ESCAPE");
  return boundTextByLines(await readFile(realTarget, "utf8"), range);
}
