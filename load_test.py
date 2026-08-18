#!/usr/bin/env python3
"""Concurrent traffic-management test: N bots trading against the live API.

Each bot acts as a distinct user (distinct X-Forwarded-For) with its own API key.
Normal bots stay inside per-user limits; `--rogue` bots deliberately exceed them
to prove rate limiting isolates offenders without hurting the rest.

Usage:
    python3 load_test.py --bots 100 --duration 120 --rogue 5
Env:
    API_BASE   default http://localhost:8080
    TEAMS_FILE default teams.json next to this script
"""

import argparse
import json
import os
import random
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

API_BASE = os.environ.get("API_BASE", "http://localhost:8080").rstrip("/")
HERE = os.path.dirname(os.path.abspath(__file__))
TEAMS_FILE = os.environ.get("TEAMS_FILE", os.path.join(HERE, "teams.json"))

SYMBOLS = None
LOCK = threading.Lock()
STATS = {
    "requests": 0,
    "by_endpoint": {},
    "status_codes": {},
    "orders": {"SUCCESS": 0, "REJECTED": 0, "RATE_LIMITED": 0},
    "order_reasons": {},
    "latencies": [],
    "timeouts": 0,
    "rogue": {"requests": 0, "rate_limited": 0},
}


def load_symbols():
    global SYMBOLS
    with urllib.request.urlopen(API_BASE + "/api/market/symbols", timeout=10) as r:
        SYMBOLS = json.load(r)["symbols"]


def http(method, path, body=None, headers=None):
    req = urllib.request.Request(API_BASE + path, method=method)
    req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    data = json.dumps(body).encode() if body is not None else None
    start = time.monotonic()
    try:
        with urllib.request.urlopen(req, data=data, timeout=15) as resp:
            return resp.status, json.load(resp), (time.monotonic() - start) * 1000
    except urllib.error.HTTPError as e:
        try:
            body_resp = json.load(e)
        except Exception:
            body_resp = {}
        return e.code, body_resp, (time.monotonic() - start) * 1000
    except Exception as e:
        return 0, {"status": "REJECTED", "reason": type(e).__name__}, \
            (time.monotonic() - start) * 1000


def record(endpoint, status, latency, is_rogue, order_body=None, order_ok=None, order_reason=None):
    with LOCK:
        STATS["requests"] += 1
        if status == 0:
            STATS["timeouts"] += 1
        ep = STATS["by_endpoint"].setdefault(endpoint, {"n": 0, "lat": []})
        ep["n"] += 1
        ep["lat"].append(latency)
        STATS["status_codes"][str(status)] = STATS["status_codes"].get(str(status), 0) + 1
        STATS["latencies"].append(latency)
        if is_rogue:
            STATS["rogue"]["requests"] += 1
            if status == 429:
                STATS["rogue"]["rate_limited"] += 1
        if order_body is not None:
            status_f = order_body.get("status")
            if status == 429:
                STATS["orders"]["RATE_LIMITED"] += 1
            elif status_f == "SUCCESS":
                STATS["orders"]["SUCCESS"] += 1
            elif status_f == "REJECTED":
                STATS["orders"]["REJECTED"] += 1
                reason = order_body.get("reason", "?")
                STATS["order_reasons"][reason] = STATS["order_reasons"].get(reason, 0) + 1


def pct(sorted_lat, p):
    if not sorted_lat:
        return 0.0
    return round(sorted_lat[min(len(sorted_lat) - 1, int(len(sorted_lat) * p))], 1)


