import { tx } from "./db.js";
import { broadcast } from "./ws.js";

export type TradeAction = "BUY" | "SELL";

export interface OrderRequest {
  teamId: number;
  action: TradeAction;
  symbol: string;
  quantity: number;
  price: number | null;
  clientRef?: string;
}

export interface OrderResult {
  orderId: number;
  status: "SUCCESS" | "REJECTED";
  reason: string | null;
  priceExecuted: number | null;
  quantity: number;
  cashAfter: number;
  latencyMs: number;
}

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export async function executeOrder(req: OrderRequest): Promise<OrderResult> {
  const start = process.hrtime();
  const result = await tx<OrderResult>(async (client) => {
    const latencyMs = () => {
      const [sec, nsec] = process.hrtime(start);
      return Math.round(sec * 1000 + nsec / 1e6);
    };

    const reject = async (
      reason: string,
    ): Promise<OrderResult> => {
      const { rows } = await client.query(
        `insert into order_logs
           (team_id, action, symbol, quantity, price_requested, status, reason, latency_ms, client_ref)
         values ($1, $2, $3, $4, $5, 'REJECTED', $6, $7, $8)
         returning order_id`,
        [
          req.teamId,
          req.action,
          req.symbol,
          req.quantity,
          req.price,
          reason,
          latencyMs(),
          req.clientRef ?? null,
        ],
      );
      return {
        orderId: Number(rows[0].order_id),
        status: "REJECTED",
        reason,
        priceExecuted: null,
        quantity: req.quantity,
        cashAfter: 0,
        latencyMs: latencyMs(),
      };
    };

    const team = await client.query(
      `select team_id, cash_balance, is_frozen from teams where team_id = $1 for update`,
      [req.teamId],
    );
    if (!team.rows[0]) return reject("UNKNOWN_TEAM");
    if (team.rows[0].is_frozen) return reject("TEAM_FROZEN");

    const state = await client.query(
      `select state, paused from event_config where id = true`,
    );
    if (state.rows[0].state !== "ACTIVE_MARKET") {
      return reject(`MARKET_NOT_ACTIVE:${state.rows[0].state}`);
    }
    if (state.rows[0].paused) return reject("MARKET_PAUSED");

    const px = await client.query(
      `select price from live_prices where symbol = $1`,
      [req.symbol],
    );
    if (!px.rows[0]) return reject("INVALID_SYMBOL");
    const marketPrice = Number(px.rows[0].price);

    let fillPrice = marketPrice;
    if (req.price !== null) {
      if (req.action === "BUY" && req.price < marketPrice) {
        return reject("LIMIT_NOT_REACHED");
      }
      if (req.action === "SELL" && req.price > marketPrice) {
        return reject("LIMIT_NOT_REACHED");
      }
      fillPrice = req.price;
    }
    fillPrice = round(fillPrice, 4);

    if (req.action === "BUY") {
      const notional = round(fillPrice * req.quantity, 2);
      if (Number(team.rows[0].cash_balance) < notional) {
        return reject("INSUFFICIENT_FUNDS");
      }
      await client.query(
        `update teams set cash_balance = cash_balance - $1 where team_id = $2`,
        [notional, req.teamId],
      );
      await client.query(
        `insert into holdings (team_id, symbol, quantity, average_buy_price)
         values ($1, $2, $3, $4)
         on conflict (team_id, symbol) do update
         set quantity = holdings.quantity + excluded.quantity,
             average_buy_price =
               (holdings.average_buy_price * holdings.quantity + excluded.average_buy_price * excluded.quantity)
               / (holdings.quantity + excluded.quantity)`,
        [req.teamId, req.symbol, req.quantity, fillPrice],
      );
    } else {
      const holding = await client.query(
        `select quantity from holdings where team_id = $1 and symbol = $2 for update`,
        [req.teamId, req.symbol],
      );
      if (!holding.rows[0] || Number(holding.rows[0].quantity) < req.quantity) {
        return reject("INSUFFICIENT_POSITION");
      }
      await client.query(
        `update holdings set quantity = quantity - $1 where team_id = $2 and symbol = $3`,
        [req.quantity, req.teamId, req.symbol],
      );
      await client.query(
        `update teams set cash_balance = cash_balance + $1 where team_id = $2`,
        [round(fillPrice * req.quantity, 2), req.teamId],
      );
    }

    await client.query(
      `update teams set total_portfolio_value =
         (select cash_balance from teams where team_id = $1)
         + coalesce((
             select sum(h.quantity * lp.price)
             from holdings h
             left join live_prices lp on lp.symbol = h.symbol
             where h.team_id = $1
           ), 0)
       where team_id = $1`,
      [req.teamId],
    );

    const { rows } = await client.query(
      `insert into order_logs
         (team_id, action, symbol, quantity, price_requested, price_executed, status, latency_ms, client_ref)
       values ($1, $2, $3, $4, $5, $6, 'SUCCESS', $7, $8)
       returning order_id`,
      [
        req.teamId,
        req.action,
        req.symbol,
        req.quantity,
        req.price,
        fillPrice,
        latencyMs(),
        req.clientRef ?? null,
      ],
    );

    const after = await client.query(
      `select cash_balance from teams where team_id = $1`,
      [req.teamId],
    );

    return {
      orderId: Number(rows[0].order_id),
      status: "SUCCESS",
      reason: null,
      priceExecuted: fillPrice,
      quantity: req.quantity,
      cashAfter: Number(after.rows[0].cash_balance),
      latencyMs: latencyMs(),
    };
  });

  broadcast(
    {
      type: "order",
      orderId: result.orderId,
      status: result.status,
      reason: result.reason,
      action: req.action,
      symbol: req.symbol,
      quantity: req.quantity,
      priceExecuted: result.priceExecuted,
      cashAfter: result.cashAfter,
      latencyMs: result.latencyMs,
    },
    { teamId: req.teamId },
  );

  return result;
}
