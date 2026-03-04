const CONFIG = {
    DEFAULT_REFERER: 'https://kwik.cx',
    ANIMEPAHE_BASE: 'https://animepahe.si',
    DEFAULT_USER_AGENT: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    FORWARD_HEADERS: ['range', 'if-match', 'if-none-match', 'if-modified-since', 'if-unmodified-since', 'authorization', 'cookie'],
    UPSTREAM_HEADERS: ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag'],
    CORS: {
        ALLOW_METHODS: 'GET, POST, OPTIONS, HEAD',
        ALLOW_HEADERS: 'Content-Type, X-Requested-With, Range, Authorization, Cookie',
        EXPOSE_HEADERS: 'Content-Range, Content-Length, Accept-Ranges, Content-Type',
        ALLOW_CREDENTIALS: 'true'
    },
    CACHE_CONTROL: 'no-store, no-cache, must-revalidate, proxy-revalidate'
};

const cookieJar = new Map();

function isOriginAllowed(origin, allowedOrigins) {
    if (!allowedOrigins || allowedOrigins.length === 0 || allowedOrigins.includes("*")) {
        return true;
    }
    return allowedOrigins.includes(origin);
}

function buildUpstreamHeaders(request, url, headersParam) {
    const headers = new Headers({
        "User-Agent": CONFIG.DEFAULT_USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Upgrade-Insecure-Requests": "1"
    });

    CONFIG.FORWARD_HEADERS.forEach(h => {
        const val = request.headers.get(h);
        if (val) headers.set(h, val);
    });

    let referer = CONFIG.DEFAULT_REFERER;
    if (headersParam) {
        try {
            const additionalHeaders = JSON.parse(headersParam);
            Object.entries(additionalHeaders).forEach(([key, value]) => {
                const lk = key.toLowerCase();
                headers.set(lk, value);
                if (lk === 'referer' || lk === 'referrer') referer = value;
            });
        } catch (e) { }
    }

    if (referer) {
        let refStr = decodeURIComponent(referer);

        if (url.hostname.includes('kwik') || url.hostname.includes('kwics')) {
            refStr = CONFIG.ANIMEPAHE_BASE;
            if (!refStr.endsWith('/')) refStr += '/';
        } else if (url.hostname.includes('owocdn') || url.hostname.includes('cdn')) {
            if (!refStr.includes('kwik.cx')) {
                refStr = CONFIG.DEFAULT_REFERER;
            }
        }

        if (refStr.includes('kwik.cx') && !refStr.endsWith('/')) {
            refStr += '/';
        }
        headers.set('referer', refStr);

        try {
            headers.set('origin', new URL(refStr).origin);
        } catch (e) {
            headers.set('origin', refStr);
        }
    }

    if (url.hostname.includes('owocdn')) {
        headers.set('Sec-Fetch-Dest', 'iframe');
        headers.set('Sec-Fetch-Mode', 'navigate');
        headers.set('Sec-Fetch-Site', 'cross-site');
    } else {
        headers.set('Sec-Fetch-Dest', 'empty');
        headers.set('Sec-Fetch-Mode', 'cors');
        headers.set('Sec-Fetch-Site', 'cross-site');
    }

    const storedCookies = cookieJar.get(url.hostname);
    if (storedCookies) {
        const current = headers.get('cookie');
        headers.set('cookie', current ? `${current}; ${storedCookies}` : storedCookies);
    }

    return headers;
}

function updateCookieJar(url, response) {
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) {
        const current = cookieJar.get(url.hostname) || "";
        const cookies = setCookie.split(', ');

        const merged = [...new Set([
            ...current.split('; '),
            ...cookies.map(c => c.split(';')[0])
        ])].filter(Boolean).join('; ');

        cookieJar.set(url.hostname, merged);
    }
}

function setCorsHeaders(request, responseHeaders) {
    const origin = request.headers.get('origin') || '*';
    responseHeaders.set('Access-Control-Allow-Origin', origin);
    responseHeaders.set('Access-Control-Allow-Methods', CONFIG.CORS.ALLOW_METHODS);
    responseHeaders.set('Access-Control-Allow-Headers', CONFIG.CORS.ALLOW_HEADERS);
    responseHeaders.set('Access-Control-Expose-Headers', CONFIG.CORS.EXPOSE_HEADERS);
    responseHeaders.set('Access-Control-Allow-Credentials', CONFIG.CORS.ALLOW_CREDENTIALS);
    responseHeaders.set('Cache-Control', CONFIG.CACHE_CONTROL);
    responseHeaders.set('X-Proxy-By', 'cloudflare-worker-m3u8-proxy');
}

