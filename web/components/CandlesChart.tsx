"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { liveFeed, type Tick, PricesMap, fmtInr } from "@/lib/api";
import { createChart, type IChartApi, type ISeriesApi, CandlestickSeries } from "lightweight-charts";
import { colorOf } from "./MarketChart";
import { Badge } from "./ui";
import { MagicCard } from "./magicui/magic-card";
import { BorderBeam } from "./magicui/border-beam";
import { AnimatedGridPattern } from "./magicui/animated-grid-pattern";

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

const TIMEFRAMES = [
  { label: "1s", secs: 1 },
  { label: "5s", secs: 5 },
  { label: "15s", secs: 15 },
  { label: "30s", secs: 30 },
  { label: "1m", secs: 60 },
  { label: "5m", secs: 300 },
  { label: "15m", secs: 900 },
  { label: "30m", secs: 1800 },
  { label: "1h", secs: 3600 },
];

function aggregateCandles(ticks: Tick[], intervalSecs: number): Candle[] {
  if (ticks.length === 0) return [];
  const bucketMs = intervalSecs * 1000;
  const buckets = new Map<number, Candle>();

  for (const tick of ticks) {
    const bucketKey = Math.floor(tick.t / bucketMs) * bucketMs;
    const existing = buckets.get(bucketKey);
    if (!existing) {
      buckets.set(bucketKey, {
        time: Math.floor(bucketKey / 1000) as unknown as number,
        open: tick.p,
        high: tick.p,
        low: tick.p,
        close: tick.p,
      });
    } else {
      existing.high = Math.max(existing.high, tick.p);
      existing.low = Math.min(existing.low, tick.p);
      existing.close = tick.p;
    }
  }

  return Array.from(buckets.values()).sort((a, b) => a.time - b.time);
}

