"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { liveFeed, PricesMap, fmtInr } from "@/lib/api";
import { MagicCard } from "./magicui/magic-card";
import { BorderBeam } from "./magicui/border-beam";
import { AnimatedGridPattern } from "./magicui/animated-grid-pattern";
import { NumberTicker } from "./magicui/number-ticker";
import { MarketChart, colorOf, type TradeMarker } from "./MarketChart";
import { Badge } from "./ui";

export interface ExternalMarker {
  symbol: string;
  action: "BUY" | "SELL";
  price: number;
  ts: number;
}

export function MarketChartCard({
  symbols,
  initialPrices,
  state = "PRE_LAUNCH",
  title = "Market Simulation",
  showMarkers = false,
  externalMarkers,
}: {
  symbols: string[];
  initialPrices: PricesMap;
  state?: string;
  title?: string;
  showMarkers?: boolean;
  externalMarkers?: ExternalMarker[];
}) {
  const [prices, setPrices] = useState<PricesMap>({});
  const [mode, setMode] = useState<"single" | "compare">("single");
  const [active, setActive] = useState<string>(symbols[0] ?? "AAPL");
  const [, bump] = useState(0);
  const [markers, setMarkers] = useState<TradeMarker[]>([]);
  const idRef = useRef(0);

  useEffect(() => {
    liveFeed.seed(symbols, initialPrices);
    const un = liveFeed.subscribe((p) => {
      setPrices(p);
      bump((x) => x + 1);
    });
    return un;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!symbols.includes(active)) setActive(symbols[0] ?? "AAPL");
  }, [symbols, active]);

  useEffect(() => {
    if (!showMarkers) return;
    const un = liveFeed.onOrder((o) => {
      if (o.status !== "SUCCESS" || o.priceExecuted == null) return;
      const hist = liveFeed.historyOf(o.symbol);
      const index = Math.max(0, hist.length - 1);
      const price = o.priceExecuted;
      setMarkers((prev) => {
        const next = [
          ...prev,
          { symbol: o.symbol, action: o.action, price, index, id: ++idRef.current },
        ];
        return next.slice(-24);
      });
    });
    return un;
  }, [showMarkers]);

  const merged = useMemo(() => ({ ...initialPrices, ...prices }), [initialPrices, prices]);
  const series = useMemo(() => {
    const s: Record<string, number[]> = {};
    for (const sym of symbols) {
      s[sym] = [...(liveFeed.historyOf(sym) ?? [])];
      if (s[sym].length === 0 && merged[sym] != null) s[sym] = [merged[sym]];
    }
    return s;
  }, [symbols, merged]);

  const activePx = merged[active];
  const activeSeries = series[active] ?? [activePx];
  const open = activeSeries[0] ?? activePx;

  const extMarkers = useMemo(() => {
    if (!externalMarkers?.length) return [];
    const len = Math.max(1, (series[active] ?? []).length);
    return externalMarkers
      .filter((m) => m.symbol === active)
      .map((m, i) => ({
        symbol: m.symbol,
        action: m.action,
        price: m.price,
        index: Math.max(0, Math.min(len - 1, len - 1 - Math.floor((Date.now() - m.ts) / 1000))),
        id: i,
      }));
  }, [externalMarkers, series, active]);
  const chg = activePx && open ? ((activePx - open) / open) * 100 : 0;
  const high = activeSeries.length ? Math.max(...activeSeries) : activePx;
  const low = activeSeries.length ? Math.min(...activeSeries) : activePx;

  return (
    <MagicCard
      mode="gradient"
      gradientColor="#2dd4bf"
      gradientOpacity={0.07}
      gradientFrom="#2dd4bf"
      gradientTo="#1c2735"
      gradientSize={340}
      className="rounded-xl border border-line bg-panel"
    >
      <BorderBeam
        size={120}
        duration={9}
        colorFrom="#2dd4bf"
        colorTo="#8b7cf6"
      />
      <AnimatedGridPattern
        className="opacity-[0.05]"
        numSquares={40}
        maxOpacity={0.4}
        duration={5}
      />

      <div className="relative z-40 p-4">
        <header className="mb-3 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span
              className={`h-1.5 w-1.5 rounded-full ${state === "ACTIVE_MARKET" ? "live-dot bg-buy" : state === "API_FROZEN" ? "bg-gold" : "bg-dim"}`}
            />
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
              {title}
            </span>
            <Badge color="#2dd4bf">{mode === "single" ? active : "compare"}</Badge>
          </div>
          <div className="ml-auto flex gap-1 rounded-lg border border-line bg-panel2 p-1">
            {(["single", "compare"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`rounded-md px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider transition-colors ${
                  mode === m ? "bg-acc text-bg" : "text-muted hover:text-ink"
                }`}
              >
                {m === "single" ? "Single" : "All %"}
              </button>
            ))}
          </div>
        </header>

        {mode === "single" && (
          <div className="mb-3 flex flex-wrap items-end gap-x-6 gap-y-2">
            <div>
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-dim">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: colorOf(active) }} />
                {active}
              </div>
              <div className="num mt-1 flex items-baseline gap-1 text-4xl font-black tracking-tight text-ink">
                <span className="text-xl text-muted">₹</span>
                <NumberTicker
                  value={activePx ?? 0}
                  decimalPlaces={2}
                  className="tabular-nums"
                />
              </div>
              <div className={`num mt-1 text-sm font-bold ${chg >= 0 ? "text-buy" : "text-sell"}`}>
                {chg >= 0 ? "▲" : "▼"} {Math.abs(chg).toFixed(2)}%{" "}
                <span className="font-normal text-dim">since window start</span>
              </div>
            </div>
            <div className="ml-auto grid grid-cols-3 gap-6 text-right">
              {[
                ["High", fmtInr(high)],
                ["Low", fmtInr(low)],
                ["Open", fmtInr(open)],
              ].map(([l, v]) => (
                <div key={l}>
                  <div className="text-[10px] uppercase tracking-wider text-dim">{l}</div>
                  <div className="num text-sm font-semibold text-ink">{v}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <MarketChart
          symbols={symbols}
          series={series}
          prices={merged}
          height={mode === "single" ? 420 : 420}
          tickSeconds={1}
          mode={mode}
          active={active}
          onActiveChange={setActive}
          markers={showMarkers ? markers : extMarkers}
        />
      </div>
    </MagicCard>
  );
}
