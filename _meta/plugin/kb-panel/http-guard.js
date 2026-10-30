/**
 * Same-origin / CSRF / loopback guard for the local `/kb/*` HTTP surface.
 *
 * This is not full process authentication: a same-user process that can open
 * the port can still call it. It blocks a malicious web page from driving the
 * vault through the user's browser, rejects non-loopback connections, and
 * makes write endpoints reject HTML form posts (`text/plain`,
 * `application/x-www-form-urlencoded`).
 *
 * Browser requests carry `sec-fetch-site` and prove themselves with the CSRF
 * token read from `/kb/panel.json`. Non-browser clients (Node, curl, another
 * local process) should instead read the per-boot `_meta/state/http-token`
 * file and send it as `x-kb-local-token`; this rejects casual writes, but a
 * same-user process can still spoof the browser header or read the token file,
 * so it is not OS-level authentication.
 */
function reject(res, status, error) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify({ error }));
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
  }
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
    // Browser fetches carry `sec-fetch-site`; a non-browser caller must prove
    // it can read the per-boot token file. A local process can spoof the
    // browser header — this is a raised bar, not process authentication.
    if (options.localToken) {
      const fetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
      const browser = fetchSite === 'same-origin' || fetchSite === 'same-site';
      if (!browser) {
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
