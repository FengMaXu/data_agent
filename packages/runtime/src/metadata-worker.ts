import Database from "better-sqlite3";
import { parentPort, workerData } from "node:worker_threads";

if (!parentPort) throw new Error("metadata worker requires a parent port");
const db = new Database(workerData.path as string);
db.pragma("journal_mode = WAL");
db.exec(`CREATE TABLE IF NOT EXISTS tasks (id TEXT NOT NULL, user_id TEXT NOT NULL, name TEXT NOT NULL, created_at REAL NOT NULL, updated_at REAL NOT NULL, deleted_at REAL, PRIMARY KEY(user_id,id)); CREATE TABLE IF NOT EXISTS session_projection_outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, session_id TEXT NOT NULL, target_sequence INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, error TEXT, created_at REAL NOT NULL, updated_at REAL NOT NULL); CREATE TABLE IF NOT EXISTS chat_sessions (id TEXT NOT NULL, user_id TEXT NOT NULL, task_id TEXT NOT NULL, name TEXT NOT NULL, created_at REAL NOT NULL, updated_at REAL NOT NULL, deleted_at REAL, PRIMARY KEY(user_id,id));`);
const now = () => Date.now();
parentPort.on("message", (message: { id: number; op: string; userId: string; [key: string]: unknown }) => {
  try {
    const result = (() => {
      const t = now();
      if (message.op === "task.create") { const id = message.idValue as string; db.prepare("INSERT INTO tasks VALUES (?, ?, ?, ?, ?, NULL)").run(id, message.userId, message.name, t, t); return { id, name: message.name, createdAt: t, updatedAt: t }; }
      if (message.op === "task.list") return db.prepare("SELECT id,name,created_at createdAt,updated_at updatedAt FROM tasks WHERE user_id=? AND deleted_at IS NULL ORDER BY updated_at DESC").all(message.userId);
      if (message.op === "task.rename") { const t = now(); db.prepare("UPDATE tasks SET name=?,updated_at=? WHERE user_id=? AND id=? AND deleted_at IS NULL").run(message.name, t, message.userId, message.taskId); return db.prepare("SELECT id,name,created_at createdAt,updated_at updatedAt FROM tasks WHERE user_id=? AND id=?").get(message.userId, message.taskId); }
      if (message.op === "task.delete") { const t = now(); db.prepare("UPDATE tasks SET deleted_at=?,updated_at=? WHERE user_id=? AND id=?").run(t,t,message.userId,message.taskId); return { id: message.taskId }; }
      if (message.op === "outbox.list") return db.prepare("SELECT id,user_id userId,session_id sessionId,target_sequence targetSequence,status,attempts,error FROM session_projection_outbox WHERE status='pending' ORDER BY id").all();
      if (message.op === "outbox.enqueue") { const t = now(); db.prepare("INSERT INTO session_projection_outbox (user_id,session_id,target_sequence,status,attempts,created_at,updated_at) VALUES (?,?,?,'pending',0,?,?)").run(message.userId, message.sessionId, message.sequence ?? 0, t, t); return { queued: true }; }
      if (message.op === "session.create") { const id = message.idValue as string; const t = now(); db.prepare("INSERT INTO chat_sessions VALUES (?, ?, ?, ?, ?, ?, NULL)").run(id,message.userId,message.taskId,message.name ?? "New session",t,t); return { id, taskId: message.taskId, name: message.name ?? "New session", createdAt:t, updatedAt:t }; }
      if (message.op === "session.list") return db.prepare("SELECT id,task_id taskId,name,created_at createdAt,updated_at updatedAt FROM chat_sessions WHERE user_id=? AND deleted_at IS NULL AND (? IS NULL OR task_id=?) ORDER BY updated_at DESC").all(message.userId,message.taskId ?? null,message.taskId ?? null);
      if (message.op === "session.rename") { const t=now(); db.prepare("UPDATE chat_sessions SET name=?,updated_at=? WHERE user_id=? AND id=? AND deleted_at IS NULL").run(message.name,t,message.userId,message.sessionId); return db.prepare("SELECT id,task_id taskId,name,created_at createdAt,updated_at updatedAt FROM chat_sessions WHERE user_id=? AND id=?").get(message.userId,message.sessionId); }
      if (message.op === "session.delete") { const t=now(); db.prepare("UPDATE chat_sessions SET deleted_at=?,updated_at=? WHERE user_id=? AND id=?").run(t,t,message.userId,message.sessionId); return { id: message.sessionId }; }
      throw new Error(`Unknown metadata operation: ${message.op}`);
    })();
    parentPort!.postMessage({ id: message.id, ok: true, result });
  } catch (error) { parentPort!.postMessage({ id: message.id, ok:false, error: error instanceof Error ? error.message : String(error) }); }
});
