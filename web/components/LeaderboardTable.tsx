"use client";

import { useEffect, useState } from "react";
import { api, fmtInr } from "@/lib/api";
import { Badge, Panel, RankBadge } from "./ui";

interface Row {
  rank: number;
  team_id: number;
  team_name: string;
  total_portfolio_value: string;
}

export function LeaderboardTable({ compact = false }: { compact?: boolean }) {
  const [frozen, setFrozen] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api<{ frozen: boolean; teams: Row[] }>("/api/market/leaderboard")
        .then((d) => {
          if (!alive) return;
          setFrozen(d.frozen);
          setRows(d.teams);
        })
        .catch(() => {});
    void load();
    const t = setInterval(load, compact ? 5000 : 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [compact]);

  const shown = compact ? rows.slice(0, 5) : rows;
  const maxVal = Math.max(...rows.map((r) => Number(r.total_portfolio_value)), 1);

  return (
    <Panel
      title="Leaderboard"
      right={
        <Badge color={frozen ? "#f0b90b" : "#2ecc71"}>{frozen ? "frozen" : "live"}</Badge>
      }
      pad={false}
    >
      {frozen && (
        <div className="border-b border-gold/20 bg-gold/10 px-4 py-2 text-[11px] text-gold">
          Rankings frozen at blackout — no longer change.
        </div>
      )}
      <table className="w-full">
        <thead>
          <tr className="border-b border-line bg-panel2/50">
            <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-dim">Rank</th>
            <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-dim">Team</th>
            <th className="px-4 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-dim">
              Portfolio Value
            </th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => {
            const v = Number(r.total_portfolio_value);
            return (
              <tr key={r.team_id} className="border-b border-line/50 last:border-0">
                <td className="px-4 py-2.5">
                  <RankBadge rank={r.rank} />
                </td>
                <td className="px-4 py-2.5 font-medium text-ink">{r.team_name}</td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center justify-end gap-2">
                    <span className="num text-[13px] font-semibold text-ink">
                      {fmtInr(v)}
                    </span>
                    <span className="hidden w-16 sm:block">
                      <span className="block h-1 overflow-hidden rounded-full bg-line">
                        <span
                          className="block h-full rounded-full bg-acc/70"
                          style={{ width: `${(v / maxVal) * 100}%` }}
                        />
                      </span>
                    </span>
                  </div>
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={3} className="px-4 py-8 text-center text-sm text-dim">
                No teams registered yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {compact && rows.length > 5 && (
        <div className="border-t border-line px-4 py-2 text-center text-[11px] text-dim">
          +{rows.length - 5} more — see full board
        </div>
      )}
    </Panel>
  );
}
