# Oracle Cloud Free Tier Deployment Guide

## Step 1: Create Oracle Cloud Account

1. Go to https://cloud.oracle.com/free
2. Sign up with your email
3. You'll get $300 free credits (90 days) + **Always Free** ARM Ampere A1 VM
4. Verify your phone number and credit card (won't be charged)
5. Select your **home region** — pick the one closest to your users

---

## Step 2: Create VM Instance

1. Go to **Compute → Instances → Create Instance**
2. Configuration:
   - **Name**: `mercatus-api`
   - **Image**: Ubuntu 24.04 (or latest)
   - **Shape**: VM.Standard.A1.Flex (ARM)
   - **OCPU**: 4
   - **Memory**: 24 GB
   - **Boot Volume**: 200 GB
3. **Networking**: Create a new VCN (default) or use existing
4. **Add SSH keys**: Generate or paste your public key
5. Click **Create** and wait 2-3 minutes

### Get your VM's public IP:
- After creation, find the **Public IP** on the instance details page

---

## Step 3: SSH into VM

```bash
ssh -i ~/.ssh/your_private_key ubuntu@<YOUR_VM_IP>
```

---

## Step 4: Install Dependencies

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 22.x
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Install PostgreSQL 16
sudo apt install -y postgresql postgresql-contrib

# Install nginx
sudo apt install -y nginx

# Install certbot (SSL)
sudo apt install -y certbot python3-certbot-nginx

# Verify installations
node -v    # v22.x
psql --version   # 16.x
nginx -v
```

---

## Step 5: Setup PostgreSQL

```bash
# Switch to postgres user
sudo -u postgres psql

# Inside psql shell:
CREATE USER mercatus WITH PASSWORD 'your_secure_password_here';
CREATE DATABASE mercatus OWNER mercatus;
GRANT ALL PRIVILEGES ON DATABASE mercatus TO mercatus;
\q
```

Test connection:
```bash
psql -U mercatus -d mercatus -h localhost
```

---

## Step 6: Open Firewall Ports

```bash
# Allow SSH, HTTP, HTTPS
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

Also open ports in Oracle Cloud console:
1. Go to **Networking → Virtual Cloud Networks → your VCN → Subnet**
2. Click on **Security Lists → Default Security List**
3. Add Ingress Rules:
   - **Port 80** (HTTP) — Source: 0.0.0.0/0
   - **Port 443** (HTTPS) — Source: 0.0.0.0/0

---

## Step 7: Deploy Server Code

```bash
# Clone your repo
git clone https://github.com/ItzSufyan79/Mercatus-Arena.git
cd Mercatus-Arena/server

# Install dependencies
npm install

# Build TypeScript
npm run build

# Create .env file
cat > .env << 'EOF'
PORT=8080
DATABASE_URL=postgresql://mercatus:your_secure_password_here@localhost:5432/mercatus
JWT_SECRET=$(openssl rand -hex 32)
ADMIN_PASSWORD=7DLFbZ49Fom7mImIahj9
REGISTRATION_CODE=5524673EE6E8
CORS_ORIGIN=https://mercatus-arena.vercel.app
NODE_ENV=production
EOF

# Test that the server starts
node dist/index.js
# Press Ctrl+C after confirming it runs
```

---

## Step 8: Setup Systemd Service

```bash
# Create service file
sudo tee /etc/systemd/system/mercatus-api.service > /dev/null << 'EOF'
[Unit]
Description=Mercatus Arena API
After=network.target postgresql.service

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/Mercatus-Arena/server
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

# Resource limits
LimitNOFILE=65536
MemoryMax=2G

[Install]
WantedBy=multi-user.target
EOF

# Enable and start
sudo systemctl daemon-reload
sudo systemctl enable mercatus-api
sudo systemctl start mercatus-api

# Check status
sudo systemctl status mercatus-api
sudo journalctl -u mercatus-api -f
```

Test it:
```bash
curl http://localhost:8080/healthz
# Should return: {"ok":true,"state":"PRE_LAUNCH",...}
```

---

## Step 9: Configure Nginx (Reverse Proxy + SSL)

Replace `api.yourdomain.com` with your actual domain (or use the IP directly).

### Option A: With a Domain (recommended)

1. **Point your domain to the VM IP:**
   - Add A record: `api` → `<YOUR_VM_IP>`

2. **Configure Nginx:**
```bash
sudo tee /etc/nginx/sites-available/mercatus > /dev/null << 'EOF'
server {
    listen 80;
    server_name api.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }
}
EOF

# Enable
sudo ln -sf /etc/nginx/sites-available/mercatus /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# Get SSL certificate
sudo certbot --nginx -d api.yourdomain.com
```

### Option B: Without a Domain (IP only, no SSL)

```bash
sudo tee /etc/nginx/sites-available/mercatus > /dev/null << 'EOF'
server {
    listen 80 default_server;
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/mercatus /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

---

## Step 10: Setup Database Schema

```bash
# Set PGPASSWORD so psql doesn't prompt
export PGPASSWORD='your_secure_password_here'

# Run the schema creation (the server does this on startup, but let's verify)
psql -U mercatus -d mercatus -h localhost -f /home/ubuntu/Mercatus-Arena/server/src/schema.sql 2>/dev/null || true

# The server auto-creates tables on startup, so just restart it:
sudo systemctl restart mercatus-api
```

---

## Step 11: Update Frontend Config

On **Vercel** dashboard → your project → **Settings → Environment Variables**:

```
NEXT_PUBLIC_API_BASE=https://api.yourdomain.com
NEXT_PUBLIC_WS_URL=wss://api.yourdomain.com/ws
```

Or if no domain:
```
NEXT_PUBLIC_API_BASE=http://<YOUR_VM_IP>
NEXT_PUBLIC_WS_URL=ws://<YOUR_VM_IP>/ws
```

Then redeploy frontend.

---

## Step 12: Generate Dataset

```bash
# Login and get token
curl -X POST https://api.yourdomain.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@mercatus.tech","password":"7DLFbZ49Fom7mImIahj9"}'

# Use the token to generate dataset
curl -X POST https://api.yourdomain.com/api/admin/dataset/synthetic \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{"duration_minutes":180,"spacing_ms":1000,"symbols":["AAPL","MSFT","GOOG","TSLA","NVDA"],"seed":42}'
```

---

## Step 13: Configure Auto-Updates (Optional)

To auto-deploy on git push:

```bash
# Install webhook receiver
sudo apt install -y webhooks

# Create deploy script
cat > /home/ubuntu/deploy.sh << 'SCRIPT'
#!/bin/bash
cd /home/ubuntu/Mercatus-Arena
git pull origin main
cd server
npm install --production
npm run build
sudo systemctl restart mercatus-api
SCRIPT
chmod +x /home/ubuntu/deploy.sh

# Create webhook config
cat > /home/ubuntu/hooks.json << 'EOF'
[
  {
    "id": "mercatus-deploy",
    "execute-command": "/home/ubuntu/deploy.sh",
    "command-working-directory": "/home/ubuntu/Mercatus-Arena",
    "response-message": "Deployed!",
    "trigger-rule": {
      "match": {
        "type": "payload-hmac-sha256",
        "secret": "your_webhook_secret",
        "parameter": { "source": "header", "name": "X-Hub-Signature-256" }
      }
    }
  }
]
EOF

# Start webhook server on port 9000
webhooks -hooks /home/ubuntu/hooks.json -port 9000 -verbose
```

Then add a webhook in GitHub repo settings pointing to `http://<VM_IP>:9000/hooks/mercatus-deploy`.

---

## Quick Commands Reference

```bash
# Check server status
sudo systemctl status mercatus-api

# View logs
sudo journalctl -u mercatus-api -f

# Restart server
sudo systemctl restart mercatus-api

# Check nginx
sudo nginx -t
sudo systemctl status nginx

# Check PostgreSQL
sudo systemctl status postgresql

# SSH into VM
ssh -i ~/.ssh/your_key ubuntu@<VM_IP>
```

---

## Cost

| Resource | Always Free? | Notes |
|---|---|---|
| VM (4 OCPU, 24GB RAM) | Yes | ARM Ampere A1 |
| 200GB Boot Volume | Yes | |
| 10TB/month Bandwidth | Yes | More than enough |
| 2 VMs total | Yes | Can run API + more |
| **Total** | **$0/month forever** | |

---

## Troubleshooting

### Server won't start
```bash
sudo journalctl -u mercatus-api -n 50
# Check for missing env vars or DB connection errors
```

### Can't connect to database
```bash
sudo systemctl status postgresql
psql -U mercatus -d mercatus -h localhost
```

### WebSocket not connecting
- Make sure nginx has `proxy_set_header Upgrade` and `proxy_set_header Connection 'upgrade'`
- Check Oracle Cloud security list allows port 80/443

### SSL certificate fails
- Make sure DNS A record is pointing to your VM IP
- Wait 5 minutes for DNS propagation
- Try: `sudo certbot --nginx -d api.yourdomain.com --dry-run`
