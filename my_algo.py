#!/usr/bin/env python3
"""my_algo.py — hybrid trend + mean-reversion trader for the Mercatus Arena engine.

Market model (server/src/engine.ts):
    live_price = base_price * (1 + gaussian() * sigma) * (1 + flash)
  - base_price follows the pre-generated dataset walk (drift ~ +0.002%/tick)
  - sigma = noise_sigma * volatility_multiplier; fresh IID gaussian EVERY tick,
    so the live price mean-reverts around the slowly-moving base
  - flash_shock decays 0.8/tick after an admin flash crash

Strategy (two complementary edges):
  CORE (momentum): once a symbol's EMA slope is confirmed up for N polls, buy
    and HOLD until the trend turns or a hard stop trips. Rides the drift.
  SCALP (mean reversion): when the trend is not confirmed, buy noise dips
    below -entry_z*sigma and sell pops above +exit_z*sigma / on stop / after
    --maxhold seconds, keeping base-walk exposure short.
  Flash dips (>1.5% in one poll) or very deep residuals (-3 sigma) are bought
  as reversion plays regardless of trend state.

No fees, no slippage; market orders fill at the live price. One open position
per symbol (either core or scalp). Rate limit is ~60 trades/min (--spacing).

Env:
  API_BASE       default http://localhost:8080
  API_KEY        revealed team API key (required unless --dry)
  TEAM_EMAIL     portal email (optional, enables cash/position reconciliation)
  TEAM_PASSWORD  portal password

Examples:
  API_KEY=sk_... TEAM_EMAIL=algobot@test.dev TEAM_PASSWORD=password123 \
  python3 my_algo.py --symbols AAPL,TSLA,AMD --minutes 5 --poll 1 --risk 0.35

  API_KEY=sk_... python3 my_algo.py --dry --symbols NVDA --poll 1
"""

import argparse
import json
import math
import os
import time
import urllib.error
import urllib.request
from collections import deque

API_BASE = os.environ.get("API_BASE", "http://localhost:8080").rstrip("/")
API_KEY = os.environ.get("API_KEY")
TEAM_EMAIL = os.environ.get("TEAM_EMAIL")
TEAM_PASSWORD = os.environ.get("TEAM_PASSWORD")

portal_token = None


# ---------- HTTP helpers ----------

def http(method, path, body=None, headers=None):
    req = urllib.request.Request(API_BASE + path, method=method)
    req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    if API_KEY:
        req.add_header("x-api-key", API_KEY)
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data=data, timeout=15) as resp:
            return resp.status, json.load(resp)
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.load(e)
        except Exception:
            return e.code, {}
    except Exception as e:
        return 0, {"error": type(e).__name__}


def snapshot():
    status, body = http("GET", "/api/market/snapshot")
    if status == 200 and isinstance(body, dict):
        return body.get("prices", {})
    raise RuntimeError(body.get("error", f"HTTP {status}"))


def market_status():
    status, body = http("GET", "/api/market/status")
    if status == 200 and isinstance(body, dict):
        return body
    raise RuntimeError(body.get("error", f"HTTP {status}"))


def portfolio():
    global portal_token
    if not portal_token:
        status, body = http(
            "POST", "/api/auth/login",
            {"email": TEAM_EMAIL, "password": TEAM_PASSWORD},
        )
        if status != 200:
            raise RuntimeError(f"login failed: {body.get('error')}")
        portal_token = body["token"]
    status, body = http(
        "GET", "/api/team/portfolio",
        headers={"Authorization": f"Bearer {portal_token}"},
    )
    if status != 200:
        raise RuntimeError(f"portfolio failed: {body.get('error')}")
    return body


def place_order(action, symbol, qty):
    status, body = http(
        "POST", f"/api/trade/{action.lower()}",
        {"symbol": symbol, "quantity": int(qty)},
    )
    if body.get("status") == "SUCCESS":
        return body.get("priceExecuted"), body.get("cashAfter"), body.get("latencyMs")
    reason = body.get("reason") or body.get("error") or f"HTTP {status}"
    raise RuntimeError(reason)


# ---------- indicators ----------

class Indicator:
    def __init__(self, alpha, window=40):
        self.alpha = alpha
        self.window = window
        self.resid = deque(maxlen=window)
        self.ema = None
        self.ema_prev = None
        self.last_px = None

    def update(self, px):
        if self.ema is None:
            self.ema = px
            self.ema_prev = px
        else:
            self.ema_prev = self.ema
            self.ema = self.alpha * px + (1 - self.alpha) * self.ema
        self.last_px = px
        r = px / self.ema - 1
        self.resid.append(r)
        return r

    def sigma(self):
        n = len(self.resid)
        if n < 5:
            return 0.002
        m = sum(self.resid) / n
        var = sum((x - m) ** 2 for x in self.resid) / (n - 1)
        return max(math.sqrt(var), 1e-5)


# ---------- main loop ----------

