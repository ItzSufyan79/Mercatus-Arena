"use client";

import { useMemo, useRef, useState } from "react";
import { PricesMap, fmt, fmtInr } from "@/lib/api";

export const SERIES_COLORS = [
  "#2dd4bf",
  "#f0b90b",
  "#8b7cf6",
  "#f0514c",
  "#38bdf8",
  "#f472b6",
  "#a3e635",
  "#fb923c",
];

export function colorOf(symbol: string): string {
  let h = 0;
  for (const c of symbol) h = (h * 31 + c.charCodeAt(0)) % 997;
  return SERIES_COLORS[h % SERIES_COLORS.length];
}

export interface TradeMarker {
  symbol: string;
  action: "BUY" | "SELL";
  price: number;
  index: number;
  id: number;
}

interface Props {
  symbols: string[];
  series: Record<string, number[]>;
  prices: PricesMap;
  height?: number;
  tickSeconds?: number;
  mode: "single" | "compare";
  active: string;
  onActiveChange?: (symbol: string) => void;
  markers?: TradeMarker[];
}

export function MarketChart({
  symbols,
  series,
  prices,
  height = 400,
  tickSeconds = 1,
  mode,
  active,
  onActiveChange,
  markers = [],
}: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const W = 900;
  const PAD_L = 64;
  const PAD_R = 12;
  const PAD_T = 12;
  const PAD_B = 28;

  const activeSymbols = mode === "single" ? [active] : symbols;

  const maxLen = useMemo(
    () => Math.max(1, ...activeSymbols.map((s) => series[s]?.length ?? 0)),
    [activeSymbols, series],
  );

  const domain = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const s of activeSymbols) {
      const arr = series[s];
      if (!arr?.length) continue;
      for (const v of arr) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    if (!Number.isFinite(min)) min = 0;
    if (!Number.isFinite(max)) max = 1;
    if (min === max) {
      max = min * 1.02 + 0.0001;
      min = min * 0.98;
    }
    const pad = (max - min) * 0.06;
    return [min - pad, max + pad];
  }, [activeSymbols, series]);

  const [yMin, yMax] = domain;

  const xAt = (i: number, len: number) =>
    PAD_L + ((len === 1 ? 1 : i / (len - 1)) * (W - PAD_L - PAD_R));
  const yAt = (v: number) => PAD_T + ((yMax - v) / (yMax - yMin)) * (height - PAD_T - PAD_B);

  const hoverIdx =
    hover !== null
      ? Math.min(maxLen - 1, Math.max(0, Math.round(hover * (maxLen - 1))))
      : null;
  const hoverX =
    hover !== null ? PAD_L + hover * (W - PAD_L - PAD_R) : null;

  const toSeries = (arr: number[]) =>
    arr.map((v, i) => `${xAt(i, arr.length).toFixed(1)},${yAt(v).toFixed(1)}`).join(" ");

  const areaPath = (arr: number[]) => {
    if (arr.length < 2) return "";
    return `M ${PAD_L},${height - PAD_B} L ${toSeries(arr).split(" ").join(" L ")} L ${xAt(arr.length - 1, arr.length).toFixed(1)},${height - PAD_B} Z`;
  };

  const gridTicks = 5;
  const yTicks = Array.from({ length: gridTicks + 1 }, (_, i) => yMin + ((yMax - yMin) * i) / gridTicks);
  const xLabels = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round((maxLen - 1) * f));

  const timeAgo = (i: number) => {
    const secs = (maxLen - 1 - i) * tickSeconds;
    if (secs >= 60) return `-${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
    return `-${secs}s`;
  };

  const hoverValues =
    hover !== null && hoverIdx !== null
      ? activeSymbols.map((s) => {
          const arr = series[s];
          const idx = Math.min(hoverIdx, (arr?.length ?? 1) - 1);
          const v = arr?.[idx];
          return { symbol: s, value: v };
        })
      : [];

  function onMove(e: React.PointerEvent) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const frac = (e.clientX - rect.left) / rect.width;
    setHover(Math.max(0, Math.min(1, frac)));
  }

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${height}`}
        preserveAspectRatio="none"
        className="block w-full"
        style={{ height }}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {yTicks.map((t, i) => (
          <g key={i}>
            <line
              x1={PAD_L}
              x2={W - PAD_R}
              y1={yAt(t)}
              y2={yAt(t)}
              stroke="#1c2735"
              strokeWidth="1"
              strokeDasharray="2 6"
            />
            <text
              x={PAD_L - 8}
              y={yAt(t) + 3}
              textAnchor="end"
              fontSize="10"
              fill="#55657a"
              fontFamily="ui-monospace, monospace"
            >
              {mode === "compare" ? `${((t - 100) / 100) * 100 >= 0 ? "+" : ""}${(((t - 100) / 100) * 100).toFixed(1)}%` : fmt(t, 2)}
            </text>
          </g>
        ))}

        {xLabels.map((i) => (
          <g key={i}>
            <line
              x1={xAt(i, maxLen)}
              x2={xAt(i, maxLen)}
              y1={PAD_T}
              y2={height - PAD_B}
              stroke="#1c2735"
              strokeWidth="1"
              strokeDasharray="2 6"
            />
            <text
              x={xAt(i, maxLen)}
              y={height - 8}
              textAnchor="middle"
              fontSize="10"
              fill="#55657a"
              fontFamily="ui-monospace, monospace"
            >
              {timeAgo(i)}
            </text>
          </g>
        ))}

        {mode === "single"
          ? symbols
              .filter((s) => s !== active)
              .map((s) => {
                const arr = series[s];
                if (!arr || arr.length < 2) return null;
                return (
                  <polyline
                    key={s}
                    points={toSeries(arr)}
                    fill="none"
                    stroke={colorOf(s)}
                    strokeWidth="1"
                    strokeOpacity="0.18"
                  />
                );
              })
          : null}

        {activeSymbols.map((s) => {
          const arr = series[s];
          if (!arr || arr.length < 2) return null;
          const color = colorOf(s);
          const isActiveLine = mode === "single" && s === active;
          const norm = mode === "compare";
          const mapped = norm
            ? arr.map((v, i) => [xAt(i, arr.length), yAt(((v / arr[0]) - 1) * 100 + 100)] as const)
            : arr.map((v, i) => [xAt(i, arr.length), yAt(v)] as const);
          const pts = mapped.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
          const areaPts = `M ${PAD_L},${height - PAD_B} L ${pts.split(" ").join(" L ")} L ${mapped[mapped.length - 1][0].toFixed(1)},${height - PAD_B} Z`;
          return (
            <g key={s}>
              {isActiveLine && (
                <>
                  <defs>
                    <linearGradient id={`mga-${s}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={color} stopOpacity="0.28" />
                      <stop offset="100%" stopColor={color} stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path d={areaPts} fill={`url(#mga-${s})`} stroke="none" />
                </>
              )}
              <polyline
                points={pts}
                fill="none"
                stroke={color}
                strokeWidth={isActiveLine ? 2.25 : mode === "compare" ? 2 : 1.25}
                strokeOpacity={isActiveLine || mode === "compare" ? 1 : 0.35}
              />
            </g>
          );
        })}

        {hover !== null && hoverX !== null && (
          <g>
            <line
              x1={hoverX}
              x2={hoverX}
              y1={PAD_T}
              y2={height - PAD_B}
              stroke="#55657a"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            {activeSymbols.map((s) => {
              const arr = series[s];
              if (!arr?.length || hoverIdx === null) return null;
              const idx = Math.min(hoverIdx, arr.length - 1);
              const v = arr[idx];
              const y = mode === "compare" ? yAt(((v / arr[0]) - 1) * 100 + 100) : yAt(v);
              return (
                <circle
                  key={s}
                  cx={hoverX}
                  cy={y}
                  r="3.5"
                  fill={colorOf(s)}
                  stroke="#080b11"
                  strokeWidth="1.5"
                />
              );
            })}
          </g>
        )}

        {markers.map((m) => {
          const arr = series[m.symbol];
          if (!arr?.length || m.index < 0 || m.index >= arr.length) return null;
          if (mode === "compare" && m.symbol !== active) return null;
          const x = xAt(m.index, arr.length);
          const y =
            mode === "compare"
              ? yAt(((m.price / arr[0]) - 1) * 100 + 100)
              : yAt(m.price);
          const up = m.action === "BUY";
          const color = up ? "#2ecc71" : "#f0514c";
          const d = up
            ? `M ${x},${y - 6} L ${x - 5},${y + 2} L ${x + 5},${y + 2} Z`
            : `M ${x},${y + 6} L ${x - 5},${y - 2} L ${x + 5},${y - 2} Z`;
          return (
            <path
              key={m.id}
              d={d}
              fill={color}
              stroke="#080b11"
              strokeWidth="1.2"
            />
          );
        })}
      </svg>

      {hoverValues.length > 0 && hover !== null && (
        <div
          className="pointer-events-none absolute top-2 z-10 min-w-[190px] rounded-lg border border-line bg-panel/95 p-3 shadow-xl backdrop-blur"
          style={{
            left: `${hover * 100}%`,
            transform: hover > 0.62 ? "translateX(calc(-100% - 12px))" : "translateX(12px)",
          }}
        >
          <div className="mb-2 flex items-center justify-between gap-6">
            <span className="text-[10px] uppercase tracking-wider text-dim">
              {timeAgo(hoverIdx ?? 0)}
            </span>
            <span className="text-[10px] uppercase tracking-wider text-dim">live</span>
          </div>
          {hoverValues.map(({ symbol, value }) => {
            const arr = series[symbol];
            const idx = Math.min(hoverIdx ?? 0, (arr?.length ?? 1) - 1);
            const first = arr?.[0] ?? value;
            const chg = value && first ? ((value - first) / first) * 100 : 0;
            return (
              <div key={symbol} className="flex items-center justify-between gap-6 py-0.5">
                <span className="flex items-center gap-2 text-[12px] font-semibold text-ink">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: colorOf(symbol) }} />
                  {symbol}
                </span>
                <span className="num text-[12px] text-ink">{fmt(value)}</span>
                <span className={`num text-[11px] ${chg >= 0 ? "text-buy" : "text-sell"}`}>
                  {chg >= 0 ? "+" : ""}
                  {chg.toFixed(2)}%
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line bg-panel2/40 px-3 py-2">
        {activeSymbols.map((s) => {
          const arr = series[s];
          const v = prices[s] ?? arr?.[arr.length - 1];
          const first = arr?.[0] ?? v;
          const chg = v && first ? ((v - first) / first) * 100 : 0;
          return (
            <button
              key={s}
              onClick={() => mode === "single" && onActiveChange?.(s)}
              className={`flex items-center gap-2 rounded-md border px-2.5 py-1 text-[11px] transition-colors ${
                mode === "single" && s === active
                  ? "border-acc/40 bg-acc/10 text-ink"
                  : "border-line bg-panel text-muted hover:text-ink"
              }`}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: colorOf(s) }} />
              <span className="font-mono font-bold">{s}</span>
              <span className={`num ${chg >= 0 ? "text-buy" : "text-sell"}`}>
                {fmtInr(v)}
              </span>
              <span className={`num ${chg >= 0 ? "text-buy" : "text-sell"}`}>
                {chg >= 0 ? "+" : ""}
                {chg.toFixed(2)}%
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
