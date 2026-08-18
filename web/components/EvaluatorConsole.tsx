"use client";

import { useEffect, useMemo, useState } from "react";
import { api, getToken, fmt, fmtInr, type PricesMap } from "@/lib/api";
import { useStatus } from "@/lib/useStatus";
import { Badge, Button, Input, Panel, Select, TableWrap, Td, Th } from "./ui";
import { MarketChartCard, type ExternalMarker } from "./MarketChartCard";

interface Team {
  team_id: number;
  team_name: string;
  email: string;
  is_frozen: boolean;
  cash_balance: string;
  total_portfolio_value: string;
  api_key: string | null;
}

interface ScoreRow {
  team_id: number;
  team_name: string;
  pnl_rank: number | null;
  code_quality_score: number | null;
  strategy_report_score: number | null;
  final_score: number | null;
}

interface AuditTrade {
  order_id: number;
  action: "BUY" | "SELL";
  symbol: string;
  quantity: number;
  price_requested: string | null;
  price_executed: string | null;
  status: "SUCCESS" | "REJECTED";
  reason: string | null;
  latency_ms: number | null;
  timestamp_ms: string;
}

interface AuditRequest {
  method: string;
  path: string;
  status: number;
  latency_ms: number | null;
  created_at: string;
}

interface Submission {
  pdf_storage_url: string | null;
  pdf_name: string | null;
  code_repository_link: string | null;
  submitted_at: string | null;
}

interface Audit {
  team: { team_name: string; cash_balance: string; total_portfolio_value: string; starting_capital: string };
  trades: AuditTrade[];
  requests: AuditRequest[];
}

