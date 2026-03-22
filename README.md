# TrustLens AI

TrustLens AI is a lightweight frontend that accepts a product URL, extracts relevant text and commerce signals from the webpage, and sends that structured data to Gemini for an authenticity assessment.

## Features

- Extracts seller, pricing, and review hints from a user-provided product page URL.
- Uses heuristic checks to show an immediate confidence score.
- Calls the Gemini API when **Analyze with AI** is pressed and renders Gemini's response in the UI.
- Ships as a static site, so it can be hosted easily on a Linux machine with Nginx, Apache, or a simple local web server.

## Project structure

- `index.html` - page markup and UI containers.
- `styles.css` - application styling.
- `app.js` - extraction logic, heuristic scoring, and Gemini integration.

## Requirements for deployment on Linux

Before deploying, make sure your Linux machine has:

- A modern web browser for testing.
- A web server such as **Nginx** or a lightweight static file server.
- Network access from client browsers to:
  - `https://r.jina.ai/` for mirrored webpage extraction.
  - `https://generativelanguage.googleapis.com/` for Gemini API requests.
- A Gemini API key for each user/session that will call Gemini from the browser.

> Important: this project currently calls Gemini directly from the browser. That is convenient for demos, but for production you should place the Gemini call behind your own backend so the API key is not exposed to end users.

---

## Detailed deployment guide for a Linux machine

### Option A: Quick local deployment with Python

This is the fastest way to run the project on a Linux host for testing.

1. Open a terminal.
2. Clone or copy the repository onto the Linux machine.
3. Change into the project directory:

   ```bash
   cd /path/to/miniproject
   ```

4. Start a static server:

   ```bash
   python3 -m http.server 8080
   ```

5. Open a browser and visit:

   ```
   http://<your-linux-host-ip>:8080
   ```

6. Enter:
   - a product URL,
   - a Gemini API key,
   - then click **Analyze with AI**.

### Option B: Deploy with Nginx on Ubuntu/Debian

This is the recommended Linux deployment path for a real server.

#### 1. Install Nginx

```bash
sudo apt update
sudo apt install -y nginx
```

#### 2. Copy the project files into the web root

```bash
sudo mkdir -p /var/www/trustlens-ai
sudo cp index.html app.js styles.css /var/www/trustlens-ai/
```

#### 3. Create an Nginx site configuration

Create `/etc/nginx/sites-available/trustlens-ai` with the following content:

```nginx
server {
    listen 80;
    listen [::]:80;

    server_name _;

    root /var/www/trustlens-ai;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~* \.(css|js|png|jpg|jpeg|gif|svg|ico)$ {
        expires 7d;
        add_header Cache-Control "public, immutable";
    }
}
```

#### 4. Enable the site

```bash
sudo ln -s /etc/nginx/sites-available/trustlens-ai /etc/nginx/sites-enabled/trustlens-ai
sudo nginx -t
sudo systemctl reload nginx
```

#### 5. Allow HTTP traffic through the firewall if needed

```bash
sudo ufw allow 'Nginx HTTP'
sudo ufw reload
```

#### 6. Open the app in your browser

```text
http://<server-ip>/
```

### Option C: Run behind HTTPS with Nginx and Let's Encrypt

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
   sudo cp index.html app.js styles.css /var/www/trustlens-ai/
   ```

2. If using Nginx, reload it:

   ```bash
   sudo systemctl reload nginx
   ```

3. Clear the browser cache or do a hard refresh if you do not see the updates.

---

## How the Gemini flow works

When the user clicks **Analyze with AI**:

1. The app validates the product URL.
2. It attempts to fetch webpage text using `r.jina.ai` as a read-only mirror.
3. It extracts relevant signals including:
   - detected price,
   - estimated market price,
   - seller hints,
   - review hints,
   - a description summary,
   - a page excerpt.
4. It computes a local heuristic score.
5. It sends the extracted data plus the heuristic context to Gemini.
6. Gemini returns a structured JSON response with:
   - `score`,
   - `verdict`,
   - `highlights`,
   - `summary`.
7. The UI renders the returned score, risk badge, insights, and a text block containing Gemini's analysis.

---

## Production recommendations

For a stronger production deployment on Linux, consider the following improvements:

- Move the Gemini request into a backend service so API keys are never exposed in the browser.
- Add server-side caching for repeated URL analyses.
- Add rate limiting to reduce abuse.
- Log failed extraction attempts for debugging.
- Validate and sanitize URL inputs on the server.
- Consider a headless-browser extraction service for sites that block mirrored access.

## Troubleshooting

### The page loads but Gemini analysis fails

Possible causes:

- The Gemini API key is invalid.
- The API key does not have access to the selected Gemini model.
- Outbound access to `generativelanguage.googleapis.com` is blocked.
- Browser CORS/network policies are interfering.

### Price or review data looks incomplete

Possible causes:

- The source site blocks scraping or mirrored extraction.
- The product page is heavily rendered with client-side JavaScript.
- The mirrored content does not include all visible page elements.

### The Linux server is reachable, but assets do not update

Possible causes:

- Browser cache is serving old JavaScript/CSS.
- Files were copied to the wrong web root.
- Nginx was not reloaded after changing configuration.
