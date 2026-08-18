#!/usr/bin/env python3
"""Mercatus Arena demo bot.

A simple momentum-free test strategy: buys a fixed basket at market on start,
holds while printing live PnL, then liquidates. Exercises POST /api/trade/* with
x-api-key and GET /api/team/* for feedback.

Usage:
    API_KEY=sk_... python3 algo_bot.py [--hold N]
Env:
    API_BASE  default http://localhost:8080
"""

import argparse
import json
import os
import time
import urllib.request

API_BASE = os.environ.get("API_BASE", "http://localhost:8080").rstrip("/")
API_KEY = os.environ["API_KEY"]
TEAM_EMAIL = os.environ.get("TEAM_EMAIL")
TEAM_PASSWORD = os.environ.get("TEAM_PASSWORD")

BASKET = ["AAPL", "MSFT", "NVDA", "TSLA", "JPM", "AMZN"]
BUDGET_PER_SYMBOL = 1_200_000

PORTAL_TOKEN = None


def http(method, path, body=None, api_key=False, portal=False):
    req = urllib.request.Request(API_BASE + path, method=method)
    req.add_header("Content-Type", "application/json")
    if api_key:
        req.add_header("x-api-key", API_KEY)
    if portal:
        req.add_header("Authorization", f"Bearer {PORTAL_TOKEN}")
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data=data, timeout=10) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as e:
        try:
            return json.load(e)
        except Exception:
            return {"status": "REJECTED", "reason": f"HTTP {e.code}", "orderId": None}


def login():
    global PORTAL_TOKEN
    res = http("POST", "/api/auth/login",
               {"email": TEAM_EMAIL, "password": TEAM_PASSWORD})
    PORTAL_TOKEN = res["token"]


def snapshot():
    return http("GET", "/api/market/snapshot")


def buy(symbol, qty):
    return http("POST", "/api/trade/buy",
                {"symbol": symbol, "quantity": qty, "client_ref": "demo-buy"}, api_key=True)


def sell(symbol, qty):
    return http("POST", "/api/trade/sell",
                {"symbol": symbol, "quantity": qty, "client_ref": "demo-sell"}, api_key=True)


def portfolio():
    return http("GET", "/api/team/portfolio", portal=True)


def fmt(order, symbol):
    price = order.get("priceExecuted")
    px = f"@{price:.2f}" if isinstance(price, (int, float)) else "market"
    return (f"order_id={order.get('orderId')} {symbol} {order.get('status'):8s} "
            f"{px} qty={order.get('quantity')} cash_after={order.get('cashAfter'):,.0f} "
            f"latency={order.get('latencyMs')}ms reason={order.get('reason')}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hold", type=int, default=30,
                    help="iterations to hold before liquidating (1 per ~2s)")
    ap.add_argument("--dry", action="store_true", help="poll only, no orders")
    args = ap.parse_args()

    print(f"=== Mercatus demo bot starting (base={API_BASE}) ===", flush=True)
    print(f"basket={BASKET} budget/symbol={BUDGET_PER_SYMBOL}", flush=True)
    if TEAM_EMAIL and TEAM_PASSWORD:
        login()
        print("portal session ready for portfolio reads", flush=True)

    prices = {}
    while not prices:
        try:
            prices = snapshot()["prices"]
        except Exception as e:
            print(f"waiting for live feed: {e}", flush=True)
            time.sleep(2)
    print("live feed acquired", flush=True)

    if not args.dry:
        existing = {p["symbol"]: int(p["quantity"]) for p in portfolio().get("positions", [])}
        for sym in BASKET:
            target = max(1, int(BUDGET_PER_SYMBOL // prices[sym]))
            qty = target - existing.get(sym, 0)
            if qty <= 0:
                print(f"SKIP {sym}: already holding {existing.get(sym, 0)} (target {target})", flush=True)
                continue
            res = buy(sym, qty)
            print("BUY ", fmt(res, sym), flush=True)
            time.sleep(0.5)

    for i in range(args.hold):
        time.sleep(2)
        try:
            pf = portfolio()
        except Exception as e:
            print(f"portfolio error: {e}", flush=True)
            continue
        cash = float(pf.get("cash_balance") or 0)
        value = float(pf.get("total_portfolio_value") or 0)
        start = float(pf.get("starting_capital") or 0)
        print(
            f"[hold {i + 1}/{args.hold}] cash={cash:,.2f} "
            f"value={value:,.2f} pnl={value - start:+,.2f}",
            flush=True,
        )

    if not args.dry:
        try:
            positions = portfolio().get("positions", [])
        except Exception:
            positions = []
        for p in positions:
            qty = int(p.get("quantity", 0))
            if qty and qty > 0:
                res = sell(p["symbol"], qty)
                print("SELL", fmt(res, p["symbol"]), flush=True)
                time.sleep(0.5)

    pf = portfolio()
    value = float(pf.get("total_portfolio_value") or 0)
    start = float(pf.get("starting_capital") or 0)
    print(f"=== done: value={value:,.2f} pnl={value - start:+,.2f} ===", flush=True)


if __name__ == "__main__":
    main()
