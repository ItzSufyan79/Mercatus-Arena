import { config } from "../src/config.js";

const BASE = process.env.API_BASE ?? `http://localhost:${config.port}`;
const API_KEY = process.env.API_KEY ?? "sk_TEST";
const DURATION_MS = Number(process.env.DURATION_MS ?? 30_000);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 50);
const SYMBOLS = ["AAPL", "MSFT", "GOOG", "TSLA", "NVDA"];

const start = Date.now();
let sent = 0;
let ok = 0;
let rejected = 0;
let errors = 0;
let latencySum = 0;
let latencyCount = 0;

async function one() {
  if (Date.now() - start > DURATION_MS) return;
  const symbol = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
  const quantity = 1 + Math.floor(Math.random() * 50);
  const action = Math.random() < 0.6 ? "buy" : "sell";
  const t0 = performance.now();
  try {
    const res = await fetch(`${BASE}/api/trade/${action}`, {
      method: "POST",
      headers: {
        "x-api-key": API_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify({ symbol, quantity }),
    });
    latencySum += performance.now() - t0;
    latencyCount++;
    if (res.ok) ok++;
    else if (res.status === 422) rejected++;
    else errors++;
  } catch {
    errors++;
  } finally {
    sent++;
  }
}

async function run() {
  while (Date.now() - start < DURATION_MS) {
    await Promise.all(
      Array.from({ length: CONCURRENCY }, () => one().catch(() => {})),
    );
  }
  await new Promise((r) => setTimeout(r, 2000));
  const elapsed = (Date.now() - start) / 1000;
  console.log({
    elapsedSec: Math.round(elapsed),
    sent,
    ok,
    rejected,
    errors,
    rps: Math.round(sent / elapsed),
    avgLatencyMs: latencyCount ? Math.round((latencySum / latencyCount) * 10) / 10 : null,
  });
}

void run();
