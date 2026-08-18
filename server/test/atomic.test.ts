import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { query, tx } from "../src/db.js";
import { migrate } from "../src/schema.js";
import { executeOrder } from "../src/atomic.js";
import { hashPassword } from "../src/auth.js";

const START_CAPITAL = 100_000;

async function makeTeam(name: string, cash = START_CAPITAL): Promise<number> {
  const { rows } = await query(
    `insert into teams (team_name, role, email, password_hash, cash_balance, starting_capital, total_portfolio_value)
     values ($1, 'team', $2, $3, $4, $4, $4)
     returning team_id`,
    [name, `atomic-${name}@test`, await hashPassword("x"), cash],
  );
  return Number(rows[0].team_id);
}

async function setActive() {
  await query(
    `update event_config set state = 'ACTIVE_MARKET', paused = false where id = true`,
  );
}

async function seedPrice(symbol: string, price: number) {
  await query(
    `insert into live_prices (symbol, price, prev_price) values ($1, $2, $2)
     on conflict (symbol) do update set price = excluded.price, prev_price = live_prices.price`,
    [symbol, price],
  );
}

beforeAll(async () => {
  await migrate();
  await query(`delete from teams where email like 'atomic-%@test'`);
  await query(`delete from live_prices where symbol = 'ATOM'`);
  await setActive();
});

afterEach(async () => {
  await query(`delete from order_logs`);
  await query(`delete from holdings`);
  await query(`delete from teams where email like 'atomic-%@test'`);
  await setActive();
});

describe("executeOrder atomicity", () => {
  it("buys at market and updates cash + holdings", async () => {
    await seedPrice("ATOM", 100);
    const teamId = await makeTeam("buy");
    const r = await executeOrder({
      teamId,
      action: "BUY",
      symbol: "ATOM",
      quantity: 10,
      price: null,
    });
    expect(r.status).toBe("SUCCESS");
    expect(r.priceExecuted).toBe(100);
    expect(r.cashAfter).toBe(START_CAPITAL - 1000);

    const h = await query(
      `select quantity from holdings where team_id = $1 and symbol = 'ATOM'`,
      [teamId],
    );
    expect(Number(h.rows[0].quantity)).toBe(10);
  });

  it("rejects buy above available cash", async () => {
    await seedPrice("ATOM", 100);
    const teamId = await makeTeam("poor", 500);
    const r = await executeOrder({
      teamId,
      action: "BUY",
      symbol: "ATOM",
      quantity: 10,
      price: null,
    });
    expect(r.status).toBe("REJECTED");
    expect(r.reason).toBe("INSUFFICIENT_FUNDS");
  });

  it("rejects buy-limit below market", async () => {
    await seedPrice("ATOM", 100);
    const teamId = await makeTeam("lim");
    const r = await executeOrder({
      teamId,
      action: "BUY",
      symbol: "ATOM",
      quantity: 1,
      price: 90,
    });
    expect(r.status).toBe("REJECTED");
    expect(r.reason).toBe("LIMIT_NOT_REACHED");
  });

  it("rejects sell with no position", async () => {
    await seedPrice("ATOM", 100);
    const teamId = await makeTeam("naked");
    const r = await executeOrder({
      teamId,
      action: "SELL",
      symbol: "ATOM",
      quantity: 5,
      price: null,
    });
    expect(r.status).toBe("REJECTED");
    expect(r.reason).toBe("INSUFFICIENT_POSITION");
  });

  it("never lets cash go negative under concurrent buys", async () => {
    await seedPrice("ATOM", 100);
    const teamId = await makeTeam("race", 10_000);
    const attempts = Array.from({ length: 20 }, () =>
      executeOrder({
        teamId,
        action: "BUY",
        symbol: "ATOM",
        quantity: 10,
        price: null,
      }),
    );
    const results = await Promise.all(attempts);
    const filled = results.filter((r) => r.status === "SUCCESS").length;
    expect(filled).toBe(10); // 10 x 10 x 100 = 10k = exactly the cash on hand
    const t = await query(`select cash_balance from teams where team_id = $1`, [teamId]);
    expect(Number(t.rows[0].cash_balance)).toBe(0);
    const h = await query(
      `select quantity from holdings where team_id = $1 and symbol = 'ATOM'`,
      [teamId],
    );
    expect(Number(h.rows[0].quantity)).toBe(100);
  });

  it("rejects trades when market not active", async () => {
    await seedPrice("ATOM", 100);
    const teamId = await makeTeam("pre");
    await query(
      `update event_config set state = 'PRE_LAUNCH' where id = true`,
    );
    const r = await executeOrder({
      teamId,
      action: "BUY",
      symbol: "ATOM",
      quantity: 1,
      price: null,
    });
    expect(r.status).toBe("REJECTED");
    expect(r.reason).toContain("MARKET_NOT_ACTIVE");
  });

  it("rejects frozen teams", async () => {
    await seedPrice("ATOM", 100);
    const teamId = await makeTeam("frozen");
    await query(`update teams set is_frozen = true where team_id = $1`, [teamId]);
    const r = await executeOrder({
      teamId,
      action: "BUY",
      symbol: "ATOM",
      quantity: 1,
      price: null,
    });
    expect(r.status).toBe("REJECTED");
    expect(r.reason).toBe("TEAM_FROZEN");
  });

  it("recomputes total_portfolio_value including open positions", async () => {
    await seedPrice("ATOM", 100);
    const teamId = await makeTeam("pval");
    await executeOrder({
      teamId,
      action: "BUY",
      symbol: "ATOM",
      quantity: 100,
      price: null,
    });
    const t = await query(`select total_portfolio_value from teams where team_id = $1`, [teamId]);
    expect(Number(t.rows[0].total_portfolio_value)).toBe(START_CAPITAL);
  });

  it("rolls back partial work on failure", async () => {
    const before = await query(`select count(*)::int as n from order_logs`);
    await tx(async (client) => {
      await client.query(`insert into order_logs (team_id, action, symbol, quantity, status) values (1,'BUY','X',1,'SUCCESS')`);
      throw new Error("boom");
    }).catch(() => {});
    const after = await query(`select count(*)::int as n from order_logs`);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });
});
