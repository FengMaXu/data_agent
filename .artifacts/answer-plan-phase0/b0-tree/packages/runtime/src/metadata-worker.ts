import Database from "better-sqlite3";
import { parentPort, workerData } from "node:worker_threads";

if (!parentPort) throw new Error("metadata worker requires a parent port");
const db = new Database(workerData.path as string);
db.pragma("journal_mode = WAL");
db.exec(`CREATE TABLE IF NOT EXISTS knowledge_cache (path TEXT PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT NOT NULL, updated_at REAL NOT NULL); CREATE TABLE IF NOT EXISTS tasks (id TEXT NOT NULL, user_id TEXT NOT NULL, name TEXT NOT NULL, created_at REAL NOT NULL, updated_at REAL NOT NULL, deleted_at REAL, PRIMARY KEY(user_id,id)); CREATE TABLE IF NOT EXISTS session_projection_outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, session_id TEXT NOT NULL, target_sequence INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, error TEXT, created_at REAL NOT NULL, updated_at REAL NOT NULL); CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at REAL NOT NULL); CREATE TABLE IF NOT EXISTS semantic_sources (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, connection_id TEXT NOT NULL, source_name TEXT NOT NULL, definition_json TEXT NOT NULL, updated_at REAL NOT NULL, UNIQUE(user_id, connection_id, source_name)); CREATE TABLE IF NOT EXISTS auth_users (username TEXT PRIMARY KEY, user_id TEXT NOT NULL, display_name TEXT NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL, created_at REAL NOT NULL); CREATE TABLE IF NOT EXISTS auth_tokens (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, username TEXT NOT NULL, display_name TEXT NOT NULL, created_at REAL NOT NULL); CREATE TABLE IF NOT EXISTS chat_sessions (id TEXT NOT NULL, user_id TEXT NOT NULL, task_id TEXT NOT NULL, name TEXT NOT NULL, created_at REAL NOT NULL, updated_at REAL NOT NULL, deleted_at REAL, PRIMARY KEY(user_id,id));`);
const now = () => Date.now();
parentPort.on("message", (message: { id: number; op: string; userId: string; [key: string]: unknown }) => {
  try {
    const result = (() => {
      const t = now();
      if (message.op === "task.create") { const id = message.idValue as string; db.prepare("INSERT INTO tasks VALUES (?, ?, ?, ?, ?, NULL)").run(id, message.userId, message.name, t, t); return { id, name: message.name, createdAt: t, updatedAt: t }; }
      if (message.op === "task.list") return db.prepare("SELECT id,name,created_at createdAt,updated_at updatedAt FROM tasks WHERE user_id=? AND deleted_at IS NULL ORDER BY updated_at DESC").all(message.userId);
      if (message.op === "task.rename") { const t = now(); db.prepare("UPDATE tasks SET name=?,updated_at=? WHERE user_id=? AND id=? AND deleted_at IS NULL").run(message.name, t, message.userId, message.taskId); return db.prepare("SELECT id,name,created_at createdAt,updated_at updatedAt FROM tasks WHERE user_id=? AND id=?").get(message.userId, message.taskId); }
      if (message.op === "task.delete") { const t = now(); db.prepare("UPDATE tasks SET deleted_at=?,updated_at=? WHERE user_id=? AND id=?").run(t,t,message.userId,message.taskId); return { id: message.taskId }; }
      if (message.op === "knowledge.cache_put") { const t = now(); db.prepare("INSERT INTO knowledge_cache (path,revision,payload,updated_at) VALUES (?,?,?,?) ON CONFLICT(path) DO UPDATE SET revision=excluded.revision, payload=excluded.payload, updated_at=excluded.updated_at").run(message.cachePath, message.revision, message.payload, t); return { cached: true }; }
      if (message.op === "knowledge.cache_get") { const row = db.prepare("SELECT payload FROM knowledge_cache WHERE path=? AND revision=?").get(message.cachePath, message.revision) as { payload: string } | undefined; return row ? JSON.parse(row.payload) : null; }
      if (message.op === "knowledge.cache_clear") { db.prepare("DELETE FROM knowledge_cache").run(); return { cleared: true }; }
      if (message.op === "outbox.list") return db.prepare("SELECT id,user_id userId,session_id sessionId,target_sequence targetSequence,status,attempts,error FROM session_projection_outbox WHERE status='pending' ORDER BY id").all();
      if (message.op === "outbox.enqueue") { const t = now(); db.prepare("INSERT INTO session_projection_outbox (user_id,session_id,target_sequence,status,attempts,created_at,updated_at) VALUES (?,?,?,'pending',0,?,?)").run(message.userId, message.sessionId, message.sequence ?? 0, t, t); return { queued: true }; }
      if (message.op === "session.create") { const id = message.idValue as string; const t = now(); db.prepare("INSERT INTO chat_sessions VALUES (?, ?, ?, ?, ?, ?, NULL)").run(id,message.userId,message.taskId,message.name ?? "New session",t,t); return { id, taskId: message.taskId, name: message.name ?? "New session", createdAt:t, updatedAt:t }; }
      if (message.op === "session.list") return db.prepare("SELECT id,task_id taskId,name,created_at createdAt,updated_at updatedAt FROM chat_sessions WHERE user_id=? AND deleted_at IS NULL AND (? IS NULL OR task_id=?) ORDER BY updated_at DESC").all(message.userId,message.taskId ?? null,message.taskId ?? null);
      if (message.op === "session.rename") { const t=now(); db.prepare("UPDATE chat_sessions SET name=?,updated_at=? WHERE user_id=? AND id=? AND deleted_at IS NULL").run(message.name,t,message.userId,message.sessionId); return db.prepare("SELECT id,task_id taskId,name,created_at createdAt,updated_at updatedAt FROM chat_sessions WHERE user_id=? AND id=?").get(message.userId,message.sessionId); }
      if (message.op === "session.delete") { const t=now(); db.prepare("UPDATE chat_sessions SET deleted_at=?,updated_at=? WHERE user_id=? AND id=?").run(t,t,message.userId,message.sessionId); return { id: message.sessionId }; }
      if (message.op === "config.get") return db.prepare("SELECT value_json AS value FROM app_config WHERE key=?").get(message.configKey) ?? null;
      if (message.op === "config.set") { const t=now(); db.prepare("INSERT INTO app_config (key,value_json,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at").run(message.configKey, message.valueJson, t); return { saved: true }; }
      if (message.op === "auth.userCount") return { count: (db.prepare("SELECT COUNT(*) AS c FROM auth_users").get() as { c: number }).c };
      if (message.op === "auth.register") {
        const t = now();
        try {
          db.prepare("INSERT INTO auth_users (username, user_id, display_name, salt, hash, created_at) VALUES (?,?,?,?,?,?)")
            .run(message.username, message.userId, message.displayName, message.salt, message.hash, t);
          return { ok: true };
        } catch { return { ok: false, reason: "AUTH_REGISTRATION_FAILED" }; }
      }
      if (message.op === "auth.verify") {
        const row = db.prepare("SELECT user_id userId, display_name displayName, salt, hash FROM auth_users WHERE username=?").get(message.username) ?? null;
        return row;
      }
      if (message.op === "auth.token.set") { db.prepare("INSERT OR REPLACE INTO auth_tokens (token, user_id, username, display_name, created_at) VALUES (?,?,?,?,?)").run(message.token, message.userId, message.username, message.displayName, now()); return { ok: true }; }
      if (message.op === "auth.token.get") return db.prepare("SELECT user_id userId, username, display_name displayName FROM auth_tokens WHERE token=?").get(message.token) ?? null;
      if (message.op === "auth.token.delete") { db.prepare("DELETE FROM auth_tokens WHERE token=?").run(message.token); return { ok: true }; }
      if (message.op === "semantic.list") return db.prepare("SELECT connection_id connectionId, source_name sourceName, definition_json definitionJson, updated_at updatedAt FROM semantic_sources WHERE user_id=? ORDER BY connection_id, source_name").all(message.userId);
      if (message.op === "semantic.get") return db.prepare("SELECT connection_id connectionId, source_name sourceName, definition_json definitionJson, updated_at updatedAt FROM semantic_sources WHERE user_id=? AND connection_id=? AND source_name=?").get(message.userId, message.connectionId, message.sourceName) ?? null;
      if (message.op === "semantic.upsert") { const t=now(); db.prepare("INSERT INTO semantic_sources (user_id,connection_id,source_name,definition_json,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(user_id,connection_id,source_name) DO UPDATE SET definition_json=excluded.definition_json, updated_at=excluded.updated_at").run(message.userId, message.connectionId, message.sourceName, message.definitionJson, t); return { saved: true }; }
      if (message.op === "skills.list") { const { readdirSync, statSync } = require("node:fs"); const root = message.skillsRoot as string; try { return readdirSync(root, { withFileTypes: true }).filter((e: any) => e.isDirectory()).map((e: any) => ({ name: e.name })); } catch { return []; } }
      throw new Error(`Unknown metadata operation: ${message.op}`);
    })();
    parentPort!.postMessage({ id: message.id, ok: true, result });
  } catch (error) { parentPort!.postMessage({ id: message.id, ok:false, error: error instanceof Error ? error.message : String(error) }); }
});
