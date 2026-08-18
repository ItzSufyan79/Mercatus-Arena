"use client";

import { useEffect, useState } from "react";
import { api, getToken, fmt, fmtInr } from "@/lib/api";
import { useStatus } from "@/lib/useStatus";
import { Badge, Button, Input, Panel, Select, StatTile, TableWrap, Td, Th } from "./ui";
import { MarketChartCard } from "./MarketChartCard";
import { LeaderboardTable } from "./LeaderboardTable";

interface Metrics {
  latency: {
    requests: string;
    avg_latency_ms: string;
    p95_ms: number | null;
    p99_ms: number | null;
    errors: string;
  };
  fills: {
    team_id: number;
    filled: string;
    rejected: string;
    insufficient_funds: string;
    avg_trade_ms: string | null;
  }[];
  teams: {
    team_id: number;
    team_name: string;
    email: string;
    is_frozen: boolean;
    cash_balance: string;
    total_portfolio_value: string;
    api_key: string | null;
    role: string;
  }[];
  live: { symbol: string; price: string; prev_price: string }[];
}

interface CreatedUser {
  team_id: string;
  team_name: string;
  role: string;
  email: string;
  api_key: string | null;
}

export function AdminConsole() {
  const [token, setToken] = useState<string | null>(null);
  const [login, setLogin] = useState({ email: "", password: "" });
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [user, setUser] = useState({
    role: "team",
    team_name: "",
    email: "",
    password: "",
    starting_capital: "100000",
  });
  const [created, setCreated] = useState<CreatedUser[]>([]);
  const [cfg, setCfg] = useState({ volatility: 1, replaySpeed: 1, shock: -0.05 });
  const [score, setScore] = useState({ team_id: "", code: "", report: "" });
  const status = useStatus();

  useEffect(() => setToken(getToken()), []);
  useEffect(() => {
    if (token) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function refresh() {
    if (!token) return;
    try {
      const m = await api<Metrics>("/api/admin/metrics", { token });
      setMetrics(m);
    } catch (e) {
      setToken(null);
      setMsg((e as Error).message);
    }
  }

  async function admin(action: string, body: Record<string, unknown> = {}) {
    if (!token) return;
    try {
      const r = await api<{ ok?: boolean; error?: string }>(action, {
        method: "POST",
        body,
        token,
      });
      setMsg(`${action} → ${r.ok ? "ok" : r.error}`);
      await refresh();
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  async function doLogin() {
    try {
      const r = await api<{ token: string }>("/api/auth/login", {
        method: "POST",
        body: login,
      });
      localStorage.setItem("mercatus_token", r.token);
      setToken(r.token);
      setMsg("logged in");
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  async function createUser() {
    if (!token) return;
    try {
      const r = await api<{ user: CreatedUser; api_key: string | null }>(
        "/api/admin/users",
        {
          method: "POST",
          token,
          body: {
            role: user.role,
            team_name: user.team_name,
            email: user.email,
            password: user.password,
            ...(user.role === "team" && user.starting_capital
              ? { starting_capital: Number(user.starting_capital) }
              : {}),
          },
        },
      );
      setCreated((c) => [r.user, ...c].slice(0, 20));
      setMsg(`Created ${r.user.role} account — key ${r.api_key ?? "none"}`);
      setUser((u) => ({ ...u, team_name: "", email: "", password: "" }));
    } catch (e) {
      setMsg(`Create failed: ${(e as Error).message}`);
    }
  }

  async function uploadDataset(file: File) {
    if (!token) return;
    const form = new FormData();
    form.append("file", file);
    try {
      const r = await api<{ ok: boolean; rows: number }>("/api/admin/dataset", {
        method: "POST",
        form,
        token,
      });
      setMsg(`dataset uploaded: ${r.rows} rows`);
      await refresh();
    } catch (e) {
      setMsg(`dataset failed: ${(e as Error).message}`);
    }
  }

  async function generateSynthetic() {
    await admin("/api/admin/dataset/synthetic", {
      duration_minutes: 180,
      symbols: ["AAPL", "MSFT", "GOOG", "TSLA", "NVDA"],
    });
  }

  if (!token) {
    return (
      <div className="mx-auto max-w-sm">
        <Panel title="Admin sign in" className="p-0">
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
              Sign in
            </Button>
          </div>
        </Panel>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-xl font-bold tracking-tight text-ink">Admin Console</h1>
        <Badge color="#f0514c">admin</Badge>
        <Button variant="ghost" size="sm" onClick={refresh} className="ml-auto">
          Refresh
        </Button>
      </div>

      {msg && (
        <div className="num rounded-lg border border-line bg-panel px-3 py-2 text-[12px] text-muted">
          {msg}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <MarketChartCard
          symbols={(metrics?.live ?? []).map((l) => l.symbol)}
          initialPrices={Object.fromEntries(
            (metrics?.live ?? []).map((l) => [l.symbol, Number(l.price)]),
          )}
          state={status?.state ?? "PRE_LAUNCH"}
          title="Market Simulation"
        />

        <div className="space-y-5">
          <Panel title="Market Fluctuation Tools">
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="buy"
                  onClick={() => admin("/api/admin/control", { action: "start" })}
                  disabled={status?.state === "ACTIVE_MARKET"}
                >
                  Start
                </Button>
                <Button
                  variant="ghost"
                  onClick={() =>
                    admin("/api/admin/control", { action: status?.paused ? "resume" : "pause" })
                  }
                >
                  {status?.paused ? "Resume" : "Pause"}
                </Button>
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between text-[12px] text-muted">
                  <span>Volatility</span>
                  <span className="num font-semibold text-ink">×{cfg.volatility}</span>
                </div>
                <input
                  type="range"
                  min={0.1}
                  max={20}
                  step={0.1}
                  value={cfg.volatility}
                  onChange={(e) => setCfg({ ...cfg, volatility: Number(e.target.value) })}
                  className="w-full accent-[#2dd4bf]"
                />
                <Button
                  size="sm"
                  className="mt-2 w-full"
                  onClick={() => admin("/api/admin/volatility", { multiplier: cfg.volatility })}
                >
                  Set volatility
                </Button>
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between text-[12px] text-muted">
                  <span>Replay speed</span>
                  <span className="num font-semibold text-ink">×{cfg.replaySpeed}</span>
                </div>
                <input
                  type="range"
                  min={0.1}
                  max={20}
                  step={0.1}
                  value={cfg.replaySpeed}
                  onChange={(e) => setCfg({ ...cfg, replaySpeed: Number(e.target.value) })}
                  className="w-full accent-[#2dd4bf]"
                />
                <Button
                  size="sm"
                  className="mt-2 w-full"
                  onClick={() => admin("/api/admin/config", { replay_speed: cfg.replaySpeed })}
                >
                  Set replay speed
                </Button>
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between text-[12px] text-muted">
                  <span>Flash crash shock</span>
                  <span className="num font-semibold text-sell">
                    {(cfg.shock * 100).toFixed(0)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={-0.3}
                  max={0.3}
                  step={0.01}
                  value={cfg.shock}
                  onChange={(e) => setCfg({ ...cfg, shock: Number(e.target.value) })}
                  className="w-full accent-[#f0514c]"
                />
                <Button
                  size="sm"
                  variant="danger"
                  className="mt-2 w-full"
                  onClick={() => admin("/api/admin/flash-crash", { shock: cfg.shock })}
                >
                  Trigger flash crash
                </Button>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button variant="danger" size="sm" onClick={() => admin("/api/admin/control", { action: "halt" })}>
                  Conclude
                </Button>
                <Button
                  variant="accent"
                  size="sm"
                  onClick={() => admin("/api/admin/control", { action: "reveal_credentials" })}
                >
                  Reveal API keys
                </Button>
                <Button variant="accent" size="sm" onClick={() => admin("/api/admin/leaderboard/freeze", {})}>
                  Freeze board
                </Button>
              </div>
            </div>
          </Panel>

          <Panel title="Event status" pad={false}>
            <div className="grid grid-cols-2 gap-px bg-line">
              {[
                ["State", status?.state ?? "—"],
                ["Tick", status?.tickCount ?? "—"],
                ["Paused", status?.paused ? "yes" : "no"],
                ["Volatility", `×${status?.volatility ?? "—"}`],
              ].map(([k, v]) => (
                <div key={k} className="bg-panel px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wider text-dim">{k}</div>
                  <div className="num text-[13px] font-semibold text-ink">{v}</div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>

      <LeaderboardTable />

      <Panel title="Create accounts">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Select label="Role" value={user.role} onChange={(e) => setUser({ ...user, role: e.target.value })}>
              <option value="team">Student / Team</option>
              <option value="evaluator">Evaluator (judge)</option>
              <option value="admin">Admin</option>
            </Select>
            {user.role === "team" && (
              <Input
                label="Starting capital"
                mono
                value={user.starting_capital}
                onChange={(e) => setUser({ ...user, starting_capital: e.target.value })}
              />
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Team / display name"
              value={user.team_name}
              onChange={(e) => setUser({ ...user, team_name: e.target.value })}
            />
            <Input
              label="Email"
              type="email"
              value={user.email}
              onChange={(e) => setUser({ ...user, email: e.target.value })}
            />
          </div>
          <Input
            label="Password"
            type="password"
            value={user.password}
            onChange={(e) => setUser({ ...user, password: e.target.value })}
          />
          <Button
            onClick={createUser}
            disabled={!user.team_name || !user.email || user.password.length < 6}
            className="w-full"
          >
            Create account
          </Button>
          {created.length > 0 && (
            <div className="space-y-1">
              {created.map((c, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-lg border border-line bg-panel2/60 px-3 py-1.5 text-[12px]"
                >
                  <span className="truncate text-ink">
                    {c.team_name} <span className="text-dim">· {c.role}</span>
                  </span>
                  {c.api_key ? (
                    <code className="num text-buy">{c.api_key}</code>
                  ) : (
                    <Badge color="#55657a">no key</Badge>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </Panel>

      <Panel title="Dataset">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="file"
            accept=".csv,.txt"
            onChange={(e) => e.target.files?.[0] && uploadDataset(e.target.files[0])}
            className="rounded-lg border border-line bg-panel2 px-3 py-2 text-sm text-muted file:mr-3 file:rounded-md file:border-0 file:bg-panel2 file:px-3 file:py-1.5 file:text-sm file:text-ink"
          />
          <Button variant="ghost" onClick={generateSynthetic}>
            Generate synthetic (180 min)
          </Button>
        </div>
      </Panel>

      <Panel title="Judge scoring">
        <div className="grid gap-3 sm:grid-cols-4">
          <Input
            label="Team ID"
            mono
            value={score.team_id}
            onChange={(e) => setScore({ ...score, team_id: e.target.value })}
          />
          <Input
            label="Code quality (0–100)"
            mono
            value={score.code}
            onChange={(e) => setScore({ ...score, code: e.target.value })}
          />
          <Input
            label="Report (0–100)"
            mono
            value={score.report}
            onChange={(e) => setScore({ ...score, report: e.target.value })}
          />
          <div className="flex items-end gap-2">
            <Button
              onClick={() =>
                admin("/api/admin/scoring", {
                  team_id: Number(score.team_id),
                  code_quality: Number(score.code),
                  strategy_report: Number(score.report),
                })
              }
            >
              Save
            </Button>
            <Button variant="accent" onClick={() => admin("/api/admin/scoring/compute", {})}>
              Compute
            </Button>
          </div>
        </div>
      </Panel>

      {metrics && (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatTile label="Requests" value={fmt(metrics.latency.requests, 0)} />
            <StatTile label="Avg latency" value={`${fmt(metrics.latency.avg_latency_ms, 0)}ms`} />
            <StatTile
              label="P95 / P99"
              value={`${(metrics.latency.p95_ms ?? 0).toFixed(1)} / ${(metrics.latency.p99_ms ?? 0).toFixed(1)}`}
              sub="ms"
            />
            <StatTile
              label="Errors"
              value={fmt(metrics.latency.errors, 0)}
              tone={Number(metrics.latency.errors) > 0 ? "down" : "up"}
            />
          </div>

          <Panel title="Teams & fills" right={<Badge color="#2dd4bf">{metrics.teams.length} accounts</Badge>} pad={false}>
            <TableWrap>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line bg-panel2/50">
                    <Th>Team</Th>
                    <Th right>Portfolio</Th>
                    <Th right>Filled</Th>
                    <Th right>Rejected</Th>
                    <Th right>Avg trade (ms)</Th>
                    <Th right>API key</Th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.teams.map((t) => {
                    const f = metrics.fills.find((x) => x.team_id === t.team_id);
                    return (
                      <tr key={t.team_id} className="border-b border-line/50 last:border-0">
                        <Td mono={false}>
                          <span className="font-medium text-ink">{t.team_name}</span>
                          <span className="ml-1.5 text-dim">{t.role}</span>
                          {t.is_frozen && <Badge color="#f0514c">frozen</Badge>}
                        </Td>
                        <Td right>{fmtInr(t.total_portfolio_value)}</Td>
                        <Td right>{f?.filled ?? "0"}</Td>
                        <Td right>{f?.rejected ?? "0"}</Td>
                        <Td right>{f?.avg_trade_ms != null ? `${f.avg_trade_ms}ms` : "—"}</Td>
                        <Td right>
                          <code className="text-[11px] text-buy">{t.api_key ?? "—"}</code>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          </Panel>

          <Panel title="Live prices" pad={false}>
            <TableWrap>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line bg-panel2/50">
                    <Th>Symbol</Th>
                    <Th right>Price</Th>
                    <Th right>Prev</Th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.live.map((l) => (
                    <tr key={l.symbol} className="border-b border-line/50 last:border-0">
                      <Td mono={false}>
                        <span className="font-mono font-bold text-ink">{l.symbol}</span>
                      </Td>
                      <Td right>{fmt(l.price)}</Td>
                      <Td right muted>{fmt(l.prev_price)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Panel>
        </>
      )}
    </div>
  );
}
