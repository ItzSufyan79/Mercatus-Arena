import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { query } from "../src/db.js";
import { migrate } from "../src/schema.js";
import { signTeamToken } from "../src/auth.js";
import { createApp } from "../src/index.js";

let server: http.Server;
let port: number;
let token: string;

beforeAll(async () => {
  await migrate();
  const { rows } = await query(
    `insert into teams (team_name, role, email, cash_balance, total_portfolio_value, starting_capital)
     values ('async-admin', 'admin', 'async-admin@test', 100000, 100000, 100000)
     returning team_id`,
  );
  const teamId = Number(rows[0].team_id);
  token = signTeamToken({ team_id: teamId, email: "async-admin@test", role: "admin" });

  const app = createApp();
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("http error handling", () => {
  it("returns 500 (not a hang) when an async handler rejects", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/admin/scoring`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ team_id: 999999, code_quality: 50, strategy_report: 60 }),
      signal: AbortSignal.timeout(5000),
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("INTERNAL");
  });
});
