import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Same-origin / CSRF / loopback guard for the local `/kb/*` HTTP surface.
 *
 * This is not full process authentication: a same-user process that can open
 * the port can still call it. It blocks a malicious web page from driving the
 * vault through the user's browser, rejects non-loopback connections, and
 * makes write endpoints reject HTML form posts (`text/plain`,
 * `application/x-www-form-urlencoded`).
 *
 * Browser requests prove themselves with the CSRF token read from
 * `/kb/panel.json`; they normally also carry `sec-fetch-site`, `Origin`, or a
 * same-origin `Referer`. Non-browser clients (Node, curl, another local
 * process) should instead read the per-boot `_meta/state/http-token` file and
 * send it as `x-kb-local-token`; this rejects casual writes, but a same-user
 * process can still spoof browser headers or read the token file, so it is not
 * OS-level authentication.
 */
function reject(res, status, error) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify({ error }));
}

/** Temporary diagnosis trail for write-guard rejections (state is gitignored). */
function debugReject(req) {
  try {
    const file = fileURLToPath(new URL('../../state/http-guard-debug.log', import.meta.url));
    const headers = req.headers || {};
    appendFileSync(
      file,
      `${JSON.stringify({
        at: new Date().toISOString(),
        method: req.method,
        url: req.url,
        host: headers.host,
        origin: headers.origin,
        referer: headers.referer,
        secFetchSite: headers['sec-fetch-site'],
        secFetchMode: headers['sec-fetch-mode'],
        secFetchDest: headers['sec-fetch-dest'],
        contentType: headers['content-type'],
        userAgent: headers['user-agent'],
        accept: headers.accept,
        acceptLanguage: headers['accept-language'],
        hasCsrf: Boolean(headers['x-kb-csrf']),
        hasLocalToken: Boolean(headers['x-kb-local-token']),
      })}\n`,
      'utf8',
    );
  } catch {
    /* diagnostics must never block the guard */
  }
}

/** Accept IPv4/IPv6 loopback and the IPv4-mapped form Node may report. */
export function isLoopbackAddress(address) {
  const value = String(address || '').toLowerCase();
  return value === '127.0.0.1' || value === '::1' || value === '::ffff:127.0.0.1';
}

export function requestRejected(req, res, options = {}) {
  const origin = req.headers.origin;
  const host = req.headers.host;
  const localAddress = req.socket && req.socket.localAddress;
  if (localAddress && !isLoopbackAddress(localAddress)) {
    reject(res, 403, 'non-loopback connection rejected');
    return true;
  }
  let sameOrigin = false;
  if (origin) {
    let originHost = '';
    try {
      const parsed = new URL(origin);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') originHost = 'null';
      else originHost = parsed.host;
    } catch {
      originHost = 'null';
    }
    if (!host || originHost !== host) {
      reject(res, 403, 'cross-origin request rejected');
      return true;
    }
    sameOrigin = true;
  }
  let sameReferer = false;
  if (!sameOrigin && req.headers.referer) {
    try {
      sameReferer = new URL(req.headers.referer).host === host;
    } catch {
      sameReferer = false;
    }
  }
  const userAgent = String(req.headers['user-agent'] || '');
  const acceptLanguage = String(req.headers['accept-language'] || '');
  const browserUserAgent = /^Mozilla\//.test(userAgent) && acceptLanguage !== '';
  if (String(req.headers['sec-fetch-site'] || '').toLowerCase() === 'cross-site') {
    reject(res, 403, 'cross-site request rejected');
    return true;
  }
  if (options.write && req.method === 'POST') {
    const mediaType = String(req.headers['content-type'] || '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    if (mediaType !== 'application/json') {
      reject(res, 415, 'write endpoints require application/json');
      return true;
    }
    if (options.token) {
      const supplied = String(req.headers['x-kb-csrf'] || '');
      if (supplied !== options.token) {
        reject(res, 403, 'missing or invalid CSRF token');
        return true;
      }
    }
    // Browser fetches normally carry `sec-fetch-site`; some embedded webviews
    // omit it, so an explicit same-origin Origin/Referer or a browser
    // User-Agent + Accept-Language pair counts as the browser signal too. A
    // non-browser caller that sends none of these must prove it can read the
    // per-boot token file. A local process can spoof these headers — this is a
    // raised bar, not process authentication.
    if (options.localToken) {
      const fetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
      const browser =
        fetchSite === 'same-origin' ||
        fetchSite === 'same-site' ||
        sameOrigin ||
        sameReferer ||
        browserUserAgent;
      if (!browser) {
        debugReject(req);
        const supplied = String(req.headers['x-kb-local-token'] || '');
        if (supplied !== options.localToken) {
          reject(res, 403, 'non-browser writes require the local token file');
          return true;
        }
      }
    }
  }
  return false;
}
