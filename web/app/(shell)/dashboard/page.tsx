"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  api,
  getToken,
  liveFeed,
  PricesMap,
  fmtInr,
  type STATUS,
} from "@/lib/api";
import { useStatus } from "@/lib/useStatus";
import { Badge, Panel, StatTile } from "@/components/ui";
import { AreaChart } from "@/components/AreaChart";
import { EventBanner } from "@/components/EventBanner";
import { EventCountdown } from "@/components/EventCountdown";
import { EventProgressBar } from "@/components/EventProgressBar";
import { TickerTape } from "@/components/TickerTape";
import { MarketChartCard } from "@/components/MarketChartCard";
import { CandlesChart } from "@/components/CandlesChart";
import { NumberTicker } from "@/components/magicui/number-ticker";
import { TradingConsole } from "@/components/TradingConsole";
import { LeaderboardMini } from "@/components/LeaderboardMini";
import { PositionsTable, type Portfolio } from "@/components/TradePanel";
import { SubmissionPanel } from "@/components/TradeLog";

interface Me {
  role: string;
  api_key: string | null;
  credentials_revealed: boolean;
  team_name: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const [token, setTokenState] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<PricesMap>({});
  const [history, setHistory] = useState<number[]>([]);
  const status = useStatus();
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const t = getToken();
    setTokenState(t);
    if (!t) {
      router.replace("/login");
      return;
    }
    api<Me>("/api/auth/me", { token: t })
      .then((m) => {
        setMe(m);
        if (m.role === "admin" || m.role === "evaluator") {
          router.replace(m.role === "admin" ? "/admin" : "/evaluator");
        }
      })
      .catch(() => {
        router.replace("/login");
      });

    const load = () =>
      api<Portfolio>("/api/team/portfolio", { token: t })
        .then((p) => {
          setPortfolio(p);
          setHistory((h) => {
            const next = [...h, Number(p.total_portfolio_value)];
            return next.slice(-240);
          });
        })
        .catch((e) => setError((e as Error).message));
    void load();
    pollTimer.current = setInterval(load, 3000);
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, [router]);

  useEffect(() => {
    const un = liveFeed.subscribe((p) => setLive(p));
    return un;
  }, []);

  if (error && !portfolio) {
    return (
      <div className="mx-auto max-w-sm py-20 text-center">
        <p className="text-sell">{error}</p>
        <Link href="/login" className="mt-4 inline-block text-acc hover:underline">
          Sign in again
        </Link>
      </div>
    );
  }

  if (!token || !portfolio || !me) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-sm text-dim">
        Loading trading desk…
      </div>
    );
  }

  const capital = Number(portfolio.starting_capital);
  const total = Number(portfolio.total_portfolio_value);
  const cash = Number(portfolio.cash_balance);
  const pnl = total - capital;
  const pnlPct = (pnl / capital) * 100;
  const histMin = history.length ? Math.min(...history) : total;
  const histMax = history.length ? Math.max(...history) : total;

  return (
    <div className="space-y-5">
      <EventCountdown
        scheduledStartAt={status?.scheduledStartAt ?? null}
        scheduledEndAt={status?.scheduledEndAt ?? null}
        state={status?.state ?? "PRE_LAUNCH"}
      />
      <EventBanner status={status ?? ({ state: "PRE_LAUNCH" } as STATUS)} />
      <EventProgressBar status={status ?? ({ state: "PRE_LAUNCH" } as STATUS)} />

      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate font-display text-xl font-bold tracking-tight text-ink">
              {portfolio.team_name}
            </h1>
            <Badge color="#2dd4bf">desk</Badge>
          </div>
          <div className="mt-0.5 text-[12px] text-dim">
            {me.credentials_revealed && me.api_key ? (
              <>
                API key <code className="num rounded bg-panel2 px-1.5 py-0.5 text-buy">{me.api_key}</code>
              </>
            ) : (
              <>API key sealed until launch</>
            )}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Link href="/leaderboard" className="text-[12px] text-muted hover:text-ink">
            standings →
          </Link>
        </div>
      </div>

      <MarketChartCard
        symbols={Object.keys(portfolio.livePrices)}
        initialPrices={portfolio.livePrices}
        state={status?.state ?? "PRE_LAUNCH"}
        title="Market simulation"
        showMarkers
      />

      <CandlesChart
        symbols={Object.keys(portfolio.livePrices)}
        initialPrices={portfolio.livePrices}
        state={status?.state ?? "PRE_LAUNCH"}
      />

      <section className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <div className="rounded-xl border border-line bg-panel p-5">
          <div className="flex items-baseline justify-between">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wider text-dim">
                Portfolio value
              </div>
              <div className="mt-1 flex items-baseline gap-1 text-3xl font-black text-ink">
                <span className="text-lg text-muted">₹</span>
                <NumberTicker
                  value={total}
                  decimalPlaces={2}
                  className="tabular-nums"
                />
              </div>
            </div>
            <div className={`num text-right text-sm font-bold ${pnl >= 0 ? "text-buy" : "text-sell"}`}>
              {pnl >= 0 ? "▲" : "▼"} {fmtInr(pnl)}
              <div className="text-[11px] text-dim">
                {pnlPct >= 0 ? "+" : ""}
                {pnlPct.toFixed(2)}%
              </div>
            </div>
          </div>
          <div className="mt-4 h-40">
            <AreaChart data={history} height={160} id="portfolio" />
          </div>
          <div className="mt-2 flex justify-between text-[10px] uppercase tracking-wider text-dim">
            <span>
              range {fmtInr(histMin)} – {fmtInr(histMax)}
            </span>
            <span>live · {history.length} samples</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <StatTile label="Cash" value={fmtInr(cash)} sub="available balance" />
          <StatTile
            label="PnL"
            value={
              <span className={`flex items-baseline gap-1 ${pnl >= 0 ? "text-buy" : "text-sell"}`}>
                <span>{pnl >= 0 ? "+" : "−"}₹</span>
                <NumberTicker value={Math.abs(pnl)} decimalPlaces={2} className="tabular-nums" />
              </span>
            }
            tone={pnl >= 0 ? "up" : "down"}
            sub={`${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}% vs start`}
          />
          <StatTile
            label="Positions"
            value={portfolio.positions.length}
            sub={`${portfolio.positions.reduce((s, p) => s + p.quantity, 0)} shares`}
          />
          <StatTile
            label="Order latency"
            value={<span className="text-lg">sub-20ms</span>}
            sub="avg target per request"
          />
        </div>
      </section>

      <TickerTape
        symbols={Object.keys(portfolio.livePrices)}
        prices={{ ...portfolio.livePrices, ...live }}
        state={status?.state ?? "PRE_LAUNCH"}
      />

      <section className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <TradingConsole
          portfolio={portfolio}
          apiKey={me.credentials_revealed ? me.api_key : null}
          onTraded={() => api<Portfolio>("/api/team/portfolio", { token }).then(setPortfolio)}
        />
        <LeaderboardMini />
      </section>

      <section className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <PositionsTable portfolio={portfolio} live={live} />
        <SubmissionPanel />
      </section>
    </div>
  );
}
