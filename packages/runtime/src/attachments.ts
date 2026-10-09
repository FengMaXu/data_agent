/**
 * Files a user attaches to a prompt. They are uploaded into the Session
 * workspace first; the prompt only carries references, so the model reads
 * them with its workspace tools instead of having their bytes in context.
 *
 * Pi stores a prompt as plain text, so the references travel as a trailing
 * block that the transcript projection splits back out for the UI.
 */

export interface PromptAttachment {
  /** Path relative to the Session workspace. */
  readonly path: string;
  readonly size: number;
}

const OPEN = "<attachments>";
const CLOSE = "</attachments>";
const GUIDE = "用户随本条消息附加了以下文件，均在当前会话工作区中：文本文件用 read_file 读取，CSV、Excel 等数据文件用 run_python 读取。";
const BLOCK = /\n\n<attachments>\n[^\n]*\n((?:- [^\n]+\n)+)<\/attachments>$/;
const LINE = /^- (.+) \((\d+(?:\.\d+)? (?:B|KB|MB|GB))\)$/;

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

/** The text the model receives: the prompt, then one line per attached file. */
export function formatPromptWithAttachments(prompt: string, attachments: readonly PromptAttachment[]): string {
  if (attachments.length === 0) return prompt;
  const lines = attachments.map((file) => `- ${file.path} (${sizeLabel(file.size)})`);
  return `${prompt}\n\n${OPEN}\n${GUIDE}\n${lines.join("\n")}\n${CLOSE}`;
}

/** Splits a stored user message back into what the user typed and the files they attached. */
export function splitPromptAttachments(text: string): { readonly prompt: string; readonly attachments: string[] } {
  const match = BLOCK.exec(text);
  if (!match) return { prompt: text, attachments: [] };
  const attachments = (match[1] ?? "").trimEnd().split("\n").map((line) => LINE.exec(line)?.[1]);
  if (attachments.some((path) => path === undefined)) return { prompt: text, attachments: [] };
  return { prompt: text.slice(0, match.index), attachments: attachments as string[] };
}
