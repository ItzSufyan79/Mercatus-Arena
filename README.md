# Mercatus Arena — TechVerse 2026

Real-time algorithmic trading evaluation platform. Teams build strategy bots that
trade an identical live market feed; the event runs for 3 hours and is scored
50% trading PnL / 25% code quality / 25% strategy report.

The long-running Express process on Render owns the market engine, so it has no
serverless invocation caps and can stream ticks to every team over WebSockets.

## Event-day runbook (admin)

1. **T-minus 1 hour** — confirm dataset uploaded (synthetic or faculty CSV via
   the Admin Console), register a few test teams, verify the WS feed.
2. **T-0** — Admin Console → **Start Event**. All teams are reset to starting
   capital, leaderboard is live, API keys still masked.
3. **T+3h-20m** — leaderboard auto-freezes (live snapshot).
4. **T+3h-15m** — API auto-freezes; submissions still accepted via portal.
5. **T+10m before reveal** — Admin Console → **Reveal API Keys** so teams can
   wire up bots for the next run; at **T-0** teams must reconnect with their key.
6. **After event** — Admin Console → judge scoring, **Compute**, export metrics
   (latency p95/p99, fill/reject counts) per team.

## API surface

```
POST   /api/auth/register          team signup (returns masked API key + JWT)
POST   /api/auth/login             portal sign-in
GET    /api/auth/me                own profile (key unmasked when revealed)
GET    /api/market/status          event state, symbols, prices
GET    /api/market/snapshot        price snapshot (CDN-cached, max-age=1)
GET    /api/market/leaderboard     live or frozen standings
POST   /api/trade/buy|sell         x-api-key or Bearer; market/limit orders
GET    /api/team/portfolio         cash, positions, unrealized PnL
GET    /api/team/trades            own order log with latency_ms
POST   /api/team/submission        PDF + code repo link
WS     /ws                         hello + tick/state/volatility/flash frames
...    /api/admin/*                event control, dataset, teams, scoring, metrics
```

Order rejections are machine-readable: `MARKET_NOT_ACTIVE:<state>`,
`MARKET_PAUSED`, `TEAM_FROZEN`, `INVALID_SYMBOL`, `LIMIT_NOT_REACHED`,
`INSUFFICIENT_FUNDS`, `INSUFFICIENT_POSITION`.
