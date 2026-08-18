"use client";

import { useEffect, useState } from "react";
import { api, fmtInr, getToken } from "@/lib/api";
import { Panel, Badge, Th, Td, TableWrap } from "@/components/ui";

interface Me {
  role: string;
  team_name: string;
  api_key: string | null;
  credentials_revealed: boolean;
}

interface TeamRow {
  team_id: number;
  team_name: string;
  role?: string;
  email: string;
  api_key: string | null;
  total_portfolio_value: string;
  is_frozen: boolean;
}

function keyCell(key: string | null, revealed: boolean) {
  if (key) return <code className="num text-[12px] text-acc">{key}</code>;
  if (revealed) return <span className="text-[12px] text-sell">—</span>;
  return <span className="text-[12px] text-gold">masked</span>;
}

export default function AllocationsPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [rows, setRows] = useState<TeamRow[]>([]);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    api<Me>("/api/auth/me", { token })
      .then((m) => {
        setMe(m);
        setRevealed(m.credentials_revealed);
        const endpoint =
          m.role === "admin"
            ? "/api/admin/teams"
            : m.role === "evaluator"
              ? "/api/evaluator/teams"
              : null;
        if (endpoint) {
          api<{ teams: TeamRow[] }>(endpoint, { token })
            .then((d) => setRows(d.teams))
            .catch(() => {});
        }
      })
      .catch(() => {});
  }, []);

  const isTeam = me?.role === "team";

  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink">
          Team Allocations
        </h1>
        <p className="mt-1 text-sm text-muted">
          API key allocation and portfolio state per team.
        </p>
      </header>

      {isTeam ? (
        <Panel
          title="Your allocation"
          right={<Badge color={revealed ? "#2ecc71" : "#f0b90b"}>{revealed ? "revealed" : "masked"}</Badge>}
        >
          <div className="space-y-2 text-[13px]">
            <div className="flex items-center justify-between border border-line bg-panel2 px-3 py-2">
              <span className="text-muted">Team</span>
              <span className="font-semibold text-ink">{me?.team_name}</span>
            </div>
            <div className="flex items-center justify-between border border-line bg-panel2 px-3 py-2">
              <span className="text-muted">API key</span>
              {me?.api_key ? (
                <code className="num text-[13px] text-acc">{me.api_key}</code>
              ) : (
                <span className="text-gold">Masked until launch — the Trading Desk reveals it.</span>
              )}
            </div>
          </div>
        </Panel>
      ) : (
        <Panel
          title={me?.role === "admin" ? "All teams" : "Team registry"}
          right={<Badge color={revealed ? "#2ecc71" : "#f0b90b"}>{revealed ? "keys revealed" : "keys masked"}</Badge>}
          pad={false}
        >
          <TableWrap>
            <table className="w-full">
              <thead>
                <tr className="border-b border-line bg-panel2/50">
                  <Th>Team</Th>
                  <Th>Email</Th>
                  <Th>Status</Th>
                  <Th right>Portfolio</Th>
                  <Th>API key</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.team_id} className="border-b border-line/50 last:border-0">
                    <Td mono={false}>{t.team_name}</Td>
                    <Td muted mono={false}>{t.email}</Td>
                    <Td>
                      {t.is_frozen ? (
                        <Badge color="#f0514c">frozen</Badge>
                      ) : (
                        <Badge color="#2ecc71">active</Badge>
                      )}
                    </Td>
                    <Td right>{fmtInr(Number(t.total_portfolio_value))}</Td>
                    <Td>{keyCell(t.api_key, revealed)}</Td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-sm text-dim">
                      No teams yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </TableWrap>
        </Panel>
      )}
    </div>
  );
}
