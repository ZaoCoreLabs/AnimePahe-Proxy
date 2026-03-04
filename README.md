# AnimePahe M3U8 Proxy

A lightweight M3U8 proxy for Express and Cloudflare Workers. Handles `Referer`, `Origin`, and `User-Agent` headers to bypass restrictions.

## 🚀 Cloudflare Worker (Recommended)

1.  **Configure**: Edit `ALLOWED_ORIGINS` in `wrangler.toml`. Other settings can be modified in `cf_worker.js`.
2.  **Deploy**:
    ```bash
    npx wrangler deploy
    ```

## 💻 Express (Node.js)

1.  **Install**: `npm install`
2.  **Run**: `npm start` (Default port: `3000`)
3.  **Config**: Edit `.env` or `config.js`.

## 🛠️ Usage

**Endpoint**: `GET /m3u8-proxy?url=<TARGET_URL>&headers=<JSON_STRING>`

**Example**:
```
https://your-proxy.com/m3u8-proxy?url=https://example.com/video.m3u8
```

-   `url`: The M3U8/segment URL to proxy.
-   `headers` (optional): JSON-encoded headers (e.g., `{"Referer": "https://site.com"}`).

**Playground (Express Only)**: Access `GET /` in your browser.