function generateProxyUrl(targetUrl, workerUrl, headersParam) {
    const url = new URL(workerUrl.origin + workerUrl.pathname);
    url.searchParams.set('url', targetUrl);
    if (headersParam) url.searchParams.set('headers', headersParam);
    return url.toString();
}

function proxyPlaylistContent(content, targetUrl, workerUrl, headersParam) {
    return content.split("\n").map((line) => {
        const trimmed = line.trim();

        if (trimmed === '' || trimmed.startsWith("#EXTM3U") || trimmed.startsWith("#EXT-X-VERSION")) {
            return line;
        }

        if (trimmed.startsWith("#")) {
            return line.replace(/(URI\s*=\s*["'])([^"']+)(["'])/gi, (match, prefix, uri, suffix) => {
                try {
                    const abs = new URL(uri, targetUrl.href).href;
                    return `${prefix}${generateProxyUrl(abs, workerUrl, headersParam)}${suffix}`;
                } catch (e) {
                    return match;
                }
            });
        }

        try {
            const abs = new URL(trimmed, targetUrl.href).href;
            return generateProxyUrl(abs, workerUrl, headersParam);
        } catch (e) {
            return line;
        }
    }).join("\n");
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const origin = request.headers.get('origin') || "";

        const allowedOrigins = env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(',').map(o => o.trim()) : [];

        if (request.method === "OPTIONS") {
            const h = new Headers();
            setCorsHeaders(request, h);
            return new Response(null, { headers: h });
        }

        if (!isOriginAllowed(origin, allowedOrigins)) {
            return new Response(`Origin "${origin}" blacklisted.`, { status: 403 });
        }

        const targetUrlStr = url.searchParams.get('url');
        if (!targetUrlStr) {
            return new Response("Missing 'url' parameter.", { status: 400 });
        }

        try {
            const targetUrl = new URL(targetUrlStr);
            let headersParam = url.searchParams.get('headers') || "";
            const upstreamHeaders = buildUpstreamHeaders(request, targetUrl, headersParam);

            const response = await fetch(targetUrl.href, {
                method: 'GET',
                headers: upstreamHeaders,
                redirect: 'follow'
            });

            updateCookieJar(targetUrl, response);

            if (!response.ok && response.status !== 206) {
                const responseHeaders = new Headers();
                setCorsHeaders(request, responseHeaders);
                return new Response(`Upstream error: ${response.status} ${response.statusText}`, {
                    status: response.status,
                    headers: responseHeaders
                });
            }

            const responseHeaders = new Headers();
            setCorsHeaders(request, responseHeaders);

            const contentType = response.headers.get('content-type') || '';
            const isPlaylist = targetUrl.pathname.toLowerCase().endsWith(".m3u8") ||
                contentType.includes("mpegurl") ||
                contentType.includes("x-mpegurl");

            if (isPlaylist) {
                const content = await response.text();
                const isActualPlaylist = content.trimStart().startsWith('#EXTM3U');

                if (isActualPlaylist) {
                    if (!headersParam) {
                        const detectedReferer = upstreamHeaders.get('referer');
                        if (detectedReferer) {
                            headersParam = JSON.stringify({ referer: detectedReferer });
                        }
                    }
                    const proxiedContent = proxyPlaylistContent(content, targetUrl, url, headersParam);
                    responseHeaders.set('Content-Type', "application/vnd.apple.mpegurl");
                    return new Response(proxiedContent, { status: 200, headers: responseHeaders });
                }

                responseHeaders.set('Content-Type', contentType || 'application/octet-stream');
                return new Response(content, { status: response.status, headers: responseHeaders });
            } else {
                CONFIG.UPSTREAM_HEADERS.forEach(h => {
                    const val = response.headers.get(h);
                    if (val) responseHeaders.set(h, val);
                });

                const isSegment = targetUrl.pathname.toLowerCase().endsWith(".ts") ||
                    targetUrl.pathname.toLowerCase().endsWith(".m4s") ||
                    targetUrl.hostname.includes('owocdn') ||
                    targetUrl.hostname.includes('kwik');

                if (isSegment) {
                    responseHeaders.set('Content-Type', 'video/mp2t');
                }

                ['x-amz-cf-pop', 'x-amz-cf-id', 'x-cache', 'via', 'server'].forEach(h => responseHeaders.delete(h));

                return new Response(response.body, { status: response.status, headers: responseHeaders });
            }

        } catch (e) {
            return new Response(JSON.stringify({ error: e.message }), {
                status: 500,
                headers: { "Content-Type": "application/json" }
            });
        }
    }
};
