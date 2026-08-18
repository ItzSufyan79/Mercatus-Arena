"use client";

import { useEffect, useRef, useState } from "react";
import { api, getToken, liveFeed, OrderEvent, fmt } from "@/lib/api";
import { Badge, Button, Input, Panel } from "./ui";

interface Trade {
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

type Row = Trade;

export function TradeLog() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [pushed, setPushed] = useState<OrderEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const newestId = useRef(0);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    let alive = true;
    const load = () =>
      api<{ trades: Trade[] }>("/api/team/trades?limit=100", { token })
        .then((d) => {
          if (!alive) return;
          setTrades(d.trades);
          if (d.trades.length) newestId.current = Math.max(...d.trades.map((t) => t.order_id));
        })
        .catch(() => {})
        .finally(() => alive && setLoading(false));
    void load();
    const t = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    const un = liveFeed.onOrder((o) => {
      if (o.orderId > newestId.current) {
        newestId.current = o.orderId;
        setPushed((p) => [o, ...p].slice(0, 50));
      }
    });
    return un;
  }, []);

  const rows: Row[] = [
    ...pushed.map((p) => ({
      order_id: p.orderId,
      action: p.action,
      symbol: p.symbol,
      quantity: p.quantity,
      price_requested: null,
      price_executed: p.priceExecuted != null ? String(p.priceExecuted) : null,
      status: p.status,
      reason: p.reason,
      latency_ms: p.latencyMs,
      timestamp_ms: "",
    })),
    ...trades,
  ];

  return (
    <Panel
      title="Executions"
      right={<Badge color="#2dd4bf">{rows.length} orders</Badge>}
      pad={false}
    >
      <div className="max-h-[420px] overflow-auto">
        <table className="w-full">
          <thead className="sticky top-0 z-10 bg-panel">
            <tr className="border-b border-line bg-panel2/50">
              <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-dim">#</th>
              <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-dim">Side</th>
              <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-dim">Sym</th>
              <th className="px-4 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-dim">Qty</th>
              <th className="px-4 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-dim">Exec</th>
              <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-dim">Status</th>
              <th className="px-4 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-dim">Lat</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.order_id} className="border-b border-line/50 last:border-0">
                <td className="num px-4 py-2 text-dim">{t.order_id}</td>
                <td className="px-4 py-2">
                  <span
                    className={`text-[11px] font-bold ${t.action === "BUY" ? "text-buy" : "text-sell"}`}
                  >
                    {t.action}
                  </span>
                </td>
                <td className="px-4 py-2 font-semibold text-ink">{t.symbol}</td>
                <td className="num px-4 py-2 text-right">{t.quantity}</td>
                <td className="num px-4 py-2 text-right">
                  {t.price_executed ? fmt(t.price_executed) : "—"}
                </td>
                <td className="px-4 py-2">
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
                    {t.reason && t.status === "REJECTED" ? (
                      <span className="text-dim"> · {t.reason}</span>
                    ) : null}
                  </span>
                </td>
                <td className="num px-4 py-2 text-right text-muted">
                  {t.latency_ms ?? "—"}
                  {t.latency_ms != null ? "ms" : ""}
                </td>
              </tr>
            ))}
            {rows.length === 0 && !loading && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-dim">
                  No executions yet — orders appear here in real time.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

export function SubmissionPanel() {
  const [link, setLink] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const token = getToken();
    if (!token || (!file && !link.trim())) return;
    setBusy(true);
    setStatus(null);
    try {
      const form = new FormData();
      if (file) form.append("pdf", file);
      if (link.trim()) form.append("code_link", link.trim());
      const r = await api<{ submitted: { updated_at: string } }>("/api/team/submission", {
        method: "POST",
        form,
        token,
      });
      setStatus(`Submitted · ${new Date(r.submitted.updated_at).toLocaleString()}`);
    } catch (e) {
      setStatus(`Failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Submissions" right={<Badge color="#f0b90b">report + code</Badge>}>
      <div className="space-y-3">
        <Input
          label="Code repository link"
          placeholder="https://github.com/your-team/repo"
          value={link}
          onChange={(e) => setLink(e.target.value)}
        />
        <div>
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-dim">
            Strategy report (PDF)
          </span>
          <input
            type="file"
            accept="application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="w-full rounded-lg border border-line bg-panel2 px-3 py-2 text-sm text-muted file:mr-3 file:rounded-md file:border-0 file:bg-panel2 file:px-3 file:py-1.5 file:text-sm file:text-ink"
          />
        </div>
        <Button disabled={busy || (!file && !link.trim())} onClick={submit} className="w-full">
          {busy ? "Uploading…" : "Submit for judging"}
        </Button>
        {status && <div className="num text-[12px] text-muted">{status}</div>}
      </div>
    </Panel>
  );
}
