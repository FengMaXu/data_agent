import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export interface KnowledgeHit {
  path: string;
  title: string;
  category: string;
  chunkId: string;
  startLine: number;
  endLine: number;
  score: number;
  revision: number;
}

interface Chunk { chunkId: string; title: string; startLine: number; endLine: number; text: string; tokens: Map<string, number>; length: number }

function tokenize(text: string): string[] {
  const ascii = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const cjk = text.match(/[\u4e00-\u9fff]/g) ?? [];
  const bigrams: string[] = [];
  for (let i = 0; i < cjk.length - 1; i++) bigrams.push(cjk[i] + cjk[i + 1]);
  if (cjk.length === 1) bigrams.push(cjk[0]);
  return [...ascii, ...bigrams];
}

function splitChunks(text: string): Array<{ startLine: number; endLine: number; text: string; title: string }> {
  const lines = text.split(/\r?\n/);
  const chunks: Array<{ startLine: number; endLine: number; text: string; title: string }> = [];
  let current: string[] = []; let start = 1; let title = "";
  lines.forEach((line, index) => {
    if (/^#{1,6}\s/.test(line) && current.length > 0) {
      chunks.push({ startLine: start, endLine: index, text: current.join("\n"), title });
      current = []; start = index + 1;
    }
    if (/^#\s/.test(line)) title = line.replace(/^#\s+/, "");
    current.push(line);
  });
  if (current.length > 0) chunks.push({ startLine: start, endLine: lines.length, text: current.join("\n"), title });
  return chunks.filter(chunk => chunk.text.trim().length > 0);
}

export class KnowledgeIndex {
  private readonly docs = new Map<string, { revision: number; chunks: Chunk[] }>();
  private readonly avgLength = () => { const all = [...this.docs.values()].flatMap(d => d.chunks); return all.length === 0 ? 0 : all.reduce((sum, c) => sum + c.length, 0) / all.length; };

  async loadDirectory(root: string, base?: string): Promise<number> {
    const baseRoot = base ?? root;
    let loaded = 0;
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const full = path.join(root, entry.name);
      if (entry.isDirectory()) loaded += await this.loadDirectory(full, baseRoot);
      else if (entry.name.endsWith(".md")) { await this.loadFile(baseRoot, full); loaded += 1; }
    }
    return loaded;
  }

  async loadFile(root: string, filePath: string): Promise<void> {
    const relative = path.relative(root, filePath).split(path.sep).join("/");
    const text = await readFile(filePath, "utf8");
    const revision = this.hash(text);
    const category = relative.includes("/") ? relative.split("/")[0] : "doc";
    const chunks = splitChunks(text).map((chunk, index) => {
      const tokens = tokenize(chunk.text);
      const map = new Map<string, number>();
      for (const token of tokens) map.set(token, (map.get(token) ?? 0) + 1);
      return { chunkId: `${relative}#${index}`, title: chunk.title || path.basename(filePath), startLine: chunk.startLine, endLine: chunk.endLine, text: chunk.text, tokens: map, length: tokens.length };
    }).map(chunk => ({ ...chunk, chunkId: `${chunk.chunkId}:${category}` }));
    this.docs.set(relative, { revision, chunks });
  }

  private hash(text: string): number { let h = 2166136261; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  search(query: string, limit = 8): KnowledgeHit[] {
    const queryTokens = tokenize(query);
    const all = [...this.docs.entries()].flatMap(([relative, doc]) => doc.chunks.map(chunk => ({ relative, doc, chunk })));
    if (all.length === 0) return [];
    const N = all.length; const avg = this.avgLength() || 1; const k1 = 1.5; const b = 0.75;
    const df = new Map<string, number>();
    for (const token of new Set(queryTokens)) {
      let count = 0;
      for (const { chunk } of all) if (chunk.tokens.has(token)) count += 1;
      df.set(token, count);
    }
    const scored: KnowledgeHit[] = [];
    for (const { relative, doc, chunk } of all) {
      let score = 0;
      for (const token of queryTokens) {
        const f = chunk.tokens.get(token) ?? 0;
        if (f === 0) continue;
        const idf = Math.log(1 + (N - (df.get(token) ?? 0) + 0.5) / ((df.get(token) ?? 0) + 0.5));
        score += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * (chunk.length / avg)));
      }
      if (score > 0) {
        const category = relative.includes("/") ? relative.split("/")[0] : "doc";
        scored.push({ path: relative, title: chunk.title, category, chunkId: chunk.chunkId.split(":").slice(0, 2).join(":"), startLine: chunk.startLine, endLine: chunk.endLine, score, revision: doc.revision });
      }
    }
    return scored.sort((a, z) => z.score - a.score).slice(0, limit);
  }
}