export function CandlesChart({
  symbols,
  initialPrices,
  state = "PRE_LAUNCH",
  height = 420,
}: {
  symbols: string[];
  initialPrices: PricesMap;
  state?: string;
  height?: number;
}) {
  const [prices, setPrices] = useState<PricesMap>({});
  const [active, setActive] = useState<string>(symbols[0] ?? "AAPL");
  const [tfIdx, setTfIdx] = useState(3);
  const tfSecs = TIMEFRAMES[tfIdx].secs;

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  useEffect(() => {
    liveFeed.seed(symbols, initialPrices);
    const un = liveFeed.subscribe((p) => setPrices(p));
    return un;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!symbols.includes(active)) setActive(symbols[0] ?? "AAPL");
  }, [symbols, active]);

  const merged = useMemo(() => ({ ...initialPrices, ...prices }), [initialPrices, prices]);

  const ticks = useMemo(() => liveFeed.ticksOf(active), [active, prices, merged]);
  const candles = useMemo(() => aggregateCandles(ticks, tfSecs), [ticks, tfSecs]);

  const activePx = merged[active];
  const first = candles[0]?.open;
  const last = candles[candles.length - 1]?.close;
  const chg = first && last ? ((last - first) / first) * 100 : 0;

  const open = candles[0]?.open ?? activePx;
  const high = candles.length ? Math.max(...candles.map((c) => c.high)) : activePx;
  const low = candles.length ? Math.min(...candles.map((c) => c.low)) : activePx;
  const close = last ?? activePx;

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height,
      layout: {
        background: { color: "transparent" },
        textColor: "#55657a",
        fontFamily: "ui-monospace, monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "#1c2735", style: 1 },
        horzLines: { color: "#1c2735", style: 1 },
      },
      crosshair: {
        mode: 0,
        vertLine: { color: "#55657a", width: 1, style: 2, labelBackgroundColor: "#1c2735" },
        horzLine: { color: "#55657a", width: 1, style: 2, labelBackgroundColor: "#1c2735" },
      },
      rightPriceScale: {
        borderColor: "#1c2735",
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
      timeScale: {
        borderColor: "#1c2735",
        timeVisible: true,
        secondsVisible: tfSecs < 60,
      },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#2ecc71",
      downColor: "#f0514c",
      borderDownColor: "#f0514c",
      borderUpColor: "#2ecc71",
      wickDownColor: "#f0514c",
      wickUpColor: "#2ecc71",
    });
    chartRef.current = chart;
    seriesRef.current = series;

    const ro = new ResizeObserver(([entry]) => {
      if (entry && chartRef.current) {
        chartRef.current.applyOptions({ width: entry.contentRect.width });
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [height, tfSecs]);

  useEffect(() => {
    seriesRef.current?.setData(candles as never);
    chartRef.current?.timeScale().fitContent();
  }, [candles]);

  return (
    <MagicCard
      mode="gradient"
      gradientColor="#f0b90b"
      gradientOpacity={0.06}
      gradientFrom="#f0b90b"
      gradientTo="#1c2735"
      gradientSize={340}
      className="rounded-xl border border-line bg-panel"
    >
      <BorderBeam size={120} duration={9} colorFrom="#f0b90b" colorTo="#2dd4bf" />
      <AnimatedGridPattern className="opacity-[0.05]" numSquares={40} maxOpacity={0.4} duration={5} />

      <div className="relative z-40 p-4">
        <header className="mb-3 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span
              className={`h-1.5 w-1.5 rounded-full ${state === "ACTIVE_MARKET" ? "live-dot bg-buy" : state === "API_FROZEN" ? "bg-gold" : "bg-dim"}`}
            />
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
              Candles
            </span>
            <Badge color="#f0b90b">{active}</Badge>
          </div>

          <div className="flex items-center gap-1">
            {TIMEFRAMES.map((tf, i) => (
              <button
                key={tf.label}
                onClick={() => setTfIdx(i)}
                className={`rounded-md px-2 py-0.5 text-[10px] font-semibold transition-colors ${
                  i === tfIdx
                    ? "bg-gold/20 text-gold"
                    : "text-muted hover:text-ink"
                }`}
              >
                {tf.label}
              </button>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-4 text-right">
            {[
              ["Open", open],
              ["High", high],
              ["Low", low],
              ["Close", close],
            ].map(([l, v]) => (
              <div key={l as string}>
                <div className="text-[10px] uppercase tracking-wider text-dim">{l}</div>
                <div className="num text-sm font-semibold text-ink">{fmtInr(v)}</div>
              </div>
            ))}
          </div>
        </header>

        <div ref={containerRef} className="w-full" style={{ height }} />

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line bg-panel2/40 px-3 py-2">
          {symbols.map((s) => {
            const v = merged[s];
            const arr = liveFeed.historyOf(s);
            const f = arr?.[0] ?? v;
            const c = arr?.[arr.length - 1] ?? v;
            const pct = v && f ? ((c - f) / f) * 100 : 0;
            return (
              <button
                key={s}
                onClick={() => setActive(s)}
                className={`flex items-center gap-2 rounded-md border px-2.5 py-1 text-[11px] transition-colors ${
                  s === active
                    ? "border-gold/40 bg-gold/10 text-ink"
                    : "border-line bg-panel text-muted hover:text-ink"
                }`}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: colorOf(s) }} />
                <span className="font-mono font-bold">{s}</span>
                <span className={`num ${pct >= 0 ? "text-buy" : "text-sell"}`}>{fmtInr(v)}</span>
                <span className={`num ${pct >= 0 ? "text-buy" : "text-sell"}`}>
                  {pct >= 0 ? "+" : ""}
                  {pct.toFixed(2)}%
                </span>
              </button>
            );
          })}
        </div>

        <div className={`num mt-2 flex items-center justify-between text-[11px] ${chg >= 0 ? "text-buy" : "text-sell"}`}>
          <span>
            {candles.length > 0 ? `window ${chg >= 0 ? "▲" : "▼"} ${Math.abs(chg).toFixed(2)}%` : "Waiting for market feed…"}
          </span>
          <span className="text-dim">{TIMEFRAMES[tfIdx].label} candles · {candles.length} intervals</span>
        </div>
      </div>
    </MagicCard>
  );
}
