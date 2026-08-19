export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8080";
export const WS_URL =
  process.env.NEXT_PUBLIC_WS_URL ??
  API_BASE.replace(/^http/, "ws") + "/ws";

export interface ApiError {
  error: string;
  detail?: string;
}

export async function api<T = unknown>(
  path: string,
  opts: {
    method?: string;
    body?: unknown;
    token?: string;
    apiKey?: string;
    form?: FormData;
  } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.apiKey) headers["x-api-key"] = opts.apiKey;
  if (opts.body !== undefined && !opts.form) {
    headers["content-type"] = "application/json";
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    cache: "no-store",
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw Object.assign(new Error(data?.error ?? `HTTP ${res.status}`), data);
  }
  return data as T;
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("mercatus_token");
}

export function setToken(token: string) {
  localStorage.setItem("mercatus_token", token);
}

export function clearToken() {
  localStorage.removeItem("mercatus_token");
}

export interface LiveTick {
  symbol: string;
  price: number;
  prev: number;
}

export interface OrderEvent {
  type: "order";
  orderId: number;
  status: "SUCCESS" | "REJECTED";
  reason: string | null;
  action: "BUY" | "SELL";
  symbol: string;
  quantity: number;
  priceExecuted: number | null;
  cashAfter: number;
  latencyMs: number;
}

export interface STATUS {
  state: string;
  paused: boolean;
  credentialsRevealed: boolean;
  leaderboardFrozen: boolean;
  tickCount: number;
  startCapital: number;
  replaySpeed: number;
  volatility: number;
  symbols: string[];
  prices: Record<string, number>;
  datasetName: string | null;
  eventStartedAt: string | null;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  apiFreezeAt: string | null;
  leaderboardFreezeAt: string | null;
}

export type PricesMap = Record<string, number>;

const MAX_HISTORY = 600;

export interface Tick {
  t: number;
  p: number;
}

export class LiveFeed {
  private ws: WebSocket | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<(prices: PricesMap) => void>();
  private orderListeners = new Set<(order: OrderEvent) => void>();
  private last: PricesMap = {};
  private history: Record<string, Tick[]> = {};

  subscribe(fn: (prices: PricesMap) => void): () => void {
    this.listeners.add(fn);
    fn({ ...this.last });
    this.ensureConnected();
    return () => {
      this.listeners.delete(fn);
      if (this.listeners.size === 0) this.disconnect();
    };
  }

  onOrder(fn: (order: OrderEvent) => void): () => void {
    this.orderListeners.add(fn);
    this.ensureConnected();
    return () => this.orderListeners.delete(fn);
  }

  historyOf(symbol: string): number[] {
    return this.history[symbol]?.map((h) => h.p) ?? [];
  }

  ticksOf(symbol: string): Tick[] {
    return this.history[symbol] ?? [];
  }

  seed(symbols: string[], prices: PricesMap) {
    for (const s of symbols) {
      const p = prices[s];
      if (typeof p === "number" && !(this.history[s]?.length)) {
        this.pushPrice(s, p);
      }
    }
  }

  private pushPrice(symbol: string, price: number) {
    const arr = (this.history[symbol] ??= []);
    const now = Date.now();
    const last = arr[arr.length - 1];
    if (!last || last.p !== price) {
      arr.push({ t: now, p: price });
      if (arr.length > MAX_HISTORY) arr.shift();
    } else {
      last.t = now;
    }
  }

  private emit() {
    for (const fn of this.listeners) fn({ ...this.last });
  }

  private connect() {
    const token =
      typeof window !== "undefined" ? localStorage.getItem("mercatus_token") : null;
    try {
      const protocols = token ? [`mercatus.${token}`] : [];
      const ws = new WebSocket(WS_URL, protocols);
      this.ws = ws;
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === "tick" && Array.isArray(msg.prices)) {
            for (const t of msg.prices as LiveTick[]) {
              if (typeof t.price === "number") {
                this.last[t.symbol] = t.price;
                this.pushPrice(t.symbol, t.price);
              }
            }
            this.emit();
          }
          if (msg.type === "hello" && msg.payload?.prices) {
            this.last = { ...msg.payload.prices, ...this.last };
            for (const [s, p] of Object.entries(this.last)) {
              this.pushPrice(s, Number(p));
            }
            this.emit();
          }
          if (msg.type === "order") {
            for (const fn of this.orderListeners) fn(msg as OrderEvent);
          }
        } catch {}
      };
      ws.onclose = () => {
        this.ws = null;
        if (this.listeners.size > 0 || this.orderListeners.size > 0) {
          this.reconnectTimer = setTimeout(() => this.connect(), 1500);
          this.startPolling();
        }
      };
      ws.onerror = () => ws.close();
    } catch {
      this.startPolling();
    }
  }

  private ensureConnected() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    this.connect();
  }

  private startPolling() {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(async () => {
      try {
        const snap = await api<{ prices: PricesMap }>("/api/market/snapshot");
        this.last = { ...snap.prices };
        for (const [s, p] of Object.entries(this.last)) this.pushPrice(s, Number(p));
        this.emit();
      } catch {}
    }, 1000);
  }

  private disconnect() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.ws?.close();
    this.ws = null;
  }
}

export const liveFeed = new LiveFeed();

export const STATE_LABEL: Record<string, string> = {
  PRE_LAUNCH: "PRE-LAUNCH",
  ACTIVE_MARKET: "MARKET OPEN",
  API_FROZEN: "API FROZEN",
  EVENT_CONCLUDED: "CONCLUDED",
};

export const fmt = (n: number | string | null | undefined, d = 2): string => {
  if (n === null || n === undefined) return "—";
  return Number(n).toLocaleString("en-US", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
};

export const fmtUsd = (n: number | string | null | undefined, d = 2): string => {
  if (n === null || n === undefined) return "—";
  return Number(n).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
};

export const fmtInr = (n: number | string | null | undefined, d = 2): string => {
  if (n === null || n === undefined) return "—";
  return Number(n).toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
};

export async function setSchedule(startAt: string, endAt: string) {
  return api<{ ok: boolean; scheduledStartAt: string; scheduledEndAt: string }>(
    "/api/admin/schedule",
    { method: "POST", body: { start_at: startAt, end_at: endAt } },
  );
}

export async function clearSchedule() {
  return api<{ ok: boolean }>("/api/admin/schedule", { method: "DELETE" });
}
