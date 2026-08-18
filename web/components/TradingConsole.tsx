"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api, getToken, liveFeed, PricesMap, OrderEvent, fmt, fmtInr } from "@/lib/api";
import { Badge, Button, Panel } from "./ui";
import type { Portfolio } from "./TradePanel";

interface Trade {
  order_id: number;
  action: "BUY" | "SELL";
  symbol: string;
  quantity: number;
  price_executed: string | null;
  status: "SUCCESS" | "REJECTED";
  reason: string | null;
  latency_ms: number | null;
  timestamp_ms: string;
}

interface LogEntry {
  id: number;
  kind: "sent" | "fill" | "reject";
  action: "BUY" | "SELL";
  symbol: string;
  quantity: number;
  price: number | null;
  ms: number | null;
  text: string;
  time: number;
}

interface TradeResult {
  status: "SUCCESS" | "REJECTED";
  reason?: string;
  priceExecuted?: number | null;
  quantity: number;
  cashAfter: number;
  latencyMs: number;
}

export function TradingConsole({
  portfolio,
  apiKey,
  onTraded,
}: {
  portfolio: Portfolio;
  apiKey?: string | null;
  onTraded?: () => void;
}) {
  const [symbol, setSymbol] = useState(portfolio.positions[0]?.symbol ?? "");
  const [quantity, setQuantity] = useState(1);
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState<PricesMap>({});
  const [log, setLog] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const idRef = useRef(0);

  const symbols = useMemo(
    () =>
      [...new Set([...portfolio.positions.map((p) => p.symbol), ...Object.keys(portfolio.livePrices)])].sort(),
    [portfolio],
  );

  useEffect(() => {
    const un = liveFeed.subscribe((p) => setLive(p));
    return un;
  }, []);

  useEffect(() => {
    if (!symbol && symbols.length) setSymbol(symbols[0]);
  }, [symbols, symbol]);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    let alive = true;
    api<{ trades: Trade[] }>("/api/team/trades?limit=50", { token })
      .then((d) => {
        if (!alive) return;
        setLog(
          d.trades.map((t) => ({
            id: t.order_id,
            kind: t.status === "SUCCESS" ? "fill" : "reject",
            action: t.action,
            symbol: t.symbol,
            quantity: t.quantity,
            price: t.price_executed != null ? Number(t.price_executed) : null,
            ms: t.latency_ms,
            text: t.reason ?? "",
            time: new Date(t.timestamp_ms).getTime(),
          })),
        );
      })
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const un = liveFeed.onOrder((o: OrderEvent) => {
      const kind: "fill" | "reject" = o.status === "SUCCESS" ? "fill" : "reject";
      setLog((prev) => {
        if (prev.some((e) => e.id === o.orderId)) {
          return prev.map((e) =>
            e.id === o.orderId
              ? {
                  ...e,
                  kind,
                  price: o.priceExecuted ?? e.price,
                  ms: o.latencyMs,
                  text: o.reason ?? "",
                }
              : e,
          );
        }
        return [
          {
            id: o.orderId,
            kind,
            action: o.action,
            symbol: o.symbol,
            quantity: o.quantity,
            price: o.priceExecuted,
            ms: o.latencyMs,
            text: o.reason ?? "",
            time: Date.now(),
          },
          ...prev,
        ].slice(0, 60);
      });
    });
    return un;
  }, []);

  async function trade(action: "buy" | "sell") {
    if (!apiKey) return;
    const qty = Math.max(1, Number(quantity) || 1);
    setBusy(true);
    setLog((prev) =>
      [
        {
          id: ++idRef.current,
          kind: "sent" as const,
          action: (action === "buy" ? "BUY" : "SELL") as "BUY" | "SELL",
          symbol,
          quantity: qty,
          price: price ? Number(price) : null,
          ms: null,
          text: "request sent",
          time: Date.now(),
        },
        ...prev,
      ].slice(0, 60),
    );
    try {
      const body: Record<string, unknown> = { symbol, quantity: qty };
      if (price) body.price = Number(price);
      const r = await api<TradeResult>(`/api/trade/${action}`, {
        method: "POST",
        body,
        apiKey,
      });
      setLog((prev) =>
        prev.map((e) =>
          e.id === idRef.current
            ? {
                ...e,
                kind: r.status === "SUCCESS" ? "fill" : "reject",
                price: r.priceExecuted ?? e.price,
                ms: r.latencyMs,
                text: r.status === "SUCCESS" ? "filled" : (r.reason ?? "rejected"),
              }
            : e,
        ),
      );
      if (r.status === "SUCCESS") {
        setQuantity(1);
        setPrice("");
        onTraded?.();
      }
    } catch (e) {
      setLog((prev) =>
        prev.map((en) =>
          en.id === idRef.current ? { ...en, kind: "reject", text: (e as Error).message } : en,
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  const mid = live[symbol] ?? portfolio.livePrices[symbol];

  return (
    <Panel
      title="Trading Console"
      right={
        <Badge color="#2dd4bf">
          {fmtInr(Number(portfolio.cash_balance), 0)} available
        </Badge>
      }
      pad={false}
    >
      <div className="grid gap-0 lg:grid-cols-[280px_1fr]">
        {/* Order entry */}
        <div className="space-y-3 border-b border-line p-4 lg:border-b-0 lg:border-r">
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-dim">
              Symbol
            </label>
            <select
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              className="w-full border border-line bg-panel2 px-3 py-2 text-sm text-ink outline-none focus:border-acc/60"
            >
              {symbols.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center justify-between border border-line bg-panel2 px-3 py-2">
            <span className="text-[10px] uppercase tracking-wider text-dim">Live</span>
            <span className={`num text-sm font-bold ${mid ? "text-ink" : "text-dim"}`}>
              {mid ? fmtInr(mid) : "—"}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-dim">
                Qty
              </span>
              <input
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
                className="num w-full border border-line bg-panel2 px-3 py-2 text-sm text-ink outline-none focus:border-acc/60"
                aria-label="Quantity"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-dim">
                Limit (blank=market)
              </span>
              <input
                type="number"
                step="any"
                min={0}
                placeholder={mid ? mid.toFixed(2) : "market"}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="num w-full border border-line bg-panel2 px-3 py-2 text-sm text-ink outline-none placeholder:text-dim focus:border-acc/60"
                aria-label="Limit price"
              />
            </label>
          </div>
          <div className="flex gap-2">
            <Button variant="buy" disabled={busy} onClick={() => trade("buy")} className="flex-1">
              BUY
            </Button>
            <Button variant="sell" disabled={busy} onClick={() => trade("sell")} className="flex-1">
              SELL
            </Button>
          </div>
          {mid && (
            <div className="border border-line bg-panel2/60 px-3 py-1.5 text-[11px] text-muted">
              est. {fmtInr(mid * quantity)} · after {fmtInr(Number(portfolio.cash_balance) - mid * quantity)}
            </div>
          )}
        </div>

        {/* Scrolling request / trade log */}
        <div className="min-w-0">
          <div className="flex items-center justify-between border-b border-line bg-panel2/50 px-4 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-dim">
              Request / Trade log
            </span>
            <Badge color="#55657a">{log.length} entries</Badge>
          </div>
          <div className="h-[380px] overflow-auto">
            {log.length === 0 && !loading ? (
              <div className="flex h-full items-center justify-center text-sm text-dim">
                No activity yet — place your first order.
              </div>
            ) : (
              <table className="w-full">
                <thead className="sticky top-0 z-10 bg-panel">
                  <tr className="border-b border-line bg-panel2/50">
                    <th className="px-3 py-1.5 text-left text-[9px] font-semibold uppercase tracking-wider text-dim">Time</th>
                    <th className="px-3 py-1.5 text-left text-[9px] font-semibold uppercase tracking-wider text-dim">Side</th>
                    <th className="px-3 py-1.5 text-left text-[9px] font-semibold uppercase tracking-wider text-dim">Sym</th>
                    <th className="px-3 py-1.5 text-right text-[9px] font-semibold uppercase tracking-wider text-dim">Qty</th>
                    <th className="px-3 py-1.5 text-right text-[9px] font-semibold uppercase tracking-wider text-dim">Price</th>
                    <th className="px-3 py-1.5 text-right text-[9px] font-semibold uppercase tracking-wider text-dim">ms</th>
                    <th className="px-3 py-1.5 text-left text-[9px] font-semibold uppercase tracking-wider text-dim">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {log.map((e) => (
                    <tr key={e.id} className="border-b border-line/40 last:border-0">
                      <td className="num px-3 py-1.5 text-[11px] text-dim">
                        {new Date(e.time).toLocaleTimeString("en-US", { hour12: false })}
                      </td>
                      <td className="px-3 py-1.5">
                        <span
                          className={`text-[10px] font-black ${e.action === "BUY" ? "text-buy" : "text-sell"}`}
                        >
                          {e.action}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 font-mono text-[12px] font-bold text-ink">{e.symbol}</td>
                      <td className="num px-3 py-1.5 text-right text-[12px] text-ink">{e.quantity}</td>
                      <td className="num px-3 py-1.5 text-right text-[12px] text-ink">
                        {e.price != null ? fmt(e.price) : "—"}
                      </td>
                      <td className="num px-3 py-1.5 text-right text-[11px] text-muted">
                        {e.ms != null ? `${e.ms}ms` : "…"}
                      </td>
                      <td className="px-3 py-1.5">
                        <span
                          className={`text-[10px] font-semibold ${
                            e.kind === "fill"
                              ? "text-buy"
                              : e.kind === "reject"
                                ? "text-sell"
                                : "text-dim"
                          }`}
                        >
                          {e.kind.toUpperCase()}
                          {e.text && e.kind !== "sent" ? <span className="text-dim"> · {e.text}</span> : null}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </Panel>
  );
}
