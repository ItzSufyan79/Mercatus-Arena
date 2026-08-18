"use client";

import { useEffect, useState } from "react";
import { STATUS, fmt, fmtInr } from "@/lib/api";

export function EventBanner({ status }: { status: Partial<STATUS> }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  const labels: Record<string, [string, string]> = {
    PRE_LAUNCH: ["PRE-LAUNCH", "#55657a"],
    ACTIVE_MARKET: ["MARKET OPEN", "#2ecc71"],
    API_FROZEN: ["API FROZEN", "#f0b90b"],
    EVENT_CONCLUDED: ["CONCLUDED", "#f0514c"],
  };
  const state = status.state ?? "PRE_LAUNCH";
  const [label, color] = labels[state] ?? labels.PRE_LAUNCH;

  const freezeAt = status.apiFreezeAt ? new Date(status.apiFreezeAt).getTime() : null;
  const endAt = status.scheduledEndAt ? new Date(status.scheduledEndAt).getTime() : null;
  const freezeMs = freezeAt ? Math.max(0, freezeAt - now) : null;
  const endMs = endAt ? Math.max(0, endAt - now) : null;

  const hms = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  };

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-line bg-panel px-4 py-2.5">
      <span className="flex items-center gap-2">
        <span
          className={`h-2 w-2 rounded-full ${status.state === "ACTIVE_MARKET" ? "live-dot" : ""}`}
          style={{ backgroundColor: color }}
        />
        <span className="font-mono text-xs font-bold tracking-widest" style={{ color }}>
          {label}
        </span>
        {status.paused && <span className="text-[11px] font-bold text-gold">[PAUSED]</span>}
      </span>
      <span className="num text-[13px] text-ink">
        T−{hms(freezeMs ?? endMs ?? 0)}{" "}
        <span className="text-dim">{freezeMs !== null ? "till API freeze" : "till close"}</span>
      </span>
      <span className="num text-[11px] text-dim">
        tick <span className="text-muted">{(status.tickCount ?? 0).toLocaleString()}</span>
      </span>
      <span className="num text-[11px] text-dim">
        vol <span className="text-muted">{((status.volatility ?? 1) * 100).toFixed(2)}%</span>
      </span>
      <span className="num text-[11px] text-dim">
        speed <span className="text-muted">{(status.replaySpeed ?? 1).toFixed(0)}×</span>
      </span>
      {status.credentialsRevealed ? (
        <span className="ml-auto text-[11px] font-semibold uppercase tracking-wider text-buy">
          ● credentials revealed
        </span>
      ) : (
        <span className="ml-auto text-[11px] font-semibold uppercase tracking-wider text-dim">
          ○ api keys sealed
        </span>
      )}
      {status.leaderboardFrozen && (
        <span className="text-[11px] font-semibold uppercase tracking-wider text-gold">
          ■ leaderboard frozen
        </span>
      )}
      <span className="num text-[11px] text-dim">
        capital <span className="text-muted">{fmtInr(status.startCapital ?? 100000, 0)}</span>
      </span>
    </div>
  );
}
