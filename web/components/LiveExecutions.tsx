"use client";

import { useEffect, useState } from "react";
import { api, getToken, liveFeed, OrderEvent } from "@/lib/api";
import { AnimatedList, AnimatedListItem } from "./magicui/animated-list";
import { Panel, Badge } from "./ui";

interface Trade {
  order_id: number;
  action: "BUY" | "SELL";
  symbol: string;
  quantity: number;
  price_executed: string | null;
  status: "SUCCESS" | "REJECTED";
  reason: string | null;
  latency_ms: number | null;
}

export function LiveExecutions() {
  const [events, setEvents] = useState<(Trade | OrderEvent)[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    api<{ trades: Trade[] }>("/api/team/trades?limit=10", { token })
      .then((d) => setEvents(d.trades))
      .catch(() => {})
      .finally(() => setLoading(false));

    const un = liveFeed.onOrder((o) => {
      setEvents((prev) => [o, ...prev].slice(0, 12));
    });
    return un;
  }, []);

  const items = events.slice(0, 8);

  return (
    <Panel
      title="Live executions"
      right={<Badge color="#2dd4bf">{events.length}</Badge>}
      pad={false}
    >
      <div className="relative h-[360px] overflow-hidden p-2">
        {loading && items.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-dim">
            Waiting for orders…
          </div>
        ) : (
          <AnimatedList delay={300} className="gap-2">
            {items.map((e, idx) => {
              const isWs = "orderId" in e;
              const action = isWs ? e.action : e.action;
              const symbol = isWs ? e.symbol : e.symbol;
              const qty = isWs ? e.quantity : e.quantity;
              const ok = (isWs ? e.status : e.status) === "SUCCESS";
              const price = isWs ? e.priceExecuted : Number(e.price_executed ?? NaN);
              const lat = isWs ? e.latencyMs : e.latency_ms;
              const key = isWs ? e.orderId : e.order_id;
              return (
                <AnimatedListItem key={key}>
                  <div
                    className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${
                      ok ? "border-line bg-panel2/70" : "border-sell/25 bg-sell/5"
                    }`}
                  >
                    <span
                      className={`w-10 rounded-md px-1.5 py-0.5 text-center text-[11px] font-black ${
                        action === "BUY"
                          ? "bg-buy/15 text-buy"
                          : "bg-sell/15 text-sell"
                      }`}
                    >
                      {action}
                    </span>
                    <span className="font-mono text-[13px] font-bold text-ink">{symbol}</span>
                    <span className="num text-[13px] text-ink">×{qty}</span>
                    <span className={`num ml-auto text-[12px] ${ok ? "text-buy" : "text-sell"}`}>
                      {ok && price != null
                        ? `@ ${price.toFixed(2)}`
                        : e.reason ?? "rejected"}
                    </span>
                    <span className="num text-[10px] text-dim">
                      {lat != null ? `${lat}ms` : ""}
                    </span>
                  </div>
                </AnimatedListItem>
              );
            })}
          </AnimatedList>
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-panel to-transparent" />
      </div>
    </Panel>
  );
}
