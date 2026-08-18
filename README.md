# Mercatus Arena — TechVerse 2026

Real-time algorithmic trading evaluation platform. Teams build strategy bots that
trade an identical live market feed; the event runs for 3 hours and is scored
50% trading PnL / 25% code quality / 25% strategy report.

**Architecture (all free tier):**

| Layer    | Stack                                     | Host            |
|----------|-------------------------------------------|-----------------|
| API      | Express + TypeScript + pg + WebSocket     | Render (free)   |
| Database | PostgreSQL 16                             | Render (free)   |
| UI       | Next.js 15 + Tailwind 4 + app router      | Vercel (Hobby)  |

The long-running Express process on Render owns the market engine, so it has no
serverless invocation caps and can stream ticks to every team over WebSockets.

## Repo layout

```
server/   Express API: engine, atomic trading, auth, scoring, telemetry, routes
web/      Next.js portal: landing, login/register, dashboard, leaderboard, admin
```

## Local development

Requires Node 20+ and Docker.

```bash
npm install
npm run db:up        # starts local Postgres on :5432 (mercatus/mercatus)
npm run dev          # server on :8080 + web on :3000
```

Seeded admin login (change in production): `admin@mercatus.tech` / `admin1234`.

Smoke-test flow:

```bash
# sign in as admin, generate a dataset, start the event
curl -s -X POST localhost:8080/api/auth/login -H 'content-type: application/json' \
  -d '{"email":"admin@mercatus.tech","password":"admin1234"}'

curl -s -X POST localhost:8080/api/admin/dataset/synthetic \
  -H "authorization: Bearer <token>" -H 'content-type: application/json' \
  -d '{"duration_minutes":30}'

curl -s -X POST localhost:8080/api/admin/control \
  -H "authorization: Bearer <token>" -H 'content-type: application/json' \
  -d '{"action":"start","event_minutes":30}'
```

## Tests

```bash
npm run db:up
npm run test        # vitest: auth, atomic double-spend, engine, scoring
npm run build       # typechecks + builds both workspaces
```

## Deploy

### Render (API + database)

1. Push the repo to GitHub.
2. In Render, **New → Blueprint** and select the repo. It reads `render.yaml`
   and provisions the Postgres DB + web service automatically.
3. Set `CORS_ORIGIN` to your Vercel URL, and change `ADMIN_PASSWORD`.
4. Free notes: the web service sleeps after ~15 min idle (1 min cold start —
   fine during the event). The free Postgres database expires 30 days after
   creation — after the event, either upgrade or export the data.

### Vercel (portal)

1. Import the same repo. Root directory: `web`.
2. Build command: `npm run build` · Output directory: `web/.next` (Vercel detects
   Next.js automatically if the root directory is `web`).
3. Environment variables:
   - `NEXT_PUBLIC_API_BASE=https://<your-render-app>.onrender.com`
   - `NEXT_PUBLIC_WS_URL=wss://<your-render-app>.onrender.com/ws`
4. Hobby limits are safe: market polls hit the CDN (`Cache-Control: max-age=1`),
   trades are uncached but low-volume.

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
