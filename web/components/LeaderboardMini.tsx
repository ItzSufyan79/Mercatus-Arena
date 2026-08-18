"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, fmtInr, getToken } from "@/lib/api";
import { Badge, Panel } from "./ui";

interface Row {
  rank: number;
  team_id: number;
  team_name: string;
  total_portfolio_value: string;
  cash_balance: string;
  starting_capital: string;
}

const PODIUM: Record<number, { bg: string; border: string; ring: string; label: string }> = {
  1: { bg: "linear-gradient(135deg, #f0b90b22, #080b11 70%)", border: "#f0b90b55", ring: "#f0b90b", label: "#1" },
  2: { bg: "linear-gradient(135deg, #c0c9d455, #080b11 70%)", border: "#c0c9d455", ring: "#c0c9d4", label: "#2" },
  3: { bg: "linear-gradient(135deg, #cd7f3222, #080b11 70%)", border: "#cd7f3255", ring: "#cd7f32", label: "#3" },
};

export function LeaderboardMini() {
  const [rows, setRows] = useState<Row[]>([]);
  const [myId, setMyId] = useState<number | null>(null);
  const [frozen, setFrozen] = useState(false);

  useEffect(() => {
    const token = getToken();
    if (token) {
      api<{ team_id: number }>("/api/auth/me", { token })
        .then((m) => setMyId(m.team_id))
        .catch(() => {});
    }
  }, []);

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
    const t = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const top3 = rows.slice(0, 3);
  const myRow = rows.find((r) => r.team_id === myId);

  return (
    <Panel
      title="Leaderboard"
      right={
        <Badge color={frozen ? "#f0b90b" : "#2ecc71"}>{frozen ? "frozen" : "live"}</Badge>
      }
      className="flex h-full flex-col"
    >
      <div className="space-y-2">
        {top3.map((r) => {
          const style = PODIUM[r.rank];
          return (
            <div
              key={r.team_id}
              className="relative overflow-hidden border px-4 py-3"
              style={{
                background: style.bg,
                borderColor: style.border,
                boxShadow: `inset 2px 0 0 0 ${style.ring}`,
              }}
            >
              <div className="flex items-center gap-3">
                <span
                  className="grid h-7 w-7 shrink-0 place-items-center text-[11px] font-black"
                  style={{ color: "#080b11", backgroundColor: style.ring }}
                >
                  {r.rank}
                </span>
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-semibold text-ink">{r.team_name}</div>
                  <div className="num text-[10px] text-dim">{fmtInr(Number(r.total_portfolio_value))}</div>
                </div>
                {r.team_id === myId && <Badge color="#2dd4bf">you</Badge>}
              </div>
            </div>
          );
        })}
        {rows.length === 0 && (
          <div className="py-8 text-center text-sm text-dim">No teams yet.</div>
        )}
      </div>

      <div className="mt-auto border-t border-line pt-3">
        {myRow ? (
          <div className="flex items-center gap-3 px-1">
            <div className="grid h-9 w-9 shrink-0 place-items-center border border-acc/50 bg-acc/10 font-mono text-sm font-black text-acc">
              {myRow.rank}
            </div>
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-wider text-dim">Your rank</div>
              <div className="truncate text-[13px] font-semibold text-ink">
                {myRow.team_name}
                <span className="num ml-2 text-acc">#{myRow.rank} of {rows.length}</span>
              </div>
            </div>
            <Link
              href="/leaderboard"
              className="ml-auto shrink-0 text-[11px] text-muted transition-colors hover:text-acc"
            >
              full board →
            </Link>
          </div>
        ) : (
          <div className="px-1 text-center text-[11px] text-dim">
            <Link href="/leaderboard" className="text-acc hover:underline">
              View full leaderboard →
            </Link>
          </div>
        )}
      </div>
    </Panel>
  );
}
