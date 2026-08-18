import Link from "next/link";
import { Panel } from "@/components/ui";

const SECTIONS = [
  {
    id: "overview",
    title: "Overview",
    body: [
      "TechVerse 2026 — Mercatus Arena is a real-time algorithmic trading evaluation. Every team trades the identical shared market feed over REST + WebSocket, and the platform measures per-request millisecond latency. Final standings blend live trading PnL with judge scores.",
    ],
  },
  {
    id: "timeline",
    title: "Event timeline",
    rows: [
      ["T−0", "Market opens — live feed on REST + WebSocket. API keys revealed."],
      ["T−20m", "Leaderboard freezes — rankings stop changing, trading continues."],
      ["T−15m", "API rejects new orders — no further fills."],
      ["T−0 (end)", "Final rankings computed from PnL, code, and report."],
    ],
  },
  {
    id: "rules",
    title: "Trading rules",
    rows: [
      ["Market orders", "Fill instantly at the current mid price."],
      ["Limit orders", "Fill only when the market crosses your limit; otherwise REJECTED with LIMIT_NOT_REACHED."],
      ["Positions", "Long-only. No leverage, no fees. Shorting is rejected (INSUFFICIENT_POSITION when closing more than held)."],
      ["Starting capital", "Every team starts with identical cash — fairness is guaranteed."],
    ],
  },
  {
    id: "scoring",
    title: "Scoring",
    rows: [
      ["PnL rank", "50% of the final score, from your portfolio value at freeze."],
      ["Code quality", "25% — judged by the evaluator panel."],
      ["Strategy report", "25% — judged by the evaluator panel."],
      ["Formula", "Final = (PnL rank × 0.50) + (Code × 0.25) + (Report × 0.25)"],
    ],
  },
];

export default function DocsPage() {
  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink">Documentation</h1>
        <p className="mt-1 text-sm text-muted">
          Everything you need to compete in the Mercatus Arena.
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-2">
        {SECTIONS.map((s) => (
          <Panel key={s.id} title={s.title} className="h-fit">
            {s.body ? (
              <p className="text-[13px] leading-relaxed text-muted">{s.body.join(" ")}</p>
            ) : (
              <ul className="space-y-2">
                {s.rows!.map(([k, v]) => (
                  <li key={k} className="flex gap-3 text-[13px]">
                    <span className="num w-20 shrink-0 font-bold text-acc">{k}</span>
                    <span className="text-muted">{v}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        ))}
      </div>

      <Panel title="Next steps" className="h-fit">
        <ol className="space-y-2 text-[13px] text-muted">
          <li className="flex gap-2">
            <span className="num text-acc">01</span>
            <span>
              Register your team — your API key is generated immediately but stays masked until launch.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="num text-acc">02</span>
            <span>
              Grab the API reference on the{" "}
              <Link href="/api" className="text-acc hover:underline">
                API Reference
              </Link>{" "}
              page and build your bot.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="num text-acc">03</span>
            <span>Watch fills and latency live on the Trading Desk.</span>
          </li>
          <li className="flex gap-2">
            <span className="num text-acc">04</span>
            <span>Submit your code and strategy report before the deadline.</span>
          </li>
        </ol>
      </Panel>
    </div>
  );
}
