import { createMcpQueryExecutor, type McpQueryExecutorOptions } from "./mcp-query-executor.js";

/** Databases the product connects to; each has a contract MCP server. */
export const DATABASE_DRIVERS = ["mysql", "postgres"] as const;
export type DatabaseDriver = (typeof DATABASE_DRIVERS)[number];

export interface DatabaseConnection {
  readonly driver: DatabaseDriver;
  readonly host?: string;
  readonly port?: number;
  readonly user?: string;
  readonly password?: string;
  readonly database?: string;
}

/** How a host starts one database's MCP server process. */
export interface McpServerLaunch {
  readonly command: string;
  readonly args: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
}

export type DatabaseServers = Readonly<Record<DatabaseDriver, McpServerLaunch>>;

const DRIVER_FACTS: Readonly<Record<DatabaseDriver, { readonly label: string; readonly envPrefix: string; readonly defaultPort: number }>> = {
  mysql: { label: "MySQL", envPrefix: "DATA_AGENT_MYSQL", defaultPort: 3306 },
  postgres: { label: "PostgreSQL", envPrefix: "DATA_AGENT_PG", defaultPort: 5432 },
};

export function isDatabaseDriver(value: unknown): value is DatabaseDriver {
  return typeof value === "string" && (DATABASE_DRIVERS as readonly string[]).includes(value);
}

/**
 * Reads a connection from saved settings or a test request. A missing driver
 * is MySQL, which every connection was before drivers existed; an unknown one
 * is refused rather than silently connected as MySQL.
 */
export function databaseConnectionFrom(settings: unknown): DatabaseConnection {
  const record = settings && typeof settings === "object" ? settings as Record<string, unknown> : {};
  const driver = record.driver ?? "mysql";
  if (!isDatabaseDriver(driver)) throw new Error(`UNSUPPORTED_DATABASE_DRIVER: ${String(driver)}`);
  const text = (value: unknown) => value === undefined || value === null || value === "" ? undefined : String(value);
  const port = Number(record.port);
  return {
    driver,
    ...(text(record.host) ? { host: text(record.host)! } : {}),
    ...(Number.isSafeInteger(port) && port > 0 ? { port } : {}),
    ...(text(record.user) ? { user: text(record.user)! } : {}),
    ...(text(record.password) ? { password: text(record.password)! } : {}),
    ...(text(record.database) ? { database: text(record.database)! } : {}),
  };
}

/** The MCP server process, its credentials and the SQL dialect for one connection. */
export function databaseExecutorOptions(connection: DatabaseConnection, servers: DatabaseServers): McpQueryExecutorOptions {
  const launch = servers[connection.driver];
  const { envPrefix } = DRIVER_FACTS[connection.driver];
  const env: Record<string, string> = { ...(launch.env ?? {}) };
  for (const field of ["host", "port", "user", "password", "database"] as const) {
    const value = connection[field];
    if (value !== undefined) env[`${envPrefix}_${field.toUpperCase()}`] = String(value);
  }
  return {
    command: launch.command,
    args: [...launch.args],
    env,
    dialect: connection.driver,
    connectionId: `${connection.driver}:${connection.database ?? "configured"}`,
  };
}

export type DatabaseQueryExecutor = ReturnType<typeof createMcpQueryExecutor>;

/**
 * One executor for the saved connection. Each resolve rereads the settings and
 * replaces the MCP server process when the connection changed, so a driver or
 * credential change applies to the next session without a restart.
 */
export function createConfiguredQueryExecutor(options: { readonly readSettings: () => Promise<unknown>; readonly servers: DatabaseServers }) {
  let executor: DatabaseQueryExecutor | undefined;
  let executorKey = "";
  return {
    async resolve(): Promise<DatabaseQueryExecutor> {
      const next = databaseExecutorOptions(databaseConnectionFrom(await options.readSettings()), options.servers);
      const nextKey = JSON.stringify(next);
      if (executor && executorKey === nextKey) return executor;
      const previous = executor;
      executor = createMcpQueryExecutor(next);
      executorKey = nextKey;
      await previous?.close().catch(() => undefined);
      return executor;
    },
    async close(): Promise<void> {
      const current = executor;
      executor = undefined;
      executorKey = "";
      await current?.close();
    },
  };
}

/** Opens the connection through its MCP server and runs one trivial query. */
export async function testDatabaseConnection(settings: unknown, servers: DatabaseServers): Promise<{ success: boolean; message: string }> {
  let connection: DatabaseConnection;
  try {
    connection = databaseConnectionFrom(settings);
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : String(error) };
  }
  const { label, defaultPort } = DRIVER_FACTS[connection.driver];
  const target = `${connection.host ?? "127.0.0.1"}:${connection.port ?? defaultPort}${connection.database ? `/ ${connection.database}` : ""}`;
  // A test must not wait out the reconnect backoff meant for a running session.
  const executor = createMcpQueryExecutor({ ...databaseExecutorOptions(connection, servers), reconnectDelaysMs: [] });
  try {
    await executor.run("SELECT 1 AS connection_ok", 1);
    return { success: true, message: `${label} 连接成功（${target}）` };
  } catch (error) {
    return { success: false, message: `${label} 连接失败: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    await executor.close().catch(() => undefined);
  }
}
