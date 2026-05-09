# Cloudflare Setup for Remote Access

This tutorial explains how to set up Cloudflare to make your ArchitectureV1 backend accessible from anywhere, allowing you to control remote PCs.

## Option 1: Cloudflare Tunnel (Recommended - No Domain Required)

### Step 1: Install Cloudflare Tunnel

1. Go to [Cloudflare Zero Trust](https://dash.cloudflare.com/sign-up)
2. Create a free account
3. Navigate to **Zero Trust** > **Networks** > **Tunnels**
4. Click **Create a tunnel**
5. Name it `architecturev1` and click **Next**

### Step 2: Install cloudflared on your server

**Windows:**
```powershell
# Download cloudflared from https://github.com/cloudflare/cloudflared/releases/latest
# Extract and run:
.\cloudflared.exe service install
```

**Linux:**
```bash
# Download cloudflared
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
chmod +x cloudflared-linux-amd64
sudo mv cloudflared-linux-amd64 /usr/local/bin/cloudflared

# Install as service
cloudflared service install
```

### Step 3: Configure the tunnel

After creating the tunnel, you'll get a command to run. Run it on your server.

Then configure the tunnel in Cloudflare dashboard:

1. Click **Public Hostname** tab
2. Click **Add a public hostname**
3. **Subdomain:** Choose a subdomain (e.g., `arch-relay`)
4. **Domain:** Select `yourname.pages.dev` (free Cloudflare domain)
5. **Service:** `http://localhost:8000` (or your FastAPI port)
6. Click **Save hostname**

Your backend will now be accessible at: `https://arch-relay.yourname.pages.dev`

### Step 4: Update agent configuration

In `agent/agent.js`, update the `SERVER_URL`:

```javascript
const SERVER_URL = 'https://arch-relay.yourname.pages.dev';
```

### Step 5: Update desktop app configuration

In `desktop/renderer.js` or environment variables, update the relay URL to your new Cloudflare URL.

## Option 2: Cloudflare with Custom Domain

### Step 1: Get a domain

1. Buy a domain from Cloudflare or any registrar
2. Point the domain's nameservers to Cloudflare

### Step 2: Configure DNS

1. In Cloudflare Dashboard > DNS
2. Add an A record:
   - **Type:** A
   - **Name:** relay (or subdomain of choice)
   - **IPv4 address:** Your server's public IP
   - **Proxy status:** Proxied (orange cloud icon)

### Step 3: Configure SSL/TLS

1. Go to **SSL/TLS** > **Overview**
2. Set mode to **Full** or **Full (strict)**
3. This enables HTTPS

### Step 4: Update backend configuration

No changes needed if using port 80/443. If using custom port, configure Cloudflare Origin Rules.

### Step 5: Update agent and desktop URLs

Same as Option 1, update to use your custom domain URL.

## Security Considerations

### 1. Add Authentication (Recommended)

Add a simple authentication token to your backend:

In `backend/server.py`:

```python
import os
from fastapi import Header, HTTPException

AUTH_TOKEN = os.getenv("AUTH_TOKEN", "your-secret-token")

async def verify_auth(x_auth_token: str = Header(...)):
    if x_auth_token != AUTH_TOKEN:
        raise HTTPException(status_code=403, detail="Invalid token")
```

Add this to your WebSocket connections:

```python
@app.websocket("/api/ws/agent")
async def agent_ws(ws: WebSocket, x_auth_token: str = Header(...)):
    if x_auth_token != AUTH_TOKEN:
        await ws.close(code=1008)
        return
    # ... rest of your code
```

Update agent to send the token:

In `agent/agent.js`:

```javascript
const AUTH_TOKEN = 'your-secret-token';

ws = new WebSocket(url, {
  headers: {
    'x-auth-token': AUTH_TOKEN
  }
});
```

### 2. Use Environment Variables

Store sensitive data in `.env` file:

```env
AUTH_TOKEN=your-secret-token
SERVER_URL=https://your-cloudflare-url.com
```

### 3. Restrict by IP (Optional)

In Cloudflare Dashboard > Settings > WAF, create rules to only allow specific IP ranges.

## Testing

1. Start your backend: `cd backend && python server.py`
2. Start an agent on a remote PC
3. Start the desktop app
4. Verify the remote PC appears in the PC list
5. Test sending commands

## Troubleshooting

**Agent can't connect:**
- Check if Cloudflare Tunnel is running
- Verify the URL is correct
- Check firewall settings on the server
- Check Cloudflare dashboard for connection logs

**Desktop app can't connect:**
- Verify the URL is accessible in a browser
- Check CORS settings in backend
- Check browser console for errors

**Connection drops:**
- Cloudflare free tier has some limitations
- Consider upgrading for production use
