# TrustLens AI

TrustLens AI is a lightweight web app that accepts a product URL, extracts relevant text and commerce signals from the webpage, and sends that structured data to a backend Gemini service for an authenticity assessment.

## Features

- Extracts seller, pricing, and review hints from a user-provided product page URL.
- Uses heuristic checks to show an immediate confidence score.
- Calls Gemini through a backend API when **Analyze with AI** is pressed and renders Gemini's response in the UI.
- Keeps the Gemini API key on the server instead of asking end users to paste it into the browser.
- Ships as a small Node.js app that serves both the frontend and the backend proxy.

## Project structure

- `index.html` - page markup and UI containers.
- `styles.css` - application styling.
- `app.js` - extraction logic, heuristic scoring, and frontend-to-backend request flow.
- `server.js` - static file server and Gemini proxy endpoint.
- `package.json` - app metadata and start script.

## Requirements for deployment on Linux

Before deploying, make sure your Linux machine has:

- Node.js 18 or newer.
- Network access from the server to `https://generativelanguage.googleapis.com/`.
- Network access from user browsers to the deployed app.
- Optional outbound access from user browsers to `https://r.jina.ai/` for mirrored webpage extraction.
- A Gemini API key configured on the server as an environment variable.

> Important: the backend uses the model `gemini-3-flash-preview` and expects `GEMINI_API_KEY` to be present in the Linux environment before startup.

---

## Detailed deployment guide for a Linux machine

### Option A: Quick local deployment with Node.js

This is the fastest way to run the project on a Linux host for testing.

1. Open a terminal.
2. Clone or copy the repository onto the Linux machine.
3. Change into the project directory:

   ```bash
   cd /path/to/miniproject
   ```

4. Export your Gemini API key into the shell session:

   ```bash
   export GEMINI_API_KEY="your-gemini-api-key"
   ```

5. Start the application:

   ```bash
   npm start
   ```

6. Open a browser and visit:

   ```text
   http://<your-linux-host-ip>:3000
   ```

7. Paste a product URL and click **Analyze with AI**.

### Option B: Run as a systemd service on Linux

This is the recommended deployment path because the Node.js backend must stay running in order to proxy Gemini requests.

#### 1. Install Node.js

On Ubuntu/Debian, for example:

```bash
sudo apt update
sudo apt install -y nodejs npm
```

#### 2. Copy the app files to the server

```bash
sudo mkdir -p /opt/trustlens-ai
sudo cp index.html app.js styles.css server.js package.json README.md /opt/trustlens-ai/
```

#### 3. Create a dedicated service user

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin trustlens
```

#### 4. Set ownership

```bash
sudo chown -R trustlens:trustlens /opt/trustlens-ai
```

#### 5. Create a systemd unit file

Create `/etc/systemd/system/trustlens-ai.service` with the following content:

```ini
[Unit]
Description=TrustLens AI
After=network.target

[Service]
Type=simple
User=trustlens
Group=trustlens
WorkingDirectory=/opt/trustlens-ai
Environment=PORT=3000
Environment=GEMINI_API_KEY=your-gemini-api-key
ExecStart=/usr/bin/node /opt/trustlens-ai/server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

#### 6. Enable and start the service

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now trustlens-ai
```

#### 7. Check service health

```bash
sudo systemctl status trustlens-ai
sudo journalctl -u trustlens-ai -n 100 --no-pager
```

### Option C: Put Nginx in front of the Node.js app

Use Nginx as a reverse proxy so users can access the app via port 80 or 443 while Node listens on port 3000.

#### 1. Install Nginx

```bash
sudo apt update
sudo apt install -y nginx
```

#### 2. Create an Nginx site configuration

Create `/etc/nginx/sites-available/trustlens-ai` with the following content:

```nginx
server {
    listen 80;
    listen [::]:80;

    server_name _;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

#### 3. Enable the site

```bash
sudo ln -s /etc/nginx/sites-available/trustlens-ai /etc/nginx/sites-enabled/trustlens-ai
sudo nginx -t
sudo systemctl reload nginx
```

#### 4. Allow HTTP traffic through the firewall if needed

```bash
sudo ufw allow 'Nginx HTTP'
sudo ufw reload
```

#### 5. Open the app in your browser

```text
http://<server-ip>/
```

### Option D: Run behind HTTPS with Nginx and Let's Encrypt

If your Linux machine has a public domain name, use HTTPS.

#### 1. Point your domain to the server IP

Set an `A` record for your domain such as `trustlens.example.com`.

#### 2. Update the Nginx server_name

Replace:

```nginx
server_name _;
```

With:

```nginx
server_name trustlens.example.com;
```

#### 3. Install Certbot

```bash
sudo apt update
sudo apt install -y certbot python3-certbot-nginx
```

#### 4. Request and install the TLS certificate

```bash
sudo certbot --nginx -d trustlens.example.com
```

#### 5. Verify automatic renewal

```bash
sudo systemctl status certbot.timer
```

---

## Updating the application on Linux

Whenever you change the app files:

1. Copy the new versions to the server:

   ```bash
   sudo cp index.html app.js styles.css server.js package.json README.md /opt/trustlens-ai/
   ```

2. Restart the backend service:

   ```bash
   sudo systemctl restart trustlens-ai
   ```

3. If using Nginx, reload it after config changes:

   ```bash
   sudo systemctl reload nginx
   ```

4. Clear the browser cache or do a hard refresh if you do not see the updates.

---

## How the Gemini flow works

When the user clicks **Analyze with AI**:

1. The browser validates the product URL.
2. The frontend attempts to fetch webpage text using `r.jina.ai` as a read-only mirror.
3. The frontend extracts relevant signals including:
   - detected price,
   - estimated market price,
   - seller hints,
   - review hints,
   - a description summary,
   - a page excerpt.
4. The frontend computes a local heuristic score.
5. The frontend sends the extracted data plus heuristic context to the backend `/api/analyze` endpoint.
6. The backend calls Gemini using the server-side `GEMINI_API_KEY` and the `gemini-3-flash-preview` model.
7. Gemini returns a structured JSON response with:
   - `score`,
   - `verdict`,
   - `highlights`,
   - `summary`.
8. The frontend renders the returned score, risk badge, insights, and a text block containing Gemini's analysis.

---

## Production recommendations

For a stronger production deployment on Linux, consider the following improvements:

- Store `GEMINI_API_KEY` in a proper secret manager instead of directly in a unit file.
- Add rate limiting on `/api/analyze`.
- Add logging and monitoring for failed extraction attempts and Gemini errors.
- Validate and sanitize URL inputs again on the server.
- Add request timeouts and retry limits for upstream API calls.
- Consider a headless-browser extraction service for sites that block mirrored access.

## Troubleshooting

### The page loads but Gemini analysis fails

Possible causes:

- `GEMINI_API_KEY` is missing or invalid on the server.
- The API key does not have access to `gemini-3-flash-preview`.
- Outbound access to `generativelanguage.googleapis.com` is blocked.
- The backend service is not running.

### The page loads but clicking Analyze with AI returns a backend error

Possible causes:

- The Node.js process crashed.
- The reverse proxy is not forwarding traffic to port `3000`.
- The systemd service file points to the wrong working directory.

### Price or review data looks incomplete

Possible causes:

- The source site blocks scraping or mirrored extraction.
- The product page is heavily rendered with client-side JavaScript.
- The mirrored content does not include all visible page elements.
