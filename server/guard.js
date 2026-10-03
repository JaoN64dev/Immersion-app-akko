// Only akko's own pages may use the server.
// Any website open in your browser can send requests to 127.0.0.1 too. So:
//  - the address asked for must be this computer (stops "DNS rebinding", where another site's
//    name is pointed at 127.0.0.1 so the browser treats it as akko);
//  - anything that changes something (POST, PUT, DELETE) must come from akko's own pages: browsers
//    always say which site a request comes from (Origin), and other sites can't fake it.
// Requests without an Origin (tests, other programs on this computer) are let through.

const LOCAL = /^(127\.0\.0\.1|localhost)(:\d+)?$/i;
const READ_ONLY = ['GET', 'HEAD', 'OPTIONS'];

function guard(req, res, next) {
  const host = req.headers.host || '';
  if (!LOCAL.test(host)) return res.status(403).send('akko only answers at 127.0.0.1 or localhost');
  const origin = req.headers.origin;
  if (origin && !READ_ONLY.includes(req.method)) {
    let same = false;
    try { same = new URL(origin).host === host; } catch { /* "null" and other non-URLs */ }
    if (!same) return res.status(403).json({ error: 'requests from other websites are not allowed' });
  }
  next();
}

module.exports = { guard };
