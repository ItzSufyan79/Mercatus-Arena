# Belmo.io Deployment Guide

Free tier: 1 Node.js service, never sleeps, no credit card needed.

**We'll use:**
- **Belmo.io** (free) — API + WebSocket server
- **Neon.tech** (free) — PostgreSQL database (512MB, always-on)

---

## Step 1: Create Neon Database

1. Go to https://neon.tech and sign up with GitHub (no credit card)
2. Click **Create Project**
   - Project name: `mercatus`
   - Region: closest to your users
   - Leave defaults (PostgreSQL 16)
3. Once created, copy the **Connection string** — it looks like:
   ```
   postgresql://neondb_owner:xxxx@ep-xxxx.us-east-2.aws.neon.tech/mercatus?sslmode=require
   ```
4. Save this — you'll need it as `DATABASE_URL`

---

## Step 2: Create Belmo Account

1. Go to https://dashboard.belmo.io/signup
2. Sign up with GitHub (no credit card required)
3. Install the Belmo GitHub App when prompted

---

## Step 3: Prepare the Server for Belmo

Belmo runs your app on a fixed `PORT` env var. Your server already uses `PORT` from env, so it should work. But we need a `package.json` at the server root that Belmo can detect.

Currently the server is in `server/` subdirectory. We need to make Belmo deploy from there. Two options:

### Option A: Deploy the server directory as a separate repo (recommended)

```bash
# Create a new repo just for the API server
mkdir mercatus-api-deploy
cd mercatus-api-deploy

# Copy server files
cp -r /path/to/mercatus-api/* .
cp -r /path/to/mercatus-api/.env.example . 2>/dev/null || true

# Initialize and push
git init
git add -A
git commit -m "Initial deploy"
git remote add origin https://github.com/YOUR_USERNAME/mercatus-api-deploy.git
git push -u origin main
```

### Option B: Deploy from subdirectory (if Belmo supports it)

Some platforms let you set a root directory. Check Belmo docs or dashboard for this option.

---

## Step 4: Configure Belmo

1. Go to https://dashboard.belmo.io
2. Click **New Service** → **Connect GitHub repo** → select `mercatus-api-deploy`
3. Belmo auto-detects:
   - Package manager from `package-lock.json`
   - Node version from `engines.node` in `package.json`
   - Build script: `npm run build`
   - Start script: `npm start`

4. **Set Environment Variables** in Belmo dashboard:

```
PORT=3000
DATABASE_URL=postgresql://neondb_owner:xxxx@ep-xxxx.us-east-2.aws.neon.tech/mercatus?sslmode=require
JWT_SECRET=<generate a random secret>
ADMIN_PASSWORD=7DLFbZ49Fom7mImIahj9
REGISTRATION_CODE=5524673EE6E8
CORS_ORIGIN=https://mercatus-arena.vercel.app
NODE_ENV=production
```

Generate a JWT secret:
```bash
openssl rand -hex 32
```

5. Click **Deploy** — wait 2-4 minutes

6. Once deployed, Belmo gives you a URL like:
   ```
   https://your-service-name.belmo.io
   ```

---

## Step 5: Update Frontend

On **Vercel** dashboard → Settings → Environment Variables:

```
NEXT_PUBLIC_API_BASE=https://your-service-name.belmo.io
NEXT_PUBLIC_WS_URL=wss://your-service-name.belmo.io/ws
```

Redeploy the frontend.

---

## Step 6: Test

```bash
# Health check
curl https://your-service-name.belmo.io/healthz

# Login
curl -X POST https://your-service-name.belmo.io/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@mercatus.tech","password":"7DLFbZ49Fom7mImIahj9"}'

# Generate dataset (use the token from login)
curl -X POST https://your-service-name.belmo.io/api/admin/dataset/synthetic \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{"duration_minutes":180,"spacing_ms":1000,"symbols":["AAPL","MSFT","GOOG","TSLA","NVDA"],"seed":42}'
```

---

## Step 7: Setup Auto-Deploy

Belmo auto-deploys on push to the connected branch (usually `main`). Just push and it rebuilds:

```bash
cd mercatus-api-deploy
# Make changes...
git add -A
git commit -m "Update"
git push
```

Belmo picks it up automatically — no webhook config needed.

---

## Important Notes

### 512MB RAM Limit
Belmo free tier gives 512MB RAM. This is enough because:
- Dataset ticks are stored in Neon PostgreSQL, not in server memory
- `maxRowsPerTick` limits per-tick queries to 5000 rows
- Price data is just a Map of ~5 symbols (tiny)
- Main memory users: Node.js process (~100-200MB) + WebSocket connections

If you hit memory limits, you can:
- Reduce `MAX_ROWS_PER_TICK` in env
- Use fewer symbols
- Upgrade to Belmo Solo ($7/mo) for 1GB RAM

### WebSockets
Belmo supports WebSockets natively — no sticky sessions needed. Your live price feed works out of the box.

### CORS
Make sure `CORS_ORIGIN` matches your Vercel frontend URL exactly.

### SSL
Belmo provides free SSL automatically. Your API is accessible via `https://`.

---

## Quick Commands

```bash
# View logs
# Check Belmo dashboard → Logs tab

# Restart service
# Check Belmo dashboard → Restart button

# Update env vars
# Check Belmo dashboard → Environment tab

# Trigger redeploy
git commit --allow-empty -m "Redeploy" && git push
```

---

## Comparison: Belmo vs Render

| | Belmo Free | Render Free |
|---|---|---|
| Always-on | Yes | No (spins down) |
| Cold start | None | 30s |
| RAM | 512MB | 512MB |
| SSL | Yes | Yes |
| WebSocket | Yes | Yes |
| Database | External (Neon free) | Built-in PostgreSQL |
| Credit card | No | No |
| **Verdict** | **Better for always-on** | Worse (spin-down) |

---

## Troubleshooting

### "Application failed to respond"
- Check Belmo logs for startup errors
- Verify `DATABASE_URL` is correct and Neon project is active
- Make sure `npm start` script exists in `package.json`

### Database connection refused
- Neon has a 5-minute idle timeout on free tier — it auto-wakes on connection
- Verify SSL mode: `?sslmode=require` must be in the URL
- Check Neon dashboard for connection limits

### WebSocket disconnects
- Belmo supports long-lived WebSocket connections
- Check that your client reconnects (it already does)

### 502 errors
- App may be restarting due to memory — check logs
- Reduce workload or upgrade plan
