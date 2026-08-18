"use client";

import { useEffect, useState } from "react";
import { api, getToken } from "@/lib/api";
import { Panel, Badge, Th, Td, TableWrap } from "@/components/ui";

interface Me {
  api_key: string | null;
  credentials_revealed: boolean;
}

const REST = [
  ["GET", "/api/market/status", "Event state, symbols, prices, timings"],
  ["GET", "/api/market/snapshot", "Current price snapshot for all symbols"],
  ["GET", "/api/market/leaderboard", "Live rankings (frozen at blackout)"],
  ["POST", "/api/trade/buy", "Place a market or limit BUY"],
  ["POST", "/api/trade/sell", "Place a market or limit SELL"],
  ["GET", "/api/team/portfolio", "Cash, positions, live prices"],
  ["GET", "/api/team/trades", "Your order history with latency_ms"],
  ["GET", "/api/team/submission", "Your code / report submission state"],
];

const AUTH = `# Every trading request authenticates with your API key
curl -X POST {BASE}/api/trade/buy \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: sk_your_key_here" \\
  -d '{"symbol":"AAPL","side":"buy","type":"market","quantity":10}'

# Portfolio (portal session)
curl {BASE}/api/team/portfolio \\
  -H "Authorization: Bearer {jwt_token}"`;

export default function ApiPage() {
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    const t = getToken();
    if (!t) return;
    api<Me>("/api/auth/me", { token: t }).then(setMe).catch(() => {});
  }, []);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink">API Reference</h1>
        <p className="mt-1 text-sm text-muted">
          REST + WebSocket feed with per-request millisecond telemetry.
        </p>
      </header>

      <Panel
        title="Your API key"
        right={<Badge color={me?.credentials_revealed ? "#2ecc71" : "#f0b90b"}>
          {me?.credentials_revealed ? "revealed" : "masked"}
        </Badge>}
      >
        {me?.api_key ? (
          <code className="num block border border-line bg-panel2 px-3 py-2 text-[13px] text-acc">
            {me.api_key}
          </code>
        ) : (
          <p className="text-[13px] text-muted">
            Your key is generated at registration but stays{" "}
            <span className="text-gold">masked</span> until the admin reveals it at launch.
            Sign in to view it here.
          </p>
        )}
      </Panel>

      <Panel title="Endpoints" pad={false}>
        <TableWrap>
          <table className="w-full">
            <thead>
              <tr className="border-b border-line bg-panel2/50">
                <Th>Method</Th>
                <Th>Path</Th>
                <Th>Purpose</Th>
              </tr>
            </thead>
            <tbody>
              {REST.map(([m, p, d]) => (
                <tr key={p} className="border-b border-line/50 last:border-0">
                  <Td>
                    <span
                      className={`px-1.5 py-0.5 text-[11px] font-bold ${
                        m === "GET" ? "bg-acc/15 text-acc" : "bg-gold/15 text-gold"
                      }`}
                    >
                      {m}
                    </span>
                  </Td>
                  <Td mono>
                    <code className="text-[12px] text-ink">{p}</code>
                  </Td>
                  <Td muted mono={false}>{d}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Panel>

      <Panel title="Authentication">
        <ul className="space-y-2 text-[13px] text-muted">
          <li>
            <b className="text-ink">Portal (JWT):</b> sign in through the web app; pass{" "}
            <code className="text-acc">Authorization: Bearer &lt;jwt&gt;</code>.
          </li>
          <li>
            <b className="text-ink">Trading (API key):</b> your bot authenticates orders with{" "}
            <code className="text-acc">x-api-key: sk_…</code>. The key is only visible after the
            admin reveals credentials.
          </li>
        </ul>
      </Panel>

      <Panel title="WebSocket">
        <p className="mb-3 text-[13px] leading-relaxed text-muted">
          Connect to <code className="text-acc">/ws</code> to stream live ticks (every second) and
          your order confirmations. Authenticate with your JWT either via the{" "}
          <code className="text-acc">Authorization: Bearer &lt;jwt&gt;</code> header (non-browser
          clients) or a <code className="text-acc">mercatus.&lt;jwt&gt;</code> subprotocol (browsers).
          The JWT is never placed in the URL.
        </p>
        <pre className="overflow-x-auto border border-line bg-panel2 p-3 text-[12px] leading-relaxed text-muted">
{`// Browser (JWT via subprotocol)
new WebSocket("wss://{BASE}/ws", ["mercatus." + jwt])

// Non-browser (JWT via header)
new WebSocket("wss://{BASE}/ws", { headers: { Authorization: "Bearer " + jwt } })

// → {"type":"tick","prices":[{"symbol":"AAPL","price":104.12,"prev":104.02}]}
// → {"type":"order","orderId":5,"status":"SUCCESS","action":"BUY",
//     "symbol":"AAPL","quantity":10,"priceExecuted":104.12,"latencyMs":6}`}
        </pre>
      </Panel>

      <Panel title="Example">
        <pre className="overflow-x-auto border border-line bg-panel2 p-3 text-[12px] leading-relaxed text-muted">
          {AUTH}
        </pre>
      </Panel>
    </div>
  );
}
