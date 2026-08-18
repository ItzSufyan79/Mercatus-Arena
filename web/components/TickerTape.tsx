"use client";

import { useEffect, useState } from "react";
import { liveFeed, PricesMap, fmt } from "@/lib/api";
import { Marquee } from "./magicui/marquee";
import { Sparkline } from "./Sparkline";

export function TickerTape({
  symbols,
  prices,
  state,
}: {
  symbols: string[];
  prices: PricesMap;
  state: string;
}) {
  const [live, setLive] = useState<PricesMap>({});
  const [, bump] = useState(0);

  useEffect(() => {
    const un = liveFeed.subscribe((p) => {
      setLive(p);
      bump((x) => x + 1);
    });
    return un;
  }, []);

  const merged = { ...prices, ...live };

  return (
    <div className="relative overflow-hidden rounded-xl border border-line bg-panel">
      <div className="flex items-center gap-2 border-b border-line bg-panel2 px-3 py-1.5">
        <span
          className={`h-1.5 w-1.5 rounded-full ${state === "ACTIVE_MARKET" ? "bg-buy live-dot" : state === "API_FROZEN" ? "bg-gold" : "bg-dim"}`}
        />
        <span className="text-[11px] font-bold uppercase tracking-wider text-muted">
          Live Feed
        </span>
      </div>
      <div className="relative">
        <Marquee pauseOnHover className="[--duration:45s]" repeat={2}>
          {[...symbols, ...symbols].map((s, i) => {
            const p = merged[s];
            const hist = liveFeed.historyOf(s);
            const base = hist.length ? hist[0] : p;
            const chg = base ? ((p - base) / base) * 100 : 0;
            const up = chg >= 0;
            return (
              <div
                key={`${s}-${i}`}
                className="flex items-center gap-2.5 rounded-lg border border-line bg-panel2 px-3 py-1.5"
              >
                <span className="font-mono text-[13px] font-bold text-ink">{s}</span>
                <span className={`num text-[13px] font-semibold ${up ? "text-buy" : "text-sell"}`}>
                  {fmt(p, 2)}
                </span>
                <span className={`num text-[11px] ${up ? "text-buy" : "text-sell"}`}>
                  {up ? "+" : ""}
                  {chg.toFixed(2)}%
                </span>
                <Sparkline data={hist} width={48} height={18} />
              </div>
            );
          })}
        </Marquee>
        <div className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-panel to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-panel to-transparent" />
      </div>
    </div>
  );
}
