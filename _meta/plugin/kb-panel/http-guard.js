/**
 * Same-origin / CSRF guard for the local `/kb/*` HTTP surface.
 *
 * This is deliberately a browser-boundary check, not process authentication:
 * any local process that can open the port can still call it. It blocks a
 * malicious web page from driving the vault through the user's browser and
 * makes write endpoints reject HTML form posts (`text/plain`,
 * `application/x-www-form-urlencoded`).
 */
function reject(res, status, error) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify({ error }));
}

export function requestRejected(req, res, options = {}) {
  const origin = req.headers.origin;
  const host = req.headers.host;
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
  }
  return false;
}
