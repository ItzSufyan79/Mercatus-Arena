"use client";

import { useEffect, useState } from "react";
import { api, getToken, liveFeed, PricesMap, fmt, fmtInr } from "@/lib/api";
import { Badge, Button, Panel, Select } from "./ui";

export interface Position {
  symbol: string;
  quantity: number;
  average_buy_price: string;
  current_price: string;
  market_value: string;
  unrealized_pnl: string;
}

export interface Portfolio {
  team_id: string;
  team_name: string;
  cash_balance: string;
  total_portfolio_value: string;
  starting_capital: string;
  positions: Position[];
  livePrices: Record<string, number>;
  api_key?: string;
  credentials_revealed?: boolean;
}

interface TradeResult {
  status: "SUCCESS" | "REJECTED";
  reason?: string;
  priceExecuted?: number | null;
  quantity: number;
  cashAfter: number;
  latencyMs: number;
}

export function TradePanel({
  portfolio,
  onTraded,
}: {
  portfolio: Portfolio;
  onTraded?: () => void;
}) {
  const [symbol, setSymbol] = useState(portfolio.positions[0]?.symbol ?? "");
  const [quantity, setQuantity] = useState(1);
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [live, setLive] = useState<PricesMap>({});

  const symbols = [
    ...new Set([
      ...portfolio.positions.map((p) => p.symbol),
      ...Object.keys(portfolio.livePrices),
    ]),
  ].sort();

  useEffect(() => {
    const un = liveFeed.subscribe((p) => setLive(p));
    return un;
  }, []);

  useEffect(() => {
    if (!symbol && symbols.length) setSymbol(symbols[0]);
  }, [symbols.length, symbol]);

  const mid = live[symbol] ?? portfolio.livePrices[symbol];

  async function trade(action: "buy" | "sell") {
    const token = getToken();
    if (!token) return;
    setBusy(true);
    setMsg(null);
    try {
      const body: Record<string, unknown> = { symbol, quantity };
      if (price) body.price = Number(price);
      const r = await api<TradeResult>(`/api/trade/${action}`, {
        method: "POST",
        body,
        token,
      });
      if (r.status === "SUCCESS") {
        setMsg({
          ok: true,
          text: `Filled ${action.toUpperCase()} ${r.quantity} ${symbol} @ ${fmt(r.priceExecuted)} · ${r.latencyMs}ms`,
        });
        setQuantity(1);
        setPrice("");
        onTraded?.();
      } else {
        setMsg({ ok: false, text: `${r.reason ?? "Rejected"}` });
      }
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title="Place Order"
      right={<Badge color="#2dd4bf">{symbols.length} instruments</Badge>}
    >
      <div className="space-y-4">
        <Select value={symbol} onChange={(e) => setSymbol(e.target.value)} label="Symbol">
          {symbols.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-line bg-panel2 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-dim">Live price</div>
            <div className={`num text-lg font-bold ${mid ? "" : "text-dim"}`}>
              {mid ? fmtInr(mid) : "—"}
            </div>
          </div>
          <div className="rounded-lg border border-line bg-panel2 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-dim">Cash</div>
            <div className="num text-lg font-bold text-ink">
              {fmtInr(Number(portfolio.cash_balance))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-dim">
              Quantity
            </span>
            <input
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
              className="num w-full rounded-lg border border-line bg-panel2 px-3 py-2 text-sm text-ink outline-none focus:border-acc/60"
              aria-label="Quantity"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-dim">
              Limit price (blank = market)
            </span>
            <input
              type="number"
              step="any"
              min={0}
              placeholder={mid ? String(mid.toFixed(2)) : "market"}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="num w-full rounded-lg border border-line bg-panel2 px-3 py-2 text-sm text-ink outline-none placeholder:text-dim focus:border-acc/60"
              aria-label="Limit price"
            />
          </label>
        </div>

        {mid && (
          <div className="rounded-lg border border-line bg-panel2/60 px-3 py-2 text-[11px] text-muted">
            Est. value{" "}
            <span className="num font-semibold text-ink">
              {fmtInr(mid * quantity)}
            </span>{" "}
            · cash after{" "}
            <span className="num text-ink">
              {fmtInr(Number(portfolio.cash_balance) - mid * quantity)}
            </span>
          </div>
        )}

        <div className="flex gap-3">
          <Button variant="buy" disabled={busy} onClick={() => trade("buy")} className="flex-1">
            Buy {symbol || ""}
          </Button>
          <Button variant="sell" disabled={busy} onClick={() => trade("sell")} className="flex-1">
            Sell {symbol || ""}
          </Button>
        </div>

        {msg && (
          <div
            className={`rounded-lg border px-3 py-2 text-sm num ${
              msg.ok
                ? "border-buy/30 bg-buy/10 text-buy"
                : "border-sell/30 bg-sell/10 text-sell"
            }`}
          >
            {msg.text}
          </div>
        )}
      </div>
    </Panel>
  );
}

export function PositionsTable({
  portfolio,
  live,
}: {
  portfolio: Portfolio;
  live: PricesMap;
}) {
  const rows = portfolio.positions.map((p) => {
    const px = live[p.symbol] ?? Number(p.current_price);
    const qty = p.quantity;
    const mkt = px * qty;
    const pnl = (px - Number(p.average_buy_price)) * qty;
    return { ...p, px, mkt, pnl };
  });
  const totalPnl = rows.reduce((s, r) => s + r.pnl, 0);

  return (
    <Panel
      title="Positions"
      right={
        <Badge color={totalPnl >= 0 ? "#2ecc71" : "#f0514c"}>
          {totalPnl >= 0 ? "+" : ""}
          {totalPnl.toFixed(2)} unrealized
        </Badge>
      }
    >
      <table className="w-full">
        <thead>
          <tr className="border-b border-line bg-panel2/50">
            <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-dim">
              Symbol
            </th>
            <th className="px-4 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-dim">
              Qty
            </th>
            <th className="hidden px-4 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-dim sm:table-cell">
              Avg Buy
            </th>
            <th className="px-4 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-dim">
              Last
            </th>
            <th className="px-4 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-dim">
              Value
            </th>
            <th className="px-4 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-dim">
              PnL
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.symbol} className="border-b border-line/60 last:border-0">
              <td className="px-4 py-2.5 font-semibold text-ink">{p.symbol}</td>
              <td className="num px-4 py-2.5 text-right">{p.quantity}</td>
              <td className="num hidden px-4 py-2.5 text-right text-muted sm:table-cell">
                {fmt(p.average_buy_price)}
              </td>
              <td className={`num px-4 py-2.5 text-right font-semibold ${p.pnl >= 0 ? "text-buy" : "text-sell"}`}>
                {fmt(p.px)}
              </td>
              <td className="num px-4 py-2.5 text-right">{fmt(p.mkt)}</td>
              <td className={`num px-4 py-2.5 text-right font-semibold ${p.pnl >= 0 ? "text-buy" : "text-sell"}`}>
                {p.pnl >= 0 ? "+" : ""}
                {fmt(p.pnl)}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-8 text-center text-sm text-dim">
                No open positions yet — place your first order above.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Panel>
  );
}
