#!/usr/bin/env python3
"""Create 100 teams via the admin API and dump their API keys to teams.json.

Admin credentials from env: ADMIN_EMAIL/ADMIN_PASSWORD (defaults to seeded admin).
Each team gets starting_capital=10,000,000. Requires credentials_revealed=true
(admin /teams returns full api_key only then).
"""

import json
import os
import time
import urllib.error
import urllib.request

API_BASE = os.environ.get("API_BASE", "http://localhost:8080").rstrip("/")
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@mercatus.tech")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin1234")
TEAMS = int(os.environ.get("TEAMS", "100"))
TEAM_START = int(os.environ.get("TEAM_START", "1"))
CAPITAL = 10_000_000
PASSWORD = "loadtest123"
OUT = os.path.join(os.path.dirname(__file__), "teams.json")


def http(method, path, body=None, token=None, retries=5):
    for attempt in range(retries):
        req = urllib.request.Request(API_BASE + path, method=method)
        req.add_header("Content-Type", "application/json")
        if token:
            req.add_header("Authorization", f"Bearer {token}")
        data = json.dumps(body).encode() if body is not None else None
        try:
            with urllib.request.urlopen(req, data=data, timeout=20) as resp:
                return json.load(resp)
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < retries - 1:
                wait = 5 + attempt * 5
                print(f"RATE_LIMITED, retrying in {wait}s ({attempt + 1}/{retries})", flush=True)
                time.sleep(wait)
                continue
            raise


def main():
    token = http("POST", "/api/auth/login",
                 {"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})["token"]

    created = 0
    for i in range(TEAM_START, TEAM_START + TEAMS):
        payload = {
            "role": "team",
            "team_name": f"Bot{i:03d}",
            "email": f"u{i:03d}@test.dev",
            "password": PASSWORD,
            "starting_capital": CAPITAL,
        }
        try:
            http("POST", "/api/admin/users", payload, token)
            created += 1
            print(f"created {payload['email']}", flush=True)
        except urllib.error.HTTPError as e:
            msg = e.read().decode()
            print(f"FAIL {payload['email']}: HTTP {e.code} {msg}", flush=True)
        time.sleep(0.25)

    print(f"=== created {created}/{TEAMS} ===", flush=True)

    teams = http("GET", "/api/admin/teams", token=token)["teams"]
    rows = [
        {
            "team_id": t["team_id"],
            "team_name": t["team_name"],
            "email": t["email"],
            "password": PASSWORD,
            "api_key": t["api_key"],
        }
        for t in teams
        if t["role"] == "team" and t["email"].endswith("@test.dev") and t["api_key"]
    ]
    rows.sort(key=lambda r: r["team_id"])
    with open(OUT, "w") as f:
        json.dump(rows, f, indent=2)
    print(f"wrote {len(rows)} teams -> {OUT}", flush=True)


if __name__ == "__main__":
    main()