function fmtTime(iso: string | number) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return `${d.toLocaleTimeString("en-US", { hour12: false })}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

export function EvaluatorConsole() {
  const [token, setToken] = useState<string | null>(null);
  const [login, setLogin] = useState({ email: "", password: "" });
  const [teams, setTeams] = useState<Team[]>([]);
  const [scores, setScores] = useState<ScoreRow[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [audit, setAudit] = useState<Audit | null>(null);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [form, setForm] = useState({ code: "", report: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const [livePrices, setLivePrices] = useState<PricesMap>({});
  const status = useStatus();

  useEffect(() => {
    const t = getToken();
    setToken(t);
    if (t) void refresh(t);
  }, []);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    const load = () =>
      api<{ prices: PricesMap }>("/api/market/snapshot")
        .then((d) => alive && setLivePrices(d.prices))
        .catch(() => {});
    void load();
    const t = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    const load = () =>
      api<{ teams: Team[] }>("/api/evaluator/teams", { token })
        .then((d) => {
          if (!alive) return;
          setTeams(d.teams);
          setSelected((s) => (s ?? d.teams[0]?.team_id ?? null));
        })
        .catch(() => {});
    void load();
    const t = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [token]);

  useEffect(() => {
    if (!token || selected == null) return;
    let alive = true;
    const submissionP = api<Submission | null>(`/api/evaluator/teams/${selected}/submission`, { token }).catch(
      () => null,
    );
    Promise.all([
      api<Audit>(`/api/evaluator/teams/${selected}/audit`, { token }),
      submissionP,
      api<{ scores: ScoreRow[] }>("/api/evaluator/scoring", { token }),
    ])
      .then(([a, s, sc]) => {
        if (!alive) return;
        setAudit(a);
        setSubmission(s);
        setScores(sc.scores);
        const existing = sc.scores.find((x) => x.team_id === selected);
        setForm({
          code: existing?.code_quality_score != null ? String(existing.code_quality_score) : "",
          report: existing?.strategy_report_score != null ? String(existing.strategy_report_score) : "",
        });
      })
      .catch((e) => alive && setMsg((e as Error).message));
    return () => {
      alive = false;
    };
  }, [token, selected]);

  async function doLogin() {
    try {
      const r = await api<{ token: string }>("/api/auth/login", { method: "POST", body: login });
      localStorage.setItem("mercatus_token", r.token);
      setToken(r.token);
      setMsg(null);
      await refresh(r.token);
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  async function refresh(t: string) {
    try {
      const r1 = await api<{ teams: Team[] }>("/api/evaluator/teams", { token: t });
      setTeams(r1.teams);
      setSelected((s) => s ?? r1.teams[0]?.team_id ?? null);
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  async function saveScore() {
    if (!token || selected == null) return;
    try {
      await api("/api/evaluator/scoring", {
        method: "POST",
        token,
        body: {
          team_id: selected,
          code_quality: Number(form.code),
          strategy_report: Number(form.report),
        },
      });
      setMsg("Scores saved");
      const sc = await api<{ scores: ScoreRow[] }>("/api/evaluator/scoring", { token });
      setScores(sc.scores);
    } catch (e) {
      setMsg(`Failed: ${(e as Error).message}`);
    }
  }

  async function compute() {
    if (!token) return;
    try {
      await api("/api/evaluator/scoring/compute", { method: "POST", token });
      setMsg("Final scores computed");
      const sc = await api<{ scores: ScoreRow[] }>("/api/evaluator/scoring", { token });
      setScores(sc.scores);
    } catch (e) {
      setMsg(`Failed: ${(e as Error).message}`);
    }
  }

  const symbols = Object.keys(livePrices);
  const initialPrices = { ...livePrices };

  const markers: ExternalMarker[] = useMemo(
    () =>
      (audit?.trades ?? [])
        .filter((t) => t.status === "SUCCESS" && t.price_executed != null)
        .map((t) => ({
          symbol: t.symbol,
          action: t.action,
          price: Number(t.price_executed),
          ts: new Date(t.timestamp_ms).getTime(),
        })),
    [audit],
  );

  if (!token) {
    return (
      <div className="mx-auto max-w-sm">
        <Panel title="Judge sign in" className="p-0">
          <div className="space-y-4 p-5">
            <Input
              label="Email"
              value={login.email}
              onChange={(e) => setLogin({ ...login, email: e.target.value })}
            />
            <Input
              label="Password"
              type="password"
              value={login.password}
              onChange={(e) => setLogin({ ...login, password: e.target.value })}
            />
            {msg && <div className="text-sm text-sell">{msg}</div>}
            <Button onClick={doLogin} className="w-full">
              Sign in as judge
            </Button>
          </div>
        </Panel>
      </div>
    );
  }

  const selectedTeam = teams.find((t) => t.team_id === selected);
  const selectedScore = scores.find((s) => s.team_id === selected);

  return (
    <div className="grid gap-5 xl:grid-cols-[340px_1fr]">
      {/* Team leaderboard — clickable */}
      <Panel
        title="Team Leaderboard"
        right={<Badge color="#2dd4bf">{teams.length} teams</Badge>}
        className="self-start xl:sticky xl:top-6"
        pad={false}
      >
        <div className="max-h-[calc(100vh-220px)] overflow-auto">
          {teams.map((t, idx) => {
            const active = t.team_id === selected;
            const v = Number(t.total_portfolio_value);
            return (
              <button
                key={t.team_id}
                onClick={() => setSelected(t.team_id)}
                className={`flex w-full items-center gap-3 border-b border-line/50 px-4 py-2.5 text-left transition-colors last:border-0 ${
                  active ? "border-l-2 border-l-acc bg-panel2" : "hover:bg-panel2/50"
                }`}
              >
                <span
                  className={`grid h-6 w-6 shrink-0 place-items-center font-mono text-[11px] font-bold ${
                    idx < 3 ? "bg-acc text-bg" : "border border-line bg-panel2 text-muted"
                  }`}
                >
                  {idx + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-ink">{t.team_name}</div>
                  <div className="num text-[10px] text-dim">{fmtInr(v)}</div>
                </div>
                {t.is_frozen ? (
                  <Badge color="#f0b90b">frozen</Badge>
                ) : (
                  <span className="text-[10px] text-dim">#{t.team_id}</span>
                )}
              </button>
            );
          })}
          {teams.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-dim">No teams registered yet.</div>
          )}
        </div>
      </Panel>

      {/* Main evaluation area */}
      <div className="min-w-0 space-y-5">
        {msg && <div className="num border border-line bg-panel px-3 py-2 text-[12px] text-muted">{msg}</div>}

        <MarketChartCard
          symbols={symbols}
          initialPrices={initialPrices}
          state={status?.state ?? "PRE_LAUNCH"}
          title={selectedTeam ? `${selectedTeam.team_name} — Trade Audit` : "Team Trade Audit"}
          externalMarkers={markers}
        />

        <Panel
          title="Team Ledger"
          right={
            audit ? (
              <Badge color="#55657a">
                cash {fmtInr(Number(audit.team.cash_balance), 0)} · portfolio {fmtInr(Number(audit.team.total_portfolio_value), 0)}
              </Badge>
            ) : undefined
          }
          pad={false}
        >
          <TableWrap>
            <table className="w-full">
              <thead>
                <tr className="border-b border-line bg-panel2/50">
                  <Th>Time (ms)</Th>
                  <Th>#</Th>
                  <Th>Side</Th>
                  <Th>Sym</Th>
                  <Th right>Qty</Th>
                  <Th right>Exec</Th>
                  <Th right>Req</Th>
                  <Th right>Latency</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {(audit?.trades ?? []).map((t) => (
                  <tr key={t.order_id} className="border-b border-line/50 last:border-0">
                    <Td muted>{fmtTime(t.timestamp_ms)}</Td>
                    <Td muted>{t.order_id}</Td>
                    <Td>
                      <span className={`text-[11px] font-bold ${t.action === "BUY" ? "text-buy" : "text-sell"}`}>
                        {t.action}
                      </span>
                    </Td>
                    <Td mono={false}>
                      <span className="font-mono font-bold text-ink">{t.symbol}</span>
                    </Td>
                    <Td right>{t.quantity}</Td>
                    <Td right>{t.price_executed != null ? fmt(t.price_executed) : "—"}</Td>
                    <Td right muted>{t.price_requested != null ? fmt(t.price_requested) : "—"}</Td>
                    <Td right>{t.latency_ms != null ? `${t.latency_ms}ms` : "—"}</Td>
                    <Td>
                      <span
                        className={`text-[11px] font-semibold ${
                          t.status === "SUCCESS"
                            ? "text-buy"
                            : t.reason === "MARKET_NOT_ACTIVE"
                              ? "text-dim"
                              : "text-sell"
                        }`}
                      >
                        {t.status}
                        {t.reason && t.status === "REJECTED" ? <span className="text-dim"> · {t.reason}</span> : null}
                      </span>
                    </Td>
                  </tr>
                ))}
                {(audit?.trades.length ?? 0) === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-sm text-dim">
                      No orders for this team yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </TableWrap>
        </Panel>

        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="Submissions" right={<Badge color="#f0b90b">report + code</Badge>}>
            {submission ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between border border-line bg-panel2 px-3 py-2 text-[12px]">
                  <span className="truncate text-muted">
                    {submission.pdf_name ?? "Strategy report PDF"}
                  </span>
                  {submission.pdf_storage_url ? (
                    <a
                      href={submission.pdf_storage_url}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 text-acc hover:underline"
                    >
                      open pdf ↗
                    </a>
                  ) : (
                    <span className="shrink-0 text-dim">no pdf</span>
                  )}
                </div>
                <div className="flex items-center justify-between border border-line bg-panel2 px-3 py-2 text-[12px]">
                  <span className="truncate text-muted">Code repository</span>
                  {submission.code_repository_link ? (
                    <a
                      href={submission.code_repository_link}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 text-acc hover:underline"
                    >
                      open repo ↗
                    </a>
                  ) : (
                    <span className="shrink-0 text-dim">no link</span>
                  )}
                </div>
                {submission.submitted_at && (
                  <div className="num text-[11px] text-dim">
                    submitted {new Date(submission.submitted_at).toLocaleString()}
                  </div>
                )}
              </div>
            ) : (
              <div className="py-4 text-center text-sm text-dim">No submission recorded.</div>
            )}
          </Panel>

          <Panel
            title="Judge scoring"
            right={
              selectedScore?.final_score != null ? (
                <span className="num text-[12px] font-bold text-acc">
                  final {selectedScore.final_score.toFixed(2)}
                </span>
              ) : undefined
            }
          >
            <div className="space-y-3">
              <Select value={selected ?? ""} onChange={(e) => setSelected(Number(e.target.value))}>
                {teams.map((t) => (
                  <option key={t.team_id} value={t.team_id}>
                    #{t.team_id} {t.team_name}
                  </option>
                ))}
              </Select>
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Code quality"
                  type="number"
                  min={0}
                  max={100}
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                />
                <Input
                  label="Strategy report"
                  type="number"
                  min={0}
                  max={100}
                  value={form.report}
                  onChange={(e) => setForm({ ...form, report: e.target.value })}
                />
              </div>
              <div className="flex gap-2">
                <Button onClick={saveScore} disabled={selected == null} className="flex-1">
                  Save scores
                </Button>
                <Button variant="accent" onClick={compute}>
                  Compute finals
                </Button>
              </div>
            </div>
          </Panel>
        </div>

        <Panel
          title="Request log"
          right={<Badge color="#55657a">{audit?.requests.length ?? 0} requests</Badge>}
          pad={false}
        >
          <TableWrap>
            <table className="w-full">
              <thead>
                <tr className="border-b border-line bg-panel2/50">
                  <Th>Time</Th>
                  <Th>Method</Th>
                  <Th>Path</Th>
                  <Th right>Status</Th>
                  <Th right>Latency</Th>
                </tr>
              </thead>
              <tbody>
                {(audit?.requests ?? []).slice(0, 200).map((r, i) => (
                  <tr key={i} className="border-b border-line/50 last:border-0">
                    <Td muted>{fmtTime(r.created_at)}</Td>
                    <Td>
                      <span
                        className={`text-[11px] font-bold ${
                          r.method === "POST" ? "text-buy" : r.method === "GET" ? "text-acc" : "text-dim"
                        }`}
                      >
                        {r.method}
                      </span>
                    </Td>
                    <Td mono={false}>
                      <span className="font-mono text-[12px] text-ink">{r.path}</span>
                    </Td>
                    <Td right>
                      <span className={r.status >= 400 ? "text-sell" : "text-muted"}>{r.status}</span>
                    </Td>
                    <Td right>{r.latency_ms != null ? `${r.latency_ms}ms` : "—"}</Td>
                  </tr>
                ))}
                {(audit?.requests.length ?? 0) === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-sm text-dim">
                      No API requests logged for this team.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </TableWrap>
        </Panel>
      </div>
    </div>
  );
}
