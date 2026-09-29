import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import mysql from "mysql2";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMysqlReferenceServer } from "./index.js";

// MySQL column types on the wire.
const DATE = 10;
const DATETIME = 12;
const TIMESTAMP = 7;
const columns = ([["d", DATE], ["dt", DATETIME], ["ts", TIMESTAMP]] as const).map(([name, columnType]) => ({
  catalog: "def", schema: "", table: "", orgTable: "", name, orgName: name, characterSet: 63, columnLength: 19, columnType, flags: 0, decimals: 0,
}));

/** A MySQL wire-protocol server answering every query with one row of calendar values, as MySQL sends them. */
function calendarServer() {
  // The mysql2 server API is untyped.
  const server = (mysql as unknown as { createServer(handler: (conn: any) => void): any }).createServer((conn) => {
    conn.serverHandshake({ protocolVersion: 10, serverVersion: "8.0.36", connectionId: 1, statusFlags: 2, characterSet: 8, capabilityFlags: 0xffffff });
    conn.on("error", () => undefined);
    conn.on("query", () => {
      conn.sequenceId = 1;
      conn.writeColumns(columns);
      conn.writeTextRow(["2025-12-01", "2025-12-01 08:30:00", "2025-12-01 08:30:00"]);
      conn.writeEof();
    });
  });
  return server;
}

describe("Calendar values from MySQL", () => {
  const originalTz = process.env.TZ;
  let server: any;
  let port = 0;

  beforeAll(async () => {
    // East of UTC, a DATE parsed to local midnight serialises as the previous day.
    process.env.TZ = "Asia/Shanghai";
    server = calendarServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server._server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    if (originalTz === undefined) delete process.env.TZ; else process.env.TZ = originalTz;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("returns DATE, DATETIME and TIMESTAMP as the text MySQL sends, in preview and export", async () => {
    const { server: mcp, close } = await createMysqlReferenceServer({ host: "127.0.0.1", port, user: "u", password: "p", database: "d" });
    const client = new Client({ name: "data-agent-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([mcp.connect(serverTransport), client.connect(clientTransport)]);
    for (const name of ["execute_query_preview", "execute_query_export"]) {
      const result = await client.callTool({ name, arguments: { sql: "SELECT d, dt, ts FROM calendar" } });
      const payload = JSON.parse((result.content as { text: string }[])[0]!.text) as { rows: unknown[] };
      expect(payload.rows[0], name).toEqual({ d: "2025-12-01", dt: "2025-12-01 08:30:00", ts: "2025-12-01 08:30:00" });
    }
    await client.close();
    await close();
  }, 30000);
});