def bot(team, is_rogue, run_until):
    team_id = int(team["team_id"])
    api_key = team["api_key"]
    email = team["email"]
    password = team["password"]
    xff = f"10.{1 + team_id // 250}.{team_id % 250}"

    headers = {"x-api-key": api_key, "X-Forwarded-For": xff}

    portal_token = None
    _, login_res, _ = http(
        "POST", "/api/auth/login",
        {"email": email, "password": password},
        {"X-Forwarded-For": xff},
    )
    if isinstance(login_res, dict) and login_res.get("token"):
        portal_token = login_res["token"]

    position = {}
    poll_i = 0
    trade_i = 0
    last_portfolio = 0
    while time.monotonic() < run_until:
        now = time.monotonic()
        if is_rogue:
            poll_gap = random.uniform(0.08, 0.15)
            trade_gap = random.uniform(0.4, 0.7)
        else:
            poll_gap = random.uniform(3.0, 7.0)
            trade_gap = random.uniform(6.0, 15.0)

        if now - poll_i >= poll_gap:
            status, body, lat = http("GET", "/api/market/snapshot", headers=headers)
            record("/api/market/snapshot", status, lat, is_rogue)
            poll_i = now

        if now - trade_i >= trade_gap:
            symbol = random.choice(SYMBOLS)
            action = random.choice(["buy", "sell"])
            if action == "sell" and position.get(symbol, 0) <= 0:
                action = "buy"
            qty = random.randint(25, 150)
            if action == "sell":
                qty = min(qty, position.get(symbol, 0))
            if qty <= 0:
                continue
            status, body, lat = http(
                "POST", f"/api/trade/{action}",
                {"symbol": symbol, "quantity": qty,
                 "client_ref": f"load-{team_id}-{int(now)}"},
                headers,
            )
            record(f"/api/trade/{action}", status, lat, is_rogue,
                   order_body=body, order_ok=(body or {}).get("status") == "SUCCESS",
                   order_reason=(body or {}).get("reason"))
            if (body or {}).get("status") == "SUCCESS":
                position[symbol] = position.get(symbol, 0) + (qty if action == "buy" else -qty)
            trade_i = now

        if portal_token and now - last_portfolio >= 25:
            status, body, lat = http(
                "GET", "/api/team/portfolio",
                headers={"Authorization": f"Bearer {portal_token}",
                         "X-Forwarded-For": xff},
            )
            record("/api/team/portfolio", status, lat, is_rogue)
            last_portfolio = now

        time.sleep(random.uniform(0.05, 0.3))


def report(duration):
    with LOCK:
        s = STATS
    print("\n================ TRAFFIC LOAD TEST SUMMARY ================")
    print(f"duration: {duration:.0f}s | total requests: {s['requests']} "
          f"({s['requests'] / max(duration, 0.1):.1f} req/s)")
    print(f"status codes: {s['status_codes']}")
    if s["timeouts"]:
        print(f"client timeouts: {s['timeouts']} ({100 * s['timeouts'] / max(s['requests'], 1):.2f}%)")
    lat = sorted(s["latencies"])
    print(f"all requests latency: avg={sum(s['latencies'])/max(len(s['latencies']),1):.1f}ms "
          f"p50={pct(lat, .5)}ms p95={pct(lat, .95)}ms p99={pct(lat, .99)}ms")
    print("\n-- orders --")
    print(f"  SUCCESS: {s['orders']['SUCCESS']}  REJECTED: {s['orders']['REJECTED']}  "
          f"RATE_LIMITED: {s['orders']['RATE_LIMITED']}")
    if s["order_reasons"]:
        print("  rejection reasons:", dict(sorted(s["order_reasons"].items(), key=lambda x: -x[1])))
    print("\n-- rogue bots (intentionally exceeding limits) --")
    print(f"  requests: {s['rogue']['requests']}  rate_limited: {s['rogue']['rate_limited']} "
          f"({100 * s['rogue']['rate_limited'] / max(s['rogue']['requests'], 1):.1f}%)")
    print("\n-- by endpoint --")
    for ep, d in sorted(s["by_endpoint"].items(), key=lambda x: -x[1]["n"]):
        el = sorted(d["lat"])
        print(f"  {ep:24s} n={d['n']:5d} avg={sum(d['lat'])/len(d['lat']):.1f}ms "
              f"p95={pct(el, .95)}ms p99={pct(el, .99)}ms")
    print("===========================================================")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bots", type=int, default=100)
    ap.add_argument("--duration", type=float, default=120)
    ap.add_argument("--rogue", type=int, default=5)
    args = ap.parse_args()

    teams = [t for t in json.load(open(TEAMS_FILE)) if t["email"].startswith("u")]
    teams = teams[: args.bots]
    if len(teams) < args.bots:
        print(f"only {len(teams)} teams available")
        return

    load_symbols()
    print(f"symbols: {len(SYMBOLS)} | bots: {args.bots} | duration: {args.duration}s | rogue: {args.rogue}")

    run_until = time.monotonic() + args.duration
    rogue_ids = set(random.sample(range(len(teams)), min(args.rogue, len(teams))))
    start = time.monotonic()

    def work(i):
        bot(teams[i], i in rogue_ids, run_until)

    with ThreadPoolExecutor(max_workers=args.bots) as pool:
        list(pool.map(work, range(len(teams))))

    report(time.monotonic() - start)
    with open(os.path.join(HERE, "load_report.json"), "w") as f:
        json.dump(STATS, f, indent=2, default=str)
    print("wrote load_report.json")


if __name__ == "__main__":
    main()
