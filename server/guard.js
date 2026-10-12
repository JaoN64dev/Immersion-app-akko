// Only akko's own pages may use the server.
// Any website open in your browser can send requests to 127.0.0.1 too. So:
//  - the address asked for must be this computer (stops "DNS rebinding", where another site's
//    name is pointed at 127.0.0.1 so the browser treats it as akko);
//  - anything that changes something (POST, PUT, DELETE) must come from akko's own pages: browsers
//    always say which site a request comes from (Origin), and other sites can't fake it;
//  - nothing under /api/ for another site's page, even just reading: browsers mark every request
//    with where it comes from (Sec-Fetch-Site), so another page can't make akko work for it (say,
//    load /api/speech?text=… a thousand times to fill the disk, or fetch things through it).
// Requests without these headers (tests, other programs on this computer, like Anki) are let through.
// A phone or tablet on the home network (when that's turned on, server/lan.js) first goes through
// its own checks: home network only, the right address, signed in with the PIN.

const { lanGuard } = require('./lan');

const LOCAL = /^(127\.0\.0\.1|localhost)(:\d+)?$/i;
const READ_ONLY = ['GET', 'HEAD', 'OPTIONS'];
// the akko companion browser extension (extension/): its ID comes from the "key" in its manifest,
// so only that extension has it. AKKO_EXTENSIONS adds more IDs (e.g. a Chrome Web Store copy).
const EXTENSIONS = new Set(['cflgdipimeohhbeadldfgaohdcnnkcol', ...String(process.env.AKKO_EXTENSIONS || '').split(',').filter(Boolean)]
  .map((id) => `chrome-extension://${id.trim()}`));

function guard(req, res, next) {
  if (req.viaLan) return lanGuard(req, res, () => sameSite(req, res, next));
  const host = req.headers.host || '';
  if (!LOCAL.test(host)) return res.status(403).send('akko only answers at 127.0.0.1 or localhost');
  sameSite(req, res, next);
}

// changes only from akko's own pages; nothing under /api/ for another website's page
function sameSite(req, res, next) {
  const host = req.headers.host || '';
  const origin = req.headers.origin;
  if (origin && EXTENSIONS.has(origin) && !req.viaLan) return next();        // akko's own extension
  if (origin && !READ_ONLY.includes(req.method)) {
    let same = false;
    try { same = new URL(origin).host === host; } catch { /* "null" and other non-URLs */ }
    if (!same) return res.status(403).json({ error: 'requests from other websites are not allowed' });
  }
  const from = req.headers['sec-fetch-site'];
  if (req.path.startsWith('/api/') && (from === 'cross-site' || from === 'same-site')) {
    return res.status(403).json({ error: 'requests from other websites are not allowed' });
  }
  next();
}

module.exports = { guard };