def main():
    ap = argparse.ArgumentParser(description="Hybrid trend + reversion trader for Mercatus Arena")
    ap.add_argument("--symbols", default="AAPL,TSLA,AMD", help="comma-separated symbols")
    ap.add_argument("--minutes", type=float, default=5)
    ap.add_argument("--poll", type=float, default=1.0, help="seconds between polls")
    ap.add_argument("--alpha", type=float, default=0.4, help="EMA smoothing for the base estimate")
    ap.add_argument("--entry-z", type=float, default=1.0, help="dip threshold (x sigma) to scalp-buy")
    ap.add_argument("--exit-z", type=float, default=0.6, help="pop threshold (x sigma) to scalp-sell")
    ap.add_argument("--stop-z", type=float, default=2.2, help="stop-loss (x sigma) for any position")
    ap.add_argument("--risk", type=float, default=0.35, help="fraction of cash per position")
    ap.add_argument("--max-exposure", type=float, default=0.75, help="max fraction of value in positions")
    ap.add_argument("--maxhold", type=float, default=15.0, help="force-exit a scalp after this many secs")
    ap.add_argument("--trend-up", type=float, default=0.002, help="EMA slope per poll that confirms an uptrend")
    ap.add_argument("--trend-confirm", type=int, default=3, help="consecutive polls of slope to confirm a trend")
    ap.add_argument("--spacing", type=float, default=1.1, help="min seconds between orders (rate limit ~60/min)")
    ap.add_argument("--capital", type=float, default=10_000_000, help="local cash fallback")
    ap.add_argument("--dry", action="store_true", help="print signals, never trade")
    args = ap.parse_args()

    if not API_KEY and not args.dry:
        ap.error("API_KEY env var is required (or use --dry)")

    symbols = [s.strip().upper() for s in args.symbols.split(",") if s.strip()]
    inds = {s: Indicator(args.alpha) for s in symbols}

    cash = args.capital
    pos = {s: 0.0 for s in symbols}
    avg_price = {s: 0.0 for s in symbols}
    held_since = {s: None for s in symbols}
    mode = {s: None for s in symbols}
    up_count = {s: 0 for s in symbols}
    down_count = {s: 0 for s in symbols}
    total_value = cash
    starting = args.capital

    last_trade = 0.0
    deadline = time.monotonic() + args.minutes * 60
    poll_i = 0
    warm = {s: 0 for s in symbols}

    print(f"=== trader {','.join(symbols)} poll={args.poll}s trend=+{args.trend_up:.3f}/poll "
          f"z={args.entry_z}/{args.exit_z} risk={args.risk:.0%} exp={args.max_exposure:.0%} "
          f"base={API_BASE} ===")
    if args.dry:
        print("DRY RUN — no orders will be placed")
    try:
        st = market_status()
        print(f"state={st.get('state')} replay={st.get('replaySpeed')}x vol={st.get('volatility')}x")
        if st.get("state") != "ACTIVE_MARKET":
            print(f"[abort] market is {st.get('state')}, nothing to do")
            return
    except Exception as e:
        print(f"[warn] cannot reach status: {e}")

    while time.monotonic() < deadline:
        try:
            prices = snapshot()
        except Exception as e:
            print(f"[warn] no feed: {e}")
            time.sleep(2)
            continue

        resid = {}
        changed = {}
        for s in symbols:
            px = prices.get(s)
            if px is None:
                continue
            changed[s] = inds[s].last_px is None or px != inds[s].last_px
            resid[s] = inds[s].update(px)
            warm[s] += 1

        now = time.monotonic()
        actions = []
        for s in symbols:
            if s not in resid:
                continue
            px = prices[s]
            r = resid[s]
            sig = inds[s].sigma()
            if inds[s].ema_prev:
                slope = (inds[s].ema - inds[s].ema_prev) / inds[s].ema_prev
                if slope >= args.trend_up * 0.4:
                    up_count[s] += 1
                    down_count[s] = 0
                elif slope <= -args.trend_up * 0.4:
                    down_count[s] += 1
                    up_count[s] = 0
                else:
                    up_count[s] = max(0, up_count[s] - 1)
                    down_count[s] = max(0, down_count[s] - 1)
            trend_up = up_count[s] >= args.trend_confirm
            trend_down = down_count[s] >= args.trend_confirm

            # exits first
            if pos[s] > 0:
                held = now - held_since[s] if held_since[s] else 0
                if mode[s] == "dump":
                    actions.append((s, "SELL", pos[s], "sync"))
                elif mode[s] == "core":
                    if trend_down or r <= -args.stop_z * sig:
                        actions.append((s, "SELL", pos[s], f"trend-break/stop r={r / sig:+.1f}s"))
                else:  # scalp
                    if r >= args.exit_z * sig or r <= -args.stop_z * sig or held >= args.maxhold:
                        actions.append((s, "SELL", pos[s], f"r={r / sig:+.1f}s"))
                continue

            # entries (one position per symbol)
            if not changed[s] or warm[s] < 6:
                continue
            flash = px < inds[s].last_px * 0.985 if inds[s].last_px else False
            deep_dip = r <= -3 * sig
            if trend_up and r < 0.5 * sig:
                actions.append((s, "BUY", "core", f"trend-up r={r / sig:+.1f}s"))
            elif r <= -args.entry_z * sig or flash or deep_dip:
                actions.append((s, "BUY", "scalp", f"r={r / sig:+.1f}s"))

        invested = sum(pos[s] * prices.get(s, 0) for s in symbols)
        total_value = cash + invested

        # execute actions respecting pacing
        for s, action, kind, why in actions:
            if not args.dry and now - last_trade < args.spacing:
                continue
            px = prices[s]
            if action == "BUY":
                notional = cash * args.risk
                if invested + notional > args.max_exposure * total_value:
                    notional = max(0.0, args.max_exposure * total_value - invested)
                if notional < px or cash < notional:
                    continue
                qty = int(notional / px)
                if qty < 1:
                    continue
                if args.dry:
                    print(f"[signal] BUY  {s} x{qty} ({kind}: {why}) @ {px:.2f}")
                    last_trade = now
                    continue
                try:
                    filled, cash, lat = place_order("BUY", s, qty)
                    pos[s] += qty
                    avg_price[s] = (avg_price[s] * (pos[s] - qty) + filled * qty) / max(pos[s], 1)
                    held_since[s] = now
                    mode[s] = kind
                    last_trade = now
                    print(f"[{time.strftime('%H:%M:%S')}] BUY  {s} x{qty} ({kind}: {why}) "
                          f"@ {filled:.2f} cash={cash:,.0f} lat={lat}ms")
                except RuntimeError as e:
                    print(f"  -> BUY  {s} REJECTED: {e}")
            else:
                if args.dry:
                    print(f"[signal] SELL {s} x{int(pos[s])} ({why}) @ {px:.2f}")
                    last_trade = now
                    continue
                try:
                    filled, cash, lat = place_order("SELL", s, int(pos[s]))
                    pnl = (filled - avg_price[s]) * pos[s]
                    pos[s] = 0
                    avg_price[s] = 0.0
                    held_since[s] = None
                    mode[s] = None
                    last_trade = now
                    print(f"[{time.strftime('%H:%M:%S')}] SELL {s} ({why}) @ {filled:.2f} "
                          f"pnl={pnl:+,.0f} cash={cash:,.0f} lat={lat}ms")
                except RuntimeError as e:
                    print(f"  -> SELL {s} REJECTED: {e}")

        # reconcile with the portal every ~20 polls if credentials given
        poll_i += 1
        if TEAM_EMAIL and TEAM_PASSWORD and poll_i % 20 == 0:
            try:
                pf = portfolio()
                cash = float(pf.get("cash_balance") or cash)
                total_value = float(pf.get("total_portfolio_value") or total_value)
                starting = float(pf.get("starting_capital") or starting)
                hmap = {h["symbol"]: float(h["quantity"]) for h in pf.get("positions", pf.get("holdings", []))}
                for s in symbols:
                    db = hmap.get(s, 0.0)
                    if pos[s] != db:
                        if pos[s] == 0 and db > 0:
                            pos[s] = db
                            held_since[s] = now
                            mode[s] = "dump"  # unknown leftover -> sell on next exit check
                            print(f"[sync] adopted leftover {s} x{int(db)} from portfolio")
                        elif pos[s] > 0 and db == 0:
                            pos[s] = db
                            mode[s] = None
                            print(f"[sync] portfolio shows {s} flat; local pos={int(pos[s])}")
                        else:
                            pos[s] = db
                            print(f"[sync] corrected {s} local={int(db)}")
            except Exception as e:
                print(f"[warn] reconcile failed: {e}")

        status_parts = []
        for s in symbols:
            if s not in resid:
                continue
            r = resid[s] / inds[s].sigma()
            m = mode[s][0].upper() if mode[s] else "-"
            status_parts.append(f"{s} {m} r={r:+.1f}s x{int(pos[s]):,}")
        print(f"[{time.strftime('%H:%M:%S')}] {' '.join(status_parts)}  "
              f"cash={cash:,.0f} value={total_value:,.0f} pnl={total_value - starting:+,.0f}")
        time.sleep(args.poll)

    # liquidate everything at the end
    if not args.dry:
        try:
            prices = snapshot()
        except Exception:
            prices = {}
        for s in symbols:
            if pos[s] > 0:
                try:
                    filled, cash, lat = place_order("SELL", s, int(pos[s]))
                    print(f"[end] liquidated {s} x{int(pos[s])} @ {filled:.2f} cash={cash:,.0f}")
                    pos[s] = 0
                except RuntimeError as e:
                    print(f"[end] liquidate {s} failed: {e}")
        invested = sum(pos[s] * prices.get(s, 0) for s in symbols)
        print(f"[end] cash={cash:,.0f} value={cash + invested:,.0f} pnl={cash + invested - starting:+,.0f}")


if __name__ == "__main__":
    main()
